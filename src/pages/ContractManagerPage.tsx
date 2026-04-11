import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { uid } from '../lib/utils'
import type { Contract, ContractNotification, ContractType, PaymentTerms, BillingModel } from '../types'

const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  'master-agreement': 'Master Agreement',
  'sow':              'SOW',
  'amendment':        'Amendment',
  'renewal':          'Renewal',
}

const PAYMENT_TERM_LABELS: Record<PaymentTerms, string> = {
  'net-30':    'Net 30',
  'net-60':    'Net 60',
  'net-90':    'Net 90',
  'upfront':   'Upfront',
  'milestone': 'Milestone',
  'custom':    'Custom',
}

const BILLING_LABELS: Record<BillingModel, string> = {
  'subscription': 'Subscription',
  'one-time':     'One-Time',
  'mixed':        'Mixed',
}

const TYPE_COLORS: Record<ContractType, string> = {
  'master-agreement': 'bg-blue-100 text-blue-700',
  'sow':              'bg-purple-100 text-purple-700',
  'amendment':        'bg-amber-100 text-amber-700',
  'renewal':          'bg-green-100 text-green-700',
}

const fmt = (n: number) =>
  `$${n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

function daysUntil(dateStr: string): number {
  const d = new Date(dateStr)
  const now = new Date()
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

function emptyContract(): Omit<Contract, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    contractNumber: '',
    type: 'master-agreement',
    customerName: '',
    title: '',
    startDate: '',
    endDate: '',
    contractValueUsd: 0,
    billingModel: 'subscription',
    paymentTerms: 'net-30',
    customPaymentTerms: '',
    specialTerms: '',
    notifications: [],
    notes: '',
    parentContractId: '',
  }
}

export default function ContractManagerPage() {
  const contracts      = useAppStore(s => s.contracts)
  const addContract    = useAppStore(s => s.addContract)
  const updateContract = useAppStore(s => s.updateContract)
  const deleteContract = useAppStore(s => s.deleteContract)

  const [activeId, setActiveId]   = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [draft, setDraft]         = useState(emptyContract())
  const [editId, setEditId]       = useState<string | null>(null)
  const [search, setSearch]       = useState('')
  const [filterType, setFilterType] = useState<ContractType | 'all'>('all')
  const [tab, setTab]             = useState<'details' | 'notifications'>('details')

  const sorted = [...contracts]
    .filter(c => {
      const matchSearch = c.customerName.toLowerCase().includes(search.toLowerCase()) ||
        c.title.toLowerCase().includes(search.toLowerCase()) ||
        c.contractNumber.toLowerCase().includes(search.toLowerCase())
      const matchType = filterType === 'all' || c.type === filterType
      return matchSearch && matchType
    })
    .sort((a, b) => {
      if (a.endDate && b.endDate) return a.endDate.localeCompare(b.endDate)
      return b.createdAt - a.createdAt
    })

  const active = contracts.find(c => c.id === activeId) ?? null

  // Upcoming notifications across all contracts
  const upcomingNotifications = contracts
    .flatMap(c => c.notifications.map(n => ({ ...n, contractId: c.id, contractTitle: c.title, customerName: c.customerName })))
    .filter(n => !n.notified && daysUntil(n.date) <= 30 && daysUntil(n.date) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))

  function openNew() {
    setEditId(null)
    setDraft(emptyContract())
    setShowModal(true)
    setTab('details')
  }

  function openEdit(c: Contract) {
    setEditId(c.id)
    setDraft({
      contractNumber: c.contractNumber,
      type: c.type,
      customerName: c.customerName,
      title: c.title,
      startDate: c.startDate,
      endDate: c.endDate,
      contractValueUsd: c.contractValueUsd,
      billingModel: c.billingModel,
      paymentTerms: c.paymentTerms,
      customPaymentTerms: c.customPaymentTerms ?? '',
      specialTerms: c.specialTerms ?? '',
      notifications: c.notifications.map(n => ({ ...n })),
      notes: c.notes ?? '',
      parentContractId: c.parentContractId ?? '',
    })
    setShowModal(true)
    setTab('details')
  }

  function save() {
    if (!draft.customerName.trim() || !draft.title.trim()) return
    const ts = Date.now()
    const payload: Omit<Contract, 'id' | 'createdAt'> = {
      ...draft,
      parentContractId: draft.parentContractId || undefined,
      customPaymentTerms: draft.paymentTerms === 'custom' ? draft.customPaymentTerms : undefined,
      updatedAt: ts,
    }
    if (editId) {
      updateContract({ id: editId, ...payload, createdAt: contracts.find(c => c.id === editId)!.createdAt })
    } else {
      const id = uid()
      addContract({ id, ...payload, createdAt: ts })
      setActiveId(id)
    }
    setShowModal(false)
  }

  function addNotification() {
    const n: ContractNotification = { id: uid(), label: '', date: '', notified: false }
    setDraft(d => ({ ...d, notifications: [...d.notifications, n] }))
  }

  function setNotif(idx: number, patch: Partial<ContractNotification>) {
    setDraft(d => ({
      ...d,
      notifications: d.notifications.map((n, i) => i === idx ? { ...n, ...patch } : n),
    }))
  }

  function toggleNotified(contractId: string, notifId: string) {
    const c = contracts.find(x => x.id === contractId)
    if (!c) return
    updateContract({
      ...c,
      notifications: c.notifications.map(n => n.id === notifId ? { ...n, notified: !n.notified } : n),
      updatedAt: Date.now(),
    })
  }

  function statusBadge(c: Contract) {
    if (!c.endDate) return null
    const days = daysUntil(c.endDate)
    if (days < 0) return <span className="text-[10px] bg-slate-100 text-slate-500 font-semibold px-2 py-0.5 rounded-full">Expired</span>
    if (days <= 30) return <span className="text-[10px] bg-red-100 text-red-600 font-semibold px-2 py-0.5 rounded-full">{days}d left</span>
    if (days <= 90) return <span className="text-[10px] bg-amber-100 text-amber-600 font-semibold px-2 py-0.5 rounded-full">{days}d left</span>
    return <span className="text-[10px] bg-green-100 text-green-600 font-semibold px-2 py-0.5 rounded-full">Active</span>
  }

  // Group active contract's SOWs
  const sowsForActive = active
    ? contracts.filter(c => c.parentContractId === active.id && c.type === 'sow')
    : []

  const masterContracts = contracts.filter(c => c.type === 'master-agreement')

  return (
    <div className="flex h-full overflow-hidden bg-slate-100">

      {/* Left pane */}
      <div className="w-72 flex-shrink-0 flex flex-col bg-white border-r border-slate-200 overflow-hidden">
        <div className="p-3 border-b border-slate-100 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-800 text-sm">Contracts</h2>
            <button onClick={openNew}
              className="flex items-center gap-1 text-xs bg-blue-500 hover:bg-blue-600 text-white px-2.5 py-1.5 rounded-lg font-semibold transition-colors">
              + New
            </button>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <div className="flex gap-1 flex-wrap">
            {(['all', 'master-agreement', 'sow', 'amendment', 'renewal'] as const).map(t => (
              <button key={t} onClick={() => setFilterType(t)}
                className={`text-[11px] px-2 py-0.5 rounded-full font-semibold transition-colors ${filterType === t ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                {t === 'all' ? 'All' : CONTRACT_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {/* Upcoming alerts */}
        {upcomingNotifications.length > 0 && (
          <div className="mx-2 mt-2 bg-amber-50 border border-amber-200 rounded-xl p-2.5">
            <p className="text-[11px] font-bold text-amber-700 mb-1">Upcoming Notifications</p>
            {upcomingNotifications.slice(0, 3).map(n => (
              <div key={n.id} className="text-[11px] text-amber-600 flex justify-between">
                <span className="truncate max-w-[120px]">{n.label} — {n.contractTitle}</span>
                <span className="font-semibold ml-1">{daysUntil(n.date)}d</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
          {sorted.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-8">No contracts</p>
          )}
          {sorted.map(c => (
            <button key={c.id} onClick={() => setActiveId(c.id)}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-colors ${activeId === c.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-slate-50 border border-transparent'}`}>
              <div className="flex items-start justify-between gap-1">
                <p className="font-semibold text-slate-800 truncate flex-1">{c.title}</p>
                {statusBadge(c)}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">{c.customerName}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${TYPE_COLORS[c.type]}`}>
                  {CONTRACT_TYPE_LABELS[c.type]}
                </span>
                {c.contractNumber && (
                  <span className="text-[10px] text-slate-400">{c.contractNumber}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right pane — detail */}
      <div className="flex-1 overflow-y-auto">
        {!active ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-slate-400 text-sm">Select a contract or create a new one</p>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto p-6 flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TYPE_COLORS[active.type]}`}>
                    {CONTRACT_TYPE_LABELS[active.type]}
                  </span>
                  {active.contractNumber && (
                    <span className="text-xs text-slate-400 font-mono">{active.contractNumber}</span>
                  )}
                  {statusBadge(active)}
                </div>
                <h1 className="text-xl font-bold text-slate-900">{active.title}</h1>
                <p className="text-sm text-slate-500 mt-0.5">{active.customerName}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(active)}
                  className="text-xs border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-lg font-semibold text-slate-600 transition-colors">
                  Edit
                </button>
                <button onClick={() => { if (confirm('Delete this contract?')) { deleteContract(active.id); setActiveId(null) } }}
                  className="text-xs border border-red-200 hover:bg-red-50 px-3 py-1.5 rounded-lg font-semibold text-red-500 transition-colors">
                  Delete
                </button>
              </div>
            </div>

            {/* Key info tiles */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <InfoTile label="Contract Value" value={fmt(active.contractValueUsd)} />
              <InfoTile label="Billing Model" value={BILLING_LABELS[active.billingModel]} />
              <InfoTile label="Payment Terms"
                value={active.paymentTerms === 'custom' ? (active.customPaymentTerms || 'Custom') : PAYMENT_TERM_LABELS[active.paymentTerms]} />
              <InfoTile label="Duration"
                value={active.startDate && active.endDate
                  ? `${active.startDate} → ${active.endDate}`
                  : active.startDate || '—'} />
            </div>

            {/* Special terms */}
            {active.specialTerms && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-xs font-bold text-amber-700 mb-1">Special Terms</p>
                <p className="text-sm text-amber-800 whitespace-pre-wrap">{active.specialTerms}</p>
              </div>
            )}

            {/* Notes */}
            {active.notes && (
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="text-xs font-bold text-slate-500 mb-1">Notes</p>
                <p className="text-sm text-slate-600 whitespace-pre-wrap">{active.notes}</p>
              </div>
            )}

            {/* Notifications */}
            {active.notifications.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Notifications</p>
                </div>
                <div className="divide-y divide-slate-100">
                  {active.notifications.map(n => {
                    const days = n.date ? daysUntil(n.date) : null
                    return (
                      <div key={n.id} className={`px-4 py-3 flex items-center justify-between ${n.notified ? 'opacity-50' : ''}`}>
                        <div>
                          <p className="text-sm font-medium text-slate-700">{n.label}</p>
                          <p className="text-xs text-slate-400">{n.date}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          {days !== null && !n.notified && (
                            <span className={`text-xs font-semibold ${days < 0 ? 'text-slate-400' : days <= 30 ? 'text-red-500' : days <= 90 ? 'text-amber-500' : 'text-slate-400'}`}>
                              {days < 0 ? 'Past' : `${days}d away`}
                            </span>
                          )}
                          <button onClick={() => toggleNotified(active.id, n.id)}
                            className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors ${n.notified ? 'bg-slate-100 text-slate-400 hover:bg-slate-200' : 'bg-green-50 text-green-600 hover:bg-green-100 border border-green-200'}`}>
                            {n.notified ? 'Mark pending' : 'Mark done'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* SOWs under this master agreement */}
            {active.type === 'master-agreement' && sowsForActive.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Statements of Work</p>
                  <span className="text-xs text-slate-400">{sowsForActive.length}</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {sowsForActive.map(sow => (
                    <button key={sow.id} onClick={() => setActiveId(sow.id)}
                      className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50 transition-colors">
                      <div>
                        <p className="text-sm font-medium text-slate-700">{sow.title}</p>
                        <p className="text-xs text-slate-400">{sow.startDate} → {sow.endDate}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-600">{fmt(sow.contractValueUsd)}</span>
                        {statusBadge(sow)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-[3vh] px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[94vh]">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <h3 className="font-bold text-slate-900">{editId ? 'Edit Contract' : 'New Contract'}</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg">✕</button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-100 px-5 flex-shrink-0">
              {(['details', 'notifications'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${tab === t ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                  {t === 'details' ? 'Details' : 'Notifications'}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {tab === 'details' && (
                <div className="flex flex-col gap-4">
                  {/* Row 1: type + number */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-slate-500">Type</label>
                      <select value={draft.type}
                        onChange={e => setDraft(d => ({ ...d, type: e.target.value as ContractType }))}
                        className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                        {(Object.entries(CONTRACT_TYPE_LABELS) as [ContractType, string][]).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-slate-500">Contract Number</label>
                      <input value={draft.contractNumber}
                        onChange={e => setDraft(d => ({ ...d, contractNumber: e.target.value }))}
                        placeholder="e.g. MSA-2024-001"
                        className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  </div>

                  {/* Customer + Title */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-500">Customer Name</label>
                    <input value={draft.customerName}
                      onChange={e => setDraft(d => ({ ...d, customerName: e.target.value }))}
                      placeholder="Acme Corporation"
                      className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-500">Title</label>
                    <input value={draft.title}
                      onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                      placeholder="e.g. Master Services Agreement"
                      className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>

                  {/* Dates */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-slate-500">Start Date</label>
                      <input type="date" value={draft.startDate}
                        onChange={e => setDraft(d => ({ ...d, startDate: e.target.value }))}
                        className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-slate-500">End Date</label>
                      <input type="date" value={draft.endDate}
                        onChange={e => setDraft(d => ({ ...d, endDate: e.target.value }))}
                        className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  </div>

                  {/* Value + Billing */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-slate-500">Contract Value (USD)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                        <input type="number" min="0" step="1" value={draft.contractValueUsd}
                          onChange={e => setDraft(d => ({ ...d, contractValueUsd: parseFloat(e.target.value) || 0 }))}
                          className="w-full pl-7 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-slate-500">Billing Model</label>
                      <select value={draft.billingModel}
                        onChange={e => setDraft(d => ({ ...d, billingModel: e.target.value as BillingModel }))}
                        className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                        {(Object.entries(BILLING_LABELS) as [BillingModel, string][]).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Payment terms */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-500">Payment Terms</label>
                    <select value={draft.paymentTerms}
                      onChange={e => setDraft(d => ({ ...d, paymentTerms: e.target.value as PaymentTerms }))}
                      className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                      {(Object.entries(PAYMENT_TERM_LABELS) as [PaymentTerms, string][]).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                    {draft.paymentTerms === 'custom' && (
                      <input value={draft.customPaymentTerms ?? ''}
                        onChange={e => setDraft(d => ({ ...d, customPaymentTerms: e.target.value }))}
                        placeholder="Describe payment terms…"
                        className="mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    )}
                  </div>

                  {/* Parent contract (for SOWs/amendments) */}
                  {(draft.type === 'sow' || draft.type === 'amendment' || draft.type === 'renewal') && masterContracts.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold text-slate-500">Parent Master Agreement</label>
                      <select value={draft.parentContractId ?? ''}
                        onChange={e => setDraft(d => ({ ...d, parentContractId: e.target.value }))}
                        className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">— None —</option>
                        {masterContracts.map(c => (
                          <option key={c.id} value={c.id}>{c.title} ({c.customerName})</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Special terms */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-500">Special Terms</label>
                    <textarea value={draft.specialTerms ?? ''}
                      onChange={e => setDraft(d => ({ ...d, specialTerms: e.target.value }))}
                      rows={3} placeholder="Any special terms or conditions…"
                      className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                  </div>

                  {/* Notes */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-500">Notes</label>
                    <textarea value={draft.notes ?? ''}
                      onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
                      rows={2} placeholder="Internal notes…"
                      className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                  </div>
                </div>
              )}

              {tab === 'notifications' && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-slate-600">Add dates you want to be reminded about — renewal windows, notice periods, etc.</p>
                    <button onClick={addNotification}
                      className="text-xs text-blue-600 hover:text-blue-700 font-semibold flex-shrink-0">+ Add</button>
                  </div>

                  {draft.notifications.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-6">No notifications. Click + Add to create one.</p>
                  )}

                  {draft.notifications.map((n, idx) => (
                    <div key={n.id} className="bg-slate-50 rounded-xl p-3 flex gap-2 items-start">
                      <div className="flex-1 flex flex-col gap-2">
                        <input value={n.label}
                          onChange={e => setNotif(idx, { label: e.target.value })}
                          placeholder="e.g. Renewal Notice, Contract Ending…"
                          className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        <input type="date" value={n.date}
                          onChange={e => setNotif(idx, { date: e.target.value })}
                          className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-48" />
                      </div>
                      <button onClick={() => setDraft(d => ({ ...d, notifications: d.notifications.filter((_, i) => i !== idx) }))}
                        className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors mt-0.5">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2 flex-shrink-0">
              <button onClick={() => setShowModal(false)}
                className="text-sm border border-slate-200 px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={save} disabled={!draft.customerName.trim() || !draft.title.trim()}
                className="text-sm bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white px-4 py-2 rounded-lg font-semibold transition-colors">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col gap-0.5">
      <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide">{label}</p>
      <p className="text-sm font-bold text-slate-800">{value}</p>
    </div>
  )
}
