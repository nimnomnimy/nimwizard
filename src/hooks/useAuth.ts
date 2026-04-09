import { useEffect, useRef } from 'react'
import { onAuthStateChanged, type Unsubscribe as FirebaseUnsub } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { useAppStore } from '../store/useAppStore'

export function useAuth() {
  const setUid = useAppStore(s => s.setUid)
  const loadUserData = useAppStore(s => s.loadUserData)
  const dataUnsubRef = useRef<FirebaseUnsub | null>(null)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      // Clean up previous data listener
      if (dataUnsubRef.current) {
        dataUnsubRef.current()
        dataUnsubRef.current = null
      }
      setUid(user?.uid ?? null)
      if (user) {
        dataUnsubRef.current = await loadUserData(user.uid)
      }
    })
    return () => {
      unsub()
      if (dataUnsubRef.current) dataUnsubRef.current()
    }
  }, [])
}
