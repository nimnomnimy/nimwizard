/**
 * TimelineViewPage — public read-only timeline viewer.
 *
 * URL format:  /view/<base64(ownerUid:timelineId)>
 *
 * Reads the timeline directly from Firestore using the owner's UID.
 * Requires the Firestore rule:
 *   match /users/{uid}/timelines/{timelineId} {
 *     allow read: if true;   // or use a more restricted rule
 *   }
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { Timeline } from '../types'
import TimelineEditor from '../components/timelines/TimelineEditor'

function decodeToken(token: string): { ownerUid: string; timelineId: string } | null {
  try {
    const decoded = atob(token)
    const [ownerUid, timelineId] = decoded.split(':')
    if (!ownerUid || !timelineId) return null
    return { ownerUid, timelineId }
  } catch {
    return null
  }
}

export default function TimelineViewPage() {
  const { token } = useParams<{ token: string }>()
  const [timeline, setTimeline] = useState<Timeline | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) { setError('Invalid link'); setLoading(false); return }
    const parsed = decodeToken(token)
    if (!parsed) { setError('Invalid link'); setLoading(false); return }
    const { ownerUid, timelineId } = parsed
    getDoc(doc(db, 'users', ownerUid, 'timelines', timelineId))
      .then(snap => {
        if (!snap.exists()) { setError('Timeline not found or no longer shared'); setLoading(false); return }
        setTimeline(snap.data() as Timeline)
        setLoading(false)
      })
      .catch(() => { setError('Could not load timeline — check your connection'); setLoading(false) })
  }, [token])

  if (loading) {
    return (
      <div className="min-h-dvh bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !timeline) {
    return (
      <div className="min-h-dvh bg-slate-900 flex flex-col items-center justify-center gap-4">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" className="text-slate-600">
          <circle cx="20" cy="20" r="18" stroke="currentColor" strokeWidth="2"/>
          <path d="M20 12v10M20 26v2" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
        </svg>
        <p className="text-slate-400 text-sm">{error ?? 'Something went wrong'}</p>
        <a href="/" className="text-blue-400 text-xs hover:underline">Go to NimWizard</a>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-dvh bg-slate-100 overflow-hidden">
      {/* Read-only banner */}
      <div className="bg-slate-900 text-white flex items-center justify-between px-4 flex-shrink-0" style={{ minHeight: 44 }}>
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 bg-blue-500 rounded flex items-center justify-center flex-shrink-0">
            <svg width="11" height="11" viewBox="0 0 28 28" fill="none">
              <rect x="3" y="3" width="9" height="9" rx="2" fill="white"/>
              <rect x="16" y="3" width="9" height="9" rx="2" fill="white" opacity=".7"/>
              <rect x="3" y="16" width="9" height="9" rx="2" fill="white" opacity=".7"/>
              <rect x="16" y="16" width="9" height="9" rx="2" fill="white" opacity=".4"/>
            </svg>
          </div>
          <span className="text-sm font-bold text-white/90">{timeline.name}</span>
        </div>
        <span className="text-xs font-semibold text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 rounded-full">
          View only
        </span>
      </div>

      {/* Timeline — read-only: onChange is a no-op */}
      <div className="flex-1 min-h-0 pointer-events-none select-none">
        <TimelineEditor
          timeline={timeline}
          onChange={() => {/* read-only */}}
        />
      </div>
    </div>
  )
}
