import { useState } from 'react'
import type { DealLineItem as LineItemType, DealProduct, LineMetrics, FreightMethod, FreightConfig } from '../../types'
import type { FreightBreakdown } from '../../engine/freight'
import { calcFreight } from '../../engine/freight'
import { suggestedSellPrice } from '../../engine/pricing'
import { useCurrency } from '../../store/useCurrency'

const STATUS_OPTIONS = [
  { value: 'paid',       label: 'Paid',       color: 'bg-green-100 text-green-700  border-green-200' },
  { value: 'discounted', label: 'Discounted', color: 'bg-amber-100 text-amber-700  border-amber-200' },
  { value: 'free',       label: 'Free',       color: 'bg-purple-100 text-purple-700 border-purple-200' },
] as const

function marginColor(pct: number, belowFloor: boolean): string {
  if (belowFloor) return 'text-red-600 font-bold'
  if (pct >= 20)  return 'text-green-600'
  if (pct >= 10)  return 'text-amber-600'
  return 'text-red-500'
}

interface Props {
  item: LineItemType
  products: DealProduct[]
  metrics: LineMetrics | undefined
  onChange: (updated: LineItemType) => void
  onRemove: () => void
}

export default function DealLineItemRow({ item, products, metrics, onChange, onRemove }: Props) {
  const [freightOpen, setFreightOpen] = useState(false)
  const product = products.find(p => p.id === item.productId)
  const currFmt       = useCurrency(s => s.fmt)
  const fmtAud        = useCurrency(s => s.fmtAud)
  const showSecondary = useCurrency(s => s.showSecondary)

  const set = <K extends keyof LineItemType>(k: K, v: LineItemType[K]) =>
    onChange({ ...item, [k]: v })

  const handleProductChange = (productId: string) => {
    const p = products.find(x => x.id === productId)
    if (!p) return
    onChange({ ...item, productId, sellPriceUsd: suggestedSellPrice(p, item.quantity), status: 'paid' })
  }

  const handleQtyChange = (qty: number) => {
    const p = products.find(x => x.id === item.productId)
    const suggested = p ? suggestedSellPrice(p, qty) : item.sellPriceUsd
    onChange({ ...item, quantity: qty, sellPriceUsd: item.status === 'free' ? 0 : suggested })
  }

  const freightBreakdown = item.freight && product
    ? calcFreight(item.freight, item.quantity)
    : null

  const statusOpt = STATUS_OPTIONS.find(s => s.value === item.status)!

  return (
    <div className={`rounded-xl border transition-colors ${metrics?.belowFloor ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'}`}>
      {/* Main row — responsive grid */}
      <div className="grid items-start gap-2 p-3" style={{ gridTemplateColumns: '1fr 72px 110px 130px 1fr 1fr auto' }}>

        {/* Product */}
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Product</span>
          <select
            value={item.productId}
            onChange={e => handleProductChange(e.target.value)}
            className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">— Select —</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {product && <span className="text-[10px] text-slate-400 px-0.5">{product.category}</span>}
        </div>

        {/* Qty */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Qty</span>
          <input
            type="number" min="1"
            value={item.quantity}
            onChange={e => handleQtyChange(parseInt(e.target.value) || 1)}
            className="w-full text-sm border border-slate-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-center"
          />
        </div>

        {/* Status */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Status</span>
          <select
            value={item.status}
            onChange={e => set('status', e.target.value as LineItemType['status'])}
            className={`w-full text-xs font-semibold border rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${statusOpt.color}`}
          >
            {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        {/* Sell/Unit */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Sell / Unit</span>
          {item.status === 'free' ? (
            <div className="py-2 px-2.5 text-sm text-slate-400 italic border border-slate-200 rounded-lg bg-slate-50">Free</div>
          ) : (
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-medium">$</span>
              <input
                type="number" min="0" step="0.01"
                value={item.sellPriceUsd}
                onChange={e => set('sellPriceUsd', parseFloat(e.target.value) || 0)}
                className="w-full pl-6 pr-2 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}
          {product && item.status !== 'free' && (
            <span className="text-[10px] text-slate-400 px-0.5">Floor: ${product.floorSellPrice.toFixed(2)}</span>
          )}
        </div>

        {/* Line total */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Line Total</span>
          <div className="py-2 px-2.5 rounded-lg bg-slate-50 border border-slate-100">
            <p className="text-sm font-semibold text-slate-700">{metrics ? currFmt(metrics.sellPriceUsd) : '—'}</p>
            {showSecondary && metrics && <p className="text-[10px] text-slate-400 mt-0.5">{fmtAud(metrics.sellPriceUsd)}</p>}
          </div>
        </div>

        {/* Margin */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Margin</span>
          <div className="py-2 px-2.5 rounded-lg bg-slate-50 border border-slate-100">
            {metrics ? (
              <>
                <p className={`text-sm font-semibold ${marginColor(metrics.marginPercent, metrics.belowFloor)}`}>
                  {metrics.marginPercent === -Infinity ? 'N/A' : `${metrics.marginPercent.toFixed(1)}%`}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">{currFmt(metrics.marginUsd)}</p>
                {showSecondary && <p className="text-[10px] text-slate-300">{fmtAud(metrics.marginUsd)}</p>}
                {metrics.belowFloor && <p className="text-[10px] text-red-500 font-semibold mt-0.5">⚠ Below floor</p>}
              </>
            ) : <span className="text-sm text-slate-300">—</span>}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold text-transparent uppercase tracking-wide select-none">·</span>
          <div className="flex items-center gap-1 pt-0.5">
            <button
              type="button"
              onClick={() => setFreightOpen(v => !v)}
              title="Freight"
              className={`p-2 rounded-lg transition-colors ${freightOpen ? 'bg-blue-100 text-blue-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/>
                <path d="M3 4h13l1.5 5H1.5L3 4zM1 2h2l.5 2H17l2 6H2L1 2z"/>
              </svg>
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="p-2 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Freight expander */}
      {freightOpen && (
        <div className="border-t border-slate-100 px-4 py-3 bg-slate-50 rounded-b-xl">
          <FreightEditor
            freight={item.freight}
            breakdown={freightBreakdown}
            onChange={f => set('freight', f)}
          />
        </div>
      )}
    </div>
  )
}

// ── Freight editor ────────────────────────────────────────────────────────────

function FreightEditor({
  freight, breakdown, onChange,
}: {
  freight: FreightConfig | undefined
  breakdown: FreightBreakdown | null
  onChange: (f: FreightConfig | undefined) => void
}) {
  const enabled = !!freight
  const f = freight ?? { method: 'ocean' as FreightMethod, oceanCostPerUnit: 0, airCostPerUnit: 0 }

  const set = <K extends keyof FreightConfig>(k: K, v: FreightConfig[K]) =>
    onChange({ ...f, [k]: v })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button type="button" role="switch" aria-checked={enabled}
          onClick={() => onChange(enabled ? undefined : { method: 'ocean', oceanCostPerUnit: 0 })}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${enabled ? 'bg-blue-500' : 'bg-slate-200'}`}>
          <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </button>
        <span className="text-sm font-medium text-slate-700">Include freight cost</span>
      </div>

      {enabled && (
        <div className="flex flex-wrap gap-3 items-start">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-slate-400">Method</label>
            <select value={f.method} onChange={e => set('method', e.target.value as FreightMethod)}
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="ocean">Ocean</option>
              <option value="air">Air</option>
              <option value="mixed">Mixed</option>
            </select>
          </div>

          {(f.method === 'ocean' || f.method === 'mixed') && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-400">Ocean $/unit</label>
              <input type="number" min="0" step="0.01" value={f.oceanCostPerUnit ?? ''}
                onChange={e => set('oceanCostPerUnit', parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                className="w-28 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          )}

          {(f.method === 'air' || f.method === 'mixed') && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-400">Air $/unit</label>
              <input type="number" min="0" step="0.01" value={f.airCostPerUnit ?? ''}
                onChange={e => set('airCostPerUnit', parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                className="w-28 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          )}

          {f.method === 'mixed' && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-slate-400">Ocean units</label>
                <input type="number" min="0" value={f.oceanQty ?? ''}
                  onChange={e => set('oceanQty', parseInt(e.target.value) || 0)}
                  className="w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-slate-400">Air units</label>
                <input type="number" min="0" value={f.airQty ?? ''}
                  onChange={e => set('airQty', parseInt(e.target.value) || 0)}
                  className="w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </>
          )}

          {breakdown && (
            <div className="flex flex-col gap-0.5 self-end pb-1">
              <p className="text-xs font-semibold text-slate-600">Total: ${breakdown.totalCost.toFixed(2)}</p>
              <p className="text-[11px] text-slate-400">
                ${breakdown.blendedCostPerUnit.toFixed(2)}/unit
                {breakdown.method === 'mixed' && ` (${breakdown.oceanQty} ocean / ${breakdown.airQty} air)`}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
