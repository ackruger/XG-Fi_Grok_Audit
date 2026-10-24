import { supabase } from '../supabase'
import { fetchAllInChunks, fetchAllPages } from '../fetchAllPages'
import type {
  NormalizedAsset,
  NormalizedAttribute,
  WorkbookDocument,
  ImportAction,
} from './types'

/* ── Import eligibility ── */

export type ImportDecision = 'ready' | 'review' | 'exclude' | 'profile_merge'

const MEDICAL_GAS_REVIEW_NAMES = new Set([
  'MEDICAL VACUUM SYSTEM',
  'MEDICAL AIR SYSTEM',
  'ANESTHETIC GAS SCAVENGING SYSTEM',
  'INSTRUMENT AIR SYSTEM',
  'LAB VACUUM SYSTEM',
])

export function classifyImportDecision(asset: NormalizedAsset): ImportDecision {
  if (asset.errors.length > 0) return 'exclude'
  if (!asset.equipmentName) return 'exclude'

  if (MEDICAL_GAS_REVIEW_NAMES.has(asset.equipmentName.toUpperCase())) return 'review'

  if (asset.typeConfidence === 'unresolved') return 'review'

  if (asset.duplicateStatus.type === 'ambiguous') return 'review'

  if (asset.profileStatus.type === 'proposed_merge' &&
      asset.profileStatus.profileName === 'Heating Performance') {
    return 'profile_merge'
  }

  return 'ready'
}

/* ── Fingerprint ── */

async function loadAttributeDefinitions(): Promise<{ id: string; name: string; asset_type_id: string }[]> {
  try {
    return await fetchAllPages<{ id: string; name: string; asset_type_id: string }>((from, to) =>
      supabase
        .from('asset_attribute_definitions')
        .select('id, name, asset_type_id')
        .order('id', { ascending: true })
        .range(from, to),
    )
  } catch (e) {
    throw new Error(`Failed to load attribute definitions: ${(e as Error).message}`)
  }
}

async function insertImportRecords(result: ImportResult, rows: Record<string, unknown> | Record<string, unknown>[]) {
  const { error } = await supabase.from('asset_import_records').insert(rows)
  if (error) {
    const count = Array.isArray(rows) ? rows.length : 1
    result.warnings.push(`${count} import record(s) could not be saved to the import history: ${error.message}`)
  }
}

export async function computeFingerprint(csvText: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(csvText)
  return computeFingerprintFromBuffer(data.buffer as ArrayBuffer)
}

export async function computeFingerprintFromBuffer(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/* ── Duplicate import check ── */

export async function checkDuplicateImport(
  facilityId: string,
  fingerprint: string
): Promise<{ isDuplicate: boolean; existingBatch?: { id: string; source_filename: string; completed_at: string } }> {
  const { data } = await supabase
    .from('asset_import_batches')
    .select('id, source_filename, completed_at')
    .eq('facility_id', facilityId)
    .eq('source_fingerprint', fingerprint)
    .in('status', ['completed'])
    .maybeSingle()

  if (data) {
    return { isDuplicate: true, existingBatch: data }
  }
  return { isDuplicate: false }
}

/* ── Asset type resolution ── */

interface ResolvedType {
  id: string
  name: string
  isNew: boolean
}

async function resolveAssetType(
  organizationId: string,
  typeName: string,
  existingTypes: Map<string, { id: string; name: string }>,
  batchId: string,
): Promise<ResolvedType> {
  const normalized = typeName.trim().toLowerCase()
  for (const [key, val] of existingTypes) {
    if (key === normalized) {
      return { id: val.id, name: val.name, isNew: false }
    }
  }

  const { data, error } = await supabase
    .from('asset_types')
    .insert({
      organization_id: organizationId,
      name: typeName.trim(),
      code: typeName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
      is_active: true,
      sort_order: existingTypes.size + 1,
      created_by_import_batch_id: batchId,
    })
    .select('id, name')
    .single()

  if (error) throw new Error(`Failed to create asset type "${typeName}": ${error.message}`)

  existingTypes.set(normalized, { id: data.id, name: data.name })
  return { id: data.id, name: data.name, isNew: true }
}

/* ── Attribute definition resolution ── */

interface ResolvedDefinition {
  id: string
  name: string
  isNew: boolean
}

async function resolveAttributeDefinition(
  assetTypeId: string,
  attr: NormalizedAttribute,
  appSection: 'technical' | 'service' | 'electrical_controls',
  existingDefs: Map<string, { id: string; name: string }>,
  sortCounter: { value: number },
  batchId: string,
): Promise<ResolvedDefinition> {
  const fieldKey = attr.normalizedLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  const cacheKey = `${assetTypeId}:${fieldKey}`

  const cached = existingDefs.get(cacheKey)
  if (cached) return { id: cached.id, name: cached.name, isNew: false }

  const { data, error } = await supabase
    .from('asset_attribute_definitions')
    .insert({
      asset_type_id: assetTypeId,
      name: fieldKey,
      display_name: attr.normalizedLabel || attr.sourceHeader,
      app_section: appSection,
      data_type: inferDataType(attr.value),
      unit: attr.unit || null,
      sort_order: sortCounter.value++,
      is_required: false,
      is_searchable: false,
      source_column: String(attr.sourceColumn),
      source_header: attr.sourceHeader,
      created_by_import_batch_id: batchId,
    })
    .select('id, name')
    .single()

  if (error) {
    if (error.code === '23505') {
      const { data: existing } = await supabase
        .from('asset_attribute_definitions')
        .select('id, name')
        .eq('asset_type_id', assetTypeId)
        .eq('name', fieldKey)
        .maybeSingle()
      if (existing) {
        existingDefs.set(cacheKey, { id: existing.id, name: existing.name })
        return { id: existing.id, name: existing.name, isNew: false }
      }
    }
    throw new Error(`Failed to create definition "${fieldKey}": ${error.message}`)
  }

  existingDefs.set(cacheKey, { id: data.id, name: data.name })
  return { id: data.id, name: data.name, isNew: true }
}

function inferDataType(value: string): string {
  if (!value) return 'text'
  const cleaned = value.replace(/,/g, '')
  if (/^-?\d+(\.\d+)?$/.test(cleaned)) return 'number'
  if (/^(yes|no|true|false)$/i.test(value)) return 'boolean'
  return 'text'
}

/* ── Progress tracking ── */

export type ImportPhase =
  | 'preparing_types'
  | 'preparing_definitions'
  | 'creating_assets'
  | 'creating_profiles'
  | 'saving_attributes'
  | 'creating_relationships'
  | 'creating_documents'
  | 'linking_documents'
  | 'finalizing'

export interface ImportProgress {
  phase: ImportPhase
  phaseLabel: string
  current: number
  total: number
}

export interface ImportResult {
  batchId: string
  assetsCreated: number
  assetsSkipped: number
  profileMerges: number
  profilesCreated: number
  attributeValuesCreated: number
  servicePartsCreated: number
  relationshipsCreated: number
  documentsCreated: number
  documentLinksCreated: number
  warnings: string[]
  failures: { asset: string; error: string }[]
  records: ImportRecordResult[]
  newAssetTypes: { id: string; name: string }[]
  newAttributeDefinitions: { id: string; name: string; assetTypeName: string }[]
}

export interface ImportRecordResult {
  sourceRow: number
  sourceSection: string
  equipmentName: string
  assetTag: string
  decision: ImportDecision
  result: 'created' | 'merged_profile' | 'skipped' | 'review' | 'failed' | 'updated' | 'linked'
  assetId: string | null
  message: string
}

/* ── Main import engine ── */

export async function executeImport(
  facilityId: string,
  organizationId: string,
  userId: string,
  assets: NormalizedAsset[],
  decisions: Map<string, ImportDecision>,
  csvText: string,
  sourceFilename: string,
  onProgress: (p: ImportProgress) => void,
): Promise<ImportResult> {
  const fingerprint = await computeFingerprint(csvText)

  const dupCheck = await checkDuplicateImport(facilityId, fingerprint)
  if (dupCheck.isDuplicate) {
    throw new Error(`This source file has previously been imported (batch: ${dupCheck.existingBatch!.source_filename})`)
  }

  const importableAssets = assets.filter(a => {
    const decision = decisions.get(a.id) || classifyImportDecision(a)
    return decision === 'ready' || decision === 'profile_merge'
  })

  const { data: batchData, error: batchError } = await supabase
    .from('asset_import_batches')
    .insert({
      facility_id: facilityId,
      source_filename: sourceFilename,
      source_fingerprint: fingerprint,
      status: 'in_progress',
      started_by: userId,
      started_at: new Date().toISOString(),
      records_analyzed: assets.length,
      records_selected: importableAssets.length,
    })
    .select('id')
    .single()

  if (batchError) throw new Error(`Failed to create import batch: ${batchError.message}`)
  const batchId = batchData.id

  const result: ImportResult = {
    batchId,
    assetsCreated: 0,
    assetsSkipped: 0,
    profileMerges: 0,
    profilesCreated: 0,
    attributeValuesCreated: 0,
    servicePartsCreated: 0,
    relationshipsCreated: 0,
    documentsCreated: 0,
    documentLinksCreated: 0,
    warnings: [],
    failures: [],
    records: [],
    newAssetTypes: [],
    newAttributeDefinitions: [],
  }

  try {
    // Phase 1: Resolve asset types
    onProgress({ phase: 'preparing_types', phaseLabel: 'Preparing asset types', current: 0, total: 0 })
    const { data: existingTypeRows } = await supabase
      .from('asset_types')
      .select('id, name')
      .eq('organization_id', organizationId)

    const existingTypes = new Map<string, { id: string; name: string }>()
    for (const t of existingTypeRows || []) {
      existingTypes.set(t.name.toLowerCase(), { id: t.id, name: t.name })
    }

    const typeNames = new Set<string>()
    for (const a of importableAssets) {
      const typeName = a.selectedAssetType || a.suggestedAssetType
      if (typeName) typeNames.add(typeName)
    }

    const resolvedTypes = new Map<string, ResolvedType>()
    let typeIdx = 0
    for (const name of typeNames) {
      const resolved = await resolveAssetType(organizationId, name, existingTypes, batchId)
      resolvedTypes.set(name, resolved)
      if (resolved.isNew) {
        result.newAssetTypes.push({ id: resolved.id, name: resolved.name })
      }
      typeIdx++
      onProgress({ phase: 'preparing_types', phaseLabel: 'Preparing asset types', current: typeIdx, total: typeNames.size })
    }

    // Phase 2: Resolve attribute definitions
    onProgress({ phase: 'preparing_definitions', phaseLabel: 'Preparing attribute definitions', current: 0, total: 0 })
    const existingDefRows = await loadAttributeDefinitions()

    const existingDefs = new Map<string, { id: string; name: string }>()
    for (const d of existingDefRows) {
      const key = `${d.asset_type_id}:${d.name}`
      existingDefs.set(key, { id: d.id, name: d.name })
    }

    const defSortCounters = new Map<string, { value: number }>()
    let defIdx = 0
    const totalDefs = importableAssets.reduce((s, a) =>
      s + a.technicalAttributes.length + a.serviceAttributes.length + a.electricalAttributes.length, 0)

    const profilePairMap = new Map<string, NormalizedAsset>()
    for (const a of importableAssets) {
      if (a.profileStatus.type === 'proposed_merge' && a.profileStatus.profileName === 'Cooling Performance') {
        profilePairMap.set(a.assetTag, a)
      }
    }

    // Phase 3: Create assets
    onProgress({ phase: 'creating_assets', phaseLabel: 'Creating assets', current: 0, total: importableAssets.length })

    const createdAssetsByTag = new Map<string, string>()
    const assetProcessingOrder = importableAssets.filter(a =>
      !(a.profileStatus.type === 'proposed_merge' && a.profileStatus.profileName === 'Heating Performance')
    )

    const heatingAssets = importableAssets.filter(a =>
      a.profileStatus.type === 'proposed_merge' && a.profileStatus.profileName === 'Heating Performance'
    )

    let assetIdx = 0
    for (const asset of assetProcessingOrder) {
      try {
        const decision = decisions.get(asset.id) || classifyImportDecision(asset)
        if (decision !== 'ready') {
          result.records.push({
            sourceRow: asset.sourceRow,
            sourceSection: asset.sourceSection,
            equipmentName: asset.equipmentName,
            assetTag: asset.assetTag,
            decision,
            result: decision === 'exclude' ? 'skipped' : 'review',
            assetId: null,
            message: decision === 'exclude' ? 'Excluded from import' : 'Flagged for review',
          })
          result.assetsSkipped++
          assetIdx++
          onProgress({ phase: 'creating_assets', phaseLabel: 'Creating assets', current: assetIdx, total: assetProcessingOrder.length })
          continue
        }

        const typeName = asset.selectedAssetType || asset.suggestedAssetType
        const resolvedType = typeName ? resolvedTypes.get(typeName) : null

        const assetInsert: Record<string, unknown> = {
          facility_id: facilityId,
          equipment_name: asset.equipmentName,
          asset_tag: asset.assetTag || null,
          asset_type_id: resolvedType?.id || null,
          equipment_type: typeName || null,
          status: 'not_started',
          area_served: asset.areaServed || null,
          design_stage: asset.level || null,
          source_section: asset.sourceSection,
          source_row: asset.sourceRow,
          manufacturer: asset.manufacturer || null,
          model: asset.model || null,
          serial_number: asset.serialNumber || null,
          drawing_reference: asset.drawingReference || null,
          spec_section: asset.specificationSection || null,
          notes: null,
          import_batch_id: batchId,
        }

        const { data: createdAsset, error: assetError } = await supabase
          .from('assets')
          .insert(assetInsert)
          .select('id, qr_code_id')
          .single()

        if (assetError) throw new Error(assetError.message)

        result.assetsCreated++
        if (asset.assetTag) {
          createdAssetsByTag.set(asset.assetTag, createdAsset.id)
        }

        // Create design profile for cooling performance pairs
        let coolingProfileId: string | null = null
        if (asset.profileStatus.type === 'proposed_merge' && asset.profileStatus.profileName === 'Cooling Performance') {
          const { data: profileData, error: profileError } = await supabase
            .from('asset_design_profiles')
            .insert({
              asset_id: createdAsset.id,
              name: 'Cooling Performance',
              source_section: asset.sourceSection,
              sort_order: 1,
              import_batch_id: batchId,
            })
            .select('id')
            .single()

          if (profileError) {
            result.warnings.push(`Profile creation failed for ${asset.assetTag}: ${profileError.message}`)
          } else {
            coolingProfileId = profileData.id
            result.profilesCreated++
          }
        }

        // Save attribute values
        if (resolvedType) {
          const sortCounter = defSortCounters.get(resolvedType.id) || { value: 1 }
          defSortCounters.set(resolvedType.id, sortCounter)

          const attrGroups: { attrs: NormalizedAttribute[]; section: 'technical' | 'service' | 'electrical_controls' }[] = [
            { attrs: asset.technicalAttributes, section: 'technical' },
            { attrs: asset.serviceAttributes, section: 'service' },
            { attrs: asset.electricalAttributes, section: 'electrical_controls' },
          ]

          for (const group of attrGroups) {
            for (const attr of group.attrs) {
              if (!attr.value || attr.value === 'N/A' || attr.value === '--') continue
              try {
                const def = await resolveAttributeDefinition(
                  resolvedType.id, attr, group.section, existingDefs, sortCounter, batchId
                )
                if (def.isNew) {
                  result.newAttributeDefinitions.push({
                    id: def.id, name: def.name, assetTypeName: resolvedType.name,
                  })
                }
                defIdx++

                const isNumeric = inferDataType(attr.value) === 'number'
                const { error: valError } = await supabase
                  .from('asset_attribute_values')
                  .insert({
                    asset_id: createdAsset.id,
                    attribute_definition_id: def.id,
                    design_profile_id: coolingProfileId,
                    value_text: isNumeric ? null : attr.value,
                    value_numeric: isNumeric ? parseFloat(attr.value.replace(/,/g, '')) : null,
                    import_batch_id: batchId,
                  })

                if (valError) {
                  result.warnings.push(`Attr value "${attr.normalizedLabel}" for ${asset.equipmentName}: ${valError.message}`)
                } else {
                  result.attributeValuesCreated++
                }
              } catch (e) {
                result.warnings.push(`Attr def "${attr.normalizedLabel}": ${(e as Error).message}`)
              }
            }
          }
        }

        onProgress({ phase: 'preparing_definitions', phaseLabel: 'Preparing attribute definitions', current: defIdx, total: Math.max(totalDefs, defIdx) })

        result.records.push({
          sourceRow: asset.sourceRow,
          sourceSection: asset.sourceSection,
          equipmentName: asset.equipmentName,
          assetTag: asset.assetTag,
          decision: 'ready',
          result: asset.profileStatus.type === 'proposed_merge' ? 'merged_profile' : 'created',
          assetId: createdAsset.id,
          message: `Created successfully${resolvedType?.isNew ? ' (new type: ' + resolvedType.name + ')' : ''}`,
        })

        await insertImportRecords(result, {
          batch_id: batchId,
          source_row: asset.sourceRow,
          source_section: asset.sourceSection,
          source_asset_tag: asset.assetTag || null,
          normalized_equipment_name: asset.equipmentName,
          import_decision: 'ready',
          result: asset.profileStatus.type === 'proposed_merge' ? 'merged_profile' : 'created',
          asset_id: createdAsset.id,
          message: 'Created successfully',
          source_status: asset.sourceStatus || null,
        })
      } catch (e) {
        const errMsg = (e as Error).message
        result.failures.push({ asset: asset.equipmentName || asset.assetTag, error: errMsg })
        result.records.push({
          sourceRow: asset.sourceRow,
          sourceSection: asset.sourceSection,
          equipmentName: asset.equipmentName,
          assetTag: asset.assetTag,
          decision: 'ready',
          result: 'failed',
          assetId: null,
          message: errMsg,
        })

        await insertImportRecords(result, {
          batch_id: batchId,
          source_row: asset.sourceRow,
          source_section: asset.sourceSection,
          source_asset_tag: asset.assetTag || null,
          normalized_equipment_name: asset.equipmentName,
          import_decision: 'ready',
          result: 'failed',
          message: errMsg,
          source_status: asset.sourceStatus || null,
        })
      }

      assetIdx++
      onProgress({ phase: 'creating_assets', phaseLabel: 'Creating assets', current: assetIdx, total: assetProcessingOrder.length })
    }

    // Phase 4: Process heating profiles
    onProgress({ phase: 'creating_profiles', phaseLabel: 'Creating heating profiles', current: 0, total: heatingAssets.length })

    for (let hi = 0; hi < heatingAssets.length; hi++) {
      const heatingAsset = heatingAssets[hi]
      const physicalAssetId = createdAssetsByTag.get(heatingAsset.assetTag)

      if (!physicalAssetId) {
        result.warnings.push(`Heating profile for ${heatingAsset.assetTag}: no matching cooling asset found`)
        result.records.push({
          sourceRow: heatingAsset.sourceRow,
          sourceSection: heatingAsset.sourceSection,
          equipmentName: heatingAsset.equipmentName,
          assetTag: heatingAsset.assetTag,
          decision: 'ready',
          result: 'skipped',
          assetId: null,
          message: 'No matching physical asset for heating profile',
        })
        continue
      }

      const { data: heatingProfile, error: hpError } = await supabase
        .from('asset_design_profiles')
        .insert({
          asset_id: physicalAssetId,
          name: 'Heating Performance',
          source_section: heatingAsset.sourceSection,
          sort_order: 2,
          import_batch_id: batchId,
        })
        .select('id')
        .single()

      if (hpError) {
        result.warnings.push(`Heating profile for ${heatingAsset.assetTag}: ${hpError.message}`)
        continue
      }

      result.profilesCreated++
      result.profileMerges++

      const typeName = heatingAsset.selectedAssetType || heatingAsset.suggestedAssetType
      const resolvedType = typeName ? resolvedTypes.get(typeName) : null

      if (resolvedType) {
        const sortCounter = defSortCounters.get(resolvedType.id) || { value: 100 }
        defSortCounters.set(resolvedType.id, sortCounter)

        for (const attr of heatingAsset.technicalAttributes) {
          if (!attr.value || attr.value === 'N/A' || attr.value === '--') continue
          try {
            const def = await resolveAttributeDefinition(
              resolvedType.id, attr, 'technical', existingDefs, sortCounter, batchId
            )
            if (def.isNew) {
              result.newAttributeDefinitions.push({
                id: def.id, name: def.name, assetTypeName: resolvedType.name,
              })
            }
            const isNumeric = inferDataType(attr.value) === 'number'
            const { error: valError } = await supabase
              .from('asset_attribute_values')
              .insert({
                asset_id: physicalAssetId,
                attribute_definition_id: def.id,
                design_profile_id: heatingProfile.id,
                value_text: isNumeric ? null : attr.value,
                value_numeric: isNumeric ? parseFloat(attr.value.replace(/,/g, '')) : null,
                import_batch_id: batchId,
              })

            if (!valError) result.attributeValuesCreated++
          } catch {
            // Definition already exists from cooling side
          }
        }
      }

      result.records.push({
        sourceRow: heatingAsset.sourceRow,
        sourceSection: heatingAsset.sourceSection,
        equipmentName: heatingAsset.equipmentName,
        assetTag: heatingAsset.assetTag,
        decision: 'profile_merge',
        result: 'merged_profile',
        assetId: physicalAssetId,
        message: 'Heating profile merged into existing asset',
      })

      await insertImportRecords(result, {
        batch_id: batchId,
        source_row: heatingAsset.sourceRow,
        source_section: heatingAsset.sourceSection,
        source_asset_tag: heatingAsset.assetTag,
        normalized_equipment_name: heatingAsset.equipmentName,
        import_decision: 'profile_merge',
        result: 'merged_profile',
        asset_id: physicalAssetId,
        message: 'Heating profile merged',
        source_status: heatingAsset.sourceStatus || null,
      })

      onProgress({ phase: 'creating_profiles', phaseLabel: 'Creating heating profiles', current: hi + 1, total: heatingAssets.length })
    }

    // Phase 5: Relationships (second pass)
    onProgress({ phase: 'creating_relationships', phaseLabel: 'Creating relationships', current: 0, total: 0 })

    const confidentRels = importableAssets.flatMap(a =>
      a.relationshipCandidates
        .filter(r => r.confidence === 'confident' && r.possibleReferencedAsset)
        .map(r => ({ sourceTag: a.assetTag, targetTag: r.possibleReferencedAsset!, sourceField: r.sourceHeader }))
    )

    let relIdx = 0
    for (const rel of confidentRels) {
      const sourceId = createdAssetsByTag.get(rel.sourceTag)
      const targetId = createdAssetsByTag.get(rel.targetTag)

      if (sourceId && targetId && sourceId !== targetId) {
        const { error: relError } = await supabase
          .from('asset_relationships')
          .insert({
            source_asset_id: sourceId,
            target_asset_id: targetId,
            relationship_type: 'related',
            source_field: rel.sourceField,
            is_confirmed: false,
            import_batch_id: batchId,
          })

        if (!relError) {
          result.relationshipsCreated++
        }
      }
      relIdx++
      onProgress({ phase: 'creating_relationships', phaseLabel: 'Creating relationships', current: relIdx, total: confidentRels.length })
    }

    // Log non-imported records
    for (const asset of assets) {
      const decision = decisions.get(asset.id) || classifyImportDecision(asset)
      if (decision === 'ready') continue
      if (result.records.find(r => r.sourceRow === asset.sourceRow)) continue

      result.records.push({
        sourceRow: asset.sourceRow,
        sourceSection: asset.sourceSection,
        equipmentName: asset.equipmentName,
        assetTag: asset.assetTag,
        decision,
        result: decision === 'exclude' ? 'skipped' : 'review',
        assetId: null,
        message: decision === 'exclude' ? 'Excluded' : 'Needs review',
      })

      await insertImportRecords(result, {
        batch_id: batchId,
        source_row: asset.sourceRow,
        source_section: asset.sourceSection,
        source_asset_tag: asset.assetTag || null,
        normalized_equipment_name: asset.equipmentName,
        import_decision: decision,
        result: decision === 'exclude' ? 'skipped' : 'review',
        message: decision === 'exclude' ? 'Excluded' : 'Needs review',
        source_status: asset.sourceStatus || null,
      })
    }

    // Phase 6: Finalize (documents handled by executeDocumentImport)
    onProgress({ phase: 'finalizing', phaseLabel: 'Finalizing', current: 0, total: 1 })

    await supabase
      .from('asset_import_batches')
      .update({
        status: result.failures.length > 0 && result.assetsCreated === 0 ? 'failed' : 'completed',
        completed_at: new Date().toISOString(),
        assets_created: result.assetsCreated,
        profiles_created: result.profilesCreated,
        attribute_values_created: result.attributeValuesCreated,
        relationships_created: result.relationshipsCreated,
        service_parts_created: result.servicePartsCreated,
        documents_created: result.documentsCreated,
        document_links_created: result.documentLinksCreated,
        warnings_count: result.warnings.length,
        errors_count: result.failures.length,
      })
      .eq('id', batchId)

    onProgress({ phase: 'finalizing', phaseLabel: 'Finalizing', current: 1, total: 1 })

    return result
  } catch (e) {
    await supabase
      .from('asset_import_batches')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        assets_created: result.assetsCreated,
        errors_count: result.failures.length + 1,
      })
      .eq('id', batchId)

    throw e
  }
}

/* ── XLSX workbook import ── */

export async function executeWorkbookImport(
  facilityId: string,
  organizationId: string,
  userId: string,
  assets: NormalizedAsset[],
  actions: Map<string, ImportAction>,
  documents: WorkbookDocument[],
  sourceBuffer: ArrayBuffer,
  sourceFilename: string,
  onProgress: (p: ImportProgress) => void,
): Promise<ImportResult> {
  const fingerprint = await computeFingerprintFromBuffer(sourceBuffer)
  const dupCheck = await checkDuplicateImport(facilityId, fingerprint)
  if (dupCheck.isDuplicate) {
    throw new Error(`This source file has previously been imported (batch: ${dupCheck.existingBatch!.source_filename})`)
  }

  const selectedAssets = assets.filter(a => (actions.get(a.id) || 'add') !== 'hold')
  const { data: batchData, error: batchError } = await supabase
    .from('asset_import_batches')
    .insert({
      facility_id: facilityId,
      source_filename: sourceFilename,
      source_fingerprint: fingerprint,
      source_type: 'xlsx',
      status: 'in_progress',
      started_by: userId,
      started_at: new Date().toISOString(),
      records_analyzed: assets.length,
      records_selected: selectedAssets.length,
    })
    .select('id')
    .single()

  if (batchError) throw new Error(`Failed to create import batch: ${batchError.message}`)
  const batchId = batchData.id

  const result: ImportResult = {
    batchId,
    assetsCreated: 0,
    assetsSkipped: 0,
    profileMerges: 0,
    profilesCreated: 0,
    attributeValuesCreated: 0,
    servicePartsCreated: 0,
    relationshipsCreated: 0,
    documentsCreated: 0,
    documentLinksCreated: 0,
    warnings: [],
    failures: [],
    records: [],
    newAssetTypes: [],
    newAttributeDefinitions: [],
  }

  try {
    onProgress({ phase: 'preparing_types', phaseLabel: 'Preparing asset types', current: 0, total: 0 })

    const { data: existingTypeRows } = await supabase
      .from('asset_types')
      .select('id, name')
      .eq('organization_id', organizationId)

    const existingTypes = new Map<string, { id: string; name: string }>()
    for (const t of existingTypeRows || []) existingTypes.set(t.name.toLowerCase(), { id: t.id, name: t.name })

    const resolvedTypes = new Map<string, ResolvedType>()
    const typeNames = new Set(selectedAssets.map(a => a.selectedAssetType || a.suggestedAssetType).filter((v): v is string => !!v))
    let typeIndex = 0
    for (const typeName of typeNames) {
      const resolved = await resolveAssetType(organizationId, typeName, existingTypes, batchId)
      resolvedTypes.set(typeName, resolved)
      if (resolved.isNew) result.newAssetTypes.push({ id: resolved.id, name: resolved.name })
      typeIndex++
      onProgress({ phase: 'preparing_types', phaseLabel: 'Preparing asset types', current: typeIndex, total: typeNames.size })
    }

    const existingDefRows = await loadAttributeDefinitions()
    const existingDefs = new Map<string, { id: string; name: string }>()
    for (const d of existingDefRows) existingDefs.set(`${d.asset_type_id}:${d.name}`, { id: d.id, name: d.name })
    const defSortCounters = new Map<string, { value: number }>()

    const lookupTags = Array.from(new Set(selectedAssets
      .filter(a => ['update','existing'].includes(actions.get(a.id) || 'add'))
      .map(a => a.assetTag).filter(Boolean)))

    const existingByTag = new Map<string, { id: string; manufacturer: string | null; model: string | null; serial_number: string | null }[]>()
    if (lookupTags.length > 0) {
      let existingAssets: { id: string; asset_tag: string | null; manufacturer: string | null; model: string | null; serial_number: string | null }[]
      try {
        existingAssets = await fetchAllInChunks(lookupTags, chunk =>
          fetchAllPages<{ id: string; asset_tag: string | null; manufacturer: string | null; model: string | null; serial_number: string | null }>((from, to) =>
            supabase
              .from('assets')
              .select('id, asset_tag, manufacturer, model, serial_number')
              .eq('facility_id', facilityId)
              .is('deleted_at', null)
              .in('asset_tag', chunk)
              .order('id', { ascending: true })
              .range(from, to),
          ),
        )
      } catch (lookupError) {
        throw new Error(`Failed to resolve existing assets: ${(lookupError as Error).message}`)
      }
      for (const row of existingAssets) {
        const tag = row.asset_tag || ''
        const list = existingByTag.get(tag) || []
        list.push({ id: row.id, manufacturer: row.manufacturer, model: row.model, serial_number: row.serial_number })
        existingByTag.set(tag, list)
      }
    }

    const resolvedAssetsByTag = new Map<string, string>()
    const heldRecords: Record<string, unknown>[] = []
    const activeAssets = assets.filter(a => (actions.get(a.id) || 'add') !== 'hold')
    const heldAssets = assets.filter(a => (actions.get(a.id) || 'add') === 'hold')

    for (const asset of heldAssets) {
      result.assetsSkipped++
      result.records.push({
        sourceRow: asset.sourceRow, sourceSection: asset.sourceSection, equipmentName: asset.equipmentName,
        assetTag: asset.assetTag, decision: 'exclude', result: 'skipped', assetId: null, message: 'Held by workbook import action',
      })
      heldRecords.push({
        batch_id: batchId, source_row: asset.sourceRow, source_section: asset.sourceSection,
        source_asset_tag: asset.assetTag || null, normalized_equipment_name: asset.equipmentName,
        import_decision: 'hold', result: 'skipped', entity_type: 'asset', message: 'Held by workbook import action',
        source_status: asset.sourceStatus || null,
      })
    }
    if (heldRecords.length > 0) {
      await insertImportRecords(result, heldRecords)
    }

    onProgress({ phase: 'creating_assets', phaseLabel: 'Importing assets', current: 0, total: activeAssets.length })

    for (let i = 0; i < activeAssets.length; i++) {
      const asset = activeAssets[i]
      const action = actions.get(asset.id) || 'add'

      try {
        const typeName = asset.selectedAssetType || asset.suggestedAssetType
        const resolvedType = typeName ? resolvedTypes.get(typeName) : null
        let targetAssetId: string
        let recordResult: 'created' | 'updated' | 'linked'
        let recordMessage: string

        if (action === 'update' || action === 'existing') {
          if (!asset.assetTag) throw new Error(`${action} requires an Asset ID/asset tag`)
          const matches = existingByTag.get(asset.assetTag) || []
          if (matches.length === 0) throw new Error(`No existing asset found for Asset ID "${asset.assetTag}"`)
          if (matches.length > 1) throw new Error(`Multiple existing assets match Asset ID "${asset.assetTag}"; manual review required`)
          const matchedAsset = matches[0]
          targetAssetId = matchedAsset.id

          if (action === 'update') {
            const corroboratingPairs = [
              [asset.serialNumber, matchedAsset.serial_number],
              [asset.model, matchedAsset.model],
              [asset.manufacturer, matchedAsset.manufacturer],
            ].filter(([incoming]) => !!incoming)
            if (corroboratingPairs.length === 0) {
              throw new Error(`Update for "${asset.assetTag}" requires manual review because no make, model, or serial value is available to corroborate the match`)
            }
            const corroborated = corroboratingPairs.some(([incoming, existing]) =>
              String(incoming || '').trim().toLowerCase() === String(existing || '').trim().toLowerCase()
            )
            if (!corroborated) {
              throw new Error(`Update for "${asset.assetTag}" was not applied because make/model/serial did not corroborate the existing asset`)
            }

            const updateRow: Record<string, unknown> = {
              source_section: asset.sourceSection,
              source_row: asset.sourceRow,
            }
            if (asset.equipmentName) updateRow.equipment_name = asset.equipmentName
            if (resolvedType) { updateRow.asset_type_id = resolvedType.id; updateRow.equipment_type = typeName }
            if (asset.areaServed) updateRow.area_served = asset.areaServed
            if (asset.level) updateRow.design_stage = asset.level
            if (asset.manufacturer) updateRow.manufacturer = asset.manufacturer
            if (asset.model) updateRow.model = asset.model
            if (asset.serialNumber) updateRow.serial_number = asset.serialNumber
            if (asset.drawingReference) updateRow.drawing_reference = asset.drawingReference
            if (asset.specificationSection) updateRow.spec_section = asset.specificationSection

            const { error: updateError } = await supabase.rpc('import_update_asset', {
              p_batch_id: batchId, p_asset_id: targetAssetId, p_changes: updateRow,
            })
            if (updateError) throw new Error(updateError.message)
            recordResult = 'updated'
            recordMessage = 'Updated existing asset'
          } else {
            recordResult = 'linked'
            recordMessage = 'Resolved existing asset; no asset fields changed'
          }
        } else {
          const { data: createdAsset, error: assetError } = await supabase
            .from('assets')
            .insert({
              facility_id: facilityId,
              equipment_name: asset.equipmentName || asset.assetTag || 'Imported Asset',
              asset_tag: asset.assetTag || null,
              asset_type_id: resolvedType?.id || null,
              equipment_type: typeName || null,
              status: 'not_started',
              area_served: asset.areaServed || null,
              design_stage: asset.level || null,
              source_section: asset.sourceSection,
              source_row: asset.sourceRow,
              manufacturer: asset.manufacturer || null,
              model: asset.model || null,
              serial_number: asset.serialNumber || null,
              drawing_reference: asset.drawingReference || null,
              spec_section: asset.specificationSection || null,
              notes: asset.notes || null,
              import_batch_id: batchId,
            })
            .select('id')
            .single()
          if (assetError) throw new Error(assetError.message)
          targetAssetId = createdAsset.id
          result.assetsCreated++
          recordResult = 'created'
          recordMessage = 'Created successfully'
        }

        if (asset.assetTag) resolvedAssetsByTag.set(asset.assetTag, targetAssetId)

        if (action !== 'existing' && resolvedType) {
          const sortCounter = defSortCounters.get(resolvedType.id) || { value: 1 }
          defSortCounters.set(resolvedType.id, sortCounter)
          const groups: { attrs: NormalizedAttribute[]; section: 'technical' | 'service' | 'electrical_controls' }[] = [
            { attrs: asset.technicalAttributes, section: 'technical' },
            { attrs: asset.serviceAttributes, section: 'service' },
            { attrs: asset.electricalAttributes, section: 'electrical_controls' },
          ]

          const resolvedAttrs: { def: ResolvedDefinition; attr: NormalizedAttribute }[] = []
          for (const group of groups) {
            for (const attr of group.attrs) {
              if (!attr.value || attr.value === 'N/A' || attr.value === '--') continue
              const def = await resolveAttributeDefinition(resolvedType.id, attr, group.section, existingDefs, sortCounter, batchId)
              if (def.isNew) result.newAttributeDefinitions.push({ id: def.id, name: def.name, assetTypeName: resolvedType.name })
              resolvedAttrs.push({ def, attr })
            }
          }

          if (resolvedAttrs.length > 0) {
            const values = resolvedAttrs.map(({ def, attr }) => {
              const isNumeric = inferDataType(attr.value) === 'number'
              return {
                attribute_definition_id: def.id,
                value_text: isNumeric ? null : attr.value,
                value_numeric: isNumeric ? parseFloat(attr.value.replace(/,/g, '')) : null,
              }
            })
            const { data: upsertResult, error: upsertError } = await supabase.rpc('import_upsert_attribute_values', {
              p_batch_id: batchId, p_asset_id: targetAssetId, p_values: values,
            })
            if (upsertError) {
              result.warnings.push(`Technical values on ${asset.assetTag || asset.equipmentName} were not saved: ${upsertError.message}`)
            } else {
              const counts = upsertResult as { inserted?: number; updated?: number } | null
              result.attributeValuesCreated += (counts?.inserted ?? 0) + (counts?.updated ?? 0)
            }
          }
        }

        const decision: ImportDecision = 'ready'
        result.records.push({
          sourceRow: asset.sourceRow, sourceSection: asset.sourceSection, equipmentName: asset.equipmentName,
          assetTag: asset.assetTag, decision, result: recordResult, assetId: targetAssetId, message: recordMessage,
        })
        await insertImportRecords(result, [{
          batch_id: batchId, source_row: asset.sourceRow, source_section: asset.sourceSection,
          source_asset_tag: asset.assetTag || null, normalized_equipment_name: asset.equipmentName,
          import_decision: action, result: recordResult, entity_type: 'asset', asset_id: targetAssetId,
          message: recordMessage, source_status: asset.sourceStatus || null,
        }])
      } catch (e) {
        const message = (e as Error).message
        result.failures.push({ asset: asset.equipmentName || asset.assetTag, error: message })
        result.records.push({
          sourceRow: asset.sourceRow, sourceSection: asset.sourceSection, equipmentName: asset.equipmentName,
          assetTag: asset.assetTag, decision: 'review', result: 'failed', assetId: null, message,
        })
        await insertImportRecords(result, [{
          batch_id: batchId, source_row: asset.sourceRow, source_section: asset.sourceSection,
          source_asset_tag: asset.assetTag || null, normalized_equipment_name: asset.equipmentName,
          import_decision: action, result: 'failed', entity_type: 'asset', message,
          source_status: asset.sourceStatus || null,
        }])
      }

      onProgress({ phase: 'creating_assets', phaseLabel: 'Importing assets', current: i + 1, total: activeAssets.length })
    }

    await executeDocumentImport(facilityId, batchId, documents, resolvedAssetsByTag, result, onProgress)

    const { error: finalizeError } = await supabase.from('asset_import_batches').update({
      status: result.failures.length > 0 && result.assetsCreated === 0 && resolvedAssetsByTag.size === 0 ? 'failed' : 'completed',
      completed_at: new Date().toISOString(),
      assets_created: result.assetsCreated,
      attribute_values_created: result.attributeValuesCreated,
      documents_created: result.documentsCreated,
      document_links_created: result.documentLinksCreated,
      warnings_count: result.warnings.length,
      errors_count: result.failures.length,
    }).eq('id', batchId)
    if (finalizeError) result.warnings.push(`The import finished but its summary could not be saved: ${finalizeError.message}`)

    onProgress({ phase: 'finalizing', phaseLabel: 'Finalizing', current: 1, total: 1 })
    return result
  } catch (e) {
    await supabase.from('asset_import_batches').update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      assets_created: result.assetsCreated,
      documents_created: result.documentsCreated,
      document_links_created: result.documentLinksCreated,
      errors_count: result.failures.length + 1,
    }).eq('id', batchId)
    throw e
  }
}

/* ── Document import phase ── */

export async function executeDocumentImport(
  facilityId: string,
  batchId: string,
  documents: WorkbookDocument[],
  resolvedAssetsByTag: Map<string, string>,
  result: ImportResult,
  onProgress: (p: ImportProgress) => void,
): Promise<void> {
  const uniqueDocs = documents.filter(d => !d.isDuplicate)
  if (uniqueDocs.length === 0) return

  onProgress({ phase: 'creating_documents', phaseLabel: 'Creating documents', current: 0, total: uniqueDocs.length })
  const docsByKey = new Map<string, string>()

  for (let i = 0; i < uniqueDocs.length; i++) {
    const doc = uniqueDocs[i]
    try {
      const { data: existing, error: existingError } = await supabase
        .from('documents')
        .select('id')
        .eq('facility_id', facilityId)
        .eq('source_document_key', doc.key)
        .is('deleted_at', null)
        .maybeSingle()
      if (existingError) throw existingError

      if (existing) {
        docsByKey.set(doc.key, existing.id)
      } else {
        const { data, error } = await supabase
          .from('documents')
          .insert({
            facility_id: facilityId,
            name: doc.name,
            category: doc.category,
            document_type: doc.documentType,
            discipline: doc.discipline,
            revision: doc.revision,
            external_url: doc.externalUrl,
            storage_provider: doc.externalUrl ? 'external' : 'pending',
            source_sheet: doc.sourceSheet,
            source_row: doc.sourceRow,
            source_document_key: doc.key,
            import_batch_id: batchId,
          })
          .select('id')
          .single()
        if (error) throw error

        docsByKey.set(doc.key, data.id)
        result.documentsCreated++
        await insertImportRecords(result, {
          batch_id: batchId,
          source_row: doc.sourceRow,
          source_section: doc.sourceSheet,
          normalized_equipment_name: doc.name,
          import_decision: 'ready',
          result: 'created',
          entity_type: 'document',
          document_id: data.id,
          message: `Document created (${doc.category})`,
        })
      }
    } catch (e) {
      result.warnings.push(`Document "${doc.name}": ${(e as Error).message}`)
    }
    onProgress({ phase: 'creating_documents', phaseLabel: 'Creating documents', current: i + 1, total: uniqueDocs.length })
  }

  const links: { docKey: string; assetTag: string; sourceRow: number; sourceSheet: string; docName: string }[] = []
  for (const doc of uniqueDocs) {
    for (const tag of doc.linkedAssetTags) {
      links.push({ docKey: doc.key, assetTag: tag, sourceRow: doc.sourceRow, sourceSheet: doc.sourceSheet, docName: doc.name })
    }
  }

  if (links.length === 0) return
  onProgress({ phase: 'linking_documents', phaseLabel: 'Linking documents to assets', current: 0, total: links.length })

  const LINK_BATCH_SIZE = 50
  for (let batchStart = 0; batchStart < links.length; batchStart += LINK_BATCH_SIZE) {
    const batch = links.slice(batchStart, batchStart + LINK_BATCH_SIZE)
    const validLinks: { document_id: string; asset_id: string; import_batch_id: string }[] = []
    const linkMeta: { sourceRow: number; sourceSheet: string; assetTag: string; docName: string; documentId: string; assetId: string }[] = []

    for (const link of batch) {
      const documentId = docsByKey.get(link.docKey)
      const assetId = resolvedAssetsByTag.get(link.assetTag)

      if (!documentId) {
        result.warnings.push(`Cannot link "${link.docName}" to ${link.assetTag}: document was not resolved`)
      } else if (!assetId) {
        result.warnings.push(`Cannot link "${link.docName}" to ${link.assetTag}: asset was not imported/resolved`)
      } else {
        validLinks.push({ document_id: documentId, asset_id: assetId, import_batch_id: batchId })
        linkMeta.push({ sourceRow: link.sourceRow, sourceSheet: link.sourceSheet, assetTag: link.assetTag, docName: link.docName, documentId, assetId })
      }
    }

    if (validLinks.length > 0) {
      const { error } = await supabase.from('document_asset_links').insert(validLinks)
      if (!error) {
        result.documentLinksCreated += validLinks.length
        const records = linkMeta.map(m => ({
          batch_id: batchId,
          source_row: m.sourceRow,
          source_section: m.sourceSheet,
          source_asset_tag: m.assetTag,
          normalized_equipment_name: m.docName,
          import_decision: 'ready' as const,
          result: 'linked' as const,
          entity_type: 'document_asset_link' as const,
          document_id: m.documentId,
          asset_id: m.assetId,
          message: 'Document linked to asset',
        }))
        await insertImportRecords(result, records)
      } else if (error.code === '23505') {
        for (const vl of validLinks) {
          const { error: singleErr } = await supabase.from('document_asset_links').insert(vl)
          if (!singleErr) result.documentLinksCreated++
          else if (singleErr.code !== '23505') {
            const meta = linkMeta.find(m => m.documentId === vl.document_id && m.assetId === vl.asset_id)
            result.warnings.push(`Link "${meta?.docName}" -> ${meta?.assetTag}: ${singleErr.message}`)
          }
        }
      } else {
        result.warnings.push(`Batch document link insert failed: ${error.message}`)
      }
    }

    onProgress({ phase: 'linking_documents', phaseLabel: 'Linking documents to assets', current: Math.min(batchStart + LINK_BATCH_SIZE, links.length), total: links.length })
  }
}

/* ── Rollback ── */

export interface RollbackResult {
  status: 'completed' | 'blocked' | 'failed' | 'already_rolled_back'
  reasons: string[]
  assetsDeleted: number
  profilesDeleted: number
  valuesDeleted: number
  relationshipsDeleted: number
  documentsDeleted: number
  documentLinksDeleted: number
  assetsRestored: number
  valuesRestored: number
  valuesRemoved: number
  preexistingAssetsKept: number
  orphanedTypes: { id: string; name: string }[]
  orphanedDefinitions: { id: string; name: string; assetTypeName: string }[]
}

export async function rollbackImportBatch(batchId: string): Promise<RollbackResult> {
  const { data, error } = await supabase.rpc('rollback_import_batch', { p_batch_id: batchId })
  if (error) throw new Error(error.message)
  if (!data || typeof data !== 'object' || typeof (data as { status?: unknown }).status !== 'string') {
    throw new Error('The rollback returned an unexpected response; check the import history before retrying')
  }
  const d = data as Record<string, unknown>
  const num = (k: string) => (typeof d[k] === 'number' ? (d[k] as number) : 0)
  return {
    status: d.status as RollbackResult['status'],
    reasons: Array.isArray(d.reasons) ? (d.reasons as string[]) : [],
    assetsDeleted: num('assetsDeleted'),
    profilesDeleted: num('profilesDeleted'),
    valuesDeleted: num('valuesDeleted'),
    relationshipsDeleted: num('relationshipsDeleted'),
    documentsDeleted: num('documentsDeleted'),
    documentLinksDeleted: num('documentLinksDeleted'),
    assetsRestored: num('assetsRestored'),
    valuesRestored: num('valuesRestored'),
    valuesRemoved: num('valuesRemoved'),
    preexistingAssetsKept: num('preexistingAssetsKept'),
    orphanedTypes: Array.isArray(d.orphanedTypes) ? (d.orphanedTypes as RollbackResult['orphanedTypes']) : [],
    orphanedDefinitions: Array.isArray(d.orphanedDefinitions) ? (d.orphanedDefinitions as RollbackResult['orphanedDefinitions']) : [],
  }
}

/* ── Test batch selection ── */

export function selectTestBatch(assets: NormalizedAsset[]): NormalizedAsset[] {
  const selected: NormalizedAsset[] = []
  const usedIds = new Set<string>()

  function pick(predicate: (a: NormalizedAsset) => boolean, count: number, _label: string) {
    const candidates = assets.filter(a => predicate(a) && !usedIds.has(a.id))
    const picked = candidates.slice(0, count)
    for (const p of picked) {
      usedIds.add(p.id)
      selected.push(p)
    }
    if (picked.length < count) {
      // Don't warn, just pick what's available
    }
  }

  // Normal tagged AHUs (2)
  pick(a => a.sourceSection === 'AIR HANDLING UNITS' && !!a.assetTag, 2, 'AHU')

  // Fans (2)
  pick(a => a.sourceSection === 'FANS' && !!a.assetTag, 2, 'Fan')

  // Pumps (2)
  pick(a => a.sourceSection === 'PUMPS' && !!a.assetTag, 2, 'Pump')

  // Chiller (1)
  pick(a => a.sourceSection === 'CHILLERS' && !!a.assetTag, 1, 'Chiller')

  // Boiler (1)
  pick(a => a.sourceSection === 'BOILER PLANT' && !!a.assetTag, 1, 'Boiler')

  // FCU (2)
  pick(a => a.sourceSection === 'FAN COIL UNITS' && !!a.assetTag, 2, 'FCU')

  // VAV (2)
  pick(a => a.sourceSection === 'VAV/CAV BOXES' && !!a.assetTag, 2, 'VAV')

  // Asset with many technical attributes (heat exchanger or similar)
  pick(a => a.technicalAttributes.length >= 5 && !!a.assetTag, 1, 'Many tech attrs')

  // Asset with electrical attributes
  pick(a => a.electricalAttributes.length >= 2 && !!a.assetTag, 1, 'Electrical attrs')

  // Asset with service/filter info
  pick(a => a.serviceAttributes.length >= 1 && !!a.assetTag, 1, 'Service attrs')

  // Untagged asset
  pick(a => a.isUntagged, 1, 'Untagged')

  // HC-CC profile pair (cooling side — the heating will be included automatically)
  pick(a =>
    a.profileStatus.type === 'proposed_merge' &&
    a.profileStatus.profileName === 'Cooling Performance',
    2, 'Profile pair')

  // Get the heating counterparts
  const coolingPairTags = selected
    .filter(a => a.profileStatus.type === 'proposed_merge' && a.profileStatus.profileName === 'Cooling Performance')
    .map(a => a.assetTag)

  for (const tag of coolingPairTags) {
    const heatingAsset = assets.find(a =>
      a.assetTag === tag &&
      a.profileStatus.type === 'proposed_merge' &&
      a.profileStatus.profileName === 'Heating Performance' &&
      !usedIds.has(a.id)
    )
    if (heatingAsset) {
      usedIds.add(heatingAsset.id)
      selected.push(heatingAsset)
    }
  }

  // TYPE NF1 repeated designation (2)
  pick(a => a.assetTag === 'TYPE NF1', 2, 'TYPE NF1 duplicate')

  // Asset with relationship candidate
  pick(a => a.relationshipCandidates.some(r => r.confidence === 'confident') && !!a.assetTag, 1, 'Relationship')

  // Asset without relationship
  pick(a => a.relationshipCandidates.length === 0 && !!a.assetTag && !a.isUntagged, 1, 'No relationship')

  // Asset with no system mapping (most don't have one)
  pick(a => !!a.assetTag && a.sourceSection !== 'AIR HANDLING UNITS', 1, 'No system')

  // A REVIEW record (Medical Gas subsystem label if present)
  const reviewAsset = assets.find(a =>
    MEDICAL_GAS_REVIEW_NAMES.has(a.equipmentName.toUpperCase()) && !usedIds.has(a.id)
  )
  if (reviewAsset) {
    usedIds.add(reviewAsset.id)
    selected.push(reviewAsset)
  }

  return selected
}
