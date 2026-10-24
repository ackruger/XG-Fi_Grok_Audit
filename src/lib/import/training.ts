import type { NormalizedAsset, NormalizedAttribute, ImportAction } from './types'

/* ── Training fixture ──
A harmless synthetic one-asset training fixture, clearly labelled "Training".
Used with a rolled-back or isolated test path rather than production assets.
*/

export function createTrainingFixture(): NormalizedAsset {
  const technicalAttrs: NormalizedAttribute[] = [
    { sourceHeader: 'Airflow (CFM)', sourceColumn: 5, suggestedSection: 'technical', normalizedLabel: 'Airflow', value: '2000', unit: 'CFM' },
    { sourceHeader: 'Static Pressure', sourceColumn: 6, suggestedSection: 'technical', normalizedLabel: 'Static Pressure', value: '1.5', unit: 'inWG' },
  ]

  return {
    id: 'training-fixture-001',
    sourceRow: 1,
    sourceSection: 'TRAINING FIXTURE',
    rawCells: ['TRAINING-001', 'Training AHU', 'Air Handling Unit', 'Level 1', 'Mechanical Room'],
    equipmentName: 'Training AHU',
    assetTag: 'TRAINING-001',
    isUntagged: false,
    suggestedAssetType: 'Air Handling Unit',
    selectedAssetType: 'Air Handling Unit',
    typeConfidence: 'high',
    typeReason: 'Training fixture — hardcoded type',
    level: 'Level 1',
    areaServed: 'Training Room',
    sourceStatus: '',
    manufacturer: 'Training Mfg',
    model: 'TM-100',
    serialNumber: 'TRAIN-SN-001',
    drawingReference: 'TR-DWG-001',
    specificationSection: '23 00 00',
    notes: 'TRAINING FIXTURE — This is a harmless synthetic asset for training mode only. Not for production.',
    technicalAttributes: technicalAttrs,
    serviceAttributes: [],
    electricalAttributes: [],
    unmappedAttributes: [],
    relationshipCandidates: [],
    profileStatus: { type: 'none' },
    duplicateStatus: { type: 'none' },
    warnings: [],
    errors: [],
    infos: [{ severity: 'info', message: 'Training fixture: this row is synthetic and will be rolled back after import' }],
  }
}

/* ── Preflight validation ── */

export interface PreflightResult {
  totalRows: number
  rowsAdd: number
  rowsUpdate: number
  rowsHold: number
  rowsSkip: number
  rowsConflict: number
  missingAssetTypes: string[]
  duplicateDetailRows: Array<{ assetTag: string; occurrences: number; rows: number[] }>
  placeholderUrls: Array<{ sourceHeader: string; sourceRow: number; value: string }>
  validationErrors: Array<{ sourceRow: number; message: string }>
}

const PLACEHOLDER_PATTERNS = [
  /^url\s*link$/i,
  /^insert\s*url$/i,
  /^tbd$/i,
  /^n\/?a$/i,
  /^--*$/i,
]

export function runPreflight(
  assets: NormalizedAsset[],
  actions: Map<string, ImportAction>,
  existingAssetTags: Set<string>,
): PreflightResult {
  const result: PreflightResult = {
    totalRows: assets.length,
    rowsAdd: 0,
    rowsUpdate: 0,
    rowsHold: 0,
    rowsSkip: 0,
    rowsConflict: 0,
    missingAssetTypes: [],
    duplicateDetailRows: [],
    placeholderUrls: [],
    validationErrors: [],
  }

  const tagOccurrences = new Map<string, number[]>()

  for (const asset of assets) {
    const action = actions.get(asset.id) || 'add'

    switch (action) {
      case 'add': result.rowsAdd++; break
      case 'update': result.rowsUpdate++; break
      case 'existing': result.rowsUpdate++; break
      case 'hold': result.rowsHold++; break
    }

    // Check missing asset type
    const typeName = asset.selectedAssetType || asset.suggestedAssetType
    if (!typeName) {
      if (!result.missingAssetTypes.includes(asset.sourceSection || 'Unknown')) {
        result.missingAssetTypes.push(asset.sourceSection || 'Unknown')
      }
    }

    // Check duplicate detail rows (same assetTag appearing multiple times)
    if (asset.assetTag) {
      const occurrences = tagOccurrences.get(asset.assetTag) || []
      occurrences.push(asset.sourceRow)
      tagOccurrences.set(asset.assetTag, occurrences)
    }

    // Check for placeholder URL text instead of actual URLs
    for (const attr of [...asset.technicalAttributes, ...asset.serviceAttributes, ...asset.electricalAttributes]) {
      if (attr.value && PLACEHOLDER_PATTERNS.some(p => p.test(attr.value.trim()))) {
        result.placeholderUrls.push({
          sourceHeader: attr.sourceHeader,
          sourceRow: asset.sourceRow,
          value: attr.value,
        })
      }
    }

    // Validate required fields
    if (!asset.equipmentName && !asset.assetTag) {
      result.validationErrors.push({
        sourceRow: asset.sourceRow,
        message: 'Missing both equipment name and asset tag',
      })
      result.rowsSkip++
    }

    // Conflict: asset tag exists but action is 'add'
    if (action === 'add' && asset.assetTag && existingAssetTags.has(asset.assetTag)) {
      result.rowsConflict++
    }
  }

  // Build duplicate detail rows report
  for (const [tag, rows] of tagOccurrences) {
    if (rows.length > 1) {
      result.duplicateDetailRows.push({ assetTag: tag, occurrences: rows.length, rows })
    }
  }

  return result
}

/* ── Longest-prefix asset-type matching ── */

export function longestPrefixAssetTypeMatch(
  typeName: string,
  existingTypes: string[],
): string | null {
  const normalized = typeName.trim().toLowerCase()
  let bestMatch: string | null = null
  let bestLength = 0

  for (const existing of existingTypes) {
    const existingNorm = existing.trim().toLowerCase()
    if (normalized === existingNorm) return existing
    if (normalized.startsWith(existingNorm) && existingNorm.length > bestLength) {
      bestMatch = existing
      bestLength = existingNorm.length
    }
  }

  return bestMatch
}
