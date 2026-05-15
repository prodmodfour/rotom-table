import { describe, expect, it } from 'vitest'
import { buildTokenMoveMenuOptions, pokemonMoveEntriesForSheet, trainerMoveEntriesForSheet } from '~/utils/mapTokenMoves'
import type { CombatStageMap } from '~/types/combatStages'
import type { SpawnedPokemon } from '~/types/pokemon'

const stages = (overrides: Partial<CombatStageMap> = {}): CombatStageMap => ({
  atk: 0,
  def: 0,
  satk: 0,
  sdef: 0,
  spd: 0,
  acc: 0,
  ...overrides,
})

const token = (overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
  id: 'token',
  species: 'Bolt',
  slug: 'bolt',
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/sprite.png',
  entityKind: 'pokemon',
  position: { x: 0, y: 0, z: 0 },
  sheetKind: 'pokemon',
  sheetSlug: 'bolt',
  level: 10,
  currentHp: 20,
  maxHp: 40,
  atk: 10,
  satk: 8,
  def: 5,
  sdef: 5,
  defenderTypes: ['Normal'],
  combatStages: stages({ atk: 2 }),
  conditions: [],
  tokenItems: [],
  ...overrides,
})

describe('map token move menu options', () => {
  it('uses adjusted DB and current combat-stage adjusted attack stats', () => {
    const [move] = buildTokenMoveMenuOptions(token(), [
      { move: { name: 'Tackle' }, automatic: false },
    ])

    expect(move.damageBase).toBe(6)
    expect(move.hasStab).toBe(true)
    expect(move.baseAttackStat).toBe(10)
    expect(move.attackStage).toBe(2)
    expect(move.attackStat).toBe(14)
    expect(move.damageFormula).toBe('2d6+8+14')
  })

  it('includes reference special text in move menu options', () => {
    const [move] = buildTokenMoveMenuOptions(token({ defenderTypes: ['Fire'] }), [
      { move: { name: 'Ember' }, automatic: false },
    ])

    expect(move.special).toBe('Grants Firestarter')
  })

  it('marks moves named by Disabled condition instances', () => {
    const moves = buildTokenMoveMenuOptions(token({ conditions: ['Disabled: Tackle'] }), [
      { move: { name: 'Tackle' }, automatic: false },
      { move: { name: 'Ember' }, automatic: false },
    ])

    expect(moves.find((move) => move.name === 'Tackle')?.disabledByCondition).toBe(true)
    expect(moves.find((move) => move.name === 'Ember')?.disabledByCondition).toBe(false)
  })

  it('does not apply STAB to Struggle auto moves', () => {
    const [move] = buildTokenMoveMenuOptions(token(), [
      { move: { name: 'Struggle' }, automatic: true },
    ])

    expect(move.damageBase).toBe(4)
    expect(move.hasStab).toBe(false)
    expect(move.automatic).toBe(true)
  })

  it('applies Expert Combat Skill Struggle AC and DB upgrades in token move options', () => {
    const [move] = buildTokenMoveMenuOptions(token({ combatSkillRankValue: 5 }), [
      { move: { name: 'Struggle' }, automatic: true },
    ])

    expect(move.damageBase).toBe(5)
    expect(move.ac).toBe(3)
    expect(move.damageFormula).toBe('1d8+8+14')
    expect(move.hasStab).toBe(false)
  })

  it('applies Weird Power to map token move damage formulas', () => {
    const [move] = buildTokenMoveMenuOptions(token({
      abilityNames: ['Weird Power'],
      atk: 12,
      satk: 8,
      combatStages: stages(),
    }), [
      { move: { name: 'Custom Beam', category: 'Special', db: 6 }, automatic: false },
    ])

    expect(move).toMatchObject({
      damageClass: 'Special',
      attackStat: 20,
      baseAttackStat: 8,
      attackStage: 0,
      attackStatKey: 'satk',
      attackStatAbility: 'Weird Power',
      additionalAttackStat: 12,
      additionalAttackStatKey: 'atk',
      damageFormula: '2d6+8+20',
    })
  })

  it('auto-adds Struggle entries for trainer tokens too', () => {
    const entries = trainerMoveEntriesForSheet({
      slug: 'trainer',
      name: 'Trainer',
      level: 1,
      movelist: [{ name: 'Tackle' }],
      capabilities: { other: ['Zapper'] },
    })

    expect(entries).toEqual([
      { move: { name: 'Struggle' }, automatic: true },
      { move: { name: 'Struggle (Zapper Physical)' }, automatic: true },
      { move: { name: 'Struggle (Zapper Special)' }, automatic: true },
      { move: { name: 'Tackle' }, automatic: false },
    ])
  })

  it('auto-adds Pokémon Struggle variants from move-granted capabilities', () => {
    const entries = pokemonMoveEntriesForSheet({
      slug: 'abra',
      nickname: 'Abra',
      species: 'Abra',
      level: 1,
      movelist: [{ name: 'Ember' }],
      capabilities: { other: [] },
    })

    expect(entries).toEqual(expect.arrayContaining([
      { move: { name: 'Struggle' }, automatic: true },
      { move: { name: 'Struggle (Firestarter Physical)' }, automatic: true },
      { move: { name: 'Struggle (Firestarter Special)' }, automatic: true },
      { move: { name: 'Ember' }, automatic: false },
    ]))
  })

  it('auto-adds both physical and special Guster Struggle entries', () => {
    const entries = trainerMoveEntriesForSheet({
      slug: 'trainer',
      name: 'Trainer',
      level: 1,
      movelist: [],
      capabilities: { other: ['Guster'] },
    })

    expect(entries).toEqual(expect.arrayContaining([
      { move: { name: 'Struggle' }, automatic: true },
      { move: { name: 'Struggle (Guster Physical)' }, automatic: true },
      { move: { name: 'Struggle (Guster Special)' }, automatic: true },
    ]))

    const options = buildTokenMoveMenuOptions(token({
      sheetKind: 'trainer',
      atk: 10,
      satk: 8,
      combatStages: stages({ atk: 2, satk: -1 }),
    }), entries)
    const physical = options.find((move) => move.name === 'Struggle (Guster Physical)')
    const special = options.find((move) => move.name === 'Struggle (Guster Special)')

    expect(physical).toMatchObject({ type: 'Flying', damageClass: 'Physical', attackStat: 14 })
    expect(special).toMatchObject({ type: 'Flying', damageClass: 'Special', attackStat: 7 })
  })
})
