/**
 * optimization.ts
 * ───────────────
 * The Deal Optimization Engine.
 *
 * Given a deal, its products, and an optimization goal, this module:
 *  1. Computes baseline deal metrics
 *  2. Analyses each line item for improvement opportunities
 *  3. Produces a prioritized list of recommendations, each with a plain-English
 *     "why" explanation so the user understands the reasoning
 *  4. Simulates the projected metrics if all recommendations are applied
 *
 * TWO optimization goals are supported (toggled by the user):
 *  - 'margin':           maximise total deal margin $
 *  - 'perceived-value':  maximise what the customer perceives as savings
 *
 * ─── Algorithm walkthrough ───────────────────────────────────────────────────
 *
 *  PASS 1 — Floor violations (CRITICAL, always checked first)
 *    For every line below floor sell price, emit an 'adjust-sell-price'
 *    recommendation with the minimum delta needed to reach floor.
 *
 *  PASS 2 — Freight optimisation
 *    For lines that have air freight:
 *      a) Compute cost if switched to ocean
 *      b) If margin improvement > FREIGHT_MIN_SAVING_USD, recommend switch
 *    For lines that have ocean freight on high-priority items (not modelled
 *    here — we flag if ocean is used on small quantities where air is cheaper
 *    per unit once fixed costs are considered).
 *
 *  PASS 3 — Discount budget allocation
 *    For each discounted line where budget remains:
 *      a) Simulate giving N free units instead of discounting
 *         - Cost to us:             N × costPrice
 *         - Perceived value to cust: N × defaultSellPrice
 *         - Perceived value ratio:   defaultSellPrice / costPrice
 *      b) Simulate keeping discount as-is
 *         - Cost to us:             discountUsd
 *         - Perceived value:        same discountUsd
 *         - Perceived value ratio:  1.0
 *      → If free-units ratio > discount ratio AND we have budget: recommend give-free-units
 *      → Otherwise recommend keep / increase discount
 *
 *  PASS 4 — Over-budget check
 *    If total discount spend > budget, emit 'reduce-discount' for the line with
 *    the lowest margin impact per dollar of discount.
 *
 *  PASS 5 — Sort and cap
 *    Sort recommendations:
 *      - 'margin' goal:          by marginImpactUsd descending
 *      - 'perceived-value' goal: by perceivedValueImpactUsd descending
 *    Cap at MAX_RECOMMENDATIONS to avoid overwhelming the user.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type {
  Deal, DealProduct, DealLineItem, DealMetrics,
  OptimizationResult, OptimizationRecommendation, OptimizationGoal,
} from '../types'
import { calcDealMetrics, calcLineMetrics } from './metrics'
import { calcFreight, allOceanCost, allAirCost } from './freight'

// ─── Tuneable thresholds ──────────────────────────────────────────────────────

/** Minimum USD margin improvement to bother recommending a freight switch */
const FREIGHT_MIN_SAVING_USD = 50

/** Maximum number of recommendations to surface (keeps UI scannable) */
const MAX_RECOMMENDATIONS = 8

/** Minimum perceived-value ratio for free-units to beat straight discount */
const FREE_UNITS_VALUE_RATIO_THRESHOLD = 1.5

// ─── Helper: build a "projected" version of the deal with a recommendation applied ──

function applyRecommendationToDeal(
  deal: Deal,
  rec: OptimizationRecommendation,
): Deal {
  const updatedItems = deal.lineItems.map((item): DealLineItem => {
    if (item.id !== rec.lineItemId) return item

    switch (rec.type) {
      case 'adjust-sell-price': {
        // Lift sell price to floor (stored in rec description as new price)
        const match = rec.description.match(/\$([0-9.]+)/)
        const newPrice = match ? parseFloat(match[1]) : item.sellPriceUsd
        return { ...item, sellPriceUsd: newPrice }
      }
      case 'switch-to-ocean':
        return {
          ...item,
          freight: item.freight
            ? { ...item.freight, method: 'ocean' }
            : { method: 'ocean', oceanCostPerUnit: item.freight?.oceanCostPerUnit },
        }
      case 'switch-to-air':
        return {
          ...item,
          freight: item.freight
            ? { ...item.freight, method: 'air' }
            : { method: 'air', airCostPerUnit: item.freight?.airCostPerUnit },
        }
      case 'give-free-units': {
        // Mark one item as free (simplification — in reality you'd split the line)
        return { ...item, status: 'free', sellPriceUsd: 0 }
      }
      case 'reduce-discount': {
        // Restore to floor sell price
        return { ...item, discountValue: 0 }
      }
      default:
        return item
    }
  })
  return { ...deal, lineItems: updatedItems }
}

// ─── Main optimizer ───────────────────────────────────────────────────────────

export function optimizeDeal(
  deal: Deal,
  products: DealProduct[],
  goal: OptimizationGoal,
): OptimizationResult {
  const productMap = new Map(products.map(p => [p.id, p]))

  // ── Baseline ──────────────────────────────────────────────────────────────
  const baseline: DealMetrics = calcDealMetrics(deal, products)
  const recommendations: OptimizationRecommendation[] = []

  // ── PASS 1: Floor violations ───────────────────────────────────────────────
  for (const lineMetrics of baseline.lines) {
    if (!lineMetrics.belowFloor) continue

    const item    = deal.lineItems.find(i => i.id === lineMetrics.lineItemId)!
    const product = productMap.get(item.productId)!

    const currentSell = item.sellPriceUsd
    const floorSell   = product.floorSellPrice
    const marginDelta = (floorSell - currentSell) * item.quantity

    recommendations.push({
      type:        'adjust-sell-price',
      lineItemId:  item.id,
      description: `Raise "${product.name}" sell price from $${currentSell.toFixed(2)} to floor $${floorSell.toFixed(2)}/unit`,
      why:         `This line violates the approved floor sell price of $${floorSell.toFixed(2)}. Selling below floor erodes margin and may breach approval policy.`,
      marginImpactUsd:          marginDelta,
      perceivedValueImpactUsd:  0,
      priority: 'high',
    })
  }

  // ── PASS 2: Freight optimisation ──────────────────────────────────────────
  for (const item of deal.lineItems) {
    if (!item.freight) continue
    const product = productMap.get(item.productId)
    if (!product) continue

    const qty = item.quantity
    const currentBreakdown = calcFreight(item.freight, qty)
    const currentCost      = currentBreakdown.totalCost

    // Compare against full-ocean
    if (item.freight.method !== 'ocean' && (item.freight.oceanCostPerUnit ?? 0) > 0) {
      const oceanTotal = allOceanCost(item.freight, qty)
      const saving     = currentCost - oceanTotal

      if (saving >= FREIGHT_MIN_SAVING_USD) {
        recommendations.push({
          type:        'switch-to-ocean',
          lineItemId:  item.id,
          description: `Switch "${product.name}" freight from ${item.freight.method} to ocean`,
          why:         `Ocean freight saves $${saving.toFixed(0)} vs current strategy, improving margin by $${saving.toFixed(0)} on this line.`,
          marginImpactUsd:          saving,
          perceivedValueImpactUsd:  0,
          priority: saving > 500 ? 'high' : 'medium',
        })
      }
    }

    // Compare against full-air (when ocean is used but air might be viable for small qty)
    if (item.freight.method === 'ocean' && (item.freight.airCostPerUnit ?? 0) > 0 && qty <= 5) {
      const airTotal = allAirCost(item.freight, qty)
      // Air is typically more expensive — only recommend if somehow cheaper
      const saving   = currentCost - airTotal
      if (saving >= FREIGHT_MIN_SAVING_USD) {
        recommendations.push({
          type:        'switch-to-air',
          lineItemId:  item.id,
          description: `Switch "${product.name}" freight to air (small quantity)`,
          why:         `For ${qty} units, air freight is $${saving.toFixed(0)} cheaper than ocean due to lower fixed costs at small volumes.`,
          marginImpactUsd:          saving,
          perceivedValueImpactUsd:  0,
          priority: 'medium',
        })
      }
    }
  }

  // ── PASS 3: Give vs Discount analysis ─────────────────────────────────────
  let remainingBudget = baseline.discountBudgetRemaining

  for (const lineMetrics of baseline.lines) {
    const item    = deal.lineItems.find(i => i.id === lineMetrics.lineItemId)!
    const product = productMap.get(item.productId)
    if (!product) continue

    // Only analyse discounted (not free) lines that have active discount
    if (item.status !== 'discounted' || lineMetrics.discountUsd <= 0) continue
    if (remainingBudget <= 0) continue

    const discountUsd   = lineMetrics.discountUsd
    const costPerUnit   = product.costPrice
    const valuePerUnit  = product.defaultSellPrice

    // How many free units could we give for the same cost as this discount?
    const freeUnitCost  = costPerUnit > 0 ? discountUsd / costPerUnit : 0
    const freeUnitCount = Math.floor(freeUnitCost)

    // Perceived value of free units vs perceived value of discount
    const freePerceivedValue = freeUnitCount * valuePerUnit
    // Discount perceived value = just the discount amount
    const discountPerceivedValue = discountUsd

    // Ratio: how much perceived value per $ spent
    const freeRatio     = freeUnitCount > 0 ? freePerceivedValue / discountUsd : 0
    const discountRatio = 1.0  // always 1:1

    if (freeRatio >= FREE_UNITS_VALUE_RATIO_THRESHOLD && freeUnitCount >= 1) {
      // Free units yield better perceived value per dollar
      const perceivedLift = freePerceivedValue - discountPerceivedValue
      recommendations.push({
        type:        'give-free-units',
        lineItemId:  item.id,
        description: `Give ${freeUnitCount} free unit${freeUnitCount > 1 ? 's' : ''} of "${product.name}" instead of discounting`,
        why:         `${freeUnitCount} free units (list value $${freePerceivedValue.toFixed(0)}) costs the same as the $${discountUsd.toFixed(0)} discount but delivers ${((freeRatio - 1) * 100).toFixed(0)}% more perceived value to the customer. Value ratio: ${freeRatio.toFixed(2)}x vs 1.0x for straight discount.`,
        marginImpactUsd:          0,   // same cost either way
        perceivedValueImpactUsd:  perceivedLift,
        priority: perceivedLift > 1000 ? 'high' : 'medium',
      })
    } else if (goal === 'margin' && discountUsd > 0) {
      // For margin goal: suggest reducing discount if it's not driving enough value
      const marginPerDiscountDollar = lineMetrics.marginUsd / Math.max(1, discountUsd)
      if (marginPerDiscountDollar < 0.5) {
        recommendations.push({
          type:        'reduce-discount',
          lineItemId:  item.id,
          description: `Reduce discount on "${product.name}" — current discount yields low margin return`,
          why:         `Each $1 of discount on this line returns only $${marginPerDiscountDollar.toFixed(2)} of margin. Reducing the discount by 50% would recover $${(discountUsd * 0.5).toFixed(0)} margin with minimal customer impact.`,
          marginImpactUsd:          discountUsd * 0.5,
          perceivedValueImpactUsd:  -(discountUsd * 0.5),
          priority: 'low',
        })
      }
    }
  }

  // ── PASS 4: Over-budget check ──────────────────────────────────────────────
  if (baseline.discountBudgetUsed > deal.discountBudgetUsd && deal.discountBudgetUsd > 0) {
    const overage = baseline.discountBudgetUsed - deal.discountBudgetUsd

    // Find the line with the highest discount that isn't already flagged
    const flaggedIds = new Set(recommendations.map(r => r.lineItemId))
    const overBudgetCandidate = baseline.lines
      .filter(l => l.discountUsd > 0 && !flaggedIds.has(l.lineItemId))
      .sort((a, b) => b.discountUsd - a.discountUsd)[0]

    if (overBudgetCandidate) {
      const item    = deal.lineItems.find(i => i.id === overBudgetCandidate.lineItemId)!
      const product = productMap.get(item.productId)!
      recommendations.push({
        type:        'reduce-discount',
        lineItemId:  item.id,
        description: `Reduce discount on "${product.name}" — deal is $${overage.toFixed(0)} over budget`,
        why:         `Total discount spend ($${baseline.discountBudgetUsed.toFixed(0)}) exceeds approved budget of $${deal.discountBudgetUsd.toFixed(0)} by $${overage.toFixed(0)}. Reducing this line's discount will bring the deal within budget.`,
        marginImpactUsd:          overage,
        perceivedValueImpactUsd:  -overage,
        priority: 'high',
      })
    }
  }

  // ── PASS 5: Sort and cap ───────────────────────────────────────────────────
  recommendations.sort((a, b) => {
    // Always surface critical floor violations and budget overages first
    const priorityScore = (r: OptimizationRecommendation) =>
      r.priority === 'high' ? 3 : r.priority === 'medium' ? 2 : 1

    const pDiff = priorityScore(b) - priorityScore(a)
    if (pDiff !== 0) return pDiff

    // Then sort by goal
    if (goal === 'margin') {
      return b.marginImpactUsd - a.marginImpactUsd
    } else {
      return b.perceivedValueImpactUsd - a.perceivedValueImpactUsd
    }
  })

  const capped = recommendations.slice(0, MAX_RECOMMENDATIONS)

  // ── Build projected metrics ────────────────────────────────────────────────
  // Apply all recommendations sequentially to get the projected outcome
  let projectedDeal = deal
  for (const rec of capped) {
    projectedDeal = applyRecommendationToDeal(projectedDeal, rec)
  }
  const projectedMetrics = calcDealMetrics(projectedDeal, products)

  // ── Summary ───────────────────────────────────────────────────────────────
  const marginalGain = projectedMetrics.totalMarginUsd - baseline.totalMarginUsd
  const valueGain    = projectedMetrics.perceivedSavingsPercent - baseline.perceivedSavingsPercent
  const floorCount   = capped.filter(r => r.type === 'adjust-sell-price').length

  let summary = `Found ${capped.length} recommendation${capped.length !== 1 ? 's' : ''}.`
  if (floorCount > 0) summary += ` ${floorCount} floor violation${floorCount > 1 ? 's' : ''} must be fixed.`
  if (goal === 'margin' && marginalGain > 0) {
    summary += ` Applying all suggestions improves margin by $${marginalGain.toFixed(0)}.`
  } else if (goal === 'perceived-value' && valueGain > 0) {
    summary += ` Applying all suggestions increases perceived savings by ${valueGain.toFixed(1)}%.`
  }

  return {
    goal,
    recommendations: capped,
    projectedMetrics,
    summary,
  }
}
