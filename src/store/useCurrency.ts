/**
 * useCurrency — shared store for currency display preferences.
 * Persisted to localStorage (fast) and synced to Firestore (persistent across devices).
 *
 * Modes:
 *  'USD'  — inputs are in USD, totals show $. FX label: "1 USD = x AUD"
 *  'AUD'  — inputs are in AUD, totals show A$. FX label: "1 AUD = y USD"
 *  'BOTH' — show USD primary, AUD secondary below it
 *
 * Internally the store always keeps usdToAudRate for conversions.
 * When mode is USD: user enters the AUD equivalent (usdToAudRate directly).
 * When mode is AUD: user enters the USD equivalent (1/usdToAudRate).
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type CurrencyMode = 'USD' | 'AUD' | 'BOTH'

const DEFAULT_FX_USD_TO_AUD = 1.58

interface CurrencyState {
  currency:    CurrencyMode
  /** Always stored as USD→AUD regardless of display direction */
  usdToAudRate: number

  setCurrency:    (c: CurrencyMode) => void
  /** Set rate from the UI input (direction depends on current mode) */
  setFxRate:      (displayedRate: number) => void
  /** Set rate directly from Firestore (always usdToAudRate) */
  setFxRateDirect: (rate: number) => void

  /** The number shown in the FX input field (respects current mode) */
  displayedFxRate: () => number
  /** Label for the FX input: "1 USD =" or "1 AUD =" */
  fxLabel: () => string

  /** Format a USD amount in the primary display currency */
  fmt: (usd: number, decimals?: number) => string
  /** Always format as AUD */
  fmtAud: (usd: number, decimals?: number) => string
  /** Always format as USD */
  fmtUsd: (usd: number, decimals?: number) => string

  /** True when the secondary AUD line should be shown (BOTH mode) */
  showSecondary: boolean

  /** Convert an input value (in the active input currency) to USD for storage */
  inputToUsd: (value: number) => number
  /** Convert a stored USD value to the active input currency for display */
  usdToInput: (usd: number) => number

  /** Label for price input fields: '$' or 'A$' */
  inputCurrencySymbol: () => string
}

export const useCurrency = create<CurrencyState>()(
  persist(
    (set, get) => ({
      currency:     'USD',
      usdToAudRate: DEFAULT_FX_USD_TO_AUD,
      showSecondary: false,

      setCurrency: (currency) => set({ currency, showSecondary: currency === 'BOTH' }),

      setFxRate: (displayedRate) => {
        const { currency } = get()
        if (displayedRate <= 0) return
        // USD mode: user entered "1 USD = x AUD" → x is usdToAudRate
        // AUD mode: user entered "1 AUD = y USD" → usdToAudRate = 1/y
        const usdToAudRate = currency === 'AUD'
          ? 1 / displayedRate
          : displayedRate
        set({ usdToAudRate })
      },

      setFxRateDirect: (rate) => {
        if (rate > 0) set({ usdToAudRate: rate })
      },

      displayedFxRate: () => {
        const { usdToAudRate, currency } = get()
        // AUD mode shows "1 AUD = y USD"
        return currency === 'AUD' ? 1 / usdToAudRate : usdToAudRate
      },

      fxLabel: () => {
        const { currency } = get()
        return currency === 'AUD' ? '1 AUD =' : '1 USD ='
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
        return value
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
      partialize: (s) => ({
        currency:     s.currency,
        usdToAudRate: s.usdToAudRate,
        showSecondary: s.showSecondary,
      }),
    }
  )
)
