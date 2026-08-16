import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteItemExtendedActionRepository } from '../../server/storage/itemExtendedActionRepository'
import { createSqliteItemOperationRepository } from '../../server/storage/itemOperationRepository'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { buildEncounterPresentationProjection } from '../../server/domain/encounterPresentation/buildProjection'
import { declareSheetItemActionUseCase } from '../../server/useCases/declareSheetItemAction'
import { executeItemOperationUseCase } from '../../server/useCases/executeItemOperation'
import { loadItemExplorationUseCase } from '../../server/useCases/loadItemExploration'
import { loadSheetItemActionsUseCase } from '../../server/useCases/loadSheetItemActions'
import { manageItemExtendedActionUseCase } from '../../server/useCases/manageItemExtendedAction'
import { itemCommandFromAuthorizedSheetAction, sheetItemTargetId } from '#shared/itemAutomation/sheetActions'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { parseItemExplorationEncounterState, parseItemExplorationState } from '#shared/itemAutomation/exploration'
import type { UseItemCommandV1 } from '#shared/itemAutomation/operations'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}
afterEach(() => { while (databases.length) databases.pop()!.close() })

const trainer = (inventory: TrainerSheet['inventory']): TrainerSheet => ({
  slug: 'mira', name: 'Mira', level: 10, revision: 3,
  skillBackground: { adept: 'occultEd' },
  inventory,
})
const wild = (): CharacterSheet => ({
  slug: 'wild-rattata', nickname: 'Wild Rattata', species: 'Rattata', level: 5, revision: 2,
  capabilities: { overland: 4 }, skills: { focus: '2d6' }, stats: { spd: { added: 0 } },
})
const map = (): TabletopMap => ({
  schemaVersion: 2, slug: 'route-map', name: 'Route Map', revision: 7,
  dimensions: { x: 10, y: 3, z: 6 }, groundLevelY: 0,
  voxels: [], createdAt: 1, updatedAt: 10,
  placements: [
    { id: 'mira-placement', sheetKind: 'trainer', sheetSlug: 'mira', position: { x: 1, y: 0, z: 1 } },
    { id: 'wild-placement', sheetKind: 'pokemon', sheetSlug: 'wild-rattata', position: { x: 2, y: 0, z: 1 } },
  ],
  encounterState: {
    ...createEmptyEncounterState(),
    turnResources: { 'mira-placement': createEncounterTurnResourceLedger({ placementId: 'mira-placement', round: 1 }) },
  },
  initiative: { activeId: 'mira-placement', round: 1 },
})
const seedTrainer = (database: RotomDatabase, source: TrainerSheet): void => {
  createSqliteSheetRepository<Record<string, unknown>>(database).save({
    kind: 'trainer', slug: 'mira', document: source as unknown as Record<string, unknown>, revision: 3, updatedAt: 10,
  })
}
const currentTrainer = (database: RotomDatabase): TrainerSheet => (
  createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('trainer', 'mira')!.sheet as unknown as TrainerSheet
)

const executeSheetItem = (database: RotomDatabase, canonicalId: string, mode: string, digit: string) => {
  const projection = loadSheetItemActionsUseCase({ role: 'gm', trainerSlug: 'mira' }, { database, now: () => 100 })
  const offer = projection.offers.find(candidate => candidate.source.canonicalId === canonicalId)!
  const target = offer.targeting!.options.find(option => option.targetId === sheetItemTargetId('trainer', 'mira'))!
  const modeChoice = target.choices.find(choice => choice.choiceId === 'exploration-use-mode')!
  expect(modeChoice.options.some(option => option.optionId === mode)).toBe(true)
  const declared = declareSheetItemActionUseCase({ role: 'gm', intent: {
    schemaVersion: 1, trainerSlug: 'mira', trainerRevision: projection.trainerRevision,
    offerId: offer.offerId, action: 'use',
  } }, { database, now: () => 101 })
  const command = itemCommandFromAuthorizedSheetAction({
    offer: declared,
    operationId: `sheet-item:v1:${digit.repeat(32)}`,
    targetIds: [target.targetId],
    choices: [{ choiceId: 'exploration-use-mode', optionIds: [mode] }],
  })
  return executeItemOperationUseCase({ role: 'gm', command }, { database, now: () => 102 })
}

describe('P8-057 complete exploration item execution', () => {
  it.each([
    ['Bait', 'foodStuff', 'route-lure', 15, 1],
    ['Honey', 'foodStuff', 'route-lure', 15, 1],
    ['Repel', 'medicalKit', 'route-ward', 60, 15],
    ['Super Repel', 'medicalKit', 'route-ward', 120, 25],
    ['Max Repel', 'medicalKit', 'route-ward', 300, 35],
  ] as const)('declares and atomically executes %s from the current sheet offer', (
    canonicalId, section, mode, duration, level,
  ) => {
    const database = open()
    seedTrainer(database, trainer({ [section]: [{ id: 'source-row', name: canonicalId, qty: 2 }] }))
    const result = executeSheetItem(database, canonicalId, mode, canonicalId === 'Bait' ? '1'
      : canonicalId === 'Honey' ? '2' : canonicalId === 'Repel' ? '3' : canonicalId === 'Super Repel' ? '4' : '5')
    expect(result.result).toMatchObject({ status: 'accepted', canonicalItemId: canonicalId, exactReplay: false })
    const accepted = currentTrainer(database)
    expect(accepted.inventory?.[section]?.[0]?.qty).toBe(1)
    const state = parseItemExplorationState(accepted.serverPrivate?.itemExploration)
    if (mode === 'route-lure') {
      expect(state.routeLures[0]).toMatchObject({
        canonicalItemId: canonicalId, startedAtCampaignMinute: 0, nextCheckAtCampaignMinute: duration,
        status: 'active', reusable: false,
      })
    }
    else {
      expect(state.repels[0]).toMatchObject({
        canonicalItemId: canonicalId, startedAtCampaignMinute: 0, expiresAtCampaignMinute: duration,
        maximumAffectedWildLevel: level,
      })
    }
    expect(createSqliteItemOperationRepository({ database }).get(result.result.operationId)?.status).toBe('accepted')
    const safe = loadItemExplorationUseCase({ kind: 'trainer', role: 'gm', trainerSlug: 'mira' }, { database, now: () => 103 })
    expect(JSON.stringify(safe)).not.toContain('canonicalDefinitionSha256')
    expect(JSON.stringify(safe)).not.toContain('source-row')
  })

  it('keeps a reusable Fishing Lure in exact custody until its route activity settles', () => {
    const database = open()
    seedTrainer(database, trainer({ keyItems: [{ id: 'lure-row', name: 'Fishing Lure', qty: 1 }] }))
    const projection = loadSheetItemActionsUseCase({ role: 'gm', trainerSlug: 'mira' }, { database, now: () => 100 })
    const offer = projection.offers.find(candidate => candidate.source.canonicalId === 'Fishing Lure')!
    const target = offer.targeting!.options.find(option => option.sheetSlug === 'mira')!
    expect(offer).toMatchObject({
      availability: { enabled: true },
      acceptanceNotice: 'Reusable item; no inventory unit is consumed.',
    })
    const declared = declareSheetItemActionUseCase({ role: 'gm', intent: {
      schemaVersion: 1, trainerSlug: 'mira', trainerRevision: 3,
      offerId: offer.offerId, action: 'use',
    } }, { database, now: () => 101 })
    const command = itemCommandFromAuthorizedSheetAction({
      offer: declared, operationId: `sheet-item:v1:${'9'.repeat(32)}`,
      targetIds: [target.targetId], choices: [],
    })
    executeItemOperationUseCase({ role: 'gm', command }, { database, now: () => 102 })
    expect(currentTrainer(database).inventory?.keyItems).toEqual([{ id: 'lure-row', name: 'Fishing Lure', qty: 1 }])
    expect(parseItemExplorationState(currentTrainer(database).serverPrivate?.itemExploration).routeLures[0])
      .toMatchObject({ canonicalItemId: 'Fishing Lure', reusable: true, status: 'active' })

    const locked = loadSheetItemActionsUseCase({ role: 'gm', trainerSlug: 'mira' }, { database, now: () => 103 })
      .offers.find(candidate => candidate.source.canonicalId === 'Fishing Lure')!
    expect(locked.availability).toMatchObject({ enabled: false })
    expect(locked.availability.unavailableReason?.label).toBeTruthy()

    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const current = sheets.getByRef('trainer', 'mira')!
    const candidate = structuredClone(current.sheet) as unknown as TrainerSheet
    candidate.inventory = { ...candidate.inventory, keyItems: [] }
    const saved = sheets.replaceSetupSheet({
      kind: 'trainer', slug: 'mira', expectedRevision: current.revision,
      sheet: candidate as unknown as Record<string, unknown>, now: 104,
    })!
    expect((saved.sheet.sheet as unknown as TrainerSheet).inventory?.keyItems)
      .toEqual([{ id: 'lure-row', name: 'Fishing Lure', qty: 1 }])
  })

  it('starts Dowsing inertly, enforces ten campaign minutes, then rolls and grants Shards once', () => {
    const database = open()
    seedTrainer(database, trainer({ keyItems: [{ id: 'rod-row', name: 'Dowsing Rod', qty: 1 }] }))
    const projection = loadSheetItemActionsUseCase({ role: 'gm', trainerSlug: 'mira' }, { database, now: () => 100 })
    const offer = projection.offers.find(candidate => candidate.source.canonicalId === 'Dowsing Rod')!
    const target = offer.targeting!.options.find(option => option.sheetSlug === 'mira')!
    expect(target.choices.map(choice => choice.choiceId)).toEqual(['dowsing-terrain'])
    const terrain = target.choices[0]!.options.find(option => option.optionId === 'cave')!
    const startCommand = {
      schemaVersion: 1 as const,
      kind: 'start' as const,
      operationId: `item-activity-operation:v1:${'6'.repeat(32)}`,
      activityId: `item-activity:v1:${'6'.repeat(32)}`,
      settlementOperationId: `sheet-item:v1:${'6'.repeat(32)}`,
      trainerSlug: 'mira', trainerRevision: projection.trainerRevision,
      offerId: offer.offerId, targetIds: [target.targetId],
      choices: [
        { choiceId: 'dowsing-terrain', optionIds: [terrain.optionId] },
      ],
    }
    const started = manageItemExtendedActionUseCase({ role: 'gm', command: startCommand }, { database, now: () => 101 })
    expect(started).toMatchObject({
      result: { status: 'in-progress', exactReplay: false }, sheets: [],
      activity: { item: { canonicalId: 'Dowsing Rod' }, permissions: { canComplete: false } },
    })
    expect(started.activity.permissions.unavailableReason).toContain('campaign minute 10')
    expect(started.activity).toMatchObject({
      target: { summary: null, conditionLabels: [] },
      completion: {
        costs: ['10 campaign minutes · reusable Dowsing Rod'],
        sourceNotice: 'The Dowsing Rod remains in inventory after accepted completion.',
        safePendingNotice: 'No Dowsing roll, daily use, Shard award, or inventory change has been applied yet.',
      },
    })
    expect(currentTrainer(database).inventory?.keyItems).toEqual([{ id: 'rod-row', name: 'Dowsing Rod', qty: 1 }])
    expect(parseItemExplorationState(currentTrainer(database).serverPrivate?.itemExploration).dowsingUses).toEqual([])
    expect(() => manageItemExtendedActionUseCase({ role: 'gm', command: {
      schemaVersion: 1, kind: 'complete', operationId: `item-activity-operation:v1:${'7'.repeat(32)}`,
      activityId: startCommand.activityId, expectedRevision: 0,
    } }, { database, now: () => 102 })).toThrow('Dowsing completes at campaign minute 10')

    database.connection.prepare('UPDATE campaign_clock SET campaign_minute = 10 WHERE singleton = 1').run()
    const queue = [6, 4, 2, 5, 1, 4, 1, 2, 3, 4]
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 110 })
    const completed = manageItemExtendedActionUseCase({ role: 'gm', command: {
      schemaVersion: 1, kind: 'complete', operationId: `item-activity-operation:v1:${'8'.repeat(32)}`,
      activityId: startCommand.activityId, expectedRevision: 0,
    } }, {
      database, now: () => 110, realtimeEventRepository: realtime,
      randomInt: (minimum, maximumExclusive) => {
        expect([minimum, maximumExclusive]).toEqual([1, 7])
        return queue.shift()!
      },
    })
    expect(queue).toEqual([])
    expect(completed).toMatchObject({
      result: { status: 'completed', exactReplay: false },
      activity: {
        terminal: {
          kind: 'completed',
          message: 'Dowsing search completed. The daily use, server roll, and color-preserving Shard awards were accepted together.',
        },
      },
    })
    const accepted = currentTrainer(database)
    expect(accepted.inventory?.keyItems?.find(row => row.name === 'Dowsing Rod')?.qty).toBe(1)
    expect(accepted.inventory?.keyItems?.filter(row => row.name === 'Shards').map(row => row.itemVariant?.color))
      .toEqual(['Red', 'Orange', 'Yellow', 'Green'])
    expect(parseItemExplorationState(accepted.serverPrivate?.itemExploration).dowsingUses).toHaveLength(1)
    const durable = createSqliteItemExtendedActionRepository(database).get(startCommand.activityId)!
    expect(durable.status).toBe('completed')
    const eventJson = JSON.stringify(realtime.readAfter({ afterSequence: 0, limit: 30 }).events)
    expect(eventJson).not.toContain('canonicalDefinitionSha256')
    expect(eventJson).not.toContain('sourceOperationId')
    const replay = manageItemExtendedActionUseCase({ role: 'gm', command: {
      schemaVersion: 1, kind: 'complete', operationId: `item-activity-operation:v1:${'8'.repeat(32)}`,
      activityId: startCommand.activityId, expectedRevision: 0,
    } }, { database, randomInt: () => { throw new Error('Dowsing replay rerolled') } })
    expect(replay.result).toMatchObject({ status: 'completed', exactReplay: true })
    expect(parseItemExplorationState(currentTrainer(database).serverPrivate?.itemExploration).dowsingUses).toHaveLength(1)
  })

  it('executes a direct Repel hit atomically and leaves only bounded GM positioning pending', () => {
    const database = open()
    const actor = trainer({ medicalKit: [{ id: 'repel-row', name: 'Repel', qty: 1 }] })
    const target = wild()
    const sourceMap = map()
    createSqliteMapRepository<TabletopMap>(database).save({ slug: sourceMap.slug, document: sourceMap, revision: 7, updatedAt: 10 })
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.save({ kind: 'trainer', slug: 'mira', document: actor as unknown as Record<string, unknown>, revision: 3, updatedAt: 10 })
    sheets.save({ kind: 'pokemon', slug: target.slug, document: target as unknown as Record<string, unknown>, revision: 2, updatedAt: 10 })
    const offerId = buildEncounterPresentationProjection({
      role: 'gm', map: sourceMap, mapRevision: 7,
      trainerSheets: [actor], pokemonSheets: [target], generatedAt: 100,
    }).offers.find(offer => offer.source.canonicalId === 'Repel')!.offerId
    const command: UseItemCommandV1 = {
      schemaVersion: 1, operationId: 'op_exploration_direct_repel_0001', context: 'encounter',
      offerId, sourceInstanceId: 'item-instance:trainer:mira:medicalKit:repel-row',
      actorParticipantId: 'mira-placement', actorSheet: { kind: 'trainer', slug: 'mira', expectedRevision: 3 },
      source: { kind: 'trainer', slug: 'mira', section: 'medicalKit', rowId: 'repel-row', expectedRevision: 3 },
      targetIds: ['wild-placement'],
      choices: [
        { choiceId: 'target', optionIds: ['wild-placement'] },
        { choiceId: 'exploration-use-mode', optionIds: ['wild-spray'] },
      ],
      readSet: [
        { kind: 'map', id: 'route-map', revision: 7 }, { kind: 'encounter', id: 'route-map', revision: 7 },
        { kind: 'sheet', sheetKind: 'trainer', id: 'mira', revision: 3 },
        { kind: 'sheet', sheetKind: 'pokemon', id: target.slug, revision: 2 },
      ],
    }
    const accepted = executeItemOperationUseCase({ role: 'gm', command }, {
      database, now: () => 120,
      randomInt: (minimum, maximumExclusive) => maximumExclusive === 21 ? 20 : minimum,
    })
    expect(accepted.result).toMatchObject({ status: 'accepted', canonicalItemId: 'Repel' })
    expect(currentTrainer(database).inventory?.medicalKit).toEqual([])
    const acceptedMap = createSqliteMapRepository<TabletopMap>(database).getBySlug('route-map')!
    expect(acceptedMap.encounterState?.turnResources['mira-placement']?.actions.standard.spent).toBe(1)
    const pending = parseItemExplorationEncounterState(acceptedMap.encounterState?.itemExploration).repelPositioning
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ sourcePlacementId: 'mira-placement', targetPlacementId: 'wild-placement' })
    const gmProjection = loadItemExplorationUseCase({ kind: 'map', role: 'gm', mapSlug: 'route-map' }, { database })
    expect(gmProjection.kind === 'map' ? gmProjection.repelPositioning : []).toEqual([
      expect.objectContaining({ itemLabel: 'Repel', sourceLabel: 'Mira', targetLabel: 'Wild Rattata' }),
    ])
  })
})
