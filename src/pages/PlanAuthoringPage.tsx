import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Pencil, Check, Loader2, MapPin, FileText, Layers, Save } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useFacility } from '../context/FacilityContext'
import { useAuth } from '../context/AuthContext'
import type { PlanDocument, PlanRevision, PlanMarker, Asset } from '../types'

export default function PlanAuthoringPage() {
  const { currentFacility } = useFacility()
  const { profile } = useAuth()
  const [documents, setDocuments] = useState<PlanDocument[]>([])
  const [selectedDoc, setSelectedDoc] = useState<PlanDocument | null>(null)
  const [revisions, setRevisions] = useState<PlanRevision[]>([])
  const [markers, setMarkers] = useState<PlanMarker[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [showCreateDoc, setShowCreateDoc] = useState(false)
  const [newDocName, setNewDocName] = useState('')
  const [newDocUrl, setNewDocUrl] = useState('')
  const [creatingDoc, setCreatingDoc] = useState(false)
  const [error, setError] = useState('')
  const [showCreateRev, setShowCreateRev] = useState(false)
  const [newRevNumber, setNewRevNumber] = useState('')
  const [newRevUrl, setNewRevUrl] = useState('')
  const [newRevPages, setNewRevPages] = useState('')
  const [creatingRev, setCreatingRev] = useState(false)
  const [showMarkerForm, setShowMarkerForm] = useState(false)
  const [editingMarker, setEditingMarker] = useState<PlanMarker | null>(null)
  const [markerPage, setMarkerPage] = useState('1')
  const [markerX, setMarkerX] = useState('')
  const [markerY, setMarkerY] = useState('')
  const [markerZ, setMarkerZ] = useState('')
  const [markerLabel, setMarkerLabel] = useState('')
  const [markerAssetId, setMarkerAssetId] = useState('')
  const [savingMarker, setSavingMarker] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    if (currentFacility) fetchDocuments()
  }, [currentFacility])

  useEffect(() => {
    if (!profile || !currentFacility) return
    supabase.from('facility_members').select('role').eq('facility_id', currentFacility.id).eq('user_id', profile.id).maybeSingle()
      .then(({ data }) => setUserRole(data?.role || null))
  }, [profile, currentFacility])

  const canEdit = userRole === 'admin' || userRole === 'supervisor' || userRole === 'contributor'
  const canDeleteMarker = userRole === 'admin' || userRole === 'supervisor'

  async function fetchDocuments() {
    if (!currentFacility) return
    setLoading(true)
    const { data } = await supabase.from('plan_documents').select('*').eq('facility_id', currentFacility.id).order('name')
    setDocuments(data || [])
    setLoading(false)
  }

  const selectDoc = useCallback((doc: PlanDocument) => {
    setSelectedDoc(doc)
    setShowCreateRev(false)
    setShowMarkerForm(false)
    setEditingMarker(null)
    Promise.all([
      supabase.from('plan_revisions').select('*').eq('plan_document_id', doc.id).order('created_at', { ascending: false }),
      supabase.from('plan_markers').select('*, assets(id, equipment_name, asset_tag)').eq('plan_document_id', doc.id).order('page_number'),
      supabase.from('assets').select('*').eq('facility_id', doc.facility_id).limit(100),
    ]).then(([revRes, markerRes, assetRes]) => {
      setRevisions(revRes.data || [])
      setMarkers(markerRes.data || [])
      setAssets(assetRes.data || [])
    })
  }, [])

  async function handleCreateDoc() {
    if (!newDocName.trim() || !currentFacility) { setError('Name is required'); return }
    setCreatingDoc(true)
    setError('')
    const { data, error: err } = await supabase.from('plan_documents')
      .insert({ facility_id: currentFacility.id, name: newDocName.trim(), external_url: newDocUrl.trim() || null, created_by: profile?.id || null })
      .select().maybeSingle()
    if (err) { setError(err.message); setCreatingDoc(false); return }
    setShowCreateDoc(false)
    setNewDocName('')
    setNewDocUrl('')
    setCreatingDoc(false)
    await fetchDocuments()
    if (data) selectDoc(data)
  }

  async function handleCreateRev() {
    if (!newRevNumber.trim() || !selectedDoc) return
    setCreatingRev(true)
    await supabase.from('plan_revisions').update({ is_current: false }).eq('plan_document_id', selectedDoc.id).eq('is_current', true)
    const { data } = await supabase.from('plan_revisions')
      .insert({ plan_document_id: selectedDoc.id, revision_number: newRevNumber.trim(), external_url: newRevUrl.trim() || null, page_count: newRevPages ? Number(newRevPages) : null, is_current: true, created_by: profile?.id || null })
      .select().maybeSingle()
    if (data) {
      await supabase.from('plan_documents').update({ current_revision_id: data.id }).eq('id', selectedDoc.id)
    }
    setShowCreateRev(false)
    setNewRevNumber('')
    setNewRevUrl('')
    setNewRevPages('')
    setCreatingRev(false)
    selectDoc({ ...selectedDoc, current_revision_id: data?.id || null })
  }

  async function setCurrentRev(rev: PlanRevision) {
    await supabase.from('plan_revisions').update({ is_current: false }).eq('plan_document_id', rev.plan_document_id).eq('is_current', true)
    await supabase.from('plan_revisions').update({ is_current: true }).eq('id', rev.id)
    await supabase.from('plan_documents').update({ current_revision_id: rev.id }).eq('id', rev.plan_document_id)
    if (selectedDoc) selectDoc({ ...selectedDoc, current_revision_id: rev.id })
  }

  function startAddMarker() {
    setEditingMarker(null)
    setMarkerPage(String(currentPage))
    setMarkerX('')
    setMarkerY('')
    setMarkerZ('')
    setMarkerLabel('')
    setMarkerAssetId('')
    setShowMarkerForm(true)
  }

  function startEditMarker(m: PlanMarker) {
    setEditingMarker(m)
    setMarkerPage(String(m.page_number))
    setMarkerX(String(m.x))
    setMarkerY(String(m.y))
    setMarkerZ(m.z != null ? String(m.z) : '')
    setMarkerLabel(m.label || '')
    setMarkerAssetId(m.asset_id || '')
    setShowMarkerForm(true)
  }

  async function saveMarker() {
    if (!selectedDoc || !currentFacility) return
    const x = Number(markerX)
    const y = Number(markerY)
    const z = markerZ.trim() === '' ? null : Number(markerZ)
    if (!isFinite(x) || !isFinite(y)) { setError('X and Y must be valid numbers'); return }
    setSavingMarker(true)
    setError('')
    const payload = {
      plan_document_id: selectedDoc.id,
      facility_id: currentFacility.id,
      page_number: Number(markerPage) || 1,
      x, y, z,
      label: markerLabel.trim() || null,
      asset_id: markerAssetId || null,
      created_by: profile?.id || null,
    }
    if (editingMarker) {
      await supabase.from('plan_markers').update({ page_number: payload.page_number, x, y, z, label: payload.label, asset_id: payload.asset_id }).eq('id', editingMarker.id)
    } else {
      await supabase.from('plan_markers').insert(payload)
    }
    setSavingMarker(false)
    setShowMarkerForm(false)
    setEditingMarker(null)
    const { data } = await supabase.from('plan_markers').select('*, assets(id, equipment_name, asset_tag)').eq('plan_document_id', selectedDoc.id).order('page_number')
    setMarkers(data || [])
  }

  async function deleteMarker(m: PlanMarker) {
    await supabase.from('plan_markers').delete().eq('id', m.id)
    setMarkers(prev => prev.filter(x => x.id !== m.id))
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
    </div>
  )

  const inputCls = 'w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400'
  const pageMarkers = markers.filter(m => m.page_number === currentPage)
  const pages = [...new Set(markers.map(m => m.page_number))].sort((a, b) => a - b)

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900 flex items-center gap-2"><Layers size={24} /> Plans</h1>
          <p className="text-sm text-neutral-500 mt-1">Manage plan documents, revisions, and asset markers</p>
        </div>
        {canEdit && !showCreateDoc && (
          <button onClick={() => setShowCreateDoc(true)} className="bg-gradient-to-r from-primary-500 to-primary-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:from-primary-600 hover:to-primary-700 flex items-center gap-2 shadow-md shadow-primary-200">
            <Plus size={16} /> New Plan
          </button>
        )}
      </div>

      {showCreateDoc && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm mb-6 space-y-3">
          <h3 className="text-sm font-semibold text-neutral-900">Create Plan Document</h3>
          <p className="text-xs text-neutral-500">Enter plan metadata. PDF file upload requires storage configuration — use an external URL for now.</p>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Name</label>
            <input type="text" value={newDocName} onChange={e => setNewDocName(e.target.value)} placeholder="e.g. Level 1 Mechanical Plan" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">External URL (optional)</label>
            <input type="url" value={newDocUrl} onChange={e => setNewDocUrl(e.target.value)} placeholder="https://..." className={inputCls} />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={handleCreateDoc} disabled={creatingDoc} className="bg-primary-500 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-primary-600 disabled:opacity-50 flex items-center gap-2">
              {creatingDoc ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Create
            </button>
            <button onClick={() => { setShowCreateDoc(false); setError('') }} className="border border-neutral-200 text-neutral-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-neutral-50">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-2">
          {documents.length === 0 && <p className="text-sm text-neutral-400 text-center py-8">No plan documents yet</p>}
          {documents.map(d => (
            <button key={d.id} onClick={() => selectDoc(d)}
              className={`w-full text-left p-4 rounded-xl border transition-colors ${
                selectedDoc?.id === d.id ? 'border-primary-300 bg-primary-50' : 'border-neutral-200 bg-white hover:bg-neutral-50'}`}>
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-neutral-400" />
                <p className="text-sm font-medium text-neutral-900">{d.name}</p>
              </div>
              {d.external_url && <p className="text-xs text-sky-500 mt-1 truncate">{d.external_url}</p>}
            </button>
          ))}
        </div>

        <div className="lg:col-span-2">
          {selectedDoc ? (
            <div className="space-y-4">
              {/* Revisions */}
              <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-neutral-900">Revisions</h3>
                  {canEdit && !showCreateRev && (
                    <button onClick={() => setShowCreateRev(true)} className="text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1">
                      <Plus size={14} /> New Revision
                    </button>
                  )}
                </div>
                {showCreateRev && (
                  <div className="space-y-2 mb-3 border border-neutral-100 rounded-xl p-3 bg-neutral-50">
                    <div className="grid grid-cols-3 gap-2">
                      <input type="text" value={newRevNumber} onChange={e => setNewRevNumber(e.target.value)} placeholder="Rev #" className={inputCls} />
                      <input type="number" value={newRevPages} onChange={e => setNewRevPages(e.target.value)} placeholder="Pages" className={inputCls} />
                      <input type="url" value={newRevUrl} onChange={e => setNewRevUrl(e.target.value)} placeholder="URL (optional)" className={inputCls} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={handleCreateRev} disabled={creatingRev || !newRevNumber.trim()} className="bg-primary-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-primary-600 disabled:opacity-50 flex items-center gap-1">
                        {creatingRev ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Create
                      </button>
                      <button onClick={() => setShowCreateRev(false)} className="border border-neutral-200 text-neutral-600 px-3 py-1.5 rounded-lg text-xs">Cancel</button>
                    </div>
                  </div>
                )}
                {revisions.length === 0 && <p className="text-xs text-neutral-400">No revisions yet</p>}
                <div className="space-y-1">
                  {revisions.map(r => (
                    <div key={r.id} className="flex items-center gap-2 bg-neutral-50 rounded-lg px-3 py-2">
                      <span className="text-sm font-medium text-neutral-800">Rev {r.revision_number}</span>
                      {r.page_count != null && <span className="text-xs text-neutral-500">{r.page_count} pages</span>}
                      {r.is_current ? <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">Current</span>
                        : canEdit && <button onClick={() => setCurrentRev(r)} className="text-xs text-primary-600 hover:text-primary-700">Set Current</button>}
                      {r.external_url && <a href={r.external_url} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-500 ml-auto">Open</a>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Markers */}
              <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-neutral-900 flex items-center gap-2"><MapPin size={16} /> Markers</h3>
                  {canEdit && !showMarkerForm && (
                    <button onClick={startAddMarker} className="text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1">
                      <Plus size={14} /> Add Marker
                    </button>
                  )}
                </div>

                {pages.length > 1 && (
                  <div className="flex gap-1 mb-3 overflow-x-auto">
                    {pages.map(p => (
                      <button key={p} onClick={() => setCurrentPage(p)}
                        className={`px-3 py-1 rounded-lg text-xs font-medium ${currentPage === p ? 'bg-primary-500 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}>
                        Page {p}
                      </button>
                    ))}
                  </div>
                )}

                {showMarkerForm && (
                  <div className="space-y-2 mb-3 border border-neutral-100 rounded-xl p-3 bg-neutral-50">
                    <div className="grid grid-cols-4 gap-2">
                      <div>
                        <label className="block text-xs text-neutral-500 mb-0.5">Page</label>
                        <input type="number" value={markerPage} onChange={e => setMarkerPage(e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <label className="block text-xs text-neutral-500 mb-0.5">X</label>
                        <input type="number" step="any" value={markerX} onChange={e => setMarkerX(e.target.value)} placeholder="0-100" className={inputCls} />
                      </div>
                      <div>
                        <label className="block text-xs text-neutral-500 mb-0.5">Y</label>
                        <input type="number" step="any" value={markerY} onChange={e => setMarkerY(e.target.value)} placeholder="0-100" className={inputCls} />
                      </div>
                      <div>
                        <label className="block text-xs text-neutral-500 mb-0.5">Z (optional)</label>
                        <input type="number" step="any" value={markerZ} onChange={e => setMarkerZ(e.target.value)} placeholder="—" className={inputCls} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" value={markerLabel} onChange={e => setMarkerLabel(e.target.value)} placeholder="Label (optional)" className={inputCls} />
                      <select value={markerAssetId} onChange={e => setMarkerAssetId(e.target.value)} className={inputCls}>
                        <option value="">No linked asset</option>
                        {assets.map(a => <option key={a.id} value={a.id}>{a.equipment_name} ({a.asset_tag || 'untagged'})</option>)}
                      </select>
                    </div>
                    {error && <p className="text-xs text-red-600">{error}</p>}
                    <div className="flex gap-2">
                      <button onClick={saveMarker} disabled={savingMarker} className="bg-primary-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-primary-600 disabled:opacity-50 flex items-center gap-1">
                        {savingMarker ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} {editingMarker ? 'Update' : 'Create'}
                      </button>
                      <button onClick={() => { setShowMarkerForm(false); setEditingMarker(null); setError('') }} className="border border-neutral-200 text-neutral-600 px-3 py-1.5 rounded-lg text-xs">Cancel</button>
                    </div>
                  </div>
                )}

                {pageMarkers.length === 0 && !showMarkerForm && <p className="text-xs text-neutral-400">No markers on page {currentPage}</p>}
                <div className="space-y-1">
                  {pageMarkers.map(m => (
                    <div key={m.id} className="flex items-center gap-2 bg-neutral-50 rounded-lg px-3 py-2">
                      <MapPin size={14} className="text-neutral-400" />
                      <span className="text-sm text-neutral-800">X: {m.x}, Y: {m.y}{m.z != null ? `, Z: ${m.z}` : ''}</span>
                      {m.label && <span className="text-xs text-neutral-500">— {m.label}</span>}
                      {m.assets && <a href={`/assets/${m.asset_id}`} className="text-xs text-sky-500 hover:text-sky-600">{m.assets.equipment_name}</a>}
                      {canEdit && (
                        <div className="ml-auto flex gap-1">
                          <button onClick={() => startEditMarker(m)} className="p-1 text-neutral-400 hover:bg-neutral-200 rounded"><Pencil size={12} /></button>
                          {canDeleteMarker && <button onClick={() => deleteMarker(m)} className="p-1 text-neutral-400 hover:bg-red-50 hover:text-red-500 rounded"><Trash2 size={12} /></button>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-neutral-200 p-8 shadow-sm text-center">
              <Layers size={40} className="mx-auto text-neutral-300 mb-3" />
              <p className="text-sm text-neutral-500">Select a plan document to manage revisions and markers</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
