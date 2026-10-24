import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Upload, BarChart3, Tag, Table, CheckCircle, AlertTriangle, Info, X, FileText,
  Search, ArrowLeft, ArrowRight, Shield, Play, RotateCcw, ExternalLink, Loader2,
  ClipboardCheck, Package, ListChecks, FolderPlus,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useFacility } from '../context/FacilityContext'
import { useAuth } from '../context/AuthContext'
import {
  parseMultiSectionCSV,
  parseSectionsCSV,
  parseDictionaryCSV,
  parseDuplicatesCSV,
  analyzeImport,
  classifyImportDecision,
  computeFingerprint,
  computeFingerprintFromBuffer,
  checkDuplicateImport,
  executeImport,
  executeWorkbookImport,
  rollbackImportBatch,
  selectTestBatch,
  parseXLSXFile,
  createTrainingFixture,
  runPreflight,
  longestPrefixAssetTypeMatch,
} from '../lib/import'
import { normalizeWorkbook } from '../lib/import/workbookNormalizer'
import type {
  SectionIndex,
  DictionaryEntry,
  DuplicateEntry,
  NormalizedAsset,
  AnalysisSummary,
  ImportFilter,
  NormalizedAttribute,
  WorkbookImportPreview,
} from '../lib/import/types'
import type { ImportDecision, ImportProgress, ImportResult } from '../lib/import/engine'
import type { PreflightResult } from '../lib/import/training'

const STEPS = [
  { label: 'Upload', icon: Upload },
  { label: 'Analyze', icon: BarChart3 },
  { label: 'Classification', icon: Tag },
  { label: 'Preview', icon: Table },
  { label: 'Validation', icon: CheckCircle },
  { label: 'Import Review', icon: ClipboardCheck },
  { label: 'Import', icon: Package },
  { label: 'Results', icon: ListChecks },
]

const FILTER_TABS: { key: ImportFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'ready', label: 'Ready' },
  { key: 'needs_review', label: 'Needs Review' },
  { key: 'untagged', label: 'Untagged' },
  { key: 'duplicates', label: 'Duplicates' },
  { key: 'profile_pairs', label: 'Profile Pairs' },
  { key: 'unclassified', label: 'Unclassified' },
  { key: 'errors', label: 'Errors' },
]

function filterAssets(assets: NormalizedAsset[], filter: ImportFilter): NormalizedAsset[] {
  switch (filter) {
    case 'all': return assets
    case 'ready': return assets.filter(a => a.errors.length === 0 && a.typeConfidence !== 'unresolved')
    case 'needs_review': return assets.filter(a => a.warnings.length > 0)
    case 'untagged': return assets.filter(a => a.isUntagged)
    case 'duplicates': return assets.filter(a => a.duplicateStatus.type !== 'none' && a.duplicateStatus.type !== 'profile_pair')
    case 'profile_pairs': return assets.filter(a => a.duplicateStatus.type === 'profile_pair' || a.profileStatus.type === 'proposed_merge')
    case 'unclassified': return assets.filter(a => a.typeConfidence === 'unresolved')
    case 'errors': return assets.filter(a => a.errors.length > 0)
    default: return assets
  }
}

function confidenceBadge(c: string) {
  const map: Record<string, string> = {
    high: 'bg-emerald-50 text-emerald-700', medium: 'bg-amber-50 text-amber-600',
    low: 'bg-red-50 text-red-700', unresolved: 'bg-neutral-100 text-neutral-600',
    matched: 'bg-emerald-50 text-emerald-700', close: 'bg-amber-50 text-amber-600',
    different: 'bg-red-50 text-red-700', no_reference: 'bg-neutral-100 text-neutral-500',
  }
  return <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${map[c] || map.unresolved}`}>{c}</span>
}

function statusIcon(a: NormalizedAsset) {
  if (a.errors.length > 0) return <AlertTriangle size={16} className="text-red-500" />
  if (a.warnings.length > 0) return <AlertTriangle size={16} className="text-amber-500" />
  if (a.typeConfidence === 'unresolved') return <Info size={16} className="text-neutral-400" />
  return <CheckCircle size={16} className="text-emerald-500" />
}

function decisionBadge(d: ImportDecision) {
  if (d === 'ready') return <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">Import</span>
  if (d === 'review') return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium">Review</span>
  if (d === 'profile_merge') return <span className="text-xs px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 font-medium">Profile Merge</span>
  return <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-medium">Exclude</span>
}

function resultBadge(r: string) {
  const map: Record<string, string> = {
    created: 'bg-emerald-50 text-emerald-700',
    merged_profile: 'bg-sky-50 text-sky-700',
    skipped: 'bg-neutral-100 text-neutral-600',
    review: 'bg-amber-50 text-amber-600',
    failed: 'bg-red-50 text-red-700',
    updated: 'bg-sky-50 text-sky-700',
    linked: 'bg-violet-50 text-violet-700',
  }
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[r] || map.skipped}`}>{r.replace('_', ' ')}</span>
}

/* ── Detail Panel ── */
function DetailPanel({ asset, onClose }: { asset: NormalizedAsset; onClose: () => void }) {
  const AttrTable = ({ title, attrs }: { title: string; attrs: NormalizedAttribute[] }) =>
    attrs.length > 0 ? (<div className="mb-4">
      <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">{title}</h4>
      <table className="w-full text-sm"><thead><tr className="text-left text-xs text-neutral-400 border-b border-neutral-100">
        <th className="pb-1 pr-2">Label</th><th className="pb-1 pr-2">Value</th><th className="pb-1">Unit</th>
      </tr></thead><tbody>{attrs.map((a, i) => (<tr key={i} className="border-b border-neutral-50">
        <td className="py-1 pr-2 text-neutral-600">{a.normalizedLabel || a.sourceHeader}</td>
        <td className="py-1 pr-2 text-neutral-900">{a.value || '—'}</td><td className="py-1 text-neutral-400">{a.unit || ''}</td>
      </tr>))}</tbody></table>
    </div>) : null

  const findings = [...asset.errors, ...asset.warnings, ...asset.infos]
  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-white border-l border-neutral-200 shadow-xl z-50 overflow-y-auto">
      <div className="sticky top-0 bg-white border-b border-neutral-200 px-5 py-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-neutral-900 truncate">{asset.equipmentName || asset.assetTag || `Row ${asset.sourceRow}`}</h3>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-neutral-100"><X size={18} /></button>
      </div>
      <div className="p-5 space-y-4">
        <div>
          <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Source Data</h4>
          <div className="bg-neutral-50 rounded-xl p-3 text-xs text-neutral-600 font-mono break-all max-h-32 overflow-y-auto">Row {asset.sourceRow} &middot; {asset.sourceSection}</div>
        </div>
        <div>
          <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Common Fields</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {([['Asset Tag', asset.assetTag], ['Equipment Name', asset.equipmentName], ['Suggested Type', asset.suggestedAssetType],
              ['Selected Type', asset.selectedAssetType], ['Level', asset.level], ['Area Served', asset.areaServed],
              ['Source Status', asset.sourceStatus], ['Manufacturer', asset.manufacturer], ['Model', asset.model],
              ['Serial Number', asset.serialNumber], ['Drawing Ref', asset.drawingReference],
            ] as [string, string | null][]).map(([label, val]) => (<div key={label}>
              <span className="text-neutral-400 text-xs">{label}</span>
              <p className="text-neutral-800 truncate">{val || '—'}</p>
            </div>))}
          </div>
        </div>
        <AttrTable title="Technical Attributes" attrs={asset.technicalAttributes} />
        <AttrTable title="Service Attributes" attrs={asset.serviceAttributes} />
        <AttrTable title="Electrical Attributes" attrs={asset.electricalAttributes} />
        <AttrTable title="Unmapped Source Attributes" attrs={asset.unmappedAttributes} />
        {asset.relationshipCandidates.length > 0 && (<div>
          <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Relationship Candidates</h4>
          <table className="w-full text-sm"><thead><tr className="text-left text-xs text-neutral-400 border-b border-neutral-100">
            <th className="pb-1 pr-2">Header</th><th className="pb-1 pr-2">Value</th><th className="pb-1 pr-2">Ref Asset</th><th className="pb-1">Confidence</th>
          </tr></thead><tbody>{asset.relationshipCandidates.map((r, i) => (<tr key={i} className="border-b border-neutral-50">
            <td className="py-1 pr-2 text-neutral-600">{r.sourceHeader}</td><td className="py-1 pr-2 text-neutral-900">{r.sourceValue}</td>
            <td className="py-1 pr-2 text-neutral-600">{r.possibleReferencedAsset || '—'}</td><td className="py-1">{confidenceBadge(r.confidence)}</td>
          </tr>))}</tbody></table>
        </div>)}
        {asset.profileStatus.type !== 'none' && (<div>
          <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Design Profile</h4>
          <p className="text-sm text-neutral-700">{asset.profileStatus.type === 'proposed_merge'
            ? `Proposed merge: ${asset.profileStatus.profileName} (paired with row ${asset.profileStatus.pairedRow})` : 'Single profile'}</p>
        </div>)}
        {findings.length > 0 && (<div>
          <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Findings</h4>
          <div className="space-y-1">{findings.map((f, i) => (
            <div key={i} className={`flex items-start gap-2 text-sm px-3 py-2 rounded-lg ${
              f.severity === 'error' ? 'bg-red-50 text-red-700' : f.severity === 'warning' ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700'}`}>
              {f.severity === 'error' || f.severity === 'warning' ? <AlertTriangle size={14} className="mt-0.5 shrink-0" /> : <Info size={14} className="mt-0.5 shrink-0" />}
              <span>{f.message}{f.field ? ` (${f.field})` : ''}</span>
            </div>))}
          </div>
        </div>)}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════ */
export default function AssetImportPage() {
  const { profile } = useAuth()
  const { currentFacility, currentOrganization, createFacility, refreshAll } = useFacility()
  const [userRole, setUserRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [step, setStep] = useState(1)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvText, setCsvText] = useState<string | null>(null)
  const [xlsxBuffer, setXlsxBuffer] = useState<ArrayBuffer | null>(null)
  const [workbookPreview, setWorkbookPreview] = useState<WorkbookImportPreview | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const [dictionary, setDictionary] = useState<DictionaryEntry[]>([])
  const [refSections, setRefSections] = useState<SectionIndex[] | null>(null)
  const [refDuplicates, setRefDuplicates] = useState<DuplicateEntry[] | null>(null)

  const [analyzedAssets, setAnalyzedAssets] = useState<NormalizedAsset[]>([])
  const [analysisSummary, setAnalysisSummary] = useState<AnalysisSummary | null>(null)
  const [typeOverrides, setTypeOverrides] = useState<Record<string, string>>({})
  const [activeFilter, setActiveFilter] = useState<ImportFilter>('all')
  const [previewSearch, setPreviewSearch] = useState('')
  const [selectedAsset, setSelectedAsset] = useState<NormalizedAsset | null>(null)

  // Import state
  const [testBatch, setTestBatch] = useState<NormalizedAsset[]>([])
  const [importDecisions, setImportDecisions] = useState<Map<string, ImportDecision>>(new Map())
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null)
  const [importRunning, setImportRunning] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [preflightResult, setPreflightResult] = useState<PreflightResult | null>(null)
  const [preflightRunning, setPreflightRunning] = useState(false)
  const [, setTrainingMode] = useState(false)
  const [dupWarning, setDupWarning] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [rollingBack, setRollingBack] = useState(false)
  const [rollbackDone, setRollbackDone] = useState<string | null>(null)
  const [rollbackOrphans, setRollbackOrphans] = useState<{
    types: { id: string; name: string }[]
    definitions: { id: string; name: string; assetTypeName: string }[]
  } | null>(null)
  const abortRef = useRef(false)

  // Target facility state
  const [targetFacilityId, setTargetFacilityId] = useState<string | null>(null)
  const [adminFacilities, setAdminFacilities] = useState<{ id: string; name: string; role: string; organization_id: string }[]>([])
  const [showNewFacility, setShowNewFacility] = useState(false)
  const [newFacilityName, setNewFacilityName] = useState('')
  const [newFacilityDesc, setNewFacilityDesc] = useState('')
  const [creatingFacility, setCreatingFacility] = useState(false)
  const [createError, setCreateError] = useState('')

  const targetFacility = adminFacilities.find(f => f.id === targetFacilityId) || null

  function resetImport() {
    setCsvFile(null)
    setCsvText(null)
    setXlsxBuffer(null)
    setWorkbookPreview(null)
    setAnalyzedAssets([])
    setAnalysisSummary(null)
    setTypeOverrides({})
    setActiveFilter('all')
    setPreviewSearch('')
    setSelectedAsset(null)
    setTestBatch([])
    setImportDecisions(new Map())
    setImportProgress(null)
    setImportRunning(false)
    setImportResult(null)
    setImportError(null)
    setPreflightResult(null)
    setPreflightRunning(false)
    setTrainingMode(false)
    setDupWarning(null)
    setConfirmed(false)
    setRollingBack(false)
    setRollbackDone(null)
    setRollbackOrphans(null)
    abortRef.current = false
    setTargetFacilityId(null)
    setAdminFacilities([])
    setShowNewFacility(false)
    setNewFacilityName('')
    setNewFacilityDesc('')
    setCreatingFacility(false)
    setCreateError('')
    setStep(1)
  }

  useEffect(() => {
    if (step !== 6 || !targetFacilityId || (!csvText && !xlsxBuffer)) return
    async function checkDup() {
      const fp = xlsxBuffer
        ? await computeFingerprintFromBuffer(xlsxBuffer)
        : await computeFingerprint(csvText!)
      const check = await checkDuplicateImport(targetFacilityId!, fp)
      if (check.isDuplicate) {
        setDupWarning(`This source file was previously imported into this facility as "${check.existingBatch!.source_filename}".`)
      } else {
        setDupWarning(null)
      }
    }
    checkDup()
  }, [step, targetFacilityId])

  useEffect(() => {
    if (step !== 6) return
    async function fetchAdminFacilities() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: memberships } = await supabase
        .from('facility_members')
        .select('facility_id, role')
        .eq('user_id', user.id)
        .in('role', ['admin', 'supervisor'])
      if (!memberships) return
      const facIds = memberships.map(m => m.facility_id)
      const { data: facs } = await supabase
        .from('facilities')
        .select('id, name, organization_id')
        .in('id', facIds)
        .order('name')
      if (facs) {
        setAdminFacilities(facs.map(f => {
          const m = memberships.find(mm => mm.facility_id === f.id)
          return { id: f.id, name: f.name, role: m?.role || 'admin', organization_id: (f as any).organization_id }
        }))
      }
    }
    fetchAdminFacilities()
  }, [step])

  async function handleCreateFacility() {
    if (!newFacilityName.trim() || !currentOrganization) { setCreateError('Facility name is required'); return }
    setCreatingFacility(true)
    setCreateError('')
    const fac = await createFacility({ name: newFacilityName.trim(), organization_id: currentOrganization.id, description: newFacilityDesc.trim() || null })
    if (!fac) {
      setCreateError('Failed to create facility')
      setCreatingFacility(false)
      return
    }
    await refreshAll()
    setAdminFacilities(prev => [...prev, { id: fac.id, name: fac.name, role: 'admin', organization_id: currentOrganization!.id }])
    setTargetFacilityId(fac.id)
    setShowNewFacility(false)
    setNewFacilityName('')
    setNewFacilityDesc('')
    setCreatingFacility(false)
  }

  useEffect(() => {
    if (!currentFacility || !profile) return
    supabase.from('facility_members').select('role')
      .eq('facility_id', currentFacility.id)
      .eq('user_id', profile.id)
      .maybeSingle()
      .then(({ data }) => { setUserRole(data?.role || null); setLoading(false) })
  }, [currentFacility, profile])

  const isAuthorized = userRole === 'admin' || userRole === 'supervisor'

  useEffect(() => {
    Promise.all([
      fetch('/data/xgfi_attribute_dictionary.csv').then(r => r.text()),
      fetch('/data/xgfi_sections.csv').then(r => r.text()).catch(() => null),
      fetch('/data/xgfi_duplicate_designations.csv').then(r => r.text()).catch(() => null),
    ]).then(([dictText, secText, dupText]) => {
      setDictionary(parseDictionaryCSV(dictText))
      if (secText) setRefSections(parseSectionsCSV(secText))
      if (dupText) setRefDuplicates(parseDuplicatesCSV(dupText))
    })
  }, [])

  const handleFile = useCallback((file: File) => {
    const isCSV = file.name.toLowerCase().endsWith('.csv')
    const isXLSX = file.name.toLowerCase().endsWith('.xlsx')
    if (!isCSV && !isXLSX) return
    setAnalyzedAssets([])
    setAnalysisSummary(null)
    setTypeOverrides({})
    setActiveFilter('all')
    setPreviewSearch('')
    setSelectedAsset(null)
    setTestBatch([])
    setImportDecisions(new Map())
    setImportProgress(null)
    setImportResult(null)
    setImportError(null)
    setPreflightResult(null)
    setTrainingMode(false)
    setDupWarning(null)
    setConfirmed(false)
    setRollbackDone(null)
    setRollbackOrphans(null)
    setTargetFacilityId(null)
    setWorkbookPreview(null)
    setXlsxBuffer(null)
    setCsvFile(file)
    setCsvText(null)
    if (isCSV) {
      file.text().then(setCsvText)
    } else {
      file.arrayBuffer().then(buf => setXlsxBuffer(buf))
    }
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0])
  }, [handleFile])

  async function runAnalysis() {
    if (!csvFile) return
    if (csvText) {
      const sections = parseMultiSectionCSV(csvText, dictionary)
      const result = analyzeImport(sections, dictionary, csvFile.name, refSections, refDuplicates)
      setAnalyzedAssets(result.assets)
      setAnalysisSummary(result.summary)
      setTypeOverrides({})
      setStep(2)
    } else if (xlsxBuffer) {
      const parsed = await parseXLSXFile(csvFile)
      const preview = normalizeWorkbook(parsed, currentFacility?.id || '__none__')
      setWorkbookPreview(preview)
      setAnalyzedAssets(preview.assets)
      const fakeSummary: AnalysisSummary = {
        sourceFile: csvFile.name,
        totalRows: preview.assets.length,
        sectionsDetected: parsed.sheets.length,
        recordsDetected: preview.assets.length,
        untaggedAssets: preview.assets.filter(a => a.isUntagged).length,
        duplicateTagGroups: 0,
        profilePairGroups: 0,
        unclassifiedEquipment: preview.assets.filter(a => a.typeConfidence === 'unresolved').length,
        warningCount: preview.summary.warnings.length,
        errorCount: preview.summary.errors.length,
        infoCount: 0,
        sections: parsed.sheets.map(s => ({ name: s.name, recordCount: s.rows.length })),
        requiredDefinitions: {},
        referenceComparisons: [],
      }
      setAnalysisSummary(fakeSummary)
      setTypeOverrides({})
      setStep(2)
    }
  }

  function handleTypeChange(sectionName: string, value: string) {
    setTypeOverrides(prev => ({ ...prev, [sectionName]: value }))
    setAnalyzedAssets(prev => prev.map(a => {
      if (a.sourceSection !== sectionName) return a
      const newType = value === '__unresolved__' ? null : value
      return { ...a, selectedAssetType: newType }
    }))
  }

  function getUniqueTypes(): string[] {
    const types = new Set<string>()
    analyzedAssets.forEach(a => { if (a.suggestedAssetType) types.add(a.suggestedAssetType) })
    return Array.from(types).sort()
  }

  async function prepareTestBatch() {
    const batch = workbookPreview ? analyzedAssets : selectTestBatch(analyzedAssets)
    setTestBatch(batch)
    const decisions = new Map<string, ImportDecision>()
    for (const a of batch) {
      if (workbookPreview) {
        const action = workbookPreview.importActions.get(a.id) || 'add'
        decisions.set(a.id, action === 'hold' ? 'exclude' : 'ready')
      } else {
        decisions.set(a.id, classifyImportDecision(a))
      }
    }
    setImportDecisions(decisions)
    setConfirmed(false)
    setDupWarning(null)
    setTargetFacilityId(null)
    setStep(6)
  }

  function updateDecision(assetId: string, decision: ImportDecision) {
    setImportDecisions(prev => {
      const next = new Map(prev)
      next.set(assetId, decision)
      return next
    })
  }

  async function runImport() {
    if (!targetFacilityId || !currentOrganization || !profile || !csvFile) return
    if (!csvText && !xlsxBuffer) return
    setImportRunning(true)
    setImportError(null)
    setImportResult(null)
    abortRef.current = false

    try {
      const result = workbookPreview && xlsxBuffer
        ? await executeWorkbookImport(
            targetFacilityId,
            currentOrganization.id,
            profile.id,
            testBatch,
            workbookPreview.importActions,
            workbookPreview.documents,
            xlsxBuffer,
            csvFile.name,
            setImportProgress,
          )
        : await executeImport(
            targetFacilityId,
            currentOrganization.id,
            profile.id,
            testBatch,
            importDecisions,
            csvText || '',
            csvFile.name,
            setImportProgress,
          )

      setImportResult(result)
      setStep(8)
    } catch (e) {
      setImportError((e as Error).message)
    } finally {
      setImportRunning(false)
    }
  }

  async function handleRollback() {
    if (!importResult) return
    setRollingBack(true)
    try {
      const result = await rollbackImportBatch(importResult.batchId)
      if (result.status !== 'completed') {
        const heading = result.status === 'blocked'
          ? 'Rollback was blocked and nothing was changed.'
          : result.status === 'already_rolled_back'
            ? 'This import was already rolled back.'
            : 'Rollback failed and nothing was changed.'
        setImportError([heading, ...result.reasons].join(' '))
        return
      }
      let msg = `Rolled back: ${result.assetsDeleted} assets, ${result.profilesDeleted} profiles, ` +
        `${result.valuesDeleted} values, ${result.relationshipsDeleted} relationships` +
        `${result.documentsDeleted ? `, ${result.documentsDeleted} documents` : ''}` +
        `${result.documentLinksDeleted ? `, ${result.documentLinksDeleted} document links` : ''} deleted.`
      if (result.assetsRestored || result.valuesRestored || result.valuesRemoved) {
        msg += ` Restored previous values on ${result.assetsRestored} existing asset(s) and ${result.valuesRestored} technical value(s); removed ${result.valuesRemoved} value(s) the import added to existing assets.`
      }
      if (result.preexistingAssetsKept) {
        msg += ` ${result.preexistingAssetsKept} asset(s) that existed before the import were kept.`
      }
      if (result.orphanedTypes.length > 0) {
        msg += ` ${result.orphanedTypes.length} orphaned type(s) remain: ${result.orphanedTypes.map(t => t.name).join(', ')}.`
      }
      if (result.orphanedDefinitions.length > 0) {
        msg += ` ${result.orphanedDefinitions.length} orphaned definition(s) remain.`
      }
      setRollbackDone(msg)
      setRollbackOrphans({
        types: result.orphanedTypes,
        definitions: result.orphanedDefinitions,
      })
    } catch (e) {
      setImportError(`Rollback failed: ${(e as Error).message}`)
    } finally {
      setRollingBack(false)
    }
  }

  async function runPreflightCheck() {
    if (analyzedAssets.length === 0) return
    setPreflightRunning(true)
    setPreflightResult(null)
    try {
      const assetTypes = await supabase.from('asset_types').select('name').eq('is_active', true)
      const existingTypeNames = (assetTypes.data || []).map((t: { name: string }) => t.name)
      const actions = new Map<string, 'add' | 'update' | 'existing' | 'hold'>()
      for (const a of analyzedAssets) {
        if (workbookPreview) {
          const action = workbookPreview.importActions.get(a.id) || 'add'
          actions.set(a.id, action)
        } else {
          actions.set(a.id, 'add')
        }
        if (a.selectedAssetType && !existingTypeNames.includes(a.selectedAssetType)) {
          const match = longestPrefixAssetTypeMatch(a.selectedAssetType, existingTypeNames)
          if (match) a.selectedAssetType = match
        }
      }
      const tagsResult = await supabase.from('assets').select('asset_tag').eq('facility_id', currentFacility?.id || '').not('asset_tag', 'is', null)
      const existingTags = new Set<string>((tagsResult.data || []).map((r: { asset_tag: string }) => r.asset_tag))
      const result = runPreflight(analyzedAssets, actions, existingTags)
      setPreflightResult(result)
    } catch (e) {
      setImportError(`Preflight failed: ${(e as Error).message}`)
    } finally {
      setPreflightRunning(false)
    }
  }

  function runTrainingMode() {
    const fixture = createTrainingFixture()
    setAnalyzedAssets([fixture])
    setAnalysisSummary({
      sourceFile: 'TRAINING FIXTURE (synthetic)',
      totalRows: 1,
      sectionsDetected: 1,
      recordsDetected: 1,
      untaggedAssets: 0,
      duplicateTagGroups: 0,
      profilePairGroups: 0,
      unclassifiedEquipment: 0,
      warningCount: 0,
      errorCount: 0,
      infoCount: 1,
      sections: [{ name: 'TRAINING FIXTURE', recordCount: 1 }],
      requiredDefinitions: {},
      referenceComparisons: [],
    })
    setTrainingMode(true)
    setPreflightResult(null)
    setStep(2)
  }

  const filteredAssets = filterAssets(analyzedAssets, activeFilter).filter(a => {
    if (!previewSearch) return true
    const q = previewSearch.toLowerCase()
    return a.equipmentName.toLowerCase().includes(q) || a.assetTag.toLowerCase().includes(q) || a.sourceSection.toLowerCase().includes(q)
  })

  const allFindings = analyzedAssets.flatMap(a => [
    ...a.errors.map(f => ({ ...f, ref: a.assetTag || `Row ${a.sourceRow}` })),
    ...a.warnings.map(f => ({ ...f, ref: a.assetTag || `Row ${a.sourceRow}` })),
    ...a.infos.map(f => ({ ...f, ref: a.assetTag || `Row ${a.sourceRow}` })),
  ])

  const readyCount = testBatch.filter(a => (importDecisions.get(a.id) || classifyImportDecision(a)) === 'ready').length
  const reviewCount = testBatch.filter(a => (importDecisions.get(a.id) || classifyImportDecision(a)) === 'review').length
  const excludeCount = testBatch.filter(a => (importDecisions.get(a.id) || classifyImportDecision(a)) === 'exclude').length
  const profileMergeCount = testBatch.filter(a => (importDecisions.get(a.id) || classifyImportDecision(a)) === 'profile_merge').length
  const coolingProfileCount = testBatch.filter(a =>
    a.profileStatus.type === 'proposed_merge' && a.profileStatus.profileName === 'Cooling Performance'
    && (importDecisions.get(a.id) || classifyImportDecision(a)) === 'ready'
  ).length
  const designProfilesCount = coolingProfileCount * 2
  const newTypesEstimate = new Set(
    testBatch.map(a => a.selectedAssetType || a.suggestedAssetType).filter(Boolean)
  ).size

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-2 border-sky-200 border-t-sky-500 rounded-full animate-spin" />
    </div>
  )

  if (!isAuthorized) return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <div className="bg-white rounded-2xl border border-neutral-200 p-8 shadow-sm text-center">
        <Shield size={40} className="mx-auto text-neutral-300 mb-4" />
        <h2 className="text-lg font-semibold text-neutral-900 mb-2">Access Denied</h2>
        <p className="text-sm text-neutral-500">Only facility admins and supervisors can access the import wizard.</p>
      </div>
    </div>
  )

  return (
    <div className="p-4 lg:p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-neutral-900">Data Import</h1>
        <p className="text-sm text-neutral-500 mt-1">Analyze, validate, and import CSV or XLSX facility data</p>
      </div>
      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-8 overflow-x-auto pb-2">
        {STEPS.map((s, i) => {
          const num = i + 1, active = step === num, done = step > num
          return (<div key={s.label} className="flex items-center">
            {i > 0 && <div className={`w-6 h-px mx-0.5 ${done ? 'bg-sky-400' : 'bg-neutral-200'}`} />}
            <button onClick={() => done && num <= 5 && setStep(num)} disabled={!done || num > 5}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all whitespace-nowrap ${
                active ? 'bg-sky-500 text-white shadow-md shadow-sky-200' :
                done ? 'bg-sky-50 text-sky-700 hover:bg-sky-100 cursor-pointer' : 'bg-neutral-50 text-neutral-400 cursor-default'}`}>
              <s.icon size={14} /><span className="hidden lg:inline">{s.label}</span>
            </button>
          </div>)
        })}
      </div>

      {/* Step 1: Upload */}
      {step === 1 && (<div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-sm">
        <div onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}
          className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors ${
            dragOver ? 'border-sky-400 bg-sky-50' : 'border-neutral-200 hover:border-neutral-300'}`}>
          <Upload size={40} className="mx-auto text-neutral-300 mb-4" />
          <p className="text-sm text-neutral-600 mb-2">Drag & drop a CSV or XLSX file here, or</p>
          <label className="inline-block bg-gradient-to-r from-sky-500 to-sky-600 text-white px-4 py-2 rounded-xl text-sm font-medium cursor-pointer hover:from-sky-600 hover:to-sky-700 shadow-md shadow-sky-200">
            Browse Files
            <input type="file" accept=".csv,.xlsx" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </label>
        </div>
        <div className="mt-4 flex items-center justify-between bg-violet-50 border border-violet-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
              <ClipboardCheck size={20} className="text-violet-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-neutral-900">Training Mode</p>
              <p className="text-xs text-neutral-500">Run a synthetic one-asset fixture through preflight without importing production data</p>
            </div>
          </div>
          <button onClick={runTrainingMode} className="bg-violet-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-violet-700 flex items-center gap-2 shrink-0">
            <Play size={16} /> Run Training
          </button>
        </div>
        {csvFile && (
        <div className="mt-4 flex items-center justify-between bg-neutral-50 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <FileText size={20} className="text-sky-500" />
            <div><p className="text-sm font-medium text-neutral-900">{csvFile.name}</p>
              <p className="text-xs text-neutral-400">{(csvFile.size / 1024).toFixed(1)} KB</p></div>
          </div>
          <button onClick={runAnalysis} className="bg-gradient-to-r from-sky-500 to-sky-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:from-sky-600 hover:to-sky-700 shadow-md shadow-sky-200 flex items-center gap-2">
            <BarChart3 size={16} /> Analyze
          </button>
        </div>)}
      </div>)}

      {/* Step 2: Analyze */}
      {step === 2 && analysisSummary && (<div className="space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            ['Source File', analysisSummary.sourceFile, 'text-sky-600'],
            ['Total Rows', analysisSummary.totalRows, 'text-neutral-900'],
            ['Sections', analysisSummary.sectionsDetected, 'text-neutral-900'],
            ['Records', analysisSummary.recordsDetected, 'text-neutral-900'],
            ['Untagged', analysisSummary.untaggedAssets, 'text-amber-600'],
            ['Duplicate Groups', analysisSummary.duplicateTagGroups, 'text-amber-600'],
            ['Profile Pairs', analysisSummary.profilePairGroups, 'text-sky-600'],
            ['Unclassified', analysisSummary.unclassifiedEquipment, 'text-red-600'],
            ['Warnings', analysisSummary.warningCount, 'text-amber-600'],
            ['Errors', analysisSummary.errorCount, 'text-red-600'],
          ].map(([label, value, color]) => (
            <div key={label as string} className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
              <p className="text-xs text-neutral-400 mb-1">{label as string}</p>
              <p className={`text-lg font-semibold truncate ${color}`}>{String(value)}</p>
            </div>
          ))}
        </div>

        {analysisSummary.referenceComparisons.length > 0 && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-neutral-900 mb-3">Reference Validation</h3>
            <table className="w-full text-sm"><thead><tr className="text-left text-xs text-neutral-400 border-b border-neutral-100">
              <th className="pb-2">Metric</th><th className="pb-2 text-right">Detected</th><th className="pb-2 text-right">Expected</th><th className="pb-2 text-right">Status</th>
            </tr></thead><tbody>{analysisSummary.referenceComparisons.map(c => (
              <tr key={c.metric} className="border-b border-neutral-50">
                <td className="py-2 text-neutral-700">{c.metric}</td>
                <td className="py-2 text-right text-neutral-900 font-semibold">{c.detected}</td>
                <td className="py-2 text-right text-neutral-500">{c.expected ?? '—'}</td>
                <td className="py-2 text-right">{confidenceBadge(c.status)}</td>
              </tr>
            ))}</tbody></table>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-900 mb-3">Section Breakdown</h3>
          <table className="w-full text-sm"><thead><tr className="text-left text-xs text-neutral-400 border-b border-neutral-100">
            <th className="pb-2">Section</th><th className="pb-2 text-right">Records</th>
          </tr></thead><tbody>{analysisSummary.sections.map(s => (<tr key={s.name} className="border-b border-neutral-50">
            <td className="py-2 text-neutral-700">{s.name}</td><td className="py-2 text-right text-neutral-900 font-medium">{s.recordCount}</td>
          </tr>))}</tbody></table>
        </div>

        {Object.keys(analysisSummary.requiredDefinitions).length > 0 && (<div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-900 mb-3">Required Attribute Definitions by Asset Type</h3>
          {Object.entries(analysisSummary.requiredDefinitions).map(([type, defs]) => (<div key={type} className="mb-4 last:mb-0">
            <p className="text-sm font-medium text-sky-700 mb-2">{type}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(['technical', 'service', 'electrical'] as const).map(cat => (<div key={cat} className="bg-neutral-50 rounded-xl p-3">
                <p className="text-xs font-semibold text-neutral-500 uppercase mb-1">{cat}</p>
                {defs[cat].length > 0 ? <ul className="text-xs text-neutral-600 space-y-0.5">{defs[cat].map(d => <li key={d}>&bull; {d}</li>)}</ul>
                  : <p className="text-xs text-neutral-400 italic">None</p>}
              </div>))}
            </div>
          </div>))}
        </div>)}

        <div className="flex justify-between">
          <button onClick={() => setStep(1)} className="border border-neutral-200 text-neutral-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-neutral-50 flex items-center gap-2"><ArrowLeft size={16} /> Back</button>
          <button onClick={() => setStep(3)} className="bg-gradient-to-r from-sky-500 to-sky-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:from-sky-600 hover:to-sky-700 shadow-md shadow-sky-200 flex items-center gap-2">Classification <ArrowRight size={16} /></button>
        </div>
      </div>)}

      {/* Step 3: Classification */}
      {step === 3 && (<div className="space-y-6">
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-neutral-100">
            <h3 className="text-sm font-semibold text-neutral-900">Section Classification</h3>
            <p className="text-xs text-neutral-400 mt-1">Review and override suggested asset types per source section</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutral-400 border-b border-neutral-100 bg-neutral-50">
                <th className="px-4 py-2">Source Section</th><th className="px-4 py-2 text-right">Records</th>
                <th className="px-4 py-2">Suggested Type</th><th className="px-4 py-2">Confidence</th><th className="px-4 py-2">Selected Type</th>
              </tr></thead>
              <tbody>
                {analysisSummary?.sections.map(sec => {
                  const sampleAsset = analyzedAssets.find(a => a.sourceSection === sec.name)
                  const suggested = sampleAsset?.suggestedAssetType || null
                  const confidence = sampleAsset?.typeConfidence || 'unresolved'
                  const override = typeOverrides[sec.name]
                  const sectionTypes = new Set(analyzedAssets.filter(a => a.sourceSection === sec.name).map(a => a.suggestedAssetType).filter(Boolean))
                  const isMultiType = sectionTypes.size > 1
                  return (
                    <tr key={sec.name} className="border-b border-neutral-50 hover:bg-neutral-50/50">
                      <td className="px-4 py-3 text-neutral-800 font-medium">
                        {sec.name}
                        {isMultiType && <span className="ml-2 text-xs bg-sky-50 text-sky-600 px-2 py-0.5 rounded-full">multi-type</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-neutral-600">{sec.recordCount}</td>
                      <td className="px-4 py-3 text-neutral-700">{suggested || <span className="text-neutral-400 italic">Unknown</span>}</td>
                      <td className="px-4 py-3">{confidenceBadge(confidence)}</td>
                      <td className="px-4 py-3">
                        <select value={override ?? suggested ?? '__unresolved__'}
                          onChange={e => handleTypeChange(sec.name, e.target.value)}
                          className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400/40 focus:border-sky-400">
                          <option value="__unresolved__">Leave Unresolved</option>
                          {getUniqueTypes().map(t => <option key={t} value={t}>{t}</option>)}
                          <option value="__new__">Create New...</option>
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex justify-between">
          <button onClick={() => setStep(2)} className="border border-neutral-200 text-neutral-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-neutral-50 flex items-center gap-2"><ArrowLeft size={16} /> Back</button>
          <button onClick={() => setStep(4)} className="bg-gradient-to-r from-sky-500 to-sky-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:from-sky-600 hover:to-sky-700 shadow-md shadow-sky-200 flex items-center gap-2">Preview <ArrowRight size={16} /></button>
        </div>
      </div>)}

      {/* Step 4: Preview */}
      {step === 4 && (<div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex gap-1 overflow-x-auto flex-1">
            {FILTER_TABS.map(tab => {
              const count = filterAssets(analyzedAssets, tab.key).length
              return (
                <button key={tab.key} onClick={() => setActiveFilter(tab.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                    activeFilter === tab.key ? 'bg-sky-500 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}>
                  {tab.label} ({count})
                </button>
              )
            })}
          </div>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input value={previewSearch} onChange={e => setPreviewSearch(e.target.value)}
              placeholder="Search assets..." className="w-full sm:w-56 pl-9 pr-3 py-2 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-400/40 focus:border-sky-400" />
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutral-400 border-b border-neutral-100 bg-neutral-50">
                <th className="px-3 py-2 w-8"></th><th className="px-3 py-2">Row</th><th className="px-3 py-2">Section</th>
                <th className="px-3 py-2">Equipment Name</th><th className="px-3 py-2">Asset Tag</th>
                <th className="px-3 py-2">Suggested Type</th><th className="px-3 py-2">Selected Type</th>
                <th className="px-3 py-2">Area</th><th className="px-3 py-2">Level</th>
                <th className="px-3 py-2">Profile</th><th className="px-3 py-2">Dup</th><th className="px-3 py-2">Warn</th>
              </tr></thead>
              <tbody>
                {filteredAssets.slice(0, 200).map(a => (
                  <tr key={a.id} onClick={() => setSelectedAsset(a)}
                    className="border-b border-neutral-50 hover:bg-sky-50/30 cursor-pointer transition-colors">
                    <td className="px-3 py-2">{statusIcon(a)}</td>
                    <td className="px-3 py-2 text-neutral-500 font-mono text-xs">{a.sourceRow}</td>
                    <td className="px-3 py-2 text-neutral-600 truncate max-w-[140px]">{a.sourceSection}</td>
                    <td className="px-3 py-2 text-neutral-800 font-medium truncate max-w-[180px]">{a.equipmentName || '—'}</td>
                    <td className="px-3 py-2 text-neutral-700 font-mono text-xs">{a.assetTag || <span className="text-amber-500 italic">untagged</span>}</td>
                    <td className="px-3 py-2 text-neutral-600 truncate max-w-[120px]">{a.suggestedAssetType || '—'}</td>
                    <td className="px-3 py-2 text-neutral-600 truncate max-w-[120px]">{a.selectedAssetType || '—'}</td>
                    <td className="px-3 py-2 text-neutral-500 truncate max-w-[100px]">{a.areaServed || '—'}</td>
                    <td className="px-3 py-2 text-neutral-500">{a.level || '—'}</td>
                    <td className="px-3 py-2">{a.profileStatus.type !== 'none' ? <span className="text-xs text-sky-600 font-medium">Yes</span> : '—'}</td>
                    <td className="px-3 py-2">{a.duplicateStatus.type !== 'none' ? <span className="text-xs text-amber-600">{a.duplicateStatus.type.replace('_', ' ')}</span> : '—'}</td>
                    <td className="px-3 py-2">{a.warnings.length > 0 ? <span className="text-xs bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-full">{a.warnings.length}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredAssets.length > 200 && <p className="px-4 py-3 text-xs text-neutral-400 border-t border-neutral-100">Showing 200 of {filteredAssets.length} assets</p>}
        </div>
        <div className="flex justify-between">
          <button onClick={() => setStep(3)} className="border border-neutral-200 text-neutral-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-neutral-50 flex items-center gap-2"><ArrowLeft size={16} /> Back</button>
          <button onClick={() => setStep(5)} className="bg-gradient-to-r from-sky-500 to-sky-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:from-sky-600 hover:to-sky-700 shadow-md shadow-sky-200 flex items-center gap-2">Validation <ArrowRight size={16} /></button>
        </div>
        {selectedAsset && <DetailPanel asset={selectedAsset} onClose={() => setSelectedAsset(null)} />}
      </div>)}

      {/* Step 5: Validation */}
      {step === 5 && (<div className="space-y-6">
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 flex items-start gap-3">
          <CheckCircle size={20} className="text-emerald-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-emerald-800">Analysis complete. No asset data has been imported yet.</p>
            <p className="text-xs text-emerald-700 mt-1">Review the findings below, then proceed to the test import.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {([
            ['Errors', allFindings.filter(f => f.severity === 'error'), 'error'],
            ['Warnings', allFindings.filter(f => f.severity === 'warning'), 'warning'],
            ['Info', allFindings.filter(f => f.severity === 'info'), 'info'],
          ] as const).map(([label, items, sev]) => (
            <div key={label} className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                {sev === 'error' ? <AlertTriangle size={16} className="text-red-500" /> :
                 sev === 'warning' ? <AlertTriangle size={16} className="text-amber-500" /> :
                 <Info size={16} className="text-sky-500" />}
                <h4 className="text-sm font-semibold text-neutral-900">{label} ({items.length})</h4>
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {items.length === 0 ? <p className="text-xs text-neutral-400 italic">None</p>
                : items.slice(0, 50).map((f, i) => (
                  <div key={i} className={`text-xs px-3 py-2 rounded-lg ${
                    sev === 'error' ? 'bg-red-50 text-red-700' : sev === 'warning' ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700'}`}>
                    <span className="font-medium">{f.ref}</span>: {f.message}
                  </div>
                ))}
                {items.length > 50 && <p className="text-xs text-neutral-400 mt-1">+{items.length - 50} more</p>}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-between">
          <button onClick={() => setStep(4)} className="border border-neutral-200 text-neutral-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-neutral-50 flex items-center gap-2"><ArrowLeft size={16} /> Back to Preview</button>
          <div className="flex gap-2">
            <button onClick={runPreflightCheck} disabled={preflightRunning}
              className="border border-violet-200 text-violet-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-violet-50 flex items-center gap-2 disabled:opacity-50">
              {preflightRunning ? <Loader2 size={16} className="animate-spin" /> : <Shield size={16} />} Run Preflight
            </button>
            <button onClick={prepareTestBatch} className="bg-gradient-to-r from-sky-500 to-sky-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:from-sky-600 hover:to-sky-700 shadow-md shadow-sky-200 flex items-center gap-2">
              <Play size={16} /> Prepare Test Import
            </button>
          </div>
        </div>
        {preflightResult && (
          <div className="bg-white rounded-2xl border border-violet-200 p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-neutral-900 mb-3 flex items-center gap-2">
              <Shield size={16} className="text-violet-600" /> Preflight Results
            </h3>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-4">
              {([
                ['Total', preflightResult.totalRows, 'text-neutral-900'],
                ['Add', preflightResult.rowsAdd, 'text-emerald-700'],
                ['Update', preflightResult.rowsUpdate, 'text-sky-700'],
                ['Hold', preflightResult.rowsHold, 'text-amber-600'],
                ['Skip', preflightResult.rowsSkip, 'text-neutral-500'],
                ['Conflict', preflightResult.rowsConflict, 'text-red-600'],
              ] as const).map(([label, value, color]) => (
                <div key={label} className="bg-neutral-50 rounded-xl p-3 text-center">
                  <p className={`text-xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-neutral-500">{label}</p>
                </div>
              ))}
            </div>
            {preflightResult.missingAssetTypes.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-red-600 mb-1">Missing Asset Types ({preflightResult.missingAssetTypes.length})</p>
                <div className="flex flex-wrap gap-1.5">
                  {preflightResult.missingAssetTypes.map(s => <span key={s} className="text-xs bg-red-50 text-red-700 px-2 py-0.5 rounded-full">{s}</span>)}
                </div>
              </div>
            )}
            {preflightResult.duplicateDetailRows.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-amber-600 mb-1">Duplicate Detail Rows ({preflightResult.duplicateDetailRows.length})</p>
                <div className="space-y-1">
                  {preflightResult.duplicateDetailRows.map(d => (
                    <div key={d.assetTag} className="text-xs bg-amber-50 text-amber-700 px-3 py-1.5 rounded-lg">
                      <span className="font-medium">{d.assetTag}</span> — {d.occurrences} occurrences (rows: {d.rows.join(', ')})
                    </div>
                  ))}
                </div>
              </div>
            )}
            {preflightResult.placeholderUrls.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-amber-600 mb-1">Placeholder URLs ({preflightResult.placeholderUrls.length})</p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {preflightResult.placeholderUrls.map((p, i) => (
                    <div key={i} className="text-xs bg-amber-50 text-amber-700 px-3 py-1.5 rounded-lg">
                      Row {p.sourceRow}: <span className="font-medium">{p.sourceHeader}</span> = "{p.value}"
                    </div>
                  ))}
                </div>
              </div>
            )}
            {preflightResult.validationErrors.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-red-600 mb-1">Validation Errors ({preflightResult.validationErrors.length})</p>
                <div className="space-y-1">
                  {preflightResult.validationErrors.map((e, i) => (
                    <div key={i} className="text-xs bg-red-50 text-red-700 px-3 py-1.5 rounded-lg">
                      Row {e.sourceRow}: {e.message}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {preflightResult.missingAssetTypes.length === 0 && preflightResult.duplicateDetailRows.length === 0 && preflightResult.placeholderUrls.length === 0 && preflightResult.validationErrors.length === 0 && preflightResult.rowsConflict === 0 && (
              <div className="bg-emerald-50 text-emerald-700 text-sm px-3 py-2 rounded-xl">No preflight issues found.</div>
            )}
            <p className="text-xs text-neutral-400 mt-3">Preflight validates data without executing an import. No data has been written.</p>
          </div>
        )}
      </div>)}

      {/* Step 6: Import Review */}
      {step === 6 && (<div className="space-y-6">
        {dupWarning && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-start gap-3">
            <AlertTriangle size={20} className="text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Duplicate Import Warning</p>
              <p className="text-xs text-amber-700 mt-1">{dupWarning}</p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-900 mb-4">Test Import Summary</h3>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mb-4">
            <div className="bg-neutral-50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-neutral-900">{testBatch.length}</p>
              <p className="text-xs text-neutral-500">Source Records</p>
            </div>
            <div className="bg-emerald-50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-emerald-700">{readyCount}</p>
              <p className="text-xs text-emerald-600">Physical Assets</p>
            </div>
            <div className="bg-sky-50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-sky-700">{profileMergeCount}</p>
              <p className="text-xs text-sky-600">Profile Merges</p>
            </div>
            <div className="bg-sky-50/60 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-sky-600">{designProfilesCount}</p>
              <p className="text-xs text-sky-500">Design Profiles</p>
            </div>
            {(reviewCount + excludeCount) > 0 && (
              <div className="bg-amber-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-amber-600">{reviewCount + excludeCount}</p>
                <p className="text-xs text-amber-500">{reviewCount > 0 ? 'Review' : ''}{reviewCount > 0 && excludeCount > 0 ? ' / ' : ''}{excludeCount > 0 ? 'Excluded' : ''}</p>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div><span className="text-neutral-400 text-xs">Cooling + Heating Pairs</span><p className="text-neutral-800">{coolingProfileCount} pair{coolingProfileCount !== 1 ? 's' : ''} ({coolingProfileCount * 2} profiles)</p></div>
            <div><span className="text-neutral-400 text-xs">Asset Types</span><p className="text-neutral-800">Up to {newTypesEstimate}</p></div>
          </div>
        </div>

        {/* Target Facility Selector */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-900 mb-1">Target Facility</h3>
          {currentOrganization && <p className="text-xs text-neutral-500 mb-1">Organization: <span className="font-medium">{currentOrganization.name}</span></p>}
          <p className="text-xs text-neutral-400 mb-3">Select the facility these assets will be imported into. Only facilities where you have admin or supervisor access are listed.</p>
          {!showNewFacility ? (
            <div className="space-y-3">
              <select
                value={targetFacilityId || ''}
                onChange={e => { setTargetFacilityId(e.target.value || null); setConfirmed(false) }}
                className="w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
              >
                <option value="">-- Select a facility --</option>
                {adminFacilities.filter(f => currentOrganization && f.organization_id === currentOrganization.id).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowNewFacility(true)}
                className="flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                <FolderPlus size={16} /> Create New Facility
              </button>
            </div>
          ) : (
            <div className="space-y-3 border border-neutral-100 rounded-xl p-4 bg-neutral-50">
              <p className="text-sm font-medium text-neutral-800">Create New Facility</p>
              <input
                type="text"
                placeholder="Facility name (e.g. Xg-Fi Import Test)"
                value={newFacilityName}
                onChange={e => setNewFacilityName(e.target.value)}
                className="w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400"
              />
              <textarea
                placeholder="Description (optional)"
                value={newFacilityDesc}
                onChange={e => setNewFacilityDesc(e.target.value)}
                rows={2}
                className="w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400 resize-none"
              />
              {createError && <p className="text-xs text-red-600">{createError}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCreateFacility}
                  disabled={creatingFacility}
                  className="bg-gradient-to-r from-primary-500 to-primary-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:from-primary-600 hover:to-primary-700 flex items-center gap-2 disabled:opacity-50"
                >
                  {creatingFacility ? <Loader2 size={14} className="animate-spin" /> : <FolderPlus size={14} />}
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => { setShowNewFacility(false); setCreateError('') }}
                  className="border border-neutral-200 text-neutral-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-neutral-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {targetFacility && (
            <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
              <CheckCircle size={16} className="text-emerald-600 shrink-0" />
              <p className="text-sm text-emerald-800">Importing into <span className="font-semibold">{targetFacility.name}</span></p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-neutral-100 bg-neutral-50">
            <h3 className="text-sm font-semibold text-neutral-900">Test Batch Records</h3>
            <p className="text-xs text-neutral-400">Review and adjust import decisions for each record</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutral-400 border-b border-neutral-100">
                <th className="px-3 py-2">Row</th><th className="px-3 py-2">Section</th>
                <th className="px-3 py-2">Equipment Name</th><th className="px-3 py-2">Tag</th>
                <th className="px-3 py-2">Type</th><th className="px-3 py-2">Profile</th>
                <th className="px-3 py-2">Decision</th>
              </tr></thead>
              <tbody>
                {testBatch.map(a => {
                  const decision = importDecisions.get(a.id) || classifyImportDecision(a)
                  return (
                    <tr key={a.id} className="border-b border-neutral-50 hover:bg-neutral-50/50">
                      <td className="px-3 py-2 text-neutral-500 font-mono text-xs">{a.sourceRow}</td>
                      <td className="px-3 py-2 text-neutral-600 truncate max-w-[120px]">{a.sourceSection}</td>
                      <td className="px-3 py-2 text-neutral-800 font-medium truncate max-w-[180px]">{a.equipmentName}</td>
                      <td className="px-3 py-2 text-neutral-600 font-mono text-xs">{a.assetTag || <span className="text-amber-500 italic">untagged</span>}</td>
                      <td className="px-3 py-2 text-neutral-600 truncate max-w-[100px]">{a.selectedAssetType || a.suggestedAssetType || '—'}</td>
                      <td className="px-3 py-2">{a.profileStatus.type === 'proposed_merge'
                        ? <span className="text-xs text-sky-600">{a.profileStatus.profileName}</span> : '—'}</td>
                      <td className="px-3 py-2">
                        {(() => {
                          const isHeatingPair = a.profileStatus.type === 'proposed_merge' && a.profileStatus.profileName === 'Heating Performance'
                          return (
                            <select value={decision} onChange={e => updateDecision(a.id, e.target.value as ImportDecision)}
                              className={`text-xs px-2 py-1 rounded-lg border font-medium ${
                                decision === 'ready' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' :
                                decision === 'profile_merge' ? 'border-sky-200 bg-sky-50 text-sky-700' :
                                decision === 'review' ? 'border-amber-200 bg-amber-50 text-amber-600' :
                                'border-red-200 bg-red-50 text-red-700'}`}>
                              {isHeatingPair ? (
                                <>
                                  <option value="profile_merge">Profile Merge</option>
                                  <option value="exclude">Exclude</option>
                                </>
                              ) : (
                                <>
                                  <option value="ready">Import</option>
                                  <option value="review">Review</option>
                                  <option value="exclude">Exclude</option>
                                </>
                              )}
                            </select>
                          )
                        })()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {!targetFacilityId && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
            <AlertTriangle size={18} className="text-amber-500 shrink-0" />
            <p className="text-sm text-amber-800">You must select a target facility before proceeding.</p>
          </div>
        )}

        {targetFacilityId && (
          <div className="bg-sky-50 border border-sky-200 rounded-2xl p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}
                className="mt-1 rounded border-sky-300 text-sky-500 focus:ring-sky-400" />
              <div>
                <p className="text-sm font-medium text-sky-800">I confirm this test import into "{targetFacility?.name}"</p>
                <p className="text-xs text-sky-600 mt-0.5">
                  {readyCount} physical assets will be created.{designProfilesCount > 0 ? ` ${designProfilesCount} design profiles across ${coolingProfileCount} HC-CC pair${coolingProfileCount !== 1 ? 's' : ''}.` : ''}{profileMergeCount > 0 ? ` ${profileMergeCount} heating row${profileMergeCount !== 1 ? 's' : ''} will merge into their cooling counterparts.` : ''} {readyCount - coolingProfileCount} asset{readyCount - coolingProfileCount !== 1 ? 's' : ''} will store attributes directly (no design profiles). This can be rolled back.
                </p>
              </div>
            </label>
          </div>
        )}

        <div className="flex justify-between">
          <button onClick={() => setStep(5)} className="border border-neutral-200 text-neutral-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-neutral-50 flex items-center gap-2"><ArrowLeft size={16} /> Back</button>
          <button onClick={() => { setStep(7); runImport() }} disabled={!confirmed || !targetFacilityId || readyCount === 0}
            className="bg-gradient-to-r from-emerald-500 to-emerald-600 text-white px-5 py-2 rounded-xl text-sm font-medium hover:from-emerald-600 hover:to-emerald-700 shadow-md shadow-emerald-200 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
            <Play size={16} /> Run Test Import
          </button>
        </div>
      </div>)}

      {/* Step 7: Import Progress */}
      {step === 7 && (<div className="space-y-6">
        <div className="bg-white rounded-2xl border border-neutral-200 p-8 shadow-sm text-center">
          {importRunning && (
            <>
              <Loader2 size={40} className="mx-auto text-sky-500 mb-4 animate-spin" />
              <h3 className="text-lg font-semibold text-neutral-900 mb-2">Importing Assets...</h3>
              {importProgress && (
                <div className="max-w-md mx-auto">
                  <p className="text-sm text-neutral-600 mb-3">{importProgress.phaseLabel}</p>
                  {importProgress.total > 0 && (
                    <>
                      <div className="w-full bg-neutral-100 rounded-full h-2 mb-2">
                        <div className="bg-sky-500 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, (importProgress.current / importProgress.total) * 100)}%` }} />
                      </div>
                      <p className="text-xs text-neutral-400">{importProgress.current} / {importProgress.total}</p>
                    </>
                  )}
                </div>
              )}
            </>
          )}
          {importError && !importRunning && (
            <>
              <AlertTriangle size={40} className="mx-auto text-red-500 mb-4" />
              <h3 className="text-lg font-semibold text-red-700 mb-2">Import Failed</h3>
              <p className="text-sm text-red-600 mb-4">{importError}</p>
              <button onClick={() => setStep(6)} className="border border-neutral-200 text-neutral-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-neutral-50">
                Back to Review
              </button>
            </>
          )}
        </div>
      </div>)}

      {/* Step 8: Results */}
      {step === 8 && importResult && (<div className="space-y-6">
        <div className={`${importResult.failures.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'} border rounded-2xl p-5 flex items-start gap-3`}>
          <CheckCircle size={20} className={`mt-0.5 shrink-0 ${importResult.failures.length > 0 ? 'text-amber-600' : 'text-emerald-600'}`} />
          <div>
            <p className="text-sm font-semibold text-neutral-800">
              Import {importResult.failures.length > 0 ? 'completed with warnings' : 'completed successfully'}
            </p>
            <p className="text-xs text-neutral-600 mt-1">Batch ID: <span className="font-mono">{importResult.batchId.slice(0, 8)}...</span></p>
          </div>
        </div>

        {rollbackDone && (
          <div className="bg-sky-50 border border-sky-200 rounded-2xl p-4">
            <p className="text-sm text-sky-800 font-medium">{rollbackDone}</p>
          </div>
        )}

        {rollbackOrphans && rollbackOrphans.types.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
            <h4 className="text-sm font-semibold text-amber-800 mb-2">Orphaned Asset Types (created by this import, no remaining assets)</h4>
            <ul className="text-xs text-amber-700 space-y-1">
              {rollbackOrphans.types.map(t => <li key={t.id}>&bull; {t.name}</li>)}
            </ul>
            <p className="text-xs text-amber-600 mt-2 italic">These types were not deleted and can be removed manually if desired.</p>
          </div>
        )}

        {rollbackOrphans && rollbackOrphans.definitions.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
            <h4 className="text-sm font-semibold text-amber-800 mb-2">Orphaned Attribute Definitions (created by this import, no remaining values)</h4>
            <ul className="text-xs text-amber-700 space-y-1">
              {rollbackOrphans.definitions.map(d => <li key={d.id}>&bull; {d.name} ({d.assetTypeName})</li>)}
            </ul>
            <p className="text-xs text-amber-600 mt-2 italic">These definitions were not deleted and can be removed manually if desired.</p>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
          {[
            ['Assets Created', importResult.assetsCreated, 'text-emerald-700'],
            ['Assets Skipped', importResult.assetsSkipped, 'text-neutral-500'],
            ['Profile Merges', importResult.profileMerges, 'text-sky-600'],
            ['Profiles Created', importResult.profilesCreated, 'text-sky-600'],
            ['Attr Values', importResult.attributeValuesCreated, 'text-neutral-900'],
            ['Relationships', importResult.relationshipsCreated, 'text-neutral-900'],
            ['New Types', importResult.newAssetTypes.length, 'text-sky-600'],
            ['New Definitions', importResult.newAttributeDefinitions.length, 'text-sky-600'],
            ['Warnings', importResult.warnings.length, 'text-amber-600'],
            ['Failures', importResult.failures.length, 'text-red-600'],
          ].map(([label, value, color]) => (
            <div key={label as string} className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
              <p className="text-xs text-neutral-400 mb-1">{label as string}</p>
              <p className={`text-lg font-semibold ${color}`}>{String(value)}</p>
            </div>
          ))}
        </div>

        {/* Record-level results */}
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-neutral-100 bg-neutral-50">
            <h3 className="text-sm font-semibold text-neutral-900">Import Records</h3>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white"><tr className="text-left text-xs text-neutral-400 border-b border-neutral-100">
                <th className="px-3 py-2">Row</th><th className="px-3 py-2">Section</th>
                <th className="px-3 py-2">Equipment</th><th className="px-3 py-2">Tag</th>
                <th className="px-3 py-2">Decision</th><th className="px-3 py-2">Result</th>
                <th className="px-3 py-2">Message</th><th className="px-3 py-2">Link</th>
              </tr></thead>
              <tbody>
                {importResult.records.map((r, i) => (
                  <tr key={i} className="border-b border-neutral-50">
                    <td className="px-3 py-2 text-neutral-500 font-mono text-xs">{r.sourceRow}</td>
                    <td className="px-3 py-2 text-neutral-600 truncate max-w-[120px]">{r.sourceSection}</td>
                    <td className="px-3 py-2 text-neutral-800 truncate max-w-[160px]">{r.equipmentName}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.assetTag || <span className="text-amber-500 italic">untagged</span>}</td>
                    <td className="px-3 py-2">{decisionBadge(r.decision)}</td>
                    <td className="px-3 py-2">{resultBadge(r.result)}</td>
                    <td className="px-3 py-2 text-xs text-neutral-500 truncate max-w-[200px]">{r.message}</td>
                    <td className="px-3 py-2">
                      {r.assetId && (
                        <a href={`/assets/${r.assetId}`} target="_blank" rel="noopener noreferrer"
                          className="text-sky-500 hover:text-sky-600"><ExternalLink size={14} /></a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {importResult.newAssetTypes.length > 0 && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
            <h4 className="text-sm font-semibold text-sky-700 mb-3">New Asset Types Created by This Import</h4>
            <div className="flex flex-wrap gap-2">
              {importResult.newAssetTypes.map(t => (
                <span key={t.id} className="text-xs bg-sky-50 text-sky-700 px-2.5 py-1 rounded-full">{t.name}</span>
              ))}
            </div>
          </div>
        )}

        {importResult.newAttributeDefinitions.length > 0 && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
            <h4 className="text-sm font-semibold text-sky-700 mb-3">New Attribute Definitions Created by This Import</h4>
            <div className="space-y-1">
              {importResult.newAttributeDefinitions.map(d => (
                <p key={d.id} className="text-xs text-neutral-600">&bull; <span className="font-medium">{d.name}</span> ({d.assetTypeName})</p>
              ))}
            </div>
          </div>
        )}

        {importResult.warnings.length > 0 && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
            <h4 className="text-sm font-semibold text-amber-700 mb-3 flex items-center gap-2">
              <AlertTriangle size={16} /> Warnings ({importResult.warnings.length})
            </h4>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {importResult.warnings.map((w, i) => (
                <p key={i} className="text-xs bg-amber-50 text-amber-700 px-3 py-2 rounded-lg">{w}</p>
              ))}
            </div>
          </div>
        )}

        {importResult.failures.length > 0 && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
            <h4 className="text-sm font-semibold text-red-700 mb-3 flex items-center gap-2">
              <AlertTriangle size={16} /> Failures ({importResult.failures.length})
            </h4>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {importResult.failures.map((f, i) => (
                <p key={i} className="text-xs bg-red-50 text-red-700 px-3 py-2 rounded-lg">
                  <span className="font-medium">{f.asset}</span>: {f.error}
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-between items-center">
          <button onClick={resetImport}
            className="border border-neutral-200 text-neutral-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-neutral-50 flex items-center gap-2">
            <ArrowLeft size={16} /> New Import
          </button>
          {!rollbackDone && (
            <button onClick={handleRollback} disabled={rollingBack}
              className="border border-red-200 text-red-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-red-50 flex items-center gap-2 disabled:opacity-50">
              {rollingBack ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
              {rollingBack ? 'Rolling back...' : 'Rollback Test Import'}
            </button>
          )}
        </div>
      </div>)}
    </div>
  )
}
