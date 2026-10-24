import type {
  SourceSection,
  SourceRecord,
  DictionaryEntry,
  SectionIndex,
  DuplicateEntry,
  NormalizedAsset,
  NormalizedAttribute,
  RelationshipCandidate,
  ProfileStatus,
  DuplicateStatus,
  ValidationFinding,
  AnalysisSummary,
  AssetTypeClassification,
  ReferenceComparison,
} from './types'
import { columnLetterToIndex } from './csvParser'

let idCounter = 0
function nextId(): string {
  return `import-${++idCounter}`
}

export function resetIdCounter() {
  idCounter = 0
}

const SECTION_TYPE_MAP: Record<string, string> = {
  'AIR HANDLING UNITS': 'Air Handling Unit',
  'RE-HEAT COILS': 'Re-Heat Coil',
  'HUMIDIFIERS': 'Humidifier',
  'FANS': 'Fan',
  'HEPA FILTERS': 'HEPA Filter',
  'POWERED HEPA AIR TERMINALS': 'Powered HEPA Air Terminal',
  'CHILLERS': 'Chiller',
  'FLUID COOLERS': 'Fluid Cooler',
  'BOILER PLANT': 'Boiler',
  'PUMPS': 'Pump',
  'HEAT EXCHANGERS': 'Heat Exchanger',
  'EXPANSION TANKS': 'Expansion Tank',
  'FAN COIL UNITS': 'Fan Coil Unit',
  'BARE FIN TUBE': 'Bare Fin Tube',
  'RADIANT GAS HEATERS': 'Radiant Gas Heater',
  'FORCE FLOW HEATERS': 'Force Flow Heater',
  'UNIT HEATERS': 'Unit Heater',
  'AIR CURTAINS': 'Air Curtain',
  'DOMESTIC HOT WATER TANKS': 'Domestic Hot Water Tank',
  'VAV/CAV BOXES': 'VAV/CAV Box',
  'MEDICAL GAS EQUIPMENT': 'Medical Gas Equipment',
  'FUEL OIL TANKS': 'Fuel Oil Tank',
  'STORAGE TANKS': 'Storage Tank',
  'RO EQUIPMENT': 'RO Equipment',
  'PRECISION AIR VALVES': 'Precision Air Valve',
  'PNEUMATIC TUBE SYSTEMS': 'Pneumatic Tube System',
  'PLUMBING': 'Plumbing Equipment',
  'SILENCER': 'Silencer',
  'DAMPERS': 'Damper',
  'COMPRESSORS': 'Compressor',
  'ELECTRIC DUCT HEATERS': 'Electric Duct Heater',
  'INSTREAM UV DUCT TREATMENT SECTIONS': 'UV Duct Treatment Section',
}

function classifyRecordType(
  record: SourceRecord,
  sectionName: string
): AssetTypeClassification {
  const tag = record.assetTag.toUpperCase()
  const desc = record.description.toUpperCase()

  if (sectionName.includes('CHANGEOVER COILS') || sectionName.includes('COOLING COILS') || sectionName.includes('HEAT RECOVERY COILS')) {
    if (tag.startsWith('HC-CC-') || desc.includes('CHANGEOVER')) {
      return { sourceSection: sectionName, suggestedType: 'Changeover Coil', selectedType: null, confidence: 'high', reason: 'Tag prefix HC-CC- or description indicates changeover coil' }
    }
    if (tag.startsWith('CC-') || desc.includes('COOLING COIL')) {
      return { sourceSection: sectionName, suggestedType: 'Cooling Coil', selectedType: null, confidence: 'high', reason: 'Tag prefix CC- or description indicates cooling coil' }
    }
    if (tag.startsWith('HRC-') || desc.includes('HEAT RECOVERY')) {
      return { sourceSection: sectionName, suggestedType: 'Heat Recovery Coil', selectedType: null, confidence: 'high', reason: 'Tag prefix HRC- or description indicates heat recovery coil' }
    }
    return { sourceSection: sectionName, suggestedType: null, selectedType: null, confidence: 'low', reason: 'Could not determine coil type from tag or description' }
  }

  if (sectionName.includes('CHANGEOVER COILS (HEATING PERFORMANCE)')) {
    if (tag.startsWith('HC-CC-')) {
      return { sourceSection: sectionName, suggestedType: 'Changeover Coil', selectedType: null, confidence: 'high', reason: 'HC-CC- tag in heating performance section' }
    }
  }

  const mapped = SECTION_TYPE_MAP[sectionName]
  if (mapped) {
    return { sourceSection: sectionName, suggestedType: mapped, selectedType: null, confidence: 'high', reason: `Section "${sectionName}" maps to type "${mapped}"` }
  }

  return { sourceSection: sectionName, suggestedType: null, selectedType: null, confidence: 'unresolved', reason: `No type mapping for section "${sectionName}"` }
}

const BARE_UNIT_TOKENS = new Set([
  '°C', '°F', 'L/S', 'L/s', 'M/S', 'm/s', 'PA', 'Pa', 'KPA', 'kPa',
  'MM', 'IN', 'KW', 'kW', 'KG', 'KG/HR', 'L', 'L/MIN', 'FT', 'M2',
  'W/m', 'L/HR', 'Liter', 'RADIATED', 'LMIN', 'EFF%',
])

function isBareUnitHeader(header: string): boolean {
  const trimmed = header.trim()
  if (BARE_UNIT_TOKENS.has(trimmed)) return true
  if (/^[A-Z°/%]{1,6}$/i.test(trimmed) && !/[a-z]{3,}/i.test(trimmed)) return true
  if (trimmed === 'WET BULB / °F' || trimmed === 'WET BULB / °C') return true
  return false
}

function extractParentContext(header: string): string {
  const lastSep = header.lastIndexOf(' / ')
  if (lastSep > 0) {
    return header.substring(0, lastSep).trim()
  }
  return header
}

function buildContextualizedLabels(
  attrEntries: { entry: DictionaryEntry; colIdx: number }[]
): Map<number, string> {
  const sorted = [...attrEntries].sort((a, b) => a.colIdx - b.colIdx)
  const labels = new Map<number, string>()
  let lastDescriptiveHeader = ''

  for (const { entry, colIdx } of sorted) {
    const header = entry.sourceHeader.trim()

    if (isBareUnitHeader(header)) {
      if (lastDescriptiveHeader) {
        const parentContext = extractParentContext(lastDescriptiveHeader)
        labels.set(colIdx, `${parentContext} ${header}`)
      } else {
        labels.set(colIdx, `COL_${entry.column} ${header}`)
      }
    } else {
      lastDescriptiveHeader = header
      labels.set(colIdx, header)
    }
  }

  // Pass 2: detect duplicate normalized keys and disambiguate with block context
  const normalizeKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  const keyToColIndices = new Map<string, number[]>()
  for (const [colIdx, label] of labels) {
    const key = normalizeKey(label)
    const arr = keyToColIndices.get(key) || []
    arr.push(colIdx)
    keyToColIndices.set(key, arr)
  }

  const BLOCK_MARKERS = /\b(EVAPORATOR|CONDENSER|PRIMARY|SECONDARY|SUCTION|DISCHARGE)\b/i

  for (const [, colIndices] of keyToColIndices) {
    if (colIndices.length <= 1) continue
    for (const colIdx of colIndices) {
      const currentLabel = labels.get(colIdx)!
      let blockContext = ''
      for (const { entry, colIdx: ci } of sorted) {
        if (ci >= colIdx) break
        const h = entry.sourceHeader.trim()
        if (BLOCK_MARKERS.test(h)) {
          blockContext = h.split('/')[0].trim()
        } else if (entry.suggestedAppSection === 'service' && h.includes('/')) {
          blockContext = h.split('/')[0].trim()
        }
      }
      if (blockContext && normalizeKey(blockContext) !== normalizeKey(currentLabel)) {
        labels.set(colIdx, `${blockContext} ${currentLabel}`)
      } else {
        const colEntry = sorted.find(s => s.colIdx === colIdx)
        if (colEntry) {
          labels.set(colIdx, `${currentLabel} (${colEntry.entry.column})`)
        }
      }
    }
  }

  return labels
}

function extractAttributes(
  record: SourceRecord,
  sectionDict: DictionaryEntry[],
  columnHeaders: string[]
): { technical: NormalizedAttribute[]; service: NormalizedAttribute[]; electrical: NormalizedAttribute[]; unmapped: NormalizedAttribute[]; relationships: RelationshipCandidate[] } {
  const technical: NormalizedAttribute[] = []
  const service: NormalizedAttribute[] = []
  const electrical: NormalizedAttribute[] = []
  const unmapped: NormalizedAttribute[] = []
  const relationships: RelationshipCandidate[] = []

  const mappedCols = new Set<number>()

  const attrEntries: { entry: DictionaryEntry; colIdx: number }[] = []
  for (const entry of sectionDict) {
    if (entry.sourceRole !== 'attribute') continue
    attrEntries.push({ entry, colIdx: columnLetterToIndex(entry.column) })
  }

  const contextualLabels = buildContextualizedLabels(attrEntries)

  for (const { entry, colIdx } of attrEntries) {
    mappedCols.add(colIdx)
    const rawValue = colIdx < record.rawCells.length ? record.rawCells[colIdx] : ''
    if (!rawValue || rawValue === 'N/A' || rawValue === '--' || rawValue === '324') continue

    const normalizedLabel = contextualLabels.get(colIdx) || entry.sourceHeader

    const attr: NormalizedAttribute = {
      sourceHeader: entry.sourceHeader,
      sourceColumn: colIdx,
      suggestedSection: entry.suggestedAppSection,
      normalizedLabel,
      value: rawValue,
    }

    if (entry.suggestedAppSection === 'relationship_candidate') {
      relationships.push({
        sourceHeader: entry.sourceHeader,
        sourceValue: rawValue,
        possibleReferencedAsset: null,
        confidence: 'ambiguous',
        status: 'Pending analysis',
      })
    } else if (entry.suggestedAppSection === 'service') {
      service.push(attr)
    } else if (entry.suggestedAppSection === 'electrical_controls') {
      electrical.push(attr)
    } else {
      technical.push(attr)
    }
  }

  const commonCols = new Set<number>()
  for (const entry of sectionDict) {
    if (entry.sourceRole !== 'attribute') {
      commonCols.add(columnLetterToIndex(entry.column))
    }
  }

  for (let colIdx = 0; colIdx < record.rawCells.length; colIdx++) {
    if (mappedCols.has(colIdx) || commonCols.has(colIdx)) continue
    const rawValue = record.rawCells[colIdx]
    if (!rawValue || rawValue === 'N/A' || rawValue === '--' || rawValue === '324') continue
    const header = colIdx < columnHeaders.length ? columnHeaders[colIdx] : ''
    if (!header) continue
    unmapped.push({
      sourceHeader: header,
      sourceColumn: colIdx,
      suggestedSection: 'unmapped',
      normalizedLabel: header,
      value: rawValue,
    })
  }

  return { technical, service, electrical, unmapped, relationships }
}

function resolveRelationships(
  candidates: RelationshipCandidate[],
  allTags: Set<string>
): RelationshipCandidate[] {
  return candidates.map(c => {
    const val = c.sourceValue.trim()
    if (!val || val === 'N/A' || val === '--' || val === 'YES' || val === 'NO') {
      return { ...c, confidence: 'not_a_relationship' as const, status: 'Value is not an equipment reference' }
    }
    if (allTags.has(val)) {
      return { ...c, possibleReferencedAsset: val, confidence: 'confident' as const, status: 'Found matching asset tag' }
    }
    if (/^[A-Z]{1,4}-/.test(val)) {
      return { ...c, confidence: 'not_found' as const, status: 'Looks like an asset tag but not found in this import' }
    }
    return { ...c, confidence: 'not_a_relationship' as const, status: 'Value does not appear to reference equipment' }
  })
}

/* ── Independent duplicate & profile-pair discovery ── */

interface TagOccurrence {
  tag: string
  rows: number[]
  sections: string[]
  descriptions: string[]
}

function discoverDuplicatesAndProfilePairs(
  sections: SourceSection[]
): { tagOccurrences: Map<string, TagOccurrence>; profilePairTags: Set<string> } {
  const tagOccurrences = new Map<string, TagOccurrence>()

  for (const section of sections) {
    for (const r of section.records) {
      if (!r.assetTag) continue
      const existing = tagOccurrences.get(r.assetTag) || { tag: r.assetTag, rows: [], sections: [], descriptions: [] }
      existing.rows.push(r.sourceRow)
      existing.sections.push(section.name)
      existing.descriptions.push(r.description)
      tagOccurrences.set(r.assetTag, existing)
    }
  }

  const coolingNames = sections
    .filter(s => s.name.includes('COOLING PERFORMANCE') || s.name.includes('COOLING COILS'))
    .map(s => s.name)
  const heatingNames = sections
    .filter(s => s.name.includes('HEATING PERFORMANCE'))
    .map(s => s.name)

  const profilePairTags = new Set<string>()

  for (const [tag, occ] of tagOccurrences) {
    if (occ.rows.length < 2) continue
    const inCooling = occ.sections.some(s => coolingNames.includes(s))
    const inHeating = occ.sections.some(s => heatingNames.includes(s))
    if (inCooling && inHeating) {
      profilePairTags.add(tag)
    }
  }

  return { tagOccurrences, profilePairTags }
}

function classifyDuplicate(
  tag: string,
  occ: TagOccurrence,
  profilePairTags: Set<string>
): DuplicateStatus {
  if (occ.rows.length <= 1) return { type: 'none' }

  if (profilePairTags.has(tag)) {
    return { type: 'profile_pair', groupTag: tag }
  }

  const uniqueSections = new Set(occ.sections)
  const allSameSection = uniqueSections.size === 1
  const allSameDesc = new Set(occ.descriptions).size === 1

  if (allSameSection && allSameDesc) {
    return { type: 'repeated_designation', groupTag: tag, occurrences: occ.rows.length }
  }

  if (uniqueSections.size > 1) {
    return { type: 'ambiguous', groupTag: tag, occurrences: occ.rows.length }
  }

  return { type: 'exact_duplicate', groupTag: tag, occurrences: occ.rows.length }
}

/* ── Reference comparison ── */

function buildReferenceComparisons(
  sections: SourceSection[],
  assets: NormalizedAsset[],
  profilePairTags: Set<string>,
  refSections: SectionIndex[] | null,
  refDuplicates: DuplicateEntry[] | null
): ReferenceComparison[] {
  const comparisons: ReferenceComparison[] = []

  const refSectionCount = refSections?.length ?? null
  comparisons.push({
    metric: 'Source Sections',
    detected: sections.length,
    expected: refSectionCount,
    status: refSectionCount === null ? 'no_reference' : sections.length === refSectionCount ? 'matched' : Math.abs(sections.length - refSectionCount) <= 2 ? 'close' : 'different',
  })

  const refRecordCount = refSections ? refSections.reduce((s, si) => s + si.recordCount, 0) : null
  comparisons.push({
    metric: 'Asset Records',
    detected: assets.length,
    expected: refRecordCount,
    status: refRecordCount === null ? 'no_reference' : assets.length === refRecordCount ? 'matched' : Math.abs(assets.length - refRecordCount) <= 10 ? 'close' : 'different',
  })

  const untaggedCount = assets.filter(a => a.isUntagged).length
  comparisons.push({
    metric: 'Untagged Assets',
    detected: untaggedCount,
    expected: 8,
    status: untaggedCount === 8 ? 'matched' : Math.abs(untaggedCount - 8) <= 2 ? 'close' : 'different',
  })

  const refProfilePairs = refDuplicates
    ? new Set(refDuplicates.filter(d => d.likelyProfilePair).map(d => d.assetTag)).size
    : null
  comparisons.push({
    metric: 'HC-CC Profile Pairs',
    detected: profilePairTags.size,
    expected: refProfilePairs,
    status: refProfilePairs === null ? 'no_reference' : profilePairTags.size === refProfilePairs ? 'matched' : Math.abs(profilePairTags.size - refProfilePairs) <= 2 ? 'close' : 'different',
  })

  return comparisons
}

/* ── Main analysis ── */

export function analyzeImport(
  sections: SourceSection[],
  dictionary: DictionaryEntry[],
  filename: string,
  refSections?: SectionIndex[] | null,
  refDuplicates?: DuplicateEntry[] | null
): { assets: NormalizedAsset[]; summary: AnalysisSummary } {
  resetIdCounter()

  const dictBySection = new Map<string, DictionaryEntry[]>()
  for (const d of dictionary) {
    const arr = dictBySection.get(d.section) || []
    arr.push(d)
    dictBySection.set(d.section, arr)
  }

  const { tagOccurrences, profilePairTags } = discoverDuplicatesAndProfilePairs(sections)

  const allTags = new Set<string>()
  for (const section of sections) {
    for (const r of section.records) {
      if (r.assetTag) allTags.add(r.assetTag)
    }
  }

  const coolingSection = sections.find(s => s.name.includes('COOLING PERFORMANCE') || s.name.includes('COOLING COILS'))
  const heatingSection = sections.find(s => s.name.includes('HEATING PERFORMANCE'))
  const coolingTags = new Set<string>()
  const heatingTags = new Set<string>()
  if (coolingSection) coolingSection.records.forEach(r => { if (r.assetTag) coolingTags.add(r.assetTag) })
  if (heatingSection) heatingSection.records.forEach(r => { if (r.assetTag) heatingTags.add(r.assetTag) })

  const assets: NormalizedAsset[] = []
  const requiredDefinitions: Record<string, { technical: string[]; service: string[]; electrical: string[] }> = {}

  for (const section of sections) {
    const sectionDict = dictBySection.get(section.name) || []
    const isHeatingSection = section.name.includes('HEATING PERFORMANCE')

    const techHeaders = sectionDict.filter(d => d.sourceRole === 'attribute' && d.suggestedAppSection === 'technical').map(d => d.sourceHeader)
    const svcHeaders = sectionDict.filter(d => d.sourceRole === 'attribute' && d.suggestedAppSection === 'service').map(d => d.sourceHeader)
    const elecHeaders = sectionDict.filter(d => d.sourceRole === 'attribute' && d.suggestedAppSection === 'electrical_controls').map(d => d.sourceHeader)

    const typeClass = classifyRecordType(
      section.records[0] || { assetTag: '', description: '', sourceRow: 0, sourceSection: section.name, rawCells: [], level: '', areaServed: '', sourceStatus: '', isUntagged: true, flaggedRows: [] },
      section.name
    )
    const typeName = typeClass.suggestedType || section.name
    if (!requiredDefinitions[typeName]) {
      requiredDefinitions[typeName] = { technical: [], service: [], electrical: [] }
    }
    const rd = requiredDefinitions[typeName]
    for (const h of techHeaders) { if (!rd.technical.includes(h)) rd.technical.push(h) }
    for (const h of svcHeaders) { if (!rd.service.includes(h)) rd.service.push(h) }
    for (const h of elecHeaders) { if (!rd.electrical.includes(h)) rd.electrical.push(h) }

    for (const record of section.records) {
      const classification = classifyRecordType(record, section.name)
      const { technical, service, electrical, unmapped, relationships } = extractAttributes(record, sectionDict, section.columnHeaders)
      const resolvedRelationships = resolveRelationships(relationships, allTags)

      let profileStatus: ProfileStatus = { type: 'none' }
      if (record.assetTag && profilePairTags.has(record.assetTag)) {
        if (isHeatingSection) {
          const coolingRecord = coolingSection?.records.find(r => r.assetTag === record.assetTag)
          profileStatus = {
            type: 'proposed_merge',
            profileName: 'Heating Performance',
            pairedRow: coolingRecord?.sourceRow || 0,
            pairedSection: coolingSection?.name || '',
          }
        } else if (coolingTags.has(record.assetTag) && heatingTags.has(record.assetTag)) {
          profileStatus = {
            type: 'proposed_merge',
            profileName: 'Cooling Performance',
            pairedRow: heatingSection?.records.find(r => r.assetTag === record.assetTag)?.sourceRow || 0,
            pairedSection: heatingSection?.name || '',
          }
        }
      }

      const occ = record.assetTag ? tagOccurrences.get(record.assetTag) : undefined
      const duplicateStatus: DuplicateStatus = occ
        ? classifyDuplicate(record.assetTag, occ, profilePairTags)
        : { type: 'none' }

      const warnings: ValidationFinding[] = []
      const errors: ValidationFinding[] = []
      const infos: ValidationFinding[] = []

      const equipmentName = record.description || record.assetTag || ''
      if (!equipmentName) {
        errors.push({ severity: 'error', message: 'Cannot determine Equipment Name', field: 'equipment_name' })
      }
      if (classification.confidence === 'unresolved') {
        warnings.push({ severity: 'warning', message: 'Asset Type unresolved', field: 'asset_type' })
      }
      if (record.isUntagged) {
        infos.push({ severity: 'info', message: 'No Asset Tag — will be imported without a tag', field: 'asset_tag' })
      }
      if (profileStatus.type === 'proposed_merge') {
        infos.push({ severity: 'info', message: `Profile pair proposed: ${profileStatus.profileName}`, field: 'profile' })
      }
      if (duplicateStatus.type === 'ambiguous') {
        warnings.push({ severity: 'warning', message: `Ambiguous duplicate: tag "${record.assetTag}" appears ${duplicateStatus.occurrences} times`, field: 'duplicate' })
      }
      if (duplicateStatus.type === 'repeated_designation') {
        warnings.push({ severity: 'warning', message: `Repeated/generic designation: "${record.assetTag}" appears ${duplicateStatus.occurrences} times — these may be separate physical assets`, field: 'duplicate' })
      }
      if (unmapped.length > 0) {
        infos.push({ severity: 'info', message: `${unmapped.length} unmapped source attribute(s) preserved for review`, field: 'unmapped' })
      }

      for (const rel of resolvedRelationships) {
        if (rel.confidence === 'not_found') {
          warnings.push({ severity: 'warning', message: `Relationship candidate "${rel.sourceHeader}" references "${rel.sourceValue}" which was not found`, field: 'relationship' })
        }
      }

      for (const flag of record.flaggedRows) {
        if (flag.confidence === 'low') {
          warnings.push({ severity: 'warning', message: flag.reason, field: 'row_quality' })
        } else {
          infos.push({ severity: 'info', message: flag.reason, field: 'row_quality' })
        }
      }

      assets.push({
        id: nextId(),
        sourceRow: record.sourceRow,
        sourceSection: section.name,
        rawCells: record.rawCells,
        equipmentName,
        assetTag: record.assetTag,
        isUntagged: record.isUntagged,
        suggestedAssetType: classification.suggestedType,
        selectedAssetType: classification.selectedType,
        typeConfidence: classification.confidence,
        typeReason: classification.reason,
        level: record.level,
        areaServed: record.areaServed,
        sourceStatus: record.sourceStatus,
        manufacturer: '',
        model: '',
        serialNumber: '',
        drawingReference: '',
        specificationSection: '',
        notes: '',
        technicalAttributes: technical,
        serviceAttributes: service,
        electricalAttributes: electrical,
        unmappedAttributes: unmapped,
        relationshipCandidates: resolvedRelationships,
        profileStatus,
        duplicateStatus,
        warnings,
        errors,
        infos,
      })
    }
  }

  const referenceComparisons = buildReferenceComparisons(
    sections, assets, profilePairTags,
    refSections ?? null, refDuplicates ?? null
  )

  const untaggedCount = assets.filter(a => a.isUntagged).length
  const dupGroups = new Set(
    assets.filter(a => a.duplicateStatus.type !== 'none' && a.duplicateStatus.type !== 'profile_pair')
      .map(a => 'groupTag' in a.duplicateStatus ? a.duplicateStatus.groupTag : '')
  ).size
  const profileGroups = profilePairTags.size
  const unclassified = assets.filter(a => a.typeConfidence === 'unresolved').length
  const warningCount = assets.reduce((s, a) => s + a.warnings.length, 0)
  const errorCount = assets.reduce((s, a) => s + a.errors.length, 0)
  const infoCount = assets.reduce((s, a) => s + a.infos.length, 0)

  const summary: AnalysisSummary = {
    sourceFile: filename,
    totalRows: sections.reduce((s, sec) => Math.max(s, sec.rowEnd), 0),
    sectionsDetected: sections.length,
    recordsDetected: assets.length,
    untaggedAssets: untaggedCount,
    duplicateTagGroups: dupGroups,
    profilePairGroups: profileGroups,
    unclassifiedEquipment: unclassified,
    warningCount,
    errorCount,
    infoCount,
    sections: sections.map(s => ({ name: s.name, recordCount: s.records.length })),
    requiredDefinitions,
    referenceComparisons,
  }

  return { assets, summary }
}
