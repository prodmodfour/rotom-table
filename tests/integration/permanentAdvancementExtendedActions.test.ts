import { afterEach, describe, expect, it } from 'vitest'
import { parseItemPermanentAdvancementState } from '#shared/itemAutomation/permanentAdvancement'
import { sheetItemTargetId, type SheetItemActionOfferV1 } from '#shared/itemAutomation/sheetActions'
import type { CharacterSheet, StatKey } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { pokemonExperienceNeededForLevel } from '~/utils/sheets/pokemonExperience'
import { resolvePokemonVitaminSummary } from '~/utils/sheets/pokemonVitamins'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteItemExtendedActionRepository } from '../../server/storage/itemExtendedActionRepository'
import { createSqliteItemOperationRepository } from '../../server/storage/itemOperationRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { projectSheetEquipmentContributions, redactSheetRecordForPlayer } from '../../server/utils/sheetPrivacy'
import { loadSheetItemActionsUseCase } from '../../server/useCases/loadSheetItemActions'
import { manageItemExtendedActionUseCase } from '../../server/useCases/manageItemExtendedAction'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}
afterEach(() => {
  while (databases.length) databases.pop()!.close()
})

const stats = (): CharacterSheet['stats'] => Object.fromEntries(
  (['hp', 'atk', 'def', 'satk', 'sdef', 'spd'] as readonly StatKey[])
    .map(stat => [stat, { base: 5, added: 0 }]),
)
const trainer = (item: string, qty = 2): TrainerSheet => ({
  slug: 'mira', name: 'Mira', level: 10, revision: 3,
  currentTeam: ['volt'],
  inventory: { pokemonItems: [{ id: 'advancement-row', name: item, qty }] },
})
const pokemon = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'volt', nickname: 'Volt', species: '', level: 5,
  totalExp: pokemonExperienceNeededForLevel(5),
  revision: 2,
  stats: stats(),
  movelist: [
    { name: 'Spark', frequency: 'EOT' },
    { name: 'Thunder Wave', frequency: 'Scene x2' },
  ],
  ...overrides,
})
const seed = (database: RotomDatabase, item: string, target = pokemon(), qty = 2): void => {
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  sheets.save({
    kind: 'trainer', slug: 'mira', revision: 3, updatedAt: 10,
    document: trainer(item, qty) as unknown as Record<string, unknown>,
  })
  sheets.save({
    kind: 'pokemon', slug: 'volt', revision: 2, updatedAt: 10,
    document: target as unknown as Record<string, unknown>,
  })
}
const identities = (digit: string) => ({
  activityId: `item-activity:v1:${digit.repeat(32)}`,
  startOperationId: `item-activity-operation:v1:${digit.repeat(32)}`,
  settlementOperationId: `sheet-item:v1:${digit.repeat(32)}`,
  completeOperationId: `item-activity-operation:v1:${String(Number(digit) + 1).slice(-1).repeat(32)}`,
})
const offerFor = (database: RotomDatabase, canonicalId: string): SheetItemActionOfferV1 => {
  const projection = loadSheetItemActionsUseCase({ role: 'gm', trainerSlug: 'mira' }, {
    database, now: () => 100,
  })
  return projection.offers.find(offer => offer.source.canonicalId === canonicalId)
    ?? (() => { throw new Error(`Missing ${canonicalId} offer.`) })()
}
const start = (input: {
  database: RotomDatabase
  canonicalId: string
  digit: string
  choices?: readonly { readonly choiceId: string, readonly optionIds: readonly string[] }[]
}) => {
  const offer = offerFor(input.database, input.canonicalId)
  const ids = identities(input.digit)
  const command = {
    schemaVersion: 1 as const,
    kind: 'start' as const,
    operationId: ids.startOperationId,
    activityId: ids.activityId,
    settlementOperationId: ids.settlementOperationId,
    trainerSlug: 'mira',
    trainerRevision: offer.actor.revision,
    offerId: offer.offerId,
    targetIds: [sheetItemTargetId('pokemon', 'volt')],
    choices: input.choices ?? [],
  }
  const response = manageItemExtendedActionUseCase({ role: 'gm', command }, {
    database: input.database, now: () => 100,
  })
  return { offer, ids, command, response }
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

const selectedChoice = (offer: SheetItemActionOfferV1, choiceLabel: string, optionLabel: string) => {
  const target = offer.targeting?.options.find(option => option.sheetSlug === 'volt')
    ?? (() => { throw new Error('Missing target option.') })()
  const choice = target.choices.find(value => value.label === choiceLabel)
    ?? (() => { throw new Error(`Missing ${choiceLabel}.`) })()
  const option = choice.options.find(value => value.label === optionLabel)
    ?? (() => { throw new Error(`Missing ${optionLabel}.`) })()
  return { choiceId: choice.choiceId, optionIds: [option.optionId] }
}

describe('permanent advancement Extended Action integration', () => {
  it('stores a PP Up target and Move inertly, then atomically applies, consumes, publishes, and exact-replays once', () => {
    const database = open()
    seed(database, 'PP Up')
    const offer = offerFor(database, 'PP Up')
    expect(offer).toMatchObject({
      timingLabel: 'Extended Action',
      availability: { enabled: true },
      actions: expect.arrayContaining([expect.objectContaining({ kind: 'use', enabled: true })]),
      targeting: { options: expect.arrayContaining([expect.objectContaining({
        summary: '0 / 5 vitamins used',
        previewFacts: expect.arrayContaining([
          expect.objectContaining({ label: 'Vitamin limit', value: '0 / 5 → 1 / 5' }),
        ]),
        choices: [expect.objectContaining({
          label: 'Choose a move',
          options: expect.arrayContaining([
            expect.objectContaining({ label: 'Spark', description: 'EOT → At-Will' }),
          ]),
        })],
      })]) },
    })
    expect(JSON.stringify(offer)).not.toContain('canonicalDefinitionSha256')
    expect(JSON.stringify(offer)).not.toContain('advancement-row')
    const moveChoice = selectedChoice(offer, 'Choose a move', 'Spark')
    const declared = start({ database, canonicalId: 'PP Up', digit: '1', choices: [moveChoice] })
    expect(declared.response).toMatchObject({
      result: { status: 'in-progress', exactReplay: false },
      sheets: [],
      activity: {
        item: { canonicalId: 'PP Up' },
        target: { label: 'Volt', summary: 'Level 5 · 0 / 5 vitamins used' },
        completion: {
          costs: ['1 PP Up on completion'],
          sourceNotice: 'One exact source item is consumed only with accepted completion.',
        },
      },
    })
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    expect((sheets.getByRef('trainer', 'mira')!.sheet as unknown as TrainerSheet).inventory?.pokemonItems?.[0]?.qty).toBe(2)
    expect((sheets.getByRef('pokemon', 'volt')!.sheet as unknown as CharacterSheet).movelist?.[0]?.frequency).toBe('EOT')
    expect(sheets.getByRef('trainer', 'mira')?.revision).toBe(3)
    expect(sheets.getByRef('pokemon', 'volt')?.revision).toBe(2)
    expect(createSqliteItemOperationRepository({ database }).get(declared.ids.settlementOperationId)).toBeNull()
    const durable = createSqliteItemExtendedActionRepository(database).get(declared.ids.activityId)!
    expect(durable.startCommand.choices).toEqual([moveChoice])
    expect(durable.initialItemCommand.choices).toEqual([
      { choiceId: 'target', optionIds: [sheetItemTargetId('pokemon', 'volt')] },
      moveChoice,
    ])

    const accepted = complete(database, declared.ids.activityId, declared.ids.completeOperationId)
    expect(accepted.result).toMatchObject({ status: 'completed', exactReplay: false })
    expect(accepted.activity.terminal).toEqual({
      kind: 'completed',
      message: 'PP Up applied. The permanent sheet change and exact item consumption were accepted together.',
    })
    const acceptedTrainer = sheets.getByRef('trainer', 'mira')!
    const acceptedPokemon = sheets.getByRef('pokemon', 'volt')!
    expect(acceptedTrainer.revision).toBe(4)
    expect((acceptedTrainer.sheet as unknown as TrainerSheet).inventory?.pokemonItems)
      .toEqual([{ id: 'advancement-row', name: 'PP Up', qty: 1 }])
    expect(acceptedPokemon.revision).toBe(3)
    const target = acceptedPokemon.sheet as unknown as CharacterSheet
    expect(target.movelist?.[0]?.frequency).toBe('At-Will')
    expect(target.vitamins).toMatchObject({ ppUp: true, ppUpMove: 'Spark' })
    expect(parseItemPermanentAdvancementState(
      target.serverPrivate?.itemPermanentAdvancement,
    ).applications).toEqual([
      expect.objectContaining({
        sourceOperationId: declared.ids.settlementOperationId,
        kind: 'pp-up', moveName: 'Spark', previousFrequency: 'EOT', resultingFrequency: 'At-Will',
      }),
    ])
    const operation = createSqliteItemOperationRepository({ database }).get(declared.ids.settlementOperationId)!
    expect(operation.plan.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'inventory', payload: expect.objectContaining({ action: 'consume', quantity: 1 }) }),
      expect.objectContaining({ kind: 'campaign-fact', payload: expect.objectContaining({
        action: 'apply-permanent-advancement', advancementKind: 'pp-up',
      }) }),
    ]))
    expect(operation.plan.receiptFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ audience: 'owner', label: 'Spark: EOT → At-Will.' }),
    ]))

    const replay = complete(database, declared.ids.activityId, declared.ids.completeOperationId)
    expect(replay.result).toMatchObject({ status: 'completed', exactReplay: true })
    expect(sheets.getByRef('trainer', 'mira')?.revision).toBe(4)
    expect(sheets.getByRef('pokemon', 'volt')?.revision).toBe(3)
    expect(parseItemPermanentAdvancementState(
      (sheets.getByRef('pokemon', 'volt')!.sheet as unknown as CharacterSheet)
        .serverPrivate?.itemPermanentAdvancement,
    ).applications).toHaveLength(1)

    const playerSafe = redactSheetRecordForPlayer('pokemon', target as unknown as Record<string, unknown>)
    const gmSafe = projectSheetEquipmentContributions('pokemon', target as unknown as Record<string, unknown>)
    expect(playerSafe.serverPrivate).toBeUndefined()
    expect(JSON.stringify(gmSafe)).not.toContain('itemPermanentAdvancement')
    expect(JSON.stringify(gmSafe)).not.toContain(declared.ids.settlementOperationId)
    const eventJson = database.connection.prepare(`
      SELECT event_json FROM realtime_events ORDER BY sequence DESC LIMIT 1
    `).get() as { event_json: string }
    expect(eventJson.event_json).not.toContain('move-choice')
    expect(eventJson.event_json).not.toContain('canonicalDefinitionSha256')
  })

  it('revalidates the exact PP Up option at completion and leaves source, target, and activity untouched after drift', () => {
    const database = open()
    seed(database, 'PP Up')
    const offer = offerFor(database, 'PP Up')
    const choice = selectedChoice(offer, 'Choose a move', 'Spark')
    const declared = start({ database, canonicalId: 'PP Up', digit: '3', choices: [choice] })
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const current = sheets.getByRef('pokemon', 'volt')!
    const changed = structuredClone(current.sheet) as unknown as CharacterSheet
    changed.movelist![0]!.frequency = 'Scene'
    expect(sheets.applyLivePlayUpdate({
      kind: 'pokemon', slug: 'volt', expectedRevision: current.revision,
      nextSheet: changed as unknown as Record<string, unknown>, sourceOperationId: 'test-pp-up-drift',
    })).not.toBe('stale')

    expect(() => complete(database, declared.ids.activityId, declared.ids.completeOperationId))
      .toThrow(/choice|authorized|eligible/i)
    expect((sheets.getByRef('trainer', 'mira')!.sheet as unknown as TrainerSheet).inventory?.pokemonItems?.[0]?.qty).toBe(2)
    expect((sheets.getByRef('pokemon', 'volt')!.sheet as unknown as CharacterSheet).movelist?.[0]?.frequency).toBe('Scene')
    expect(createSqliteItemOperationRepository({ database }).get(declared.ids.settlementOperationId)).toBeNull()
    expect(createSqliteItemExtendedActionRepository(database).get(declared.ids.activityId)).toMatchObject({
      status: 'in-progress', revision: 0, result: null,
    })
  })

  it('requires and persists explicit Trainer consent for a non-no-op Stat Suppressant choice', () => {
    const database = open()
    seed(database, 'Stat Suppressants', pokemon(), 1)
    const offer = offerFor(database, 'Stat Suppressants')
    const statChoice = selectedChoice(offer, 'Choose a Base Stat', 'Attack')
    const consent = selectedChoice(offer, 'Trainer consent', 'The Pokémon’s Trainer consents')
    expect(() => start({
      database, canonicalId: 'Stat Suppressants', digit: '5', choices: [statChoice],
    })).toThrow(/choice|eligible|authorized/i)
    const declared = start({
      database, canonicalId: 'Stat Suppressants', digit: '5', choices: [statChoice, consent],
    })
    expect(createSqliteItemExtendedActionRepository(database).get(declared.ids.activityId)?.startCommand.choices)
      .toEqual([statChoice, consent])
    const accepted = complete(database, declared.ids.activityId, declared.ids.completeOperationId)
    expect(accepted.result.status).toBe('completed')
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const target = sheets.getByRef('pokemon', 'volt')!.sheet as unknown as CharacterSheet
    expect(resolvePokemonVitaminSummary(target)).toMatchObject({
      vitaminSlotsUsed: 0,
      statSuppressants: expect.objectContaining({ atk: 1 }),
    })
    expect((sheets.getByRef('trainer', 'mira')!.sheet as unknown as TrainerSheet).inventory?.pokemonItems)
      .toEqual([])
    expect(parseItemPermanentAdvancementState(target.serverPrivate?.itemPermanentAdvancement).applications[0])
      .toMatchObject({ kind: 'stat-suppressant', stat: 'atk' })
  })

  it('commits Rare Candy Experience, Level, lifetime use, provenance, and source quantity in one accepted transaction', () => {
    const database = open()
    seed(database, 'Rare Candy', pokemon(), 1)
    const declared = start({ database, canonicalId: 'Rare Candy', digit: '7' })
    const before = createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('pokemon', 'volt')!
    expect((before.sheet as unknown as CharacterSheet).level).toBe(5)
    const accepted = complete(database, declared.ids.activityId, declared.ids.completeOperationId)
    expect(accepted.result.status).toBe('completed')
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const target = sheets.getByRef('pokemon', 'volt')!.sheet as unknown as CharacterSheet
    expect(target).toMatchObject({ level: 6, totalExp: pokemonExperienceNeededForLevel(6) })
    expect(resolvePokemonVitaminSummary(target).rareCandies).toBe(1)
    expect((sheets.getByRef('trainer', 'mira')!.sheet as unknown as TrainerSheet).inventory?.pokemonItems)
      .toEqual([])
    expect(parseItemPermanentAdvancementState(target.serverPrivate?.itemPermanentAdvancement).applications[0])
      .toMatchObject({ kind: 'rare-candy', previousLevel: 5, resultingLevel: 6 })
  })

  it('does not treat a GM override as ownership for a permanent-item target', () => {
    const database = open()
    seed(database, 'HP Up', pokemon(), 1)
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const currentTrainer = sheets.getByRef('trainer', 'mira')!
    const withoutOwnership = structuredClone(currentTrainer.sheet) as unknown as TrainerSheet
    withoutOwnership.currentTeam = []
    expect(sheets.applyLivePlayUpdate({
      kind: 'trainer', slug: 'mira', expectedRevision: currentTrainer.revision,
      nextSheet: withoutOwnership as unknown as Record<string, unknown>,
      sourceOperationId: 'test-remove-target-ownership',
    })).not.toBe('stale')
    const offer = offerFor(database, 'HP Up')
    expect(offer.targeting?.options.some(option => option.sheetSlug === 'volt')).toBe(false)
    expect(offer.availability.enabled).toBe(false)
    const ids = identities('9')
    expect(() => manageItemExtendedActionUseCase({ role: 'gm', command: {
      schemaVersion: 1,
      kind: 'start',
      operationId: ids.startOperationId,
      activityId: ids.activityId,
      settlementOperationId: ids.settlementOperationId,
      trainerSlug: 'mira',
      trainerRevision: offer.actor.revision,
      offerId: offer.offerId,
      targetIds: [sheetItemTargetId('pokemon', 'volt')],
      choices: [],
    } }, { database, now: () => 100 })).toThrow(/target|eligible|owned/i)
    expect(sheets.getByRef('pokemon', 'volt')?.revision).toBe(2)
    expect((sheets.getByRef('trainer', 'mira')!.sheet as unknown as TrainerSheet)
      .inventory?.pokemonItems?.[0]?.qty).toBe(1)
  })

  it('prevents setup-sheet saves from forging or erasing permanent item outcomes while preserving editable notes', () => {
    const database = open()
    const acceptedState = pokemon({
      vitamins: {
        statBoosts: { hp: 1 }, statSuppressants: { atk: 1 },
        heartBooster: true, ppUp: true, ppUpMove: 'Spark', rareCandies: 2,
        heartScales: 3, notes: 'original',
      },
    })
    seed(database, 'HP Up', acceptedState)
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const current = sheets.getByRef('pokemon', 'volt')!
    const forged = structuredClone(current.sheet) as unknown as CharacterSheet
    forged.vitamins = {
      statBoosts: { hp: 99, atk: 99 }, statSuppressants: {},
      heartBooster: false, ppUp: false, ppUpMove: 'Thunder Wave', rareCandies: 0,
      heartScales: 8, notes: 'editable note',
    }
    const replaced = sheets.replaceSetupSheet({
      kind: 'pokemon', slug: 'volt', expectedRevision: current.revision,
      sheet: forged as unknown as Record<string, unknown>, now: 500,
    })
    expect(replaced?.changed).toBe(true)
    const stored = sheets.getByRef('pokemon', 'volt')!.sheet as unknown as CharacterSheet
    expect(stored.vitamins).toMatchObject({
      statBoosts: expect.objectContaining({ hp: 1 }),
      statSuppressants: expect.objectContaining({ atk: 1 }),
      heartBooster: true,
      ppUp: true,
      ppUpMove: 'Spark',
      rareCandies: 2,
      heartScales: 8,
      notes: 'editable note',
    })
  })
})
