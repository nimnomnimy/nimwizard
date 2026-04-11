import { useState } from 'react'
import type { DealLineItem as LineItemType, DealProduct, LineMetrics, FreightMethod } from '../../types'
import { calcFreight } from '../../engine/freight'
import { suggestedSellPrice } from '../../engine/pricing'

const STATUS_LABELS = { paid: 'Paid', discounted: 'Discounted', free: 'Free' }
const STATUS_COLORS = {
  paid:       'bg-green-100 text-green-700',
  discounted: 'bg-amber-100 text-amber-700',
  free:       'bg-purple-100 text-purple-700',
}

function marginColor(pct: number, belowFloor: boolean): string {
  if (belowFloor) return 'text-red-600 font-bold'
  if (pct >= 20)  return 'text-green-600 font-semibold'
  if (pct >= 10)  return 'text-amber-600 font-semibold'
  return 'text-red-500 font-semibold'
}

const fmt = (n: number) => `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

interface Props {
  item: LineItemType
  products: DealProduct[]
  metrics: LineMetrics | undefined
  fxRate: number
  onChange: (updated: LineItemType) => void
  onRemove: () => void
}

export default function DealLineItemRow({ item, products, metrics, fxRate, onChange, onRemove }: Props) {
  const [freightOpen, setFreightOpen] = useState(false)
  const product = products.find(p => p.id === item.productId)

  const set = <K extends keyof LineItemType>(k: K, v: LineItemType[K]) =>
    onChange({ ...item, [k]: v })

  const handleProductChange = (productId: string) => {
    const p = products.find(x => x.id === productId)
    if (!p) return
    const suggested = suggestedSellPrice(p, item.quantity)
    onChange({ ...item, productId, sellPriceUsd: suggested, status: 'paid' })
  }

  const handleQtyChange = (qty: number) => {
    const p = products.find(x => x.id === item.productId)
    const suggested = p ? suggestedSellPrice(p, qty) : item.sellPriceUsd
    onChange({ ...item, quantity: qty, sellPriceUsd: item.status === 'free' ? 0 : suggested })
  }

  const freight = item.freight
  const freightBreakdown = freight && product
    ? calcFreight(freight, item.quantity)
    : null

  return (
    <>
      {/* Main row */}
      <tr className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${metrics?.belowFloor ? 'bg-red-50' : ''}`}>

        {/* Product */}
        <td className="px-3 py-2.5 min-w-[160px]">
          <select value={item.productId} onChange={e => handleProductChange(e.target.value)}
            className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-h-[36px]">
            <option value="">— Select —</option>
            {products.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {product && (
            <p className="text-[11px] text-slate-400 mt-0.5 px-1">{product.category}</p>
          )}
        </td>

        {/* Qty */}
        <td className="px-2 py-2.5 w-20">
          <input type="number" min="1" value={item.quantity}
            onChange={e => handleQtyChange(parseInt(e.target.value) || 1)}
            className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 text-center min-h-[36px]" />
        </td>

        {/* Status */}
        <td className="px-2 py-2.5 w-32">
          <select value={item.status} onChange={e => set('status', e.target.value as LineItemType['status'])}
            className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-h-[36px]">
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </td>

        {/* Sell price */}
        <td className="px-2 py-2.5 w-32">
          {item.status === 'free' ? (
            <span className="text-sm text-slate-400 italic px-2">Free</span>
          ) : (
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
              <input type="number" min="0" step="0.01" value={item.sellPriceUsd}
                onChange={e => set('sellPriceUsd', parseFloat(e.target.value) || 0)}
                className="w-full pl-5 pr-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[36px]" />
            </div>
          )}
          {product && item.status !== 'free' && (
            <p className="text-[10px] text-slate-400 mt-0.5 px-1">
              Floor: ${product.floorSellPrice.toFixed(2)}
            </p>
          )}
        </td>

        {/* Line total */}
        <td className="px-2 py-2.5 w-28 text-right">
          <span className="text-sm text-slate-700 font-medium">
            {metrics ? fmt(metrics.sellPriceUsd) : '—'}
          </span>
          {fxRate && metrics && (
            <p className="text-[10px] text-slate-400">
              A{fmt(metrics.sellAud)}
            </p>
          )}
        </td>

        {/* Margin */}
        <td className="px-2 py-2.5 w-28 text-right">
          {metrics ? (
            <>
              <span className={`text-sm ${marginColor(metrics.marginPercent, metrics.belowFloor)}`}>
                {metrics.marginPercent === -Infinity ? 'N/A' : `${metrics.marginPercent.toFixed(1)}%`}
              </span>
              <p className="text-[10px] text-slate-400">{fmt(metrics.marginUsd)}</p>
              {metrics.belowFloor && (
                <p className="text-[10px] text-red-500 font-semibold">⚠ Below floor</p>
              )}
            </>
          ) : '—'}
        </td>

        {/* Status badge */}
        <td className="px-2 py-2.5 w-24 text-center">
          <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_COLORS[item.status]}`}>
            {STATUS_LABELS[item.status]}
          </span>
        </td>

        {/* Freight toggle + Remove */}
        <td className="px-2 py-2.5 w-20 text-right">
          <div className="flex items-center justify-end gap-1">
            <button type="button" onClick={() => setFreightOpen(v => !v)} title="Freight"
              className={`p-1.5 rounded-lg transition-colors ${freightOpen ? 'bg-blue-100 text-blue-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}>
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/>
                <path d="M3 4h13l1.5 5H1.5L3 4zM1 2h2l.5 2H17l2 6H2L1 2z"/>
              </svg>
            </button>
            <button type="button" onClick={onRemove}
              className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
        </td>
      </tr>

      {/* Freight expander */}
      {freightOpen && (
        <tr className="bg-slate-50 border-b border-slate-100">
          <td colSpan={8} className="px-4 py-3">
            <FreightEditor
              freight={item.freight}
              breakdown={freightBreakdown}
              onChange={f => set('freight', f)}
            />
          </td>
        </tr>
      )}
    </>
  )
}

// ── Freight editor (inline) ───────────────────────────────────────────────────

import type { FreightConfig } from '../../types'
import type { FreightBreakdown } from '../../engine/freight'

function FreightEditor({
  freight,
  breakdown,
  onChange,
}: {
  freight: FreightConfig | undefined
  qty?: number
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
          {/* Method selector */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-slate-400">Method</label>
            <select value={f.method} onChange={e => set('method', e.target.value as FreightMethod)}
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[36px]">
              <option value="ocean">Ocean</option>
              <option value="air">Air</option>
              <option value="mixed">Mixed</option>
            </select>
          </div>

          {/* Ocean cost */}
          {(f.method === 'ocean' || f.method === 'mixed') && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-400">Ocean $/unit</label>
              <input type="number" min="0" step="0.01" value={f.oceanCostPerUnit ?? ''}
                onChange={e => set('oceanCostPerUnit', parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                className="w-28 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[36px]" />
            </div>
          )}

          {/* Air cost */}
          {(f.method === 'air' || f.method === 'mixed') && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-400">Air $/unit</label>
              <input type="number" min="0" step="0.01" value={f.airCostPerUnit ?? ''}
                onChange={e => set('airCostPerUnit', parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                className="w-28 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[36px]" />
            </div>
          )}

          {/* Mixed qty split */}
          {f.method === 'mixed' && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-slate-400">Ocean units</label>
                <input type="number" min="0" value={f.oceanQty ?? ''}
                  onChange={e => set('oceanQty', parseInt(e.target.value) || 0)}
                  className="w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[36px]" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-slate-400">Air units</label>
                <input type="number" min="0" value={f.airQty ?? ''}
                  onChange={e => set('airQty', parseInt(e.target.value) || 0)}
                  className="w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[36px]" />
              </div>
            </>
          )}

          {/* Breakdown summary */}
          {breakdown && (
            <div className="flex flex-col gap-0.5 ml-2 self-end pb-1">
              <p className="text-xs font-semibold text-slate-600">
                Total freight: ${breakdown.totalCost.toFixed(2)}
              </p>
              <p className="text-[11px] text-slate-400">
                ${breakdown.blendedCostPerUnit.toFixed(2)}/unit blended
                {breakdown.method === 'mixed' && ` (${breakdown.oceanQty} ocean / ${breakdown.airQty} air)`}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
