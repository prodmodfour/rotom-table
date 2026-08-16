import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import { parseCampaignDayOperationCommandV1 } from '#shared/campaignDay'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { JUICER_BERRY_ELAPSED_MS } from '#shared/capabilityAutomation/campaignState'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteMapInteractionModeRepository } from '../../server/storage/mapInteractionModeRepository'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { createSqliteCampaignClockRepository } from '../../server/storage/campaignClockRepository'
import { createSqliteCampaignDayOperationRepository } from '../../server/storage/campaignDayOperationRepository'
import { createSqliteBreedingOperationRepository } from '../../server/storage/breedingOperationRepository'
import { createSqlitePokemonEggRepository } from '../../server/storage/pokemonEggRepository'
import { createSqliteBreedingIncubationSegmentRepository } from '../../server/storage/breedingIncubationSegmentRepository'
import { createSqliteBreedingArchiveStateRepository } from '../../server/storage/breedingArchiveStateRepository'
import { advanceCampaignDayUseCase } from '../../server/useCases/advanceCampaignDay'
import { createPokemonEggOffspringBlueprintV1, parseAuthoritativePokemonEggDocumentV1 } from '../../server/domain/breeding/lineage'
import { compiledBreedingSpeciesSpec } from '../../server/domain/breeding/registry'
import { createBreedingOperationAcceptedV1, createBreedingOperationCommandHash } from '../../server/domain/breeding/operations'
import { parseBreedingOperationCommandV1 } from '#shared/breeding/operations'
import eggContractJson from '../../data/breeding-automation/egg-contract.json'
import hatchDurationPolicyJson from '../../data/breeding-automation/hatch-duration-policy.json'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import { resolveEffectiveCapabilities } from '../../server/domain/capabilityAutomation/effectiveCapabilities'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { computePokemonHealingVitals } from '~/utils/sheets/healing'
import { parseItemMedicalTreatmentState } from '#shared/itemAutomation/medicalTreatments'
import { applyBandageTreatment } from '../../server/domain/itemAutomation/medicalTreatments'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'
import { startItemRouteLure } from '../../server/domain/itemAutomation/exploration'
import { ITEM_EXPLORATION_CLOCK_REALTIME_EVENT_TYPE } from '#shared/itemAutomation/exploration'
import { parseItemReBreatherState } from '#shared/itemAutomation/guidedAdjudication'
import { activeEquipmentState } from '../fixtures/equipment'

let databases: RotomDatabase[] = []
const db = () => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

const changedPokemon = (revision = 1) => ({
  slug: 'pika',
  nickname: 'Pika',
  species: '',
  level: 5,
  combat: { currentHp: 1, injuries: 2, injuriesHealedToday: 2, conditions: ['Burned'] },
  moveUsage: { daily: { thunderbolt: { moveName: 'Thunderbolt', uses: 1 } } },
  abilityUsage: {
    schemaVersion: 1, dayKey: 'campaign-day:previous',
    entries: [{
      ownerId: 'pika', abilityInstanceId: 'base:pika:blessed-touch', canonicalId: 'Blessed Touch',
      clauseId: 'base', limit: 2, spent: 1, operationIds: ['op:blessed-touch'],
    }],
  },
  berryStorage: {
    schemaVersion: 1,
    entries: [{ id: 'berry:oran', canonicalItemId: 'oran-berry', canonicalItemName: 'Oran Berry', quantity: 1, lastTradedSceneId: null }],
  },
  revision,
})

const changedTrainer = (revision = 3) => ({
  slug: 'brock',
  name: 'Brock',
  level: 3,
  currentHp: 1,
  currentInjuries: 1,
  injuriesHealedToday: 1,
  conditions: ['Poisoned'],
  ap: { spent: 2 },
  revision,
})

const campaignDayCommand = (hex: string) => parseCampaignDayOperationCommandV1({
  schemaVersion: 1,
  operationId: `campaign-day:v1:${hex.repeat(32)}`,
  kind: 'advance-one-day',
  days: 1,
})

const campaignTimeEffect = (input: {
  readonly id: string
  readonly startedAtCampaignMinute: number
  readonly durationMinutes: number
}) => parseEncounterEffect({
  id: input.id,
  kind: 'condition',
  source: { operationId: `operation.${input.id}`, moveId: 'item.daily-duration', placementId: 'clock-target' },
  affected: { placementIds: ['clock-target'], sideIds: [], cells: [] },
  createdRound: 1,
  createdTurn: 0,
  duration: {
    kind: 'campaign-time',
    remaining: null,
    startedAtCampaignMinute: input.startedAtCampaignMinute,
    expiresAtCampaignMinute: input.startedAtCampaignMinute + input.durationMinutes,
    durationMinutes: input.durationMinutes,
  },
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: ['item', 'campaign-time'],
  payload: { conditionId: 'sleep', action: 'apply', saveTiming: 'end-turn' },
  dispel: { policy: 'matching-tags', tags: ['item'] },
  transferPolicy: 'expire',
  suppression: { sources: [] },
})

const breedingRuleset = Object.freeze({
  rulesetId: rulesetJson.rulesetId,
  definitionSha256: rulesetJson.definitionSha256,
})
const breedingOperationId = (value: number): string => (
  `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
)
const pokemonEggId = (value: number): string => (
  `pokemon-egg:v1:${value.toString(16).padStart(32, '0')}`
)
const breedingOptionId = (value: number): string => (
  `option:v1:${value.toString(16).padStart(32, '0')}`
)
const seedCampaignDayEgg = (
  database: RotomDatabase,
  value: number,
  paused: boolean,
): string => {
  const eggId = pokemonEggId(value)
  const source = parseBreedingOperationCommandV1({
    schemaVersion: 1,
    operationId: breedingOperationId(value),
    commandKind: 'create-source-egg',
    actor: { profileId: 'campaign-gm', selectedTrainerSlug: null },
    ruleset: breedingRuleset,
    scopes: [{ kind: 'pokemon-egg', eggId, expectedRevision: null }],
    payload: {
      eggId,
      ownerTrainerSlug: `trainer-owner-${value}`,
      source: {
        kind: 'gm',
        reasonId: 'breeding.egg-source.reviewed',
        evidenceDefinitionSha256: 'e'.repeat(64),
      },
      speciesOptionId: breedingOptionId(value),
      resolutions: { selectedOptionIds: [], requestedRollKinds: [] },
    },
  })
  const species = compiledBreedingSpeciesSpec('bulbasaur')!
  const blueprint = createPokemonEggOffspringBlueprintV1({
    schemaVersion: 1,
    speciesId: species.speciesId,
    familyRootSpeciesId: species.familyRootSpeciesId,
    speciesSpecDefinitionSha256: species.definitionSha256,
    nature: { valueId: 'cuddly', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    ability: { valueId: species.basicAbilityIds[0]!, resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    gender: { valueId: 'female', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    inheritanceCandidates: [],
    startingLevel: 1,
    babyTemplate: { applied: false, choiceOptionId: null, choiceEvidenceId: null, effects: null },
  })
  const durationResultDefinitionSha256 = createHash('sha256')
    .update(`campaign-day-duration-${value}`)
    .digest('hex')
  const document = parseAuthoritativePokemonEggDocumentV1({
    schemaVersion: 1,
    eggId,
    revision: 0,
    status: 'incubating',
    ownerTrainerSlug: `trainer-owner-${value}`,
    source: { kind: 'gm', reasonId: 'breeding.egg-source.reviewed', evidenceDefinitionSha256: 'e'.repeat(64) },
    ruleset: breedingRuleset,
    definitionHashes: [
      blueprint.definitionSha256,
      durationResultDefinitionSha256,
      eggContractJson.definitionSha256,
      hatchDurationPolicyJson.definitionSha256,
      breedingRuleset.definitionSha256,
    ].sort(),
    parents: [],
    breeder: null,
    offspring: blueprint,
    incubation: {
      averageCampaignMinutes: 6_000,
      targetCampaignMinutes: 6_000,
      accumulatedCampaignMinutes: 0,
      variationPolicyId: 'fixed-average',
      durationResultDefinitionSha256,
      lastAppliedClockRevision: 0,
      lastAppliedClockMinute: 0,
      readyAtCampaignMinute: null,
      readinessKind: null,
      readyOperationId: null,
      paused,
      pauseReasonId: paused ? 'breeding.incubation-pause.gm-maintenance' : null,
      pauseOperationId: paused ? source.operationId : null,
    },
    special: {
      state: 'not-rolled', rollRecordId: null, rollTotal: null, triggerIds: [],
      adjudicationId: null, outcomeId: null, automaticShiny: false,
    },
    hatchOperationId: null,
    childSheetSlug: null,
    terminal: null,
    createdAtCampaignMinute: 0,
    updatedAtCampaignMinute: 0,
    statusChangedAtCampaignMinute: 0,
    lastOperationId: source.operationId,
  })
  database.withTransaction(() => {
    const operations = createSqliteBreedingOperationRepository(database)
    operations.reserve(source, 0)
    createSqlitePokemonEggRepository(database).insert(document)
    operations.settle(source, createBreedingOperationAcceptedV1({
      operationId: source.operationId,
      commandHash: createBreedingOperationCommandHash(source),
      commandKind: source.commandKind,
      outcomeKind: 'source-egg-created',
      aggregateRefs: [{ kind: 'pokemon-egg', id: eggId, revision: 0 }],
      changedScopes: source.scopes,
      committedAtCampaignMinute: 0,
    }), 0)
  })
  return eggId
}

const unchangedPokemon = () => ({
  slug: 'calm',
  nickname: 'Calm',
  species: '',
  level: 5,
  combat: { currentHp: 15, injuries: 0, conditions: [] },
  revision: 7,
})

describe('advanceCampaignDayUseCase', () => {
  it('commits multiple changed sheets atomically with complete durable specific and global events', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 999 })
    const published: PersistedRealtimeEvent[] = []
    sheets.saveSetupSheet('pokemon', 'pika', changedPokemon())
    sheets.saveSetupSheet('pokemon', 'calm', unchangedPokemon())
    sheets.saveSetupSheet('trainer', 'brock', changedTrainer())

    const result = advanceCampaignDayUseCase({ clientId: 'client-1' }, {
      database,
      sheetRepository: sheets,
      realtimeEventRepository: realtime,
      now: () => 500,
      publishPersistedRealtimeEvent: (event) => published.push(event),
    })

    expect(result).toMatchObject({ ok: true, totalSheets: 3, updatedSheets: 2, pokemonUpdated: 1, trainerUpdated: 1 })
    expect(sheets.getByRef('pokemon', 'pika')?.revision).toBe(2)
    expect(sheets.getByRef('pokemon', 'pika')?.sheet).toMatchObject({
      abilityUsage: { schemaVersion: 1, dayKey: 'campaign-day:500', entries: [] },
    })
    expect(sheets.getByRef('pokemon', 'pika')?.sheet).not.toHaveProperty('berryStorage')
    expect(sheets.getByRef('trainer', 'brock')?.revision).toBe(4)
    expect(sheets.getByRef('pokemon', 'calm')?.revision).toBe(7)
    expect(result.paths).toEqual(['data/sheets/pika.json', 'data/trainers/brock.json'])
    expect(result.realtimeEvents.map((event) => event.sequence)).toEqual([1, 2, 3, 4])
    expect(result.realtimeEvents.map((event) => event.event.channel)).toEqual([
      'sheet:pokemon:pika',
      'sheets',
      'sheet:trainer:brock',
      'sheets',
    ])
    expect(result.realtimeEvents.every((event) => event.access.kind === 'sheet-access')).toBe(true)
    expect(result.realtimeEvents[0]?.event).toMatchObject({
      channel: 'sheet:pokemon:pika',
      type: 'updated',
      clientId: 'client-1',
      data: { kind: 'pokemon', slug: 'pika', sheet: { slug: 'pika', revision: 2, updatedAt: 500 } },
    })
    expect(realtime.readAfter({ afterSequence: 0 }).events).toEqual(result.realtimeEvents)
    expect(published).toEqual(result.realtimeEvents)
  })

  it('publishes an owner-authorized clock refresh for durable exploration projections even when sheet state is unchanged', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 999 })
    const route = startItemRouteLure({
      current: null,
      definition: ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Bait'),
      sourceOperationId: 'item-source-operation:00000001',
      sourceInstanceId: 'item-instance:trainer:explorer:foodStuff:bait-row',
      campaignMinute: 0,
    })
    sheets.saveSetupSheet('trainer', 'explorer', {
      slug: 'explorer', name: 'Explorer', level: 10, revision: 3,
      serverPrivate: { itemExploration: route.state },
    })

    const result = advanceCampaignDayUseCase({ command: campaignDayCommand('a'), clientId: 'clock-client' }, {
      database, sheetRepository: sheets, realtimeEventRepository: realtime, now: () => 525,
      publishPersistedRealtimeEvent: () => {},
    })
    const refresh = result.realtimeEvents.find(event => (
      event.event.type === ITEM_EXPLORATION_CLOCK_REALTIME_EVENT_TYPE
    ))
    expect(refresh).toMatchObject({
      access: { kind: 'sheet-access', sheetKind: 'trainer', sheetSlug: 'explorer' },
      event: {
        channel: 'sheet:trainer:explorer',
        type: ITEM_EXPLORATION_CLOCK_REALTIME_EVENT_TYPE,
        clientId: 'clock-client',
        data: {
          schemaVersion: 1, trainerSlug: 'explorer',
          campaignClockRevision: 1, campaignMinute: 1440,
        },
      },
    })
    expect(JSON.stringify(refresh)).not.toContain('sourceOperationId')
    expect(JSON.stringify(refresh)).not.toContain('canonicalDefinitionSha256')
  })

  it('settles due Bandages boundaries in the same campaign-clock and sheet transaction', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const base = changedPokemon() as unknown as CharacterSheet
    const treated = applyBandageTreatment({
      sheetKind: 'pokemon', sheet: base, targetSlug: 'pika',
      operationId: `sheet-item:v1:${'8'.repeat(32)}`,
      canonicalDefinitionSha256: ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Bandages').definitionSha256,
      campaignMinute: 0,
    }) as CharacterSheet
    sheets.saveSetupSheet('pokemon', 'pika', treated as unknown as Record<string, unknown>)

    const result = advanceCampaignDayUseCase({ command: campaignDayCommand('b') }, {
      database, sheetRepository: sheets, now: () => 550,
      publishPersistedRealtimeEvent: () => {},
    })
    expect(result.campaignClock).toMatchObject({ previousCampaignMinute: 0, campaignMinute: 1440 })
    const accepted = sheets.getByRef('pokemon', 'pika')!.sheet as unknown as CharacterSheet
    expect(parseItemMedicalTreatmentState(accepted.itemMedicalTreatments).entries[0]).toMatchObject({
      status: 'completed', ticksApplied: 12, injuryRemoved: true,
      terminalReason: 'full-duration', terminalCampaignMinute: 360,
    })
    expect(accepted.combat).toMatchObject({ injuries: 0, currentHp: computePokemonHealingVitals(accepted).maxHp })
  })

  it('rejects malformed campaign-day identity before changing the singleton clock', () => {
    const database = db()
    expect(() => advanceCampaignDayUseCase({
      command: {
        schemaVersion: 1,
        operationId: 'campaign-day:v1:not-hex',
        kind: 'advance-one-day',
        days: 1,
      },
    }, { database })).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(createSqliteCampaignClockRepository(database).get()).toMatchObject({
      revision: 0, campaignMinute: 0, lastOperationId: null,
    })
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM campaign_day_operations').get())
      .toEqual({ count: 0 })
  })

  it('rolls back every sheet when one planned sheet is stale', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    sheets.saveSetupSheet('pokemon', 'pika', changedPokemon())
    sheets.saveSetupSheet('trainer', 'brock', changedTrainer())
    let madeStale = false
    const staleRepository = {
      database,
      list: (kind?: 'pokemon' | 'trainer') => {
        const rows = sheets.list(kind)
        if (kind === 'pokemon' && !madeStale) {
          madeStale = true
          sheets.saveSetupSheet('pokemon', 'pika', changedPokemon(20))
        }
        return rows
      },
      getByRef: sheets.getByRef,
      applyLivePlayUpdate: sheets.applyLivePlayUpdate,
    }

    expect(() => advanceCampaignDayUseCase({}, {
      database,
      sheetRepository: staleRepository,
      realtimeEventRepository: realtime,
      now: () => 501,
    })).toThrow(/changed during campaign-day advancement/)

    expect(sheets.getByRef('pokemon', 'pika')?.revision).toBe(20)
    expect(sheets.getByRef('trainer', 'brock')?.revision).toBe(3)
    expect(realtime.readAfter({ afterSequence: 0 }).events).toEqual([])
  })

  it('rolls back all sheet updates when durable event append fails', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.saveSetupSheet('pokemon', 'pika', changedPokemon())
    sheets.saveSetupSheet('trainer', 'brock', changedTrainer())

    expect(() => advanceCampaignDayUseCase({}, {
      database,
      sheetRepository: sheets,
      realtimeEventRepository: { database, appendMany: vi.fn(() => { throw new Error('event append failed') }) },
      now: () => 600,
    })).toThrow('event append failed')

    expect(sheets.getByRef('pokemon', 'pika')?.revision).toBe(1)
    expect(sheets.getByRef('trainer', 'brock')?.revision).toBe(3)
  })

  it('publishes after commit, keeps success when publication fails, and continues later publications', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const published: PersistedRealtimeEvent[] = []
    const report = vi.fn()
    sheets.saveSetupSheet('pokemon', 'pika', changedPokemon())

    const result = advanceCampaignDayUseCase({}, {
      database,
      sheetRepository: sheets,
      realtimeEventRepository: realtime,
      now: () => 700,
      publishPersistedRealtimeEvent: (event) => {
        expect(sheets.getByRef('pokemon', 'pika')?.revision).toBe(2)
        if (event.sequence === 1) throw new Error('subscriber down')
        published.push(event)
      },
      reportAfterCommitPublicationFailure: report,
    })

    expect(result.ok).toBe(true)
    expect(sheets.getByRef('pokemon', 'pika')?.revision).toBe(2)
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ sequence: 1, operation: 'campaign-next-day' }))
    expect(published.map((event) => event.sequence)).toEqual([2])
  })

  it('converts the exact held Berry at 24 elapsed hours, detaches shell juice, and matures it after 14 further days', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    sheets.saveSetupSheet('pokemon', 'shuckle', {
      slug: 'shuckle', nickname: 'Shuckle', species: 'Shuckle', level: 20, revision: 1,
      items: { held: 'Oran Berry' },
    })
    const dependencies = {
      database, sheetRepository: sheets, realtimeEventRepository: realtime,
      publishPersistedRealtimeEvent: () => {},
    }
    const day = 24 * 60 * 60_000
    advanceCampaignDayUseCase({}, { ...dependencies, now: () => 1_000 })
    let current = sheets.getByRef('pokemon', 'shuckle')?.sheet as Record<string, unknown>
    expect(current.items).toEqual({ held: 'Oran Berry' })
    expect(current.capabilityCampaignState).toMatchObject({
      storedItems: [{
        canonicalItemId: 'oran-berry', stage: 'berry', remainingDayAdvances: 1,
        custodyStartedAt: 1_000, custodyFingerprint: expect.stringMatching(/^juicer-custody:/),
      }],
    })
    advanceCampaignDayUseCase({}, { ...dependencies, now: () => 1_000 + day - 1 })
    current = sheets.getByRef('pokemon', 'shuckle')?.sheet as Record<string, unknown>
    expect(current.items).toEqual({ held: 'Oran Berry' })
    expect(current.capabilityCampaignState).toMatchObject({
      storedItems: [{ canonicalItemId: 'oran-berry', stage: 'berry' }],
    })
    advanceCampaignDayUseCase({}, { ...dependencies, now: () => 1_000 + day })
    current = sheets.getByRef('pokemon', 'shuckle')?.sheet as Record<string, unknown>
    expect(current.items).toEqual({ held: '' })
    expect(current.capabilityCampaignState).toMatchObject({
      storedItems: [{ canonicalItemId: 'shuckles-berry-juice', stage: 'berry-juice', remainingDayAdvances: 14 }],
    })
    const shellId = ((current.capabilityCampaignState as CharacterSheet['capabilityCampaignState'])?.storedItems[0])?.id
    const currentRevision = current.revision as number
    expect(sheets.applyLivePlayUpdate({
      kind: 'pokemon', slug: 'shuckle', expectedRevision: currentRevision,
      nextSheet: { ...current, items: { held: 'Potion' }, updatedAt: 1_000 + day + 1 },
      sourceOperationId: 'equip-potion-after-juice',
    })).toBe('applied')
    current = sheets.getByRef('pokemon', 'shuckle')?.sheet as Record<string, unknown>
    expect(current.items).toEqual({ held: 'Potion' })
    expect((current.capabilityCampaignState as CharacterSheet['capabilityCampaignState'])?.storedItems[0]?.id).toBe(shellId)

    advanceCampaignDayUseCase({}, { ...dependencies, now: () => 1_000 + 15 * day })
    current = sheets.getByRef('pokemon', 'shuckle')?.sheet as Record<string, unknown>
    expect(current.items).toEqual({ held: 'Potion' })
    expect(current.capabilityCampaignState).toMatchObject({
      storedItems: [{ canonicalItemId: 'rare-candy', stage: 'rare-candy', remainingDayAdvances: 0, id: shellId }],
    })
  })

  it('enrolls and resets Juicer custody at authoritative held-item persistence mutations', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.saveSetupSheet('pokemon', 'shuckle', {
      slug: 'shuckle', nickname: 'Shuckle', species: 'Shuckle', level: 20, revision: 1,
      items: { held: 'Oran Berry' },
    })
    const first = sheets.getByRef('pokemon', 'shuckle')!
    expect(sheets.applyLivePlayUpdate({
      kind: 'pokemon', slug: 'shuckle', expectedRevision: first.revision,
      nextSheet: { ...first.sheet, combat: { currentHp: 10 }, updatedAt: 100 },
      sourceOperationId: 'authoritative-first-observation',
    })).toBe('applied')
    const enrolled = sheets.getByRef('pokemon', 'shuckle')!
    const firstCustody = (enrolled.sheet as unknown as CharacterSheet).capabilityCampaignState?.storedItems[0]
    expect(firstCustody).toMatchObject({ canonicalItemId: 'oran-berry', custodyStartedAt: 100 })

    expect(sheets.applyLivePlayUpdate({
      kind: 'pokemon', slug: 'shuckle', expectedRevision: enrolled.revision,
      nextSheet: { ...enrolled.sheet, items: { held: '' }, updatedAt: 200 },
      sourceOperationId: 'authoritative-remove-oran',
    })).toBe('applied')
    const removed = sheets.getByRef('pokemon', 'shuckle')!
    expect((removed.sheet as unknown as CharacterSheet).capabilityCampaignState?.storedItems ?? []).toEqual([])

    expect(sheets.applyLivePlayUpdate({
      kind: 'pokemon', slug: 'shuckle', expectedRevision: removed.revision,
      nextSheet: { ...removed.sheet, items: { held: 'Oran Berry' }, updatedAt: 300 },
      sourceOperationId: 'authoritative-same-name-replacement',
    })).toBe('applied')
    const replacement = (sheets.getByRef('pokemon', 'shuckle')!.sheet as unknown as CharacterSheet)
      .capabilityCampaignState?.storedItems[0]
    expect(replacement).toMatchObject({ canonicalItemId: 'oran-berry', custodyStartedAt: 300 })
    expect(replacement?.custodyFingerprint).not.toBe(firstCustody?.custodyFingerprint)
  })

  it('materializes Juicer at the exact elapsed boundary on an unrelated authoritative persistence', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.saveSetupSheet('pokemon', 'shuckle', {
      slug: 'shuckle', nickname: 'Shuckle', species: 'Shuckle', level: 20, revision: 1,
      items: { held: 'Oran Berry' },
    })
    const initial = sheets.getByRef('pokemon', 'shuckle')!
    expect(sheets.applyLivePlayUpdate({
      kind: 'pokemon', slug: 'shuckle', expectedRevision: initial.revision,
      nextSheet: { ...initial.sheet, updatedAt: 100 }, sourceOperationId: 'observe-held-berry',
    })).toBe('applied')
    const enrolled = sheets.getByRef('pokemon', 'shuckle')!
    expect(sheets.applyLivePlayUpdate({
      kind: 'pokemon', slug: 'shuckle', expectedRevision: enrolled.revision,
      nextSheet: { ...enrolled.sheet, combat: { currentHp: 9 }, updatedAt: 100 + JUICER_BERRY_ELAPSED_MS - 1 },
      sourceOperationId: 'before-boundary',
    })).toBe('applied')
    const before = sheets.getByRef('pokemon', 'shuckle')!
    expect((before.sheet as unknown as CharacterSheet).items?.held).toBe('Oran Berry')
    expect((before.sheet as unknown as CharacterSheet).capabilityCampaignState?.storedItems[0])
      .toMatchObject({ stage: 'berry', canonicalItemId: 'oran-berry' })

    expect(sheets.applyLivePlayUpdate({
      kind: 'pokemon', slug: 'shuckle', expectedRevision: before.revision,
      nextSheet: { ...before.sheet, combat: { currentHp: 10 }, updatedAt: 100 + JUICER_BERRY_ELAPSED_MS },
      sourceOperationId: 'exact-boundary',
    })).toBe('applied')
    const after = sheets.getByRef('pokemon', 'shuckle')!
    expect((after.sheet as unknown as CharacterSheet).items?.held).toBe('')
    expect((after.sheet as unknown as CharacterSheet).capabilityCampaignState?.storedItems[0])
      .toMatchObject({ stage: 'berry-juice', canonicalItemId: 'shuckles-berry-juice' })
  })

  it('cancels Juicer conversion authority when the exact held item leaves custody', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    sheets.saveSetupSheet('pokemon', 'shuckle', {
      slug: 'shuckle', nickname: 'Shuckle', species: 'Shuckle', level: 20, revision: 1,
      items: { held: 'Potion' },
      capabilityCampaignState: {
        schemaVersion: 1,
        storedItems: [{
          id: 'stored-berry', kind: 'juicer', canonicalItemId: 'Oran Berry', stage: 'berry',
          storedAt: 100, remainingDayAdvances: 1, sourceOperationId: 'store-berry',
        }],
        planter: null,
        letterPress: null,
      },
    })
    advanceCampaignDayUseCase({}, {
      database, sheetRepository: sheets, realtimeEventRepository: realtime, now: () => 1_000,
      publishPersistedRealtimeEvent: () => {},
    })
    const current = sheets.getByRef('pokemon', 'shuckle')?.sheet as Record<string, unknown>
    expect(current.items).toEqual({ held: 'Potion' })
    expect(current).not.toHaveProperty('capabilityCampaignState')
  })

  it('does not heal only one endpoint of an exact-source As One pair', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const maps = createSqliteMapRepository<TabletopMap>(database)
    const modes = createSqliteMapInteractionModeRepository(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const owner: CharacterSheet = {
      slug: 'calyrex', nickname: 'Calyrex', species: 'Calyrex', level: 20, revision: 1,
      stats: { hp: { added: 20 } }, capabilities: { other: ['As One'] },
      combat: { currentHp: 0, injuries: 0, conditions: [] }, movelist: [],
    }
    const mount: CharacterSheet = {
      slug: 'glastrier', nickname: 'Glastrier', species: 'Glastrier', level: 20, revision: 1,
      stats: { hp: { added: 20 } }, combat: { currentHp: 0, injuries: 6, conditions: [] }, movelist: [],
    }
    const ownerPlacement = {
      id: 'owner-token', sheetKind: 'pokemon' as const, sheetSlug: owner.slug,
      position: { x: 0, y: 0, z: 0 },
    }
    const mountPlacement = {
      id: 'mount-token', sheetKind: 'pokemon' as const, sheetSlug: mount.slug,
      position: { x: 1, y: 0, z: 0 },
    }
    const encounter = createEmptyEncounterState()
    const unlinkedMap: TabletopMap = {
      schemaVersion: 2, slug: 'arena', name: 'Arena', folder: '', revision: 4,
      dimensions: { x: 6, y: 2, z: 6 }, playerVisible: true, voxels: [],
      placements: [ownerPlacement, mountPlacement], lights: [],
      initiative: { activeId: null, round: 1 }, encounterState: encounter,
    }
    const asOne = resolveEffectiveCapabilities({
      map: unlinkedMap,
      placement: ownerPlacement,
      sheet: owner,
    }).instances.find(instance => instance.canonicalId === 'As One' && instance.effective)
    if (!asOne) throw new Error('missing As One campaign-day fixture source')
    const map: TabletopMap = {
      ...unlinkedMap,
      encounterState: {
        ...encounter,
        capabilityRuntime: {
          ...encounter.capabilityRuntime!,
          links: [{
            id: 'as-one-campaign-day-link', kind: 'as-one-mount',
            ownerPlacementId: ownerPlacement.id, participantPlacementIds: [mountPlacement.id],
            capabilityInstanceId: asOne.instanceId, canonicalId: 'As One',
            configurationId: 'Chilling Neigh', establishedAt: 100,
            sourceOperationId: 'as-one-operation',
          }],
        },
      },
    }
    sheets.saveSetupSheet('pokemon', owner.slug, owner as unknown as Record<string, unknown>)
    sheets.saveSetupSheet('pokemon', mount.slug, mount as unknown as Record<string, unknown>)
    maps.saveSetupMap(map)
    modes.set({ slug: map.slug, interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, updatedAt: 100 })

    const result = advanceCampaignDayUseCase({}, {
      database, sheetRepository: sheets, mapRepository: maps, modeRepository: modes,
      realtimeEventRepository: realtime, now: () => 750,
      publishPersistedRealtimeEvent: () => {},
    })

    expect(sheets.getByRef('pokemon', owner.slug)).toMatchObject({
      revision: 1,
      sheet: { combat: { currentHp: 0, injuries: 0 } },
    })
    expect(sheets.getByRef('pokemon', mount.slug)).toMatchObject({
      revision: 2,
      sheet: { combat: { currentHp: 0, injuries: 5 } },
    })
    expect(result.hitPointsRestored).toBe(0)
    expect(result.injuriesHealed).toBe(1)
  })

  it('atomically heals a fainted Crowned owner while permanently ending Crowned mode', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const maps = createSqliteMapRepository<TabletopMap>(database)
    const modes = createSqliteMapInteractionModeRepository(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const zacian: CharacterSheet = {
      slug: 'zacian', nickname: 'Zacian', species: 'Zacian', level: 20, revision: 1,
      stats: { hp: { added: 20 } }, capabilities: { other: ['Weapon Bond'] },
      combat: { currentHp: 0, injuries: 0, conditions: [] }, movelist: [],
    }
    const placement = {
      id: 'zacian-token', sheetKind: 'pokemon' as const, sheetSlug: 'zacian',
      position: { x: 0, y: 0, z: 0 },
    }
    const encounter = createEmptyEncounterState()
    const baseMap: TabletopMap = {
      schemaVersion: 2, slug: 'arena', name: 'Arena', folder: '', revision: 4,
      dimensions: { x: 6, y: 2, z: 6 }, playerVisible: true, voxels: [],
      placements: [placement], lights: [], initiative: { activeId: null, round: 1 },
      encounterState: encounter,
    }
    const weaponBond = resolveEffectiveCapabilities({
      map: baseMap,
      placement,
      sheet: zacian,
    }).instances.find(instance => instance.canonicalId === 'Weapon Bond' && instance.effective)
    if (!weaponBond) throw new Error('missing Weapon Bond campaign-day fixture source')
    const map: TabletopMap = {
      ...baseMap,
      encounterState: {
        ...encounter,
        capabilityRuntime: {
          ...encounter.capabilityRuntime!,
          modes: [{
            id: 'crowned-mode', actorPlacementId: placement.id,
            capabilityInstanceId: weaponBond.instanceId, canonicalId: 'Weapon Bond', mode: 'crowned',
            description: null, configurationId: null, activatedAt: 100, expiresAt: null,
            sourceOperationId: 'crowned-operation',
          }],
        },
      },
    }
    sheets.saveSetupSheet('pokemon', 'zacian', zacian as unknown as Record<string, unknown>)
    maps.saveSetupMap(map)
    modes.set({ slug: map.slug, interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, updatedAt: 100 })

    expect(() => advanceCampaignDayUseCase({}, {
      database, sheetRepository: sheets, mapRepository: maps, modeRepository: modes,
      realtimeEventRepository: {
        database,
        appendMany: () => { throw new Error('campaign invariant event failure') },
      },
      now: () => 800,
    })).toThrow('campaign invariant event failure')
    expect(sheets.getByRef('pokemon', 'zacian')).toMatchObject({
      revision: 1,
      sheet: { combat: { currentHp: 0 } },
    })
    expect(maps.getBySlug('arena')).toMatchObject({
      revision: 4,
      encounterState: { capabilityRuntime: { modes: [{ id: 'crowned-mode' }] } },
    })

    const result = advanceCampaignDayUseCase({}, {
      database, sheetRepository: sheets, mapRepository: maps, modeRepository: modes,
      realtimeEventRepository: realtime, now: () => 801,
      publishPersistedRealtimeEvent: () => {},
    })
    expect(result).toMatchObject({ updatedSheets: 1, hitPointsRestored: expect.any(Number) })
    expect((sheets.getByRef('pokemon', 'zacian')?.sheet as unknown as CharacterSheet)
      .combat?.currentHp).toBeGreaterThan(0)
    expect(maps.getBySlug('arena')).toMatchObject({
      revision: 5,
      updatedAt: 801,
      encounterState: { capabilityRuntime: { modes: [] } },
    })
    expect(result.realtimeEvents.map(event => event.event.channel)).toEqual([
      'sheet:pokemon:zacian', 'sheets', 'map:arena', 'maps',
    ])
  })

  it('applies suppression-aware Soulless healing and clears map-owned Temporary HP', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const maps = createSqliteMapRepository<TabletopMap>(database)
    const modes = createSqliteMapInteractionModeRepository(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const effective: CharacterSheet = {
      slug: 'effective-shedinja', nickname: 'Effective', species: 'Shedinja', level: 20, revision: 1,
      stats: { hp: { added: 20 } }, combat: { currentHp: 1, injuries: 3, conditions: [] }, movelist: [],
    }
    const suppressed: CharacterSheet = {
      slug: 'suppressed-shedinja', nickname: 'Suppressed', species: 'Shedinja', level: 20, revision: 1,
      stats: { hp: { added: 20 } }, combat: { currentHp: 10, injuries: 2, conditions: [] }, movelist: [],
    }
    const effectivePlacement = {
      id: 'effective-token', sheetKind: 'pokemon' as const, sheetSlug: effective.slug,
      position: { x: 0, y: 0, z: 0 },
    }
    const suppressedPlacement = {
      id: 'suppressed-token', sheetKind: 'pokemon' as const, sheetSlug: suppressed.slug,
      position: { x: 1, y: 0, z: 0 },
    }
    const encounter = createEmptyEncounterState()
    const suppression = parseEncounterEffect({
      id: 'suppress-soulless-campaign-day', kind: 'capability',
      source: { operationId: 'suppression-operation', moveId: 'test.suppression', placementId: suppressedPlacement.id },
      affected: { placementIds: [suppressedPlacement.id], sideIds: [], cells: [] },
      createdRound: 1, createdTurn: 0, duration: { kind: 'scene', remaining: null },
      stacks: 1, charges: null, stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null }, tags: ['capability-suppression'],
      payload: { capabilityId: 'soulless', action: 'suppress' },
      dispel: { policy: 'none', tags: [] }, transferPolicy: 'expire', suppression: { sources: [] },
    })
    const activeScene = { name: 'Battle', startedAt: 100 }
    const map: TabletopMap = {
      schemaVersion: 2, slug: 'arena', name: 'Arena', folder: '', revision: 4,
      dimensions: { x: 6, y: 2, z: 6 }, playerVisible: true, voxels: [],
      placements: [effectivePlacement, suppressedPlacement], lights: [],
      initiative: { activeId: null, round: 1 }, activeScene,
      temporaryHitPoints: { scene: activeScene, byPlacementId: { [effectivePlacement.id]: 8 } },
      encounterState: { ...encounter, effects: [suppression] },
    }
    expect(computePokemonHealingVitals(suppressed, { effectiveSoulless: false }).maxHp).toBeGreaterThan(10)
    sheets.saveSetupSheet('pokemon', effective.slug, effective as unknown as Record<string, unknown>)
    sheets.saveSetupSheet('pokemon', suppressed.slug, suppressed as unknown as Record<string, unknown>)
    maps.saveSetupMap(map)
    modes.set({ slug: map.slug, interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, updatedAt: 100 })

    advanceCampaignDayUseCase({}, {
      database, sheetRepository: sheets, mapRepository: maps, modeRepository: modes,
      realtimeEventRepository: realtime, now: () => 900,
      publishPersistedRealtimeEvent: () => {},
    })

    const effectiveAfter = sheets.getByRef('pokemon', effective.slug)?.sheet as unknown as CharacterSheet
    const suppressedAfter = sheets.getByRef('pokemon', suppressed.slug)?.sheet as unknown as CharacterSheet
    expect(effectiveAfter.combat).toMatchObject({ currentHp: 1, injuries: 0 })
    expect(suppressedAfter.combat?.injuries).toBe(1)
    expect(suppressedAfter.combat?.currentHp).toBeGreaterThan(10)
    expect(maps.getBySlug('arena')).toMatchObject({ revision: 5 })
    expect(maps.getBySlug('arena')?.temporaryHitPoints).toBeUndefined()
  })

  it('atomically advances the singleton clock, expires due effects on every persisted map, and replays one logical day', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const maps = createSqliteMapRepository<TabletopMap>(database)
    const modes = createSqliteMapInteractionModeRepository(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const clock = createSqliteCampaignClockRepository(database)
    const operations = createSqliteCampaignDayOperationRepository(database)
    const state = createEmptyEncounterState()
    maps.saveSetupMap({
      schemaVersion: 2,
      slug: 'archive-map',
      name: 'Archive Map',
      folder: '',
      revision: 7,
      dimensions: { x: 4, y: 2, z: 4 },
      playerVisible: false,
      voxels: [],
      placements: [],
      lights: [],
      initiative: { activeId: null, round: 1 },
      encounterState: {
        ...state,
        effects: [
          campaignTimeEffect({ id: 'effect.daily.one', startedAtCampaignMinute: 0, durationMinutes: 1_440 }),
          campaignTimeEffect({ id: 'effect.daily.two', startedAtCampaignMinute: 0, durationMinutes: 2_880 }),
        ],
      },
    })
    modes.set({
      slug: 'archive-map',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      updatedAt: 101,
    })
    expect(modes.get('archive-map').interactionMode).toBe(MAP_INTERACTION_MODES.SETUP_EDIT)
    const command = campaignDayCommand('a')
    const first = advanceCampaignDayUseCase({ command, clientId: 'gm-client' }, {
      database, sheetRepository: sheets, mapRepository: maps, modeRepository: modes,
      realtimeEventRepository: realtime, campaignClockRepository: clock,
      campaignDayOperationRepository: operations, now: () => 1_000,
      publishPersistedRealtimeEvent: () => {},
    })

    expect(first).toMatchObject({
      ok: true,
      operationId: command.operationId,
      replayed: false,
      campaignClock: {
        previousRevision: 0,
        revision: 1,
        previousCampaignMinute: 0,
        campaignMinute: 1_440,
        minutesAdvanced: 1_440,
        clockOperationId: expect.stringMatching(/^breeding-operation:v1:[0-9a-f]{32}$/),
      },
      expiredEffects: [{
        mapSlug: 'archive-map',
        effectId: 'effect.daily.one',
        durationKind: 'campaign-time',
        expiresAtCampaignMinute: 1_440,
      }],
    })
    expect(clock.get()).toMatchObject({ revision: 1, campaignMinute: 1_440 })
    expect(maps.getBySlug('archive-map')).toMatchObject({
      revision: 8,
      encounterState: { effects: [{ id: 'effect.daily.two' }] },
    })
    const { replayed: _replayed, realtimeEvents: _events, paths: _paths, ...acceptedEvidence } = first
    expect(operations.get(command.operationId)?.result).toEqual(acceptedEvidence)
    expect(database.connection.prepare(`
      SELECT status, command_kind FROM breeding_operations WHERE operation_id = ?
    `).get(first.campaignClock.clockOperationId)).toEqual({
      status: 'accepted', command_kind: 'advance-campaign-clock',
    })

    const eventCount = realtime.readAfter({ afterSequence: 0 }).events.length
    const replay = advanceCampaignDayUseCase({ command, clientId: 'other-client' }, {
      database, sheetRepository: sheets, mapRepository: maps, modeRepository: modes,
      realtimeEventRepository: realtime, campaignClockRepository: clock,
      campaignDayOperationRepository: operations, now: () => 9_999,
      publishPersistedRealtimeEvent: () => {},
    })
    expect(replay).toEqual({
      ...first,
      replayed: true,
      realtimeEvents: [],
      paths: [],
    })
    expect(clock.get()).toMatchObject({ revision: 1, campaignMinute: 1_440 })
    expect(maps.getBySlug('archive-map')?.revision).toBe(8)
    expect(realtime.readAfter({ afterSequence: 0 }).events).toHaveLength(eventCount)

    const second = advanceCampaignDayUseCase({ command: campaignDayCommand('b') }, {
      database, sheetRepository: sheets, mapRepository: maps, modeRepository: modes,
      realtimeEventRepository: realtime, campaignClockRepository: clock,
      campaignDayOperationRepository: operations, now: () => 2_000,
      publishPersistedRealtimeEvent: () => {},
    })
    expect(second.campaignClock).toMatchObject({
      previousRevision: 1, revision: 2,
      previousCampaignMinute: 1_440, campaignMinute: 2_880,
    })
    expect(second.expiredEffects.map(value => value.effectId)).toEqual(['effect.daily.two'])
    expect(maps.getBySlug('archive-map')).toMatchObject({ revision: 9, encounterState: { effects: [] } })
  })

  it('materializes expired Re-Breather equipment state during the one-day campaign-clock transaction', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const maps = createSqliteMapRepository<TabletopMap>(database)
    const modes = createSqliteMapInteractionModeRepository(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const clock = createSqliteCampaignClockRepository(database)
    const operations = createSqliteCampaignDayOperationRepository(database)
    const baseEquipment = activeEquipmentState({
      ownerKind: 'trainer', ownerSlug: 'brock', slotId: 'head', canonicalItemId: 'Re-Breather',
    })
    const activeState = parseItemReBreatherState({
      schemaVersion: 1, mode: 'active', activeFromCampaignMinute: 0, activeUntilCampaignMinute: 60,
      refillStartedAtCampaignMinute: null, refillCompletesAtCampaignMinute: null,
      lastTransition: {
        requestId: 'item-guided:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', transition: 'activated', campaignMinute: 0,
      },
    })
    sheets.save({
      kind: 'trainer', slug: 'brock', revision: 3, updatedAt: 10,
      document: {
        ...changedTrainer(),
        equipmentState: {
          ...baseEquipment,
          instances: baseEquipment.instances.map(instance => ({
            ...instance, serializedState: { ...instance.serializedState, reBreather: activeState },
          })),
        },
      },
    })
    advanceCampaignDayUseCase({ command: campaignDayCommand('d') }, {
      database, sheetRepository: sheets, mapRepository: maps, modeRepository: modes,
      realtimeEventRepository: realtime, campaignClockRepository: clock,
      campaignDayOperationRepository: operations, now: () => 1_000,
      publishPersistedRealtimeEvent: () => {},
    })
    const persisted = sheets.getByRef('trainer', 'brock')!.sheet as any
    expect(parseItemReBreatherState(persisted.equipmentState.instances[0].serializedState.reBreather)).toMatchObject({
      mode: 'depleted', activeFromCampaignMinute: null, activeUntilCampaignMinute: null,
      lastTransition: { transition: 'depleted', campaignMinute: 60 },
    })
    expect(persisted.equipmentState).toMatchObject({ revision: baseEquipment.revision + 1 })
  })

  it('atomically reconciles credited and paused Eggs with daily expiry and exact replay', () => {
    const database = db()
    const creditedEggId = seedCampaignDayEgg(database, 301, false)
    const pausedEggId = seedCampaignDayEgg(database, 302, true)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const operations = createSqliteCampaignDayOperationRepository(database)
    const command = campaignDayCommand('c')

    const first = advanceCampaignDayUseCase({ command }, {
      database,
      realtimeEventRepository: realtime,
      campaignDayOperationRepository: operations,
      now: () => 50_000,
      publishPersistedRealtimeEvent: () => {},
    })

    expect(first.campaignClock).toMatchObject({
      reconciledEggs: 2,
      creditedEggCampaignMinutes: 1_440,
      skippedPausedEggCampaignMinutes: 1_440,
      eggBatchComplete: true,
    })
    const eggs = createSqlitePokemonEggRepository(database)
    expect(eggs.get(creditedEggId)).toMatchObject({
      revision: 1,
      incubation: {
        accumulatedCampaignMinutes: 1_440,
        lastAppliedClockRevision: 1,
        lastAppliedClockMinute: 1_440,
        paused: false,
      },
    })
    expect(eggs.get(pausedEggId)).toMatchObject({
      revision: 1,
      incubation: {
        accumulatedCampaignMinutes: 0,
        lastAppliedClockRevision: 1,
        lastAppliedClockMinute: 1_440,
        paused: true,
      },
    })
    const eggOperationRows = database.connection.prepare(`
      SELECT operation_id, status FROM breeding_operations
      WHERE command_kind = 'advance-egg-incubation'
      ORDER BY operation_id
    `).all() as Array<{ readonly operation_id: string, readonly status: string }>
    expect(eggOperationRows).toHaveLength(2)
    expect(eggOperationRows.every(row => row.status === 'accepted')).toBe(true)
    const segments = createSqliteBreedingIncubationSegmentRepository(database)
    expect(eggOperationRows.map(row => segments.get(row.operation_id))).toMatchObject([
      expect.objectContaining({ throughClockRevision: 1, throughCampaignMinute: 1_440 }),
      expect.objectContaining({ throughClockRevision: 1, throughCampaignMinute: 1_440 }),
    ])
    expect(realtime.readAfter({ afterSequence: 0 }).events).toHaveLength(8)
    const archiveRecords = createSqliteBreedingArchiveStateRepository(database)
      .readRecords({ purpose: 'campaign-backup' })
    const archivedCommands = archiveRecords['operation-command'] ?? []
    const archivedResults = archiveRecords['operation-result'] ?? []
    expect(archivedCommands.some(record => (
      'operationId' in record && record.operationId === first.campaignClock.clockOperationId
    ))).toBe(true)
    expect(eggOperationRows.every(row => archivedCommands.some(record => (
      'operationId' in record && record.operationId === row.operation_id
    )))).toBe(true)
    expect(eggOperationRows.every(row => archivedResults.some(record => (
      'operationId' in record && record.operationId === row.operation_id
    )))).toBe(true)

    const replay = advanceCampaignDayUseCase({ command }, {
      database,
      realtimeEventRepository: realtime,
      campaignDayOperationRepository: operations,
      now: () => 99_000,
      publishPersistedRealtimeEvent: () => {},
    })
    expect(replay).toEqual({ ...first, replayed: true, realtimeEvents: [], paths: [] })
    expect(eggs.get(creditedEggId)?.revision).toBe(1)
    expect(eggs.get(pausedEggId)?.revision).toBe(1)
    expect(realtime.readAfter({ afterSequence: 0 }).events).toHaveLength(8)
  })

  it('credits an exact assigned Egg Warmer item unit at twice the campaign-day hatch rate', () => {
    const database = db()
    const eggId = seedCampaignDayEgg(database, 304, false)
    const trainerSlug = 'trainer-owner-304'
    createSqliteSheetRepository<Record<string, unknown>>(database).saveSetupSheet('trainer', trainerSlug, {
      slug: trainerSlug,
      name: 'Warmer Keeper',
      level: 10,
      currentTeam: [],
      boxedPokemon: [],
      inventory: { keyItems: [{ id: 'egg-warmer-row', name: 'Egg Warmer', qty: 1 }] },
      serverPrivate: {
        itemBreeding: {
          schemaVersion: 1,
          eggWarmerAssignments: [{
            inventoryEntryId: 'egg-warmer-row',
            unitOrdinal: 0,
            eggIds: [eggId],
            assignedAtCampaignMinute: 0,
            lastOperationId: `item-breeding:v1:${'a'.repeat(32)}`,
          }],
        },
      },
    })

    const result = advanceCampaignDayUseCase({ command: campaignDayCommand('e') }, {
      database,
      now: () => 3_040,
      publishPersistedRealtimeEvent: () => {},
    })

    expect(result.campaignClock).toMatchObject({
      reconciledEggs: 1,
      creditedEggCampaignMinutes: 2_880,
      skippedPausedEggCampaignMinutes: 0,
    })
    expect(createSqlitePokemonEggRepository(database).get(eggId)).toMatchObject({
      revision: 1,
      incubation: { accumulatedCampaignMinutes: 2_880, lastAppliedClockRevision: 1 },
    })
    expect(createSqliteBreedingIncubationSegmentRepository(database).listByEgg(eggId)[0]).toMatchObject({
      elapsedCampaignMinutes: 1_440,
      creditedCampaignMinutes: 2_880,
      modifierMode: 'authoritative-rate',
    })
  })

  it('fails closed to the ordinary rate when assigned Egg Warmer custody is no longer current', () => {
    const database = db()
    const eggId = seedCampaignDayEgg(database, 305, false)
    const trainerSlug = 'trainer-owner-305'
    createSqliteSheetRepository<Record<string, unknown>>(database).saveSetupSheet('trainer', trainerSlug, {
      slug: trainerSlug,
      name: 'Former Warmer Keeper',
      level: 10,
      currentTeam: [],
      boxedPokemon: [],
      inventory: { keyItems: [] },
      serverPrivate: {
        itemBreeding: {
          schemaVersion: 1,
          eggWarmerAssignments: [{
            inventoryEntryId: 'missing-warmer-row',
            unitOrdinal: 0,
            eggIds: [eggId],
            assignedAtCampaignMinute: 0,
            lastOperationId: `item-breeding:v1:${'b'.repeat(32)}`,
          }],
        },
      },
    })

    const result = advanceCampaignDayUseCase({ command: campaignDayCommand('f') }, {
      database,
      now: () => 3_050,
      publishPersistedRealtimeEvent: () => {},
    })

    expect(result.campaignClock.creditedEggCampaignMinutes).toBe(1_440)
    expect(createSqlitePokemonEggRepository(database).get(eggId)?.incubation.accumulatedCampaignMinutes).toBe(1_440)
    expect(createSqliteBreedingIncubationSegmentRepository(database).listByEgg(eggId)[0]).toMatchObject({
      elapsedCampaignMinutes: 1_440,
      creditedCampaignMinutes: 1_440,
      modifierMode: 'base-rate-only',
    })
  })

  it('reconciles every due Egg beyond the ordinary 100-Egg continuation page in one accepted day', () => {
    const database = db()
    const eggIds = Array.from({ length: 101 }, (_, index) => (
      seedCampaignDayEgg(database, 1_000 + index, index === 100)
    ))
    const command = campaignDayCommand('e')

    const result = advanceCampaignDayUseCase({ command }, {
      database,
      now: () => 55_000,
      publishPersistedRealtimeEvent: () => {},
    })

    expect(result.campaignClock).toMatchObject({
      reconciledEggs: 101,
      creditedEggCampaignMinutes: 100 * 1_440,
      skippedPausedEggCampaignMinutes: 1_440,
      eggBatchComplete: true,
    })
    const eggs = createSqlitePokemonEggRepository(database)
    expect(eggs.listIncubatingBehindClock({ revision: 1, campaignMinute: 1_440, limit: 100 }))
      .toEqual([])
    expect(eggIds.every(eggId => (
      eggs.get(eggId)?.incubation.lastAppliedClockRevision === 1
      && eggs.get(eggId)?.incubation.lastAppliedClockMinute === 1_440
    ))).toBe(true)
    expect(database.connection.prepare(`
      SELECT COUNT(*) AS count FROM breeding_operations
      WHERE command_kind = 'advance-egg-incubation' AND status = 'accepted'
    `).get()).toEqual({ count: 101 })
  })

  it('rolls back the clock, Egg checkpoints, receipt, and realtime when Egg settlement fails', () => {
    const database = db()
    const eggId = seedCampaignDayEgg(database, 303, false)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const operations = createSqliteCampaignDayOperationRepository(database)
    const command = campaignDayCommand('d')
    database.connection.exec(`
      CREATE TRIGGER reject_campaign_day_egg_segment
      BEFORE INSERT ON breeding_incubation_segments
      BEGIN
        SELECT RAISE(ABORT, 'campaign-day-egg-segment-failure');
      END;
    `)

    expect(() => advanceCampaignDayUseCase({ command }, {
      database,
      realtimeEventRepository: realtime,
      campaignDayOperationRepository: operations,
      now: () => 60_000,
      publishPersistedRealtimeEvent: () => {},
    })).toThrow('campaign-day-egg-segment-failure')

    expect(createSqliteCampaignClockRepository(database).get()).toMatchObject({
      revision: 0, campaignMinute: 0, lastOperationId: null,
    })
    expect(createSqlitePokemonEggRepository(database).get(eggId)).toMatchObject({
      revision: 0,
      incubation: { accumulatedCampaignMinutes: 0, lastAppliedClockRevision: 0 },
    })
    expect(operations.get(command.operationId)).toBeNull()
    expect(database.connection.prepare(`
      SELECT COUNT(*) AS count FROM breeding_operations
      WHERE command_kind IN ('advance-campaign-clock', 'advance-egg-incubation')
    `).get()).toEqual({ count: 0 })
    expect(realtime.readAfter({ afterSequence: 0 }).events).toEqual([])
  })

  it('keeps trusted direct-call identity deterministic at a fixed timestamp and advances on the successor clock', () => {
    const database = db()
    const operations = createSqliteCampaignDayOperationRepository(database)
    const dependencies = {
      database,
      campaignDayOperationRepository: operations,
      now: () => 42_000,
      publishPersistedRealtimeEvent: () => {},
    }

    const first = advanceCampaignDayUseCase({}, dependencies)
    const stored = operations.get(first.operationId)
    expect(stored).not.toBeNull()
    expect(first.operationId).toMatch(/^campaign-day:v1:[0-9a-f]{32}$/)
    expect(stored?.command.operationId).toBe(first.operationId)

    const exact = advanceCampaignDayUseCase({ command: stored!.command }, dependencies)
    expect(exact).toEqual({ ...first, replayed: true, realtimeEvents: [], paths: [] })

    const successor = advanceCampaignDayUseCase({}, dependencies)
    expect(successor.operationId).not.toBe(first.operationId)
    expect(successor.campaignClock).toMatchObject({
      previousRevision: 1, revision: 2,
      previousCampaignMinute: 1_440, campaignMinute: 2_880,
    })
  })

  it('rejects mixed-database repositories before planning the atomic day', () => {
    const database = db()
    const foreign = db()
    expect(() => advanceCampaignDayUseCase({}, {
      database,
      campaignClockRepository: createSqliteCampaignClockRepository(foreign),
    })).toThrow('Campaign-day clock repository must use the same RotomDatabase as the transaction')
    expect(createSqliteCampaignClockRepository(database).get()).toMatchObject({
      revision: 0, campaignMinute: 0, lastOperationId: null,
    })
    expect(createSqliteCampaignClockRepository(foreign).get()).toMatchObject({
      revision: 0, campaignMinute: 0, lastOperationId: null,
    })
  })

  it('advances clock authority even when sheet and effect reconciliation is otherwise a no-op', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const publish = vi.fn()

    const result = advanceCampaignDayUseCase({}, {
      database,
      sheetRepository: sheets,
      realtimeEventRepository: realtime,
      publishPersistedRealtimeEvent: publish,
    })

    expect(result).toMatchObject({
      ok: true,
      totalSheets: 0,
      updatedSheets: 0,
      replayed: false,
      campaignClock: {
        previousRevision: 0, revision: 1,
        previousCampaignMinute: 0, campaignMinute: 1_440,
      },
    })
    expect(createSqliteCampaignClockRepository(database).get()).toMatchObject({
      revision: 1, campaignMinute: 1_440,
    })
    expect(result.realtimeEvents).toEqual([])
    expect(result.paths).toEqual([])
    expect(publish).not.toHaveBeenCalled()
    expect(realtime.readAfter({ afterSequence: 0 }).events).toEqual([])
  })
})
