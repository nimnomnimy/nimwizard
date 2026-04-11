import { useState } from 'react'
import type { Deal, DealProduct, OptimizationGoal, OptimizationRecommendation, OptimizationResult } from '../../types'
import { optimizeDeal } from '../../engine/optimization'

const TYPE_LABELS: Record<OptimizationRecommendation['type'], string> = {
  'adjust-sell-price': 'Fix Floor',
  'switch-to-ocean':   'Ocean Freight',
  'switch-to-air':     'Air Freight',
  'give-free-units':   'Give Free Units',
  'apply-discount':    'Apply Discount',
  'reduce-discount':   'Reduce Discount',
}

const TYPE_COLORS: Record<OptimizationRecommendation['type'], string> = {
  'adjust-sell-price': 'bg-red-100 text-red-700',
  'switch-to-ocean':   'bg-blue-100 text-blue-700',
  'switch-to-air':     'bg-sky-100 text-sky-700',
  'give-free-units':   'bg-purple-100 text-purple-700',
  'apply-discount':    'bg-amber-100 text-amber-700',
  'reduce-discount':   'bg-slate-100 text-slate-600',
}

const PRIORITY_DOT: Record<string, string> = {
  high:   'bg-red-500',
  medium: 'bg-amber-400',
  low:    'bg-slate-300',
}

const fmt = (n: number) => `$${Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

interface Props {
  deal: Deal
  products: DealProduct[]
  onApplyRecommendation: (rec: OptimizationRecommendation) => void
  onApplyAll: (result: OptimizationResult) => void
}

export default function OptimizationPanel({ deal, products, onApplyRecommendation, onApplyAll }: Props) {
  const [goal, setGoal]       = useState<OptimizationGoal>('margin')
  const [result, setResult]   = useState<OptimizationResult | null>(null)
  const [applied, setApplied] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const runOptimizer = () => {
    const r = optimizeDeal(deal, products, goal)
    setResult(r)
    setApplied(new Set())
  }

  const handleApply = (rec: OptimizationRecommendation) => {
    onApplyRecommendation(rec)
    setApplied(prev => new Set([...prev, rec.lineItemId + rec.type]))
  }

  const handleApplyAll = () => {
    if (!result) return
    onApplyAll(result)
    setApplied(new Set(result.recommendations.map(r => r.lineItemId + r.type)))
  }

  const toggleExpand = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-3">

      {/* Goal toggle */}
      <div className="flex rounded-xl border border-slate-200 overflow-hidden">
        <button
          onClick={() => { setGoal('margin'); setResult(null) }}
          className={`flex-1 py-2 text-xs font-semibold transition-colors ${goal === 'margin' ? 'bg-blue-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
          Maximise Margin
        </button>
        <button
          onClick={() => { setGoal('perceived-value'); setResult(null) }}
          className={`flex-1 py-2 text-xs font-semibold transition-colors ${goal === 'perceived-value' ? 'bg-blue-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
          Maximise Value
        </button>
      </div>

      {/* Run button */}
      <button onClick={runOptimizer}
        className="w-full py-2.5 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 active:bg-blue-700 transition-colors flex items-center justify-center gap-2">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd"/>
        </svg>
        Optimise Deal
      </button>

      {/* Results */}
      {result && (
        <>
          {/* Summary bar */}
          <div className={`rounded-xl px-3 py-2.5 text-xs ${result.recommendations.length === 0 ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
            {result.summary}
          </div>

          {result.recommendations.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-2">No further improvements found.</p>
          )}

          {result.recommendations.length > 0 && (
            <>
              {/* Apply all */}
              <button onClick={handleApplyAll}
                className="w-full py-2 rounded-xl border border-blue-300 text-blue-600 text-xs font-semibold hover:bg-blue-50 transition-colors">
                Apply All Recommendations
              </button>

              {/* Recommendation cards */}
              <div className="flex flex-col gap-2">
                {result.recommendations.map((rec, idx) => {
                  const key     = rec.lineItemId + rec.type
                  const isApplied  = applied.has(key)
                  const isExpanded = expanded.has(key)

                  return (
                    <div key={idx}
                      className={`border rounded-xl overflow-hidden transition-colors ${isApplied ? 'border-green-200 bg-green-50' : 'border-slate-200 bg-white'}`}>

                      {/* Header row */}
                      <div className="flex items-start gap-2 px-3 py-2.5">
                        {/* Priority dot */}
                        <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOT[rec.priority]}`} />

                        <div className="flex-1 min-w-0">
                          {/* Type badge + description */}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${TYPE_COLORS[rec.type]}`}>
                              {TYPE_LABELS[rec.type]}
                            </span>
                            {rec.priority === 'high' && (
                              <span className="text-[10px] font-bold text-red-600 uppercase tracking-wide">Critical</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-700 mt-1 leading-snug">{rec.description}</p>

                          {/* Impact metrics */}
                          <div className="flex gap-3 mt-1.5">
                            {rec.marginImpactUsd !== 0 && (
                              <span className={`text-[11px] font-semibold ${rec.marginImpactUsd > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                {rec.marginImpactUsd > 0 ? '+' : ''}{fmt(rec.marginImpactUsd)} margin
                              </span>
                            )}
                            {rec.perceivedValueImpactUsd !== 0 && (
                              <span className={`text-[11px] font-semibold ${rec.perceivedValueImpactUsd > 0 ? 'text-blue-600' : 'text-slate-400'}`}>
                                {rec.perceivedValueImpactUsd > 0 ? '+' : ''}{fmt(rec.perceivedValueImpactUsd)} value
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col gap-1 flex-shrink-0">
                          {!isApplied ? (
                            <button onClick={() => handleApply(rec)}
                              className="px-2.5 py-1 rounded-lg bg-blue-500 text-white text-[11px] font-semibold hover:bg-blue-600 transition-colors whitespace-nowrap">
                              Apply
                            </button>
                          ) : (
                            <span className="px-2.5 py-1 rounded-lg bg-green-500 text-white text-[11px] font-semibold whitespace-nowrap">
                              ✓ Applied
                            </span>
                          )}
                          <button onClick={() => toggleExpand(key)}
                            className="px-2.5 py-1 rounded-lg border border-slate-200 text-slate-500 text-[11px] hover:bg-slate-50 transition-colors text-center">
                            {isExpanded ? 'Less' : 'Why?'}
                          </button>
                        </div>
                      </div>

                      {/* Why explanation — expands on demand */}
                      {isExpanded && (
                        <div className="px-3 pb-3 border-t border-slate-100 pt-2.5">
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Why this was recommended</p>
                          <p className="text-xs text-slate-600 leading-relaxed">{rec.why}</p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Projected metrics */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex flex-col gap-1.5">
                <p className="text-xs font-bold text-blue-700 uppercase tracking-wide">Projected (if all applied)</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <ProjectedRow label="Margin $" value={`$${result.projectedMetrics.totalMarginUsd.toFixed(0)}`} />
                  <ProjectedRow label="Margin %" value={`${result.projectedMetrics.totalMarginPercent.toFixed(1)}%`} />
                  <ProjectedRow label="Customer Saves" value={`${result.projectedMetrics.perceivedSavingsPercent.toFixed(1)}%`} />
                  <ProjectedRow label="Floor Violations" value={result.projectedMetrics.hasFloorViolation ? '⚠ Yes' : '✓ None'} />
                </div>
              </div>
            </>
          )}
        </>
      )}

      {!result && (
        <p className="text-xs text-slate-400 text-center py-3 leading-relaxed">
          Click "Optimise Deal" to get AI-powered recommendations for pricing,
          freight strategy, and discount allocation.
        </p>
      )}
    </div>
  )
}

function ProjectedRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-blue-600">{label}</span>
      <span className="text-xs font-bold text-blue-800">{value}</span>
    </div>
  )
}
