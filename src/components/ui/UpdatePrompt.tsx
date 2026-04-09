import { useRegisterSW } from 'virtual:pwa-register/react'
import { useEffect } from 'react'

/**
 * Registers the service worker and automatically reloads the page
 * when a new version is available (intervalMS check every 60 s).
 * No UI shown — silent auto-update on next SW activation.
 */
export default function UpdatePrompt() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(swUrl, r) {
      if (!r) return
      // Poll for updates every 60 seconds
      setInterval(async () => {
        if (r.installing) return
        if ('connection' in navigator && !navigator.onLine) return
        try {
          const resp = await fetch(swUrl, { cache: 'no-store', headers: { 'cache': 'no-store' } })
          if (resp?.status === 200) await r.update()
        } catch { /* network unavailable */ }
      }, 60_000)
    },
  })

  useEffect(() => {
    if (needRefresh) {
      // New SW is waiting — tell it to take control, then reload
      updateServiceWorker(true)
    }
  }, [needRefresh])

  return null
}
