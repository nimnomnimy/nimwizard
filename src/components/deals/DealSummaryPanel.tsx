import type { DealMetrics } from '../../types'

const fmt = (n: number, decimals = 2) =>
  `$${n.toLocaleString('en-AU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`

const pct = (n: number) => `${n.toFixed(1)}%`

interface Props {
  metrics: DealMetrics
  fxRate?: number
}

export default function DealSummaryPanel({ metrics }: Props) {
  const budgetUsedPct = metrics.discountBudgetUsed + (metrics.discountBudgetUsed + metrics.discountBudgetRemaining) > 0
    ? (metrics.discountBudgetUsed / (metrics.discountBudgetUsed + metrics.discountBudgetRemaining)) * 100
    : 0

  const marginColor =
    metrics.totalMarginPercent >= 20 ? 'text-green-600' :
    metrics.totalMarginPercent >= 10 ? 'text-amber-600' :
    'text-red-500'

  return (
    <div className="flex flex-col gap-3">

      {/* Floor violation alert */}
      {metrics.hasFloorViolation && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 flex items-start gap-2">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" className="text-red-500 flex-shrink-0 mt-0.5">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
          </svg>
          <div>
            <p className="text-xs font-bold text-red-700">Floor Price Violation</p>
            <p className="text-xs text-red-600 mt-0.5">
              {metrics.violatingLineIds.length} line{metrics.violatingLineIds.length > 1 ? 's' : ''} below approved floor price.
              Run optimizer to fix.
            </p>
          </div>
        </div>
      )}

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 gap-2">
        <MetricTile label="Total Sell" value={fmt(metrics.totalSellUsd)} sub={`A${fmt(metrics.totalSellAud)}`} />
        <MetricTile label="Total Cost" value={fmt(metrics.totalCostUsd)} sub={`A${fmt(metrics.totalCostAud)}`} />
        <MetricTile label="Margin $" value={fmt(metrics.totalMarginUsd)} valueClass={marginColor} />
        <MetricTile label="Margin %" value={pct(metrics.totalMarginPercent)} valueClass={marginColor} />
      </div>

      {/* Value to customer */}
      <div className="bg-slate-50 rounded-xl p-3 flex flex-col gap-2">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Customer Value</p>
        <Row label="List Value" value={fmt(metrics.totalListValueUsd)} />
        <Row label="Customer Pays" value={fmt(metrics.totalSellUsd)} />
        <Row label="Discounts Given" value={fmt(metrics.totalDiscountUsd)} valueClass="text-amber-600" />
        <Row label="Free Items (Cost)" value={fmt(metrics.totalFreeValueUsd)} valueClass="text-purple-600" />
        <div className="border-t border-slate-200 pt-2 mt-1">
          <Row label="Perceived Savings" value={pct(metrics.perceivedSavingsPercent)} valueClass="text-blue-600 font-bold" />
        </div>
      </div>

      {/* Freight */}
      {metrics.totalFreightUsd > 0 && (
        <div className="bg-slate-50 rounded-xl p-3">
          <Row label="Total Freight" value={fmt(metrics.totalFreightUsd)} />
        </div>
      )}

      {/* Discount budget */}
      {(metrics.discountBudgetUsed + metrics.discountBudgetRemaining) > 0 && (
        <div className="bg-slate-50 rounded-xl p-3 flex flex-col gap-2">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Discount Budget</p>
          <div className="flex justify-between text-xs text-slate-600">
            <span>Used: <span className="font-semibold">{fmt(metrics.discountBudgetUsed)}</span></span>
            <span>Remaining: <span className="font-semibold text-green-600">{fmt(metrics.discountBudgetRemaining)}</span></span>
          </div>
          {/* Progress bar */}
          <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${budgetUsedPct > 100 ? 'bg-red-500' : budgetUsedPct > 80 ? 'bg-amber-500' : 'bg-green-500'}`}
              style={{ width: `${Math.min(100, budgetUsedPct).toFixed(1)}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-400 text-right">{budgetUsedPct.toFixed(0)}% used</p>
        </div>
      )}

      {/* Per-line margin summary */}
      {metrics.lines.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Line Margins</p>
          {metrics.lines.map(l => (
            <div key={l.lineItemId}
              className={`flex justify-between items-center px-2.5 py-1.5 rounded-lg text-xs ${l.belowFloor ? 'bg-red-50 border border-red-200' : 'bg-slate-50'}`}>
              <span className="text-slate-500 truncate max-w-[120px]">{l.lineItemId.slice(0, 8)}…</span>
              <span className={`font-semibold ${l.belowFloor ? 'text-red-600' : l.marginPercent >= 20 ? 'text-green-600' : l.marginPercent >= 10 ? 'text-amber-600' : 'text-red-500'}`}>
                {l.marginPercent === -Infinity ? 'Free' : `${l.marginPercent.toFixed(1)}%`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MetricTile({ label, value, sub, valueClass }: {
  label: string; value: string; sub?: string; valueClass?: string
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col gap-0.5">
      <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide">{label}</p>
      <p className={`text-base font-bold text-slate-900 ${valueClass ?? ''}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
    </div>
  )
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-xs font-semibold text-slate-700 ${valueClass ?? ''}`}>{value}</span>
    </div>
  )
}
