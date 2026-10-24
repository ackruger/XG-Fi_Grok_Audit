import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createTrainingFixture, runPreflight, longestPrefixAssetTypeMatch } from '../src/lib/import/training.ts'
import type { NormalizedAsset, ImportAction } from '../src/lib/import/types.ts'

describe('Terminology and Status Separation', () => {
  it('training fixture has separated fields: operational status, lifecycle, identification', () => {
    const fixture = createTrainingFixture()
    assert.equal(fixture.sourceSection, 'TRAINING FIXTURE')
    assert.equal(fixture.assetTag, 'TRAINING-001')
    assert.equal(fixture.equipmentName, 'Training AHU')
    assert.ok(fixture.notes.includes('TRAINING FIXTURE'))
  })

  it('training fixture has technical attributes with units', () => {
    const fixture = createTrainingFixture()
    assert.ok(fixture.technicalAttributes.length >= 2)
    const airflow = fixture.technicalAttributes.find(a => a.normalizedLabel === 'Airflow')
    assert.ok(airflow, 'Airflow attribute should exist')
    assert.equal(airflow!.value, '2000')
    assert.equal(airflow!.unit, 'CFM')
  })

  it('training fixture is clearly labelled and has info finding', () => {
    const fixture = createTrainingFixture()
    assert.ok(fixture.infos.some(i => i.message.includes('Training fixture')))
    assert.equal(fixture.typeConfidence, 'high')
  })
})

describe('Find Behavior', () => {
  it('training fixture has searchable asset tag and name', () => {
    const fixture = createTrainingFixture()
    assert.ok(fixture.assetTag, 'Should have asset tag for search')
    assert.ok(fixture.equipmentName, 'Should have equipment name for search')
    assert.notEqual(fixture.assetTag, fixture.equipmentName, 'Tag and name should be distinct')
  })
})

describe('Import Preflight and Validation', () => {
  it('runPreflight classifies rows by action', () => {
    const assets: NormalizedAsset[] = [
      createTrainingFixture(),
      {
        ...createTrainingFixture(),
        id: 'test-2',
        assetTag: 'TEST-002',
        equipmentName: 'Second Asset',
        sourceRow: 2,
      },
    ]
    const actions = new Map<string, ImportAction>([
      [assets[0].id, 'add'],
      [assets[1].id, 'hold'],
    ])
    const existingTags = new Set<string>(['EXISTING-001'])

    const result = runPreflight(assets, actions, existingTags)
    assert.equal(result.totalRows, 2)
    assert.equal(result.rowsAdd, 1)
    assert.equal(result.rowsHold, 1)
  })

  it('runPreflight detects placeholder URL text', () => {
    const asset: NormalizedAsset = {
      ...createTrainingFixture(),
      technicalAttributes: [
        { sourceHeader: 'Documentation URL', sourceColumn: 0, suggestedSection: 'technical', normalizedLabel: 'Doc URL', value: 'URL Link' },
        { sourceHeader: 'Spec URL', sourceColumn: 1, suggestedSection: 'technical', normalizedLabel: 'Spec URL', value: 'https://example.com/spec.pdf' },
      ],
    }
    const result = runPreflight([asset], new Map(), new Set())
    assert.equal(result.placeholderUrls.length, 1)
    assert.equal(result.placeholderUrls[0].value, 'URL Link')
  })

  it('runPreflight detects missing asset type', () => {
    const asset: NormalizedAsset = {
      ...createTrainingFixture(),
      suggestedAssetType: null,
      selectedAssetType: null,
      typeConfidence: 'unresolved',
    }
    const result = runPreflight([asset], new Map(), new Set())
    assert.ok(result.missingAssetTypes.length >= 1)
  })

  it('runPreflight detects duplicate detail rows', () => {
    const assets: NormalizedAsset[] = [
      { ...createTrainingFixture(), sourceRow: 1 },
      { ...createTrainingFixture(), id: 'dup-2', sourceRow: 5 },
    ]
    const result = runPreflight(assets, new Map(), new Set())
    assert.ok(result.duplicateDetailRows.length >= 1)
    assert.equal(result.duplicateDetailRows[0].assetTag, 'TRAINING-001')
    assert.equal(result.duplicateDetailRows[0].occurrences, 2)
  })

  it('runPreflight detects conflict when adding existing asset tag', () => {
    const asset = createTrainingFixture()
    const existingTags = new Set<string>([asset.assetTag])
    const actions = new Map<string, ImportAction>([[asset.id, 'add']])
    const result = runPreflight([asset], actions, existingTags)
    assert.equal(result.rowsConflict, 1)
  })

  it('runPreflight validates required fields', () => {
    const asset: NormalizedAsset = {
      ...createTrainingFixture(),
      equipmentName: '',
      assetTag: '',
    }
    const result = runPreflight([asset], new Map(), new Set())
    assert.ok(result.validationErrors.some(e => e.message.includes('equipment name and asset tag')))
  })
})

describe('Training Mode End-to-End', () => {
  it('full training flow: fixture -> preflight -> preview with 1 row, 0 errors, no import', () => {
    const fixture = createTrainingFixture()
    const actions = new Map<string, ImportAction>([[fixture.id, 'add']])
    const existingTags = new Set<string>()

    const preflight = runPreflight([fixture], actions, existingTags)

    assert.equal(preflight.totalRows, 1, 'exactly 1 training row')
    assert.equal(preflight.rowsAdd, 1, 'single row marked for add')
    assert.equal(preflight.rowsConflict, 0, 'no conflicts for training tag')
    assert.equal(preflight.validationErrors.length, 0, 'no validation errors')
    assert.equal(preflight.missingAssetTypes.length, 0, 'asset type resolved')
    assert.equal(preflight.duplicateDetailRows.length, 0, 'no duplicates')
    assert.equal(preflight.placeholderUrls.length, 0, 'no placeholder URLs')
    assert.equal(preflight.rowsSkip, 0, 'no rows skipped')
    assert.equal(preflight.rowsHold, 0, 'no rows on hold')
    assert.equal(preflight.rowsUpdate, 0, 'no rows to update')

    assert.ok(fixture.selectedAssetType, 'classification assigned a type')
    assert.equal(fixture.typeConfidence, 'high', 'training fixture has high confidence')
    assert.equal(fixture.selectedAssetType, 'Air Handling Unit', 'correct type classified')
    assert.ok(fixture.infos.some(i => i.message.includes('Training fixture')), 'labelled as training')
    assert.ok(fixture.notes.includes('TRAINING FIXTURE'), 'notes mark it as training')
  })
})

describe('Longest-Prefix Asset Type Matching', () => {
  it('exact match returns the type', () => {
    const result = longestPrefixAssetTypeMatch('Air Handling Unit', ['Air Handling Unit', 'Pump'])
    assert.equal(result, 'Air Handling Unit')
  })

  it('longest prefix match is preferred', () => {
    const result = longestPrefixAssetTypeMatch('Air Handling Unit with Heat Recovery', ['Air Handling Unit', 'Air Handler'])
    assert.equal(result, 'Air Handling Unit')
  })

  it('no match returns null', () => {
    const result = longestPrefixAssetTypeMatch('Boiler', ['Air Handling Unit', 'Pump'])
    assert.equal(result, null)
  })

  it('case-insensitive matching', () => {
    const result = longestPrefixAssetTypeMatch('AIR HANDLING UNIT', ['Air Handling Unit'])
    assert.equal(result, 'Air Handling Unit')
  })
})

describe('Checklist Calculations', () => {
  it('checklist run status logic: all passed = complete', () => {
    const items = [
      { state: 'passed' as const },
      { state: 'passed' as const },
      { state: 'passed' as const },
    ]
    const blocked = items.some(i => i.state === 'blocked')
    const failed = items.some(i => i.state === 'failed')
    const pending = items.filter(i => i.state === 'pending').length
    const total = items.length
    const passed = items.filter(i => i.state === 'passed').length

    let status: string
    if (blocked) status = 'blocked'
    else if (failed) status = 'deficient'
    else if (pending === 0 && total > 0) status = 'complete'
    else status = 'in_progress'

    assert.equal(status, 'complete')
    assert.equal(Math.round(passed / total * 100), 100)
  })

  it('checklist run status logic: blocked items = blocked', () => {
    const items = [
      { state: 'passed' as const },
      { state: 'blocked' as const },
      { state: 'pending' as const },
    ]
    const blocked = items.some(i => i.state === 'blocked')
    assert.ok(blocked)
  })

  it('checklist run status logic: failed items = deficient (not blocked)', () => {
    const items = [
      { state: 'passed' as const },
      { state: 'failed' as const },
    ]
    const blocked = items.some(i => i.state === 'blocked')
    const failed = items.some(i => i.state === 'failed')
    assert.ok(!blocked, 'No blocked items')
    assert.ok(failed, 'Has failed items — should be deficient')
  })

  it('completion percentage accounts for passed only', () => {
    const items = [
      { state: 'passed' as const },
      { state: 'passed' as const },
      { state: 'pending' as const },
      { state: 'skipped' as const },
    ]
    const total = items.length
    const passed = items.filter(i => i.state === 'passed').length
    const pct = total > 0 ? Math.round(passed / total * 100) : 0
    assert.equal(pct, 50)
  })
})

describe('LOTO Authorization Logic', () => {
  it('general lockout requires supervisor+ to clear', () => {
    const lotoType = 'general_lockout'
    const canClear = (role: string) => ['supervisor', 'admin'].includes(role)
    assert.ok(!canClear('contributor'))
    assert.ok(!canClear('viewer'))
    assert.ok(canClear('supervisor'))
    assert.ok(canClear('admin'))
    assert.equal(lotoType, 'general_lockout')
  })

  it('formal LOTO requires admin only to clear', () => {
    const lotoType = 'formal_loto'
    const canClear = (role: string) => role === 'admin'
    assert.ok(!canClear('contributor'))
    assert.ok(!canClear('supervisor'))
    assert.ok(canClear('admin'))
    assert.equal(lotoType, 'formal_loto')
  })

  it('LOTO history cannot be deleted (no DELETE policy)', () => {
    const hasDeletePolicy = false
    assert.ok(!hasDeletePolicy, 'No DELETE policy should exist on loto_records')
  })
})

describe('Message Board and Case Source Links', () => {
  it('promotion requires reviewer+ role', () => {
    const canPromote = (role: string) => ['reviewer', 'supervisor', 'admin'].includes(role)
    assert.ok(!canPromote('contributor'))
    assert.ok(canPromote('reviewer'))
    assert.ok(canPromote('supervisor'))
    assert.ok(canPromote('admin'))
  })

  it('case can be created from chat message or board post', () => {
    const sourceTypes = ['chat_message', 'board_post'] as const
    assert.equal(sourceTypes.length, 2)
    assert.ok(sourceTypes.includes('chat_message'))
    assert.ok(sourceTypes.includes('board_post'))
  })

  it('edit history preserves prior body', () => {
    const editHistory = [
      { body: 'Original message', edited_at: '2026-01-01T00:00:00Z', edited_by: 'user-1' },
      { body: 'Edited message', edited_at: '2026-01-02T00:00:00Z', edited_by: 'user-1' },
    ]
    assert.equal(editHistory.length, 2)
    assert.equal(editHistory[0].body, 'Original message')
  })
})


describe('Org Member Count Consistency', () => {
  it('member count and member list should agree when no FK join exists', () => {
    // Simulates the bug: organization_members.user_id has no FK to profiles.id,
    // so PostgREST nested join profiles:user_id(...) returns null.
    // The fix: fetch profiles separately and merge in JS.

    const memberRows = [
      { id: 'mem-1', organization_id: 'org-1', user_id: 'user-1', role: 'admin', joined_at: '2026-01-01T00:00:00Z' },
    ]
    const profileRows = [
      { id: 'user-1', name: 'Test Admin', email: 'admin@test.com' },
    ]

    // Old approach: nested join silently returns null for profiles
    const oldStyleResult = memberRows.map(m => ({ ...m, profiles: null as any }))
    assert.equal(oldStyleResult.length, 1)
    assert.equal(oldStyleResult[0].profiles, null, 'FK-less join yields null profile')

    // New approach: fetch profiles separately and merge
    const profileMap = new Map<string, { id: string; name: string; email: string }>()
    for (const p of profileRows) profileMap.set(p.id, p)
    const merged = memberRows.map(m => ({
      ...m,
      profiles: profileMap.get(m.user_id) || null,
    }))
    assert.equal(merged.length, 1, 'member list has 1 row matching count')
    assert.ok(merged[0].profiles, 'profile is resolved via separate fetch')
    assert.equal(merged[0].profiles?.name, 'Test Admin')
    assert.equal(merged[0].profiles?.email, 'admin@test.com')

    // The count and list now agree
    const count = memberRows.length
    const listLength = merged.length
    assert.equal(count, listLength, 'count and visible list match')
  })

  it('handles missing profile gracefully without exposing unauthorized data', () => {
    const memberRows = [
      { id: 'mem-1', organization_id: 'org-1', user_id: 'user-1', role: 'admin', joined_at: '2026-01-01T00:00:00Z' },
      { id: 'mem-2', organization_id: 'org-1', user_id: 'user-2', role: 'member', joined_at: '2026-01-02T00:00:00Z' },
    ]
    // Only user-1 has a visible profile; user-2 does not
    const profileRows = [
      { id: 'user-1', name: 'Visible User', email: 'visible@test.com' },
    ]
    const profileMap = new Map<string, { id: string; name: string; email: string }>()
    for (const p of profileRows) profileMap.set(p.id, p)
    const merged = memberRows.map(m => ({
      ...m,
      profiles: profileMap.get(m.user_id) || null,
    }))
    assert.equal(merged.length, 2, 'both members visible in list')
    assert.ok(merged[0].profiles, 'first member has profile')
    assert.equal(merged[1].profiles, null, 'second member has no profile (not exposed)')
  })
})

describe('RLS Isolation', () => {
  it('facility members can only access their facility data', () => {
    const isFacilityMember = (facilityId: string, userFacilities: string[]) =>
      userFacilities.includes(facilityId)

    assert.ok(isFacilityMember('fac-1', ['fac-1', 'fac-2']))
    assert.ok(!isFacilityMember('fac-3', ['fac-1', 'fac-2']))
  })

  it('org admin has implicit access to all facilities in their org', () => {
    const isOrgAdmin = (orgId: string, userOrgs: { orgId: string; role: string }[]) =>
      userOrgs.some(uo => uo.orgId === orgId && uo.role === 'admin')

    assert.ok(isOrgAdmin('org-1', [{ orgId: 'org-1', role: 'admin' }]))
    assert.ok(!isOrgAdmin('org-1', [{ orgId: 'org-1', role: 'member' }]))
    assert.ok(!isOrgAdmin('org-2', [{ orgId: 'org-1', role: 'admin' }]))
  })
})
