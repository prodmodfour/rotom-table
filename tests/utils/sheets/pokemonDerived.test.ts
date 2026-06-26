import { describe, expect, it } from 'vitest'
import type { CharacterSheet } from '~/types/characterSheet'
import {
  computeFullMaxHp,
  computeMaxHp,
  resolveBaseRelationAddedStatPointBounds,
  resolveCapabilities,
  resolveSkills,
  resolveStats,
  validateBaseRelations,
} from '~/utils/sheets/pokemonDerived'

const makeAbraSheet = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'test-abra',
  nickname: 'Test Abra',
  species: 'Abra',
  level: 10,
  ...overrides,
})

const makeCharmanderSheet = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'test-charmander',
  nickname: 'Test Charmander',
  species: 'Charmander',
  level: 5,
  ...overrides,
})

describe('pokemon sheet derived helpers', () => {
  it('resolves species stats with sheet additions and HP formulas', () => {
    const sheet = makeAbraSheet({
      stats: { hp: { added: 2 }, atk: { added: 4, stage: -1 } },
      combat: { injuries: 2 },
    })

    const stats = resolveStats(sheet)
    const hp = stats.find((row) => row.key === 'hp')
    const atk = stats.find((row) => row.key === 'atk')

    expect(hp).toMatchObject({ label: 'HP', species: 3, base: 3, added: 2, total: 5 })
    expect(atk).toMatchObject({ label: 'Attack', species: 2, added: 4, stage: -1, total: 6 })
    expect(computeFullMaxHp(sheet, hp?.total ?? 0)).toBe(35)
    expect(computeMaxHp(sheet, hp?.total ?? 0)).toBe(28)
  })

  it('uses manual base rows when a species only has placement reference data', () => {
    const stats = resolveStats({
      slug: 'test-annihilape',
      nickname: 'Test Annihilape',
      species: 'Annihilape',
      level: 40,
      stats: {
        hp: { base: 10, added: 10 },
        atk: { base: 14, added: 13 },
        def: { base: 6, added: 6 },
        satk: { base: 3, added: 3 },
        sdef: { base: 8, added: 8 },
        spd: { base: 10, added: 10 },
      },
    })

    expect(stats.find((row) => row.key === 'hp')).toMatchObject({ species: 10, base: 10, added: 10, total: 20 })
    expect(validateBaseRelations(stats)).toHaveLength(0)
  })

  it('validates PTU base relation ordering', () => {
    const stats = resolveStats(makeAbraSheet({ stats: { satk: { added: 0 }, atk: { added: 9 } } }))

    const violations = validateBaseRelations(stats)

    expect(violations.some((violation) => violation.higher.key === 'satk' && violation.lower.key === 'atk'))
      .toBe(true)
  })

  it('resolves Added stat slider bounds from Base Stat Relations', () => {
    const stats = resolveStats(makeCharmanderSheet({
      stats: {
        hp: { added: 2 },
        atk: { added: 3 },
        def: { added: 2 },
        satk: { added: 3 },
        sdef: { added: 2 },
        spd: { added: 3 },
      },
    }))

    const bounds = resolveBaseRelationAddedStatPointBounds(stats)

    expect(bounds.hp).toEqual({ min: 0, max: 2 })
    expect(bounds.atk).toEqual({ min: 2, max: 3 })
    expect(bounds.satk).toEqual({ min: 3, max: 3 })
    expect(bounds.spd).toEqual({ min: 3 })
  })

  it('resolves species skills and sheet overrides', () => {
    const skills = resolveSkills(makeAbraSheet({ skills: { focus: '6d6+3', generalEd: '2d6' } }))

    expect(skills.find((row) => row.key === 'focus')).toMatchObject({ value: '6d6+3', speciesGiven: true })
    expect(skills.find((row) => row.key === 'athletics')).toMatchObject({ value: '1d6', speciesGiven: true })
    expect(skills.find((row) => row.key === 'generalEd')).toMatchObject({ value: '2d6', speciesGiven: false })
    expect(skills.find((row) => row.key === 'medicineEd')).toMatchObject({ value: '1d6', speciesGiven: false })
  })

  it('layers sheet capabilities over species defaults', () => {
    const resolved = resolveCapabilities(makeAbraSheet({
      capabilities: { overland: 7, sky: 0, naturewalk: 'Urban', other: ['Custom Sense'] },
    }))

    expect(resolved.rows).toContainEqual({ label: 'Overland', value: 7 })
    expect(resolved.rows).not.toContainEqual({ label: 'Sky', value: 0 })
    expect(resolved.naturewalk).toBe('Urban')
    expect(resolved.other).toEqual([
      'Teleporter 2',
      'Telekinetic',
      'Telepath',
      'Underdog',
      'Custom Sense',
    ])
  })

  it('uses Pokédex Naturewalk separately from other capability defaults when sheet arrays are empty', () => {
    const resolved = resolveCapabilities(makeAbraSheet({ capabilities: { other: [] } }))

    expect(resolved.naturewalk).toBe('Forest, Urban')
    expect(resolved.other).toEqual(['Teleporter 2', 'Telekinetic', 'Telepath', 'Underdog'])
  })

  it('applies the Levitate ability passive speed bonus to capabilities', () => {
    expect(resolveCapabilities(makeAbraSheet({
      abilities: [{ name: 'levitate' }],
    })).rows).toContainEqual({ label: 'Levitate', value: 4 })

    expect(resolveCapabilities(makeAbraSheet({
      abilities: [{ name: 'Levitate' }],
      capabilities: { levitate: 5 },
    })).rows).toContainEqual({ label: 'Levitate', value: 7 })
  })

  it('adds capabilities granted by known moves', () => {
    const resolved = resolveCapabilities(makeAbraSheet({
      movelist: [
        { name: 'Ember' },
        { name: 'Dig' },
        { name: 'Fly' },
        { name: 'Strength' },
        { name: 'Bounce' },
        { name: 'Splash' },
        { name: 'Teleport' },
      ],
    }))

    expect(resolved.rows).toEqual(expect.arrayContaining([
      { label: 'Sky', value: 3 },
      { label: 'Burrow', value: 3 },
      { label: 'Jump', value: '2/2' },
      { label: 'Power', value: 2 },
    ]))
    expect(resolved.other).toEqual(expect.arrayContaining(['Firestarter', 'Teleporter 6']))
  })
})
