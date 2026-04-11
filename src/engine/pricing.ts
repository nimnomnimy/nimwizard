/**
 * pricing.ts
 * ──────────
 * Tiered pricing and discount rule resolution.
 *
 * Discount application order (matches typical CPQ systems):
 *  1. Tier discount (quantity-based, per product)
 *  2. Direct discount (% or $ off)
 *  3. Volume discount (based on total units or total deal value)
 *  4. Category discount (applies to all lines of a given category)
 *  5. Conditional discount ("if product X in deal, discount product Y")
 *
 * Rules stack multiplicatively by default (each rule applies to the
 * already-discounted price), which is the most common behaviour in
 * enterprise pricing. Override this by calling applyAllRules with
 * stackMode = 'additive' to sum all discounts off the list price.
 */

import type {
  DealProduct, DealLineItem, DiscountRule, PricingTier, ProductCategory,
} from '../types'

// ─── Tier pricing ─────────────────────────────────────────────────────────────

/**
 * Given a product's tier schedule and a quantity, returns the applicable
 * discount percentage (0–100).
 *
 * Tiers are matched by finding the first tier whose [minQty, maxQty] range
 * contains qty. If no tier matches, returns 0 (full price).
 */
export function getTierDiscount(
  tiers: PricingTier[] | undefined,
  qty: number,
): number {
  if (!tiers || tiers.length === 0) return 0

  // Sort ascending by minQty so we can pick the deepest applicable tier
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty)

  let applicable = 0
  for (const tier of sorted) {
    if (qty >= tier.minQty && (tier.maxQty === null || qty <= tier.maxQty)) {
      applicable = tier.discountPercent
    }
  }
  return applicable
}

/**
 * Apply tier discount to a unit price.
 * Returns the discounted unit price.
 */
export function applyTierDiscount(unitPrice: number, discountPercent: number): number {
  return unitPrice * (1 - discountPercent / 100)
}

// ─── Single-rule application ──────────────────────────────────────────────────

/**
 * Apply a single DiscountRule to a current price.
 * Returns the new price (never below 0).
 */
export function applyRule(currentPrice: number, rule: DiscountRule): number {
  if (rule.discountType === 'percent') {
    return Math.max(0, currentPrice * (1 - rule.discountValue / 100))
  }
  // Fixed amount off total line value
  return Math.max(0, currentPrice - rule.discountValue)
}

// ─── All-rules resolution ─────────────────────────────────────────────────────

export type StackMode = 'multiplicative' | 'additive'

/**
 * Given a deal's line items, products, and discount rules, resolve the
 * effective sell price for each line item.
 *
 * Returns a Map<lineItemId → resolvedUnitSellPrice>.
 *
 * The caller should then update deal.lineItems[x].sellPriceUsd with the result.
 */
export function applyAllRules(
  lineItems: DealLineItem[],
  products: DealProduct[],
  rules: DiscountRule[],
  stackMode: StackMode = 'multiplicative',
): Map<string, number> {
  const productMap = new Map(products.map(p => [p.id, p]))

  // Compute total deal value and total units for volume thresholds
  const totalUnits = lineItems.reduce((s, i) => s + i.quantity, 0)
  const totalValue = lineItems.reduce((s, i) => {
    const p = productMap.get(i.productId)
    return s + (p ? i.sellPriceUsd * i.quantity : 0)
  }, 0)

  // Check which product IDs are present in the deal (for conditional rules)
  const productIdsInDeal = new Set(lineItems.map(i => i.productId))

  const result = new Map<string, number>()

  for (const item of lineItems) {
    const product = productMap.get(item.productId)
    if (!product) continue

    // Step 1: Start from item's current sell price
    let price = item.sellPriceUsd

    // Step 2: Collect applicable discounts
    const applicableRules: DiscountRule[] = []

    for (const rule of rules) {
      switch (rule.type) {
        case 'direct':
          // Always applies to every line
          applicableRules.push(rule)
          break

        case 'volume-units':
          // Applies if total deal units ≥ threshold
          if (totalUnits >= (rule.threshold ?? 0)) applicableRules.push(rule)
          break

        case 'volume-value':
          // Applies if total deal value ≥ threshold
          if (totalValue >= (rule.threshold ?? 0)) applicableRules.push(rule)
          break

        case 'category':
          // Applies only to lines whose product matches the rule's category
          if (product.category === rule.category) applicableRules.push(rule)
          break

        case 'conditional':
          // Applies to thenProductId lines IF ifProductId is present in the deal
          if (
            rule.ifProductId &&
            rule.thenProductId &&
            productIdsInDeal.has(rule.ifProductId) &&
            item.productId === rule.thenProductId
          ) {
            applicableRules.push(rule)
          }
          break
      }
    }

    // Step 3: Apply rules
    if (stackMode === 'multiplicative') {
      // Each rule applies to the already-reduced price
      for (const rule of applicableRules) {
        price = applyRule(price, rule)
      }
    } else {
      // Additive: sum all discount amounts off the original price
      let totalDiscount = 0
      for (const rule of applicableRules) {
        if (rule.discountType === 'percent') {
          totalDiscount += item.sellPriceUsd * (rule.discountValue / 100)
        } else {
          totalDiscount += rule.discountValue
        }
      }
      price = Math.max(0, item.sellPriceUsd - totalDiscount)
    }

    result.set(item.id, price)
  }

  return result
}

// ─── Suggested tier price ─────────────────────────────────────────────────────

/**
 * Given a product and quantity, return what the sell price SHOULD be
 * after applying tier discounts to the default sell price.
 * Used by the UI to auto-fill the sell price when a product is selected.
 */
export function suggestedSellPrice(product: DealProduct, qty: number): number {
  const discountPct = getTierDiscount(product.pricingTiers, qty)
  return applyTierDiscount(product.defaultSellPrice, discountPct)
}

// ─── Discount budget helpers ──────────────────────────────────────────────────

/**
 * Given a discount budget in USD and a line item,
 * return the maximum percentage discount that can be applied
 * without exceeding the budget.
 *
 * budgetUsd: remaining discount budget
 * lineTotal: qty × sellPrice for this line
 */
export function maxDiscountPercent(budgetUsd: number, lineTotal: number): number {
  if (lineTotal <= 0) return 0
  return Math.min(100, (budgetUsd / lineTotal) * 100)
}

/**
 * How many free units can we give away within the remaining budget?
 * Free units cost us costPrice × N.
 */
export function maxFreeUnits(budgetUsd: number, costPrice: number): number {
  if (costPrice <= 0) return 0
  return Math.floor(budgetUsd / costPrice)
}
