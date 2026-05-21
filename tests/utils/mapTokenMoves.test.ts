import { describe, expect, it } from 'vitest'
import {
  buildTokenMoveMenuOptions,
  buildTokenMoveUsageState,
  pokemonMoveEntriesForSheet,
  trainerMoveEntriesForSheet,
} from '~/utils/mapTokenMoves'
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

  it('uses token Loyalty for Return and Frustration menu Damage Bases', () => {
    const moves = buildTokenMoveMenuOptions(token({ loyalty: 4, defenderTypes: [] }), [
      { move: { name: 'Return' }, automatic: false },
      { move: { name: 'Frustration' }, automatic: false },
    ])

    expect(moves.find((move) => move.name === 'Return')).toMatchObject({
      damageBase: 7,
      hasAutomationScript: true,
    })
    expect(moves.find((move) => move.name === 'Frustration')).toMatchObject({
      damageBase: 5,
      hasAutomationScript: true,
    })
  })

  it('marks loyalty-based moves unscripted until Loyalty is set', () => {
    const [move] = buildTokenMoveMenuOptions(token({ defenderTypes: [] }), [
      { move: { name: 'Return' }, automatic: false },
    ])

    expect(move.damageBase).toBeNull()
    expect(move.hasAutomationScript).toBe(false)
  })

  it('includes reference special text in move menu options', () => {
    const [move] = buildTokenMoveMenuOptions(token({ defenderTypes: ['Fire'] }), [
      { move: { name: 'Ember' }, automatic: false },
    ])

    expect(move.special).toBe('Grants Firestarter')
  })

  it('shows unscripted moves while marking them unavailable for automation', () => {
    const moves = buildTokenMoveMenuOptions(token(), [
      { move: { name: 'Tackle' }, automatic: false },
      { move: { name: 'Custom Beam', category: 'Special', db: 6 }, automatic: false },
    ])

    expect(moves.map((move) => move.name)).toEqual(['Tackle', 'Custom Beam'])
    expect(moves.find((move) => move.name === 'Tackle')?.hasAutomationScript).toBe(true)
    expect(moves.find((move) => move.name === 'Custom Beam')?.hasAutomationScript).toBe(false)
  })

  it('reports map and sheet move frequency usage states', () => {
    expect(buildTokenMoveUsageState('token', 'Bite', 'EOT', {
      mapMoveUsage: {
        byPlacementId: {
          token: {
            bite: { moveName: 'Bite', frequency: 'eot', uses: 1, lastUsedRound: 2 },
          },
        },
      },
      currentRound: 3,
    })).toMatchObject({
      tracking: 'map',
      frequencyKind: 'eot',
      label: 'EOT Round 4',
      available: false,
      nextAvailableRound: 4,
    })

    expect(buildTokenMoveUsageState('token', 'Growl', 'Scene x2', {
      mapMoveUsage: {
        byPlacementId: {
          token: {
            growl: { moveName: 'Growl', frequency: 'scene', uses: 1 },
          },
        },
      },
    })).toMatchObject({
      label: 'Scene 1/2',
      available: true,
      remainingUses: 1,
    })

    expect(buildTokenMoveUsageState('token', 'Recover', 'Daily', {
      sheetMoveUsage: {
        daily: {
          recover: { moveName: 'Recover', uses: 1 },
        },
      },
    })).toMatchObject({
      tracking: 'sheet',
      label: 'Daily 0/1',
      available: false,
    })
  })

  it('includes usage state in move menu options', () => {
    const [move] = buildTokenMoveMenuOptions(token(), [
      { move: { name: 'Poison Gas' }, automatic: false },
    ], {
      mapMoveUsage: {
        byPlacementId: {
          token: {
            'poison-gas': { moveName: 'Poison Gas', frequency: 'scene', uses: 1 },
          },
        },
      },
    })

    expect(move.usage).toMatchObject({ label: 'Scene 0/1', available: false })
    expect(move.disabledByUsage).toBe(true)
  })

  it('marks moves named by Disabled condition instances', () => {
    const moves = buildTokenMoveMenuOptions(token({ conditions: ['Disabled: Tackle'] }), [
      { move: { name: 'Tackle' }, automatic: false },
      { move: { name: 'Ember' }, automatic: false },
    ])

    expect(moves.find((move) => move.name === 'Tackle')?.disabledByCondition).toBe(true)
    expect(moves.find((move) => move.name === 'Tackle')?.conditionUseBlock?.label).toBe('Disabled')
    expect(moves.find((move) => move.name === 'Ember')?.disabledByCondition).toBe(false)
  })

  it('blocks non-damaging non-Struggle moves while Enraged', () => {
    const moves = buildTokenMoveMenuOptions(token({ conditions: ['Enraged'] }), [
      { move: { name: 'Tackle' }, automatic: false },
      { move: { name: 'Swords Dance' }, automatic: false },
      { move: { name: 'Struggle' }, automatic: true },
    ])

    expect(moves.find((move) => move.name === 'Tackle')?.conditionUseBlock).toBeNull()
    expect(moves.find((move) => move.name === 'Struggle')?.conditionUseBlock).toBeNull()
    expect(moves.find((move) => move.name === 'Swords Dance')?.conditionUseBlock).toMatchObject({
      condition: 'Rage',
      label: 'Enraged',
      reason: expect.stringContaining('damaging Physical or Special Move'),
    })
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

  it('applies Weird Power to automated map token move damage formulas', () => {
    const [move] = buildTokenMoveMenuOptions(token({
      abilityNames: ['Weird Power'],
      atk: 12,
      satk: 8,
      combatStages: stages(),
    }), [
      { move: { name: 'Water Gun' }, automatic: false },
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
      damageFormula: '1d8+6+20',
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
