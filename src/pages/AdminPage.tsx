import { useEffect, useState } from 'react'
import { collection, getDocs, doc, deleteDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAppStore } from '../store/useAppStore'
import { useNavigate } from 'react-router-dom'
import type { AppState, Contact, Meeting, TaskBucket } from '../types'

const ADMIN_UID = 'gyFefF4RgEZbfFXyHRhW0qWlP1h2'

interface UserRecord {
  uid: string
  contacts: Contact[]
  meetings: Meeting[]
  taskBuckets: TaskBucket[]
  savedCharts: { id: string; name: string }[]
  loadedAt: number
}

function statBadge(label: string, count: number, color: string) {
  return (
    <span key={label} className={`text-xs font-semibold px-2 py-0.5 rounded-full ${color}`}>
      {count} {label}
    </span>
  )
}

export default function AdminPage() {
  const uid = useAppStore(s => s.uid)
  const loading = useAppStore(s => s.loading)
  const navigate = useNavigate()

  const [users, setUsers] = useState<UserRecord[]>([])
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedUid, setExpandedUid] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Guard — only admin can view this page
  useEffect(() => {
    if (!loading && uid && uid !== ADMIN_UID) navigate('/contacts', { replace: true })
    if (!loading && !uid) navigate('/contacts', { replace: true })
  }, [uid, loading, navigate])

  // Load all user docs
  useEffect(() => {
    if (!uid || uid !== ADMIN_UID) return
    setFetching(true)
    getDocs(collection(db, 'users'))
      .then(snap => {
        const records: UserRecord[] = snap.docs.map(d => {
          const data = d.data() as Partial<AppState>
          return {
            uid: d.id,
            contacts: data.contacts ?? [],
            meetings: data.meetings ?? [],
            taskBuckets: data.taskBuckets ?? [],
            savedCharts: data.savedCharts ?? [],
            loadedAt: Date.now(),
          }
        })
        records.sort((a, b) => b.contacts.length - a.contacts.length)
        setUsers(records)
        setFetching(false)
      })
      .catch(e => {
        setError(e.message ?? 'Failed to load users')
        setFetching(false)
      })
  }, [uid])

  const handleDelete = async (targetUid: string) => {
    if (!confirm(`Delete ALL data for user ${targetUid}?\n\nThis cannot be undone.`)) return
    setDeleting(targetUid)
    try {
      await deleteDoc(doc(db, 'users', targetUid))
      setUsers(prev => prev.filter(u => u.uid !== targetUid))
      setExpandedUid(null)
    } catch (e: any) {
      alert('Delete failed: ' + (e.message ?? e))
    }
    setDeleting(null)
  }

  const refresh = () => {
    if (!uid || uid !== ADMIN_UID) return
    setFetching(true)
    getDocs(collection(db, 'users'))
      .then(snap => {
        const records: UserRecord[] = snap.docs.map(d => {
          const data = d.data() as Partial<AppState>
          return {
            uid: d.id,
            contacts: data.contacts ?? [],
            meetings: data.meetings ?? [],
            taskBuckets: data.taskBuckets ?? [],
            savedCharts: data.savedCharts ?? [],
            loadedAt: Date.now(),
          }
        })
        records.sort((a, b) => b.contacts.length - a.contacts.length)
        setUsers(records)
        setFetching(false)
      })
      .catch(e => { setError(e.message); setFetching(false) })
  }

  const filtered = users.filter(u =>
    !search || u.uid.toLowerCase().includes(search.toLowerCase()) ||
    u.contacts.some(c => c.name.toLowerCase().includes(search.toLowerCase()))
  )

  const totalContacts = users.reduce((s, u) => s + u.contacts.length, 0)
  const totalMeetings = users.reduce((s, u) => s + u.meetings.length, 0)
  const totalTasks    = users.reduce((s, u) => s + u.taskBuckets.reduce((a, b) => a + b.tasks.length, 0), 0)

  if (loading || (!uid && !error)) {
    return (
      <div className="min-h-dvh bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (uid !== ADMIN_UID) return null

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100 flex flex-col">

      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/contacts')}
            className="text-slate-400 hover:text-slate-200 p-2 rounded-lg hover:bg-slate-800 transition-colors">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div>
            <h1 className="text-base font-bold text-slate-100">Admin Dashboard</h1>
            <p className="text-xs text-slate-500">NimWizard · All users</p>
          </div>
        </div>
        <button onClick={refresh} disabled={fetching}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors disabled:opacity-50">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={fetching ? 'animate-spin' : ''}>
            <path d="M10 6A4 4 0 1 1 6 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M6 2l2-2M6 2L4 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Refresh
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-px bg-slate-800 border-b border-slate-800 flex-shrink-0">
        {[
          { label: 'Users',    value: users.length,   color: 'text-blue-400' },
          { label: 'Contacts', value: totalContacts,   color: 'text-violet-400' },
          { label: 'Meetings', value: totalMeetings,   color: 'text-emerald-400' },
          { label: 'Tasks',    value: totalTasks,      color: 'text-amber-400' },
        ].map(s => (
          <div key={s.label} className="bg-slate-900 px-4 py-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="px-4 py-3 border-b border-slate-800 flex-shrink-0">
        <input type="search" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by UID or contact name…"
          className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-xl px-4 py-3 text-sm text-red-400">
            <strong>Error:</strong> {error}
            <p className="text-xs mt-1 text-red-500">Check Firestore rules — admin UID must have read access to all users/* docs.</p>
          </div>
        )}

        {fetching && !users.length && (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!fetching && !error && filtered.length === 0 && (
          <div className="text-center py-16 text-slate-500 text-sm">No users found</div>
        )}

        {filtered.map(u => {
          const taskCount = u.taskBuckets.reduce((s, b) => s + b.tasks.length, 0)
          const isMe = u.uid === ADMIN_UID

          return (
            <div key={u.uid} className={`bg-slate-900 border rounded-xl overflow-hidden transition-colors ${isMe ? 'border-blue-700' : 'border-slate-800'}`}>
              {/* Row header */}
              <button className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-800 transition-colors"
                onClick={() => setExpandedUid(expandedUid === u.uid ? null : u.uid)}>
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isMe ? 'bg-blue-400' : 'bg-slate-600'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-slate-300 truncate">
                    {u.uid} {isMe && <span className="text-blue-400 font-bold not-italic">(you)</span>}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {u.contacts.length > 0 && statBadge('contacts', u.contacts.length, 'bg-violet-900/50 text-violet-300')}
                    {u.meetings.length > 0 && statBadge('meetings', u.meetings.length, 'bg-emerald-900/50 text-emerald-300')}
                    {taskCount > 0          && statBadge('tasks',    taskCount,          'bg-amber-900/50 text-amber-300')}
                    {u.savedCharts.length > 0 && statBadge('charts',  u.savedCharts.length, 'bg-sky-900/50 text-sky-300')}
                  </div>
                </div>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className={`text-slate-500 flex-shrink-0 transition-transform ${expandedUid === u.uid ? 'rotate-180' : ''}`}>
                  <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              {/* Expanded detail */}
              {expandedUid === u.uid && (
                <div className="border-t border-slate-800 px-4 py-4 flex flex-col gap-4">

                  {/* Contacts list */}
                  {u.contacts.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">Contacts</p>
                      <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                        {u.contacts.map(c => (
                          <div key={c.id} className="flex items-center gap-2 text-sm">
                            <span className="text-slate-200 font-medium">{c.name}</span>
                            {c.title && <span className="text-slate-500 text-xs">{c.title}</span>}
                            {c.org   && <span className="text-slate-600 text-xs">· {c.org}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Meetings list */}
                  {u.meetings.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">Recent Meetings</p>
                      <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                        {[...u.meetings].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10).map(m => (
                          <div key={m.id} className="flex items-center gap-2 text-sm">
                            <span className="text-slate-500 text-xs font-mono">{m.date}</span>
                            <span className="text-slate-300">{m.title}</span>
                            {m.actionItems.length > 0 && (
                              <span className="text-amber-500 text-xs">{m.actionItems.filter(a => !a.done).length} open</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Task buckets summary */}
                  {u.taskBuckets.length > 0 && taskCount > 0 && (
                    <div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">Task Buckets</p>
                      <div className="flex flex-wrap gap-2">
                        {u.taskBuckets.filter(b => b.tasks.length > 0).map(b => (
                          <span key={b.id} className="text-xs px-2 py-1 rounded-full"
                            style={{ background: b.color + '22', color: b.color, border: `1px solid ${b.color}44` }}>
                            {b.name} · {b.tasks.length}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Delete */}
                  {!isMe && (
                    <div className="pt-2 border-t border-slate-800">
                      <button
                        onClick={() => handleDelete(u.uid)}
                        disabled={deleting === u.uid}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-red-800 text-red-400 text-sm font-medium hover:bg-red-900/30 active:bg-red-900/50 transition-colors disabled:opacity-50 min-h-[44px]">
                        {deleting === u.uid ? (
                          <div className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M2 4h10M5 4V2h4v2M6 7v4M8 7v4M3 4l1 8h6l1-8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                        Delete all data for this user
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer note */}
      <div className="px-4 py-3 border-t border-slate-800 flex-shrink-0">
        <p className="text-xs text-slate-600 text-center">
          Admin access · <span className="font-mono">{ADMIN_UID}</span>
        </p>
      </div>
    </div>
  )
}
