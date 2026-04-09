import type { Meeting, Contact } from '../../types'

interface Props {
  meeting: Meeting
  contacts: Contact[]
  onEdit: () => void
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

export default function MeetingCard({ meeting, contacts, onEdit, onDelete }: Props) {
  const { day, month, year } = fmtDate(meeting.date)
  const past = isPast(meeting.date)
  const openItems = meeting.actionItems.filter(a => !a.done).length
  const totalItems = meeting.actionItems.length
  const attendeeContacts = meeting.attendees.map(id => contacts.find(c => c.id === id)).filter(Boolean) as Contact[]

  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden ${past ? 'opacity-80' : ''}`}>
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

        {/* Actions */}
        <div className="flex flex-col items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
          <button onClick={onEdit}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 active:bg-blue-100 transition-colors">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M9.5 1.5l2 2-7 7H2.5v-2l7-7z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button onClick={onDelete}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 active:bg-red-100 transition-colors">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
