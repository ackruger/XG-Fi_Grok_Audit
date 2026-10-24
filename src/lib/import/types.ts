export interface SourceSection {
  name: string
  rowStart: number
  rowEnd: number
  dataStart: number
  headerRows: string[][]
  columnHeaders: string[]
  records: SourceRecord[]
}

export interface SourceRecord {
  sourceRow: number
  sourceSection: string
  rawCells: string[]
  assetTag: string
  description: string
  level: string
  areaServed: string
  sourceStatus: string
  isUntagged: boolean
  flaggedRows: FlaggedRow[]
}

export interface FlaggedRow {
  reason: string
  confidence: 'low' | 'medium' | 'high'
}

export interface ColumnMapping {
  columnIndex: number
  sourceHeader: string
  suggestedAppSection: 'common' | 'technical' | 'service' | 'electrical_controls' | 'relationship_candidate'
  sourceRole: 'asset_tag' | 'description' | 'level' | 'area_served' | 'source_status' | 'attribute'
  normalizedLabel: string
  unit?: string
}

export interface DictionaryEntry {
  section: string
  rowStart: number
  rowEnd: number
  dataStart: number
  recordCount: number
  column: string
  sourceHeader: string
  suggestedAppSection: string
  sourceRole: string
}

export interface SectionIndex {
  section: string
  rowStart: number
  rowEnd: number
  dataStart: number
  recordCount: number
  firstRecord: string
  lastRecord: string
}

export interface DuplicateEntry {
  assetTag: string
  occurrenceCount: number
  row: number
  section: string
  likelyProfilePair: boolean
}

export type AssetTypeClassification = {
  sourceSection: string
  suggestedType: string | null
  selectedType: string | null
  confidence: 'high' | 'medium' | 'low' | 'unresolved'
  reason: string
}

export type ClassificationRule = {
  pattern: string
  assetType: string
  field: 'asset_tag' | 'description' | 'source_section'
}

export interface NormalizedAsset {
  id: string
  sourceRow: number
  sourceSection: string
  rawCells: string[]
  equipmentName: string
  assetTag: string
  isUntagged: boolean
  suggestedAssetType: string | null
  selectedAssetType: string | null
  typeConfidence: 'high' | 'medium' | 'low' | 'unresolved'
  typeReason: string
  level: string
  areaServed: string
  sourceStatus: string
  manufacturer: string
  model: string
  serialNumber: string
  drawingReference: string
  specificationSection: string
  notes: string
  technicalAttributes: NormalizedAttribute[]
  serviceAttributes: NormalizedAttribute[]
  electricalAttributes: NormalizedAttribute[]
  unmappedAttributes: NormalizedAttribute[]
  relationshipCandidates: RelationshipCandidate[]
  profileStatus: ProfileStatus
  duplicateStatus: DuplicateStatus
  warnings: ValidationFinding[]
  errors: ValidationFinding[]
  infos: ValidationFinding[]
}

export interface NormalizedAttribute {
  sourceHeader: string
  sourceColumn: number
  suggestedSection: string
  normalizedLabel: string
  value: string
  unit?: string
}

export interface RelationshipCandidate {
  sourceHeader: string
  sourceValue: string
  possibleReferencedAsset: string | null
  confidence: 'confident' | 'ambiguous' | 'not_found' | 'not_a_relationship'
  status: string
}

export type ProfileStatus =
  | { type: 'none' }
  | { type: 'proposed_merge'; profileName: string; pairedRow: number; pairedSection: string }
  | { type: 'single' }

export type DuplicateStatus =
  | { type: 'none' }
  | { type: 'exact_duplicate'; groupTag: string; occurrences: number }
  | { type: 'profile_pair'; groupTag: string }
  | { type: 'repeated_designation'; groupTag: string; occurrences: number }
  | { type: 'ambiguous'; groupTag: string; occurrences: number }

export type ValidationSeverity = 'error' | 'warning' | 'info'

export interface ValidationFinding {
  severity: ValidationSeverity
  message: string
  field?: string
}

export type ImportFilter =
  | 'all'
  | 'ready'
  | 'needs_review'
  | 'untagged'
  | 'duplicates'
  | 'profile_pairs'
  | 'unclassified'
  | 'errors'
  | 'documents'
  | 'deferred'

export interface ReferenceComparison {
  metric: string
  detected: number
  expected: number | null
  status: 'matched' | 'close' | 'different' | 'no_reference'
}

export interface AnalysisSummary {
  sourceFile: string
  totalRows: number
  sectionsDetected: number
  recordsDetected: number
  untaggedAssets: number
  duplicateTagGroups: number
  profilePairGroups: number
  unclassifiedEquipment: number
  warningCount: number
  errorCount: number
  infoCount: number
  sections: { name: string; recordCount: number }[]
  requiredDefinitions: Record<string, { technical: string[]; service: string[]; electrical: string[] }>
  referenceComparisons: ReferenceComparison[]
}

/* ── XLSX / Workbook types ── */

export type SheetType = 'reference' | 'asset' | 'detail' | 'document' | 'activity' | 'form' | 'unknown'

export interface ParsedSheet {
  name: string
  sheetType: SheetType
  headers: string[]
  rows: string[][]
  sourceSheetIndex: number
}

export interface ParsedWorkbook {
  sheets: ParsedSheet[]
  referenceSheets: ParsedSheet[]
  assetSheet: ParsedSheet | null
  detailSheet: ParsedSheet | null
  documentSheets: ParsedSheet[]
  activitySheets: ParsedSheet[]
  formSheets: ParsedSheet[]
  unknownSheets: ParsedSheet[]
}

export type ImportAction = 'add' | 'update' | 'existing' | 'hold'

export interface WorkbookDocument {
  id: string
  key: string
  name: string
  category: string
  documentType: string | null
  discipline: string | null
  revision: string | null
  externalUrl: string | null
  sourceSheet: string
  sourceRow: number
  linkedAssetTags: string[]
  isFacilityLevel: boolean
  isDuplicate: boolean
  duplicateOfKey: string | null
}

export interface DeferredItem {
  name: string
  sourceSheet: string
  sourceRow: number
  reason: string
  category: string
}

export interface WorkbookImportSummary {
  assetsToAdd: number
  assetsToUpdate: number
  assetsExisting: number
  assetsHeld: number
  documentsTotal: number
  documentsUnique: number
  documentsDuplicated: number
  facilityLevelDocuments: number
  assetLinkedDocuments: number
  documentAssetLinks: number
  deferredItems: number
  warnings: string[]
  errors: string[]
}

export interface WorkbookImportPreview {
  assets: NormalizedAsset[]
  documents: WorkbookDocument[]
  deferred: DeferredItem[]
  summary: WorkbookImportSummary
  importActions: Map<string, ImportAction>
}
