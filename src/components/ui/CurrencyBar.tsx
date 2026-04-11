/**
 * CurrencyBar — USD / AUD / BOTH toggle + FX rate input.
 * Drop into any page header. Reads/writes useCurrency store.
 */
import { useState, useEffect } from 'react'
import { useCurrency } from '../../store/useCurrency'
import type { CurrencyMode } from '../../store/useCurrency'

interface Props {
  className?: string
}

const MODES: { value: CurrencyMode; label: string }[] = [
  { value: 'USD',  label: 'USD' },
  { value: 'AUD',  label: 'AUD' },
  { value: 'BOTH', label: 'Both' },
]

export default function CurrencyBar({ className = '' }: Props) {
  const currency    = useCurrency(s => s.currency)
  const fxRate      = useCurrency(s => s.fxRate)
  const setFxRate   = useCurrency(s => s.setFxRate)
  const setCurrency = useCurrency(s => s.setCurrency)

  const [fxInput, setFxInput] = useState(fxRate.toFixed(4))

  useEffect(() => { setFxInput(fxRate.toFixed(4)) }, [fxRate])

  function commitFx(val: string) {
    const n = parseFloat(val)
    if (n > 0) setFxRate(n)
    else setFxInput(fxRate.toFixed(4))
  }

  const showAud = currency === 'AUD' || currency === 'BOTH'

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

      {/* FX rate — highlighted when AUD is involved */}
      <label className="flex items-center gap-1 text-xs text-slate-500">
        <span className="hidden sm:inline text-slate-400">FX</span>
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
          title="USD → AUD exchange rate"
        />
      </label>
    </div>
  )
}
