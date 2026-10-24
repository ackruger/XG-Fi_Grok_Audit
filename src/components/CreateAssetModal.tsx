import { useState, useEffect } from 'react'
import { X, Check, ChevronDown, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useFacility } from '../context/FacilityContext'
import TagPicker from './TagPicker'
import DynamicAttributeFields from './DynamicAttributeFields'
import type { AssetType, AssetAttributeDefinition } from '../types'

interface Props {
  onClose: () => void
  onComplete: () => void
}

export default function CreateAssetModal({ onClose, onComplete }: Props) {
  const { currentFacility } = useFacility()
  const [equipmentName, setEquipmentName] = useState('')
  const [assetTag, setAssetTag] = useState('')
  const [assetTypeId, setAssetTypeId] = useState('')
  const [designStage, setDesignStage] = useState('')
  const [areaServed, setAreaServed] = useState('')
  const [building, setBuilding] = useState('')
  const [floor, setFloor] = useState('')
  const [roomArea, setRoomArea] = useState('')
  const [manufacturer, setManufacturer] = useState('')
  const [model, setModel] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [drawingRef, setDrawingRef] = useState('')
  const [specSection, setSpecSection] = useState('')
  const [systemId, setSystemId] = useState('')
  const [notes, setNotes] = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const [systems, setSystems] = useState<{ id: string; name: string }[]>([])
  const [assetTypes, setAssetTypes] = useState<AssetType[]>([])
  const [definitions, setDefinitions] = useState<AssetAttributeDefinition[]>([])
  const [attrValues, setAttrValues] = useState<Record<string, string>>({})
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!currentFacility) return
    supabase
      .from('asset_types')
      .select('*')
      .eq('facility_id', currentFacility.id)
      .eq('is_active', true)
      .order('sort_order')
      .order('name')
      .then(({ data }) => setAssetTypes(data || []))
    supabase
      .from('systems')
      .select('id, name')
      .eq('facility_id', currentFacility.id)
      .order('name')
      .then(({ data }) => setSystems(data || []))
  }, [currentFacility])

  useEffect(() => {
    if (!assetTypeId) { setDefinitions([]); setAttrValues({}); return }
    supabase
      .from('asset_attribute_definitions')
      .select('*')
      .eq('asset_type_id', assetTypeId)
      .order('sort_order')
      .order('display_name')
      .then(({ data }) => setDefinitions(data || []))
  }, [assetTypeId])

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
      let locationId: string | null = null
      if (building || floor || roomArea) {
        const { data: existingLoc } = await supabase
          .from('locations').select('id')
          .eq('facility_id', currentFacility.id)
          .eq('building', building).eq('floor', floor).eq('room_area', roomArea)
          .maybeSingle()
        if (existingLoc) {
          locationId = existingLoc.id
        } else {
          const { data: newLoc } = await supabase
            .from('locations')
            .insert({ facility_id: currentFacility.id, building, floor, room_area: roomArea })
            .select().maybeSingle()
          locationId = newLoc?.id || null
        }
      }

      const { data: assetData, error: assetErr } = await supabase.from('assets').insert({
        facility_id: currentFacility.id,
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
      }).select('id').maybeSingle()

      if (assetErr) throw assetErr
      if (!assetData) throw new Error('Asset was not created.')

      if (selectedTagIds.length > 0) {
        const { error: tagErr } = await supabase.from('asset_tags').insert(
          selectedTagIds.map(tagId => ({ asset_id: assetData.id, tag_id: tagId }))
        )
        if (tagErr) {
          setError('Asset created but tags could not be saved: ' + tagErr.message)
          setSubmitting(false)
          setTimeout(onComplete, 2000)
          return
        }
      }

      const attrInserts = Object.entries(attrValues)
        .filter(([, v]) => v.trim() !== '')
        .map(([defId, val]) => ({
          asset_id: assetData.id,
          attribute_definition_id: defId,
          value_text: val,
          value_numeric: isFinite(Number(val)) ? Number(val) : null,
        }))

      if (attrInserts.length > 0) {
        const { error: attrErr } = await supabase.from('asset_attribute_values').insert(attrInserts)
        if (attrErr) {
          setError('Asset created but some technical values could not be saved: ' + attrErr.message)
          setSubmitting(false)
          setTimeout(onComplete, 2000)
          return
        }
      }

      onComplete()
    } catch (err: any) {
      setError(err.message || 'Failed to create asset.')
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
          <h2 className="text-base font-semibold text-neutral-900">New Asset</h2>
          <button onClick={onClose} className="p-1 hover:bg-neutral-100 rounded-lg"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Equipment Name - required */}
          <div>
            <label className="block text-sm font-medium text-neutral-800 mb-1">
              Equipment Name <span className="text-red-500">*</span>
            </label>
            <input type="text" value={equipmentName} onChange={e => setEquipmentName(e.target.value)}
              placeholder="e.g. AHU-3, FCU-201" className={inputCls} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-neutral-800 mb-1">Asset Tag</label>
              <input type="text" value={assetTag} onChange={e => setAssetTag(e.target.value)}
                placeholder="Optional tag" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-800 mb-1">Asset Type</label>
              <select value={assetTypeId} onChange={e => setAssetTypeId(e.target.value)}
                className={inputCls}>
                <option value="">None</option>
                {assetTypes.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
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
              <input type="text" value={designStage} onChange={e => setDesignStage(e.target.value)}
                placeholder="e.g. Construction" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-800 mb-1">Area Served</label>
              <input type="text" value={areaServed} onChange={e => setAreaServed(e.target.value)}
                placeholder="e.g. Level 4" className={inputCls} />
            </div>
          </div>

          {/* Location */}
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

          {/* Details */}
          <div className="border-t border-neutral-200 pt-4">
            <p className="text-sm font-medium text-neutral-800 mb-2">Details</p>
            <div className="grid grid-cols-2 gap-2">
              <input type="text" value={manufacturer} onChange={e => setManufacturer(e.target.value)}
                placeholder="Manufacturer" className={inputCls} />
              <input type="text" value={model} onChange={e => setModel(e.target.value)}
                placeholder="Model" className={inputCls} />
              <input type="text" value={serialNumber} onChange={e => setSerialNumber(e.target.value)}
                placeholder="Serial Number" className={inputCls} />
              <input type="text" value={drawingRef} onChange={e => setDrawingRef(e.target.value)}
                placeholder="Drawing Reference" className={inputCls} />
              <input type="text" value={specSection} onChange={e => setSpecSection(e.target.value)}
                placeholder="Specification Section" className="col-span-2 px-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400" />
            </div>
          </div>

          {/* Dynamic attribute sections */}
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
                  <DynamicAttributeFields
                    definitions={definitions}
                    values={attrValues}
                    onChange={(id, val) => setAttrValues(prev => ({ ...prev, [id]: val }))}
                    section={key as any}
                  />
                )}
              </div>
            ) : null
          )}

          {/* Notes */}
          <div className="border-t border-neutral-200 pt-4">
            <label className="block text-sm font-medium text-neutral-800 mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Add any notes..." rows={3}
              className="w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400 resize-none" />
          </div>

          {/* Tags */}
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
              <><Check size={18} /> Create Asset</>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
