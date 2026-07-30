import { describe, expect, it } from 'vitest'
import {
  buildTokenMoveMenuOptions,
  buildTokenMoveUsageState,
  moveEntriesForPlacement,
  pokemonMoveEntriesForSheet,
  tokenMoveUseReference,
  trainerMoveEntriesForSheet,
} from '~/utils/mapTokenMoves'
import type { CharacterSheet } from '~/types/characterSheet'
import type { CombatStageMap } from '~/types/combatStages'
import type { SpawnedPokemon } from '~/types/pokemon'
import { moveListOverlayEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'

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
  it('keeps native and exact same-name attack-source rows distinct', () => {
    const sourceA = `attack-source.v1.${'a'.repeat(64)}` as const
    const sourceB = `attack-source.v1.${'b'.repeat(64)}` as const
    const placement = { id: 'token', sheetKind: 'pokemon' as const, sheetSlug: 'bolt' }
    const sheet = {
      slug: 'bolt', nickname: 'Bolt', species: 'Pikachu', level: 10,
      movelist: [{ name: 'Struggle' }],
    } as CharacterSheet
    const entries = moveEntriesForPlacement(placement, {
      pokemon: new Map([['bolt', sheet]]),
    }, {
      additionalMoveEntries: [
        {
          move: { name: 'Struggle' }, automatic: true,
          attackSourceId: sourceA, attackSourceLabel: 'Honedge · aaaaaa',
          presentationDamageBaseBonus: 1,
        },
        { move: { name: 'Struggle' }, automatic: true, attackSourceId: sourceB, attackSourceLabel: 'Doublade · bbbbbb' },
      ],
    })
    const options = buildTokenMoveMenuOptions(token(), entries)
      .filter(option => option.name === 'Struggle')

    expect(options.map(option => [option.name, option.attackSourceId ?? null])).toEqual([
      ['Struggle', null],
      ['Struggle', sourceA],
      ['Struggle', sourceB],
    ])
    expect(new Set(options.map(option => option.optionId)).size).toBe(3)
    expect(options.map(option => option.damageBase)).toEqual([4, 5, 4])
    expect(options[1]?.damageFormula).not.toBe(options[0]?.damageFormula)
    expect(tokenMoveUseReference(options[0]!)).toEqual({ moveName: 'Struggle', attackSourceId: null })
    expect(tokenMoveUseReference(options[2]!)).toEqual({ moveName: 'Struggle', attackSourceId: sourceB })
  })

  it('projects reviewed Ability Connection moves as automatic live-play menu entries', () => {
    const entries = pokemonMoveEntriesForSheet({
      slug: 'connections', species: 'Exeggcute', level: 20,
      abilities: [{ name: 'Dust Cloud' }, { name: 'Eggscellence' }],
      movelist: [{ name: 'Tackle' }],
    } as CharacterSheet)

    expect(entries).toContainEqual({ move: { name: 'Poison Powder' }, automatic: true })
    expect(entries).toContainEqual({ move: { name: 'Barrage' }, automatic: true })
    expect(entries).toContainEqual({ move: { name: 'Tackle' }, automatic: false })
  })

  it('uses adjusted DB and current combat-stage adjusted attack stats', () => {
    const [move] = buildTokenMoveMenuOptions(token(), [
      { move: { name: 'Tackle' }, automatic: false },
    ])

    expect(move.damageBase).toBe(6)
    expect(move.hasStab).toBe(true)
    expect(move.baseAttackStat).toBe(10)
    expect(move.attackStage).toBe(2)
    expect(move.attackStat).toBe(14)
    expect(move.damageAverage).toBe(29)
    expect(move.damageFormula).toBe('2d6+8+14')
    expect(move.automation).toMatchObject({
      canonicalId: 'Tackle',
      baseStatus: 'complete',
      baseStatusLabel: 'Complete',
      interactionStatus: 'unassessed',
      interactionStatusLabel: 'Unassessed',
      runtimeKind: 'movespec-v2',
      blockerCodes: [],
    })
    expect(move.automation.details).toEqual([])
    expect(move.disabledByAutomation).toBe(false)
  })

  it('marks Moves unavailable from the bounded public Staggering Weight projection', () => {
    const [move] = buildTokenMoveMenuOptions(token({
      physicalPowerLoad: {
        loadClass: 'staggering', movementMetersPerShift: 1, speedCombatStagePenalty: -4,
        accuracyPenalty: -4, evasionPenalty: -4, standardActionsAllowed: false, athleticsCheckDc: 4,
      },
    }), [{ move: { name: 'Tackle' }, automatic: false }])
    expect(move).toMatchObject({
      disabledByPhysicalLoad: true,
      physicalLoadUseBlock: expect.stringContaining('Staggering Weight'),
    })
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

  it('shows completed canonical moves and keeps unknown custom moves blocked', () => {
    const moves = buildTokenMoveMenuOptions(token(), [
      { move: { name: 'Tackle' }, automatic: false },
      { move: { name: 'Teleport' }, automatic: false },
      { move: { name: 'Custom Beam', category: 'Special', db: 6 }, automatic: false },
    ])

    expect(moves.map((move) => move.name)).toEqual(['Tackle', 'Teleport', 'Custom Beam'])
    expect(moves.find((move) => move.name === 'Tackle')).toMatchObject({
      hasAutomationScript: true,
      disabledByAutomation: false,
      automation: { baseStatus: 'complete' },
    })
    expect(moves.find((move) => move.name === 'Teleport')).toMatchObject({
      hasAutomationScript: true,
      disabledByAutomation: false,
      automation: {
        canonicalId: 'Teleport',
        baseStatus: 'complete',
        blockerCodes: [],
      },
    })
    expect(moves.find((move) => move.name === 'Custom Beam')).toMatchObject({
      hasAutomationScript: false,
      disabledByAutomation: true,
      automation: {
        canonicalId: null,
        baseStatus: 'blocked',
        blockerCodes: ['catalog.unreviewed'],
      },
    })
  })

  it('uses the shared encounter projection for temporary and unavailable menu moves', () => {
    const effect = (
      id: string,
      payload: ReturnType<typeof moveListOverlayEncounterEffectFixture>['payload'],
    ) => ({
      ...moveListOverlayEncounterEffectFixture(payload),
      id,
      affected: { placementIds: ['token'], sideIds: [], cells: [] },
    })
    const sheet: CharacterSheet = {
      slug: 'bolt',
      nickname: 'Bolt',
      species: 'Pikachu',
      level: 10,
      movelist: [{ name: 'Tackle' }, { name: 'Mimic' }, { name: 'Growl' }],
    }
    const entries = moveEntriesForPlacement({
      id: 'token',
      sheetKind: 'pokemon',
      sheetSlug: 'bolt',
    }, {
      pokemon: new Map([['bolt', sheet]]),
    }, {
      encounterEffects: [
        effect('effect.move-list.replace', {
          action: 'replace',
          replacedCanonicalMoveId: 'Mimic',
          canonicalMoveId: 'Scratch',
          copiedSpecHash: '1'.repeat(64),
        }),
        effect('effect.move-list.add', {
          action: 'add',
          canonicalMoveId: 'Swords Dance',
          copiedSpecHash: '2'.repeat(64),
        }),
        effect('effect.move-list.disable', {
          action: 'disable',
          canonicalMoveIds: ['Tackle'],
        }),
        effect('effect.move-list.restrict', {
          action: 'restrict',
          canonicalMoveIds: ['Tackle', 'Scratch', 'Swords Dance'],
        }),
      ],
    })
    const moves = buildTokenMoveMenuOptions(token(), entries)

    expect(moves.some(move => move.name === 'Mimic')).toBe(false)
    expect(moves.find(move => move.name === 'Scratch')).toMatchObject({
      moveList: {
        source: 'encounter-overlay',
        effectId: 'effect.move-list.replace',
        copiedSpecHash: '1'.repeat(64),
        available: true,
      },
      disabledByMoveList: false,
    })
    expect(moves.find(move => move.name === 'Swords Dance')).toMatchObject({
      moveList: { source: 'encounter-overlay', effectId: 'effect.move-list.add' },
      disabledByMoveList: false,
    })
    expect(moves.find(move => move.name === 'Tackle')).toMatchObject({
      moveList: { blockReason: 'move-list-disabled' },
      disabledByMoveList: true,
    })
    expect(moves.find(move => move.name === 'Growl')).toMatchObject({
      moveList: { blockReason: 'move-list-restricted' },
      disabledByMoveList: true,
    })
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

  it('allows only At-Will Moves while Suppressed', () => {
    const moves = buildTokenMoveMenuOptions(token({ conditions: ['Suppressed'] }), [
      { move: { name: 'Tackle' }, automatic: false },
      { move: { name: 'Swords Dance' }, automatic: false },
      { move: { name: 'Hyper Beam' }, automatic: false },
    ])

    expect(moves.find(move => move.name === 'Tackle')?.conditionUseBlock).toBeNull()
    for (const moveName of ['Swords Dance', 'Hyper Beam']) {
      expect(moves.find(move => move.name === moveName)).toMatchObject({
        disabledByCondition: true,
        conditionUseBlock: {
          condition: 'Suppressed',
          reason: expect.stringContaining('not At-Will'),
        },
      })
    }
  })

  it('marks Dash moves unavailable while the actor is Stuck', () => {
    const moves = buildTokenMoveMenuOptions(token({ conditions: ['Stuck'] }), [
      { move: { name: 'Crush Claw' }, automatic: false },
      { move: { name: 'Crunch' }, automatic: false },
    ])

    expect(moves.find(move => move.name === 'Crush Claw')).toMatchObject({
      disabledByCondition: true,
      conditionUseBlock: {
        condition: 'Stuck',
        label: 'Stuck',
        reason: 'Moves with the Dash keyword cannot be used while Stuck.',
      },
    })
    expect(moves.find(move => move.name === 'Crunch')?.disabledByCondition).toBe(false)
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
    expect(move.damageAverage).toBe(26.5)
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
      damageAverage: 30.5,
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

  it('filters manually stored Struggle variants whose capability is absent', () => {
    const pokemonEntries = pokemonMoveEntriesForSheet({
      slug: 'abra',
      nickname: 'Abra',
      species: 'Abra',
      level: 1,
      movelist: [
        { name: 'Struggle (Fountain Physical)' },
        { name: 'Tackle' },
      ],
      capabilities: { other: [] },
    })
    expect(pokemonEntries).not.toContainEqual({
      move: { name: 'Struggle (Fountain Physical)' },
      automatic: false,
    })
    expect(pokemonEntries).toContainEqual({ move: { name: 'Tackle' }, automatic: false })

    const trainerEntries = trainerMoveEntriesForSheet({
      slug: 'trainer',
      name: 'Trainer',
      level: 1,
      movelist: [{ name: 'Struggle (Freezer Special)' }],
      capabilities: { other: [] },
    })
    expect(trainerEntries).toEqual([
      { move: { name: 'Struggle' }, automatic: true },
    ])
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
