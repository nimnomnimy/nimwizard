import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { uid } from '../../lib/utils'
import { showToast } from '../ui/Toast'
import type { Meeting, ActionItem, Contact, Task } from '../../types'

interface Props {
  open: boolean
  meeting: Meeting | null
  onClose: () => void
}

const PRIORITIES = ['low', 'medium', 'high'] as const
const PRIORITY_COLOR: Record<string, string> = {
  low: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  medium: 'text-amber-600 bg-amber-50 border-amber-200',
  high: 'text-red-600 bg-red-50 border-red-200',
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

export default function MeetingDrawer({ open, meeting, onClose }: Props) {
  const contacts = useAppStore(s => s.contacts)
  const meetings = useAppStore(s => s.meetings)
  const taskBuckets = useAppStore(s => s.taskBuckets)
  const deleteMeeting = useAppStore(s => s.deleteMeeting)
  const saveMeetingWithTasks = useAppStore(s => s.saveMeetingWithTasks)

  const allTasks: Task[] = taskBuckets.flatMap(b => b.tasks)

  const [title, setTitle] = useState('')
  const [date, setDate] = useState(todayStr())
  const [attendees, setAttendees] = useState<string[]>([])
  const [attendeeSearch, setAttendeeSearch] = useState('')
  const [discussion, setDiscussion] = useState('')
  const [actionItems, setActionItems] = useState<ActionItem[]>([])
  const [newActionText, setNewActionText] = useState('')
  const [actionSearch, setActionSearch] = useState('')
  const [showActionSearch, setShowActionSearch] = useState(false)
  const [activeTab, setActiveTab] = useState<'current' | 'previous'>('current')

  const titleRef = useRef<HTMLInputElement>(null)
  const actionInputRef = useRef<HTMLInputElement>(null)

  // Previous meetings for reference tab:
  // - If attendees are selected, prioritise meetings that share at least one attendee
  // - Otherwise fall back to the most recent past meetings so the tab is useful
  //   even before attendees are filled in on a new meeting
  const pastMeetings = meetings
    .filter(m => m.id !== meeting?.id && m.date < date)
    .sort((a, b) => b.date.localeCompare(a.date))

  const previousMeeting = attendees.length > 0
    ? (pastMeetings.find(m => m.attendees.some(a => attendees.includes(a))) ?? pastMeetings[0] ?? null)
    : (pastMeetings[0] ?? null)

  useEffect(() => {
    if (open) {
      setTitle(meeting?.title ?? '')
      setDate(meeting?.date ?? todayStr())
      setAttendees(meeting?.attendees ?? [])
      setDiscussion(meeting?.discussion ?? '')
      setActionItems(meeting?.actionItems ?? [])
      setAttendeeSearch('')
      setNewActionText('')
      setActionSearch('')
      setShowActionSearch(false)
      setActiveTab('current')
      setTimeout(() => titleRef.current?.focus(), 100)
    }
  }, [open, meeting])

  const filteredContacts = contacts.filter(c =>
    !attendees.includes(c.id) &&
    c.name.toLowerCase().includes(attendeeSearch.toLowerCase())
  )

  const addAttendee = (contact: Contact) => {
    setAttendees(prev => [...prev, contact.id])
    setAttendeeSearch('')
  }

  const removeAttendee = (id: string) => {
    setAttendees(prev => prev.filter(a => a !== id))
  }

  const addActionItem = () => {
    if (!newActionText.trim()) return
    const item: ActionItem = { id: uid(), text: newActionText.trim(), done: false }
    setActionItems(prev => [...prev, item])
    setNewActionText('')
    setTimeout(() => actionInputRef.current?.focus(), 50)
  }

  const addTaskAsActionItem = (task: Task) => {
    if (actionItems.some(a => a.taskId === task.id)) { showToast('Already added'); return }
    const item: ActionItem = {
      id: uid(),
      text: task.text,
      done: (task.progress ?? 0) >= 100,
      taskId: task.id,
      priority: task.priority,
      due: task.due,
    }
    setActionItems(prev => [...prev, item])
    setActionSearch('')
    setShowActionSearch(false)
    showToast(`"${task.text}" added`, 'success')
  }

  const filteredActionTasks = allTasks.filter(t => {
    if (!actionSearch.trim()) return false
    const q = actionSearch.toLowerCase()
    return t.text.toLowerCase().includes(q)
  }).slice(0, 8)

  const updateActionItem = (id: string, patch: Partial<ActionItem>) => {
    setActionItems(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a))
  }

  const removeActionItem = (id: string) => {
    setActionItems(prev => prev.filter(a => a.id !== id))
  }

  const copyOpenItems = () => {
    if (!previousMeeting) return
    const open = previousMeeting.actionItems.filter(a => !a.done)
    const newItems = open.map(a => ({ ...a, id: uid(), done: false }))
    setActionItems(prev => [...prev, ...newItems])
    showToast(`${newItems.length} item${newItems.length !== 1 ? 's' : ''} copied`, 'success')
    setActiveTab('current')
  }

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!title.trim()) return

    const toSave: Meeting = {
      id: meeting?.id ?? uid(),
      title: title.trim(),
      date,
      attendees,
      discussion: discussion.trim() || undefined,
      actionItems,
      createdAt: meeting?.createdAt ?? Date.now(),
    }

    // Atomically saves the meeting and syncs action items ↔ tasks in one write
    saveMeetingWithTasks(toSave)
    showToast(meeting ? 'Meeting updated' : 'Meeting saved', 'success')
    onClose()
  }

  const handleDelete = () => {
    if (!meeting) return
    if (!confirm('Delete this meeting?')) return
    deleteMeeting(meeting.id)
    showToast('Meeting deleted')
    onClose()
  }

  const getContactName = (id: string) => contacts.find(c => c.id === id)?.name ?? id

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />}
      <div className={`
        fixed z-50 bg-white shadow-2xl flex flex-col
        transition-transform duration-300 ease-in-out
        inset-x-0 bottom-0 rounded-t-2xl max-h-[96dvh]
        lg:inset-y-0 lg:right-0 lg:left-auto lg:w-[440px] lg:rounded-none lg:max-h-full
        ${open ? 'translate-y-0 lg:translate-x-0' : 'translate-y-full lg:translate-x-full'}
      `}>
        {/* Mobile drag handle */}
        <div className="lg:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 bg-slate-200 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-base font-bold text-slate-900">{meeting ? 'Edit Meeting' : 'New Meeting'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-2 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 2l14 14M16 2L2 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* Tabs — only show Previous tab when editing an existing meeting */}
        {meeting && (
          <div className="flex border-b border-slate-100 flex-shrink-0">
            <button onClick={() => setActiveTab('current')}
              className={`flex-1 py-2.5 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'current' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-400'}`}>
              This Meeting
            </button>
            <button onClick={() => setActiveTab('previous')}
              className={`flex-1 py-2.5 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'previous' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-400'}`}>
              Previous
              {previousMeeting && previousMeeting.actionItems.some(a => !a.done) && (
                <span className="ml-1.5 bg-amber-100 text-amber-600 text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                  {previousMeeting.actionItems.filter(a => !a.done).length}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Current meeting tab */}
        {activeTab === 'current' && (
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto scroll-touch px-4 py-4 flex flex-col gap-4">
            {/* Title */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Title <span className="text-red-400">*</span></label>
              <input ref={titleRef} type="text" value={title} onChange={e => setTitle(e.target.value)}
                placeholder="Meeting title" required
                className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px]" />
            </div>

            {/* Date */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px] bg-white" />
            </div>

            {/* Attendees */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Attendees</label>

              {/* Chips */}
              {attendees.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-1">
                  {attendees.map(id => (
                    <span key={id} className="flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded-full">
                      {getContactName(id)}
                      <button type="button" onClick={() => removeAttendee(id)}
                        className="text-blue-400 hover:text-blue-700 leading-none">×</button>
                    </span>
                  ))}
                </div>
              )}

              {/* Search input */}
              <input type="text" value={attendeeSearch} onChange={e => setAttendeeSearch(e.target.value)}
                placeholder="Search contacts to add…"
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]" />

              {/* Dropdown */}
              {attendeeSearch && filteredContacts.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm max-h-40 overflow-y-auto">
                  {filteredContacts.slice(0, 8).map(c => (
                    <button key={c.id} type="button" onClick={() => addAttendee(c)}
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-blue-50 active:bg-blue-100 border-b border-slate-100 last:border-0 transition-colors">
                      <span className="font-medium text-slate-800">{c.name}</span>
                      {c.title && <span className="text-slate-400 text-xs ml-2">{c.title}</span>}
                    </button>
                  ))}
                </div>
              )}
              {attendeeSearch && filteredContacts.length === 0 && (
                <p className="text-xs text-slate-400 px-1">No matching contacts</p>
              )}
            </div>

            {/* Discussion */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Discussion</label>
              <textarea value={discussion} onChange={e => setDiscussion(e.target.value)} rows={4}
                placeholder="What was discussed…"
                className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </div>

            {/* Action Items */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Action Items</label>
                <button type="button"
                  onClick={() => setShowActionSearch(s => !s)}
                  className={`text-xs font-semibold px-2 py-1 rounded-lg transition-colors ${showActionSearch ? 'bg-blue-100 text-blue-600' : 'text-blue-500 hover:bg-blue-50'}`}>
                  Search tasks…
                </button>
              </div>

              {/* Task search */}
              {showActionSearch && (
                <div className="relative">
                  <input type="text" autoFocus value={actionSearch} onChange={e => setActionSearch(e.target.value)}
                    placeholder="Search existing tasks…"
                    className="w-full px-3 py-2.5 border border-blue-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] bg-blue-50" />
                  {filteredActionTasks.length > 0 && (
                    <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm mt-1 max-h-48 overflow-y-auto">
                      {filteredActionTasks.map(t => (
                        <button key={t.id} type="button"
                          onClick={() => addTaskAsActionItem(t)}
                          disabled={actionItems.some(a => a.taskId === t.id)}
                          className="w-full text-left px-3 py-2.5 text-sm hover:bg-blue-50 border-b border-slate-100 last:border-0 flex items-center gap-2 disabled:opacity-40">
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="flex-shrink-0 text-slate-400">
                            <rect x="1" y="1" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.3"/>
                          </svg>
                          <span className="flex-1 font-medium text-slate-800 truncate">{t.text}</span>
                          {t.priority && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                            t.priority === 'high' ? 'text-red-600 bg-red-50' : t.priority === 'medium' ? 'text-amber-600 bg-amber-50' : 'text-emerald-600 bg-emerald-50'
                          }`}>{t.priority}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {actionSearch && filteredActionTasks.length === 0 && (
                    <p className="text-xs text-slate-400 px-1 mt-1">No matching tasks</p>
                  )}
                </div>
              )}

              {actionItems.map(item => (
                <div key={item.id} className="flex items-start gap-2 bg-slate-50 rounded-xl p-2.5">
                  <button type="button" onClick={() => updateActionItem(item.id, { done: !item.done })}
                    className={`mt-0.5 w-5 h-5 flex-shrink-0 rounded-md border-2 flex items-center justify-center transition-colors ${item.done ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 bg-white'}`}>
                    {item.done && (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className={`text-sm ${item.done ? 'line-through text-slate-400' : 'text-slate-800'}`}>{item.text}</p>
                      {item.taskId && (
                        <span className="text-[9px] font-bold bg-indigo-50 text-indigo-500 px-1.5 py-0.5 rounded-full flex-shrink-0">task</span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {/* Assignee */}
                      <select value={item.assignee ?? ''} onChange={e => updateActionItem(item.id, { assignee: e.target.value || undefined })}
                        className="text-xs text-slate-500 border border-slate-200 rounded-lg px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 min-h-[30px]">
                        <option value="">Assignee…</option>
                        {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>

                      {/* Priority */}
                      <select value={item.priority ?? ''} onChange={e => updateActionItem(item.id, { priority: e.target.value as ActionItem['priority'] || undefined })}
                        className={`text-xs border rounded-lg px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 min-h-[30px] ${item.priority ? PRIORITY_COLOR[item.priority] : 'border-slate-200 text-slate-400 bg-white'}`}>
                        <option value="">Priority…</option>
                        {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                      </select>

                      {/* Due */}
                      <input type="date" value={item.due ?? ''} onChange={e => updateActionItem(item.id, { due: e.target.value || undefined })}
                        className="text-xs text-slate-500 border border-slate-200 rounded-lg px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 min-h-[30px]" />
                    </div>
                  </div>

                  <button type="button" onClick={() => removeActionItem(item.id)}
                    className="text-slate-300 hover:text-red-400 p-1 flex-shrink-0 mt-0.5">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              ))}

              {/* Add action item */}
              <div className="flex gap-2">
                <input ref={actionInputRef} type="text" value={newActionText} onChange={e => setNewActionText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addActionItem() } }}
                  placeholder="Add action item…"
                  className="flex-1 px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]" />
                <button type="button" onClick={addActionItem}
                  className="px-3 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-sm font-semibold hover:bg-slate-200 active:bg-slate-300 min-h-[44px] min-w-[44px] transition-colors">
                  +
                </button>
              </div>
            </div>

            <div className="h-2" />
          </form>
        )}

        {/* Previous meeting tab */}
        {activeTab === 'previous' && (
          <div className="flex-1 overflow-y-auto scroll-touch px-4 py-4">
            {!previousMeeting ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                  <circle cx="20" cy="20" r="15" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M20 12v8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <p className="text-sm text-center">No previous meetings found</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-0.5">
                    {attendees.length > 0 && previousMeeting.attendees.some(a => attendees.includes(a))
                      ? 'Previous meeting · shared attendees'
                      : 'Most recent meeting'}
                  </p>
                  <p className="text-sm font-semibold text-slate-800">{previousMeeting.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{previousMeeting.date}</p>
                </div>

                {previousMeeting.discussion && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Discussion</p>
                    <p className="text-sm text-slate-600 leading-relaxed">{previousMeeting.discussion}</p>
                  </div>
                )}

                {previousMeeting.actionItems.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Action Items</p>
                      {previousMeeting.actionItems.some(a => !a.done) && (
                        <button type="button" onClick={copyOpenItems}
                          className="text-xs font-semibold text-blue-500 hover:text-blue-700 px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors">
                          Copy open items →
                        </button>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      {previousMeeting.actionItems.map(item => (
                        <div key={item.id} className={`flex items-start gap-2 p-2.5 rounded-xl ${item.done ? 'bg-emerald-50' : 'bg-amber-50'}`}>
                          <div className={`mt-0.5 w-4 h-4 flex-shrink-0 rounded flex items-center justify-center ${item.done ? 'bg-emerald-500' : 'border-2 border-amber-300'}`}>
                            {item.done && (
                              <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                                <path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm ${item.done ? 'line-through text-slate-400' : 'text-slate-800'}`}>{item.text}</p>
                            {item.assignee && (
                              <p className="text-xs text-slate-400 mt-0.5">{contacts.find(c => c.id === item.assignee)?.name}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer actions */}
        <div className="flex gap-3 px-4 py-4 border-t border-slate-100 flex-shrink-0"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          {meeting && (
            <button type="button" onClick={handleDelete}
              className="px-4 py-3 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 active:bg-red-100 min-h-[48px] transition-colors">
              Delete
            </button>
          )}
          <button type="button" onClick={handleSubmit}
            className="flex-1 py-3 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 active:bg-blue-700 min-h-[48px] transition-colors">
            {meeting ? 'Save Changes' : 'Save Meeting'}
          </button>
        </div>
      </div>
    </>
  )
}
