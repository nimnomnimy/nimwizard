import { useState } from 'react'
import type { Meeting, Contact } from '../../types'

interface Props {
  meeting: Meeting
  contacts: Contact[]
  onEdit: () => void
  onClone: () => void
  onDelete: () => void
}

function fmtDate(d: string) {
  const [y, m, day] = d.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return { day, month: months[parseInt(m) - 1], year: y }
}

function isPast(date: string) {
  const today = new Date().toISOString().split('T')[0]
  return date < today
}

export default function MeetingCard({ meeting, contacts, onEdit, onClone, onDelete }: Props) {
  const { day, month, year } = fmtDate(meeting.date)
  const past = isPast(meeting.date)
  const openItems = meeting.actionItems.filter(a => !a.done).length
  const totalItems = meeting.actionItems.length
  const attendeeContacts = meeting.attendees.map(id => contacts.find(c => c.id === id)).filter(Boolean) as Contact[]
  const [showMenu, setShowMenu] = useState(false)

  return (
    <div className="relative">
    {showMenu && <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />}
    <div
      className={`bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden cursor-pointer hover:border-blue-300 hover:shadow-md active:bg-slate-50 transition-all ${past ? 'opacity-80' : ''}`}
      onClick={() => setShowMenu(true)}>
      <div className="flex gap-3 p-3">
        {/* Date block */}
        <div className={`flex-shrink-0 w-12 rounded-lg flex flex-col items-center justify-center py-2 ${past ? 'bg-slate-100' : 'bg-blue-50'}`}>
          <span className={`text-xs font-bold uppercase ${past ? 'text-slate-400' : 'text-blue-500'}`}>{month}</span>
          <span className={`text-xl font-bold leading-none ${past ? 'text-slate-500' : 'text-blue-700'}`}>{day}</span>
          <span className={`text-[10px] ${past ? 'text-slate-400' : 'text-blue-400'}`}>{year}</span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">{meeting.title}</p>

          {/* Attendees */}
          {attendeeContacts.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {attendeeContacts.slice(0, 4).map(c => (
                <span key={c.id} className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">
                  {c.name.split(' ')[0]}
                </span>
              ))}
              {attendeeContacts.length > 4 && (
                <span className="text-[10px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded-full">
                  +{attendeeContacts.length - 4}
                </span>
              )}
            </div>
          )}

          {/* Discussion preview */}
          {meeting.discussion && (
            <p className="text-xs text-slate-400 mt-1.5 line-clamp-2">{meeting.discussion}</p>
          )}

          {/* Action items */}
          {totalItems > 0 && (
            <div className="flex items-center gap-1 mt-1.5">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <rect x="1" y="1" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" className={openItems > 0 ? 'text-amber-500' : 'text-emerald-500'}/>
                {openItems === 0 && <path d="M3 5.5l1.5 1.5 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500"/>}
              </svg>
              <span className={`text-[10px] font-medium ${openItems > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {openItems > 0 ? `${openItems} open` : 'All done'} · {totalItems} action{totalItems !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>

        {/* Chevron indicator */}
        <div className="flex items-center flex-shrink-0 text-slate-300">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>
    </div>

    {/* Action menu */}
    {showMenu && (
      <div className="absolute right-2 top-2 z-20 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden min-w-[160px]">
        <button onClick={() => { setShowMenu(false); onEdit() }}
          className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 border-b border-slate-100">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M9.5 1.5l2 2-7 7H2.5v-2l7-7z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Edit meeting
        </button>
        <button onClick={() => { setShowMenu(false); onClone() }}
          className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 border-b border-slate-100">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M1 9V2a1 1 0 011-1h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          Clone as new
        </button>
        <button onClick={() => { setShowMenu(false); onDelete() }}
          className="w-full text-left px-4 py-3 text-sm text-red-500 hover:bg-red-50 flex items-center gap-2.5">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Delete
        </button>
      </div>
    )}
    </div>
  )
}
