import { useState } from 'react'
import type { Deal, DealProduct, DealMetrics } from '../../types'
import { calcFreight } from '../../engine/freight'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RTooltip,
} from 'recharts'

type ChartTab = 'margin' | 'discount' | 'freight'

const fmt = (n: number) =>
  `$${Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

interface Props {
  deal: Deal
  products: DealProduct[]
  metrics: DealMetrics
}

export default function DealCharts({ deal, products, metrics }: Props) {
  const [tab, setTab] = useState<ChartTab>('margin')
  const productMap    = new Map(products.map(p => [p.id, p]))

  // ── Chart 1: Margin breakdown (stacked bar per line) ──────────────────────
  const marginData = metrics.lines.map((l, i) => {
    const item    = deal.lineItems.find(x => x.id === l.lineItemId)
    const product = item ? productMap.get(item.productId) : undefined
    return {
      name: product?.name ?? `Line ${i + 1}`,
      Cost: parseFloat(l.costUsd.toFixed(2)),
      Freight: parseFloat(l.freightCostUsd.toFixed(2)),
      Margin: parseFloat(Math.max(0, l.marginUsd).toFixed(2)),
      Loss: parseFloat(Math.min(0, l.marginUsd).toFixed(2)),
    }
  })

  // ── Chart 2: Discount allocation pie ─────────────────────────────────────
  const discountPieData = [
    { name: 'Discounts',    value: parseFloat(metrics.totalDiscountUsd.toFixed(2)),   color: '#f59e0b' },
    { name: 'Free Items',   value: parseFloat(metrics.totalFreeValueUsd.toFixed(2)),  color: '#8b5cf6' },
    { name: 'Budget Left',  value: parseFloat(Math.max(0, metrics.discountBudgetRemaining).toFixed(2)), color: '#10b981' },
  ].filter(d => d.value > 0)

  // ── Chart 3: Freight comparison (current vs all-ocean vs all-air) ─────────
  const freightData = deal.lineItems
    .filter(item => item.freight)
    .map((item, i) => {
      const product = productMap.get(item.productId)
      const name    = product?.name ?? `Line ${i + 1}`
      const f       = item.freight!
      const qty     = item.quantity

      const current  = calcFreight(f, qty).totalCost
      const allOcean = (f.oceanCostPerUnit ?? 0) * qty
      const allAir   = (f.airCostPerUnit   ?? 0) * qty

      return {
        name,
        Current: parseFloat(current.toFixed(2)),
        'All Ocean': parseFloat(allOcean.toFixed(2)),
        'All Air':   parseFloat(allAir.toFixed(2)),
      }
    })

  const tabs: { key: ChartTab; label: string }[] = [
    { key: 'margin',   label: 'Margin Breakdown' },
    { key: 'discount', label: 'Discount Allocation' },
    { key: 'freight',  label: 'Freight Comparison' },
  ]

  const hasFreight = freightData.length > 0
  const visibleTabs = tabs.filter(t => t.key !== 'freight' || hasFreight)

  return (
    <div className="flex flex-col gap-3">

      {/* Tab bar */}
      <div className="flex rounded-xl border border-slate-200 overflow-hidden">
        {visibleTabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2 text-xs font-semibold transition-colors ${tab === t.key ? 'bg-slate-700 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Chart 1 — Margin Breakdown */}
      {tab === 'margin' && (
        <div>
          {marginData.length === 0 ? (
            <Empty label="Add line items to see margin breakdown" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={marginData} margin={{ top: 4, right: 4, left: 4, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => fmt(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />
                <Bar dataKey="Cost"    stackId="a" fill="#94a3b8" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Freight" stackId="a" fill="#f97316" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Margin"  stackId="a" fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Loss"    stackId="a" fill="#ef4444" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <div className="flex flex-wrap gap-3 justify-center mt-2">
            <Legend2 color="#94a3b8" label="Cost" />
            <Legend2 color="#f97316" label="Freight" />
            <Legend2 color="#10b981" label="Margin" />
            <Legend2 color="#ef4444" label="Loss" />
          </div>
        </div>
      )}

      {/* Chart 2 — Discount Allocation pie */}
      {tab === 'discount' && (
        <div>
          {discountPieData.length === 0 ? (
            <Empty label="No discounts or free items in this deal" />
          ) : (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="60%" height={200}>
                <PieChart>
                  <Pie
                    data={discountPieData}
                    cx="50%" cy="50%"
                    innerRadius={50} outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {discountPieData.map((d, i) => (
                      <Cell key={i} fill={d.color} />
                    ))}
                  </Pie>
                  <RTooltip formatter={(v) => fmt(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-2">
                {discountPieData.map(d => (
                  <div key={d.name} className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: d.color }} />
                    <div>
                      <p className="text-xs font-semibold text-slate-700">{d.name}</p>
                      <p className="text-xs text-slate-400">{fmt(d.value)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Chart 3 — Freight comparison */}
      {tab === 'freight' && (
        <div>
          {freightData.length === 0 ? (
            <Empty label="No freight configured on any line item" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={freightData} margin={{ top: 4, right: 4, left: 4, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${v.toFixed(0)}`} />
                <Tooltip formatter={(v) => fmt(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />
                <Bar dataKey="Current"    fill="#3b82f6" radius={[3, 3, 0, 0]} />
                <Bar dataKey="All Ocean"  fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="All Air"    fill="#f97316" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </div>
  )
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-40 text-slate-400 text-xs">{label}</div>
  )
}

function Legend2({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
      <span className="text-[11px] text-slate-500">{label}</span>
    </div>
  )
}
