/**
 * CurrencyBar — shared USD/AUD toggle + FX rate input.
 * Drop into any page header. Reads/writes useCurrency store.
 */
import { useState, useEffect } from 'react'
import { useCurrency } from '../../store/useCurrency'

interface Props {
  /** Extra className for the wrapper (optional positioning tweaks) */
  className?: string
}

export default function CurrencyBar({ className = '' }: Props) {
  const currency    = useCurrency(s => s.currency)
  const fxRate      = useCurrency(s => s.fxRate)
  const setFxRate   = useCurrency(s => s.setFxRate)
  const setCurrency = useCurrency(s => s.setCurrency)

  // Local string so the user can type freely without losing cursor position
  const [fxInput, setFxInput] = useState(fxRate.toFixed(4))

  // Keep input in sync if fxRate changes from outside (e.g. deal-level FX)
  useEffect(() => { setFxInput(fxRate.toFixed(4)) }, [fxRate])

  function commitFx(val: string) {
    const n = parseFloat(val)
    if (n > 0) setFxRate(n)
    else setFxInput(fxRate.toFixed(4)) // revert invalid
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* USD / AUD toggle pill */}
      <div className="flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5">
        {(['USD', 'AUD'] as const).map(c => (
          <button
            key={c}
            onClick={() => setCurrency(c)}
            className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${
              currency === c
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* FX rate — only meaningful when AUD is selected, but always editable */}
      <label className="flex items-center gap-1.5 text-xs text-slate-500">
        <span className="hidden sm:inline">FX</span>
        <input
          type="number"
          min="0.0001"
          step="0.0001"
          value={fxInput}
          onChange={e => setFxInput(e.target.value)}
          onBlur={e => commitFx(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commitFx(fxInput) }}
          className={`w-20 px-2 py-1 border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
            currency === 'AUD'
              ? 'border-blue-300 bg-blue-50 text-blue-700'
              : 'border-slate-200 text-slate-500'
          }`}
          title="USD → AUD exchange rate"
        />
      </label>

      {/* Visual indicator of active mode */}
      {currency === 'AUD' && (
        <span className="text-[11px] text-blue-500 font-semibold hidden md:inline">
          ×{fxRate.toFixed(4)}
        </span>
      )}
    </div>
  )
}
