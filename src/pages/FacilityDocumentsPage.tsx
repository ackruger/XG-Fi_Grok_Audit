import { useState, useEffect, useCallback, useRef } from 'react'
import { FileText, ExternalLink, Search, Filter, Download, ChevronDown, Upload, Link2, Plus, X, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useFacility } from '../context/FacilityContext'
import type { DocumentCategory } from '../types'

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
  storage_provider: string
  created_at: string
  asset_count?: number
}

const CATS: DocumentCategory[] = ['shop_drawing','floorplan','specification','om_manual','commissioning','engineering','submittal','drawing','contractual','record','form','other']
const CAT_LABEL: Record<string, string> = {
  shop_drawing: 'Shop Drawing', floorplan: 'Floor Plan', specification: 'Specification',
  om_manual: 'O&M Manual', commissioning: 'Commissioning', engineering: 'Engineering',
  submittal: 'Submittal', drawing: 'Drawing', contractual: 'Contractual',
  record: 'Record', form: 'Form', other: 'Other',
}

const CATEGORY_OPTIONS = Object.entries(CAT_LABEL).map(([value, label]) => ({ value, label }))

const STATUS_COLORS: Record<string, string> = {
  supabase: 'bg-emerald-50 text-emerald-700',
  external: 'bg-sky-50 text-sky-700',
  pending: 'bg-amber-50 text-amber-700',
}

const INPUT = 'w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400'

function fmtBytes(b: number | null) { if (!b) return ''; if (b < 1024) return `${b} B`; if (b < 1048576) return `${(b/1024).toFixed(1)} KB`; return `${(b/1048576).toFixed(1)} MB` }
function fmtDate(iso: string) { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }

export default function FacilityDocumentsPage() {
  const { currentFacility } = useFacility()
  const [docs, setDocs] = useState<DocumentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState<string>('all')
  const [providerFilter, setProviderFilter] = useState<string>('all')
  const [showFilters, setShowFilters] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [showLink, setShowLink] = useState(false)
  const [deleteDoc, setDeleteDoc] = useState<DocumentRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    if (!currentFacility) return
    setLoading(true)
    try {
      let query = supabase
        .from('documents')
        .select('*')
        .eq('facility_id', currentFacility.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      if (catFilter !== 'all') query = query.eq('category', catFilter)
      if (providerFilter !== 'all') query = query.eq('storage_provider', providerFilter)
      if (search.trim()) query = query.ilike('name', `%${search.trim()}%`)

      const { data } = await query
      if (!data) { setDocs([]); return }

      const CHUNK = 300
      const docIds = data.map(d => d.id)
      const countMap = new Map<string, number>()
      for (let i = 0; i < docIds.length; i += CHUNK) {
        const chunk = docIds.slice(i, i + CHUNK)
        const { data: linkCounts } = await supabase
          .from('document_asset_links')
          .select('document_id')
          .in('document_id', chunk)
        for (const lc of linkCounts ?? []) {
          countMap.set(lc.document_id, (countMap.get(lc.document_id) || 0) + 1)
        }
      }

      setDocs(data.map(d => ({ ...d, asset_count: countMap.get(d.id) || 0 })))
    } finally { setLoading(false) }
  }, [currentFacility, catFilter, providerFilter, search])

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

  async function handleDelete() {
    if (!deleteDoc) return
    setDeleting(true)
    try {
      const { error } = await supabase
        .from('documents')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', deleteDoc.id)
      if (!error) setDocs(p => p.filter(d => d.id !== deleteDoc.id))
    } finally { setDeleting(false); setDeleteDoc(null) }
  }

  if (!currentFacility) {
    return <div className="p-6 text-center text-neutral-500 text-sm">Select a facility to view documents.</div>
  }

  return (
    <div className="max-w-5xl mx-auto p-4 lg:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Documents</h1>
          <p className="text-sm text-neutral-500 mt-1">{currentFacility.name} &mdash; All facility and asset documents</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowLink(true)}
            className="flex items-center gap-1.5 px-3 py-2 border border-neutral-200 rounded-xl text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
          >
            <Link2 size={16} />
            <span className="hidden sm:inline">Add URL</span>
          </button>
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white rounded-xl text-sm font-medium shadow-md shadow-primary-200 transition-colors"
          >
            <Upload size={16} />
            <span className="hidden sm:inline">Upload</span>
          </button>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search documents..."
            className="w-full pl-9 pr-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border transition-colors ${
            showFilters || catFilter !== 'all' || providerFilter !== 'all'
              ? 'bg-primary-50 border-primary-200 text-primary-700'
              : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
          }`}
        >
          <Filter size={16} />
          Filters
          {(catFilter !== 'all' || providerFilter !== 'all') && (
            <span className="w-5 h-5 rounded-full bg-primary-600 text-white text-[10px] font-bold flex items-center justify-center">
              {(catFilter !== 'all' ? 1 : 0) + (providerFilter !== 'all' ? 1 : 0)}
            </span>
          )}
        </button>
      </div>

      {showFilters && (
        <div className="bg-white border border-neutral-200 rounded-xl p-4 mb-6 flex flex-wrap gap-4">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-medium text-neutral-500 mb-1">Category</label>
            <div className="relative">
              <select
                value={catFilter}
                onChange={e => setCatFilter(e.target.value)}
                className="w-full appearance-none bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 pr-8 text-sm text-neutral-800 focus:outline-none focus:ring-2 focus:ring-primary-400/40"
              >
                <option value="all">All categories</option>
                {CATEGORY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
            </div>
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-medium text-neutral-500 mb-1">Storage</label>
            <div className="relative">
              <select
                value={providerFilter}
                onChange={e => setProviderFilter(e.target.value)}
                className="w-full appearance-none bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 pr-8 text-sm text-neutral-800 focus:outline-none focus:ring-2 focus:ring-primary-400/40"
              >
                <option value="all">All</option>
                <option value="supabase">Uploaded</option>
                <option value="external">External link</option>
                <option value="pending">Pending upload</option>
              </select>
              <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
            </div>
          </div>
        </div>
      )}

      {/* Documents list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
        </div>
      ) : docs.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 bg-neutral-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <FileText size={32} className="text-neutral-300" />
          </div>
          <p className="text-sm font-medium text-neutral-700 mb-1">
            {search || catFilter !== 'all' || providerFilter !== 'all' ? 'No documents match your filters.' : 'No documents yet'}
          </p>
          {!search && catFilter === 'all' && providerFilter === 'all' && (
            <p className="text-sm text-neutral-500 mb-5">Upload a file or add an external link to get started.</p>
          )}
          {!search && catFilter === 'all' && providerFilter === 'all' && (
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => setShowUpload(true)} className="flex items-center gap-1.5 px-4 py-2.5 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white rounded-xl text-sm font-medium shadow-md shadow-primary-200">
                <Upload size={16} /> Upload File
              </button>
              <button onClick={() => setShowLink(true)} className="flex items-center gap-1.5 px-4 py-2.5 border border-neutral-200 rounded-xl text-sm font-medium text-neutral-700 hover:bg-neutral-50">
                <Link2 size={16} /> Add URL
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-neutral-200 rounded-xl divide-y divide-neutral-100">
          {docs.map(doc => (
            <div key={doc.id} className="px-4 py-3.5 flex items-start gap-3 group hover:bg-neutral-50/50 transition-colors">
              <div className="shrink-0 mt-0.5 w-9 h-9 rounded-lg bg-neutral-100 flex items-center justify-center text-neutral-500">
                {doc.external_url ? <ExternalLink size={16} /> : <FileText size={16} />}
              </div>
              <div className="flex-1 min-w-0">
                <button onClick={() => handleView(doc)} className="text-sm font-medium text-neutral-900 hover:text-primary-600 truncate block text-left w-full">
                  {doc.name}
                </button>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                  <span className="inline-block text-[11px] font-medium px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600">
                    {CAT_LABEL[doc.category] || doc.category}
                  </span>
                  {doc.discipline && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700">{doc.discipline}</span>
                  )}
                  {doc.document_type && (
                    <span className="text-[11px] text-neutral-500">{doc.document_type}</span>
                  )}
                  <span className={`text-[11px] px-1.5 py-0.5 rounded ${STATUS_COLORS[doc.storage_provider] || 'bg-neutral-100 text-neutral-600'}`}>
                    {doc.storage_provider === 'supabase' ? 'Uploaded' : doc.storage_provider === 'external' ? 'External' : 'Pending'}
                  </span>
                  {doc.revision && <span className="text-[11px] text-neutral-400">Rev {doc.revision}</span>}
                  {doc.file_size != null && doc.file_size > 0 && <span className="text-xs text-neutral-400">{fmtBytes(doc.file_size)}</span>}
                  <span className="text-xs text-neutral-400">{fmtDate(doc.created_at)}</span>
                  {(doc.asset_count ?? 0) > 0 && (
                    <span className="text-[11px] text-neutral-400">{doc.asset_count} asset{doc.asset_count !== 1 ? 's' : ''}</span>
                  )}
                  {(doc.asset_count ?? 0) === 0 && (
                    <span className="text-[11px] text-amber-600">Facility-level</span>
                  )}
                </div>
                {doc.description && <p className="text-xs text-neutral-500 mt-1 line-clamp-1">{doc.description}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                {doc.storage_path && (
                  <button onClick={() => handleDownload(doc)} className="p-1.5 text-neutral-400 hover:text-primary-600 rounded-lg hover:bg-primary-50" title="Download">
                    <Download size={15} />
                  </button>
                )}
                <button onClick={() => setDeleteDoc(doc)} className="p-1.5 text-neutral-400 hover:text-error-600 rounded-lg hover:bg-error-50" title="Delete">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 text-center">
        <p className="text-xs text-neutral-400">{docs.length} document{docs.length !== 1 ? 's' : ''}</p>
      </div>

      {/* Delete confirmation */}
      {deleteDoc && (
        <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center pb-20 lg:pb-0">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteDoc(null)} />
          <div className="relative bg-white border border-neutral-200 w-full max-w-sm rounded-t-2xl lg:rounded-2xl shadow-lg p-5 text-center">
            <p className="text-sm font-medium text-neutral-900 mb-1">Delete &ldquo;{deleteDoc.name}&rdquo;?</p>
            <p className="text-sm text-neutral-500 mb-4">This will remove the document from this facility. Any asset links to this document will also be removed.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteDoc(null)} className="flex-1 py-2.5 text-sm font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-xl">Cancel</button>
              <button onClick={handleDelete} disabled={deleting} className="flex-1 py-2.5 text-sm font-medium text-white bg-error-600 hover:bg-error-700 rounded-xl disabled:opacity-50">{deleting ? 'Deleting\u2026' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}

      {showUpload && (
        <UploadModal
          facilityId={currentFacility.id}
          onClose={() => setShowUpload(false)}
          onComplete={() => { setShowUpload(false); load() }}
        />
      )}
      {showLink && (
        <LinkModal
          facilityId={currentFacility.id}
          onClose={() => setShowLink(false)}
          onComplete={() => { setShowLink(false); load() }}
        />
      )}
    </div>
  )
}

/* --- Upload Document Modal --- */

function UploadModal({ facilityId, onClose, onComplete }: { facilityId: string; onClose: () => void; onComplete: () => void }) {
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
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} placeholder="Optional description&hellip;" className={`${INPUT} resize-none`} />
          </div>
          {error && <div className="bg-error-50 border border-error-200 text-error-700 text-sm px-3 py-2 rounded-xl">{error}</div>}
          <button onClick={handleSubmit} disabled={submitting || !file} className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white py-3 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md shadow-primary-200">
            {submitting ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><Upload size={18} />Upload Document</>}
          </button>
        </div>
      </div>
    </div>
  )
}

/* --- Add External Link Modal --- */

function LinkModal({ facilityId, onClose, onComplete }: { facilityId: string; onClose: () => void; onComplete: () => void }) {
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
      const { error: docErr } = await supabase
        .from('documents')
        .insert({
          facility_id: facilityId,
          name: name.trim(),
          category,
          description: desc.trim() || null,
          external_url: url.trim(),
          storage_provider: 'external',
        })
      if (docErr) throw docErr
      onComplete()
    } catch (e: any) { setError(e.message || 'Failed to add link.') } finally { setSubmitting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center pb-20 lg:pb-0">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white border border-neutral-200 w-full max-w-lg rounded-t-2xl lg:rounded-2xl max-h-[80vh] lg:max-h-[90vh] overflow-y-auto shadow-lg">
        <div className="sticky top-0 bg-white border-b border-neutral-200 px-4 py-3 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-base font-semibold text-neutral-900">Add External Link</h2>
          <button onClick={onClose} className="p-1 hover:bg-neutral-100 rounded-lg"><X size={20} /></button>
        </div>
        <div className="p-4 pb-8 space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-800 mb-1">URL</label>
            <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://&hellip;" className={INPUT} />
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
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} placeholder="Optional description&hellip;" className={`${INPUT} resize-none`} />
          </div>
          {error && <div className="bg-error-50 border border-error-200 text-error-700 text-sm px-3 py-2 rounded-xl">{error}</div>}
          <button onClick={handleSubmit} disabled={submitting || !url.trim() || !name.trim()} className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white py-3 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md shadow-primary-200">
            {submitting ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><Plus size={18} />Add Link</>}
          </button>
        </div>
      </div>
    </div>
  )
}
