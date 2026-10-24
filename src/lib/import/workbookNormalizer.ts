import type {
  ParsedWorkbook,
  ParsedSheet,
  NormalizedAsset,
  NormalizedAttribute,
  WorkbookDocument,
  DeferredItem,
  WorkbookImportSummary,
  WorkbookImportPreview,
  ImportAction,
} from './types'
import { getDocCategoryForSheet } from './xlsxParser'

let docIdCounter = 0
function nextDocId(): string {
  return `wdoc-${++docIdCounter}`
}
let assetIdCounter = 0
function nextAssetId(): string {
  return `wasset-${++assetIdCounter}`
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[\r\n\t]+/g, ' ').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function findHeaderIndex(headers: string[], ...candidates: string[]): number {
  const normalized = headers.map(normalizeHeader)
  for (const c of candidates) {
    const idx = normalized.indexOf(normalizeHeader(c))
    if (idx >= 0) return idx
  }
  return -1
}

function cellVal(row: string[], idx: number): string {
  return idx >= 0 && idx < row.length ? row[idx].trim() : ''
}

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

const PLACEHOLDER_VALUES = new Set([
  'generated', 'template', 'documents', 'n/a', 'na', '--', '-', '', 'tbd', 'pending',
  'yes', 'no', 'true', 'false', '0', '1',
])

function isPlaceholder(val: string): boolean {
  return PLACEHOLDER_VALUES.has(val.toLowerCase().trim())
}

function parseImportAction(val: string): ImportAction {
  const lower = val.toLowerCase().trim()
  if (lower === 'update') return 'update'
  if (lower === 'existing') return 'existing'
  if (lower === 'hold') return 'hold'
  return 'add'
}

/* ── Asset Sheet Parser ── */

function parseAssetSheet(sheet: ParsedSheet): { assets: NormalizedAsset[]; actions: Map<string, ImportAction> } {
  const h = sheet.headers
  const iImport = findHeaderIndex(h, 'import', 'import action', 'action')
  const iAssetId = findHeaderIndex(h, 'asset id', 'asset_id', 'assetid', 'equipment id', 'tag')
  const iName = findHeaderIndex(h, 'equipment name', 'name', 'description', 'function/description', 'function/ description')
  const iType = findHeaderIndex(h, 'asset type', 'type', 'equipment type')
  const iLevel = findHeaderIndex(h, 'level', 'floor')
  const iArea = findHeaderIndex(h, 'area served', 'area', 'zone')
  const iStatus = findHeaderIndex(h, 'status')
  const iMake = findHeaderIndex(h, 'make', 'manufacturer')
  const iModel = findHeaderIndex(h, 'model')
  const iSerial = findHeaderIndex(h, 'serial', 'serial number', 'serial_number')
  const iSystem = findHeaderIndex(h, 'system', 'systems')
  const iBim = findHeaderIndex(h, 'bim', 'bim id')
  const iSpace = findHeaderIndex(h, 'space')
  const iLoto = findHeaderIndex(h, 'loto', 'loto status')
  const iWarranty = findHeaderIndex(h, 'warranty', 'warranty expiry')
  const iRemarks = findHeaderIndex(h, 'remarks', 'comments', 'notes')

  const commonIndices = new Set([iImport, iAssetId, iName, iType, iLevel, iArea, iStatus, iMake, iModel, iSerial, iSystem, iBim, iSpace, iLoto, iWarranty, iRemarks].filter(i => i >= 0))

  const assets: NormalizedAsset[] = []
  const actions = new Map<string, ImportAction>()

  for (let ri = 0; ri < sheet.rows.length; ri++) {
    const row = sheet.rows[ri]
    const assetTag = cellVal(row, iAssetId)
    const name = cellVal(row, iName) || assetTag
    if (!name && !assetTag) continue

    const action = iImport >= 0 ? parseImportAction(cellVal(row, iImport)) : 'add'
    const typeName = cellVal(row, iType)
    const id = nextAssetId()

    const techAttrs: NormalizedAttribute[] = []
    for (let ci = 0; ci < row.length && ci < h.length; ci++) {
      if (commonIndices.has(ci)) continue
      const val = row[ci].trim()
      if (!val || isPlaceholder(val)) continue
      techAttrs.push({
        sourceHeader: h[ci],
        sourceColumn: ci,
        suggestedSection: 'technical',
        normalizedLabel: h[ci],
        value: val,
      })
    }

    const extraAttrs: NormalizedAttribute[] = []
    for (const [idx, label] of [[iSystem, 'System'], [iBim, 'BIM'], [iSpace, 'Space'], [iLoto, 'LOTO Status'], [iWarranty, 'Warranty Expiry']] as [number, string][]) {
      const val = cellVal(row, idx)
      if (val && !isPlaceholder(val)) {
        extraAttrs.push({ sourceHeader: label, sourceColumn: idx, suggestedSection: 'technical', normalizedLabel: label, value: val })
      }
    }

    const asset: NormalizedAsset = {
      id,
      sourceRow: ri + 2,
      sourceSection: 'Asset',
      rawCells: row,
      equipmentName: name,
      assetTag,
      isUntagged: !assetTag,
      suggestedAssetType: typeName || null,
      selectedAssetType: null,
      typeConfidence: typeName ? 'high' : 'unresolved',
      typeReason: typeName ? `Type from Asset sheet: "${typeName}"` : 'No type specified in Asset sheet',
      level: cellVal(row, iLevel),
      areaServed: cellVal(row, iArea),
      sourceStatus: cellVal(row, iStatus),
      manufacturer: cellVal(row, iMake),
      model: cellVal(row, iModel),
      serialNumber: cellVal(row, iSerial),
      drawingReference: '',
      specificationSection: '',
      notes: cellVal(row, iRemarks),
      technicalAttributes: [...techAttrs, ...extraAttrs],
      serviceAttributes: [],
      electricalAttributes: [],
      unmappedAttributes: [],
      relationshipCandidates: [],
      profileStatus: { type: 'none' },
      duplicateStatus: { type: 'none' },
      warnings: [],
      errors: [],
      infos: [],
    }

    if (action === 'hold') {
      asset.infos.push({ severity: 'info', message: 'Held — will not import until approved', field: 'import_action' })
    }
    if (action === 'update') {
      asset.infos.push({ severity: 'info', message: 'Update — will match and update existing asset', field: 'import_action' })
    }
    if (action === 'existing') {
      asset.infos.push({ severity: 'info', message: 'Existing — link data to existing asset without creating new', field: 'import_action' })
    }

    assets.push(asset)
    actions.set(id, action)
  }

  return { assets, actions }
}

/* ── Details Sheet Join ── */

function joinDetails(assets: NormalizedAsset[], detailSheet: ParsedSheet | null): void {
  if (!detailSheet) return
  const h = detailSheet.headers
  const iTag = findHeaderIndex(h, 'asset id', 'asset_id', 'tag', 'equipment id')
  if (iTag < 0) return

  const iType = findHeaderIndex(h, 'asset type', 'type')
  const iDesc = findHeaderIndex(h, 'description', 'name')
  const iMake = findHeaderIndex(h, 'make', 'manufacturer')
  const iModel = findHeaderIndex(h, 'model')
  const iSerial = findHeaderIndex(h, 'serial', 'serial number')
  const iSystem = findHeaderIndex(h, 'system', 'systems')
  const iBim = findHeaderIndex(h, 'bim')
  const iLevel = findHeaderIndex(h, 'level')
  const iZone = findHeaderIndex(h, 'zone')
  const iSpace = findHeaderIndex(h, 'space')
  const iLoto = findHeaderIndex(h, 'loto', 'loto status')
  const iWarranty = findHeaderIndex(h, 'warranty', 'warranty expiry')
  const iRemarks = findHeaderIndex(h, 'remarks')
  const skipIndices = new Set([iTag, iType, iDesc, iMake, iModel, iSerial, iSystem, iBim, iLevel, iZone, iSpace, iLoto, iWarranty, iRemarks].filter(i => i >= 0))

  const assetByTag = new Map<string, NormalizedAsset>()
  for (const a of assets) {
    if (a.assetTag) assetByTag.set(a.assetTag.toLowerCase(), a)
  }

  for (const row of detailSheet.rows) {
    const tag = cellVal(row, iTag).toLowerCase()
    const asset = assetByTag.get(tag)
    if (!asset) continue

    if (!asset.suggestedAssetType && iType >= 0) {
      const t = cellVal(row, iType)
      if (t) { asset.suggestedAssetType = t; asset.typeConfidence = 'high'; asset.typeReason = `Type from Details: "${t}"` }
    }
    if (iDesc >= 0) {
      const description = cellVal(row, iDesc)
      if (description && !isPlaceholder(description)) asset.equipmentName = description
    }
    if (!asset.manufacturer && iMake >= 0) asset.manufacturer = cellVal(row, iMake)
    if (!asset.model && iModel >= 0) asset.model = cellVal(row, iModel)
    if (!asset.serialNumber && iSerial >= 0) asset.serialNumber = cellVal(row, iSerial)
    if (iLevel >= 0 && !asset.level) asset.level = cellVal(row, iLevel)
    if (iRemarks >= 0) {
      const r = cellVal(row, iRemarks)
      if (r) asset.notes = asset.notes ? `${asset.notes}; ${r}` : r
    }

    for (const [idx, label] of [[iSystem, 'System'], [iBim, 'BIM'], [iZone, 'Zone'], [iSpace, 'Space'], [iLoto, 'LOTO Status'], [iWarranty, 'Warranty Expiry']] as [number, string][]) {
      const val = cellVal(row, idx)
      if (val && !isPlaceholder(val) && !asset.technicalAttributes.some(a => a.normalizedLabel === label && a.value === val)) {
        asset.technicalAttributes.push({ sourceHeader: label, sourceColumn: idx, suggestedSection: 'technical', normalizedLabel: label, value: val })
      }
    }

    for (let ci = 0; ci < row.length && ci < h.length; ci++) {
      if (skipIndices.has(ci)) continue
      const val = row[ci].trim()
      if (!val || isPlaceholder(val)) continue
      asset.technicalAttributes.push({
        sourceHeader: h[ci],
        sourceColumn: ci,
        suggestedSection: 'technical',
        normalizedLabel: h[ci],
        value: val,
      })
    }
  }
}

/* ── Document Sheet Parser ── */

const TAXONOMY_ONLY_HEADERS = new Set([
  'schedules', 'floorplans', 'schematics', 'risers', 'details',
  'mechanical', 'electrical', 'structural', 'architectural', 'plumbing',
  'fire protection', 'civil',
])

function isTaxonomyCell(val: string): boolean {
  const lower = val.toLowerCase().trim()
  return TAXONOMY_ONLY_HEADERS.has(lower) || isPlaceholder(lower)
}

function parseDocumentSheets(sheets: ParsedSheet[], facilityId: string): WorkbookDocument[] {
  // Deduplication keys are facility-independent; database queries scope them to the target facility.
  void facilityId
  docIdCounter = 0
  const docs: WorkbookDocument[] = []

  const metadataHeaders = new Set([
    'row id', 'rowid', 'asset id', 'assetid', 'asset tag', 'tag', 'equipment id',
    'url', 'link', 'external url', 'document id', 'doc id', 'number', 'ref', 'reference',
    'discipline', 'revision', 'rev', 'remarks', 'comments',
  ])

  for (const sheet of sheets) {
    const h = sheet.headers
    const category = getDocCategoryForSheet(sheet.name)
    const iAssetId = findHeaderIndex(h, 'asset id', 'asset_id', 'tag', 'equipment id', 'asset tag')
    const iUrl = findHeaderIndex(h, 'url', 'link', 'external url')
    const iDisc = findHeaderIndex(h, 'discipline')
    const iRev = findHeaderIndex(h, 'revision', 'rev')

    if (category === 'drawing' && isDrawingsTaxonomySheet(sheet)) continue

    for (let ri = 0; ri < sheet.rows.length; ri++) {
      const row = sheet.rows[ri]
      const assetTag = iAssetId >= 0 ? cellVal(row, iAssetId) : ''
      const rowUrl = iUrl >= 0 ? cellVal(row, iUrl) : ''
      const rowDiscipline = iDisc >= 0 ? cellVal(row, iDisc) : ''
      const revision = iRev >= 0 ? cellVal(row, iRev) : ''

      for (let ci = 0; ci < Math.min(row.length, h.length); ci++) {
        const header = normalizeHeader(h[ci])
        if (!header || metadataHeaders.has(header)) continue

        const value = row[ci].trim()
        if (!value || isPlaceholder(value) || isTaxonomyCell(value)) continue

        // Contractual/Drawings sheets frequently contain taxonomy templates. Only
        // create a record when the value looks like an actual document reference.
        if ((category === 'contractual' || category === 'drawing') &&
            !/[.\/\\]|https?:\/\//i.test(value) &&
            value.toLowerCase() === header) {
          continue
        }

        let externalUrl: string | null = null
        if (/^https?:\/\//i.test(value)) externalUrl = value
        else if (rowUrl && /^https?:\/\//i.test(rowUrl)) externalUrl = rowUrl

        let discipline = rowDiscipline || null
        if (!discipline) {
          const headerName = h[ci].trim()
          if (['mechanical','electrical','structural','architectural','plumbing','fire protection','civil']
            .includes(normalizeHeader(headerName))) {
            discipline = headerName
          }
        }

        const documentType = inferDocumentTypeFromHeader(h[ci], value, category, sheet.name)
        const key = [
          normalizeKey(value),
          category,
          normalizeKey(documentType || ''),
          normalizeKey(discipline || ''),
          normalizeKey(revision || ''),
        ].join('|')

        docs.push({
          id: nextDocId(),
          key,
          name: value,
          category,
          documentType,
          discipline,
          revision: revision || null,
          externalUrl,
          sourceSheet: sheet.name,
          sourceRow: ri + 2,
          linkedAssetTags: assetTag ? assetTag.split(/[,;]/).map(t => t.trim()).filter(Boolean) : [],
          isFacilityLevel: !assetTag,
          isDuplicate: false,
          duplicateOfKey: null,
        })
      }
    }
  }

  return docs
}

function inferDocumentTypeFromHeader(header: string, name: string, category: string, sheetName: string): string | null {
  const h = normalizeHeader(header)
  const explicit: Record<string, string> = {
    'specs': 'Specification',
    'specifications': 'Specification',
    'criteria': 'Design Criteria',
    'calcs': 'Calculations',
    'calculations': 'Calculations',
    'equipment schedule': 'Equipment Schedule',
    'points list': 'Points List',
    'operating sequences': 'Operating Sequences',
    'shop drawings': 'Shop Drawing',
    'shop drawing': 'Shop Drawing',
    'installation manual': 'Installation Manual',
    'service manual': 'Service Manual',
    'support contact': 'Support Contact',
    'document': 'Document',
    'record': 'Record',
  }
  return explicit[h] ?? inferDocumentType(name, category, sheetName)
}

function isDrawingsTaxonomySheet(sheet: ParsedSheet): boolean {
  let taxonomyCount = 0
  let realCount = 0
  for (const row of sheet.rows.slice(0, 20)) {
    for (const cell of row) {
      if (cell.trim() && !isTaxonomyCell(cell)) realCount++
      if (isTaxonomyCell(cell)) taxonomyCount++
    }
  }
  return taxonomyCount > realCount * 2
}

function inferDocumentType(name: string, category: string, sheetName: string): string | null {
  const lower = name.toLowerCase()
  if (lower.includes('schedule')) return 'Equipment Schedule'
  if (lower.includes('spec')) return 'Specification'
  if (lower.includes('criteria')) return 'Design Criteria'
  if (lower.includes('calc')) return 'Calculations'
  if (lower.includes('points list')) return 'Points List'
  if (lower.includes('sequences') || lower.includes('sequence of op')) return 'Operating Sequences'
  if (lower.includes('floor plan') || lower.includes('floorplan')) return 'Floor Plan'
  if (lower.includes('schematic')) return 'Schematic'
  if (lower.includes('riser')) return 'Riser Diagram'
  if (lower.includes('shop drawing')) return 'Shop Drawing'
  if (lower.includes('o&m') || lower.includes('manual')) return 'O&M Manual'
  if (lower.includes('submittal')) return 'Submittal'
  if (category === 'contractual') {
    if (lower.includes('contract')) return 'Contract'
    if (lower.includes('change order') || lower.includes('co ')) return 'Change Order'
    if (lower.includes('site instruction') || lower.includes('si ')) return 'Site Instruction'
    if (lower.includes('proposal')) return 'Proposal'
    if (lower.includes('bid')) return 'Bid Document'
    if (lower.includes('closeout')) return 'Closeout Document'
  }
  if (sheetName.toLowerCase() === 'records') return 'Record'
  return null
}

/* ── Deduplication ── */

function deduplicateDocuments(docs: WorkbookDocument[]): WorkbookDocument[] {
  const byKey = new Map<string, WorkbookDocument>()
  const result: WorkbookDocument[] = []

  for (const doc of docs) {
    const existing = byKey.get(doc.key)
    if (existing) {
      for (const tag of doc.linkedAssetTags) {
        if (!existing.linkedAssetTags.includes(tag)) {
          existing.linkedAssetTags.push(tag)
        }
      }
      if (!existing.isFacilityLevel && !doc.isFacilityLevel) {
        // keep as asset-linked
      } else if (doc.linkedAssetTags.length > 0) {
        existing.isFacilityLevel = false
      }
      if (doc.externalUrl && !existing.externalUrl) {
        existing.externalUrl = doc.externalUrl
      }
      result.push({ ...doc, isDuplicate: true, duplicateOfKey: doc.key })
    } else {
      byKey.set(doc.key, doc)
      result.push(doc)
    }
  }

  return result
}

/* ── Deferred Items ── */

function collectDeferred(workbook: ParsedWorkbook): DeferredItem[] {
  const items: DeferredItem[] = []

  for (const sheet of workbook.formSheets) {
    for (let ri = 0; ri < sheet.rows.length; ri++) {
      const row = sheet.rows[ri]
      const name = row.find(c => c.trim() && !isPlaceholder(c)) || sheet.name
      items.push({
        name,
        sourceSheet: sheet.name,
        sourceRow: ri + 2,
        reason: 'Form templates will be imported in a future release',
        category: 'form',
      })
    }
    if (sheet.rows.length === 0) {
      items.push({
        name: sheet.name,
        sourceSheet: sheet.name,
        sourceRow: 0,
        reason: 'Form sheet recognized but empty',
        category: 'form',
      })
    }
  }

  for (const sheet of workbook.activitySheets) {
    const count = sheet.rows.length
    items.push({
      name: `${sheet.name} (${count} row${count !== 1 ? 's' : ''})`,
      sourceSheet: sheet.name,
      sourceRow: 0,
      reason: 'Activity/chat history import deferred — author identity mapping required',
      category: 'activity',
    })
  }

  for (const sheet of workbook.unknownSheets) {
    items.push({
      name: sheet.name,
      sourceSheet: sheet.name,
      sourceRow: 0,
      reason: 'Unrecognized sheet — preserved for manual review',
      category: 'unknown',
    })
  }

  return items
}

/* ── Main Normalizer ── */

export function normalizeWorkbook(workbook: ParsedWorkbook, facilityId: string): WorkbookImportPreview {
  assetIdCounter = 0
  docIdCounter = 0

  let assets: NormalizedAsset[] = []
  const importActions = new Map<string, ImportAction>()

  if (workbook.assetSheet) {
    const result = parseAssetSheet(workbook.assetSheet)
    assets = result.assets
    for (const [k, v] of result.actions) importActions.set(k, v)
  }

  joinDetails(assets, workbook.detailSheet)

  const rawDocs = parseDocumentSheets(workbook.documentSheets, facilityId)
  const documents = deduplicateDocuments(rawDocs)
  const deferred = collectDeferred(workbook)

  const uniqueDocs = documents.filter(d => !d.isDuplicate)
  const duplicatedDocs = documents.filter(d => d.isDuplicate)

  const warnings: string[] = []
  const errors: string[] = []

  if (!workbook.assetSheet) {
    warnings.push('No Asset sheet found in workbook')
  }

  const actionCounts = { add: 0, update: 0, existing: 0, hold: 0 }
  for (const a of assets) {
    const action = importActions.get(a.id) || 'add'
    actionCounts[action]++
  }

  const totalLinks = uniqueDocs.reduce((sum, d) => sum + d.linkedAssetTags.length, 0)

  const summary: WorkbookImportSummary = {
    assetsToAdd: actionCounts.add,
    assetsToUpdate: actionCounts.update,
    assetsExisting: actionCounts.existing,
    assetsHeld: actionCounts.hold,
    documentsTotal: documents.length,
    documentsUnique: uniqueDocs.length,
    documentsDuplicated: duplicatedDocs.length,
    facilityLevelDocuments: uniqueDocs.filter(d => d.isFacilityLevel).length,
    assetLinkedDocuments: uniqueDocs.filter(d => !d.isFacilityLevel).length,
    documentAssetLinks: totalLinks,
    deferredItems: deferred.length,
    warnings,
    errors,
  }

  return { assets, documents, deferred, summary, importActions }
}
