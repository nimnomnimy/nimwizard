import { useState, useMemo } from 'react'
import { useAppStore } from '../store/useAppStore'
import { showToast } from '../components/ui/Toast'
import MeetingCard from '../components/meetings/MeetingCard'
import MeetingDrawer from '../components/meetings/MeetingDrawer'
import type { Meeting } from '../types'
import { uid } from '../lib/utils'

type DateFilter = 'all' | 'upcoming' | 'past'

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

export default function MeetingsPage() {
  const meetings = useAppStore(s => s.meetings)
  const contacts = useAppStore(s => s.contacts)
  const deleteMeeting = useAppStore(s => s.deleteMeeting)

  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [drawer, setDrawer] = useState<Meeting | null | undefined>(undefined) // undefined = closed

  const isDrawerOpen = drawer !== undefined
  const today = todayStr()

  const filtered = useMemo(() => {
    let list = [...meetings]

    if (search) {
      const q = search.toLowerCase()
      list = list.filter(m =>
        m.title.toLowerCase().includes(q) ||
        (m.discussion ?? '').toLowerCase().includes(q) ||
        m.attendees.some(id => {
          const c = contacts.find(c => c.id === id)
          return c?.name.toLowerCase().includes(q)
        })
      )
    }

    if (dateFilter === 'upcoming') list = list.filter(m => m.date >= today)
    if (dateFilter === 'past') list = list.filter(m => m.date < today)

    return list.sort((a, b) => b.date.localeCompare(a.date))
  }, [meetings, search, dateFilter, today, contacts])

  const upcomingCount = meetings.filter(m => m.date >= today).length
  const openActionsCount = meetings.reduce((acc, m) => acc + m.actionItems.filter(a => !a.done).length, 0)

  const handleDelete = (id: string) => {
    if (!confirm('Delete this meeting?')) return
    deleteMeeting(id)
    showToast('Meeting deleted')
  }

  const handleClone = (m: Meeting) => {
    const today = todayStr()
    const clone: Meeting = {
      ...m,
      id: uid(),
      title: `${m.title} (copy)`,
      date: today,
      actionItems: m.actionItems.map(a => ({ ...a, id: uid(), done: false })),
      createdAt: Date.now(),
    }
    setDrawer(clone)
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 flex-shrink-0 px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Meetings</h1>
            {openActionsCount > 0 && (
              <p className="text-xs text-amber-600 font-medium mt-0.5">{openActionsCount} open action item{openActionsCount !== 1 ? 's' : ''}</p>
            )}
          </div>
          <button onClick={() => setDrawer(null)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 active:bg-blue-700 min-h-[44px] transition-colors">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            New
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-2.5">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" width="15" height="15" viewBox="0 0 15 15" fill="none">
            <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input type="search" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search meetings…"
            className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50 min-h-[44px]" />
        </div>

        {/* Filter pills */}
        <div className="flex gap-1.5">
          {([['all', 'All'], ['upcoming', `Upcoming${upcomingCount > 0 ? ` (${upcomingCount})` : ''}`], ['past', 'Past']] as [DateFilter, string][]).map(([val, label]) => (
            <button key={val} onClick={() => setDateFilter(val)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors min-h-[36px] ${
                dateFilter === val ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-slate-500 border-slate-200'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto scroll-touch px-4 py-3 flex flex-col gap-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <rect x="6" y="10" width="36" height="32" rx="4" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M6 18h36M16 6v8M32 6v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <div className="text-center">
              <p className="font-semibold text-slate-600">{search ? 'No results' : 'No meetings yet'}</p>
              <p className="text-sm mt-1">{search ? 'Try a different search' : 'Tap New to record your first meeting'}</p>
            </div>
            {!search && (
              <button onClick={() => setDrawer(null)}
                className="px-4 py-2.5 rounded-xl bg-blue-500 text-white text-sm font-semibold min-h-[44px] transition-colors">
                New Meeting
              </button>
            )}
          </div>
        ) : (
          filtered.map(m => (
            <MeetingCard key={m.id} meeting={m} contacts={contacts}
              onEdit={() => setDrawer(m)}
              onClone={() => handleClone(m)}
              onDelete={() => handleDelete(m.id)} />
          ))
        )}
        <div className="h-4 lg:hidden" />
      </div>

      <MeetingDrawer
        open={isDrawerOpen}
        meeting={drawer ?? null}
        onClose={() => setDrawer(undefined)} />
    </div>
  )
}
