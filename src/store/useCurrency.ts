/**
 * useCurrency — lightweight shared store for currency display preferences.
 * Not persisted to Firestore (pure UI state, resets on page reload).
 *
 * Used by: DealEnginePage, CustomerConfigsPage, PricebookPage, ContractManagerPage
 */
import { create } from 'zustand'

const DEFAULT_FX = 1.58

interface CurrencyState {
  currency: 'USD' | 'AUD'
  fxRate: number
  setCurrency: (c: 'USD' | 'AUD') => void
  setFxRate: (r: number) => void
  toggle: () => void
  /** Convert a USD amount to the display currency */
  display: (usd: number) => number
  /** Format a USD amount in the display currency with $ prefix */
  fmt: (usd: number, decimals?: number) => string
}

export const useCurrency = create<CurrencyState>((set, get) => ({
  currency: 'USD',
  fxRate: DEFAULT_FX,

  setCurrency: (currency) => set({ currency }),
  setFxRate:   (fxRate)   => set({ fxRate: fxRate > 0 ? fxRate : DEFAULT_FX }),
  toggle: () => set(s => ({ currency: s.currency === 'USD' ? 'AUD' : 'USD' })),

  display: (usd) => {
    const { currency, fxRate } = get()
    return currency === 'AUD' ? usd * fxRate : usd
  },

  fmt: (usd, decimals = 2) => {
    const { currency, fxRate } = get()
    const amount = currency === 'AUD' ? usd * fxRate : usd
    const prefix = currency === 'AUD' ? 'A$' : '$'
    return `${prefix}${amount.toLocaleString('en-AU', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}`
  },
}))
