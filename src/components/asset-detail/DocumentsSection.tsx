import { useState, useEffect, useCallback, useRef } from 'react'
import { Upload, Link2, FileText, Download, Trash2, ExternalLink, X, Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { DocumentCategory } from '../../types'

interface DocumentRow {
  id: string
  name: string
  category: DocumentCategory
  document_type: string | null
  discipline: string | null
  revision: string | null
  description: string | null
  storage_path: string | null
  external_url: string | null
  file_size: number | null
  mime_type: string | null
  storage_provider: string
  created_at: string
  uploaded_by: string | null
  profiles?: { id: string; name: string } | null
}

interface Props { assetId: string; facilityId: string; canEdit: boolean }

const CATS: DocumentCategory[] = ['shop_drawing','floorplan','specification','om_manual','commissioning','engineering','submittal','drawing','contractual','record','form','other']
const CAT_LABEL: Record<DocumentCategory, string> = {
  shop_drawing:'Shop Drawing', floorplan:'Floor Plan', specification:'Specification',
  om_manual:'O&M Manual', commissioning:'Commissioning', engineering:'Engineering',
  submittal:'Submittal', drawing:'Drawing', contractual:'Contractual',
  record:'Record', form:'Form', other:'Other',
}
const INPUT = 'w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400'

function fmtBytes(b: number | null) { if (!b) return ''; if (b < 1024) return `${b} B`; if (b < 1048576) return `${(b/1024).toFixed(1)} KB`; return `${(b/1048576).toFixed(1)} MB` }
function fmtDate(iso: string) { return new Date(iso).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' }) }

export default function DocumentsSection({ assetId, facilityId, canEdit }: Props) {
  const [docs, setDocs] = useState<DocumentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showUpload, setShowUpload] = useState(false)
  const [showLink, setShowLink] = useState(false)
  const [showExisting, setShowExisting] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: links } = await supabase
        .from('document_asset_links')
        .select('document_id')
        .eq('asset_id', assetId)

      if (!links || links.length === 0) {
        // Fall back to legacy asset_documents table
        const { data: legacy } = await supabase
          .from('asset_documents')
          .select('*, profiles:uploaded_by(id, name)')
          .eq('asset_id', assetId)
          .order('created_at', { ascending: false })
        if (legacy) {
          setDocs(legacy.map((d: any) => ({
            id: d.id,
            name: d.name,
            category: d.category,
            document_type: null,
            discipline: null,
            revision: null,
            description: d.description,
            storage_path: d.storage_path,
            external_url: d.external_url,
            file_size: d.file_size,
            mime_type: d.mime_type,
            storage_provider: d.storage_path ? 'supabase' : d.external_url ? 'external' : 'pending',
            created_at: d.created_at,
            uploaded_by: d.uploaded_by,
            profiles: d.profiles,
          })))
        }
        return
      }

      const docIds = links.map(l => l.document_id)
      const { data } = await supabase
        .from('documents')
        .select('*, profiles:uploaded_by(id, name)')
        .in('id', docIds)
        .order('created_at', { ascending: false })
      setDocs(data ?? [])
    } finally { setLoading(false) }
  }, [assetId])

  useEffect(() => { load() }, [load])

  async function handleView(doc: DocumentRow) {
    if (doc.external_url) { window.open(doc.external_url, '_blank', 'noopener'); return }
    if (doc.storage_path) {
      const { data } = await supabase.storage.from('asset-documents').createSignedUrl(doc.storage_path, 3600)
      if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
    }
  }

  async function handleDownload(doc: DocumentRow) {
    if (!doc.storage_path) return
    const { data } = await supabase.storage.from('asset-documents').createSignedUrl(doc.storage_path, 3600, { download: true })
    if (data?.signedUrl) { const a = document.createElement('a'); a.href = data.signedUrl; a.download = doc.name; a.click() }
  }

  async function handleDelete(doc: DocumentRow) {
    setDeleting(true)
    try {
      const { error } = await supabase
        .from('document_asset_links')
        .delete()
        .eq('document_id', doc.id)
        .eq('asset_id', assetId)
      if (error) throw error
      // Unlinking from an asset must never delete the shared document or file.
      setDocs(p => p.filter(d => d.id !== doc.id))
    } finally { setDeleting(false); setDeleteId(null) }
  }

  const delDoc = docs.find(d => d.id === deleteId)

  if (loading) return <div className="flex justify-center py-8"><div className="w-8 h-8 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" /></div>

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-neutral-700"><FileText size={18} /><h3 className="text-sm font-semibold text-neutral-900">Documents</h3></div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button onClick={() => setShowExisting(true)} className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700"><Link2 size={14} />Link Existing</button>
            <button onClick={() => setShowLink(true)} className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700"><ExternalLink size={14} />Add URL</button>
            <button onClick={() => setShowUpload(true)} className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700"><Upload size={14} />Upload</button>
          </div>
        )}
      </div>

      {docs.length === 0 ? (
        <p className="text-sm text-neutral-500 py-4 text-center">No documents uploaded.</p>
      ) : (
        <div className="bg-white border border-neutral-200 rounded-xl divide-y divide-neutral-100">
          {docs.map(doc => (
            <div key={doc.id} className="px-3 py-3 flex items-start gap-3 group">
              <div className="shrink-0 mt-0.5 w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center text-neutral-500">
                {doc.external_url ? <ExternalLink size={16} /> : <FileText size={16} />}
              </div>
              <div className="flex-1 min-w-0">
                <button onClick={() => handleView(doc)} className="text-sm font-medium text-neutral-900 hover:text-primary-600 truncate block text-left w-full">{doc.name}</button>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                  <span className="inline-block text-[11px] font-medium px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600">{CAT_LABEL[doc.category] || doc.category}</span>
                  {doc.discipline && <span className="text-[11px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700">{doc.discipline}</span>}
                  {doc.revision && <span className="text-[11px] text-neutral-400">Rev {doc.revision}</span>}
                  {doc.file_size != null && doc.file_size > 0 && <span className="text-xs text-neutral-400">{fmtBytes(doc.file_size)}</span>}
                  <span className="text-xs text-neutral-400">{fmtDate(doc.created_at)}</span>
                  {doc.profiles && <span className="text-xs text-neutral-400">by {doc.profiles.name}</span>}
                </div>
                {doc.description && <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{doc.description}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                {doc.storage_path && <button onClick={() => handleDownload(doc)} className="p-1 text-neutral-400 hover:text-primary-600 rounded-lg hover:bg-primary-50" title="Download"><Download size={15} /></button>}
                {canEdit && <button onClick={() => setDeleteId(doc.id)} className="p-1 text-neutral-400 hover:text-error-600 rounded-lg hover:bg-error-50" title="Delete"><Trash2 size={15} /></button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      {delDoc && (
        <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center pb-20 lg:pb-0">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteId(null)} />
          <div className="relative bg-white border border-neutral-200 w-full max-w-sm rounded-t-2xl lg:rounded-2xl shadow-lg p-5 text-center">
            <p className="text-sm font-medium text-neutral-900 mb-1">Remove &ldquo;{delDoc.name}&rdquo; from this asset?</p>
            <p className="text-sm text-neutral-500 mb-4">This removes only the asset relationship. The document and stored file remain in the facility document library.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteId(null)} className="flex-1 py-2.5 text-sm font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-xl">Cancel</button>
              <button onClick={() => handleDelete(delDoc)} disabled={deleting} className="flex-1 py-2.5 text-sm font-medium text-white bg-error-600 hover:bg-error-700 rounded-xl disabled:opacity-50">{deleting ? 'Removing\u2026' : 'Remove'}</button>
            </div>
          </div>
        </div>
      )}

      {showUpload && <UploadModal assetId={assetId} facilityId={facilityId} onClose={() => setShowUpload(false)} onComplete={() => { setShowUpload(false); load() }} />}
      {showExisting && <ExistingDocumentModal assetId={assetId} facilityId={facilityId} onClose={() => setShowExisting(false)} onComplete={() => { setShowExisting(false); load() }} />}
      {showLink && <LinkModal assetId={assetId} facilityId={facilityId} onClose={() => setShowLink(false)} onComplete={() => { setShowLink(false); load() }} />}
    </div>
  )
}

/* --- Upload Document Modal --- */

function UploadModal({ assetId, facilityId, onClose, onComplete }: { assetId: string; facilityId: string; onClose: () => void; onComplete: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState<DocumentCategory>('other')
  const [desc, setDesc] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  function onFile(e: React.ChangeEvent<HTMLInputElement>) { const f = e.target.files?.[0] ?? null; setFile(f); if (f && !name) setName(f.name) }

  async function handleSubmit() {
    if (!file) { setError('Please select a file.'); return }
    if (!name.trim()) { setError('Please enter a name.'); return }
    setSubmitting(true); setError('')
    try {
      // Create document record first to get its id for storage path
      const { data: doc, error: docErr } = await supabase
        .from('documents')
        .insert({
          facility_id: facilityId,
          name: name.trim(),
          category,
          description: desc.trim() || null,
          file_size: file.size,
          mime_type: file.type || null,
          storage_provider: 'supabase',
        })
        .select('id')
        .single()
      if (docErr) throw docErr

      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const storagePath = `${facilityId}/documents/${doc.id}/${safe}`
      const { error: ue } = await supabase.storage.from('asset-documents').upload(storagePath, file)
      if (ue) throw ue

      await supabase.from('documents').update({ storage_path: storagePath }).eq('id', doc.id)

      // Create the link to this asset
      const { error: linkErr } = await supabase.from('document_asset_links').insert({ document_id: doc.id, asset_id: assetId })
      if (linkErr) throw linkErr

      onComplete()
    } catch (e: any) { setError(e.message || 'Upload failed.') } finally { setSubmitting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center pb-20 lg:pb-0">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white border border-neutral-200 w-full max-w-lg rounded-t-2xl lg:rounded-2xl max-h-[80vh] lg:max-h-[90vh] overflow-y-auto shadow-lg">
        <div className="sticky top-0 bg-white border-b border-neutral-200 px-4 py-3 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-base font-semibold text-neutral-900">Upload Document</h2>
          <button onClick={onClose} className="p-1 hover:bg-neutral-100 rounded-lg"><X size={20} /></button>
        </div>
        <div className="p-4 pb-8 space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-800 mb-1">File</label>
            {file ? (
              <div className="flex items-center justify-between bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText size={16} className="text-neutral-500 shrink-0" />
                  <span className="text-sm text-neutral-900 truncate">{file.name}</span>
                  <span className="text-xs text-neutral-400 shrink-0">{fmtBytes(file.size)}</span>
                </div>
                <button onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = '' }} className="p-0.5 hover:bg-neutral-200 rounded-md"><X size={16} className="text-neutral-500" /></button>
              </div>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()} className="w-full border-2 border-dashed border-neutral-300 rounded-xl py-6 flex flex-col items-center gap-1 text-neutral-500 hover:border-primary-400 hover:text-primary-600 transition-colors">
                <Upload size={24} /><span className="text-sm">Choose file</span>
              </button>
            )}
            <input ref={fileRef} type="file" onChange={onFile} className="hidden" />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-800 mb-1">Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Document name" className={INPUT} />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-800 mb-1">Category</label>
            <select value={category} onChange={e => setCategory(e.target.value as DocumentCategory)} className={INPUT}>
              {CATS.map(c => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-800 mb-1">Description</label>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} placeholder="Optional description\u2026" className={`${INPUT} resize-none`} />
          </div>
          {error && <div className="bg-error-50 border border-error-500 text-error-700 text-sm px-3 py-2 rounded-xl">{error}</div>}
          <button onClick={handleSubmit} disabled={submitting || !file} className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white py-3 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md shadow-primary-200">
            {submitting ? <div className="w-5 h-5 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" /> : <><Upload size={18} />Upload Document</>}
          </button>
        </div>
      </div>
    </div>
  )
}

/* --- Link Existing Facility Document --- */

function ExistingDocumentModal({ assetId, facilityId, onClose, onComplete }: { assetId: string; facilityId: string; onClose: () => void; onComplete: () => void }) {
  const [docs, setDocs] = useState<{ id: string; name: string; category: string; document_type: string | null }[]>([])
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function loadDocuments() {
      setLoading(true)
      const { data: linked } = await supabase.from('document_asset_links').select('document_id').eq('asset_id', assetId)
      const linkedIds = new Set((linked || []).map(row => row.document_id))
      const { data, error: loadError } = await supabase
        .from('documents')
        .select('id, name, category, document_type')
        .eq('facility_id', facilityId)
        .is('deleted_at', null)
        .order('name')
      if (!active) return
      if (loadError) setError(loadError.message)
      setDocs((data || []).filter(doc => !linkedIds.has(doc.id)))
      setLoading(false)
    }
    loadDocuments()
    return () => { active = false }
  }, [assetId, facilityId])

  const filtered = docs.filter(doc => {
    const q = search.trim().toLowerCase()
    return !q || doc.name.toLowerCase().includes(q) || (doc.document_type || '').toLowerCase().includes(q)
  })

  async function handleSubmit() {
    if (!selectedId) { setError('Select a document to link.'); return }
    setSubmitting(true); setError('')
    const { error: linkError } = await supabase.from('document_asset_links').insert({
      document_id: selectedId,
      asset_id: assetId,
      relationship_type: 'applies_to',
    })
    setSubmitting(false)
    if (linkError) { setError(linkError.message); return }
    onComplete()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center pb-20 lg:pb-0">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white border border-neutral-200 w-full max-w-lg rounded-t-2xl lg:rounded-2xl max-h-[80vh] lg:max-h-[90vh] overflow-y-auto shadow-lg">
        <div className="sticky top-0 bg-white border-b border-neutral-200 px-4 py-3 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-base font-semibold text-neutral-900">Link Existing Document</h2>
          <button onClick={onClose} className="p-1 hover:bg-neutral-100 rounded-lg"><X size={20} /></button>
        </div>
        <div className="p-4 pb-8 space-y-4">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search facility documents" className={INPUT} />
          {loading ? (
            <div className="flex justify-center py-8"><div className="w-7 h-7 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-neutral-500 text-center py-6">No unlinked facility documents match.</p>
          ) : (
            <div className="border border-neutral-200 rounded-xl divide-y divide-neutral-100 max-h-72 overflow-y-auto">
              {filtered.map(doc => (
                <label key={doc.id} className="flex items-start gap-3 px-3 py-3 cursor-pointer hover:bg-neutral-50">
                  <input type="radio" name="existing-document" value={doc.id} checked={selectedId === doc.id} onChange={() => setSelectedId(doc.id)} className="mt-1" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-900 truncate">{doc.name}</p>
                    <p className="text-xs text-neutral-500">{CAT_LABEL[doc.category as DocumentCategory] || doc.category}{doc.document_type ? ` · ${doc.document_type}` : ''}</p>
                  </div>
                </label>
              ))}
            </div>
          )}
          {error && <div className="bg-error-50 border border-error-500 text-error-700 text-sm px-3 py-2 rounded-xl">{error}</div>}
          <button onClick={handleSubmit} disabled={submitting || !selectedId} className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 text-white py-3 rounded-xl text-sm font-medium disabled:opacity-50">
            {submitting ? 'Linking\u2026' : 'Link Document'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* --- Add Link Modal --- */

function LinkModal({ assetId, facilityId, onClose, onComplete }: { assetId: string; facilityId: string; onClose: () => void; onComplete: () => void }) {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [category, setCategory] = useState<DocumentCategory>('other')
  const [desc, setDesc] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (!url.trim()) { setError('Please enter a URL.'); return }
    if (!name.trim()) { setError('Please enter a name.'); return }
    try { new URL(url.trim()) } catch { setError('Please enter a valid URL.'); return }
    setSubmitting(true); setError('')
    try {
      const { data: doc, error: docErr } = await supabase
        .from('documents')
        .insert({
          facility_id: facilityId,
          name: name.trim(),
          category,
          description: desc.trim() || null,
          external_url: url.trim(),
          storage_provider: 'external',
        })
        .select('id')
        .single()
      if (docErr) throw docErr

      const { error: linkErr } = await supabase.from('document_asset_links').insert({ document_id: doc.id, asset_id: assetId })
      if (linkErr) throw linkErr

      onComplete()
    } catch (e: any) { setError(e.message || 'Failed to add link.') } finally { setSubmitting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center pb-20 lg:pb-0">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white border border-neutral-200 w-full max-w-lg rounded-t-2xl lg:rounded-2xl max-h-[80vh] lg:max-h-[90vh] overflow-y-auto shadow-lg">
        <div className="sticky top-0 bg-white border-b border-neutral-200 px-4 py-3 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-base font-semibold text-neutral-900">Add Link</h2>
          <button onClick={onClose} className="p-1 hover:bg-neutral-100 rounded-lg"><X size={20} /></button>
        </div>
        <div className="p-4 pb-8 space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-800 mb-1">URL</label>
            <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://\u2026" className={INPUT} />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-800 mb-1">Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Document name" className={INPUT} />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-800 mb-1">Category</label>
            <select value={category} onChange={e => setCategory(e.target.value as DocumentCategory)} className={INPUT}>
              {CATS.map(c => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-800 mb-1">Description</label>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} placeholder="Optional description\u2026" className={`${INPUT} resize-none`} />
          </div>
          {error && <div className="bg-error-50 border border-error-500 text-error-700 text-sm px-3 py-2 rounded-xl">{error}</div>}
          <button onClick={handleSubmit} disabled={submitting || !url.trim() || !name.trim()} className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white py-3 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md shadow-primary-200">
            {submitting ? <div className="w-5 h-5 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" /> : <><Plus size={18} />Add Link</>}
          </button>
        </div>
      </div>
    </div>
  )
}
