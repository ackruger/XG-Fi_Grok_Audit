import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, ArrowRight, Search, X, Link2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { AssetRelationship, RelationshipType } from '../../types'

interface Props { assetId: string; facilityId: string; canEdit: boolean }

interface DisplayRelationship extends AssetRelationship {
  direction: 'outgoing' | 'incoming'
  relatedName: string; relatedTag: string; relatedId: string; displayLabel: string
}
interface SearchResult { id: string; equipment_name: string; asset_tag: string }

const REL_TYPES: RelationshipType[] = ['contains','component_of','serves','fed_by','related','backup_of']
const LABELS: Record<RelationshipType, string> = { contains:'Contains', component_of:'Component of', serves:'Serves', fed_by:'Fed by', related:'Related to', backup_of:'Backup of' }
const INV: Record<RelationshipType, string> = { contains:'Component of', component_of:'Contains', serves:'Served by', fed_by:'Feeds', backup_of:'Backed up by', related:'Related to' }
const INPUT = 'w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400'

function sanitize(v: string) { return v.replace(/[%_\\]/g, c => `\\${c}`) }

export default function RelationshipsSection({ assetId, facilityId, canEdit }: Props) {
  const navigate = useNavigate()
  const [rels, setRels] = useState<DisplayRelationship[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const [out, inc] = await Promise.all([
        supabase.from('asset_relationships').select('*, target_asset:assets!target_asset_id(id,equipment_name,asset_tag)').eq('source_asset_id', assetId),
        supabase.from('asset_relationships').select('*, source_asset:assets!source_asset_id(id,equipment_name,asset_tag)').eq('target_asset_id', assetId),
      ])
      const items: DisplayRelationship[] = []
      for (const r of out.data ?? []) {
        const t = r.target_asset as unknown as SearchResult | null
        items.push({ ...r, direction:'outgoing', relatedId:r.target_asset_id, relatedName:t?.equipment_name??'Unknown', relatedTag:t?.asset_tag??'', displayLabel:LABELS[r.relationship_type as RelationshipType]??r.relationship_type })
      }
      for (const r of inc.data ?? []) {
        const s = r.source_asset as unknown as SearchResult | null
        items.push({ ...r, direction:'incoming', relatedId:r.source_asset_id, relatedName:s?.equipment_name??'Unknown', relatedTag:s?.asset_tag??'', displayLabel:INV[r.relationship_type as RelationshipType]??r.relationship_type })
      }
      setRels(items)
    } finally { setLoading(false) }
  }, [assetId])

  useEffect(() => { fetch() }, [fetch])

  async function handleDelete(id: string) {
    setDeleting(true)
    try {
      const { error } = await supabase.from('asset_relationships').delete().eq('id', id)
      if (!error) setRels(p => p.filter(r => r.id !== id))
    } finally { setDeleting(false); setDeleteId(null) }
  }

  const grouped = rels.reduce<Record<string, DisplayRelationship[]>>((a, r) => { (a[r.displayLabel] ??= []).push(r); return a }, {})

  if (loading) return <div className="flex justify-center py-8"><div className="w-8 h-8 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" /></div>

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-neutral-700"><Link2 size={18} /><h3 className="text-sm font-semibold text-neutral-900">Relationships</h3></div>
        {canEdit && <button onClick={() => setShowModal(true)} className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700"><Plus size={16} />Add</button>}
      </div>

      {rels.length === 0 ? (
        <p className="text-sm text-neutral-500 py-4 text-center">No relationships added.</p>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([label, items]) => (
            <div key={label}>
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">{label}</p>
              <div className="bg-white border border-neutral-200 rounded-xl divide-y divide-neutral-100">
                {items.map(r => (
                  <div key={r.id} className="flex items-center justify-between px-3 py-2.5 group">
                    <button onClick={() => navigate(`/assets/${r.relatedId}`)} className="flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700 font-medium truncate text-left">
                      <ArrowRight size={14} className="shrink-0 text-neutral-400" />
                      <span className="truncate">{r.relatedName}</span>
                      {r.relatedTag && <span className="text-xs text-neutral-400 font-normal shrink-0">{r.relatedTag}</span>}
                    </button>
                    {canEdit && <button onClick={() => setDeleteId(r.id)} className="p-1 text-neutral-400 hover:text-error-600 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg hover:bg-error-50"><Trash2 size={15} /></button>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center pb-20 lg:pb-0">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteId(null)} />
          <div className="relative bg-white border border-neutral-200 w-full max-w-sm rounded-t-2xl lg:rounded-2xl shadow-lg p-5 text-center">
            <p className="text-sm font-medium text-neutral-900 mb-1">Remove Relationship?</p>
            <p className="text-sm text-neutral-500 mb-4">This action cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteId(null)} className="flex-1 py-2.5 text-sm font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-xl">Cancel</button>
              <button onClick={() => handleDelete(deleteId)} disabled={deleting} className="flex-1 py-2.5 text-sm font-medium text-white bg-error-600 hover:bg-error-700 rounded-xl disabled:opacity-50">{deleting ? 'Removing…' : 'Remove'}</button>
            </div>
          </div>
        </div>
      )}

      {showModal && <AddRelModal assetId={assetId} facilityId={facilityId} onClose={() => setShowModal(false)} onComplete={() => { setShowModal(false); fetch() }} />}
    </div>
  )
}

/* ─── Add Relationship Modal ─── */

function AddRelModal({ assetId, facilityId, onClose, onComplete }: { assetId: string; facilityId: string; onClose: () => void; onComplete: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<SearchResult | null>(null)
  const [relType, setRelType] = useState<RelationshipType>('related')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      const s = sanitize(query.trim())
      const { data } = await supabase.from('assets').select('id,equipment_name,asset_tag').eq('facility_id', facilityId).neq('id', assetId).or(`equipment_name.ilike.%${s}%,asset_tag.ilike.%${s}%`).limit(10)
      setResults(data ?? [])
      setSearching(false)
    }, 300)
    return () => clearTimeout(t)
  }, [query, facilityId, assetId])

  async function handleSubmit() {
    if (!selected) { setError('Please select an asset.'); return }
    setSubmitting(true); setError('')
    try {
      const { error: e } = await supabase.from('asset_relationships').insert({ source_asset_id: assetId, target_asset_id: selected.id, relationship_type: relType })
      if (e) throw e
      onComplete()
    } catch (e: any) { setError(e.message || 'Failed to add relationship.') } finally { setSubmitting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center pb-20 lg:pb-0">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white border border-neutral-200 w-full max-w-lg rounded-t-2xl lg:rounded-2xl max-h-[80vh] lg:max-h-[90vh] overflow-y-auto shadow-lg">
        <div className="sticky top-0 bg-white border-b border-neutral-200 px-4 py-3 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-base font-semibold text-neutral-900">Add Relationship</h2>
          <button onClick={onClose} className="p-1 hover:bg-neutral-100 rounded-lg"><X size={20} /></button>
        </div>
        <div className="p-4 pb-8 space-y-4">
          {/* Asset search */}
          <div>
            <label className="block text-sm font-medium text-neutral-800 mb-1">Search Asset</label>
            {selected ? (
              <div className="flex items-center justify-between bg-primary-50 border border-primary-200 rounded-xl px-3 py-2.5">
                <span className="text-sm font-medium text-primary-700 truncate">{selected.equipment_name}{selected.asset_tag && <span className="text-primary-500 font-normal ml-1.5">({selected.asset_tag})</span>}</span>
                <button onClick={() => { setSelected(null); setQuery('') }} className="p-0.5 hover:bg-primary-100 rounded-md"><X size={16} className="text-primary-500" /></button>
              </div>
            ) : (
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name or tag…" className={`${INPUT} pl-9`} />
                {searching && <div className="absolute right-3 top-1/2 -translate-y-1/2"><div className="w-4 h-4 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" /></div>}
                {results.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-neutral-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                    {results.map(r => (
                      <button key={r.id} onClick={() => { setSelected(r); setResults([]); setQuery('') }} className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-50 first:rounded-t-xl last:rounded-b-xl">
                        <span className="font-medium text-neutral-900">{r.equipment_name}</span>
                        {r.asset_tag && <span className="text-neutral-500 ml-1.5">{r.asset_tag}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-neutral-800 mb-1">Relationship Type</label>
            <select value={relType} onChange={e => setRelType(e.target.value as RelationshipType)} className={INPUT}>
              {REL_TYPES.map(t => <option key={t} value={t}>{LABELS[t]}</option>)}
            </select>
          </div>
          {/* Direction indicator */}
          {selected && (
            <div className="flex items-center gap-2 bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2.5 text-sm text-neutral-700">
              <span className="font-medium">This asset</span><ArrowRight size={14} className="text-neutral-400 shrink-0" />
              <span className="text-primary-600 font-medium">{LABELS[relType]}</span><ArrowRight size={14} className="text-neutral-400 shrink-0" />
              <span className="font-medium truncate">{selected.equipment_name}</span>
            </div>
          )}
          {error && <div className="bg-error-50 border border-error-500 text-error-700 text-sm px-3 py-2 rounded-xl">{error}</div>}
          <button onClick={handleSubmit} disabled={submitting || !selected} className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white py-3 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md shadow-primary-200">
            {submitting ? <div className="w-5 h-5 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" /> : <><Plus size={18} />Add Relationship</>}
          </button>
        </div>
      </div>
    </div>
  )
}
