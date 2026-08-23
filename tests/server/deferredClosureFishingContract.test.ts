import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseExecuteEquipmentActionCommand } from '#shared/itemAutomation/equipmentActions'
import { parseBreedingOperationCommandV1 } from '#shared/breeding/operations'
import type { SkillCheckId } from '#shared/skillChecks/contract'
import breedingRulesetJson from '~~/data/breeding-automation/ruleset.json'
import { buildEncounterPresentationProjection } from '~~/server/domain/encounterPresentation/buildProjection'
import { createEncounterEquipmentGrantQueries } from '~~/server/domain/moveAutomation/equipmentGrantQueries'
import { executeDeferredEquipmentActionMechanic } from '~~/server/domain/itemAutomation/deferredEquipmentActions'
import { executeEquipmentActionUseCase } from '~~/server/useCases/executeEquipmentAction'
import { advanceBreedingCampaignClock } from '~~/server/useCases/advanceBreedingCampaignClock'
import { manageGmSkillCheckUseCase } from '~~/server/useCases/manageGmSkillChecks'
import { respondSubjectSkillCheckUseCase } from '~~/server/useCases/manageSubjectSkillChecks'
import {
  loadItemGuidedAdjudicationUseCase,
  manageItemGuidedAdjudicationUseCase,
} from '~~/server/useCases/manageItemGuidedAdjudication'
import { openRotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteItemGuidedRequestRepository } from '~~/server/storage/itemGuidedRequestRepository'
import { createSqliteCampaignClockRepository } from '~~/server/storage/campaignClockRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { createSqliteEquipmentActionOperationRepository } from '~~/server/storage/equipmentActionOperationRepository'
import type { TrainerSheet, TrainerSkillKey } from '~/types/trainerSheet'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { TabletopMap } from '~/types/map'
import { activeEquipmentState } from '../fixtures/equipment'

const CASES = [
  ['Old Rod', 'equipment.fishing.old-rod'],
  ['Good Rod', 'equipment.fishing.good-rod'],
  ['Super Rod', 'equipment.fishing.super-rod'],
] as const

const setup = (canonicalItemId: typeof CASES[number][0] = 'Old Rod', input: {
  readonly waterX?: number
  readonly materialId?: string
} = {}) => {
  const actionId = CASES.find(row => row[0] === canonicalItemId)![1]
  const actor: TrainerSheet = {
    slug: `fishing-${canonicalItemId.toLowerCase().replaceAll(' ', '-')}`,
    name: `${canonicalItemId} Angler`,
    level: 12,
    revision: 3,
    equipmentState: activeEquipmentState({
      ownerKind: 'trainer',
      ownerSlug: `fishing-${canonicalItemId.toLowerCase().replaceAll(' ', '-')}`,
      slotId: 'mainHand',
      additionalSlotIds: ['offHand'],
      canonicalItemId,
    }),
  }
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `fishing-map-${canonicalItemId.toLowerCase().replaceAll(' ', '-')}`,
    name: `${canonicalItemId} fishing map`,
    revision: 7,
    dimensions: { x: 10, y: 4, z: 10 },
    playerVisible: true,
    voxels: [{
      x: input.waterX ?? 1,
      y: 0,
      z: 0,
      materialId: input.materialId ?? 'shallow_water',
      blocksMovement: false,
      blocksSight: false,
    }],
    placements: [{
      id: 'fishing-actor-token',
      sheetKind: 'trainer',
      sheetSlug: actor.slug,
      position: { x: 0, y: 0, z: 0 },
    }],
    encounterState: createEmptyEncounterState(),
  }
  const queries = createEncounterEquipmentGrantQueries({
    map,
    sheets: [{ kind: 'trainer', slug: actor.slug, sheet: actor }],
  })
  const source = queries.resolve('fishing-actor-token')!.active.find(entry => (
    entry.grant.kind === 'action' && entry.grant.actionId === actionId
  ))!
  const projection = buildEncounterPresentationProjection({
    role: 'gm', map, mapRevision: 7, pokemonSheets: [], trainerSheets: [actor], generatedAt: 100,
  })
  const offer = projection.offers.find(candidate => candidate.intent.actionId === actionId)!
  const command = parseExecuteEquipmentActionCommand({
    schemaVersion: 1,
    operationId: `equipment-fishing-${canonicalItemId.toLowerCase().replaceAll(' ', '-')}-operation`,
    offerId: offer.offerId,
    mapSlug: map.slug,
    baseRevision: 7,
    actorPlacementId: 'fishing-actor-token',
    actionId,
    equipmentInstanceId: source.instanceId,
    equipmentInstanceRevision: source.instanceRevision,
    targetEquipmentInstanceId: null,
    targetEquipmentInstanceRevision: null,
    targetPlacementIds: [],
    cells: [{ x: input.waterX ?? 1, y: 0, z: 0 }],
    inventorySourceInstanceId: null,
    skillCheckId: null,
    gmAdjudication: null,
  })
  return { actor, map, queries, source, projection, offer, command, actionId }
}

const executePure = (fixture: ReturnType<typeof setup>) => executeDeferredEquipmentActionMechanic({
  command: fixture.command,
  source: fixture.source,
  map: fixture.map,
  actorPlacement: fixture.map.placements[0]!,
  actorSheet: fixture.actor,
  pokemonSheets: new Map(),
  trainerSheets: new Map([[fixture.actor.slug, fixture.actor]]),
  equipmentGrantsForPlacement: placementId => fixture.queries.resolve(placementId),
  rollD20: () => { throw new Error('Fishing declaration must not roll.') },
  campaignClock: { revision: 4, campaignMinute: 120 },
})

const seed = (fixture: ReturnType<typeof setup>, path = ':memory:') => {
  const database = openRotomDatabase({ path, enableWal: false })
  createSqliteMapRepository<TabletopMap>(database).save({
    slug: fixture.map.slug, document: fixture.map, revision: 7, updatedAt: 1,
  })
  createSqliteSheetRepository<Record<string, unknown>>(database).save({
    kind: 'trainer', slug: fixture.actor.slug,
    document: fixture.actor as unknown as Record<string, unknown>, revision: 3, updatedAt: 1,
  })
  return database
}

const advanceFishingClock = (
  database: ReturnType<typeof seed>,
  operationDigit = 'f',
  targetCampaignMinute = 15,
  expectedRevision = 0,
) => {
  const ruleset = breedingRulesetJson as { readonly rulesetId: string, readonly definitionSha256: string }
  const command = parseBreedingOperationCommandV1({
    schemaVersion: 1,
    operationId: `breeding-operation:v1:${operationDigit.repeat(32)}`,
    commandKind: 'advance-campaign-clock',
    actor: { profileId: 'campaign-gm', selectedTrainerSlug: null },
    ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 },
    scopes: [{ kind: 'campaign-clock', expectedRevision }],
    payload: { targetCampaignMinute },
  })
  expect(advanceBreedingCampaignClock(command, { database }).record.status).toBe('accepted')
}

const createFishingSkillCheck = (
  database: ReturnType<typeof seed>,
  fixture: ReturnType<typeof setup>,
  options: {
    readonly suffix?: string
    readonly skillId?: TrainerSkillKey
    readonly requestedAt?: number
    readonly settle?: boolean
  } = {},
): SkillCheckId => {
  const suffix = options.suffix ?? 'linked'
  const skillId = options.skillId ?? 'survival'
  const requestedAt = options.requestedAt ?? 210
  const checkId = `skill-check:v1:fishing-${suffix}` as const
  const subjectId = `skill-check-subject:v1:fishing-${suffix}` as const
  manageGmSkillCheckUseCase({ principalId: 'fishing-director', command: {
    schemaVersion: 1,
    operationId: `skill-check-op:v1:fishing-request-${suffix}`,
    expectedRevision: 0,
    commandKind: 'request',
    checkId,
    publicLabel: 'Fishing attempt',
    prompt: 'Make the selected Skill Check for this fishing declaration.',
    gmNotes: 'Private linked fishing evidence.',
    visibility: 'participants-results',
    comparison: {
      kind: 'dc',
      difficulty: { kind: 'preset', presetId: 'skill-check-dc-preset:v1:challenging' },
      concealment: 'subjects-after-acceptance',
    },
    situationalModifier: 0,
    expiresAt: 1_000,
    subjects: [{ subjectId, kind: 'trainer', sheetSlug: fixture.actor.slug, skillId }],
  } }, {
    database,
    listProfiles: () => [],
    now: () => requestedAt,
  })
  if (options.settle === false) return checkId
  respondSubjectSkillCheckUseCase({
    authority: { kind: 'gm', principalId: 'fishing-director' },
    command: {
      schemaVersion: 1,
      operationId: `skill-check-op:v1:fishing-response-${suffix}`,
      expectedRevision: 1,
      commandKind: 'respond',
      checkId,
      subjectId,
      decision: 'accept',
    },
  }, { database, now: () => requestedAt + 10 })
  manageGmSkillCheckUseCase({ principalId: 'fishing-director', command: {
    schemaVersion: 1,
    operationId: `skill-check-op:v1:fishing-resolve-${suffix}`,
    expectedRevision: 2,
    commandKind: 'resolve',
    checkId,
  } }, { database, now: () => requestedAt + 20, randomInt: () => 4 })
  return checkId
}

const declareAndAdvanceFishing = (fixture: ReturnType<typeof setup>, database = seed(fixture)) => {
  executeEquipmentActionUseCase({ role: 'gm', command: fixture.command }, { database, now: () => 200 })
  const repository = createSqliteItemGuidedRequestRepository({ database })
  const pending = repository.listPending()[0]!
  const authority = pending.authority.sourceKind === 'equipped-fishing-rod'
    ? pending.authority
    : (() => { throw new Error('Expected exact fishing authority.') })()
  expect(authority.readyAtCampaignMinute).toBe(15)
  const skillCheckId = createFishingSkillCheck(database, fixture)
  advanceFishingClock(database)
  return { database, repository, pending, authority, skillCheckId }
}

const fishingResolutionCommand = (input: {
  readonly requestId: string
  readonly integrationId: string
  readonly skillCheckId: SkillCheckId
  readonly operationDigit: string
  readonly hookSpeciesId: string | null
  readonly hookLevel: number | null
  readonly gmNote?: string | null
}) => ({
  schemaVersion: 1,
  operationId: `item-guided-operation:v1:${input.operationDigit.repeat(32)}`,
  action: 'resolve-fishing',
  requestId: input.requestId,
  expectedRevision: 0,
  skillId: 'survival',
  skillCheckIntegrationId: input.integrationId,
  skillCheckId: input.skillCheckId,
  hookSpeciesId: input.hookSpeciesId,
  hookLevel: input.hookLevel,
  gmNote: input.gmNote ?? null,
}) as const

describe('P11-038 fishing action declaration contract', () => {
  it.each(CASES)('projects and declares %s from exact two-hand custody', (canonicalItemId) => {
    const fixture = setup(canonicalItemId)
    expect(fixture.offer).toMatchObject({
      availability: { status: 'available' },
      timing: { kind: 'extended' },
      targeting: [expect.objectContaining({
        kind: 'cell', rangeLabel: 'Adjacent water cell', relationshipLabel: 'Water',
        requiresSpatialInput: true,
      })],
    })
    const result = executePure(fixture)
    expect(result).toMatchObject({ status: 'guided-pending', rolls: [] })
    expect(result.receipts.map(receipt => receipt.kind)).toEqual([
      'fishing-declaration', 'skill-check-reference', 'campaign-time', 'attention', 'accepted-result',
    ])
    expect(result.fishingDeclaration).toMatchObject({
      campaignClockRevision: 4,
      startedAtCampaignMinute: 120,
      readyAtCampaignMinute: 135,
      waterCell: { x: 1, y: 0, z: 0 },
    })
    expect(result.fishingDeclaration?.skillCheckIntegrationId).toMatch(/^skill-check-integration:v1:[a-f0-9]{32}$/)
  })

  it.each(CASES)('returns the exact %s declaration after duplicate delivery without another request or revision', (
    canonicalItemId,
  ) => {
    const fixture = setup(canonicalItemId)
    const database = seed(fixture)
    try {
      const randomInt = vi.fn(() => { throw new Error('Fishing declaration rolled unexpectedly.') })
      const first = executeEquipmentActionUseCase({ role: 'gm', command: fixture.command }, {
        database, randomInt, now: () => 190,
      })
      const events = createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0 }).events
      const replay = executeEquipmentActionUseCase({ role: 'gm', command: fixture.command }, {
        database, randomInt, now: () => 191,
      })
      expect(first).toMatchObject({ status: 'guided-pending', exactReplay: false, mapRevision: 8 })
      expect(replay).toMatchObject({ status: 'guided-pending', exactReplay: true, mapRevision: 8 })
      expect(randomInt).not.toHaveBeenCalled()
      expect(createSqliteItemGuidedRequestRepository({ database }).listPending()).toHaveLength(1)
      expect(createSqliteMapRepository<TabletopMap>(database).getBySlug(fixture.map.slug)?.revision).toBe(8)
      expect(createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0 }).events).toEqual(events)
    }
    finally { database.close() }
  })

  it('rolls a failed guided-request declaration fully back before a clean exact retry', () => {
    const fixture = setup('Super Rod')
    const database = seed(fixture)
    try {
      expect(() => executeEquipmentActionUseCase({ role: 'gm', command: fixture.command }, {
        database,
        now: () => 195,
        failAfterWrite: boundary => {
          if (boundary === 'guided-request') throw new Error('injected fishing declaration failure')
        },
      })).toThrow('injected fishing declaration failure')
      expect(createSqliteMapRepository<TabletopMap>(database).getBySlug(fixture.map.slug)?.revision).toBe(7)
      expect(createSqliteItemGuidedRequestRepository({ database }).listPending()).toEqual([])
      expect(createSqliteEquipmentActionOperationRepository(database).listForMap(fixture.map.slug)).toEqual([])
      expect(createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0 }).events).toEqual([])

      expect(executeEquipmentActionUseCase({ role: 'gm', command: fixture.command }, {
        database, now: () => 196,
      })).toMatchObject({ status: 'guided-pending', exactReplay: false, mapRevision: 8 })
      expect(createSqliteItemGuidedRequestRepository({ database }).listPending()).toHaveLength(1)
    }
    finally { database.close() }
  })

  it('recovers one durable pending declaration and exact replay after a database restart', () => {
    const fixture = setup('Good Rod')
    const directory = mkdtempSync(join(tmpdir(), 'rotom-fishing-restart-'))
    const path = join(directory, 'campaign.sqlite')
    let database = seed(fixture, path)
    try {
      expect(executeEquipmentActionUseCase({
        role: 'gm', command: fixture.command, clientId: 'fishing-client-a',
      }, { database, now: () => 197 })).toMatchObject({ exactReplay: false, mapRevision: 8 })
      const requestId = createSqliteItemGuidedRequestRepository({ database }).listPending()[0]!.requestId
      const eventCount = createSqliteRealtimeEventRepository({ database })
        .readAfter({ afterSequence: 0 }).events.length
      database.close()
      database = openRotomDatabase({ path, enableWal: false })

      expect(loadItemGuidedAdjudicationUseCase({ role: 'gm' }, { database }).requests)
        .toEqual([expect.objectContaining({ requestId, status: 'pending', requestKind: 'fishing-adjudication' })])
      expect(executeEquipmentActionUseCase({
        role: 'gm', command: fixture.command, clientId: 'fishing-client-b',
      }, { database, now: () => 198 })).toMatchObject({ exactReplay: true, mapRevision: 8 })
      expect(createSqliteItemGuidedRequestRepository({ database }).listPending()).toHaveLength(1)
      expect(createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0 }).events)
        .toHaveLength(eventCount)
    }
    finally {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('atomically persists a reconnectable role-safe GM prompt without advancing campaign time', () => {
    const fixture = setup('Old Rod')
    const database = seed(fixture)
    try {
      const randomInt = vi.fn(() => { throw new Error('Fishing declaration rolled unexpectedly.') })
      const accepted = executeEquipmentActionUseCase({ role: 'gm', command: fixture.command }, {
        database, randomInt, now: () => 200,
      })
      expect(accepted).toMatchObject({ status: 'guided-pending', mapRevision: 8, exactReplay: false })
      expect(randomInt).not.toHaveBeenCalled()
      expect(createSqliteCampaignClockRepository(database).get()).toMatchObject({
        revision: 0, campaignMinute: 0,
      })
      const records = createSqliteItemGuidedRequestRepository({ database }).listPending()
      expect(records).toHaveLength(1)
      expect(records[0]).toMatchObject({
        requestKind: 'fishing-adjudication', canonicalItemId: 'Old Rod',
        actorKind: 'trainer', actorSlug: fixture.actor.slug,
        authority: {
          sourceKind: 'equipped-fishing-rod', actionId: 'equipment.fishing.old-rod',
          readyAtCampaignMinute: 15,
          waterCell: { x: 1, y: 0, z: 0 },
        },
      })
      const reconnect = loadItemGuidedAdjudicationUseCase({ role: 'gm' }, { database })
      expect(reconnect.requests).toEqual([expect.objectContaining({
        requestId: records[0]!.requestId,
        status: 'pending',
        requestKind: 'fishing-adjudication',
        targetKindLabel: 'Water',
        timingLabel: '15-minute Extended Action',
        choices: [],
        resolution: expect.objectContaining({
          kind: 'fishing', actorKind: 'trainer', actorSheetSlug: fixture.actor.slug,
          maximumHookLevel: 10, allowNoHook: true,
          skillOptions: expect.arrayContaining([expect.objectContaining({ skillId: 'survival', label: 'Survival' })]),
          hookOptions: expect.arrayContaining([expect.objectContaining({ speciesId: 'Bulbasaur', label: 'Bulbasaur' })]),
        }),
        canCancel: true,
      })])
      const ownerReconnect = loadItemGuidedAdjudicationUseCase({
        role: 'player', ownerKind: 'trainer', ownerSlug: fixture.actor.slug,
        playerProfile: {
          schemaVersion: 1, id: 'profile_fishing_owner', displayName: 'Fishing owner',
          linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: fixture.actor.slug }],
        },
      }, { database })
      expect(ownerReconnect.requests[0]).toMatchObject({ choices: [], resolution: null, canCancel: true })
      const safeJson = JSON.stringify([reconnect, ownerReconnect])
      expect(safeJson).not.toContain(fixture.source.instanceId)
      expect(safeJson).not.toContain('skill-check-integration:')
      const eventJson = JSON.stringify(createSqliteRealtimeEventRepository({ database }).readAfter({
        afterSequence: 0, limit: 30,
      }).events)
      expect(eventJson).not.toContain(fixture.source.instanceId)
      expect(eventJson).not.toContain('skill-check-integration:')

      const replay = executeEquipmentActionUseCase({ role: 'gm', command: fixture.command }, {
        database, randomInt, now: () => 201,
      })
      expect(replay).toMatchObject({ status: 'guided-pending', mapRevision: 8, exactReplay: true })
      expect(createSqliteItemGuidedRequestRepository({ database }).listPending()).toHaveLength(1)
      expect(createSqliteMapRepository<TabletopMap>(database).getBySlug(fixture.map.slug)?.revision).toBe(8)
    }
    finally { database.close() }
  })

  it('supports exact cancellation after reconnect even if rod custody is later lost', () => {
    const fixture = setup('Good Rod')
    const database = seed(fixture)
    try {
      executeEquipmentActionUseCase({ role: 'gm', command: fixture.command }, { database, now: () => 200 })
      const requests = createSqliteItemGuidedRequestRepository({ database })
      const pending = requests.listPending()[0]!
      const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
      const current = sheets.getByRef('trainer', fixture.actor.slug)!
      const released: TrainerSheet = {
        ...(current.sheet as unknown as TrainerSheet),
        equipmentState: {
          ...fixture.actor.equipmentState!,
          revision: fixture.actor.equipmentState!.revision + 1,
          instances: [],
          slots: fixture.actor.equipmentState!.slots.map(slot => ({ ...slot, instanceId: null })),
        },
      }
      sheets.applyLivePlayUpdate({
        kind: 'trainer', slug: fixture.actor.slug, expectedRevision: current.revision,
        nextSheet: released as unknown as Record<string, unknown>, sourceOperationId: 'release-fishing-rod',
      })
      const playerProfile: PlayerProfile = {
        schemaVersion: 1,
        id: 'profile_fishing_contract',
        displayName: 'Fishing player',
        linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: fixture.actor.slug }],
      }
      expect(loadItemGuidedAdjudicationUseCase({
        role: 'player', playerProfile, ownerKind: 'trainer', ownerSlug: fixture.actor.slug,
      }, { database }).requests).toEqual([expect.objectContaining({
        requestId: pending.requestId, choices: [], canCancel: true,
      })])
      const command = {
        schemaVersion: 1,
        operationId: `item-guided-operation:v1:${'c'.repeat(32)}`,
        action: 'cancel',
        requestId: pending.requestId,
        expectedRevision: 0,
      }
      const cancelled = manageItemGuidedAdjudicationUseCase({
        role: 'player', playerProfile, command,
      }, { database, now: () => 220 })
      expect(cancelled.result).toMatchObject({
        exactReplay: false,
        request: { status: 'cancelled', revision: 1, canCancel: false },
      })
      const replay = manageItemGuidedAdjudicationUseCase({
        role: 'player', playerProfile, command,
      }, { database, now: () => 221 })
      expect(replay.result).toMatchObject({ exactReplay: true, request: { status: 'cancelled' } })
      expect(createSqliteCampaignClockRepository(database).get().campaignMinute).toBe(0)
    }
    finally { database.close() }
  })

  it('fails closed for non-water, non-adjacent water, malformed declaration, and duplicate activity', () => {
    const stone = setup('Old Rod', { materialId: 'stone' })
    expect(stone.offer.availability.status).toBe('unavailable')
    expect(() => executePure(stone))
      .toThrowError(expect.objectContaining({ code: 'fishing.water-required' }))

    const distant = setup('Old Rod', { waterX: 2 })
    expect(distant.offer.availability.status).toBe('unavailable')
    expect(() => executePure(distant))
      .toThrowError(expect.objectContaining({ code: 'fishing.water-not-adjacent' }))

    const valid = setup('Super Rod')
    expect(() => executeDeferredEquipmentActionMechanic({
      command: { ...valid.command, cells: [] },
      source: valid.source,
      map: valid.map,
      actorPlacement: valid.map.placements[0]!,
      actorSheet: valid.actor,
      pokemonSheets: new Map(), trainerSheets: new Map([[valid.actor.slug, valid.actor]]),
      equipmentGrantsForPlacement: placementId => valid.queries.resolve(placementId),
      rollD20: () => { throw new Error('must not roll') },
      campaignClock: { revision: 0, campaignMinute: 0 },
    })).toThrowError(expect.objectContaining({ code: 'fishing.declaration-shape-invalid' }))

    const database = seed(valid)
    try {
      executeEquipmentActionUseCase({ role: 'gm', command: valid.command }, { database, now: () => 300 })
      const map = createSqliteMapRepository<TabletopMap>(database).getBySlug(valid.map.slug)!
      const projection = buildEncounterPresentationProjection({
        role: 'gm', map, mapRevision: 8, pokemonSheets: [], trainerSheets: [{ ...valid.actor, revision: 3 }], generatedAt: 301,
      })
      const offer = projection.offers.find(candidate => candidate.intent.actionId === valid.actionId)!
      const duplicate = parseExecuteEquipmentActionCommand({
        ...valid.command,
        operationId: 'equipment-fishing-super-rod-duplicate',
        offerId: offer.offerId,
        baseRevision: 8,
      })
      expect(() => executeEquipmentActionUseCase({ role: 'gm', command: duplicate }, { database, now: () => 302 }))
        .toThrow('already has a fishing attempt in progress')
      expect(createSqliteMapRepository<TabletopMap>(database).getBySlug(valid.map.slug)?.revision).toBe(8)
    }
    finally { database.close() }
  })
})

describe('P11-039 guided fishing resolution', () => {
  it.each([
    ['Old Rod', 'Magikarp', 10, '1'],
    ['Good Rod', 'Magikarp', 70, '2'],
    ['Super Rod', 'Wailord', 100, '3'],
  ] as const)('settles one bounded %s hook after campaign time with private durable evidence', (
    canonicalItemId, hookSpeciesId, hookLevel, operationDigit,
  ) => {
    const fixture = setup(canonicalItemId)
    const { database, repository, pending, authority, skillCheckId } = declareAndAdvanceFishing(fixture)
    try {
      const command = fishingResolutionCommand({
        requestId: pending.requestId,
        integrationId: authority.skillCheckIntegrationId,
        skillCheckId,
        operationDigit,
        hookSpeciesId,
        hookLevel,
        gmNote: `Private ${canonicalItemId} hook evidence`,
      })
      const accepted = manageItemGuidedAdjudicationUseCase({ role: 'gm', command }, {
        database, now: () => 300,
      })
      expect(accepted).toMatchObject({
        result: {
          exactReplay: false,
          request: { status: 'accepted', revision: 1, choices: [], canCancel: false },
        },
        sheets: [],
      })
      expect(repository.listPending()).toEqual([])
      expect(repository.get(pending.requestId)).toMatchObject({
        status: 'accepted',
        outcomeOptionId: 'fishing-hook-recorded',
        terminalCommand: {
          action: 'resolve-fishing',
          skillId: 'survival',
          skillCheckIntegrationId: authority.skillCheckIntegrationId,
          skillCheckId,
          hookSpeciesId,
          hookLevel,
          gmNote: `Private ${canonicalItemId} hook evidence`,
        },
      })
      expect(createSqliteCampaignClockRepository(database).get()).toMatchObject({
        revision: 1, campaignMinute: 15,
      })
      expect(manageItemGuidedAdjudicationUseCase({ role: 'gm', command }, {
        database, now: () => 301,
      })).toMatchObject({
        result: { exactReplay: true, request: { status: 'accepted', revision: 1 } },
      })
      const publicJson = JSON.stringify([
        accepted,
        ...createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0, limit: 100 }).events,
      ])
      expect(publicJson).not.toContain(hookSpeciesId)
      expect(publicJson).not.toContain(`Private ${canonicalItemId} hook evidence`)
      expect(publicJson).not.toContain(authority.skillCheckIntegrationId)
      expect(publicJson).not.toContain(skillCheckId)
    }
    finally { database.close() }
  })

  it('fails closed before the ready boundary and accepts an explicit no-hook outcome afterwards', () => {
    const fixture = setup('Super Rod')
    const database = seed(fixture)
    try {
      executeEquipmentActionUseCase({ role: 'gm', command: fixture.command }, { database, now: () => 200 })
      const repository = createSqliteItemGuidedRequestRepository({ database })
      const pending = repository.listPending()[0]!
      if (pending.authority.sourceKind !== 'equipped-fishing-rod') throw new Error('Expected fishing authority.')
      const skillCheckId = createFishingSkillCheck(database, fixture, { suffix: 'ready-boundary' })
      const command = fishingResolutionCommand({
        requestId: pending.requestId,
        integrationId: pending.authority.skillCheckIntegrationId,
        skillCheckId,
        operationDigit: '4',
        hookSpeciesId: null,
        hookLevel: null,
      })
      expect(() => manageItemGuidedAdjudicationUseCase({ role: 'gm', command }, { database, now: () => 201 }))
        .toThrow('Fishing resolves at campaign minute 15')
      expect(repository.get(pending.requestId)).toMatchObject({ status: 'pending', revision: 0 })
      advanceFishingClock(database, 'e')
      expect(manageItemGuidedAdjudicationUseCase({ role: 'gm', command }, {
        database, now: () => 202,
      })).toMatchObject({ result: { request: { status: 'accepted' } } })
      expect(repository.get(pending.requestId)).toMatchObject({
        outcomeOptionId: 'fishing-no-hook',
        terminalCommand: { hookSpeciesId: null, hookLevel: null },
      })
    }
    finally { database.close() }
  })

  it('enforces canonical rod hook bounds and the exact Skill Check integration identity', () => {
    const fixture = setup('Old Rod')
    const { database, repository, pending, authority, skillCheckId } = declareAndAdvanceFishing(fixture)
    try {
      const invalid = [
        fishingResolutionCommand({
          requestId: pending.requestId, integrationId: authority.skillCheckIntegrationId, skillCheckId,
          operationDigit: '5', hookSpeciesId: 'Gyarados', hookLevel: 10,
        }),
        fishingResolutionCommand({
          requestId: pending.requestId, integrationId: authority.skillCheckIntegrationId, skillCheckId,
          operationDigit: '6', hookSpeciesId: 'Magikarp', hookLevel: 11,
        }),
        fishingResolutionCommand({
          requestId: pending.requestId, integrationId: authority.skillCheckIntegrationId, skillCheckId,
          operationDigit: '7', hookSpeciesId: 'Not A Canonical Species', hookLevel: 1,
        }),
        fishingResolutionCommand({
          requestId: pending.requestId, integrationId: 'skill-check-integration:v1:00000000000000000000000000000000',
          skillCheckId, operationDigit: '8', hookSpeciesId: 'Magikarp', hookLevel: 1,
        }),
      ]
      expect(() => manageItemGuidedAdjudicationUseCase({ role: 'gm', command: invalid[0]! }, { database }))
        .toThrow('Old Rod hooks must be Small, unevolved Pokémon at Level 10 or lower')
      expect(() => manageItemGuidedAdjudicationUseCase({ role: 'gm', command: invalid[1]! }, { database }))
        .toThrow('Old Rod hooks must be Small, unevolved Pokémon at Level 10 or lower')
      expect(() => manageItemGuidedAdjudicationUseCase({ role: 'gm', command: invalid[2]! }, { database }))
        .toThrow('not a canonical Pokédex identity')
      expect(() => manageItemGuidedAdjudicationUseCase({ role: 'gm', command: invalid[3]! }, { database }))
        .toThrow('Skill Check integration reference is stale or unrelated')
      expect(repository.get(pending.requestId)).toMatchObject({ status: 'pending', revision: 0 })
    }
    finally { database.close() }
  })

  it('rejects an evolved Good Rod hook while Super Rod remains stage-unrestricted', () => {
    const fixture = setup('Good Rod')
    const { database, repository, pending, authority, skillCheckId } = declareAndAdvanceFishing(fixture)
    try {
      const command = fishingResolutionCommand({
        requestId: pending.requestId,
        integrationId: authority.skillCheckIntegrationId,
        skillCheckId,
        operationDigit: 'a',
        hookSpeciesId: 'Gyarados',
        hookLevel: 20,
      })
      expect(() => manageItemGuidedAdjudicationUseCase({ role: 'gm', command }, { database }))
        .toThrow('Good Rod hooks must be unevolved Pokémon')
      expect(repository.get(pending.requestId)).toMatchObject({ status: 'pending', revision: 0 })
    }
    finally { database.close() }
  })

  it('rolls back terminal settlement failures and retries without changing the hook receipt', () => {
    const fixture = setup('Good Rod')
    const { database, repository, pending, authority, skillCheckId } = declareAndAdvanceFishing(fixture)
    try {
      const command = fishingResolutionCommand({
        requestId: pending.requestId,
        integrationId: authority.skillCheckIntegrationId,
        skillCheckId,
        operationDigit: '9',
        hookSpeciesId: 'Goldeen',
        hookLevel: 42,
        gmNote: 'Private retry evidence',
      })
      expect(() => manageItemGuidedAdjudicationUseCase({ role: 'gm', command }, {
        database,
        now: () => 500,
        failAfterWrite: stage => { if (stage === 'guided-request') throw new Error('injected fishing settlement failure') },
      })).toThrow('injected fishing settlement failure')
      expect(repository.get(pending.requestId)).toMatchObject({ status: 'pending', revision: 0 })
      expect(manageItemGuidedAdjudicationUseCase({ role: 'gm', command }, {
        database, now: () => 501,
      })).toMatchObject({ result: { exactReplay: false, request: { status: 'accepted' } } })
      expect(repository.get(pending.requestId)?.terminalCommand).toEqual(command)
    }
    finally { database.close() }
  })
})

describe('P11-050 fishing generic Skill Check integration', () => {
  it('requires one accepted post-declaration single-subject check for the exact actor and Skill', () => {
    const fixture = setup('Super Rod')
    const database = seed(fixture)
    try {
      executeEquipmentActionUseCase({ role: 'gm', command: fixture.command }, { database, now: () => 200 })
      const repository = createSqliteItemGuidedRequestRepository({ database })
      const pending = repository.listPending()[0]!
      if (pending.authority.sourceKind !== 'equipped-fishing-rod') throw new Error('Expected fishing authority.')
      advanceFishingClock(database)

      const accepted = createFishingSkillCheck(database, fixture, { suffix: 'valid-link' })
      const valid = fishingResolutionCommand({
        requestId: pending.requestId,
        integrationId: pending.authority.skillCheckIntegrationId,
        skillCheckId: accepted,
        operationDigit: 'b',
        hookSpeciesId: null,
        hookLevel: null,
      })
      const { skillCheckId: _omittedLegacyField, ...missingCheck } = valid
      expect(() => manageItemGuidedAdjudicationUseCase({ role: 'gm', command: missingCheck }, { database }))
        .toThrow('requires one accepted generic Skill Check')

      const unavailable = { ...valid, operationId: `item-guided-operation:v1:${'c'.repeat(32)}`, skillCheckId: 'skill-check:v1:fishing-unavailable' }
      expect(() => manageItemGuidedAdjudicationUseCase({ role: 'gm', command: unavailable }, { database }))
        .toThrow('selected fishing Skill Check is unavailable')

      const pendingCheck = createFishingSkillCheck(database, fixture, { suffix: 'pending-link', settle: false })
      expect(() => manageItemGuidedAdjudicationUseCase({
        role: 'gm',
        command: { ...valid, operationId: `item-guided-operation:v1:${'d'.repeat(32)}`, skillCheckId: pendingCheck },
      }, { database })).toThrow('not an accepted single-subject check for this actor, Skill, and declaration')

      const wrongSkill = createFishingSkillCheck(database, fixture, { suffix: 'wrong-skill', skillId: 'athletics' })
      expect(() => manageItemGuidedAdjudicationUseCase({
        role: 'gm',
        command: { ...valid, operationId: `item-guided-operation:v1:${'e'.repeat(32)}`, skillCheckId: wrongSkill },
      }, { database })).toThrow('not an accepted single-subject check for this actor, Skill, and declaration')

      const predating = createFishingSkillCheck(database, fixture, { suffix: 'predating', requestedAt: 100 })
      expect(() => manageItemGuidedAdjudicationUseCase({
        role: 'gm',
        command: { ...valid, operationId: `item-guided-operation:v1:${'f'.repeat(32)}`, skillCheckId: predating },
      }, { database })).toThrow('not an accepted single-subject check for this actor, Skill, and declaration')

      expect(repository.get(pending.requestId)).toMatchObject({ status: 'pending', revision: 0 })
      expect(manageItemGuidedAdjudicationUseCase({ role: 'gm', command: valid }, { database, now: () => 300 }))
        .toMatchObject({ result: { request: { status: 'accepted' }, exactReplay: false } })
      expect(repository.get(pending.requestId)).toMatchObject({
        terminalCommand: { action: 'resolve-fishing', skillCheckId: accepted, skillId: 'survival' },
      })
    }
    finally { database.close() }
  })

  it('refuses to reuse an accepted generic check across fishing declarations', () => {
    const fixture = setup('Old Rod')
    const database = seed(fixture)
    try {
      executeEquipmentActionUseCase({ role: 'gm', command: fixture.command }, { database, now: () => 200 })
      const repository = createSqliteItemGuidedRequestRepository({ database })
      const first = repository.listPending()[0]!
      if (first.authority.sourceKind !== 'equipped-fishing-rod') throw new Error('Expected fishing authority.')
      const skillCheckId = createFishingSkillCheck(database, fixture, { suffix: 'one-use', requestedAt: 210 })
      advanceFishingClock(database)
      manageItemGuidedAdjudicationUseCase({ role: 'gm', command: fishingResolutionCommand({
        requestId: first.requestId,
        integrationId: first.authority.skillCheckIntegrationId,
        skillCheckId,
        operationDigit: '1',
        hookSpeciesId: null,
        hookLevel: null,
      }) }, { database, now: () => 300 })

      const currentMap = createSqliteMapRepository<TabletopMap>(database).getBySlug(fixture.map.slug)!
      const currentProjection = buildEncounterPresentationProjection({
        role: 'gm', map: currentMap, mapRevision: currentMap.revision,
        pokemonSheets: [], trainerSheets: [fixture.actor], generatedAt: 301,
      })
      const secondOffer = currentProjection.offers.find(candidate => candidate.intent.actionId === fixture.actionId)!
      const secondDeclaration = parseExecuteEquipmentActionCommand({
        ...fixture.command,
        operationId: 'equipment-fishing-old-rod-second-operation',
        offerId: secondOffer.offerId,
        baseRevision: 8,
      })
      executeEquipmentActionUseCase({ role: 'gm', command: secondDeclaration }, { database, now: () => 201 })
      const second = repository.listPending()[0]!
      if (second.authority.sourceKind !== 'equipped-fishing-rod') throw new Error('Expected second fishing authority.')
      advanceFishingClock(database, '2', 30, 1)
      const reuse = fishingResolutionCommand({
        requestId: second.requestId,
        integrationId: second.authority.skillCheckIntegrationId,
        skillCheckId,
        operationDigit: '3',
        hookSpeciesId: null,
        hookLevel: null,
      })
      expect(() => manageItemGuidedAdjudicationUseCase({ role: 'gm', command: reuse }, { database, now: () => 400 }))
        .toThrow('already settles another fishing declaration')
      expect(repository.get(second.requestId)).toMatchObject({ status: 'pending', revision: 0 })
    }
    finally { database.close() }
  })
})
