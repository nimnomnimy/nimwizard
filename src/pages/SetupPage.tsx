import { useState } from 'react'
import { signOut } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { useAppStore } from '../store/useAppStore'
import { uid, downloadCSV, LEVEL_LABELS } from '../lib/utils'
import { showToast } from '../components/ui/Toast'
import type { TaskBucket, Level } from '../types'

const BUCKET_COLORS = [
  '#a78bfa', '#94a3b8', '#f59e0b', '#10b981',
  '#3b82f6', '#ef4444', '#ec4899', '#06b6d4', '#84cc16', '#f97316',
]

function ColorDot({ color, selected, onClick }: { color: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`w-6 h-6 rounded-full border-2 flex-shrink-0 transition-transform ${selected ? 'scale-125 border-slate-600' : 'border-transparent hover:scale-110'}`}
      style={{ background: color }} />
  )
}

export default function SetupPage() {
  const taskBuckets   = useAppStore(s => s.taskBuckets)
  const contacts      = useAppStore(s => s.contacts)
  const setTaskBuckets = useAppStore(s => s.setTaskBuckets)
  const uid_user      = useAppStore(s => s.uid)

  const [editingBucket, setEditingBucket] = useState<string | null>(null)
  const [editName, setEditName]   = useState('')
  const [editColor, setEditColor] = useState(BUCKET_COLORS[0])
  const [newBucketName, setNewBucketName] = useState('')
  const [showAddBucket, setShowAddBucket] = useState(false)

  const userEmail = auth.currentUser?.email ?? ''

  // ─── Bucket actions ──────────────────────────────────────────────────────
  const startEdit = (b: TaskBucket) => {
    setEditingBucket(b.id)
    setEditName(b.name)
    setEditColor(b.color)
  }

  const saveEdit = () => {
    if (!editName.trim() || !editingBucket) return
    setTaskBuckets(taskBuckets.map(b =>
      b.id === editingBucket ? { ...b, name: editName.trim(), color: editColor } : b
    ))
    setEditingBucket(null)
    showToast('Bucket updated', 'success')
  }

  const deleteBucket = (id: string) => {
    const bucket = taskBuckets.find(b => b.id === id)
    if (!bucket) return
    const isDefault = ['unsorted', 'backlog', 'inprogress', 'done'].includes(id)
    if (isDefault) { showToast('Cannot delete default buckets'); return }
    if (!confirm(`Delete "${bucket.name}"? ${bucket.tasks.length ? `${bucket.tasks.length} task(s) will move to Unsorted.` : ''}`)) return
    const newBuckets = taskBuckets.filter(b => b.id !== id).map(b => {
      if (b.id === 'unsorted') return { ...b, tasks: [...b.tasks, ...bucket.tasks] }
      return b
    })
    setTaskBuckets(newBuckets)
    setEditingBucket(null)
    showToast(`"${bucket.name}" deleted`)
  }

  const addBucket = () => {
    if (!newBucketName.trim()) return
    const color = BUCKET_COLORS[taskBuckets.length % BUCKET_COLORS.length]
    const newBuckets: TaskBucket[] = [...taskBuckets, {
      id: uid(),
      name: newBucketName.trim(),
      color,
      tasks: [],
    }]
    setTaskBuckets(newBuckets)
    setNewBucketName('')
    setShowAddBucket(false)
    showToast('Bucket added', 'success')
  }

  const moveBucket = (id: string, dir: -1 | 1) => {
    const idx = taskBuckets.findIndex(b => b.id === id)
    if (idx < 0) return
    const next = idx + dir
    if (next < 0 || next >= taskBuckets.length) return
    const copy = [...taskBuckets]
    ;[copy[idx], copy[next]] = [copy[next], copy[idx]]
    setTaskBuckets(copy)
  }

  // ─── Export / Clear ───────────────────────────────────────────────────────
  const exportContacts = () => {
    const rows: string[][] = [['Name', 'Title', 'Organisation', 'Level', 'Email', 'Phone']]
    contacts.forEach(c => rows.push([
      c.name, c.title ?? '', c.org ?? '',
      c.level ? LEVEL_LABELS[c.level as Level] : '',
      c.email ?? '', c.phone ?? '',
    ]))
    downloadCSV(rows, 'contacts.csv')
    showToast('Contacts exported', 'success')
  }

  const handleSignOut = async () => {
    if (!confirm('Sign out?')) return
    await signOut(auth)
  }

  const DEFAULT_BUCKET_IDS = ['unsorted', 'backlog', 'inprogress', 'done']

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 flex-shrink-0 px-4 py-3">
        <h1 className="text-xl font-bold text-slate-900">Setup</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scroll-touch px-4 py-4 flex flex-col gap-6 max-w-lg">

        {/* ── Account ──────────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Account</h2>
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <circle cx="9" cy="7" r="3.5" stroke="#3b82f6" strokeWidth="1.5"/>
                  <path d="M2 16c0-3.866 3.134-7 7-7s7 3.134 7 7" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{userEmail || 'Signed in'}</p>
                <p className="text-xs text-slate-400">Google account</p>
              </div>
            </div>
            <div className="border-t border-slate-100">
              <button onClick={handleSignOut}
                className="w-full text-left px-4 py-3 text-sm text-red-500 font-medium hover:bg-red-50 active:bg-red-100 transition-colors min-h-[48px]">
                Sign out
              </button>
            </div>
          </div>
        </section>

        {/* ── Task Buckets ─────────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide">Task Buckets</h2>
            <button onClick={() => { setShowAddBucket(true); setNewBucketName('') }}
              className="text-xs font-semibold text-blue-500 hover:text-blue-700 px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors min-h-[32px]">
              + Add
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            {taskBuckets.map((b, i) => {
              const isDefault = DEFAULT_BUCKET_IDS.includes(b.id)
              const isEditing = editingBucket === b.id
              return (
                <div key={b.id} className="border-b border-slate-100 last:border-0">
                  {isEditing ? (
                    <div className="px-3 py-3 flex flex-col gap-2.5">
                      <input
                        autoFocus
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingBucket(null) }}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                        placeholder="Bucket name"
                      />
                      <div className="flex gap-2 flex-wrap">
                        {BUCKET_COLORS.map(c => (
                          <ColorDot key={c} color={c} selected={editColor === c} onClick={() => setEditColor(c)} />
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={saveEdit}
                          className="flex-1 py-2.5 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 active:bg-blue-700 min-h-[44px] transition-colors">
                          Save
                        </button>
                        {!isDefault && (
                          <button onClick={() => deleteBucket(b.id)}
                            className="px-4 py-2.5 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 active:bg-red-100 min-h-[44px] transition-colors">
                            Delete
                          </button>
                        )}
                        <button onClick={() => setEditingBucket(null)}
                          className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-500 text-sm font-medium hover:bg-slate-50 min-h-[44px] transition-colors">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 px-4 py-3 min-h-[52px]">
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: b.color }} />
                      <span className="flex-1 text-sm font-medium text-slate-800">{b.name}</span>
                      {b.tasks.length > 0 && (
                        <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{b.tasks.length}</span>
                      )}
                      {/* Reorder */}
                      <div className="flex flex-col gap-0.5">
                        <button onClick={() => moveBucket(b.id, -1)} disabled={i === 0}
                          className="w-6 h-5 flex items-center justify-center text-slate-300 hover:text-slate-500 disabled:opacity-20 leading-none">
                          <svg width="10" height="7" viewBox="0 0 10 7" fill="none"><path d="M1 6l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </button>
                        <button onClick={() => moveBucket(b.id, 1)} disabled={i === taskBuckets.length - 1}
                          className="w-6 h-5 flex items-center justify-center text-slate-300 hover:text-slate-500 disabled:opacity-20 leading-none">
                          <svg width="10" height="7" viewBox="0 0 10 7" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </button>
                      </div>
                      <button onClick={() => startEdit(b)}
                        className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 active:bg-blue-100 transition-colors">
                        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                          <path d="M9.5 1.5l2 2-7 7H2.5v-2l7-7z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Add bucket inline form */}
            {showAddBucket && (
              <div className="border-t border-slate-100 px-3 py-3 flex gap-2">
                <input
                  autoFocus
                  type="text"
                  value={newBucketName}
                  onChange={e => setNewBucketName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addBucket(); if (e.key === 'Escape') setShowAddBucket(false) }}
                  placeholder="New bucket name…"
                  className="flex-1 px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                />
                <button onClick={addBucket}
                  className="px-4 py-2.5 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 active:bg-blue-700 min-h-[44px] transition-colors">
                  Add
                </button>
                <button onClick={() => setShowAddBucket(false)}
                  className="px-3 py-2.5 rounded-xl border border-slate-200 text-slate-400 text-sm min-h-[44px] transition-colors hover:bg-slate-50">
                  ✕
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ── Data ─────────────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Data</h2>
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <button onClick={exportContacts}
              className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 active:bg-slate-100 transition-colors border-b border-slate-100 min-h-[52px]">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 9L2.5 4.5M7 9l4.5-4.5M7 9V1M1 13h12" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-medium text-slate-800">Export Contacts</p>
                <p className="text-xs text-slate-400">{contacts.length} contact{contacts.length !== 1 ? 's' : ''} · CSV format</p>
              </div>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-slate-300">
                <path d="M5 2l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            <div className="px-4 py-3.5 flex items-center gap-3 min-h-[52px]">
              <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center flex-shrink-0">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="6" stroke="#94a3b8" strokeWidth="1.5"/>
                  <path d="M7 4v3.5l2 2" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-medium text-slate-800">Sync</p>
                <p className="text-xs text-slate-400">Data syncs automatically via Firebase</p>
              </div>
              <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">Live</span>
            </div>
          </div>
        </section>

        {/* ── App info ──────────────────────────────────────────────────────── */}
        <section>
          <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-800">NimWizard</p>
                <p className="text-xs text-slate-400 mt-0.5">Your relationship intelligence app</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400">User ID</p>
                <p className="text-[10px] font-mono text-slate-300 truncate max-w-[120px]">{uid_user ?? '—'}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Bottom padding for mobile nav */}
        <div className="h-4 lg:hidden" />
      </div>
    </div>
  )
}
