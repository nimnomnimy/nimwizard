/**
 * freight.ts
 * ──────────
 * Freight cost calculations for ocean / air / mixed shipping strategies.
 *
 * Key concepts:
 *  - Ocean: cheaper per-unit, used for bulk / non-time-critical shipments
 *  - Air:   expensive per-unit, used for urgent / small-volume shipments
 *  - Mixed: split a single line item across both methods
 *
 * All costs are in USD.
 */

import type { FreightConfig, FreightMethod } from '../types'

// ─── Breakdown (returned alongside totals for UI display) ─────────────────────

export interface FreightBreakdown {
  method: FreightMethod
  oceanQty: number
  airQty: number
  oceanCost: number          // total USD for ocean portion
  airCost: number            // total USD for air portion
  totalCost: number          // oceanCost + airCost
  blendedCostPerUnit: number // totalCost / totalQty
}

// ─── Core calculation ─────────────────────────────────────────────────────────

/**
 * Given a FreightConfig and the total quantity for a line item,
 * returns the full cost breakdown and blended per-unit cost.
 *
 * For MIXED mode the user specifies oceanQty + airQty explicitly.
 * If those don't sum to the total qty we treat the remainder as ocean
 * (cheaper assumption — never silently inflate costs).
 */
export function calcFreight(config: FreightConfig, totalQty: number): FreightBreakdown {
  const oceanRate = config.oceanCostPerUnit ?? 0
  const airRate   = config.airCostPerUnit   ?? 0

  let oceanQty = 0
  let airQty   = 0

  switch (config.method) {
    case 'ocean':
      oceanQty = totalQty
      airQty   = 0
      break

    case 'air':
      oceanQty = 0
      airQty   = totalQty
      break

    case 'mixed': {
      // User specifies split; clamp to totalQty
      const specOcean = Math.min(config.oceanQty ?? 0, totalQty)
      const specAir   = Math.min(config.airQty   ?? 0, totalQty)
      const specTotal = specOcean + specAir

      if (specTotal <= totalQty) {
        // Remainder goes to ocean (cheaper default)
        oceanQty = specOcean + (totalQty - specTotal)
        airQty   = specAir
      } else {
        // User over-specified — scale proportionally
        oceanQty = Math.round((specOcean / specTotal) * totalQty)
        airQty   = totalQty - oceanQty
      }
      break
    }
  }

  const oceanCost = oceanQty * oceanRate
  const airCost   = airQty   * airRate
  const totalCost = oceanCost + airCost
  const blendedCostPerUnit = totalQty > 0 ? totalCost / totalQty : 0

  return {
    method: config.method,
    oceanQty,
    airQty,
    oceanCost,
    airCost,
    totalCost,
    blendedCostPerUnit,
  }
}

/** Convenience: just the total cost (used by metrics.ts) */
export function calcFreightCostTotal(config: FreightConfig, qty: number): number {
  return calcFreight(config, qty).totalCost
}

/** Convenience: blended per-unit cost (used by optimization.ts comparisons) */
export function blendedFreightPerUnit(config: FreightConfig, qty: number): number {
  return calcFreight(config, qty).blendedCostPerUnit
}

// ─── Scenario helpers (used by optimization.ts) ───────────────────────────────

/**
 * What would this line cost if we switched ALL units to ocean?
 * Returns total cost delta (negative = cheaper).
 */
export function allOceanCost(config: FreightConfig, qty: number): number {
  const oceanRate = config.oceanCostPerUnit ?? 0
  return oceanRate * qty
}

/**
 * What would this line cost if we switched ALL units to air?
 */
export function allAirCost(config: FreightConfig, qty: number): number {
  const airRate = config.airCostPerUnit ?? 0
  return airRate * qty
}

/**
 * Format a freight breakdown for display in the UI.
 * Returns a short plain-text description.
 */
export function describeFreight(b: FreightBreakdown): string {
  if (b.method === 'ocean') return `Ocean — $${b.blendedCostPerUnit.toFixed(2)}/unit`
  if (b.method === 'air')   return `Air — $${b.blendedCostPerUnit.toFixed(2)}/unit`
  return `Mixed (${b.oceanQty} ocean / ${b.airQty} air) — $${b.blendedCostPerUnit.toFixed(2)}/unit blended`
}
