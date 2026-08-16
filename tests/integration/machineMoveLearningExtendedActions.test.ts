import { afterEach, describe, expect, it } from 'vitest'
import { sheetItemTargetId, type SheetItemActionOfferV1 } from '#shared/itemAutomation/sheetActions'
import type { CharacterSheet } from '../../src/types/characterSheet'
import type { TrainerSheet } from '../../src/types/trainerSheet'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteItemExtendedActionRepository } from '../../server/storage/itemExtendedActionRepository'
import { createSqliteItemOperationRepository } from '../../server/storage/itemOperationRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { loadSheetItemActionsUseCase } from '../../server/useCases/loadSheetItemActions'
import { manageItemExtendedActionUseCase } from '../../server/useCases/manageItemExtendedAction'
import { projectSheetEquipmentContributions, redactSheetRecordForPlayer } from '../../server/utils/sheetPrivacy'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}
afterEach(() => {
  while (databases.length > 0) databases.pop()!.close()
})

const trainer = (item: string): TrainerSheet => ({
  slug: 'mira', name: 'Mira', level: 10, revision: 3,
  currentTeam: ['volt'],
  inventory: { pokemonItems: [{ id: 'machine-row', name: item, qty: 2 }] },
})
const pokemon = (species = 'Pikachu'): CharacterSheet => ({
  slug: 'volt', nickname: 'Volt', species, level: 10, revision: 2,
  movelist: [{ name: species === 'Squirtle' ? 'Tackle' : 'Quick Attack' }],
  appliedMoves: [], tutorPoints: { spent: 0 },
})
const seed = (database: RotomDatabase, item: string, species = 'Pikachu'): void => {
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  sheets.save({
    kind: 'trainer', slug: 'mira', revision: 3, updatedAt: 10,
    document: trainer(item) as unknown as Record<string, unknown>,
  })
  sheets.save({
    kind: 'pokemon', slug: 'volt', revision: 2, updatedAt: 10,
    document: pokemon(species) as unknown as Record<string, unknown>,
  })
}
const ids = (digit: string) => ({
  activityId: `item-activity:v1:${digit.repeat(32)}`,
  startOperationId: `item-activity-operation:v1:${digit.repeat(32)}`,
  settlementOperationId: `sheet-item:v1:${digit.repeat(32)}`,
  completeOperationId: `item-activity-operation:v1:${String(Number(digit) + 1).slice(-1).repeat(32)}`,
})
const offerFor = (database: RotomDatabase, canonicalId: string): SheetItemActionOfferV1 => (
  loadSheetItemActionsUseCase({ role: 'gm', trainerSlug: 'mira' }, { database, now: () => 100 })
    .offers.find(offer => offer.source.canonicalId === canonicalId)
    ?? (() => { throw new Error(`Missing ${canonicalId} offer.`) })()
)
const choicesFor = (offer: SheetItemActionOfferV1) => {
  const target = offer.targeting?.options.find(option => option.sheetSlug === 'volt')
    ?? (() => { throw new Error('Missing machine target offer.') })()
  const replacement = target.choices.find(choice => choice.choiceId === 'machine-replacement')!
  const confirmation = target.choices.find(choice => choice.choiceId === 'machine-confirmation')!
  return [
    { choiceId: replacement.choiceId, optionIds: [replacement.options[0]!.optionId] },
    { choiceId: confirmation.choiceId, optionIds: [confirmation.options[0]!.optionId] },
  ]
}
const start = (database: RotomDatabase, canonicalId: string, digit: string) => {
  const offer = offerFor(database, canonicalId)
  const identity = ids(digit)
  const choices = choicesFor(offer)
  const response = manageItemExtendedActionUseCase({ role: 'gm', command: {
    schemaVersion: 1,
    kind: 'start',
    operationId: identity.startOperationId,
    activityId: identity.activityId,
    settlementOperationId: identity.settlementOperationId,
    trainerSlug: 'mira',
    trainerRevision: offer.actor.revision,
    offerId: offer.offerId,
    targetIds: [sheetItemTargetId('pokemon', 'volt')],
    choices,
  } }, { database, now: () => 100 })
  return { offer, identity, choices, response }
}
const complete = (database: RotomDatabase, activityId: string, operationId: string) => (
  manageItemExtendedActionUseCase({ role: 'gm', command: {
    schemaVersion: 1,
    kind: 'complete',
    operationId,
    activityId,
    expectedRevision: 0,
  } }, { database, now: () => 200 })
)

describe('machine Move-learning Extended Action integration', () => {
  it('persists exact private choices inertly, then commits one TM, Move, Tutor Point, provenance, receipt, and replay', () => {
    const database = open()
    seed(database, 'TM 24 - Thunderbolt')
    const offer = offerFor(database, 'TM 24 - Thunderbolt')
    const targetOffer = offer.targeting?.options.find(option => option.sheetSlug === 'volt')
      ?? (() => { throw new Error('Missing machine target offer.') })()
    expect(offer).toMatchObject({
      timingLabel: 'Extended Action',
      availability: { enabled: true },
      costs: ['Consume 1 TM 24 - Thunderbolt'],
    })
    expect(targetOffer).toMatchObject({
      enabled: true,
      summary: '1 active Moves · 3 Tutor Points available',
      previewFacts: expect.arrayContaining([
        expect.objectContaining({ label: 'Move to learn', value: 'Thunderbolt' }),
        expect.objectContaining({ label: 'TM/Tutor limit', value: '0 / 3 → 0 / 3' }),
      ]),
      choices: [
        expect.objectContaining({ choiceId: 'machine-replacement' }),
        expect.objectContaining({ choiceId: 'machine-confirmation' }),
      ],
    })
    expect(JSON.stringify(offer)).not.toContain('canonicalDefinitionSha256')
    expect(JSON.stringify(offer)).not.toContain('machine-row')

    const declared = start(database, 'TM 24 - Thunderbolt', '1')
    expect(declared.response).toMatchObject({
      result: { status: 'in-progress', exactReplay: false },
      sheets: [],
      activity: {
        target: { summary: '1 active Moves · 3 Tutor Points available' },
        completion: {
          costs: ['1 TM 24 - Thunderbolt on completion'],
          sourceNotice: 'One exact source item is consumed only with accepted completion.',
          safePendingNotice: 'No Move, Tutor Point, usage, sheet, or inventory change has been applied yet.',
        },
      },
    })
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    expect((sheets.getByRef('trainer', 'mira')!.sheet as unknown as TrainerSheet).inventory?.pokemonItems?.[0]?.qty).toBe(2)
    expect((sheets.getByRef('pokemon', 'volt')!.sheet as unknown as CharacterSheet).movelist?.map(row => row.name))
      .toEqual(['Quick Attack'])
    expect(createSqliteItemOperationRepository({ database }).get(declared.identity.settlementOperationId)).toBeNull()
    expect(createSqliteItemExtendedActionRepository(database).get(declared.identity.activityId)?.startCommand.choices)
      .toEqual(declared.choices)

    const accepted = complete(database, declared.identity.activityId, declared.identity.completeOperationId)
    expect(accepted.result).toMatchObject({ status: 'completed', exactReplay: false })
    expect(accepted.activity.terminal?.message).toContain('Move, Tutor Points, usage receipt, and inventory settlement')
    const storedTrainer = sheets.getByRef('trainer', 'mira')!
    const storedPokemon = sheets.getByRef('pokemon', 'volt')!
    expect(storedTrainer.revision).toBe(4)
    expect((storedTrainer.sheet as unknown as TrainerSheet).inventory?.pokemonItems)
      .toEqual([{ id: 'machine-row', name: 'TM 24 - Thunderbolt', qty: 1 }])
    expect(storedPokemon.revision).toBe(3)
    const learned = storedPokemon.sheet as unknown as CharacterSheet
    expect(learned.movelist?.map(row => row.name)).toEqual(['Quick Attack', 'Thunderbolt'])
    expect(learned.appliedMoves).toEqual([expect.objectContaining({ name: 'Thunderbolt', source: 'tm' })])
    expect(learned.tutorPoints).toMatchObject({ earned: 3, spent: 1 })
    expect(learned.serverPrivate?.itemMoveLearning?.applications).toEqual([
      expect.objectContaining({ sourceOperationId: declared.identity.settlementOperationId, moveId: 'Thunderbolt' }),
    ])
    const operation = createSqliteItemOperationRepository({ database }).get(declared.identity.settlementOperationId)!
    expect(operation.plan.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ payload: expect.objectContaining({ action: 'consume', quantity: 1 }) }),
      expect.objectContaining({ payload: expect.objectContaining({ action: 'learn-machine-move' }) }),
    ]))
    expect(operation.plan.receiptFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ audience: 'owner', label: 'Active Move: Open slot → Thunderbolt.' }),
    ]))

    const replay = complete(database, declared.identity.activityId, declared.identity.completeOperationId)
    expect(replay.result).toMatchObject({ status: 'completed', exactReplay: true })
    expect(sheets.getByRef('trainer', 'mira')?.revision).toBe(4)
    expect(sheets.getByRef('pokemon', 'volt')?.revision).toBe(3)

    const forged = structuredClone(learned)
    forged.nickname = 'Editable nickname'
    forged.movelist = [{ name: 'Quick Attack' }]
    forged.appliedMoves = []
    delete forged.serverPrivate
    const setupSave = sheets.replaceSetupSheet({
      kind: 'pokemon', slug: 'volt', expectedRevision: 3,
      sheet: forged as unknown as Record<string, unknown>, now: 300,
    })
    expect(setupSave?.changed).toBe(true)
    const setupStored = sheets.getByRef('pokemon', 'volt')!.sheet as unknown as CharacterSheet
    expect(setupStored.nickname).toBe('Editable nickname')
    expect(setupStored.movelist?.map(row => row.name)).toEqual(['Quick Attack', 'Thunderbolt'])
    expect(setupStored.appliedMoves?.map(row => row.name)).toEqual(['Thunderbolt'])
    expect(setupStored.serverPrivate?.itemMoveLearning?.applications).toHaveLength(1)

    const playerSafe = redactSheetRecordForPlayer('pokemon', learned as unknown as Record<string, unknown>)
    const gmSafe = projectSheetEquipmentContributions('pokemon', learned as unknown as Record<string, unknown>)
    expect(playerSafe.serverPrivate).toBeUndefined()
    expect(gmSafe.serverPrivate).toBeUndefined()
    expect(JSON.stringify(gmSafe)).not.toContain(declared.identity.settlementOperationId)
    const events = database.connection.prepare('SELECT event_json FROM realtime_events').all() as { event_json: string }[]
    expect(events.every(event => !event.event_json.includes('canonicalDefinitionSha256'))).toBe(true)
    expect(events.every(event => !event.event_json.includes(declared.identity.settlementOperationId))).toBe(true)
  })

  it('retains an HM and records exactly one private same-day source use with atomic target learning', () => {
    const database = open()
    seed(database, 'HM A3 - Surf', 'Squirtle')
    const declared = start(database, 'HM A3 - Surf', '3')
    expect(declared.response.activity.completion).toMatchObject({
      costs: ['Reusable HM · one use per campaign day'],
      sourceNotice: expect.stringContaining('once-per-campaign-day'),
    })
    const accepted = complete(database, declared.identity.activityId, declared.identity.completeOperationId)
    expect(accepted.result.status).toBe('completed')
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const storedTrainer = sheets.getByRef('trainer', 'mira')!.sheet as unknown as TrainerSheet
    expect(storedTrainer.inventory?.pokemonItems).toEqual([
      { id: 'machine-row', name: 'HM A3 - Surf', qty: 2 },
    ])
    expect(storedTrainer.serverPrivate?.itemMachineUsage?.latestUses).toEqual([
      expect.objectContaining({ sourceOperationId: declared.identity.settlementOperationId, campaignDayIndex: 0 }),
    ])
    expect((sheets.getByRef('pokemon', 'volt')!.sheet as unknown as CharacterSheet).movelist?.map(row => row.name))
      .toEqual(['Tackle', 'Surf'])
    const operation = createSqliteItemOperationRepository({ database }).get(declared.identity.settlementOperationId)!
    expect(operation.plan.operations.some(row => row.payload.action === 'consume')).toBe(false)
    expect(operation.plan.operations.map(row => row.payload.action)).toEqual([
      'learn-machine-move', 'record-machine-daily-use',
    ])
    expect(projectSheetEquipmentContributions(
      'trainer', storedTrainer as unknown as Record<string, unknown>,
    ).serverPrivate).toBeUndefined()
    const trainerRecord = sheets.getByRef('trainer', 'mira')!
    const forgedTrainer = structuredClone(trainerRecord.sheet) as unknown as TrainerSheet
    forgedTrainer.name = 'Editable Mira'
    delete forgedTrainer.serverPrivate
    expect(sheets.replaceSetupSheet({
      kind: 'trainer', slug: 'mira', expectedRevision: trainerRecord.revision,
      sheet: forgedTrainer as unknown as Record<string, unknown>, now: 300,
    })?.changed).toBe(true)
    const protectedTrainer = sheets.getByRef('trainer', 'mira')!.sheet as unknown as TrainerSheet
    expect(protectedTrainer.name).toBe('Editable Mira')
    expect(protectedTrainer.serverPrivate?.itemMachineUsage?.latestUses).toHaveLength(1)
  })

  it('leaves activity, source, and target unchanged when a chosen target revision becomes stale', () => {
    const database = open()
    seed(database, 'TM 24 - Thunderbolt')
    const declared = start(database, 'TM 24 - Thunderbolt', '5')
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const current = sheets.getByRef('pokemon', 'volt')!
    const changed = structuredClone(current.sheet) as unknown as CharacterSheet
    changed.notes = 'changed elsewhere'
    expect(sheets.applyLivePlayUpdate({
      kind: 'pokemon', slug: 'volt', expectedRevision: current.revision,
      nextSheet: changed as unknown as Record<string, unknown>,
      sourceOperationId: 'test-machine-target-drift',
    })).not.toBe('stale')

    expect(() => complete(database, declared.identity.activityId, declared.identity.completeOperationId))
      .toThrow(/choice|authorized|eligible|changed/i)
    expect((sheets.getByRef('trainer', 'mira')!.sheet as unknown as TrainerSheet).inventory?.pokemonItems?.[0]?.qty).toBe(2)
    expect((sheets.getByRef('pokemon', 'volt')!.sheet as unknown as CharacterSheet).movelist?.map(row => row.name))
      .toEqual(['Quick Attack'])
    expect(createSqliteItemOperationRepository({ database }).get(declared.identity.settlementOperationId)).toBeNull()
    expect(createSqliteItemExtendedActionRepository(database).get(declared.identity.activityId)).toMatchObject({
      status: 'in-progress', revision: 0, result: null,
    })
  })
})
