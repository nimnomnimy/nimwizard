import { useRegisterSW } from 'virtual:pwa-register/react'
import { useEffect } from 'react'

/**
 * Registers the service worker. When a new version is available the browser
 * fires the update event automatically (on navigation / page focus) — no
 * polling needed. We just listen and reload.
 */
export default function UpdatePrompt() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW()

  useEffect(() => {
    if (needRefresh) {
      updateServiceWorker(true)
    }
  }, [needRefresh])

  return null
}
