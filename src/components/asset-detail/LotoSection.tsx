import { useEffect, useState } from 'react'
import { ShieldAlert, ShieldCheck, Lock, Unlock, Plus, X, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { LotoRecord } from '../../types'

export default function LotoSection({ assetId, facilityId, canEdit }: { assetId: string; facilityId: string; canEdit: boolean }) {
  const [records, setRecords] = useState<LotoRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [userRole, setUserRole] = useState<string | null>(null)

  const [form, setForm] = useState({
    loto_type: 'general_lockout' as 'general_lockout' | 'formal_loto',
    reason: '',
    applied_by_contact: '',
    physical_lock_id: '',
    isolation_points: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function fetchRecords() {
    const { data } = await supabase
      .from('loto_records')
      .select('*, profiles!loto_records_applied_by_user_id_fkey(name), cleared_by_profile:profiles!loto_records_cleared_by_user_id_fkey(name)')
      .eq('asset_id', assetId)
      .order('applied_at', { ascending: false })
    setRecords((data as LotoRecord[]) || [])
    setLoading(false)
  }

  useEffect(() => {
    fetchRecords()
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.rpc('get_facility_role', { p_facility_id: facilityId, p_user_id: user.id })
      if (data) setUserRole(data as string)
    })()
  }, [assetId, facilityId])

  async function handleCreate() {
    if (!form.reason.trim()) { setError('Reason is required'); return }
    setSaving(true); setError('')
    const { data: { user } } = await supabase.auth.getUser()
    const { error: err } = await supabase.from('loto_records').insert({
      asset_id: assetId, facility_id: facilityId,
      loto_type: form.loto_type, reason: form.reason.trim(),
      applied_by_user_id: user?.id || null,
      applied_by_contact: form.applied_by_contact || null,
      physical_lock_id: form.physical_lock_id || null,
      isolation_points: form.isolation_points || null,
      notes: form.notes || null,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setForm({ loto_type: 'general_lockout', reason: '', applied_by_contact: '', physical_lock_id: '', isolation_points: '', notes: '' })
    setShowForm(false)
    fetchRecords()
  }

  const [clearingId, setClearingId] = useState<string | null>(null)
  const [clearanceNotes, setClearanceNotes] = useState('')

  async function handleClear(record: LotoRecord) {
    const { data: { user } } = await supabase.auth.getUser()
    const { error: err } = await supabase.from('loto_records').update({
      status: 'cleared', cleared_at: new Date().toISOString(),
      cleared_by_user_id: user?.id || null,
      clearance_notes: clearanceNotes.trim() || null,
    }).eq('id', record.id)
    if (err) { alert(err.message); return }
    setClearingId(null); setClearanceNotes('')
    fetchRecords()
  }

  const activeRecords = records.filter(r => r.status === 'active')
  const canClear = (record: LotoRecord) => {
    if (!userRole) return false
    if (record.loto_type === 'formal_loto') return userRole === 'admin'
    return ['supervisor', 'admin'].includes(userRole)
  }

  if (loading) return <div className="text-center py-8"><div className="w-6 h-6 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin mx-auto" /></div>

  return (
    <div className="space-y-4">
      {/* Prominent LOTO summary */}
      {activeRecords.length > 0 ? (
        <div className="bg-error-50 border-2 border-error-200 rounded-2xl p-4">
          <div className="flex items-center gap-3">
            <ShieldAlert size={28} className="text-error-600 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-bold text-error-700">{activeRecords.length} Active Lock-Out{activeRecords.length > 1 ? 's' : ''}</p>
              <p className="text-xs text-error-600 mt-0.5">
                {activeRecords.map(r => r.loto_type === 'formal_loto' ? 'Formal LOTO' : 'General Lock-Out').join(', ')}
              </p>
            </div>
          </div>
          {activeRecords.some(r => r.loto_type === 'formal_loto') && (
            <div className="mt-3 bg-error-100 rounded-xl p-3">
              <p className="text-xs font-semibold text-error-700 flex items-center gap-1.5">
                <AlertTriangle size={14} /> Formal LOTO Disclaimer
              </p>
              <p className="text-xs text-error-600 mt-1">
                This application record does NOT authorize physical lock removal. Follow your facility's formal LOTO procedure.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-success-50 border border-success-200 rounded-2xl p-4">
          <div className="flex items-center gap-3">
            <ShieldCheck size={24} className="text-success-600 shrink-0" />
            <p className="text-sm font-medium text-success-700">No active lock-outs</p>
          </div>
        </div>
      )}

      {/* Create button */}
      {canEdit && !showForm && (
        <button onClick={() => setShowForm(true)}
          className="w-full flex items-center justify-center gap-2 bg-white border-2 border-dashed border-neutral-200 hover:border-primary-300 hover:bg-primary-50/50 text-neutral-700 py-3 rounded-xl text-sm font-medium transition-all">
          <Plus size={16} /> Add Lock-Out Record
        </button>
      )}

      {/* Create form */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-neutral-800">New Lock-Out Record</h3>
            <button onClick={() => setShowForm(false)} className="p-1 hover:bg-neutral-100 rounded-lg"><X size={18} /></button>
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600">Type</label>
            <select value={form.loto_type} onChange={(e) => setForm(f => ({ ...f, loto_type: e.target.value as 'general_lockout' | 'formal_loto' }))}
              className="w-full mt-1 px-3 py-2 border border-neutral-200 rounded-xl text-sm">
              <option value="general_lockout">General Lock-Out</option>
              <option value="formal_loto">Formal LOTO (Life Safety)</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600">Reason *</label>
            <input value={form.reason} onChange={(e) => setForm(f => ({ ...f, reason: e.target.value }))}
              className="w-full mt-1 px-3 py-2 border border-neutral-200 rounded-xl text-sm" placeholder="Why is this lock-out applied?" />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600">Applied By (contact name, if not you)</label>
            <input value={form.applied_by_contact} onChange={(e) => setForm(f => ({ ...f, applied_by_contact: e.target.value }))}
              className="w-full mt-1 px-3 py-2 border border-neutral-200 rounded-xl text-sm" placeholder="External contact" />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600">Physical Lock/Tag ID</label>
            <input value={form.physical_lock_id} onChange={(e) => setForm(f => ({ ...f, physical_lock_id: e.target.value }))}
              className="w-full mt-1 px-3 py-2 border border-neutral-200 rounded-xl text-sm" placeholder="Lock/tag identifier" />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600">Isolation Points</label>
            <textarea value={form.isolation_points} onChange={(e) => setForm(f => ({ ...f, isolation_points: e.target.value }))}
              className="w-full mt-1 px-3 py-2 border border-neutral-200 rounded-xl text-sm" rows={2} placeholder="Describe isolation points" />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600">Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full mt-1 px-3 py-2 border border-neutral-200 rounded-xl text-sm" rows={2} />
          </div>
          {form.loto_type === 'formal_loto' && (
            <div className="bg-error-50 border border-error-100 rounded-xl p-2">
              <p className="text-xs text-error-600">Formal LOTO: this record does NOT authorize physical lock removal.</p>
            </div>
          )}
          {error && <p className="text-xs text-error-600">{error}</p>}
          <button onClick={handleCreate} disabled={saving || !form.reason.trim()}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-primary-500 to-primary-600 text-white py-2.5 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md shadow-primary-200">
            {saving ? 'Saving...' : 'Create Record'}
          </button>
        </div>
      )}

      {/* History list */}
      <div className="space-y-2">
        {records.map((rec) => (
          <div key={rec.id} className={`bg-white rounded-2xl border p-4 ${rec.status === 'active' ? 'border-error-200' : 'border-neutral-200'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <Lock size={16} className={rec.status === 'active' ? 'text-error-500' : 'text-neutral-400'} />
                <div>
                  <p className="text-sm font-medium text-neutral-800">
                    {rec.loto_type === 'formal_loto' ? 'Formal LOTO' : 'General Lock-Out'}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {new Date(rec.applied_at).toLocaleString()} by{' '}
                    {(rec as any).profiles?.name || rec.applied_by_contact || 'Unknown'}
                  </p>
                </div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${rec.status === 'active' ? 'bg-error-100 text-error-700' : 'bg-neutral-100 text-neutral-600'}`}>
                {rec.status}
              </span>
            </div>
            <p className="text-sm text-neutral-700 mt-2">{rec.reason}</p>
            {rec.isolation_points && <p className="text-xs text-neutral-500 mt-1">Isolation: {rec.isolation_points}</p>}
            {rec.physical_lock_id && <p className="text-xs text-neutral-500 mt-0.5">Lock ID: {rec.physical_lock_id}</p>}
            {rec.notes && <p className="text-xs text-neutral-500 mt-1">Notes: {rec.notes}</p>}
            {rec.status === 'cleared' && (
              <div className="mt-2 pt-2 border-t border-neutral-100">
                <p className="text-xs text-neutral-500">
                  Cleared by {(rec as any).cleared_by_profile?.name || rec.cleared_by_contact || 'Unknown'} at {rec.cleared_at && new Date(rec.cleared_at).toLocaleString()}
                </p>
                {rec.clearance_notes && <p className="text-xs text-neutral-500 mt-0.5">Clearance notes: {rec.clearance_notes}</p>}
              </div>
            )}
            {rec.status === 'active' && canClear(rec) && clearingId !== rec.id && (
              <button onClick={() => { setClearingId(rec.id); setClearanceNotes('') }}
                className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 px-2 py-1 rounded-lg hover:bg-primary-50">
                <Unlock size={14} /> Clear Lock-Out
              </button>
            )}
            {rec.status === 'active' && canClear(rec) && clearingId === rec.id && (
              <div className="mt-2 pt-2 border-t border-neutral-100 space-y-2">
                <p className="text-xs font-medium text-neutral-700">Clearance Notes</p>
                <textarea value={clearanceNotes} onChange={(e) => setClearanceNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-200 rounded-xl text-sm" rows={2}
                  placeholder="Optional notes about clearance..." />
                <div className="flex gap-2">
                  <button onClick={() => handleClear(rec)}
                    className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 px-3 py-1.5 rounded-lg bg-primary-50 hover:bg-primary-100">
                    <Unlock size={14} /> Confirm Clear
                  </button>
                  <button onClick={() => { setClearingId(null); setClearanceNotes('') }}
                    className="text-xs text-neutral-500 hover:text-neutral-700 px-3 py-1.5 rounded-lg hover:bg-neutral-100">
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {rec.status === 'active' && !canClear(rec) && (
              <p className="text-xs text-neutral-400 mt-2">
                {rec.loto_type === 'formal_loto' ? 'Only admins can clear formal LOTO' : 'Supervisor+ required to clear'}
              </p>
            )}
          </div>
        ))}
        {records.length === 0 && !showForm && (
          <p className="text-center text-sm text-neutral-400 py-4">No LOTO history</p>
        )}
      </div>
    </div>
  )
}
