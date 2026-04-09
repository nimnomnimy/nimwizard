import { useState } from 'react'
import type { Contact } from '../../types'
import { LEVEL_LABELS } from '../../lib/utils'
import ContactAvatar from './ContactAvatar'

interface Props {
  contact: Contact
  onEdit: () => void
  onDelete: () => void
}

export default function ContactCard({ contact, onEdit, onDelete }: Props) {
  const [pressing, setPressing] = useState(false)

  return (
    <div
      onClick={onEdit}
      onMouseDown={() => setPressing(true)}
      onMouseUp={() => setPressing(false)}
      onTouchStart={() => setPressing(true)}
      onTouchEnd={() => setPressing(false)}
      className={`
        flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-white
        cursor-pointer transition-all duration-100 select-none
        ${pressing ? 'scale-[0.98] bg-slate-50' : 'hover:border-slate-300 hover:shadow-sm active:scale-[0.98]'}
      `}
    >
      <ContactAvatar name={contact.name} size="sm" />

      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900 truncate">{contact.name}</div>
        <div className="text-xs text-slate-500 truncate">
          {contact.title || ''}
          {contact.title && contact.level ? ' · ' : ''}
          {contact.level ? LEVEL_LABELS[contact.level] : ''}
        </div>
      </div>

      {/* Action buttons — always visible on mobile */}
      <div className="flex gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
        <button
          onClick={onEdit}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 active:bg-blue-100 transition-colors"
          aria-label="Edit"
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M11.5 1.5l2 2-9 9H2.5v-2l9-9z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button
          onClick={onDelete}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 active:bg-red-100 transition-colors"
          aria-label="Delete"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
