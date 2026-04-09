import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { uid, LEVEL_LABELS } from '../../lib/utils'
import { showToast } from '../ui/Toast'
import ContactAvatar from './ContactAvatar'
import type { Contact, Level } from '../../types'

const LEVELS: Level[] = ['c-level', 'gm', 'head-of', 'director', 'manager', 'lead', 'individual']

interface Props {
  contactId: string | null   // null = new contact
  open: boolean
  onClose: () => void
}

const empty = (): Partial<Contact> => ({ name: '', org: '', title: '', level: 'individual', email: '', phone: '', parentId: '' })

// Derive email placeholder from name + org
function emailPlaceholder(name: string, org: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.toLowerCase() ?? 'firstname'
  const last  = parts[1]?.toLowerCase() ?? 'lastname'
  const domain = org.trim()
    ? org.trim().toLowerCase().replace(/[^a-z0-9]+/g, '') + '.com'
    : 'organisation.com'
  return `${first}.${last}@${domain}`
}

export default function ContactDrawer({ contactId, open, onClose }: Props) {
  const contacts = useAppStore(s => s.contacts)
  const addContact = useAppStore(s => s.addContact)
  const updateContact = useAppStore(s => s.updateContact)
  const deleteContact = useAppStore(s => s.deleteContact)

  const existing = contactId ? contacts.find(c => c.id === contactId) : null
  const isNew = !existing

  const [form, setForm] = useState<Partial<Contact>>(empty())
  const [orgSuggestions, setOrgSuggestions] = useState<string[]>([])
  const [showOrgDrop, setShowOrgDrop] = useState(false)

  // Reports To search state
  const [parentSearch, setParentSearch] = useState('')
  const [showParentDrop, setShowParentDrop] = useState(false)

  // Track whether the user has manually edited the email field
  const emailManuallyEdited = useRef(false)

  const nameRef = useRef<HTMLInputElement>(null)

  // Reset form when drawer opens
  useEffect(() => {
    if (open) {
      const f = existing ? { ...existing } : empty()
      setForm(f)
      emailManuallyEdited.current = !!existing?.email // existing contacts keep their email
      // Set parent search display name
      if (f.parentId) {
        const parent = contacts.find(c => c.id === f.parentId)
        setParentSearch(parent?.name ?? '')
      } else {
        setParentSearch('')
      }
      setTimeout(() => nameRef.current?.focus(), 100)
    }
  }, [open, contactId])

  // Org autocomplete
  const uniqueOrgs = [...new Set(contacts.map(c => c.org).filter(Boolean) as string[])].sort()
  useEffect(() => {
    if (!form.org) { setOrgSuggestions([]); return }
    const q = form.org.toLowerCase()
    setOrgSuggestions(uniqueOrgs.filter(o => o.toLowerCase().includes(q) && o !== form.org))
  }, [form.org])

  // Reports To filtered list
  const parentOptions = contacts
    .filter(c => c.id !== existing?.id)
    .filter(c => !parentSearch || c.name.toLowerCase().includes(parentSearch.toLowerCase()) || (c.org ?? '').toLowerCase().includes(parentSearch.toLowerCase()))

  const set = (field: keyof Contact, value: string) => {
    setForm(f => {
      const updated = { ...f, [field]: value }
      // Auto-derive email from name+org unless user has typed their own
      if ((field === 'name' || field === 'org') && !emailManuallyEdited.current) {
        updated.email = emailPlaceholder(
          field === 'name' ? value : (f.name ?? ''),
          field === 'org'  ? value : (f.org  ?? '')
        )
      }
      return updated
    })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name?.trim()) return
    const contact: Contact = {
      id: existing?.id ?? uid(),
      name: form.name.trim(),
      org: form.org?.trim() ?? '',
      title: form.title?.trim() ?? '',
      level: form.level ?? 'individual',
      email: form.email?.trim() ?? '',
      phone: form.phone?.trim() ?? '',
      parentId: form.parentId ?? '',
      createdAt: existing?.createdAt ?? Date.now(),
    }
    if (existing) {
      updateContact(contact)
      showToast(`${contact.name} updated`, 'success')
    } else {
      addContact(contact)
      showToast(`${contact.name} added`, 'success')
    }
    onClose()
  }

  const handleDelete = () => {
    if (!existing) return
    if (!confirm(`Delete ${existing.name}?`)) return
    deleteContact(existing.id)
    showToast(`${existing.name} deleted`)
    onClose()
  }

  return (
    <>
      {/* Backdrop */}
      {open && <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />}

      {/* Drawer — bottom sheet on mobile, right panel on desktop */}
      <div className={`
        fixed z-50 bg-white shadow-2xl flex flex-col
        transition-transform duration-300 ease-in-out
        inset-x-0 bottom-0 rounded-t-2xl max-h-[92dvh]
        lg:inset-y-0 lg:right-0 lg:left-auto lg:w-96 lg:rounded-none lg:max-h-full
        ${open ? 'translate-y-0 lg:translate-x-0' : 'translate-y-full lg:translate-x-full'}
      `}>
        {/* Drag handle (mobile) */}
        <div className="lg:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 bg-slate-200 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            {!isNew && form.name && <ContactAvatar name={form.name} size="sm" />}
            <h2 className="text-base font-bold text-slate-900">{isNew ? 'New Contact' : 'Edit Contact'}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-2 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 2l14 14M16 2L2 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto scroll-touch px-4 py-4 flex flex-col gap-4">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Full Name <span className="text-red-400">*</span></label>
            <input
              ref={nameRef}
              type="text"
              value={form.name ?? ''}
              onChange={e => set('name', e.target.value)}
              placeholder="Jane Smith"
              required
              className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-h-[48px]"
            />
          </div>

          {/* Org */}
          <div className="flex flex-col gap-1.5 relative">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Organisation</label>
            <input
              type="text"
              value={form.org ?? ''}
              onChange={e => { set('org', e.target.value); setShowOrgDrop(true) }}
              onFocus={() => setShowOrgDrop(true)}
              onBlur={() => setTimeout(() => setShowOrgDrop(false), 150)}
              placeholder="Acme Corp"
              className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-h-[48px]"
            />
            {showOrgDrop && orgSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-10 overflow-hidden">
                {orgSuggestions.map(org => (
                  <button key={org} type="button"
                    onMouseDown={() => { set('org', org); setShowOrgDrop(false) }}
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-slate-50 active:bg-slate-100 min-h-[44px]">
                    {org}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Title + Level */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Job Title</label>
            <input
              type="text"
              value={form.title ?? ''}
              onChange={e => set('title', e.target.value)}
              placeholder="Head of Engineering"
              className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-h-[48px]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Level</label>
            <select
              value={form.level ?? 'individual'}
              onChange={e => set('level', e.target.value)}
              className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-h-[48px] bg-white"
            >
              {LEVELS.map(l => <option key={l} value={l}>{LEVEL_LABELS[l]}</option>)}
            </select>
          </div>

          {/* Reports To — search field */}
          <div className="flex flex-col gap-1.5 relative">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Reports To</label>
            <div className="relative">
              <input
                type="text"
                value={parentSearch}
                onChange={e => {
                  setParentSearch(e.target.value)
                  setShowParentDrop(true)
                  // Clear parentId if user clears the field
                  if (!e.target.value) set('parentId', '')
                }}
                onFocus={() => setShowParentDrop(true)}
                onBlur={() => setTimeout(() => setShowParentDrop(false), 150)}
                placeholder="Search contacts…"
                className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-h-[48px]"
              />
              {form.parentId && (
                <button type="button"
                  onClick={() => { set('parentId', ''); setParentSearch('') }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                </button>
              )}
            </div>

            {/* Dropdown */}
            {showParentDrop && parentOptions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-10 overflow-hidden max-h-48 overflow-y-auto">
                {!parentSearch && (
                  <button type="button"
                    onMouseDown={() => { set('parentId', ''); setParentSearch(''); setShowParentDrop(false) }}
                    className="w-full text-left px-3 py-2.5 text-sm text-slate-400 hover:bg-slate-50 border-b border-slate-100 min-h-[44px]">
                    None (top level)
                  </button>
                )}
                {parentOptions.slice(0, 8).map(c => (
                  <button key={c.id} type="button"
                    onMouseDown={() => {
                      set('parentId', c.id)
                      setParentSearch(c.name)
                      setShowParentDrop(false)
                    }}
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-blue-50 active:bg-blue-100 border-b border-slate-100 last:border-0 min-h-[44px] transition-colors">
                    <span className="font-medium text-slate-800">{c.name}</span>
                    {(c.title || c.org) && (
                      <span className="text-slate-400 text-xs ml-2">{[c.title, c.org].filter(Boolean).join(' · ')}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Email */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Email</label>
            <input
              type="email"
              value={form.email ?? ''}
              onChange={e => {
                emailManuallyEdited.current = true
                set('email', e.target.value)
              }}
              autoComplete="off"
              className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-h-[48px]"
            />
          </div>

          {/* Phone */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Phone</label>
            <input
              type="tel"
              value={form.phone ?? ''}
              onChange={e => set('phone', e.target.value)}
              placeholder="+61 400 000 000"
              className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-h-[48px]"
            />
          </div>

          {/* Spacer so buttons aren't hidden behind keyboard */}
          <div className="h-2" />
        </form>

        {/* Actions */}
        <div className="flex gap-3 px-4 py-4 border-t border-slate-100 flex-shrink-0"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          {!isNew && (
            <button type="button" onClick={handleDelete}
              className="px-4 py-3 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 active:bg-red-100 min-h-[48px] transition-colors">
              Delete
            </button>
          )}
          <button type="submit" form="contact-form" onClick={handleSubmit}
            className="flex-1 py-3 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 active:bg-blue-700 min-h-[48px] transition-colors">
            {isNew ? 'Create Contact' : 'Save Changes'}
          </button>
        </div>
      </div>
    </>
  )
}
