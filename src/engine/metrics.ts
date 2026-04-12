/**
 * metrics.ts
 * ──────────
 * Pure calculation helpers for deal economics.
 * No React, no side effects — all functions are deterministic given the same inputs.
 *
 * Responsibilities:
 *  - Convert USD ↔ AUD using global FX or per-product override
 *  - Compute per-line margin, freight cost, floor-price violations
 *  - Aggregate line metrics into deal-level totals
 */

import type {
  Deal, DealProduct, DealLineItem, LineMetrics, DealMetrics,
} from '../types'
import { calcFreightCostTotal } from './freight'

// ─── FX ───────────────────────────────────────────────────────────────────────

/** Convert a USD amount to AUD using per-product override if present, else globalFxRate */
export function toAud(usd: number, globalFxRate: number, fxOverride?: number): number {
  return usd * (fxOverride ?? globalFxRate)
}

// ─── Per-line metrics ─────────────────────────────────────────────────────────

export function calcLineMetrics(
  item: DealLineItem,
  product: DealProduct,
  globalFxRate: number,
): LineMetrics {
  const qty = item.quantity

  // Cost (excluding freight)
  const costUsd = product.costPrice * qty

  // Freight cost for this line
  const freightCostUsd = item.freight
    ? calcFreightCostTotal(item.freight, qty)
    : 0

  const totalCostUsd = costUsd + freightCostUsd

  // List price = product default sell price × qty (what customer "should" pay)
  const listPriceUsd = product.defaultSellPrice * qty

  // Actual sell price per unit (0 if item is free)
  const unitSell = item.status === 'free' ? 0 : item.sellPriceUsd
  const sellPriceUsd = unitSell * qty

  // Discount = difference between list and actual sell
  const discountUsd = Math.max(0, listPriceUsd - sellPriceUsd)

  // Margin = revenue − total cost
  const marginUsd = sellPriceUsd - totalCostUsd

  // Margin % = margin / sell × 100 (avoid divide-by-zero)
  const marginPercent = sellPriceUsd > 0
    ? (marginUsd / sellPriceUsd) * 100
    : -Infinity

  // Floor violation: actual per-unit sell price below floor (free items are exempt —
  // they are intentionally $0 and tracked separately as cost impact)
  const belowFloor =
    item.status !== 'free' &&
    item.sellPriceUsd < product.floorSellPrice

  // Perceived value = list price (basis for savings calculation)
  const perceivedValueUsd = listPriceUsd

  // AUD equivalents
  const fxRate = globalFxRate
  const fxOverride = product.fxOverride
  const costAud = toAud(totalCostUsd, fxRate, fxOverride)
  const sellAud = toAud(sellPriceUsd, fxRate, fxOverride)

  return {
    lineItemId: item.id,
    costUsd,
    freightCostUsd,
    totalCostUsd,
    listPriceUsd,
    sellPriceUsd,
    discountUsd,
    marginUsd,
    marginPercent,
    belowFloor,
    perceivedValueUsd,
    costAud,
    sellAud,
  }
}

// ─── Deal-level aggregation ───────────────────────────────────────────────────

export function calcDealMetrics(deal: Deal, products: DealProduct[]): DealMetrics {
  const productMap = new Map(products.map(p => [p.id, p]))

  // Compute per-line metrics, silently skip lines whose product has been deleted
  const lines: LineMetrics[] = deal.lineItems
    .map(item => {
      const product = productMap.get(item.productId)
      if (!product) return null
      return calcLineMetrics(item, product, deal.globalFxRate)
    })
    .filter((x): x is LineMetrics => x !== null)

  const sum = (fn: (l: LineMetrics) => number) =>
    lines.reduce((acc, l) => acc + fn(l), 0)

  const totalCostUsd    = sum(l => l.totalCostUsd)
  const totalFreightUsd = sum(l => l.freightCostUsd)
  const totalSellUsd    = sum(l => l.sellPriceUsd)
  const totalMarginUsd  = sum(l => l.marginUsd)
  const totalListValueUsd = sum(l => l.listPriceUsd)
  const totalDiscountUsd  = sum(l => l.discountUsd)

  // Free items: cost of gratis lines (the real cost to us)
  const freeLines = deal.lineItems.filter(i => i.status === 'free')
  const totalFreeValueUsd = freeLines.reduce((acc, item) => {
    const p = productMap.get(item.productId)
    return acc + (p ? p.defaultSellPrice * item.quantity : 0)
  }, 0)

  // Margin %
  const totalMarginPercent = totalSellUsd > 0
    ? (totalMarginUsd / totalSellUsd) * 100
    : 0

  // Perceived savings = (listValue - customerPays) / listValue × 100
  const perceivedSavingsPercent = totalListValueUsd > 0
    ? ((totalListValueUsd - totalSellUsd) / totalListValueUsd) * 100
    : 0

  // Discount budget tracking
  // Budget = (((sell/unit - floor) * qty)) - discounts_given - free_items_cost
  // Represents the net headroom above floor after accounting for discounts and free items.
  const headroomAboveFloor = lines.reduce((acc, l) => {
    const item    = deal.lineItems.find(i => i.id === l.lineItemId)
    const product = item ? productMap.get(item.productId) : null
    if (!item || !product || item.status === 'free') return acc
    return acc + Math.max(0, (item.sellPriceUsd - product.floorSellPrice) * item.quantity)
  }, 0)
  const freeItemsCost = freeLines.reduce((acc, item) => {
    const p = productMap.get(item.productId)
    return acc + (p ? p.costPrice * item.quantity : 0)
  }, 0)
  // discountBudgetUsed = headroom - discounts - free costs
  // (positive = budget consumed; negative means priced below floor or worse)
  const discountBudgetUsed      = headroomAboveFloor - totalDiscountUsd - freeItemsCost
  const discountBudgetRemaining = Math.max(0, deal.discountBudgetUsd - discountBudgetUsed)

  // Floor violations
  const violatingLineIds = lines.filter(l => l.belowFloor).map(l => l.lineItemId)

  // AUD totals — use first product's override or global (deal-level totals use global rate)
  const totalSellAud = toAud(totalSellUsd, deal.globalFxRate)
  const totalCostAud = toAud(totalCostUsd, deal.globalFxRate)

  return {
    lines,
    totalCostUsd,
    totalFreightUsd,
    totalSellUsd,
    totalMarginUsd,
    totalMarginPercent,
    totalListValueUsd,
    totalDiscountUsd,
    totalFreeValueUsd,
    perceivedSavingsPercent,
    discountBudgetUsed,
    discountBudgetRemaining,
    hasFloorViolation: violatingLineIds.length > 0,
    violatingLineIds,
    totalSellAud,
    totalCostAud,
  }
}
