import { describe, expect, it } from 'vitest'
import { buildTokenMoveMenuOptions, trainerMoveEntriesForSheet } from '~/utils/mapTokenMoves'
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

  it('does not apply STAB to Struggle auto moves', () => {
    const [move] = buildTokenMoveMenuOptions(token(), [
      { move: { name: 'Struggle' }, automatic: true },
    ])

    expect(move.damageBase).toBe(4)
    expect(move.hasStab).toBe(false)
    expect(move.automatic).toBe(true)
  })

  it('auto-adds Struggle entries for trainer tokens too', () => {
    const entries = trainerMoveEntriesForSheet({
      slug: 'trainer',
      name: 'Trainer',
      level: 1,
      movelist: [{ name: 'Tackle' }],
      capabilities: { other: ['Zapper'] },
    })

    expect(entries).toEqual(expect.arrayContaining([
      { move: { name: 'Tackle' }, automatic: false },
      { move: { name: 'Struggle' }, automatic: true },
      { move: { name: 'Struggle (Zapper)' }, automatic: true },
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
