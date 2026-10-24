import { useState, useEffect } from 'react'
import { X, Check, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useFacility } from '../context/FacilityContext'
import TagPicker from './TagPicker'
import DynamicAttributeFields from './DynamicAttributeFields'
import type { Asset, AssetType, AssetAttributeDefinition, OperationalStatus, LifecycleStage, IdentificationStatus, ChecklistFocus } from '../types'

interface Props {
  asset: Asset
  onClose: () => void
  onComplete: () => void
}

export default function EditAssetModal({ asset, onClose, onComplete }: Props) {
  const { currentFacility } = useFacility()
  const [equipmentName, setEquipmentName] = useState(asset.equipment_name || '')
  const [assetTag, setAssetTag] = useState(asset.asset_tag || '')
  const [assetTypeId, setAssetTypeId] = useState(asset.asset_type_id || '')
  const [originalTypeId] = useState(asset.asset_type_id || '')
  const [designStage, setDesignStage] = useState(asset.design_stage || '')
  const [areaServed, setAreaServed] = useState(asset.area_served || '')
  const [building, setBuilding] = useState('')
  const [floor, setFloor] = useState('')
  const [roomArea, setRoomArea] = useState('')
  const [manufacturer, setManufacturer] = useState(asset.manufacturer || '')
  const [model, setModel] = useState(asset.model || '')
  const [serialNumber, setSerialNumber] = useState(asset.serial_number || '')
  const [drawingRef, setDrawingRef] = useState(asset.drawing_reference || '')
  const [specSection, setSpecSection] = useState(asset.spec_section || '')
  const [systemId, setSystemId] = useState(asset.system_id || '')
  const [notes, setNotes] = useState(asset.notes || '')
  const [alias, setAlias] = useState(asset.alias || '')
  const [operationalStatus, setOperationalStatus] = useState<OperationalStatus>(asset.operational_status || 'active')
  const [lifecycleStage, setLifecycleStage] = useState<LifecycleStage | ''>(asset.lifecycle_stage || '')
  const [identificationStatus, setIdentificationStatus] = useState<IdentificationStatus>(asset.identification_status || 'identified')
  const [criticality, setCriticality] = useState(asset.criticality || '')
  const [staticNotes, setStaticNotes] = useState(asset.static_notes || '')
  const [trades, setTrades] = useState((asset.trades || []).join(', '))
  const [systemServed, setSystemServed] = useState(asset.system_served || '')
  const [bimX, setBimX] = useState(asset.bim_x != null ? String(asset.bim_x) : '')
  const [bimY, setBimY] = useState(asset.bim_y != null ? String(asset.bim_y) : '')
  const [bimZ, setBimZ] = useState(asset.bim_z != null ? String(asset.bim_z) : '')
  const [gridline, setGridline] = useState(asset.gridline || '')
  const [zone, setZone] = useState(asset.zone || '')
  const [space, setSpace] = useState(asset.space || '')
  const [level, setLevel] = useState(asset.level || '')
  const [checklistFocus, setChecklistFocus] = useState<ChecklistFocus | ''>(asset.checklist_focus || '')
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const [systems, setSystems] = useState<{ id: string; name: string }[]>([])
  const [assetTypes, setAssetTypes] = useState<AssetType[]>([])
  const [definitions, setDefinitions] = useState<AssetAttributeDefinition[]>([])
  const [attrValues, setAttrValues] = useState<Record<string, string>>({})
  const [existingValueIds, setExistingValueIds] = useState<Record<string, string>>({})
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})
  const [showTypeChangeWarning, setShowTypeChangeWarning] = useState(false)

  const [existingValueCount, setExistingValueCount] = useState(0)
  const [existingProfileCount, setExistingProfileCount] = useState(0)

  useEffect(() => {
    supabase.from('asset_attribute_values').select('id', { count: 'exact', head: true })
      .eq('asset_id', asset.id)
      .then(({ count }) => setExistingValueCount(count || 0))
    supabase.from('asset_design_profiles').select('id', { count: 'exact', head: true })
      .eq('asset_id', asset.id)
      .then(({ count }) => setExistingProfileCount(count || 0))
  }, [asset.id])

  useEffect(() => {
    if (asset.location_id) {
      supabase.from('locations').select('building, floor, room_area')
        .eq('id', asset.location_id).maybeSingle()
        .then(({ data }) => {
          if (data) { setBuilding(data.building || ''); setFloor(data.floor || ''); setRoomArea(data.room_area || '') }
        })
    }
    supabase.from('asset_tags').select('tag_id').eq('asset_id', asset.id)
      .then(({ data }) => setSelectedTagIds((data || []).map(r => r.tag_id)))
  }, [asset.id, asset.location_id])

  useEffect(() => {
    if (!currentFacility) return
    supabase.from('asset_types').select('*')
      .eq('facility_id', currentFacility.id).eq('is_active', true)
      .order('sort_order').order('name')
      .then(({ data }) => setAssetTypes(data || []))
    supabase.from('systems').select('id, name')
      .eq('facility_id', currentFacility.id).order('name')
      .then(({ data }) => setSystems(data || []))
  }, [currentFacility])

  useEffect(() => {
    if (!assetTypeId) { setDefinitions([]); return }
    supabase.from('asset_attribute_definitions').select('*')
      .eq('asset_type_id', assetTypeId).order('sort_order').order('display_name')
      .then(({ data }) => setDefinitions(data || []))
  }, [assetTypeId])

  useEffect(() => {
    supabase.from('asset_attribute_values').select('id, attribute_definition_id, value_text')
      .eq('asset_id', asset.id).is('design_profile_id', null)
      .then(({ data }) => {
        const vals: Record<string, string> = {}
        const ids: Record<string, string> = {}
        for (const v of data || []) {
          vals[v.attribute_definition_id] = v.value_text || ''
          ids[v.attribute_definition_id] = v.id
        }
        setAttrValues(vals)
        setExistingValueIds(ids)
      })
  }, [asset.id])

  const hasTechnicalData = existingValueCount > 0 || existingProfileCount > 0

  function handleTypeChange(newTypeId: string) {
    if (originalTypeId && newTypeId !== originalTypeId && hasTechnicalData) {
      setShowTypeChangeWarning(true)
    } else {
      setAssetTypeId(newTypeId)
    }
  }

  function toggleSection(key: string) {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const sectionGroups = [
    { key: 'technical', label: 'Technical / Design' },
    { key: 'service', label: 'Service' },
    { key: 'electrical_controls', label: 'Electrical & Controls' },
  ] as const

  const hasDefs = (section: string) => definitions.some(d => d.app_section === section)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!equipmentName.trim()) { setError('Equipment Name is required.'); return }
    if (!currentFacility) return

    setSubmitting(true)
    setError('')

    try {
      let locationId: string | null = asset.location_id
      const locGridline = gridline.trim() || null
      const locZone = zone.trim() || null
      const locSpace = space.trim() || null
      if (building || floor || roomArea || locGridline || locZone || locSpace) {
        const { data: existingLoc } = await supabase.from('locations').select('id')
          .eq('facility_id', currentFacility.id)
          .eq('building', building).eq('floor', floor).eq('room_area', roomArea)
          .maybeSingle()
        if (existingLoc) {
          await supabase.from('locations').update({ gridline: locGridline, zone: locZone, space: locSpace }).eq('id', existingLoc.id)
          locationId = existingLoc.id
        } else {
          const { data: newLoc } = await supabase.from('locations')
            .insert({ facility_id: currentFacility.id, building, floor, room_area: roomArea, gridline: locGridline, zone: locZone, space: locSpace })
            .select().maybeSingle()
          locationId = newLoc?.id || null
        }
      } else { locationId = null }

      const bimXNum = bimX.trim() === '' ? null : isFinite(Number(bimX)) ? Number(bimX) : null
      const bimYNum = bimY.trim() === '' ? null : isFinite(Number(bimY)) ? Number(bimY) : null
      const bimZNum = bimZ.trim() === '' ? null : isFinite(Number(bimZ)) ? Number(bimZ) : null

      const { error: updateErr } = await supabase.from('assets').update({
        equipment_name: equipmentName.trim(),
        asset_tag: assetTag.trim() || null,
        asset_type_id: assetTypeId || null,
        equipment_type: assetTypes.find(t => t.id === assetTypeId)?.name || '',
        system_id: systemId || null,
        design_stage: designStage || null,
        area_served: areaServed || null,
        location_id: locationId,
        manufacturer: manufacturer || null,
        model: model || null,
        serial_number: serialNumber || null,
        drawing_reference: drawingRef || null,
        spec_section: specSection || null,
        notes: notes || null,
        alias: alias.trim() || null,
        operational_status: operationalStatus,
        lifecycle_stage: lifecycleStage || null,
        identification_status: identificationStatus,
        criticality: criticality.trim() || null,
        static_notes: staticNotes || null,
        trades: trades.trim() ? trades.split(',').map(t => t.trim()).filter(Boolean) : null,
        system_served: systemServed.trim() || null,
        bim_x: bimXNum,
        bim_y: bimYNum,
        bim_z: bimZNum,
        gridline: gridline.trim() || null,
        zone: zone.trim() || null,
        space: space.trim() || null,
        level: level.trim() || null,
        checklist_focus: checklistFocus || null,
      }).eq('id', asset.id)

      if (updateErr) throw updateErr

      await supabase.from('asset_tags').delete().eq('asset_id', asset.id)
      if (selectedTagIds.length > 0) {
        await supabase.from('asset_tags').insert(
          selectedTagIds.map(tagId => ({ asset_id: asset.id, tag_id: tagId }))
        )
      }

      const upserts: any[] = []
      const inserts: any[] = []
      for (const [defId, val] of Object.entries(attrValues)) {
        if (!val.trim()) continue
        const row = {
          asset_id: asset.id,
          attribute_definition_id: defId,
          value_text: val,
          value_numeric: isFinite(Number(val)) ? Number(val) : null,
        }
        if (existingValueIds[defId]) {
          upserts.push({ id: existingValueIds[defId], ...row })
        } else {
          inserts.push(row)
        }
      }
      if (upserts.length > 0) {
        for (const row of upserts) {
          await supabase.from('asset_attribute_values').update(row).eq('id', row.id)
        }
      }
      if (inserts.length > 0) {
        await supabase.from('asset_attribute_values').insert(inserts)
      }

      onComplete()
    } catch (err: any) {
      setError(err.message || 'Failed to save changes.')
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls = 'w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400'

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center pb-20 lg:pb-0">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white border border-neutral-200 w-full max-w-lg rounded-t-2xl lg:rounded-2xl max-h-[80vh] lg:max-h-[90vh] overflow-y-auto shadow-lg">
        <div className="sticky top-0 bg-white border-b border-neutral-200 px-4 py-3 flex items-center justify-between rounded-t-2xl z-10">
          <h2 className="text-base font-semibold text-neutral-900">Edit Asset</h2>
          <button onClick={onClose} className="p-1 hover:bg-neutral-100 rounded-lg"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-800 mb-1">
              Equipment Name <span className="text-red-500">*</span>
            </label>
            <input type="text" value={equipmentName} onChange={e => setEquipmentName(e.target.value)}
              className={inputCls} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-neutral-800 mb-1">Asset Tag</label>
              <input type="text" value={assetTag} onChange={e => setAssetTag(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-800 mb-1">Asset Type</label>
              <select value={assetTypeId} onChange={e => handleTypeChange(e.target.value)} className={inputCls}>
                <option value="">None</option>
                {assetTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-800 mb-1">System</label>
            <select value={systemId} onChange={e => setSystemId(e.target.value)} className={inputCls}>
              <option value="">None</option>
              {systems.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-neutral-800 mb-1">Design Stage</label>
              <input type="text" value={designStage} onChange={e => setDesignStage(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-800 mb-1">Area Served</label>
              <input type="text" value={areaServed} onChange={e => setAreaServed(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="border-t border-neutral-200 pt-4">
            <p className="text-sm font-medium text-neutral-800 mb-2">Location</p>
            <div className="grid grid-cols-3 gap-2">
              <input type="text" value={building} onChange={e => setBuilding(e.target.value)}
                placeholder="Building" className={inputCls} />
              <input type="text" value={floor} onChange={e => setFloor(e.target.value)}
                placeholder="Floor" className={inputCls} />
              <input type="text" value={roomArea} onChange={e => setRoomArea(e.target.value)}
                placeholder="Room/Area" className={inputCls} />
            </div>
          </div>

          <div className="border-t border-neutral-200 pt-4">
            <p className="text-sm font-medium text-neutral-800 mb-2">Details</p>
            <div className="grid grid-cols-2 gap-2">
              <input type="text" value={manufacturer} onChange={e => setManufacturer(e.target.value)} placeholder="Manufacturer" className={inputCls} />
              <input type="text" value={model} onChange={e => setModel(e.target.value)} placeholder="Model" className={inputCls} />
              <input type="text" value={serialNumber} onChange={e => setSerialNumber(e.target.value)} placeholder="Serial Number" className={inputCls} />
              <input type="text" value={drawingRef} onChange={e => setDrawingRef(e.target.value)} placeholder="Drawing Reference" className={inputCls} />
              <input type="text" value={specSection} onChange={e => setSpecSection(e.target.value)} placeholder="Specification Section" className={`col-span-2 ${inputCls}`} />
            </div>
          </div>

          {definitions.length > 0 && sectionGroups.map(({ key, label }) =>
            hasDefs(key) ? (
              <div key={key} className="border-t border-neutral-200 pt-3">
                <button type="button" onClick={() => toggleSection(key)}
                  className="flex items-center gap-2 text-sm font-medium text-neutral-800 w-full text-left mb-2">
                  {expandedSections[key] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  {label}
                  <span className="text-xs text-neutral-400 font-normal ml-auto">
                    {definitions.filter(d => d.app_section === key).length} fields
                  </span>
                </button>
                {expandedSections[key] && (
                  <DynamicAttributeFields definitions={definitions} values={attrValues}
                    onChange={(id, val) => setAttrValues(prev => ({ ...prev, [id]: val }))}
                    section={key as any} />
                )}
              </div>
            ) : null
          )}

          <div className="border-t border-neutral-200 pt-4">
            <p className="text-sm font-medium text-neutral-800 mb-2">Xg-Fi Ver2 Fields</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-0.5">Alias</label>
                <input type="text" value={alias} onChange={e => setAlias(e.target.value)} placeholder="Alternative name" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-0.5">Criticality</label>
                <input type="text" value={criticality} onChange={e => setCriticality(e.target.value)} placeholder="e.g. Critical, High" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-0.5">Operational Status</label>
                <select value={operationalStatus} onChange={e => setOperationalStatus(e.target.value as OperationalStatus)} className={inputCls}>
                  <option value="active">Active</option>
                  <option value="shut_down">Shut Down</option>
                  <option value="pending">Pending</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-0.5">Lifecycle Stage</label>
                <select value={lifecycleStage} onChange={e => setLifecycleStage(e.target.value as LifecycleStage | '')} className={inputCls}>
                  <option value="">—</option>
                  <option value="received">Received</option>
                  <option value="installed">Installed</option>
                  <option value="commissioned">Commissioned</option>
                  <option value="warranty">Warranty</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-0.5">Identification Status</label>
                <select value={identificationStatus} onChange={e => setIdentificationStatus(e.target.value as IdentificationStatus)} className={inputCls}>
                  <option value="identified">Identified</option>
                  <option value="unidentified">Unidentified</option>
                  <option value="needs_review">Needs Review</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-0.5">Checklist Focus</label>
                <select value={checklistFocus} onChange={e => setChecklistFocus(e.target.value as ChecklistFocus | '')} className={inputCls}>
                  <option value="">—</option>
                  <option value="rough_in">Rough In</option>
                  <option value="startup">Startup</option>
                  <option value="commissioning">Commissioning</option>
                  <option value="general">General</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-0.5">System Served</label>
                <input type="text" value={systemServed} onChange={e => setSystemServed(e.target.value)} placeholder="e.g. HVAC, Plumbing" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-0.5">Trades (comma-separated)</label>
                <input type="text" value={trades} onChange={e => setTrades(e.target.value)} placeholder="e.g. Mechanical, Electrical" className={inputCls} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2">
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-0.5">Gridline</label>
                <input type="text" value={gridline} onChange={e => setGridline(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-0.5">Zone</label>
                <input type="text" value={zone} onChange={e => setZone(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-0.5">Space</label>
                <input type="text" value={space} onChange={e => setSpace(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 mt-2">
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-0.5">BIM X</label>
                <input type="number" step="any" value={bimX} onChange={e => setBimX(e.target.value)} placeholder="—" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-0.5">BIM Y</label>
                <input type="number" step="any" value={bimY} onChange={e => setBimY(e.target.value)} placeholder="—" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-0.5">BIM Z (optional)</label>
                <input type="number" step="any" value={bimZ} onChange={e => setBimZ(e.target.value)} placeholder="—" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-0.5">Level</label>
                <input type="text" value={level} onChange={e => setLevel(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div className="mt-2">
              <label className="block text-xs font-medium text-neutral-600 mb-0.5">Static Notes</label>
              <textarea value={staticNotes} onChange={e => setStaticNotes(e.target.value)} rows={2} className={`w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400 resize-none`} />
            </div>
          </div>

          <div className="border-t border-neutral-200 pt-4">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              className="w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400 resize-none" />
          </div>

          <div className="border-t border-neutral-200 pt-4">
            <TagPicker selectedTagIds={selectedTagIds} onChange={setSelectedTagIds} />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-xl">{error}</div>
          )}

          <button type="submit" disabled={submitting}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white py-3 rounded-xl text-sm font-medium disabled:opacity-50 shadow-md shadow-primary-200">
            {submitting ? (
              <div className="w-5 h-5 border-2 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
            ) : (
              <><Check size={18} /> Save Changes</>
            )}
          </button>
        </form>

        {showTypeChangeWarning && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/30" onClick={() => setShowTypeChangeWarning(false)} />
            <div className="relative bg-white rounded-2xl p-6 max-w-sm mx-4 shadow-xl">
              <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-neutral-900 text-center mb-2">Cannot Change Asset Type</h3>
              <p className="text-sm text-neutral-600 text-center mb-4">
                This asset already contains technical information or design profiles.
                Changing its Asset Type could invalidate that data.
                Remove or migrate this information before changing the Asset Type.
              </p>
              <button onClick={() => setShowTypeChangeWarning(false)}
                className="w-full py-2 text-sm font-medium text-neutral-700 bg-neutral-100 rounded-xl hover:bg-neutral-200">
                Understood
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
