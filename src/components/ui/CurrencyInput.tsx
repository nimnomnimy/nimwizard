/**
 * CurrencyInput — a price input that respects the active currency mode.
 *
 * - Value is always stored/returned in USD internally.
 * - Displays and accepts input in the active currency (USD or AUD depending on mode).
 * - When currency mode is BOTH, inputs are in USD (AUD is display-only).
 * - Symbol prefix ($ or A$) reflects the active input currency.
 */
import { useState, useEffect } from 'react'
import { useCurrency } from '../../store/useCurrency'

interface Props {
  /** Stored value in USD */
  valueUsd: number
  /** Called with the new value in USD */
  onChange: (usd: number) => void
  label?: string
  placeholder?: string
  className?: string
  inputClassName?: string
  min?: number
  step?: number
  disabled?: boolean
}

export default function CurrencyInput({
  valueUsd,
  onChange,
  label,
  placeholder = '0.00',
  className = '',
  inputClassName = '',
  min = 0,
  step = 0.01,
  disabled = false,
}: Props) {
  const usdToInput         = useCurrency(s => s.usdToInput)
  const inputToUsd         = useCurrency(s => s.inputToUsd)
  const inputCurrencySymbol = useCurrency(s => s.inputCurrencySymbol)
  const currency           = useCurrency(s => s.currency)

  const symbol = inputCurrencySymbol()

  // Local display value — kept in the active input currency
  const [displayVal, setDisplayVal] = useState(() =>
    valueUsd === 0 ? '' : usdToInput(valueUsd).toFixed(2)
  )

  // When currency mode changes, re-derive display value from stored USD
  useEffect(() => {
    if (valueUsd === 0) {
      setDisplayVal('')
    } else {
      setDisplayVal(usdToInput(valueUsd).toFixed(2))
    }
  }, [currency]) // eslint-disable-line react-hooks/exhaustive-deps

  // When the parent USD value changes externally, update display
  useEffect(() => {
    setDisplayVal(valueUsd === 0 ? '' : usdToInput(valueUsd).toFixed(2))
  }, [valueUsd]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleChange(raw: string) {
    setDisplayVal(raw)
    const n = parseFloat(raw)
    if (!isNaN(n) && n >= 0) {
      onChange(inputToUsd(n))
    } else if (raw === '' || raw === '-') {
      onChange(0)
    }
  }

  function handleBlur() {
    const n = parseFloat(displayVal)
    if (!isNaN(n) && n >= 0) {
      setDisplayVal(n.toFixed(2))
      onChange(inputToUsd(n))
    } else {
      setDisplayVal('')
      onChange(0)
    }
  }

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <label className="text-[11px] font-semibold text-slate-400">
          {label} <span className="text-slate-300 font-normal">({symbol === 'A$' ? 'AUD' : 'USD'})</span>
        </label>
      )}
      <div className="relative">
        <span className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-medium ${symbol === 'A$' ? 'text-blue-400' : 'text-slate-400'}`}>
          {symbol}
        </span>
        <input
          type="number"
          min={min}
          step={step}
          value={displayVal}
          placeholder={placeholder}
          disabled={disabled}
          onChange={e => handleChange(e.target.value)}
          onBlur={handleBlur}
          className={`w-full pl-8 pr-2 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] bg-white disabled:opacity-50 ${
            symbol === 'A$' ? 'border-blue-200' : 'border-slate-200'
          } ${inputClassName}`}
        />
      </div>
    </div>
  )
}
