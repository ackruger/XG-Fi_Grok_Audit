import { useState, useRef } from 'react'
import { X, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Download } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useFacility } from '../context/FacilityContext'

interface Props {
  onClose: () => void
  onComplete: () => void
}

interface ParsedRow {
  equipment_name: string
  asset_tag: string
  equipment_type: string
  building: string
  floor: string
  room_area: string
  manufacturer: string
  model: string
  serial_number: string
  drawing_reference: string
  spec_section: string
}

type UploadState = 'select' | 'preview' | 'uploading' | 'done'

export default function CSVUploadModal({ onClose, onComplete }: Props) {
  const { currentFacility } = useFacility()
  const fileRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<UploadState>('select')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [uploadErrors, setUploadErrors] = useState<string[]>([])

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      parseCSV(text)
    }
    reader.readAsText(file)
  }

  function parseCSV(text: string) {
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) {
      setErrors(['CSV must have a header row and at least one data row.'])
      return
    }

    const header = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim().replace(/\s+/g, '_'))
    const nameIdx = findColumn(header, ['equipment_name', 'name', 'equipment', 'equip_name'])
    const tagIdx = findColumn(header, ['asset_tag', 'tag', 'asset_id', 'tag_id'])

    if (nameIdx === -1 && tagIdx === -1) {
      setErrors(['CSV must have at least an "equipment_name" or "asset_tag" column.'])
      return
    }

    const typeIdx = findColumn(header, ['equipment_type', 'type', 'equip_type', 'category'])
    const buildingIdx = findColumn(header, ['building', 'bldg'])
    const floorIdx = findColumn(header, ['floor', 'level'])
    const roomIdx = findColumn(header, ['room_area', 'room', 'area', 'space'])
    const mfgIdx = findColumn(header, ['manufacturer', 'mfg', 'make', 'brand'])
    const modelIdx = findColumn(header, ['model', 'model_number', 'model_no'])
    const serialIdx = findColumn(header, ['serial_number', 'serial', 'serial_no', 'sn'])
    const drawingIdx = findColumn(header, ['drawing_reference', 'drawing', 'drawing_ref', 'dwg'])
    const specIdx = findColumn(header, ['spec_section', 'spec', 'specification'])

    const parsed: ParsedRow[] = []
    const parseErrors: string[] = []

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i])
      const name = getCol(cols, nameIdx)
      const tag = getCol(cols, tagIdx)

      if (!name && !tag) {
        parseErrors.push(`Row ${i + 1}: missing equipment_name and asset_tag, skipped.`)
        continue
      }

      parsed.push({
        equipment_name: name || tag,
        asset_tag: tag || name,
        equipment_type: getCol(cols, typeIdx),
        building: getCol(cols, buildingIdx),
        floor: getCol(cols, floorIdx),
        room_area: getCol(cols, roomIdx),
        manufacturer: getCol(cols, mfgIdx),
        model: getCol(cols, modelIdx),
        serial_number: getCol(cols, serialIdx),
        drawing_reference: getCol(cols, drawingIdx),
        spec_section: getCol(cols, specIdx),
      })
    }

    setErrors(parseErrors)
    setRows(parsed)
    if (parsed.length > 0) setState('preview')
  }

  async function handleUpload() {
    if (!currentFacility || rows.length === 0) return
    setState('uploading')
    setProgress({ done: 0, total: rows.length })
    const errs: string[] = []

    const locationCache = new Map<string, string>()

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      try {
        let locationId: string | null = null
        if (row.building || row.floor || row.room_area) {
          const locKey = `${row.building}|${row.floor}|${row.room_area}`
          if (locationCache.has(locKey)) {
            locationId = locationCache.get(locKey)!
          } else {
            const { data: existing } = await supabase
              .from('locations')
              .select('id')
              .eq('facility_id', currentFacility.id)
              .eq('building', row.building)
              .eq('floor', row.floor)
              .eq('room_area', row.room_area)
              .maybeSingle()

            if (existing) {
              locationId = existing.id
              locationCache.set(locKey, existing.id)
            } else {
              const { data: newLoc } = await supabase
                .from('locations')
                .insert({ facility_id: currentFacility.id, building: row.building, floor: row.floor, room_area: row.room_area })
                .select('id')
                .maybeSingle()
              if (newLoc) {
                locationId = newLoc.id
                locationCache.set(locKey, newLoc.id)
              }
            }
          }
        }

        const { error } = await supabase.from('assets').insert({
          facility_id: currentFacility.id,
          equipment_name: row.equipment_name,
          asset_tag: row.asset_tag,
          equipment_type: row.equipment_type || null,
          location_id: locationId,
          manufacturer: row.manufacturer || null,
          model: row.model || null,
          serial_number: row.serial_number || null,
          drawing_reference: row.drawing_reference || null,
          spec_section: row.spec_section || null,
        })

        if (error) errs.push(`Row ${i + 1} (${row.equipment_name}): ${error.message}`)
      } catch (err: any) {
        errs.push(`Row ${i + 1} (${row.equipment_name}): ${err.message}`)
      }
      setProgress({ done: i + 1, total: rows.length })
    }

    setUploadErrors(errs)
    setState('done')
  }

  function downloadTemplate() {
    const headers = 'equipment_name,asset_tag,equipment_type,building,floor,room_area,manufacturer,model,serial_number,drawing_reference,spec_section'
    const example = 'AHU-1,AHU-001,Air Handling Unit,Building A,Floor 2,Room 201,Carrier,39M,SN-12345,DWG-M-101,23 0000'
    const csv = `${headers}\n${example}`
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'asset_upload_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white border border-neutral-200 w-full max-w-lg rounded-t-2xl lg:rounded-2xl max-h-[90vh] overflow-y-auto shadow-lg">
        <div className="sticky top-0 bg-white border-b border-neutral-200 px-4 py-3 flex items-center justify-between rounded-t-2xl z-10">
          <h2 className="text-base font-semibold text-neutral-900">Import Assets from CSV</h2>
          <button onClick={onClose} className="p-1 hover:bg-neutral-100 rounded-lg">
            <X size={20} />
          </button>
        </div>

        <div className="p-4">
          {state === 'select' && (
            <div className="space-y-4">
              <div
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-neutral-300 rounded-2xl p-8 text-center cursor-pointer hover:border-primary-400 hover:bg-primary-50/30 transition-colors"
              >
                <FileSpreadsheet size={40} className="mx-auto text-neutral-400 mb-3" />
                <p className="text-sm font-medium text-neutral-700">Click to select a CSV file</p>
                <p className="text-xs text-neutral-500 mt-1">Supports .csv files with headers</p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileSelect}
                className="hidden"
              />

              <button
                onClick={downloadTemplate}
                className="w-full flex items-center justify-center gap-2 text-sm text-primary-600 hover:text-primary-700 py-2 rounded-xl hover:bg-primary-50 transition-colors font-medium"
              >
                <Download size={16} />
                Download CSV Template
              </button>

              <div className="bg-neutral-50 rounded-xl p-3 border border-neutral-200">
                <p className="text-xs font-medium text-neutral-700 mb-1.5">Expected columns:</p>
                <p className="text-xs text-neutral-500 leading-relaxed">
                  equipment_name, asset_tag, equipment_type, building, floor, room_area, manufacturer, model, serial_number, drawing_reference, spec_section
                </p>
                <p className="text-xs text-neutral-400 mt-1.5">At minimum, include equipment_name or asset_tag.</p>
              </div>

              {errors.length > 0 && (
                <div className="bg-error-50 border border-error-200 rounded-xl p-3">
                  {errors.map((err, i) => (
                    <p key={i} className="text-xs text-error-700">{err}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {state === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 bg-success-50 border border-success-200 rounded-xl px-3 py-2">
                <CheckCircle2 size={16} className="text-success-600" />
                <p className="text-sm text-success-700 font-medium">{rows.length} assets ready to import</p>
              </div>

              {errors.length > 0 && (
                <div className="bg-warning-50 border border-warning-200 rounded-xl p-3">
                  <p className="text-xs font-medium text-warning-700 mb-1">Warnings:</p>
                  {errors.map((err, i) => (
                    <p key={i} className="text-xs text-warning-600">{err}</p>
                  ))}
                </div>
              )}

              <div className="max-h-60 overflow-y-auto border border-neutral-200 rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-neutral-50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-neutral-600">#</th>
                      <th className="text-left px-3 py-2 font-medium text-neutral-600">Name</th>
                      <th className="text-left px-3 py-2 font-medium text-neutral-600">Tag</th>
                      <th className="text-left px-3 py-2 font-medium text-neutral-600">Type</th>
                      <th className="text-left px-3 py-2 font-medium text-neutral-600">Location</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {rows.slice(0, 50).map((row, i) => (
                      <tr key={i} className="hover:bg-neutral-50">
                        <td className="px-3 py-2 text-neutral-500">{i + 1}</td>
                        <td className="px-3 py-2 text-neutral-900 font-medium">{row.equipment_name}</td>
                        <td className="px-3 py-2 text-neutral-600">{row.asset_tag}</td>
                        <td className="px-3 py-2 text-neutral-600">{row.equipment_type || '-'}</td>
                        <td className="px-3 py-2 text-neutral-600">
                          {[row.building, row.floor, row.room_area].filter(Boolean).join(' / ') || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 50 && (
                  <p className="text-xs text-neutral-500 text-center py-2">...and {rows.length - 50} more</p>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => { setState('select'); setRows([]); setErrors([]) }}
                  className="flex-1 py-2.5 rounded-xl border border-neutral-200 text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleUpload}
                  className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white py-2.5 rounded-xl text-sm font-medium shadow-md shadow-primary-200"
                >
                  <Upload size={16} />
                  Import {rows.length} Assets
                </button>
              </div>
            </div>
          )}

          {state === 'uploading' && (
            <div className="py-8 space-y-4">
              <div className="flex flex-col items-center">
                <div className="w-10 h-10 border-3 border-primary-200 border-t-primary-500 rounded-full animate-spin mb-4" />
                <p className="text-sm font-medium text-neutral-700">Importing assets...</p>
                <p className="text-xs text-neutral-500 mt-1">{progress.done} of {progress.total}</p>
              </div>
              <div className="w-full bg-neutral-200 rounded-full h-2">
                <div
                  className="bg-primary-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          {state === 'done' && (
            <div className="py-6 space-y-4">
              <div className="flex flex-col items-center text-center">
                {uploadErrors.length === 0 ? (
                  <>
                    <CheckCircle2 size={40} className="text-success-500 mb-3" />
                    <p className="text-sm font-semibold text-neutral-900">Import Complete</p>
                    <p className="text-xs text-neutral-500 mt-1">
                      Successfully imported {rows.length} assets.
                    </p>
                  </>
                ) : (
                  <>
                    <AlertCircle size={40} className="text-warning-500 mb-3" />
                    <p className="text-sm font-semibold text-neutral-900">Import Complete with Errors</p>
                    <p className="text-xs text-neutral-500 mt-1">
                      Imported {rows.length - uploadErrors.length} of {rows.length} assets.
                    </p>
                  </>
                )}
              </div>

              {uploadErrors.length > 0 && (
                <div className="max-h-32 overflow-y-auto bg-error-50 border border-error-200 rounded-xl p-3">
                  {uploadErrors.map((err, i) => (
                    <p key={i} className="text-xs text-error-700">{err}</p>
                  ))}
                </div>
              )}

              <button
                onClick={onComplete}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white py-3 rounded-xl text-sm font-medium shadow-md shadow-primary-200"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

function findColumn(headers: string[], names: string[]): number {
  for (const name of names) {
    const idx = headers.indexOf(name)
    if (idx !== -1) return idx
  }
  return -1
}

function getCol(cols: string[], idx: number): string {
  if (idx === -1 || idx >= cols.length) return ''
  return cols[idx].trim()
}
