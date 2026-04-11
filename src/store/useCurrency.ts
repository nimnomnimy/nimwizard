/**
 * useCurrency — lightweight shared store for currency display preferences.
 * Not persisted to Firestore (pure UI state, resets on page reload).
 *
 * Modes:
 *  'USD'  — show only USD
 *  'AUD'  — show only AUD (converted at fxRate)
 *  'BOTH' — show USD primary, AUD secondary below it
 */
import { create } from 'zustand'

export type CurrencyMode = 'USD' | 'AUD' | 'BOTH'

const DEFAULT_FX = 1.58

interface CurrencyState {
  currency: CurrencyMode
  fxRate: number
  setCurrency: (c: CurrencyMode) => void
  setFxRate: (r: number) => void
  /** Format a USD amount in the primary display currency */
  fmt: (usd: number, decimals?: number) => string
  /** Format a USD amount as AUD — always AUD regardless of mode */
  fmtAud: (usd: number, decimals?: number) => string
  /** Format a USD amount as USD — always USD regardless of mode */
  fmtUsd: (usd: number, decimals?: number) => string
  /** True when the secondary AUD line should be shown */
  showSecondary: boolean
}

export const useCurrency = create<CurrencyState>((set, get) => ({
  currency: 'USD',
  fxRate: DEFAULT_FX,
  showSecondary: false,

  setCurrency: (currency) => set({ currency, showSecondary: currency === 'BOTH' }),
  setFxRate:   (fxRate)   => set({ fxRate: fxRate > 0 ? fxRate : DEFAULT_FX }),

  fmt: (usd, decimals = 2) => {
    const { currency, fxRate } = get()
    if (currency === 'AUD') {
      return `A$${(usd * fxRate).toLocaleString('en-AU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
    }
    // USD or BOTH — primary is always USD
    return `$${usd.toLocaleString('en-AU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
  },

  fmtAud: (usd, decimals = 2) => {
    const { fxRate } = get()
    return `A$${(usd * fxRate).toLocaleString('en-AU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
  },

  fmtUsd: (usd, decimals = 2) =>
    `$${usd.toLocaleString('en-AU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`,
}))
