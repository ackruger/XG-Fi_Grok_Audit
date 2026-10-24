import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useFacility } from '../context/FacilityContext'
import { useAuth } from '../context/AuthContext'
import type { AssetType, AssetAttributeDefinition, AttributeDataType, AttributeAppSection } from '../types'
import { Settings, Plus, Pencil, Trash2, ChevronDown, ChevronRight, GripVertical, X, Package, Layers } from 'lucide-react'

const SECTION_LABELS: Record<AttributeAppSection, string> = {
  technical: 'Technical / Design',
  service: 'Service',
  electrical_controls: 'Electrical & Controls',
}

const DATA_TYPE_LABELS: Record<AttributeDataType, string> = {
  text: 'Text',
  multiline: 'Multi-line Text',
  number: 'Number',
  boolean: 'Yes / No',
  date: 'Date',
  select: 'Select (Dropdown)',
  url: 'URL / Link',
}

const SECTIONS: AttributeAppSection[] = ['technical', 'service', 'electrical_controls']
const DATA_TYPES: AttributeDataType[] = ['text', 'multiline', 'number', 'boolean', 'select', 'date', 'url']

// ─── Asset Type Modal ────────────────────────────────────────────────

function AssetTypeModal({
  existing,
  organizationId,
  onClose,
  onSaved,
}: {
  existing?: AssetType | null
  organizationId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(existing?.name ?? '')
  const [code, setCode] = useState(existing?.code ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [sortOrder, setSortOrder] = useState(existing?.sort_order ?? 0)
  const [isActive, setIsActive] = useState(existing?.is_active ?? true)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    const payload = {
      name: name.trim(),
      code: code.trim() || null,
      description: description.trim() || null,
      sort_order: sortOrder,
      is_active: isActive,
    }

    const { error: saveErr } = existing
      ? await supabase.from('asset_types').update(payload).eq('id', existing.id)
      : await supabase.from('asset_types').insert({ ...payload, organization_id: organizationId })
    setSaving(false)
    if (saveErr) { alert('Error saving: ' + saveErr.message); return }
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-neutral-800 mb-4">
          {existing ? 'Edit Asset Type' : 'New Asset Type'}
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-600 mb-1">Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Pump, Valve, Motor"
              className="w-full px-3.5 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400" />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-600 mb-1">Code</label>
            <input value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. PMP, VLV"
              className="w-full px-3.5 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400" />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-600 mb-1">Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="Brief description of this equipment category"
              className="w-full px-3.5 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400 resize-none" />
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-neutral-600 mb-1">Sort Order</label>
              <input type="number" value={sortOrder} onChange={e => setSortOrder(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400" />
            </div>
            {existing && (
              <div className="flex-1 flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)}
                    className="w-4 h-4 rounded border-neutral-300 text-primary-500 focus:ring-primary-400" />
                  <span className="text-sm text-neutral-700">Active</span>
                </label>
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 bg-neutral-100 text-neutral-700 rounded-xl text-sm font-medium hover:bg-neutral-200">Cancel</button>
          <button onClick={handleSave} disabled={!name.trim() || saving}
            className="px-4 py-2 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl text-sm font-medium hover:from-primary-600 hover:to-primary-700 shadow-md shadow-primary-200 disabled:opacity-50">
            {saving ? 'Saving…' : existing ? 'Save Changes' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Attribute Options Editor (for select fields) ────────────────────

function OptionsEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [input, setInput] = useState('')

  const addOption = () => {
    const trimmed = input.trim()
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed])
      setInput('')
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-neutral-600 mb-1">Options</label>
      <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
        {value.map((opt, i) => (
          <span key={i} className="inline-flex items-center gap-1 bg-neutral-100 text-neutral-700 text-xs px-2.5 py-1 rounded-full">
            {opt}
            <button onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-neutral-400 hover:text-neutral-600">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={input} onChange={e => setInput(e.target.value)} placeholder="Add an option"
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addOption())}
          className="flex-1 px-3 py-2 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400" />
        <button onClick={addOption} type="button"
          className="px-3 py-2 border border-neutral-200 rounded-xl text-sm font-medium text-neutral-700 hover:bg-neutral-50">Add</button>
      </div>
    </div>
  )
}

// ─── Attribute Definition Modal ──────────────────────────────────────

function AttributeModal({
  existing,
  assetTypeId,
  nextSort,
  onClose,
  onSaved,
}: {
  existing?: AssetAttributeDefinition | null
  assetTypeId: string
  nextSort: number
  onClose: () => void
  onSaved: () => void
}) {
  const [section, setSection] = useState<AttributeAppSection>(existing?.app_section ?? 'technical')
  const [displayName, setDisplayName] = useState(existing?.display_name ?? '')
  const [fieldKey, setFieldKey] = useState(existing?.name ?? '')
  const [dataType, setDataType] = useState<AttributeDataType>(existing?.data_type ?? 'text')
  const [unit, setUnit] = useState(existing?.unit ?? '')
  const [options, setOptions] = useState<string[]>(() => {
    if (!existing?.options) return []
    try { return Array.isArray(existing.options) ? existing.options : JSON.parse(existing.options as string) }
    catch { return [] }
  })
  const [isRequired, setIsRequired] = useState(existing?.is_required ?? false)
  const [isSearchable, setIsSearchable] = useState(existing?.is_searchable ?? false)
  const [sortOrder, setSortOrder] = useState(existing?.sort_order ?? nextSort)
  const [sourceHeader, setSourceHeader] = useState(existing?.source_header ?? '')
  const [sourceColumn, setSourceColumn] = useState(existing?.source_column ?? '')
  const [saving, setSaving] = useState(false)

  const autoKey = displayName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

  const handleSave = async () => {
    if (!displayName.trim()) return
    setSaving(true)
    const payload = {
      app_section: section,
      name: fieldKey.trim() || autoKey,
      display_name: displayName.trim(),
      data_type: dataType,
      unit: unit.trim() || null,
      options: dataType === 'select' ? options : null,
      is_required: isRequired,
      is_searchable: isSearchable,
      sort_order: sortOrder,
      source_header: sourceHeader.trim() || null,
      source_column: sourceColumn.trim() || null,
    }

    const { error: defErr } = existing
      ? await supabase.from('asset_attribute_definitions').update(payload).eq('id', existing.id)
      : await supabase.from('asset_attribute_definitions').insert({ ...payload, asset_type_id: assetTypeId })
    setSaving(false)
    if (defErr) { alert('Error saving: ' + defErr.message); return }
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-neutral-800 mb-4">
          {existing ? 'Edit Field' : 'New Field'}
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-600 mb-1">Section</label>
            <select value={section} onChange={e => setSection(e.target.value as AttributeAppSection)}
              className="w-full px-3.5 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400 bg-white">
              {SECTIONS.map(s => <option key={s} value={s}>{SECTION_LABELS[s]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-600 mb-1">Label *</label>
            <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="e.g. Flow Rate, Voltage"
              className="w-full px-3.5 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400" />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-600 mb-1">
              Field Key <span className="text-neutral-400 font-normal">{!fieldKey && autoKey ? `(auto: ${autoKey})` : '(optional)'}</span>
            </label>
            <input value={fieldKey} onChange={e => setFieldKey(e.target.value)} placeholder={autoKey || 'auto-generated'}
              className="w-full px-3.5 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400" />
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-neutral-600 mb-1">Data Type</label>
              <select value={dataType} onChange={e => setDataType(e.target.value as AttributeDataType)}
                className="w-full px-3.5 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400 bg-white">
                {DATA_TYPES.map(dt => <option key={dt} value={dt}>{DATA_TYPE_LABELS[dt]}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-neutral-600 mb-1">Unit</label>
              <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="e.g. GPM, PSI, V"
                className="w-full px-3.5 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400" />
            </div>
          </div>
          {dataType === 'select' && <OptionsEditor value={options} onChange={setOptions} />}
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={isRequired} onChange={e => setIsRequired(e.target.checked)}
                className="w-4 h-4 rounded border-neutral-300 text-primary-500 focus:ring-primary-400" />
              <span className="text-sm text-neutral-700">Required</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={isSearchable} onChange={e => setIsSearchable(e.target.checked)}
                className="w-4 h-4 rounded border-neutral-300 text-primary-500 focus:ring-primary-400" />
              <span className="text-sm text-neutral-700">Searchable</span>
            </label>
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-neutral-600 mb-1">Sort Order</label>
              <input type="number" value={sortOrder} onChange={e => setSortOrder(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400" />
            </div>
          </div>
          <details className="text-sm">
            <summary className="text-neutral-500 cursor-pointer hover:text-neutral-700">Import Mapping (optional)</summary>
            <div className="grid grid-cols-2 gap-4 mt-3">
              <div>
                <label className="block text-sm font-medium text-neutral-600 mb-1">Source Header</label>
                <input value={sourceHeader} onChange={e => setSourceHeader(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-600 mb-1">Source Column</label>
                <input value={sourceColumn} onChange={e => setSourceColumn(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400" />
              </div>
            </div>
          </details>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 bg-neutral-100 text-neutral-700 rounded-xl text-sm font-medium hover:bg-neutral-200">Cancel</button>
          <button onClick={handleSave} disabled={!displayName.trim() || saving}
            className="px-4 py-2 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl text-sm font-medium hover:from-primary-600 hover:to-primary-700 shadow-md shadow-primary-200 disabled:opacity-50">
            {saving ? 'Saving…' : existing ? 'Save Changes' : 'Add Field'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Attribute Definitions List ──────────────────────────────────────

function AttributeDefinitions({
  assetType,
  canManage,
}: {
  assetType: AssetType
  canManage: boolean
}) {
  const [defs, setDefs] = useState<AssetAttributeDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ open: boolean; existing?: AssetAttributeDefinition | null }>({ open: false })
  const [deleting, setDeleting] = useState<string | null>(null)

  const fetchDefs = useCallback(async () => {
    const { data } = await supabase
      .from('asset_attribute_definitions')
      .select('*')
      .eq('asset_type_id', assetType.id)
      .order('sort_order')
      .order('display_name')
    setDefs(data ?? [])
    setLoading(false)
  }, [assetType.id])

  useEffect(() => { fetchDefs() }, [fetchDefs])

  const handleDelete = async (id: string) => {
    setDeleting(null)
    const { error } = await supabase.from('asset_attribute_definitions').delete().eq('id', id)
    if (error) { alert('Error deleting: ' + error.message); return }
    fetchDefs()
  }

  const grouped = SECTIONS.map(s => ({
    section: s,
    label: SECTION_LABELS[s],
    items: defs.filter(d => d.app_section === s),
  })).filter(g => g.items.length > 0)

  const nextSort = defs.length > 0 ? Math.max(...defs.map(d => d.sort_order ?? 0)) + 10 : 10

  if (loading) return <div className="py-4 text-center text-neutral-400 text-sm">Loading fields…</div>

  return (
    <div className="px-5 pb-5">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-neutral-600">Fields & Attributes</h4>
        {canManage && (
          <button onClick={() => setModal({ open: true, existing: null })}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700">
            <Plus className="w-3.5 h-3.5" /> Add Field
          </button>
        )}
      </div>

      {grouped.length === 0 ? (
        <p className="text-sm text-neutral-400 py-3">No fields defined yet.</p>
      ) : (
        <div className="space-y-4">
          {grouped.map(g => (
            <div key={g.section}>
              <h5 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">{g.label}</h5>
              <div className="border border-neutral-100 rounded-xl overflow-hidden divide-y divide-neutral-100">
                {g.items.map(d => (
                  <div key={d.id} className="flex items-center gap-3 px-3.5 py-2.5 bg-white hover:bg-neutral-50/50 group">
                    <GripVertical className="w-3.5 h-3.5 text-neutral-300 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-neutral-800">{d.display_name}</span>
                      {d.unit && <span className="text-xs text-neutral-400 ml-1.5">({d.unit})</span>}
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-neutral-400">{DATA_TYPE_LABELS[d.data_type]}</span>
                        {d.is_required && <span className="text-xs text-amber-600 font-medium">Required</span>}
                        {d.is_searchable && <span className="text-xs text-primary-500 font-medium">Searchable</span>}
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setModal({ open: true, existing: d })}
                          className="p-1.5 text-neutral-400 hover:text-primary-600 rounded-lg hover:bg-primary-50">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setDeleting(d.id)}
                          className="p-1.5 text-neutral-400 hover:text-red-600 rounded-lg hover:bg-red-50">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {modal.open && (
        <AttributeModal
          existing={modal.existing}
          assetTypeId={assetType.id}
          nextSort={nextSort}
          onClose={() => setModal({ open: false })}
          onSaved={fetchDefs}
        />
      )}

      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleting(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-neutral-800 mb-2">Delete Field</h3>
            <p className="text-sm text-neutral-600 mb-5">Are you sure? This will remove this field definition and any associated data values. This cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleting(null)} className="px-4 py-2 bg-neutral-100 text-neutral-700 rounded-xl text-sm font-medium hover:bg-neutral-200">Cancel</button>
              <button onClick={() => handleDelete(deleting)} className="px-4 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────

export default function AssetTypesPage() {
  const { currentFacility, currentOrganization } = useFacility()
  const { profile } = useAuth()

  const [assetTypes, setAssetTypes] = useState<(AssetType & { defCount: number })[]>([])
  const [loading, setLoading] = useState(true)
  const [canManage, setCanManage] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [modal, setModal] = useState<{ open: boolean; existing?: AssetType | null }>({ open: false })

  // Check user's role in the facility
  useEffect(() => {
    if (!currentFacility || !profile) return
    const checkRole = async () => {
      const { data } = await supabase
        .from('facility_members')
        .select('role')
        .eq('facility_id', currentFacility.id)
        .eq('user_id', profile.id)
        .single()
      const role = data?.role
      setCanManage(role === 'admin' || role === 'supervisor')
    }
    checkRole()
  }, [currentFacility, profile])

  // Fetch asset types with definition counts
  const fetchTypes = useCallback(async () => {
    if (!currentOrganization) return
    const { data } = await supabase
      .from('asset_types')
      .select('*, asset_attribute_definitions(id)')
      .eq('organization_id', currentOrganization.id)
      .order('sort_order')
      .order('name')
    setAssetTypes(
      (data ?? []).map((t: any) => ({
        ...t,
        defCount: Array.isArray(t.asset_attribute_definitions) ? t.asset_attribute_definitions.length : 0,
        asset_attribute_definitions: undefined,
      }))
    )
    setLoading(false)
  }, [currentOrganization])

  useEffect(() => { fetchTypes() }, [fetchTypes])

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  if (!currentFacility) return null

  return (
    <div className="p-4 lg:p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary-50 rounded-xl flex items-center justify-center">
            <Layers className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-neutral-800">Asset Types</h1>
            <p className="text-sm text-neutral-500">Define equipment categories and their data fields</p>
          </div>
        </div>
        {canManage && (
          <button onClick={() => setModal({ open: true, existing: null })}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl text-sm font-medium hover:from-primary-600 hover:to-primary-700 shadow-md shadow-primary-200">
            <Plus className="w-4 h-4" /> New Type
          </button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
        </div>
      )}

      {/* Empty State */}
      {!loading && assetTypes.length === 0 && (
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-12 text-center">
          <Package className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
          <p className="text-neutral-500 mb-2">No asset types configured.</p>
          <p className="text-sm text-neutral-400">
            {canManage ? (
              <>Create your first asset type to start defining equipment categories.{' '}
                <button onClick={() => setModal({ open: true, existing: null })} className="text-primary-600 hover:text-primary-700 font-medium">
                  Create Asset Type
                </button>
              </>
            ) : (
              'Ask a facility admin to create asset types for this facility.'
            )}
          </p>
        </div>
      )}

      {/* Asset Types List */}
      {!loading && assetTypes.length > 0 && (
        <div className="space-y-3">
          {assetTypes.map(at => {
            const isExpanded = expanded.has(at.id)
            return (
              <div key={at.id} className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
                {/* Type Header */}
                <div className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-neutral-50/50" onClick={() => toggleExpand(at.id)}>
                  <div className="text-neutral-400">
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-neutral-800">{at.name}</span>
                      {at.code && (
                        <span className="text-xs font-mono bg-neutral-100 text-neutral-500 px-2 py-0.5 rounded-md">{at.code}</span>
                      )}
                      <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${at.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-500'}`}>
                        {at.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    {at.description && <p className="text-sm text-neutral-500 mt-0.5 truncate">{at.description}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-neutral-400">
                      {at.defCount} {at.defCount === 1 ? 'field' : 'fields'}
                    </span>
                    {canManage && (
                      <button
                        onClick={e => { e.stopPropagation(); setModal({ open: true, existing: at }) }}
                        className="p-2 text-neutral-400 hover:text-primary-600 rounded-lg hover:bg-primary-50">
                        <Settings className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded: Attribute Definitions */}
                {isExpanded && (
                  <div className="border-t border-neutral-100">
                    <AttributeDefinitions assetType={at} canManage={canManage} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Asset Type Modal */}
      {modal.open && currentOrganization && (
        <AssetTypeModal
          existing={modal.existing}
          organizationId={currentOrganization.id}
          onClose={() => setModal({ open: false })}
          onSaved={fetchTypes}
        />
      )}
    </div>
  )
}
