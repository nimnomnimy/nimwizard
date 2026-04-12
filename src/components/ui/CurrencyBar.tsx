/**
 * CurrencyBar — USD / AUD / BOTH toggle + FX rate input.
 * - USD mode: shows "1 USD = x AUD", user enters x
 * - AUD mode: shows "1 AUD = y USD", user enters y
 * - BOTH mode: no FX input shown (uses existing rate)
 */
import { useState, useEffect } from 'react'
import { useCurrency } from '../../store/useCurrency'
import type { CurrencyMode } from '../../store/useCurrency'

interface Props {
  className?: string
  onFxChange?: (usdToAudRate: number) => void
}

const MODES: { value: CurrencyMode; label: string }[] = [
  { value: 'USD',  label: 'USD' },
  { value: 'AUD',  label: 'AUD' },
]

export default function CurrencyBar({ className = '', onFxChange }: Props) {
  const currency        = useCurrency(s => s.currency)
  const setCurrency     = useCurrency(s => s.setCurrency)
  const setFxRate       = useCurrency(s => s.setFxRate)
  const displayedFxRate = useCurrency(s => s.displayedFxRate)
  const fxLabel         = useCurrency(s => s.fxLabel)
  const usdToAudRate    = useCurrency(s => s.usdToAudRate)

  const [fxInput, setFxInput] = useState(() => displayedFxRate().toFixed(4))

  // Sync local input when mode changes
  useEffect(() => {
    // BOTH mode always shows 1 USD = x AUD (same direction as USD mode)
    setFxInput(currency === 'BOTH' ? usdToAudRate.toFixed(4) : displayedFxRate().toFixed(4))
  }, [currency]) // eslint-disable-line react-hooks/exhaustive-deps

  function commitFx(val: string) {
    const n = parseFloat(val)
    if (n > 0) {
      setFxRate(n)  // store handles direction: AUD→1/n, USD/BOTH→n directly
      const stored = currency === 'AUD' ? 1 / n : n
      onFxChange?.(stored)
    }
    setFxInput(currency === 'BOTH' ? usdToAudRate.toFixed(4) : displayedFxRate().toFixed(4))
  }

  // When mode changes, also notify parent of the stored rate (in case it wasn't saved yet)
  function handleSetCurrency(mode: CurrencyMode) {
    setCurrency(mode)
    onFxChange?.(usdToAudRate)
  }

  // In BOTH mode show "1 USD = x AUD" (same as USD mode direction)
  const bothLabel = `1 USD =`
  const bothSuffix = 'AUD'

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Mode toggle */}
      <div className="flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5">
        {MODES.map(m => (
          <button
            key={m.value}
            onClick={() => handleSetCurrency(m.value)}
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

      {/* FX rate — always shown, label/suffix adapts to mode */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-bold text-slate-500 flex-shrink-0">
          {currency === 'BOTH' ? bothLabel : fxLabel()}
        </span>
        <input
          type="number"
          min="0.0001"
          step="0.0001"
          value={fxInput}
          onChange={e => setFxInput(e.target.value)}
          onBlur={e => commitFx(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commitFx(fxInput) }}
          className="w-20 px-2 py-1 border border-blue-300 bg-blue-50 text-blue-700 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          title="FX rate"
        />
        <span className="text-[10px] font-bold text-slate-400 flex-shrink-0">
          {currency === 'BOTH' ? bothSuffix : (currency === 'AUD' ? 'USD' : 'AUD')}
        </span>
      </div>
    </div>
  )
}
