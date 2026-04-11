import { useMemo, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { uid } from '../lib/utils'
import { showToast } from '../components/ui/Toast'
import ProductDrawer from '../components/deals/ProductDrawer'
import DealLineItemRow from '../components/deals/DealLineItem'
import DealSummaryPanel from '../components/deals/DealSummaryPanel'
import OptimizationPanel from '../components/deals/OptimizationPanel'
import ScenarioComparison from '../components/deals/ScenarioComparison'
import DealCharts from '../components/deals/DealCharts'
import { calcDealMetrics } from '../engine/metrics'
import { suggestedSellPrice, applyAllRules } from '../engine/pricing'
import type {
  Deal, DealLineItem, DiscountRule, DealScenario,
  ProductCategory, OptimizationRecommendation, OptimizationResult,
} from '../types'

type MainTab = 'products' | 'deals'
type RightTab = 'summary' | 'optimizer' | 'charts'

const CATEGORY_COLORS: Record<ProductCategory, string> = {
  'Software':              'bg-blue-100 text-blue-700',
  'Hardware':              'bg-slate-100 text-slate-700',
  'Professional Services': 'bg-purple-100 text-purple-700',
  'Technical Services':    'bg-sky-100 text-sky-700',
  'Maintenance':           'bg-green-100 text-green-700',
}

const DISCOUNT_TYPE_LABELS = {
  'direct':         'Direct',
  'volume-units':   'Volume (Units)',
  'volume-value':   'Volume ($)',
  'category':       'Category',
  'conditional':    'Conditional',
}

const DEFAULT_FX = 1.58

export default function DealEnginePage() {
  const products      = useAppStore(s => s.dealProducts)
  const deals         = useAppStore(s => s.deals)
  const addDeal       = useAppStore(s => s.addDeal)
  const updateDeal    = useAppStore(s => s.updateDeal)
  const deleteDeal    = useAppStore(s => s.deleteDeal)

  const [mainTab, setMainTab]       = useState<MainTab>('deals')
  const [rightTab, setRightTab]     = useState<RightTab>('summary')
  const [drawerProductId, setDrawerProductId] = useState<string | null | undefined>(undefined)
  const [activeDealId, setActiveDealId]       = useState<string | null>(null)
  const [showComparison, setShowComparison]   = useState(false)
  const [showNewDealModal, setShowNewDealModal] = useState(false)
  const [newDealName, setNewDealName]          = useState('')

  // ── Active deal ────────────────────────────────────────────────────────────
  const activeDeal = deals.find(d => d.id === activeDealId) ?? null

  // Compute metrics reactively
  const metrics = useMemo(() => {
    if (!activeDeal) return null
    return calcDealMetrics(activeDeal, products)
  }, [activeDeal, products])

  // ── Deal mutations ─────────────────────────────────────────────────────────
  const patchDeal = (patch: Partial<Deal>) => {
    if (!activeDeal) return
    updateDeal({ ...activeDeal, ...patch, updatedAt: Date.now() })
  }

  const handleCreateDeal = () => {
    if (!newDealName.trim()) return
    const d: Deal = {
      id:               uid(),
      name:             newDealName.trim(),
      lineItems:        [],
      discountRules:    [],
      discountBudgetUsd: 0,
      globalFxRate:     DEFAULT_FX,
      scenarios:        [],
      createdAt:        Date.now(),
      updatedAt:        Date.now(),
    }
    addDeal(d)
    setActiveDealId(d.id)
    setShowNewDealModal(false)
    setNewDealName('')
    setMainTab('deals')
    showToast(`"${d.name}" created`, 'success')
  }

  const handleDeleteDeal = (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return
    deleteDeal(id)
    if (activeDealId === id) setActiveDealId(null)
    showToast(`"${name}" deleted`)
  }

  // ── Line items ─────────────────────────────────────────────────────────────
  const addLineItem = () => {
    if (!activeDeal) return
    const firstProduct = products[0]
    const newItem: DealLineItem = {
      id:           uid(),
      productId:    firstProduct?.id ?? '',
      quantity:     1,
      sellPriceUsd: firstProduct ? suggestedSellPrice(firstProduct, 1) : 0,
      status:       'paid',
    }
    patchDeal({ lineItems: [...activeDeal.lineItems, newItem] })
  }

  const updateLineItem = (updated: DealLineItem) => {
    if (!activeDeal) return
    patchDeal({ lineItems: activeDeal.lineItems.map(i => i.id === updated.id ? updated : i) })
  }

  const removeLineItem = (id: string) => {
    if (!activeDeal) return
    patchDeal({ lineItems: activeDeal.lineItems.filter(i => i.id !== id) })
  }

  // ── Discount rules ─────────────────────────────────────────────────────────
  const addRule = () => {
    if (!activeDeal) return
    const rule: DiscountRule = {
      id:            uid(),
      type:          'direct',
      discountType:  'percent',
      discountValue: 5,
      label:         'New rule',
    }
    patchDeal({ discountRules: [...activeDeal.discountRules, rule] })
  }

  const updateRule = (updated: DiscountRule) => {
    if (!activeDeal) return
    patchDeal({ discountRules: activeDeal.discountRules.map(r => r.id === updated.id ? updated : r) })
  }

  const removeRule = (id: string) => {
    if (!activeDeal) return
    patchDeal({ discountRules: activeDeal.discountRules.filter(r => r.id !== id) })
  }

  const applyRulesToPrices = () => {
    if (!activeDeal || products.length === 0) return
    const resolved = applyAllRules(activeDeal.lineItems, products, activeDeal.discountRules)
    const updated = activeDeal.lineItems.map(item => {
      const price = resolved.get(item.id)
      return price !== undefined ? { ...item, sellPriceUsd: price, status: 'discounted' as const } : item
    })
    patchDeal({ lineItems: updated })
    showToast('Prices updated from rules', 'success')
  }

  // ── Scenarios ──────────────────────────────────────────────────────────────
  const addScenario = () => {
    if (!activeDeal) return
    const label = `Scenario ${String.fromCharCode(65 + activeDeal.scenarios.length)}`
    const scenario: DealScenario = {
      id:               uid(),
      label,
      lineItems:        activeDeal.lineItems.map(i => ({ ...i, id: uid() })),
      discountRules:    activeDeal.discountRules.map(r => ({ ...r, id: uid() })),
      discountBudgetUsd: activeDeal.discountBudgetUsd,
    }
    patchDeal({ scenarios: [...activeDeal.scenarios, scenario] })
    showToast(`${label} created from current deal`, 'success')
  }

  const removeScenario = (id: string) => {
    if (!activeDeal) return
    patchDeal({ scenarios: activeDeal.scenarios.filter(s => s.id !== id) })
  }

  // ── Optimizer callbacks ────────────────────────────────────────────────────
  const handleApplyRecommendation = (rec: OptimizationRecommendation) => {
    if (!activeDeal) return
    const updated = activeDeal.lineItems.map((item): DealLineItem => {
      if (item.id !== rec.lineItemId) return item
      switch (rec.type) {
        case 'adjust-sell-price': {
          const p = products.find(x => x.id === item.productId)
          return p ? { ...item, sellPriceUsd: p.floorSellPrice } : item
        }
        case 'switch-to-ocean':
          return { ...item, freight: item.freight ? { ...item.freight, method: 'ocean' } : item.freight }
        case 'switch-to-air':
          return { ...item, freight: item.freight ? { ...item.freight, method: 'air' } : item.freight }
        case 'give-free-units':
          return { ...item, status: 'free', sellPriceUsd: 0 }
        case 'reduce-discount':
          return { ...item, discountValue: 0 }
        default:
          return item
      }
    })
    patchDeal({ lineItems: updated })
    showToast('Recommendation applied', 'success')
  }

  const handleApplyAll = (result: OptimizationResult) => {
    result.recommendations.forEach(rec => handleApplyRecommendation(rec))
    showToast(`${result.recommendations.length} recommendations applied`, 'success')
  }

  const sortedDeals = [...deals].sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50">

      {/* Top tab bar */}
      <div className="bg-white border-b border-slate-200 flex-shrink-0 px-4 flex items-center justify-between" style={{ minHeight: 52 }}>
        <div className="flex gap-1">
          {(['deals', 'products'] as MainTab[]).map(t => (
            <button key={t} onClick={() => setMainTab(t)}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors capitalize ${mainTab === t ? 'bg-blue-500 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
              {t === 'deals' ? `Deals (${deals.length})` : `Products (${products.length})`}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {mainTab === 'products' && (
            <button onClick={() => setDrawerProductId(null)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 transition-colors min-h-[40px]">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              New Product
            </button>
          )}
          {mainTab === 'deals' && (
            <button onClick={() => { setShowNewDealModal(true); setNewDealName('') }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 transition-colors min-h-[40px]">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              New Deal
            </button>
          )}
        </div>
      </div>

      {/* ── PRODUCTS TAB ────────────────────────────────────────────────────── */}
      {mainTab === 'products' && (
        <div className="flex-1 overflow-y-auto p-4">
          {products.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <rect x="6" y="6" width="36" height="36" rx="4" stroke="currentColor" strokeWidth="2"/>
                <path d="M16 24h16M24 16v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <div className="text-center">
                <p className="font-semibold text-slate-600">No products yet</p>
                <p className="text-sm mt-1">Create your first product to start building deals</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {products.map(p => {
                const margin = p.defaultSellPrice > 0
                  ? ((p.defaultSellPrice - p.costPrice) / p.defaultSellPrice * 100).toFixed(1)
                  : '—'
                const floorMargin = p.floorSellPrice > 0
                  ? ((p.floorSellPrice - p.costPrice) / p.floorSellPrice * 100).toFixed(1)
                  : '—'
                return (
                  <div key={p.id} onClick={() => setDrawerProductId(p.id)}
                    className="bg-white border border-slate-200 rounded-xl p-4 cursor-pointer hover:border-blue-300 hover:shadow-sm transition-all group">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="text-sm font-bold text-slate-800 truncate">{p.name}</h3>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${CATEGORY_COLORS[p.category]}`}>{p.category}</span>
                    </div>
                    <div className="flex flex-col gap-1 text-xs text-slate-500">
                      <div className="flex justify-between"><span>Cost</span><span className="font-medium text-slate-700">${p.costPrice.toLocaleString()}</span></div>
                      <div className="flex justify-between"><span>Floor Sell</span><span className="font-medium text-slate-700">${p.floorSellPrice.toLocaleString()} <span className="text-slate-400">({floorMargin}%)</span></span></div>
                      <div className="flex justify-between"><span>Default Sell</span><span className="font-medium text-slate-700">${p.defaultSellPrice.toLocaleString()} <span className="text-slate-400">({margin}%)</span></span></div>
                      {p.fxOverride && <div className="flex justify-between"><span>FX Override</span><span className="font-medium text-blue-600">{p.fxOverride.toFixed(4)}</span></div>}
                      {p.pricingTiers && p.pricingTiers.length > 0 && (
                        <p className="text-slate-400 mt-1">{p.pricingTiers.length} pricing tier{p.pricingTiers.length > 1 ? 's' : ''}</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── DEALS TAB ───────────────────────────────────────────────────────── */}
      {mainTab === 'deals' && (
        <div className="flex-1 flex min-h-0 overflow-hidden">

          {/* Left: deal list */}
          <div className="w-56 flex-shrink-0 border-r border-slate-200 bg-white flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto py-2">
              {sortedDeals.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-6 px-3">No deals yet.<br/>Click "New Deal" to start.</p>
              )}
              {sortedDeals.map(d => (
                <button key={d.id} onClick={() => setActiveDealId(d.id)}
                  className={`w-full text-left px-3 py-2.5 transition-colors border-l-2 ${activeDealId === d.id ? 'bg-blue-50 border-blue-500' : 'border-transparent hover:bg-slate-50'}`}>
                  <p className={`text-sm font-semibold truncate ${activeDealId === d.id ? 'text-blue-700' : 'text-slate-800'}`}>{d.name}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{d.lineItems.length} line{d.lineItems.length !== 1 ? 's' : ''}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Centre: deal builder */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {!activeDeal ? (
              <div className="flex-1 flex items-center justify-center text-slate-400 flex-col gap-3">
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><rect x="4" y="4" width="32" height="32" rx="4" stroke="currentColor" strokeWidth="1.5"/><path d="M12 20h16M20 12v16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                <p className="text-sm">Select a deal or create a new one</p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

                {/* Deal header */}
                <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 flex-shrink-0 flex-wrap">
                  <input value={activeDeal.name}
                    onChange={e => patchDeal({ name: e.target.value })}
                    className="text-base font-bold text-slate-900 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 focus:outline-none px-1 min-w-[120px]" />

                  <div className="flex items-center gap-1.5 ml-auto flex-wrap gap-y-2">
                    {/* FX rate */}
                    <label className="flex items-center gap-1.5 text-xs text-slate-500">
                      <span>FX</span>
                      <input type="number" min="0" step="0.001" value={activeDeal.globalFxRate}
                        onChange={e => patchDeal({ globalFxRate: parseFloat(e.target.value) || DEFAULT_FX })}
                        className="w-20 px-2 py-1 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </label>
                    {/* Budget */}
                    <label className="flex items-center gap-1.5 text-xs text-slate-500">
                      <span>Budget</span>
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                        <input type="number" min="0" value={activeDeal.discountBudgetUsd}
                          onChange={e => patchDeal({ discountBudgetUsd: parseFloat(e.target.value) || 0 })}
                          className="w-24 pl-5 pr-2 py-1 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                    </label>
                    {/* Scenario compare */}
                    <button onClick={() => setShowComparison(true)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 transition-colors">
                      Compare Scenarios
                    </button>
                    {/* Delete deal */}
                    <button onClick={() => handleDeleteDeal(activeDeal.id, activeDeal.name)}
                      className="px-3 py-1.5 rounded-lg border border-red-200 text-xs text-red-500 hover:bg-red-50 transition-colors">
                      Delete Deal
                    </button>
                  </div>
                </div>

                {/* Line items */}
                <div className="flex-1 overflow-auto px-4 pt-3 pb-4">

                  {/* Table */}
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-4">
                    <table className="w-full min-w-[700px] border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-left">
                          <th className="px-3 py-2.5 text-xs font-semibold text-slate-500">Product</th>
                          <th className="px-2 py-2.5 text-xs font-semibold text-slate-500 w-20">Qty</th>
                          <th className="px-2 py-2.5 text-xs font-semibold text-slate-500 w-32">Status</th>
                          <th className="px-2 py-2.5 text-xs font-semibold text-slate-500 w-32">Sell/Unit (USD)</th>
                          <th className="px-2 py-2.5 text-xs font-semibold text-slate-500 w-28 text-right">Line Total</th>
                          <th className="px-2 py-2.5 text-xs font-semibold text-slate-500 w-28 text-right">Margin</th>
                          <th className="px-2 py-2.5 text-xs font-semibold text-slate-500 w-24 text-center">Type</th>
                          <th className="px-2 py-2.5 w-20"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeDeal.lineItems.length === 0 && (
                          <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-slate-400">No line items yet. Click "Add Line Item" below.</td></tr>
                        )}
                        {activeDeal.lineItems.map(item => (
                          <DealLineItemRow
                            key={item.id}
                            item={item}
                            products={products}
                            metrics={metrics?.lines.find(l => l.lineItemId === item.id)}
                            fxRate={activeDeal.globalFxRate}
                            onChange={updateLineItem}
                            onRemove={() => removeLineItem(item.id)}
                          />
                        ))}
                      </tbody>
                    </table>
                    <div className="px-3 py-2.5 border-t border-slate-100">
                      <button onClick={addLineItem}
                        className="flex items-center gap-1.5 text-sm text-blue-500 hover:text-blue-700 font-semibold transition-colors">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                        Add Line Item
                      </button>
                    </div>
                  </div>

                  {/* Discount rules */}
                  <DiscountRulesSection
                    rules={activeDeal.discountRules}
                    products={products}
                    onAdd={addRule}
                    onUpdate={updateRule}
                    onRemove={removeRule}
                    onApply={applyRulesToPrices}
                  />

                  {/* Scenarios */}
                  <ScenariosSection
                    scenarios={activeDeal.scenarios}
                    onAdd={addScenario}
                    onRemove={removeScenario}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Right: summary + optimizer + charts */}
          {activeDeal && metrics && (
            <div className="w-80 flex-shrink-0 border-l border-slate-200 bg-white flex flex-col overflow-hidden">
              {/* Right tab bar */}
              <div className="flex border-b border-slate-200 flex-shrink-0">
                {(['summary', 'optimizer', 'charts'] as RightTab[]).map(t => (
                  <button key={t} onClick={() => setRightTab(t)}
                    className={`flex-1 py-2.5 text-[11px] font-semibold capitalize transition-colors ${rightTab === t ? 'border-b-2 border-blue-500 text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
                    {t}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {rightTab === 'summary'   && <DealSummaryPanel metrics={metrics} fxRate={activeDeal.globalFxRate} />}
                {rightTab === 'optimizer' && (
                  <OptimizationPanel
                    deal={activeDeal}
                    products={products}
                    onApplyRecommendation={handleApplyRecommendation}
                    onApplyAll={handleApplyAll}
                  />
                )}
                {rightTab === 'charts' && (
                  <DealCharts deal={activeDeal} products={products} metrics={metrics} />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showComparison && activeDeal && (
        <ScenarioComparison
          deal={activeDeal}
          products={products}
          onClose={() => setShowComparison(false)}
        />
      )}

      {drawerProductId !== undefined && (
        <ProductDrawer
          productId={drawerProductId}
          open={true}
          onClose={() => setDrawerProductId(undefined)}
        />
      )}

      {showNewDealModal && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowNewDealModal(false)} />
          <div className="fixed z-50 inset-x-4 top-[30%] sm:inset-auto sm:left-1/2 sm:-translate-x-1/2 sm:top-[30%] sm:w-80 bg-white rounded-2xl shadow-2xl p-5 flex flex-col gap-4">
            <h2 className="text-base font-bold text-slate-900">New Deal</h2>
            <input autoFocus type="text" value={newDealName}
              onChange={e => setNewDealName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreateDeal(); if (e.key === 'Escape') setShowNewDealModal(false) }}
              placeholder="Deal name…"
              className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px]" />
            <div className="flex gap-2">
              <button onClick={() => setShowNewDealModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors min-h-[44px]">
                Cancel
              </button>
              <button onClick={handleCreateDeal} disabled={!newDealName.trim()}
                className="flex-1 py-2.5 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 disabled:opacity-40 transition-colors min-h-[44px]">
                Create
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Discount rules section ────────────────────────────────────────────────────

import type { DealProduct } from '../types'

function DiscountRulesSection({
  rules, products, onAdd, onUpdate, onRemove, onApply,
}: {
  rules: DiscountRule[]
  products: DealProduct[]
  onAdd: () => void
  onUpdate: (r: DiscountRule) => void
  onRemove: (id: string) => void
  onApply: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="bg-white border border-slate-200 rounded-xl mb-4 overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
        <span className="text-sm font-semibold text-slate-700">
          Discount Rules <span className="text-slate-400 font-normal ml-1">({rules.length})</span>
        </span>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M2 5l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3 flex flex-col gap-3">
          {rules.length === 0 && (
            <p className="text-xs text-slate-400 italic">No rules added.</p>
          )}
          {rules.map(rule => (
            <div key={rule.id} className="flex flex-wrap gap-2 items-center bg-slate-50 rounded-xl p-2.5">
              {/* Type */}
              <select value={rule.type} onChange={e => onUpdate({ ...rule, type: e.target.value as DiscountRule['type'] })}
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[32px]">
                {Object.entries(DISCOUNT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {/* Discount type */}
              <select value={rule.discountType} onChange={e => onUpdate({ ...rule, discountType: e.target.value as 'percent' | 'fixed' })}
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[32px]">
                <option value="percent">%</option>
                <option value="fixed">$ fixed</option>
              </select>
              {/* Value */}
              <input type="number" min="0" step="0.5" value={rule.discountValue}
                onChange={e => onUpdate({ ...rule, discountValue: parseFloat(e.target.value) || 0 })}
                className="w-20 border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[32px]" />
              {/* Threshold (volume) */}
              {(rule.type === 'volume-units' || rule.type === 'volume-value') && (
                <input type="number" min="0" placeholder="Threshold"
                  value={rule.threshold ?? ''}
                  onChange={e => onUpdate({ ...rule, threshold: parseFloat(e.target.value) || 0 })}
                  className="w-28 border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[32px]" />
              )}
              {/* Category */}
              {rule.type === 'category' && (
                <select value={rule.category ?? ''} onChange={e => onUpdate({ ...rule, category: e.target.value as ProductCategory })}
                  className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[32px]">
                  <option value="">— Category —</option>
                  {['Software','Hardware','Professional Services','Technical Services','Maintenance'].map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              )}
              {/* Label */}
              <input type="text" value={rule.label ?? ''} onChange={e => onUpdate({ ...rule, label: e.target.value })}
                placeholder="Label"
                className="flex-1 min-w-[100px] border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[32px]" />
              {/* Remove */}
              <button onClick={() => onRemove(rule.id)}
                className="text-red-400 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 transition-colors">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={onAdd}
              className="flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-700 font-semibold px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors">
              + Add Rule
            </button>
            {rules.length > 0 && (
              <button onClick={onApply}
                className="flex items-center gap-1.5 text-xs text-green-600 hover:text-green-800 font-semibold px-2 py-1 rounded-lg hover:bg-green-50 transition-colors">
                ↻ Apply to Prices
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Scenarios section ─────────────────────────────────────────────────────────

function ScenariosSection({
  scenarios, onAdd, onRemove,
}: {
  scenarios: DealScenario[]
  onAdd: () => void
  onRemove: (id: string) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
        <span className="text-sm font-semibold text-slate-700">
          Scenarios <span className="text-slate-400 font-normal ml-1">({scenarios.length})</span>
        </span>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M2 5l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-4 py-3 flex flex-col gap-2">
          <p className="text-xs text-slate-400">Scenarios are snapshots of the current deal for side-by-side comparison.</p>
          {scenarios.length === 0 && (
            <p className="text-xs text-slate-400 italic">No scenarios yet.</p>
          )}
          {scenarios.map(s => (
            <div key={s.id} className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2">
              <div>
                <p className="text-xs font-semibold text-slate-700">{s.label}</p>
                <p className="text-[11px] text-slate-400">{s.lineItems.length} lines · Budget ${s.discountBudgetUsd.toLocaleString()}</p>
              </div>
              <button onClick={() => onRemove(s.id)}
                className="text-red-400 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 transition-colors">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            </div>
          ))}
          <button onClick={onAdd}
            className="flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-700 font-semibold px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors">
            + Clone Current as New Scenario
          </button>
        </div>
      )}
    </div>
  )
}
