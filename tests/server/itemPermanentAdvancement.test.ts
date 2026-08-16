import { describe, expect, it } from 'vitest'
import { parseItemPermanentAdvancementState } from '#shared/itemAutomation/permanentAdvancement'
import type { CharacterSheet, StatKey } from '~/types/characterSheet'
import { pokemonExperienceNeededForLevel } from '~/utils/sheets/pokemonExperience'
import { computePokemonTutorPointsEarnedForSheet } from '~/utils/sheets/pokemonTutorPoints'
import { resolvePokemonVitaminSummary } from '~/utils/sheets/pokemonVitamins'
import {
  nextPpUpFrequency,
  PERMANENT_ADVANCEMENT_CONSENT_CHOICE_ID,
  PERMANENT_ADVANCEMENT_MOVE_CHOICE_ID,
  PERMANENT_ADVANCEMENT_STAT_CHOICE_ID,
  previewPermanentItemAdvancement,
  resolvePermanentItemAdvancement,
} from '../../server/domain/itemAutomation/permanentAdvancement'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'

const statKeys: readonly StatKey[] = ['hp', 'atk', 'def', 'satk', 'sdef', 'spd']
const statVitaminIds = ['HP Up', 'Protein', 'Iron', 'Calcium', 'Zinc', 'Carbos'] as const
const operationId = (index: number): string => `sheet-item:v1:${String(index).padStart(32, '0')}`

const pokemon = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'volt',
  nickname: 'Volt',
  species: '',
  level: 5,
  totalExp: pokemonExperienceNeededForLevel(5),
  revision: 2,
  stats: Object.fromEntries(statKeys.map(stat => [stat, { base: 5, added: 0 }])),
  movelist: [
    { name: 'Spark', frequency: 'EOT' },
    { name: 'Thunder Wave', frequency: 'Scene x2' },
    { name: 'Tackle', frequency: 'At-Will' },
  ],
  ...overrides,
})

const definition = (canonicalId: string) => ITEM_AUTOMATION_RUNTIME_REGISTRY.require(canonicalId)
const resolve = (input: {
  canonicalId: string
  sheet: CharacterSheet
  choices?: ReadonlyMap<string, readonly string[]>
  index?: number
}) => resolvePermanentItemAdvancement({
  definition: definition(input.canonicalId),
  sheetKind: 'pokemon',
  sheet: input.sheet,
  selectedChoices: input.choices ?? new Map(),
  operationId: operationId(input.index ?? 1),
  appliedAt: 1_000 + (input.index ?? 1),
})

describe('permanent advancement item mechanics', () => {
  it('registers all ten hash-bound Extended Action items and applies each stat Vitamin through one derived-stat path', () => {
    expect(statVitaminIds.map(id => definition(id).spec.timing)).toEqual(Array(6).fill('extended'))
    for (const [index, canonicalId] of statVitaminIds.entries()) {
      const before = pokemon()
      const result = resolve({ canonicalId, sheet: before, index: index + 1 })
      const summary = resolvePokemonVitaminSummary(result.sheet)
      expect(summary.statBoosts[statKeys[index]!]).toBe(1)
      expect(summary.vitaminSlotsUsed).toBe(1)
      expect(result.preview.previewFacts).toEqual(expect.arrayContaining([
        expect.objectContaining({ value: '5 → 6', tone: 'positive' }),
        expect.objectContaining({ label: 'Vitamin limit', value: '0 / 5 → 1 / 5' }),
      ]))
      expect(parseItemPermanentAdvancementState(
        result.sheet.serverPrivate?.itemPermanentAdvancement,
      ).applications).toEqual([
        expect.objectContaining({
          sourceOperationId: operationId(index + 1),
          canonicalItemId: canonicalId,
          kind: 'stat-vitamin',
          stat: statKeys[index],
        }),
      ])
    }
  })

  it('enforces the shared five-Vitamin limit across stat Vitamins, Heart Booster, and PP Up', () => {
    let sheet = pokemon()
    for (let index = 1; index <= 4; index += 1) {
      sheet = resolve({ canonicalId: statVitaminIds[index - 1]!, sheet, index }).sheet
    }
    const tutorBefore = computePokemonTutorPointsEarnedForSheet(sheet)
    const heart = resolve({ canonicalId: 'Heart Booster', sheet, index: 5 })
    expect(resolvePokemonVitaminSummary(heart.sheet)).toMatchObject({
      vitaminSlotsUsed: 5,
      heartBoosterUsed: true,
      heartBoosterTutorPointBonus: 2,
    })
    expect(computePokemonTutorPointsEarnedForSheet(heart.sheet)).toBe(tutorBefore + 2)
    expect(() => previewPermanentItemAdvancement({
      definition: definition('Carbos'), sheetKind: 'pokemon', sheet: heart.sheet,
    })).toThrow('five-Vitamin lifetime limit')
    expect(() => previewPermanentItemAdvancement({
      definition: definition('PP Up'), sheetKind: 'pokemon', sheet: heart.sheet,
    })).toThrow('five-Vitamin lifetime limit')
    expect(() => resolve({ canonicalId: 'Heart Booster', sheet: heart.sheet, index: 6 }))
      .toThrow(/five-Vitamin|already benefited/)
  })

  it('offers only legal PP Up Moves, persists the exact choice, and fails closed after frequency drift', () => {
    expect(nextPpUpFrequency('At-Will')).toBeNull()
    expect(nextPpUpFrequency('EOT')).toBe('At-Will')
    expect(nextPpUpFrequency('Scene')).toBe('Scene x2')
    expect(nextPpUpFrequency('Scene x2')).toBe('Scene x3')
    expect(nextPpUpFrequency('Daily x9')).toBe('Daily x10')
    expect(nextPpUpFrequency('Static')).toBeNull()

    const source = pokemon()
    const preview = previewPermanentItemAdvancement({
      definition: definition('PP Up'), sheetKind: 'pokemon', sheet: source,
    })
    const choice = preview.choices[0]!
    expect(choice.choiceId).toBe(PERMANENT_ADVANCEMENT_MOVE_CHOICE_ID)
    expect(choice.options.map(option => [option.label, option.description])).toEqual([
      ['Spark', 'EOT → At-Will'],
      ['Thunder Wave', 'Scene x2 → Scene x3'],
    ])
    const sparkOption = choice.options[0]!
    const choices = new Map([[choice.choiceId, [sparkOption.optionId]]])
    const accepted = resolve({ canonicalId: 'PP Up', sheet: source, choices, index: 10 })
    expect(accepted.sheet.movelist?.[0]?.frequency).toBe('At-Will')
    expect(accepted.sheet.vitamins).toMatchObject({ ppUp: true, ppUpMove: 'Spark' })
    expect(parseItemPermanentAdvancementState(
      accepted.sheet.serverPrivate?.itemPermanentAdvancement,
    ).applications[0]).toMatchObject({
      kind: 'pp-up', moveName: 'Spark', moveListIndex: 0,
      previousFrequency: 'EOT', resultingFrequency: 'At-Will',
    })
    expect(() => resolve({ canonicalId: 'PP Up', sheet: accepted.sheet, choices, index: 11 }))
      .toThrow(/already benefited|five-Vitamin/)

    const drifted = structuredClone(source)
    drifted.movelist![0]!.frequency = 'Scene'
    expect(() => resolve({ canonicalId: 'PP Up', sheet: drifted, choices, index: 12 }))
      .toThrow('choices are incomplete')
  })

  it('grants exactly the next-level Experience, permits five lifetime Rare Candies, and rejects Level 100', () => {
    let sheet = pokemon()
    for (let index = 1; index <= 5; index += 1) {
      const beforeLevel = sheet.level
      const accepted = resolve({ canonicalId: 'Rare Candy', sheet, index: 20 + index })
      sheet = accepted.sheet
      expect(sheet.level).toBe(beforeLevel + 1)
      expect(sheet.totalExp).toBe(pokemonExperienceNeededForLevel(beforeLevel + 1))
      expect(resolvePokemonVitaminSummary(sheet).rareCandies).toBe(index)
    }
    expect(() => resolve({ canonicalId: 'Rare Candy', sheet, index: 26 }))
      .toThrow('five Rare Candies')
    const level100 = pokemon({
      level: 100,
      totalExp: pokemonExperienceNeededForLevel(100),
    })
    expect(() => previewPermanentItemAdvancement({
      definition: definition('Rare Candy'), sheetKind: 'pokemon', sheet: level100,
    })).toThrow('Level 100')
  })

  it('requires exact Trainer consent and a legal non-no-op Base Stat for Stat Suppressants', () => {
    const source = pokemon()
    const preview = previewPermanentItemAdvancement({
      definition: definition('Stat Suppressants'), sheetKind: 'pokemon', sheet: source,
    })
    expect(preview.kind).toBe('stat-suppressant')
    expect(preview.selectionComplete).toBe(false)
    expect(preview.choices.map(choice => [choice.choiceId, choice.presentation])).toEqual([
      [PERMANENT_ADVANCEMENT_STAT_CHOICE_ID, 'radio'],
      [PERMANENT_ADVANCEMENT_CONSENT_CHOICE_ID, 'confirmation'],
    ])
    expect(preview.choices[1]?.options[0]?.previewFacts).toEqual([
      { label: 'Trainer consent', value: 'Confirmed', tone: 'positive' },
    ])
    const statOnly = new Map([[PERMANENT_ADVANCEMENT_STAT_CHOICE_ID, ['atk']]])
    expect(() => resolve({ canonicalId: 'Stat Suppressants', sheet: source, choices: statOnly, index: 30 }))
      .toThrow('choices are incomplete')
    const choices = new Map<string, readonly string[]>([
      [PERMANENT_ADVANCEMENT_STAT_CHOICE_ID, ['atk']],
      [PERMANENT_ADVANCEMENT_CONSENT_CHOICE_ID, ['confirmed']],
    ])
    const accepted = resolve({ canonicalId: 'Stat Suppressants', sheet: source, choices, index: 31 })
    expect(resolvePokemonVitaminSummary(accepted.sheet)).toMatchObject({
      vitaminSlotsUsed: 0,
      statSuppressants: expect.objectContaining({ atk: 1 }),
      statNetAdjustments: expect.objectContaining({ atk: -1 }),
    })
    expect(accepted.preview.previewFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Attack Base Stat', value: '5 → 4' }),
      expect.objectContaining({ label: 'Trainer consent', value: 'Confirmed' }),
    ]))

    const floor = pokemon({
      stats: Object.fromEntries(statKeys.map(stat => [stat, { base: 1, added: 0 }])),
    })
    expect(() => previewPermanentItemAdvancement({
      definition: definition('Stat Suppressants'), sheetKind: 'pokemon', sheet: floor,
    })).toThrow('No Base Stat can be suppressed')
  })

  it('rejects resulting Base Relations, Stat Point budget, malformed provenance, and duplicate operation identity', () => {
    const baseRelations = pokemon({
      stats: {
        hp: { base: 5, added: 1 }, atk: { base: 5, added: 0 },
        def: { base: 5, added: 0 }, satk: { base: 5, added: 0 },
        sdef: { base: 5, added: 0 }, spd: { base: 5, added: 0 },
      },
    })
    expect(() => resolve({ canonicalId: 'Protein', sheet: baseRelations, index: 40 }))
      .toThrow('Base Relations')
    const overBudget = pokemon({
      stats: Object.fromEntries(statKeys.map(stat => [stat, { base: 5, added: stat === 'hp' ? 999 : 0 }])),
    })
    expect(() => resolve({ canonicalId: 'Iron', sheet: overBudget, index: 41 }))
      .toThrow('Stat Point budget')

    const first = resolve({ canonicalId: 'HP Up', sheet: pokemon(), index: 42 })
    expect(() => resolve({ canonicalId: 'Protein', sheet: first.sheet, index: 42 }))
      .toThrow('already contains this source operation identity')
    const malformed = structuredClone(first.sheet)
    malformed.serverPrivate!.itemPermanentAdvancement = {
      schemaVersion: 1,
      applications: [{
        ...parseItemPermanentAdvancementState(
          first.sheet.serverPrivate?.itemPermanentAdvancement,
        ).applications[0]!,
        canonicalDefinitionSha256: 'not-a-hash',
      }],
    }
    expect(() => previewPermanentItemAdvancement({
      definition: definition('Protein'), sheetKind: 'pokemon', sheet: malformed,
    })).toThrow('lowercase SHA-256')
  })
})
