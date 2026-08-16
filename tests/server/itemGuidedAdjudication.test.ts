import { afterEach, describe, expect, it } from 'vitest'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import { parseBreedingOperationCommandV1 } from '#shared/breeding/operations'
import { parseItemReBreatherState } from '#shared/itemAutomation/guidedAdjudication'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { UseItemCommandV1 } from '#shared/itemAutomation/operations'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { activeEquipmentState } from '../fixtures/equipment'
import { resolveEquipmentGrants, equipmentGrantOwnerContext } from '../../server/domain/itemAutomation/equipmentGrants'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteItemGuidedRequestRepository } from '../../server/storage/itemGuidedRequestRepository'
import {
  loadItemGuidedAdjudicationUseCase,
  manageItemGuidedAdjudicationUseCase,
} from '../../server/useCases/manageItemGuidedAdjudication'
import { advanceBreedingCampaignClock } from '../../server/useCases/advanceBreedingCampaignClock'
import { executeItemOperationUseCase } from '../../server/useCases/executeItemOperation'
import { resumeItemOperationUseCase } from '../../server/useCases/resumeItemOperation'
import { buildEncounterPresentationProjection } from '../../server/domain/encounterPresentation/buildProjection'
import { resolveEffectiveCapabilities } from '../../server/domain/capabilityAutomation/effectiveCapabilities'
import { redactSheetRecordForPlayer } from '../../server/utils/sheetPrivacy'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}
afterEach(() => { while (databases.length) databases.pop()!.close() })

const profile = (): PlayerProfile => ({
  schemaVersion: 1,
  id: 'profile_guided01',
  displayName: 'Mira',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'mira' }],
})
const trainer = (): TrainerSheet => ({
  slug: 'mira', name: 'Mira', level: 12, revision: 4,
  equipmentState: activeEquipmentState({
    ownerKind: 'trainer', ownerSlug: 'mira', slotId: 'head', canonicalItemId: 'Re-Breather',
  }),
})
const saveTrainer = (database: RotomDatabase): void => {
  createSqliteSheetRepository<Record<string, unknown>>(database).save({
    kind: 'trainer', slug: 'mira', document: trainer() as unknown as Record<string, unknown>, revision: 4, updatedAt: 10,
  })
}
const readTrainer = (database: RotomDatabase): TrainerSheet => (
  createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('trainer', 'mira')!.sheet as unknown as TrainerSheet
)
const operationId = (value: number): string => `item-guided-operation:v1:${value.toString(16).padStart(32, '0')}`
const requestId = (value: number): string => `item-guided:v1:${value.toString(16).padStart(32, '0')}`
const clockCommand = (value: number, expectedRevision: number, target: number) => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`,
  commandKind: 'advance-campaign-clock',
  actor: { profileId: 'campaign-gm', selectedTrainerSlug: null },
  ruleset: {
    rulesetId: (rulesetJson as { rulesetId: string }).rulesetId,
    definitionSha256: (rulesetJson as { definitionSha256: string }).definitionSha256,
  },
  scopes: [{ kind: 'campaign-clock', expectedRevision }],
  payload: { targetCampaignMinute: target },
})

const reBreatherState = (sheet: TrainerSheet) => {
  const instance = sheet.equipmentState!.instances.find(value => value.canonicalItemId === 'Re-Breather')!
  return parseItemReBreatherState(instance.serializedState.reBreather)
}
const hasGilledGrant = (sheet: TrainerSheet): boolean => resolveEquipmentGrants({
  equipmentState: sheet.equipmentState,
  owner: equipmentGrantOwnerContext({ kind: 'trainer', slug: 'mira', sheet }),
}).active.some(value => value.grant.kind === 'capability' && value.grant.canonicalId === 'Gilled')

const pokemonProfile = (): PlayerProfile => ({
  schemaVersion: 1,
  id: 'profile_pokemon01',
  displayName: 'Kai',
  linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: 'bubbles' }],
})
const breatherPokemon = (): CharacterSheet => ({
  slug: 'bubbles', nickname: 'Bubbles', species: 'Squirtle', level: 8, revision: 2,
  equipmentState: activeEquipmentState({
    ownerKind: 'pokemon', ownerSlug: 'bubbles', slotId: 'held', canonicalItemId: 'Re-Breather',
  }),
})

const medicineTrainer = (): TrainerSheet => ({
  slug: 'ash', name: 'Ash', level: 10, revision: 3,
  inventory: {
    medicalKit: [{ id: 'energy-row', name: 'Energy Powder', qty: 2 }],
    keyItems: [
      { id: 'smoke-ball-row', name: 'Smoke Ball', qty: 2 },
      { id: 'magic-flute-row', name: 'Magic Flute', qty: 1 },
    ],
  },
})
const medicinePokemon = (): CharacterSheet => ({
  slug: 'sparky', nickname: 'Sparky', species: 'Pikachu', level: 5, revision: 2, loyalty: 3,
  stats: { hp: { added: 0 } }, combat: { currentHp: 7 },
})
const medicineMap = (): TabletopMap => ({
  schemaVersion: 2, slug: 'medicine-map', name: 'Medicine Map', revision: 4,
  dimensions: { x: 5, y: 3, z: 5 }, voxels: [], createdAt: 1, updatedAt: 10,
  placements: [
    { id: 'ash-placement', sheetKind: 'trainer', sheetSlug: 'ash', position: { x: 1, y: 0, z: 1 } },
    { id: 'sparky-placement', sheetKind: 'pokemon', sheetSlug: 'sparky', position: { x: 2, y: 0, z: 1 } },
  ],
  encounterState: {
    ...createEmptyEncounterState(),
    turnResources: { 'ash-placement': createEncounterTurnResourceLedger({ placementId: 'ash-placement', round: 1 }) },
  },
  initiative: { activeId: 'ash-placement', round: 1 },
})
const medicineProfile = (): PlayerProfile => ({
  schemaVersion: 1, id: 'profile_medicine1', displayName: 'Ash',
  linkedCharacters: [
    { sheetKind: 'trainer', sheetSlug: 'ash' },
    { sheetKind: 'pokemon', sheetSlug: 'sparky' },
  ],
})
const seedMedicine = (database: RotomDatabase): void => {
  createSqliteMapRepository<TabletopMap>(database).save({ slug: 'medicine-map', document: medicineMap(), revision: 4, updatedAt: 10 })
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  sheets.save({ kind: 'trainer', slug: 'ash', document: medicineTrainer() as unknown as Record<string, unknown>, revision: 3, updatedAt: 10 })
  sheets.save({ kind: 'pokemon', slug: 'sparky', document: medicinePokemon() as unknown as Record<string, unknown>, revision: 2, updatedAt: 10 })
}
const medicineOfferId = (): string => buildEncounterPresentationProjection({
  role: 'player', playerProfile: medicineProfile(), map: medicineMap(), mapRevision: 4,
  pokemonSheets: [medicinePokemon()], trainerSheets: [medicineTrainer()], generatedAt: 10,
}).offers.find(offer => offer.source.sourceKind === 'item' && offer.source.canonicalId === 'Energy Powder')!.offerId
const smokeBallOfferId = (): string => buildEncounterPresentationProjection({
  role: 'player', playerProfile: medicineProfile(), map: medicineMap(), mapRevision: 4,
  pokemonSheets: [medicinePokemon()], trainerSheets: [medicineTrainer()], generatedAt: 10,
}).offers.find(offer => offer.source.sourceKind === 'item' && offer.source.canonicalId === 'Smoke Ball')!.offerId
const smokeBallCommand = (id: string): UseItemCommandV1 => ({
  schemaVersion: 1,
  operationId: id,
  context: 'encounter',
  offerId: smokeBallOfferId(),
  sourceInstanceId: 'item-instance:trainer:ash:keyItems:smoke-ball-row',
  actorParticipantId: 'ash-placement',
  actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
  source: { kind: 'trainer', slug: 'ash', section: 'keyItems', rowId: 'smoke-ball-row', expectedRevision: 3 },
  targetIds: ['ash-placement'],
  choices: [{ choiceId: 'target', optionIds: ['ash-placement'] }],
  readSet: [
    { kind: 'map', id: 'medicine-map', revision: 4 },
    { kind: 'encounter', id: 'medicine-map', revision: 4 },
    { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
  ],
})
const magicFluteOfferId = (): string => buildEncounterPresentationProjection({
  role: 'player', playerProfile: medicineProfile(), map: medicineMap(), mapRevision: 4,
  pokemonSheets: [medicinePokemon()], trainerSheets: [medicineTrainer()], generatedAt: 10,
}).offers.find(offer => offer.source.sourceKind === 'item' && offer.source.canonicalId === 'Magic Flute')!.offerId
const magicFluteCommand = (id: string): UseItemCommandV1 => ({
  schemaVersion: 1,
  operationId: id,
  context: 'encounter',
  offerId: magicFluteOfferId(),
  sourceInstanceId: 'item-instance:trainer:ash:keyItems:magic-flute-row',
  actorParticipantId: 'ash-placement',
  actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
  source: { kind: 'trainer', slug: 'ash', section: 'keyItems', rowId: 'magic-flute-row', expectedRevision: 3 },
  targetIds: ['ash-placement'],
  choices: [{ choiceId: 'target', optionIds: ['ash-placement'] }],
  readSet: [
    { kind: 'map', id: 'medicine-map', revision: 4 },
    { kind: 'encounter', id: 'medicine-map', revision: 4 },
    { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
  ],
})
const medicineCommand = (id: string): UseItemCommandV1 => ({
  schemaVersion: 1,
  operationId: id,
  context: 'encounter',
  offerId: medicineOfferId(),
  sourceInstanceId: 'item-instance:trainer:ash:medicalKit:energy-row',
  actorParticipantId: 'ash-placement',
  actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
  source: { kind: 'trainer', slug: 'ash', section: 'medicalKit', rowId: 'energy-row', expectedRevision: 3 },
  targetIds: ['sparky-placement'],
  choices: [{ choiceId: 'target', optionIds: ['sparky-placement'] }],
  readSet: [
    { kind: 'map', id: 'medicine-map', revision: 4 },
    { kind: 'encounter', id: 'medicine-map', revision: 4 },
    { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
    { kind: 'sheet', sheetKind: 'pokemon', id: 'sparky', revision: 2 },
  ],
})

describe('guided item adjudication', () => {
  it('binds exact Re-Breather custody, activates once, depletes on campaign time, refills in confirmed open air, and replays safely', () => {
    const database = open()
    saveTrainer(database)
    const requestIds = [requestId(1), requestId(2)]
    const dependencies = {
      database,
      now: () => 100,
      requestId: () => requestIds.shift()!,
      publishPersistedRealtimeEvent: () => undefined,
    }

    const initial = loadItemGuidedAdjudicationUseCase({
      role: 'player', playerProfile: profile(), ownerKind: 'trainer', ownerSlug: 'mira',
    }, dependencies)
    expect(initial.requests).toEqual([])
    expect(initial.reBreatherOffers).toHaveLength(1)
    expect(initial.reBreatherOffers[0]).toMatchObject({ actionKind: 'activate', enabled: true, timingLabel: 'Standard Action' })

    const declaration = {
      schemaVersion: 1 as const,
      operationId: operationId(1),
      action: 'declare-re-breather' as const,
      ownerKind: 'trainer' as const,
      ownerSlug: 'mira',
      ownerRevision: 4,
      offerId: initial.reBreatherOffers[0]!.offerId,
    }
    const pending = manageItemGuidedAdjudicationUseCase({
      role: 'player', playerProfile: profile(), command: declaration,
    }, dependencies)
    expect(pending.result).toMatchObject({ exactReplay: false, request: { status: 'pending', choices: [], reservationLabel: 'Exact equipped Re-Breather reserved' } })
    expect(reBreatherState(readTrainer(database)).mode).toBe('ready')
    expect(hasGilledGrant(readTrainer(database))).toBe(false)
    expect(manageItemGuidedAdjudicationUseCase({
      role: 'player', playerProfile: profile(), command: declaration,
    }, dependencies).result.exactReplay).toBe(true)

    const gmProjection = loadItemGuidedAdjudicationUseCase({ role: 'gm' }, dependencies)
    expect(gmProjection.requests[0]?.choices).toEqual([expect.objectContaining({ optionId: 'activate-for-one-hour' })])
    const acceptance = {
      schemaVersion: 1 as const,
      operationId: operationId(2),
      action: 'resolve' as const,
      requestId: pending.result.request.requestId,
      expectedRevision: 0,
      optionId: 'activate-for-one-hour',
    }
    const accepted = manageItemGuidedAdjudicationUseCase({ role: 'gm', command: acceptance }, dependencies)
    expect(accepted.result).toMatchObject({ exactReplay: false, request: { status: 'accepted' } })
    expect(reBreatherState(readTrainer(database))).toMatchObject({ mode: 'active', activeFromCampaignMinute: 0, activeUntilCampaignMinute: 60 })
    expect(hasGilledGrant(readTrainer(database))).toBe(true)
    const activeTrainer = readTrainer(database)
    const capabilityMap: TabletopMap = {
      ...medicineMap(),
      slug: 're-breather-map',
      placements: [{ id: 'mira-placement', sheetKind: 'trainer', sheetSlug: 'mira', position: { x: 1, y: 0, z: 1 } }],
    }
    expect(resolveEffectiveCapabilities({
      map: capabilityMap,
      placement: capabilityMap.placements[0]!,
      sheet: activeTrainer,
    }).instances).toContainEqual(expect.objectContaining({ canonicalId: 'Gilled', effective: true }))
    expect(manageItemGuidedAdjudicationUseCase({ role: 'gm', command: acceptance }, dependencies).result.exactReplay).toBe(true)

    advanceBreedingCampaignClock(clockCommand(1, 0, 60), { database, now: () => 200, publishPersistedRealtimeEvent: () => undefined })
    expect(reBreatherState(readTrainer(database)).mode).toBe('depleted')
    expect(hasGilledGrant(readTrainer(database))).toBe(false)

    const depletedSheet = readTrainer(database)
    const refillProjection = loadItemGuidedAdjudicationUseCase({
      role: 'player', playerProfile: profile(), ownerKind: 'trainer', ownerSlug: 'mira',
    }, dependencies)
    expect(refillProjection.reBreatherOffers[0]).toMatchObject({ actionKind: 'begin-open-air-refill', enabled: true })
    const refillPending = manageItemGuidedAdjudicationUseCase({
      role: 'player', playerProfile: profile(),
      command: {
        schemaVersion: 1, operationId: operationId(3), action: 'declare-re-breather',
        ownerKind: 'trainer', ownerSlug: 'mira', ownerRevision: depletedSheet.revision!,
        offerId: refillProjection.reBreatherOffers[0]!.offerId,
      },
    }, dependencies)
    manageItemGuidedAdjudicationUseCase({
      role: 'gm',
      command: {
        schemaVersion: 1, operationId: operationId(4), action: 'resolve',
        requestId: refillPending.result.request.requestId, expectedRevision: 0,
        optionId: 'begin-open-air-refill',
      },
    }, dependencies)
    expect(reBreatherState(readTrainer(database))).toMatchObject({ mode: 'refilling', refillCompletesAtCampaignMinute: 65 })

    advanceBreedingCampaignClock(clockCommand(2, 1, 65), { database, now: () => 300, publishPersistedRealtimeEvent: () => undefined })
    expect(reBreatherState(readTrainer(database)).mode).toBe('ready')
    expect(hasGilledGrant(readTrainer(database))).toBe(false)
  })

  it('uses the same bounded self-activation authority for a controlled Pokémon-held Re-Breather', () => {
    const database = open()
    createSqliteSheetRepository<Record<string, unknown>>(database).save({
      kind: 'pokemon', slug: 'bubbles', document: breatherPokemon() as unknown as Record<string, unknown>, revision: 2, updatedAt: 10,
    })
    const dependencies = {
      database,
      now: () => 100,
      requestId: () => requestId(20),
      publishPersistedRealtimeEvent: () => undefined,
    }
    const initial = loadItemGuidedAdjudicationUseCase({
      role: 'player', playerProfile: pokemonProfile(), ownerKind: 'pokemon', ownerSlug: 'bubbles',
    }, dependencies)
    expect(initial.reBreatherOffers[0]).toMatchObject({ ownerKind: 'pokemon', actionKind: 'activate', enabled: true })
    const declaration = manageItemGuidedAdjudicationUseCase({
      role: 'player', playerProfile: pokemonProfile(),
      command: {
        schemaVersion: 1, operationId: operationId(20), action: 'declare-re-breather',
        ownerKind: 'pokemon', ownerSlug: 'bubbles', ownerRevision: 2,
        offerId: initial.reBreatherOffers[0]!.offerId,
      },
    }, dependencies)
    const queue = loadItemGuidedAdjudicationUseCase({ role: 'gm', playerProfile: null }, dependencies)
    const accepted = manageItemGuidedAdjudicationUseCase({
      role: 'gm', playerProfile: null,
      command: {
        schemaVersion: 1, operationId: operationId(21), action: 'resolve',
        requestId: declaration.result.request.requestId, expectedRevision: 0,
        optionId: queue.requests[0]!.choices[0]!.optionId,
      },
    }, dependencies)
    expect(accepted.sheets).toEqual([expect.objectContaining({ kind: 'pokemon', slug: 'bubbles', revision: 3 })])
    const sheet = createSqliteSheetRepository<Record<string, unknown>>(database)
      .getByRef('pokemon', 'bubbles')!.sheet as unknown as CharacterSheet
    const state = parseItemReBreatherState(sheet.equipmentState!.instances[0]!.serializedState.reBreather)
    expect(state.mode).toBe('active')
    expect(resolveEquipmentGrants({
      equipmentState: sheet.equipmentState,
      owner: equipmentGrantOwnerContext({ kind: 'pokemon', slug: 'bubbles', sheet }),
    }).active).toContainEqual(expect.objectContaining({
      grant: expect.objectContaining({ kind: 'capability', canonicalId: 'Gilled' }),
    }))
  })

  it('settles a reviewed interpretive combat tool through one bounded GM choice and private exact-source receipt', () => {
    const database = open()
    seedMedicine(database)
    const itemOperationId = 'guided_campaign_tool_operation_0001'
    const pending = executeItemOperationUseCase({
      role: 'player', playerProfile: medicineProfile(), command: smokeBallCommand(itemOperationId),
    }, {
      database, guidedRequestId: () => requestId(40), now: () => 100,
      publishPersistedRealtimeEvent: () => undefined,
    })
    expect(pending.result).toMatchObject({ status: 'pending', canonicalItemId: 'Smoke Ball' })
    const before = createSqliteSheetRepository<Record<string, unknown>>(database)
      .getByRef('trainer', 'ash')!.sheet as unknown as TrainerSheet
    expect(before.inventory?.keyItems?.[0]?.qty).toBe(2)

    const queue = loadItemGuidedAdjudicationUseCase({ role: 'gm' }, { database })
    expect(queue.requests).toEqual([expect.objectContaining({
      requestKind: 'campaign-tool-adjudication',
      itemLabel: 'Smoke Ball',
      actorLabel: 'Ash',
      targetLabel: 'Ash',
      reservationLabel: '1 Smoke Ball reserved',
      choices: [expect.objectContaining({ optionId: 'accept-reviewed-use' })],
    })])
    const resolveCommand = {
      schemaVersion: 1 as const,
      operationId: operationId(41),
      action: 'resolve' as const,
      requestId: queue.requests[0]!.requestId,
      expectedRevision: 0,
      optionId: 'accept-reviewed-use',
    }
    const accepted = manageItemGuidedAdjudicationUseCase({
      role: 'gm', command: resolveCommand,
    }, { database, now: () => 200, publishPersistedRealtimeEvent: () => undefined })
    expect(accepted.result.request).toMatchObject({
      status: 'accepted',
      acceptedSummary: 'Smoke Ball accepted. Reviewed use and exact source disposition recorded.',
    })
    const trainerAfter = createSqliteSheetRepository<Record<string, unknown>>(database)
      .getByRef('trainer', 'ash')!.sheet as unknown as TrainerSheet
    expect(trainerAfter.inventory?.keyItems?.[0]?.qty).toBe(1)
    expect(trainerAfter.serverPrivate?.itemGuidedCampaignTools).toMatchObject({
      receipts: [expect.objectContaining({
        sourceOperationId: itemOperationId,
        canonicalItemId: 'Smoke Ball',
        outcomeOptionId: 'accept-reviewed-use',
        sourceDisposition: 'consumed-one',
        decidedAt: 200,
      })],
    })
    expect(redactSheetRecordForPlayer('trainer', trainerAfter as unknown as Record<string, unknown>))
      .not.toHaveProperty('serverPrivate')
    expect(createSqliteMapRepository<TabletopMap>(database).get('medicine-map')!
      .document.encounterState?.turnResources?.['ash-placement']?.actions.standard?.spent).toBe(1)
    expect(manageItemGuidedAdjudicationUseCase({ role: 'gm', command: resolveCommand }, {
      database, now: () => 999, publishPersistedRealtimeEvent: () => undefined,
    }).result.exactReplay).toBe(true)
    const replayed = createSqliteSheetRepository<Record<string, unknown>>(database)
      .getByRef('trainer', 'ash')!.sheet as unknown as TrainerSheet
    expect(replayed.inventory?.keyItems?.[0]?.qty).toBe(1)
    expect(replayed.serverPrivate?.itemGuidedCampaignTools?.receipts).toHaveLength(1)
  })

  it('retains a reviewed reusable campaign tool while recording its bounded private receipt', () => {
    const database = open()
    seedMedicine(database)
    const itemOperationId = 'guided_campaign_tool_operation_0002'
    executeItemOperationUseCase({
      role: 'player', playerProfile: medicineProfile(), command: magicFluteCommand(itemOperationId),
    }, {
      database, guidedRequestId: () => requestId(42), now: () => 100,
      publishPersistedRealtimeEvent: () => undefined,
    })
    const request = loadItemGuidedAdjudicationUseCase({ role: 'gm' }, { database }).requests[0]!
    expect(request).toMatchObject({
      requestKind: 'campaign-tool-adjudication',
      itemLabel: 'Magic Flute',
      reservationLabel: 'Exact reusable Magic Flute bound',
    })
    const accepted = manageItemGuidedAdjudicationUseCase({
      role: 'gm',
      command: {
        schemaVersion: 1, operationId: operationId(43), action: 'resolve',
        requestId: request.requestId, expectedRevision: 0,
        optionId: 'accept-reviewed-use',
      },
    }, { database, now: () => 210, publishPersistedRealtimeEvent: () => undefined })
    expect(accepted.result.exactReplay).toBe(false)
    const trainerAfter = createSqliteSheetRepository<Record<string, unknown>>(database)
      .getByRef('trainer', 'ash')!.sheet as unknown as TrainerSheet
    expect(trainerAfter.inventory?.keyItems?.find(row => row.id === 'magic-flute-row')?.qty).toBe(1)
    expect(trainerAfter.serverPrivate?.itemGuidedCampaignTools).toMatchObject({
      receipts: [expect.objectContaining({
        sourceOperationId: itemOperationId,
        canonicalItemId: 'Magic Flute',
        sourceDisposition: 'retained-reusable',
      })],
    })
  })

  it('reserves repulsive medicine without mechanics, then atomically applies deterministic healing, one bounded Loyalty outcome, action cost, consumption, privacy, and replay', () => {
    const database = open()
    seedMedicine(database)
    const itemOperationId = 'guided_medicine_operation_0001'
    const beforeMap = medicineMap()
    const pending = executeItemOperationUseCase({
      role: 'player', playerProfile: medicineProfile(), command: medicineCommand(itemOperationId),
    }, {
      database, guidedRequestId: () => requestId(20), now: () => 100,
      publishPersistedRealtimeEvent: () => undefined,
    })
    expect(pending.result).toMatchObject({ status: 'pending', canonicalItemId: 'Energy Powder' })
    expect(createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('trainer', 'ash')!.sheet).toMatchObject({
      inventory: { medicalKit: [{ qty: 2 }] },
    })
    expect(createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('pokemon', 'sparky')!.sheet).toMatchObject({
      combat: { currentHp: 7 }, loyalty: 3,
    })
    expect(createSqliteMapRepository<TabletopMap>(database).get('medicine-map')!.document.encounterState?.turnResources).toEqual(
      beforeMap.encounterState?.turnResources,
    )

    const queue = loadItemGuidedAdjudicationUseCase({ role: 'gm' }, { database })
    expect(queue.requests).toHaveLength(1)
    expect(queue.requests[0]).toMatchObject({
      itemLabel: 'Energy Powder', actorLabel: 'Ash', targetLabel: 'Sparky', reservationLabel: '1 Energy Powder reserved',
    })
    expect(queue.requests[0]!.choices.map(value => value.optionId)).toEqual([
      'record-no-loyalty-change', 'lower-loyalty-by-one',
    ])
    const guidedEvents = database.connection.prepare(`
      SELECT access_json, event_json FROM realtime_events
      WHERE event_type = 'item-guided-request-updated' ORDER BY sequence
    `).all() as unknown as { access_json: string, event_json: string }[]
    expect(guidedEvents.map(row => JSON.parse(row.access_json))).toEqual([
      { kind: 'gm-only' },
      { kind: 'sheet-access', sheetKind: 'trainer', sheetSlug: 'ash' },
    ])
    for (const row of guidedEvents) {
      expect(row.event_json).not.toContain('energy-row')
      expect(row.event_json).not.toContain(itemOperationId)
      expect(row.event_json).not.toContain('loyalty')
    }

    const resolveCommand = {
      schemaVersion: 1 as const,
      operationId: operationId(21),
      action: 'resolve' as const,
      requestId: queue.requests[0]!.requestId,
      expectedRevision: 0,
      optionId: 'lower-loyalty-by-one',
    }
    const accepted = manageItemGuidedAdjudicationUseCase({ role: 'gm', command: resolveCommand }, {
      database, now: () => 200, publishPersistedRealtimeEvent: () => undefined,
    })
    expect(accepted.result.request).toMatchObject({ status: 'accepted', acceptedSummary: 'Energy Powder accepted. Loyalty lowered by 1.' })
    const trainerAfter = createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('trainer', 'ash')!.sheet as unknown as TrainerSheet
    const pokemonAfter = createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('pokemon', 'sparky')!.sheet as unknown as CharacterSheet
    expect(trainerAfter.inventory?.medicalKit?.[0]?.qty).toBe(1)
    expect(pokemonAfter.combat?.currentHp).toBeGreaterThan(7)
    expect(pokemonAfter.loyalty).toBe(2)
    expect(pokemonAfter.serverPrivate?.itemGuidedLoyalty).toMatchObject({ receipts: [expect.objectContaining({ outcome: 'decrease-one' })] })
    const playerProjection = redactSheetRecordForPlayer('pokemon', pokemonAfter as unknown as Record<string, unknown>)
    expect((playerProjection.serverPrivate as Record<string, unknown> | undefined)?.itemGuidedLoyalty).toBeUndefined()
    expect(createSqliteMapRepository<TabletopMap>(database).get('medicine-map')!.document.encounterState?.turnResources?.['ash-placement']?.actions.standard?.spent).toBe(1)
    expect(manageItemGuidedAdjudicationUseCase({ role: 'gm', command: resolveCommand }, {
      database, now: () => 999, publishPersistedRealtimeEvent: () => undefined,
    }).result.exactReplay).toBe(true)
    expect((createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('trainer', 'ash')!.sheet as unknown as TrainerSheet).inventory?.medicalKit?.[0]?.qty).toBe(1)
  })

  it('cancels a reserved repulsive medicine request without HP, Loyalty, action, or inventory mutation', () => {
    const database = open()
    seedMedicine(database)
    executeItemOperationUseCase({
      role: 'player', playerProfile: medicineProfile(), command: medicineCommand('guided_medicine_operation_0002'),
    }, {
      database, guidedRequestId: () => requestId(22), now: () => 100,
      publishPersistedRealtimeEvent: () => undefined,
    })
    const request = loadItemGuidedAdjudicationUseCase({
      role: 'player', playerProfile: medicineProfile(), ownerKind: 'trainer', ownerSlug: 'ash',
    }, { database }).requests[0]!
    expect(request.choices).toEqual([])
    const stored = createSqliteItemGuidedRequestRepository({ database }).get(request.requestId)!
    expect(() => resumeItemOperationUseCase({
      role: 'player', playerProfile: medicineProfile(),
      command: {
        schemaVersion: 1,
        operationId: stored.itemOperationId,
        decisionId: stored.authority.sourceKind === 'item-operation' ? stored.authority.decisionId : '',
        choices: [
          { choiceId: 'target', optionIds: ['sparky-placement'] },
          { choiceId: 'gm-loyalty-outcome', optionIds: ['lower-loyalty-by-one'] },
        ],
      },
    }, { database })).toThrowError(expect.objectContaining({ statusCode: 403 }))
    const beforeTrainer = createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('trainer', 'ash')!.sheet
    const beforePokemon = createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('pokemon', 'sparky')!.sheet
    const beforeMap = createSqliteMapRepository<TabletopMap>(database).get('medicine-map')!.document
    const cancelled = manageItemGuidedAdjudicationUseCase({
      role: 'player', playerProfile: medicineProfile(),
      command: {
        schemaVersion: 1, operationId: operationId(23), action: 'cancel',
        requestId: request.requestId, expectedRevision: 0,
      },
    }, { database, now: () => 150, publishPersistedRealtimeEvent: () => undefined })
    expect(cancelled.result.request.status).toBe('cancelled')
    expect(createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('trainer', 'ash')!.sheet).toEqual(beforeTrainer)
    expect(createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('pokemon', 'sparky')!.sheet).toEqual(beforePokemon)
    expect(createSqliteMapRepository<TabletopMap>(database).get('medicine-map')!.document).toEqual(beforeMap)
  })

  it('cancels an equipped request without changing sheet or equipment revisions', () => {
    const database = open()
    saveTrainer(database)
    const dependencies = {
      database, requestId: () => requestId(9), now: () => 50,
      publishPersistedRealtimeEvent: () => undefined,
    }
    const projection = loadItemGuidedAdjudicationUseCase({
      role: 'player', playerProfile: profile(), ownerKind: 'trainer', ownerSlug: 'mira',
    }, dependencies)
    const pending = manageItemGuidedAdjudicationUseCase({
      role: 'player', playerProfile: profile(),
      command: {
        schemaVersion: 1, operationId: operationId(10), action: 'declare-re-breather',
        ownerKind: 'trainer', ownerSlug: 'mira', ownerRevision: 4, offerId: projection.reBreatherOffers[0]!.offerId,
      },
    }, dependencies)
    const before = readTrainer(database)
    const cancelled = manageItemGuidedAdjudicationUseCase({
      role: 'player', playerProfile: profile(),
      command: {
        schemaVersion: 1, operationId: operationId(11), action: 'cancel',
        requestId: pending.result.request.requestId, expectedRevision: 0,
      },
    }, dependencies)
    expect(cancelled.result.request.status).toBe('cancelled')
    expect(readTrainer(database)).toEqual(before)
    expect(createSqliteItemGuidedRequestRepository({ database }).listPending()).toEqual([])
  })
})
