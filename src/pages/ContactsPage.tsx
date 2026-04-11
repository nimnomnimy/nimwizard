import { useState, useMemo } from 'react'
import { useAppStore } from '../store/useAppStore'
import { LEVEL_ORDER, downloadJSON, pickFile, readFileText, parseCSV, uid } from '../lib/utils'
import { showToast } from '../components/ui/Toast'
import ContactCard from '../components/contacts/ContactCard'
import ContactDrawer from '../components/contacts/ContactDrawer'
import ExportMenu from '../components/ui/ExportMenu'
import { exportContactsCSV, exportContactsXLSX, exportContactsPDF, exportContactsPPTX } from '../lib/exportUtils'
import type { Contact, Level } from '../types'

type SortKey = 'alpha' | 'level'

export default function ContactsPage() {
  const contacts = useAppStore(s => s.contacts)
  const importContacts = useAppStore(s => s.importContacts)
  const deleteContact = useAppStore(s => s.deleteContact)

  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('alpha')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [collapsedOrgs, setCollapsedOrgs] = useState<Set<string>>(new Set())
  const [drawerContact, setDrawerContact] = useState<string | null | undefined>(undefined) // undefined = closed

  const isDrawerOpen = drawerContact !== undefined

  const filtered = useMemo(() => {
    let list = [...contacts]
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.title ?? '').toLowerCase().includes(q) ||
        (c.org ?? '').toLowerCase().includes(q)
      )
    }
    if (sortKey === 'alpha') {
      list.sort((a, b) => sortDir === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name))
    } else {
      list.sort((a, b) => {
        const d = (LEVEL_ORDER[a.level as Level] ?? 99) - (LEVEL_ORDER[b.level as Level] ?? 99)
        return sortDir === 'asc' ? d || a.name.localeCompare(b.name) : -d || b.name.localeCompare(a.name)
      })
    }
    return list
  }, [contacts, search, sortKey, sortDir])

  // Group by org
  const groups = useMemo(() => {
    const orgMap: Record<string, typeof filtered> = {}
    const noOrg: typeof filtered = []
    filtered.forEach(c => {
      if (c.org) { if (!orgMap[c.org]) orgMap[c.org] = []; orgMap[c.org].push(c) }
      else noOrg.push(c)
    })
    return { orgMap, noOrg }
  }, [filtered])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const toggleOrg = (org: string) => {
    setCollapsedOrgs(prev => {
      const next = new Set(prev)
      next.has(org) ? next.delete(org) : next.add(org)
      return next
    })
  }

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Delete ${name}?`)) return
    deleteContact(id)
    showToast(`${name} deleted`)
  }

  const handleExportJSON = () => {
    downloadJSON(contacts, 'contacts.json')
    showToast('Contacts exported as JSON', 'success')
  }

  const handleImport = async () => {
    const file = await pickFile('.csv,.json')
    if (!file) return
    const text = await readFileText(file)
    const existing = new Set(contacts.map(c => c.name.toLowerCase().trim()))
    const toAdd: Contact[] = []

    if (file.name.endsWith('.json')) {
      let parsed: unknown
      try { parsed = JSON.parse(text) } catch { showToast('Invalid JSON file'); return }
      const arr = Array.isArray(parsed) ? parsed : [parsed]
      for (const item of arr) {
        if (typeof item !== 'object' || !item || !('name' in item)) continue
        const c = item as Partial<Contact>
        if (!c.name?.trim()) continue
        if (existing.has(c.name.toLowerCase().trim())) continue
        toAdd.push({ id: uid(), name: c.name.trim(), org: c.org ?? '', title: c.title ?? '', level: c.level ?? 'individual', email: c.email ?? '', phone: c.phone ?? '', parentId: c.parentId ?? '', createdAt: Date.now() })
        existing.add(c.name.toLowerCase().trim())
      }
    } else {
      // CSV: header row Name, Title, Organisation, Level, Email, Phone
      const rows = parseCSV(text)
      if (rows.length < 2) { showToast('CSV appears empty'); return }
      const header = rows[0].map(h => h.toLowerCase().trim())
      const col = (names: string[]) => names.map(n => header.indexOf(n)).find(i => i >= 0) ?? -1
      const iName  = col(['name'])
      const iTitle = col(['title', 'job title'])
      const iOrg   = col(['organisation', 'organization', 'company', 'org'])
      const iEmail = col(['email'])
      const iPhone = col(['phone', 'mobile'])
      if (iName < 0) { showToast('CSV must have a Name column'); return }
      for (const row of rows.slice(1)) {
        const name = row[iName]?.trim()
        if (!name) continue
        if (existing.has(name.toLowerCase())) continue
        toAdd.push({ id: uid(), name, org: iOrg >= 0 ? (row[iOrg] ?? '') : '', title: iTitle >= 0 ? (row[iTitle] ?? '') : '', level: 'individual', email: iEmail >= 0 ? (row[iEmail] ?? '') : '', phone: iPhone >= 0 ? (row[iPhone] ?? '') : '', parentId: '', createdAt: Date.now() })
        existing.add(name.toLowerCase())
      }
    }

    if (toAdd.length === 0) { showToast('No new contacts to import'); return }
    // Batch-add all contacts atomically
    importContacts(toAdd)
    showToast(`${toAdd.length} contact${toAdd.length !== 1 ? 's' : ''} imported`, 'success')
  }

  const sortLabel = (key: SortKey) => {
    if (sortKey !== key) return key === 'alpha' ? 'A–Z' : 'Level'
    if (key === 'alpha') return sortDir === 'asc' ? 'A–Z ↑' : 'Z–A ↓'
    return sortDir === 'asc' ? 'Level ↑' : 'Level ↓'
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 flex-shrink-0 px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-slate-900">
            Contacts
            <span className="ml-2 text-sm font-normal text-slate-400">{contacts.length}</span>
          </h1>
          <div className="flex items-center gap-2">
            <button onClick={handleImport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 active:bg-slate-100 min-h-[44px] transition-colors">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 5L2.5 9.5M7 5l4.5 4.5M7 5v8M1 1h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span className="hidden sm:inline">Import</span>
            </button>
            <ExportMenu
              onCSV={() => { exportContactsCSV(filtered); showToast('Contacts exported as CSV', 'success') }}
              onXLSX={() => { exportContactsXLSX(filtered, { contacts: [], positions: {}, dottedLines: [], peerLines: [] }).then(() => showToast('Contacts exported as Excel', 'success')).catch(() => showToast('Export failed')) }}
              onPDF={() => { exportContactsPDF(filtered, { contacts: [], positions: {}, dottedLines: [], peerLines: [] }).then(() => showToast('Contacts exported as PDF', 'success')).catch(() => showToast('Export failed')) }}
              onPPTX={() => { exportContactsPPTX(filtered, { contacts: [], positions: {}, dottedLines: [], peerLines: [] }).then(() => showToast('Contacts exported as PowerPoint', 'success')).catch(() => showToast('Export failed')) }}
            />
            <button onClick={handleExportJSON}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 active:bg-slate-100 min-h-[44px] transition-colors">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 9L2.5 4.5M7 9l4.5-4.5M7 9V1M1 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span className="hidden sm:inline">JSON</span>
            </button>
            <button onClick={() => setDrawerContact(null)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 active:bg-blue-700 min-h-[44px] transition-colors">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              Add
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" width="15" height="15" viewBox="0 0 15 15" fill="none">
            <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search contacts…"
            className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-slate-50 min-h-[44px]"
          />
        </div>

        {/* Sort pills */}
        <div className="flex gap-2 mt-2.5">
          {(['alpha', 'level'] as SortKey[]).map(key => (
            <button key={key} onClick={() => toggleSort(key)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors min-h-[36px] ${
                sortKey === key
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
              }`}>
              {sortLabel(key)}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto scroll-touch px-4 py-3 flex flex-col gap-1">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="20" r="8" stroke="currentColor" strokeWidth="2"/>
              <path d="M8 44c0-8.837 7.163-16 16-16s16 7.163 16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <div className="text-center">
              <p className="font-semibold text-slate-600">{search ? 'No results' : 'No contacts yet'}</p>
              <p className="text-sm mt-1">{search ? 'Try a different search' : 'Tap Add to create your first contact'}</p>
            </div>
          </div>
        ) : (
          <>
            {Object.keys(groups.orgMap).sort().map(org => (
              <div key={org} className="mb-1">
                {/* Org header */}
                <button
                  onClick={() => toggleOrg(org)}
                  className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-slate-100 active:bg-slate-200 transition-colors min-h-[44px]"
                >
                  <span className="text-slate-400 text-xs">{collapsedOrgs.has(org) ? '▶' : '▾'}</span>
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wide flex-1 text-left">{org}</span>
                  <span className="bg-slate-200 text-slate-500 rounded-full px-2 py-0.5 text-xs font-semibold">{groups.orgMap[org].length}</span>
                </button>
                {!collapsedOrgs.has(org) && (
                  <div className="flex flex-col gap-1.5 pl-2">
                    {groups.orgMap[org].map(c => (
                      <ContactCard key={c.id} contact={c}
                        onEdit={() => setDrawerContact(c.id)}
                        onDelete={() => handleDelete(c.id, c.name)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
            {groups.noOrg.map(c => (
              <ContactCard key={c.id} contact={c}
                onEdit={() => setDrawerContact(c.id)}
                onDelete={() => handleDelete(c.id, c.name)}
              />
            ))}
          </>
        )}
        {/* Bottom padding for mobile nav */}
        <div className="h-4 lg:hidden" />
      </div>

      {/* Contact drawer */}
      <ContactDrawer
        contactId={drawerContact ?? null}
        open={isDrawerOpen}
        onClose={() => setDrawerContact(undefined)}
      />
    </div>
  )
}
