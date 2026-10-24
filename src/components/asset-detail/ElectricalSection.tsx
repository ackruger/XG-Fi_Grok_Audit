import { useState, useEffect } from 'react'
import { Pencil, X, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import DynamicAttributeFields from '../DynamicAttributeFields'
import type { AssetAttributeDefinition } from '../../types'

interface Props {
  assetId: string
  assetTypeId: string | null
  canEdit: boolean
}

export default function ElectricalSection({ assetId, assetTypeId, canEdit }: Props) {
  const [definitions, setDefinitions] = useState<AssetAttributeDefinition[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [savedValues, setSavedValues] = useState<Record<string, string>>({})
  const [existingIds, setExistingIds] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [validationErrors, setValidationErrors] = useState<string[]>([])

  useEffect(() => {
    if (!assetTypeId) { setDefinitions([]); setLoading(false); return }
    supabase.from('asset_attribute_definitions').select('*')
      .eq('asset_type_id', assetTypeId)
      .eq('app_section', 'electrical_controls')
      .order('sort_order').order('display_name')
      .then(({ data }) => { setDefinitions(data || []); setLoading(false) })
  }, [assetTypeId])

  useEffect(() => {
    if (!assetId || definitions.length === 0) return
    const elecDefIds = new Set(definitions.map(d => d.id))
    supabase.from('asset_attribute_values').select('id, attribute_definition_id, value_text')
      .eq('asset_id', assetId).is('design_profile_id', null)
      .then(({ data }) => {
        const vals: Record<string, string> = {}
        const ids: Record<string, string> = {}
        for (const v of data || []) {
          if (elecDefIds.has(v.attribute_definition_id)) {
            vals[v.attribute_definition_id] = v.value_text || ''
            ids[v.attribute_definition_id] = v.id
          }
        }
        setValues(vals)
        setSavedValues(vals)
        setExistingIds(ids)
      })
  }, [assetId, definitions])

  async function handleSave() {
    const missing = definitions
      .filter(d => d.is_required && !(values[d.id] ?? '').trim())
      .map(d => d.display_name)
    if (missing.length > 0) {
      setValidationErrors(missing)
      return
    }
    setValidationErrors([])
    setSaving(true)
    const updates: any[] = []
    const inserts: any[] = []
    const deletes: string[] = []

    for (const def of definitions) {
      const val = values[def.id] || ''
      const existingId = existingIds[def.id]

      if (!val.trim()) {
        if (existingId) deletes.push(existingId)
        continue
      }

      const numVal = def.data_type === 'number' && isFinite(Number(val)) ? Number(val) : null
      const row = {
        asset_id: assetId,
        attribute_definition_id: def.id,
        value_text: val,
        value_numeric: numVal,
      }
      if (existingId) updates.push({ id: existingId, ...row })
      else inserts.push(row)
    }

    if (deletes.length > 0) {
      await supabase.from('asset_attribute_values').delete().in('id', deletes)
    }
    for (const u of updates) {
      const { id: rowId, ...rest } = u
      await supabase.from('asset_attribute_values').update(rest).eq('id', rowId)
    }
    if (inserts.length > 0) {
      await supabase.from('asset_attribute_values').insert(inserts)
    }

    const newExistingIds = { ...existingIds }
    for (const d of deletes) {
      const defIdForDeleted = Object.keys(existingIds).find(k => existingIds[k] === d)
      if (defIdForDeleted) delete newExistingIds[defIdForDeleted]
    }
    setExistingIds(newExistingIds)
    setSavedValues({ ...values })
    setEditing(false)
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
      </div>
    )
  }

  if (!assetTypeId || definitions.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm text-neutral-500">No electrical & controls fields configured for this asset type.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-neutral-700 uppercase tracking-wide">Electrical & Controls</h3>
        {canEdit && !editing && (
          <button onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700">
            <Pencil size={14} /> Edit
          </button>
        )}
        {editing && (
          <div className="flex items-center gap-2">
            <button onClick={() => { setValues(savedValues); setEditing(false); setValidationErrors([]) }}
              className="flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-700">
              <X size={14} /> Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 disabled:opacity-50">
              <Check size={14} /> {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}
      </div>
      {validationErrors.length > 0 && (
        <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-xs font-semibold text-amber-800 mb-1">Required fields are missing:</p>
          {validationErrors.map(name => (
            <p key={name} className="text-xs text-amber-700">{name} is required.</p>
          ))}
        </div>
      )}
      <DynamicAttributeFields
        definitions={definitions}
        values={values}
        onChange={(id, val) => setValues(prev => ({ ...prev, [id]: val }))}
        section="electrical_controls"
        readOnly={!editing}
      />
    </div>
  )
}
