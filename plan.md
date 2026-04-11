# Deal Engine — Implementation Plan

## Context
This plan is a session-resumption guide. The Deal Engine is a new section of the NimWizard app
(React + Vite + TypeScript + Tailwind + Zustand + Firestore). There is NO backend — all logic is
pure TypeScript in the engine layer, persisted via Firestore using the same patterns as the rest
of the app.

The working directory is:
`c:\Users\nima\OneDrive\Desktop\NimWork\nimwizard`

---

## Architecture Overview

```
src/
  engine/                      ← pure TS pricing/freight/optimization logic (no React)
    pricing.ts                 ← tiered pricing, direct/volume/category discounts
    freight.ts                 ← ocean/air/mixed freight cost calculations
    metrics.ts                 ← margin $, margin %, floor-price checks, value metrics
    optimization.ts            ← optimizer + explainability recommendations

  types/index.ts               ← add DealProduct, Deal, DealLineItem, DealScenario, etc.
  store/useAppStore.ts         ← add dealProducts[], deals[] slices + Firestore listeners
  pages/
    DealEnginePage.tsx         ← top-level page, two tabs: Products | Deals
  components/deals/
    ProductDrawer.tsx          ← add/edit product side drawer
    DealLineItem.tsx           ← single line item row in the deal builder table
    DealSummaryPanel.tsx       ← right panel: totals, margin, floor warnings
    OptimizationPanel.tsx      ← right panel: optimizer output + explanations
    ScenarioComparison.tsx     ← modal/panel: side-by-side A/B/C scenarios
    DealCharts.tsx             ← recharts: margin breakdown, freight, discount charts
```

---

## Types to Add (`src/types/index.ts`)

```typescript
export type ProductCategory =
  | 'Software' | 'Hardware' | 'Professional Services'
  | 'Technical Services' | 'Maintenance'

export type FreightMethod = 'ocean' | 'air' | 'mixed'
export type LineItemStatus = 'paid' | 'discounted' | 'free'
export type DiscountType = 'percent' | 'fixed'
export type OptimizationGoal = 'margin' | 'perceived-value'

export interface PricingTier {
  minQty: number
  maxQty: number | null   // null = unlimited
  discountPercent: number
}

export interface DealProduct {
  id: string
  name: string
  category: ProductCategory
  costPrice: number           // USD
  floorSellPrice: number      // USD — hard minimum
  defaultSellPrice: number    // USD
  fxOverride?: number         // USD→AUD override rate (null = use global)
  pricingTiers?: PricingTier[]
  createdAt: number
}

export interface FreightConfig {
  method: FreightMethod
  oceanCostPerUnit?: number   // USD
  airCostPerUnit?: number     // USD
  oceanQty?: number           // units via ocean (mixed mode)
  airQty?: number             // units via air (mixed mode)
}

export interface DealLineItem {
  id: string
  productId: string
  quantity: number
  sellPriceUsd: number        // per unit, proposed
  status: LineItemStatus      // paid | discounted | free
  discountType?: DiscountType
  discountValue?: number      // % or $ depending on discountType
  freight?: FreightConfig
  notes?: string
}

export interface DiscountRule {
  id: string
  type: 'direct' | 'volume-units' | 'volume-value' | 'category' | 'conditional'
  discountType: DiscountType
  discountValue: number
  // volume-units: threshold qty; volume-value: threshold $ total
  threshold?: number
  // category: applies only to this category
  category?: ProductCategory
  // conditional: "if productId X in deal, discount productId Y"
  ifProductId?: string
  thenProductId?: string
  label?: string
}

export interface Deal {
  id: string
  name: string
  lineItems: DealLineItem[]
  discountRules: DiscountRule[]
  discountBudgetUsd: number   // total $ budget for discounts/freebies
  globalFxRate: number        // USD→AUD
  notes?: string
  createdAt: number
  updatedAt: number
}

export interface DealScenario {
  id: string
  dealId: string
  label: string               // "Scenario A", "Scenario B", etc.
  lineItems: DealLineItem[]
  discountRules: DiscountRule[]
  discountBudgetUsd: number
}

// Computed (not stored — derived by engine)
export interface LineMetrics {
  lineItemId: string
  costUsd: number
  freightCostUsd: number
  totalCostUsd: number
  listPriceUsd: number
  sellPriceUsd: number
  discountUsd: number
  marginUsd: number
  marginPercent: number
  belowFloor: boolean
  perceivedValueUsd: number   // list price × qty (what customer "would have paid")
  costAud: number
  sellAud: number
}

export interface DealMetrics {
  lines: LineMetrics[]
  totalCostUsd: number
  totalFreightUsd: number
  totalSellUsd: number
  totalMarginUsd: number
  totalMarginPercent: number
  totalListValueUsd: number
  totalDiscountUsd: number
  totalFreeValueUsd: number   // cost of gratis items
  perceivedSavingsPercent: number
  discountBudgetUsed: number
  discountBudgetRemaining: number
  hasFloorViolation: boolean
  violatingLineIds: string[]
  totalSellAud: number
  totalCostAud: number
}

export interface OptimizationRecommendation {
  type: 'switch-to-ocean' | 'switch-to-air' | 'give-free-units' | 'apply-discount'
         | 'reduce-discount' | 'adjust-sell-price'
  lineItemId: string
  description: string         // human-readable explanation
  why: string                 // "Switching to ocean increases margin by 8%"
  marginImpactUsd: number     // positive = margin improves
  perceivedValueImpactUsd: number
  priority: 'high' | 'medium' | 'low'
}

export interface OptimizationResult {
  goal: OptimizationGoal
  recommendations: OptimizationRecommendation[]
  projectedMetrics: DealMetrics
  summary: string
}
```

---

## Engine Layer (`src/engine/`)

### `pricing.ts`
Functions:
- `applyPricingTiers(product, qty) → discountPercent`
- `applyDirectDiscount(price, rule) → newPrice`
- `applyVolumeDiscount(lineItems, products, rule) → Map<lineItemId, newPrice>`
- `applyCategoryDiscount(lineItems, products, rule) → Map<lineItemId, newPrice>`
- `applyConditionalDiscount(lineItems, rule) → Map<lineItemId, newPrice>`
- `applyAllRules(deal, products) → Map<lineItemId, resolvedSellPrice>`

### `freight.ts`
Functions:
- `calcFreightCostPerUnit(config, qty) → { costPerUnit, totalCost, breakdown }`
- `blendedFreightCostPerUnit(config, qty) → number`
  - Ocean: `oceanQty × oceanCostPerUnit`
  - Air: `airQty × airCostPerUnit`
  - Mixed: weighted average

### `metrics.ts`
Functions:
- `calcLineMetrics(lineItem, product, fxRate) → LineMetrics`
- `calcDealMetrics(deal, products) → DealMetrics`
- `isFloorViolation(lineItem, product) → boolean`
- `toAud(usd, fxRate, fxOverride?) → number`

### `optimization.ts`
Functions:
- `optimizeDeal(deal, products, goal) → OptimizationResult`

Algorithm (all logic must be commented):
1. Compute baseline `DealMetrics`
2. For each line item:
   a. Check floor violations → recommend `adjust-sell-price` if violated
   b. If freight is `air` and margin < threshold → recommend `switch-to-ocean`, calc margin delta
   c. Compare giving N free units vs applying X% discount for same discount budget:
      - Free units: cost = N × costPrice; perceived value = N × listPrice
      - Discount: cost = discount × qty × sellPrice; perceived value = same dollar amount
      - Prefer free units if `perceivedValue / cost` ratio is higher
3. If `discountBudgetUsed > discountBudgetUsd` → flag over-budget
4. Sort recommendations by `marginImpactUsd` descending
5. Build `projectedMetrics` applying top recommendations
6. Return with `why` explanation strings for each

---

## Firestore Schema (new collections)

```
users/{uid}/dealProducts/{productId}
users/{uid}/deals/{dealId}             ← includes lineItems[], discountRules[], scenarios[]
```

Both collections follow the same `onSnapshot` → optimistic write → rollback pattern used by
contacts, timelines, etc. `TOTAL_COLLECTIONS` bumps from 5 → 7.

---

## Store Additions (`src/store/useAppStore.ts`)

New state:
```typescript
dealProducts: DealProduct[]
deals: Deal[]
```

New actions:
```typescript
// Products
addDealProduct(p: DealProduct): void
updateDealProduct(p: DealProduct): void
deleteDealProduct(id: string): void

// Deals
addDeal(d: Deal): void
updateDeal(d: Deal): void
deleteDeal(id: string): void
```

---

## Page Layout (`src/pages/DealEnginePage.tsx`)

Two tabs at top: **Products** | **Deals**

### Products Tab
- Grid of product cards
- "New Product" → opens `ProductDrawer`
- Each card shows: name, category badge, cost/floor/sell prices (USD + AUD), tier count

### Deals Tab
Three-column layout:
```
[Left: Deal List 240px] | [Center: Deal Builder flex-1] | [Right: Summary+Optimizer 320px]
```

**Left column:**
- List of saved deals
- "New Deal" button
- Click deal → opens in center

**Center column (Deal Builder):**
- Deal name (editable)
- FX rate input (global, per-deal)
- Discount budget input
- Line items table:
  - Product selector (dropdown)
  - Qty
  - Sell price (editable, shows tier-adjusted price)
  - Status badge (paid/discounted/free)
  - Freight config (expand inline)
  - Margin % per line (color coded: green ≥20%, amber 10-20%, red <10% or floor violation)
  - Delete row
- "Add Line Item" button
- Discount Rules section (collapsible):
  - Add rules: direct / volume / category / conditional
- Scenarios section (collapsible):
  - Clone current deal as Scenario A/B/C
  - "Compare Scenarios" button → opens `ScenarioComparison`

**Right column:**
Two panels stacked:

*Summary Panel (top):*
- Total Cost | Total Sell | Margin $ | Margin %
- List Value | Customer Pays | Perceived Savings %
- USD + AUD for all
- Discount budget used / remaining progress bar
- Floor violation alert (red banner if any line violates)

*Optimization Panel (below):*
- Goal toggle: Maximize Margin ↔ Maximize Perceived Value
- "Optimize Deal" button
- Results list: each recommendation card shows:
  - Type badge
  - Description
  - "Why:" explanation
  - Margin impact (+$X)
  - Apply button

---

## Components

### `ProductDrawer.tsx`
- Right-side drawer (same pattern as ContactDrawer)
- Fields: name, category, costPrice, floorSellPrice, defaultSellPrice, fxOverride
- Pricing tiers section: add/remove tier rows (minQty, maxQty, discountPercent)

### `DealLineItem.tsx`
- Single `<tr>` in the deal builder table
- Inline freight expander (click freight icon → shows ocean/air/mixed config)
- Color-coded margin cell
- Floor violation highlight (red row background)

### `DealSummaryPanel.tsx`
- Pure display component, receives `DealMetrics` as prop
- Recharts `PieChart` for margin breakdown (cost vs margin vs freight)

### `OptimizationPanel.tsx`
- Receives `deal`, `products`, calls `optimizeDeal()` on demand
- Shows recommendation cards with `why` text
- "Apply All" button applies all recommendations to deal line items

### `ScenarioComparison.tsx`
- Full-screen modal
- Table: rows = metrics, columns = scenarios
- Recharts `BarChart` comparing revenue/margin/discount/perceived-value per scenario

### `DealCharts.tsx`
- Three charts (tabs or stacked):
  1. **Margin Breakdown** — stacked bar per line item (cost / freight / margin)
  2. **Discount Allocation** — pie chart (direct discounts / free items / remaining budget)
  3. **Freight Comparison** — grouped bar: current vs if-all-ocean vs if-all-air cost

---

## Dependencies to Install

```bash
npm install recharts
npm install @types/recharts   # if needed
```
recharts is MIT-licensed, tree-shakeable, works with React 19.

---

## Implementation Order (session checkpoints)

| # | Task | Files | Status |
|---|------|-------|--------|
| 1 | Write `plan.md` | `plan.md` | ✅ Done |
| 2 | Install recharts | `package.json` | ✅ Done |
| 3 | Add types | `src/types/index.ts` | ✅ Done |
| 4 | Add store slice | `src/store/useAppStore.ts` | ✅ Done |
| 5 | Write `src/engine/metrics.ts` | new file | ✅ Done |
| 6 | Write `src/engine/pricing.ts` | new file | ✅ Done |
| 7 | Write `src/engine/freight.ts` | new file | ✅ Done |
| 8 | Write `src/engine/optimization.ts` | new file | ✅ Done |
| 9 | Write `ProductDrawer.tsx` | new file | ✅ Done |
| 10 | Write `DealLineItem.tsx` | new file | ✅ Done |
| 11 | Write `DealSummaryPanel.tsx` | new file | ✅ Done |
| 12 | Write `OptimizationPanel.tsx` | new file | ✅ Done |
| 13 | Write `ScenarioComparison.tsx` | new file | ✅ Done |
| 14 | Write `DealCharts.tsx` | new file | ✅ Done |
| 15 | Write `DealEnginePage.tsx` | new file | ✅ Done |
| 16 | Wire route + nav | `App.tsx`, `AppShell.tsx` | ✅ Done |
| 17 | Commit & push | git | ✅ Done |

---

## How to Resume a Session

Tell Claude:
> "Read plan.md at c:\Users\nima\OneDrive\Desktop\NimWork\nimwizard\plan.md and continue
> building the Deal Engine from where it left off. Check the Implementation Order table
> for the last completed step."

Then update the table's Status column as each step completes (✅ Done).

---

## Key Conventions (must match rest of app)

- All components use Tailwind utility classes only — no CSS files
- Drawer pattern: `fixed z-50`, right side, `translate-x-full` when closed
- Form inputs: `px-3 py-3 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 min-h-[48px]`
- Action buttons: blue-500 primary, slate-200 border secondary, red-500 destructive
- Toast notifications: `showToast(message, 'success' | undefined)`
- IDs: always `uid()` from `src/lib/utils`
- Firestore writes: optimistic update → write → rollback on error (same as contacts/timelines)
- `stripUndefined()` before all Firestore writes
- No backend — pure frontend + Firestore
