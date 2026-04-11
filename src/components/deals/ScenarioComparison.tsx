import type { Deal, DealProduct, DealScenario, DealMetrics } from '../../types'
import { calcDealMetrics } from '../../engine/metrics'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

const fmt  = (n: number) => `$${n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
const pct  = (n: number) => `${n.toFixed(1)}%`

interface ScenarioMetrics { label: string; metrics: DealMetrics }

interface Props {
  deal: Deal
  products: DealProduct[]
  onClose: () => void
}

export default function ScenarioComparison({ deal, products, onClose }: Props) {
  // Build scenario list: always include the "Live" deal, then named scenarios
  const scenarioMetrics: ScenarioMetrics[] = [
    {
      label: 'Live Deal',
      metrics: calcDealMetrics(deal, products),
    },
    ...deal.scenarios.map(s => ({
      label: s.label,
      metrics: calcDealMetrics(
        { ...deal, lineItems: s.lineItems, discountRules: s.discountRules, discountBudgetUsd: s.discountBudgetUsd },
        products,
      ),
    })),
  ]

  // Chart data
  const chartData = [
    {
      name: 'Total Sell',
      ...Object.fromEntries(scenarioMetrics.map(s => [s.label, s.metrics.totalSellUsd])),
    },
    {
      name: 'Margin $',
      ...Object.fromEntries(scenarioMetrics.map(s => [s.label, s.metrics.totalMarginUsd])),
    },
    {
      name: 'Discounts',
      ...Object.fromEntries(scenarioMetrics.map(s => [s.label, s.metrics.totalDiscountUsd])),
    },
    {
      name: 'List Value',
      ...Object.fromEntries(scenarioMetrics.map(s => [s.label, s.metrics.totalListValueUsd])),
    },
  ]

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444']

  const METRICS_ROWS: { label: string; fn: (m: DealMetrics) => string; highlight?: (m: DealMetrics) => string }[] = [
    { label: 'Total Sell (USD)',       fn: m => fmt(m.totalSellUsd) },
    { label: 'Total Cost (USD)',       fn: m => fmt(m.totalCostUsd) },
    { label: 'Total Freight (USD)',    fn: m => fmt(m.totalFreightUsd) },
    { label: 'Margin $',              fn: m => fmt(m.totalMarginUsd),       highlight: m => m.totalMarginUsd < 0 ? 'text-red-600' : 'text-green-600' },
    { label: 'Margin %',              fn: m => pct(m.totalMarginPercent),   highlight: m => m.totalMarginPercent < 10 ? 'text-red-600' : m.totalMarginPercent >= 20 ? 'text-green-600' : 'text-amber-600' },
    { label: 'List Value',            fn: m => fmt(m.totalListValueUsd) },
    { label: 'Discounts Given',       fn: m => fmt(m.totalDiscountUsd) },
    { label: 'Free Items (Cost)',      fn: m => fmt(m.totalFreeValueUsd) },
    { label: 'Perceived Savings',     fn: m => pct(m.perceivedSavingsPercent), highlight: m => m.perceivedSavingsPercent >= 15 ? 'text-blue-600' : '' },
    { label: 'Budget Used',           fn: m => fmt(m.discountBudgetUsed) },
    { label: 'Budget Remaining',      fn: m => fmt(m.discountBudgetRemaining), highlight: m => m.discountBudgetRemaining < 0 ? 'text-red-600' : 'text-green-600' },
    { label: 'Floor Violations',      fn: m => m.hasFloorViolation ? `⚠ ${m.violatingLineIds.length}` : '✓ None', highlight: m => m.hasFloorViolation ? 'text-red-600 font-bold' : 'text-green-600' },
  ]

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-900">Scenario Comparison</h2>
            <p className="text-xs text-slate-400 mt-0.5">{scenarioMetrics.length} scenarios</p>
          </div>
          <button onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-2 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M2 2l14 14M16 2L2 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-6">

          {scenarioMetrics.length <= 1 && (
            <div className="text-center py-10 text-slate-400">
              <p className="font-semibold text-slate-600">No scenarios created yet</p>
              <p className="text-sm mt-1">Add scenarios in the Deal Builder to compare them here.</p>
            </div>
          )}

          {scenarioMetrics.length > 1 && (
            <>
              {/* Bar chart */}
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Revenue & Margin Comparison</p>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {scenarioMetrics.map((s, i) => (
                      <Bar key={s.label} dataKey={s.label} fill={COLORS[i % COLORS.length]} radius={[3, 3, 0, 0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Comparison table */}
              <div className="overflow-x-auto">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Detailed Comparison</p>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left px-3 py-2 text-slate-500 font-semibold w-40">Metric</th>
                      {scenarioMetrics.map((s, i) => (
                        <th key={i} className="text-right px-3 py-2 font-semibold" style={{ color: COLORS[i % COLORS.length] }}>
                          {s.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {METRICS_ROWS.map(row => (
                      <tr key={row.label} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-3 py-2 text-slate-500">{row.label}</td>
                        {scenarioMetrics.map((s, i) => (
                          <td key={i} className={`px-3 py-2 text-right font-medium ${row.highlight ? row.highlight(s.metrics) : 'text-slate-700'}`}>
                            {row.fn(s.metrics)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Best scenario callout */}
              <BestScenarioCallout scenarios={scenarioMetrics} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function BestScenarioCallout({ scenarios }: { scenarios: ScenarioMetrics[] }) {
  if (scenarios.length <= 1) return null

  const bestMargin  = [...scenarios].sort((a, b) => b.metrics.totalMarginUsd - a.metrics.totalMarginUsd)[0]
  const bestValue   = [...scenarios].sort((a, b) => b.metrics.perceivedSavingsPercent - a.metrics.perceivedSavingsPercent)[0]
  const noViolation = scenarios.filter(s => !s.metrics.hasFloorViolation)

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <CalloutTile color="green" title="Best Margin" scenario={bestMargin.label}
        detail={`${fmt(bestMargin.metrics.totalMarginUsd)} (${pct(bestMargin.metrics.totalMarginPercent)})`} />
      <CalloutTile color="blue" title="Best Customer Value" scenario={bestValue.label}
        detail={`${pct(bestValue.metrics.perceivedSavingsPercent)} perceived savings`} />
      <CalloutTile color="purple" title="No Floor Violations"
        scenario={noViolation.length > 0 ? noViolation.map(s => s.label).join(', ') : 'None'}
        detail={noViolation.length > 0 ? `${noViolation.length} scenario${noViolation.length > 1 ? 's' : ''} compliant` : 'All scenarios violate floor pricing'} />
    </div>
  )
}

function CalloutTile({ color, title, scenario, detail }: { color: string; title: string; scenario: string; detail: string }) {
  const palette: Record<string, string> = {
    green:  'bg-green-50 border-green-200',
    blue:   'bg-blue-50 border-blue-200',
    purple: 'bg-purple-50 border-purple-200',
  }
  return (
    <div className={`border rounded-xl p-3 ${palette[color] ?? ''}`}>
      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">{title}</p>
      <p className="text-sm font-bold text-slate-800 mt-0.5">{scenario}</p>
      <p className="text-xs text-slate-500 mt-0.5">{detail}</p>
    </div>
  )
}
