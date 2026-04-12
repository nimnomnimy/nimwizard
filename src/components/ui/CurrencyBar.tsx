/**
 * CurrencyBar — USD / AUD / BOTH toggle + FX rate input with direction toggle.
 * Drop into any page header. Reads/writes useCurrency store (persisted).
 */
import { useState, useEffect } from 'react'
import { useCurrency } from '../../store/useCurrency'
import type { CurrencyMode, FxDirection } from '../../store/useCurrency'

interface Props {
  className?: string
}

const MODES: { value: CurrencyMode; label: string }[] = [
  { value: 'USD',  label: 'USD' },
  { value: 'AUD',  label: 'AUD' },
  { value: 'BOTH', label: 'Both' },
]

export default function CurrencyBar({ className = '' }: Props) {
  const currency       = useCurrency(s => s.currency)
  const fxDirection    = useCurrency(s => s.fxDirection)
  const setFxRate      = useCurrency(s => s.setFxRate)
  const setCurrency    = useCurrency(s => s.setCurrency)
  const setFxDirection = useCurrency(s => s.setFxDirection)
  const displayedFxRate = useCurrency(s => s.displayedFxRate)

  const [fxInput, setFxInput] = useState(displayedFxRate().toFixed(4))

  // Sync input when direction changes (e.g. 1.58 ↔ 0.6329)
  useEffect(() => {
    setFxInput(displayedFxRate().toFixed(4))
  }, [fxDirection]) // eslint-disable-line react-hooks/exhaustive-deps

  function commitFx(val: string) {
    const n = parseFloat(val)
    if (n > 0) setFxRate(n)
    setFxInput(displayedFxRate().toFixed(4))
  }

  function toggleDirection() {
    const next: FxDirection = fxDirection === 'usdToAud' ? 'audToUsd' : 'usdToAud'
    setFxDirection(next)
    // Input will update via useEffect above
  }

  const showAud = currency === 'AUD' || currency === 'BOTH'
  const dirLabel = fxDirection === 'usdToAud' ? '1 USD =' : '1 AUD ='

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Mode toggle */}
      <div className="flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5">
        {MODES.map(m => (
          <button
            key={m.value}
            onClick={() => setCurrency(m.value)}
            className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${
              currency === m.value
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* FX direction + rate */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={toggleDirection}
          title="Toggle FX direction"
          className={`text-[10px] font-bold px-1.5 py-1 rounded-md transition-colors flex-shrink-0 ${
            showAud
              ? 'bg-blue-100 text-blue-600 hover:bg-blue-200'
              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
          }`}
        >
          {dirLabel}
        </button>
        <input
          type="number"
          min="0.0001"
          step="0.0001"
          value={fxInput}
          onChange={e => setFxInput(e.target.value)}
          onBlur={e => commitFx(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commitFx(fxInput) }}
          className={`w-20 px-2 py-1 border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
            showAud
              ? 'border-blue-300 bg-blue-50 text-blue-700'
              : 'border-slate-200 text-slate-400'
          }`}
          title={fxDirection === 'usdToAud' ? '1 USD = x AUD' : '1 AUD = x USD'}
        />
      </div>
    </div>
  )
}
