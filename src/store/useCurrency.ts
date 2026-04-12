/**
 * useCurrency — shared store for currency display preferences.
 * Persisted to localStorage so FX rate + mode survive page reload.
 *
 * Modes:
 *  'USD'  — show only USD
 *  'AUD'  — show only AUD (converted at fxRate)
 *  'BOTH' — show USD primary, AUD secondary below it
 *
 * FX Direction:
 *  'usdToAud' — entered rate means 1 USD = x AUD  (e.g. 1.58)
 *  'audToUsd' — entered rate means 1 AUD = x USD  (e.g. 0.6329)
 *  Internally the store always keeps usdToAudRate for conversions.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type CurrencyMode  = 'USD' | 'AUD' | 'BOTH'
export type FxDirection   = 'usdToAud' | 'audToUsd'

const DEFAULT_FX_USD_TO_AUD = 1.58

interface CurrencyState {
  currency:    CurrencyMode
  fxDirection: FxDirection
  /** Always stored as USD→AUD regardless of direction displayed */
  usdToAudRate: number

  setCurrency:    (c: CurrencyMode) => void
  setFxRate:      (displayedRate: number) => void
  setFxDirection: (d: FxDirection) => void

  /** The number shown in the FX input field (respects direction) */
  displayedFxRate: () => number

  /** Format a USD amount in the primary display currency */
  fmt: (usd: number, decimals?: number) => string
  /** Always format as AUD */
  fmtAud: (usd: number, decimals?: number) => string
  /** Always format as USD */
  fmtUsd: (usd: number, decimals?: number) => string

  /** True when the secondary AUD line should be shown */
  showSecondary: boolean

  /**
   * Convert an input value (in the displayed input currency) to USD.
   * When display mode is AUD (or BOTH), inputs are AUD → divide by usdToAudRate.
   * When display mode is USD, inputs are already USD.
   */
  inputToUsd: (value: number) => number

  /**
   * Convert a stored USD value to the displayed input currency.
   * Inverse of inputToUsd.
   */
  usdToInput: (usd: number) => number

  /** Label for price input fields: '$' or 'A$' */
  inputCurrencySymbol: () => string
}

export const useCurrency = create<CurrencyState>()(
  persist(
    (set, get) => ({
      currency:     'USD',
      fxDirection:  'usdToAud',
      usdToAudRate: DEFAULT_FX_USD_TO_AUD,
      showSecondary: false,

      setCurrency: (currency) => set({ currency, showSecondary: currency === 'BOTH' }),

      setFxRate: (displayedRate) => {
        const { fxDirection } = get()
        if (displayedRate <= 0) return
        const usdToAudRate = fxDirection === 'usdToAud'
          ? displayedRate
          : 1 / displayedRate
        set({ usdToAudRate })
      },

      setFxDirection: (fxDirection) => set({ fxDirection }),

      displayedFxRate: () => {
        const { usdToAudRate, fxDirection } = get()
        return fxDirection === 'usdToAud' ? usdToAudRate : 1 / usdToAudRate
      },

      fmt: (usd, decimals = 2) => {
        const { currency, usdToAudRate } = get()
        if (currency === 'AUD') {
          return `A$${(usd * usdToAudRate).toLocaleString('en-AU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
        }
        return `$${usd.toLocaleString('en-AU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
      },

      fmtAud: (usd, decimals = 2) => {
        const { usdToAudRate } = get()
        return `A$${(usd * usdToAudRate).toLocaleString('en-AU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
      },

      fmtUsd: (usd, decimals = 2) =>
        `$${usd.toLocaleString('en-AU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`,

      inputToUsd: (value) => {
        const { currency, usdToAudRate } = get()
        if (currency === 'AUD') return value / usdToAudRate
        return value // USD or BOTH — inputs are in USD
      },

      usdToInput: (usd) => {
        const { currency, usdToAudRate } = get()
        if (currency === 'AUD') return usd * usdToAudRate
        return usd
      },

      inputCurrencySymbol: () => {
        const { currency } = get()
        return currency === 'AUD' ? 'A$' : '$'
      },
    }),
    {
      name: 'nimwizard-currency',
      // Only persist the settings, not the computed functions
      partialize: (s) => ({
        currency:     s.currency,
        fxDirection:  s.fxDirection,
        usdToAudRate: s.usdToAudRate,
        showSecondary: s.showSecondary,
      }),
    }
  )
)
