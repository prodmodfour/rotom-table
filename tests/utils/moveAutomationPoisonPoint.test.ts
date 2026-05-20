import { describe, expect, it } from 'vitest'
import {
  buildPoisonPointReactionConditionUpdate,
  buildPoisonPointReactionPrompts,
  isPoisonPointTriggeringMove,
  poisonPointAttackerBlockSource,
  tokenCanPoisonPointAttacker,
  tokenHasPoisonAffliction,
  tokenHasPoisonPoint,
} from '~/utils/moveAutomationPoisonPoint'
import type { CombatStageMap } from '~/types/combatStages'
import type { MoveAutomationScript } from '~/types/moveAutomation'
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
  species: 'Token',
  slug: 'token',
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/token.png',
  entityKind: 'pokemon',
  sheetKind: 'pokemon',
  sheetSlug: 'token',
  position: { x: 0, y: 0, z: 0 },
  level: 1,
  currentHp: 10,
  maxHp: 10,
  atk: 1,
  satk: 1,
  def: 1,
  sdef: 1,
  defenderTypes: [],
  combatStages: stages(),
  conditions: [],
  tokenItems: [],
  ...overrides,
} as SpawnedPokemon)

const script = (
  overrides: Partial<Pick<MoveAutomationScript, 'range' | 'keywords'>> = {},
): Pick<MoveAutomationScript, 'range' | 'keywords'> => ({
  range: 'Melee, 1 Target',
  keywords: ['Melee'],
  ...overrides,
})

describe('move automation Poison Point reactions', () => {
  it('detects only melee move scripts as Poison Point triggers', () => {
    expect(isPoisonPointTriggeringMove(script())).toBe(true)
    expect(isPoisonPointTriggeringMove(script({ range: '6, 1 Target', keywords: [] }))).toBe(false)
    expect(isPoisonPointTriggeringMove(script({ range: 'Melee 1', keywords: [] }))).toBe(true)
    expect(isPoisonPointTriggeringMove(null)).toBe(false)
  })

  it('detects usable Poison Point only when the attacker can be poisoned', () => {
    const defender = token({ id: 'd', abilityNames: ['Poison Point'] })

    expect(tokenHasPoisonPoint(defender)).toBe(true)
    expect(tokenCanPoisonPointAttacker(defender, token({ id: 'a' }))).toBe(true)
    expect(tokenCanPoisonPointAttacker(token({ id: 'd' }), token({ id: 'a' }))).toBe(false)
    expect(tokenCanPoisonPointAttacker(defender, token({ id: 'a', defenderTypes: ['Steel'] }))).toBe(false)
    expect(tokenCanPoisonPointAttacker(defender, token({ id: 'a', defenderTypes: ['Poison'] }))).toBe(false)
    expect(tokenCanPoisonPointAttacker(defender, token({ id: 'a', abilityNames: ['Immunity'] }))).toBe(false)
    expect(tokenCanPoisonPointAttacker(defender, token({ id: 'a', conditions: ['Poisoned'] }))).toBe(false)
    expect(tokenHasPoisonAffliction(token({ conditions: ['Badly Poisoned'] }))).toBe(true)
    expect(poisonPointAttackerBlockSource(token({ defenderTypes: ['Steel'] }))).toBe('Steel type')
  })

  it('builds prompts for hit Poison Point defenders after melee moves', () => {
    const attacker = token({ id: 'a', species: 'Attacker' })
    const defender = token({ id: 'd', species: 'Nidoran♀', abilityNames: ['Poison Point'] })
    const withoutAbility = token({ id: 'w', species: 'Wurmple' })

    const prompts = buildPoisonPointReactionPrompts({
      attacker,
      moveName: 'Tackle',
      hitTargets: [defender, withoutAbility],
      script: script(),
      idFactory: () => 'poison-point-1',
    })

    expect(prompts).toEqual([{
      id: 'poison-point-1',
      defenderId: 'd',
      defenderName: 'Nidoran♀',
      attackerId: 'a',
      attackerName: 'Attacker',
      moveName: 'Tackle',
    }])

    expect(buildPoisonPointReactionPrompts({
      attacker,
      moveName: 'Tackle',
      hitTargets: [defender],
      script: script(),
      existingPrompts: prompts,
    })).toEqual([])
    expect(buildPoisonPointReactionPrompts({
      attacker,
      moveName: 'Ember',
      hitTargets: [defender],
      script: script({ range: '6, 1 Target', keywords: [] }),
    })).toEqual([])
  })

  it('adds Poisoned to the attacker', () => {
    const attacker = token({ id: 'a', conditions: ['Burned'] })
    const defender = token({ id: 'd', abilityNames: ['Poison Point'] })

    expect(buildPoisonPointReactionConditionUpdate(attacker, defender)).toEqual({
      id: 'a',
      conditions: ['Burned', 'Poisoned'],
    })
  })
})
