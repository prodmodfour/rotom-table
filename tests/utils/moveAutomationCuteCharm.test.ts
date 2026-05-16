import { describe, expect, it } from 'vitest'
import {
  buildCuteCharmReactionConditionUpdate,
  buildCuteCharmReactionPrompts,
  cuteCharmGendersAreOpposite,
  normalizeCuteCharmGender,
  tokenCanCuteCharmAttacker,
  tokenHasCuteCharm,
} from '~/utils/moveAutomationCuteCharm'
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

describe('move automation Cute Charm reactions', () => {
  it('normalizes binary genders for opposite-gender trigger checks', () => {
    expect(normalizeCuteCharmGender('F')).toBe('Female')
    expect(normalizeCuteCharmGender('♂')).toBe('Male')
    expect(normalizeCuteCharmGender('male')).toBe('Male')
    expect(normalizeCuteCharmGender('Genderless')).toBeNull()
    expect(cuteCharmGendersAreOpposite('Female', 'M')).toBe(true)
    expect(cuteCharmGendersAreOpposite('Female', 'Female')).toBe(false)
    expect(cuteCharmGendersAreOpposite('Female', undefined)).toBe(false)
  })

  it('detects usable Cute Charm only when the attacker can become infatuated', () => {
    const defender = token({ id: 'd', gender: 'Female', abilityNames: ['Cute Charm'] })

    expect(tokenHasCuteCharm(defender)).toBe(true)
    expect(tokenCanCuteCharmAttacker(defender, token({ id: 'a', gender: 'Male' }))).toBe(true)
    expect(tokenCanCuteCharmAttacker(defender, token({ id: 'a', gender: 'Female' }))).toBe(false)
    expect(tokenCanCuteCharmAttacker(defender, token({ id: 'a', gender: 'Male', conditions: ['Infatuation: Eevee'] }))).toBe(false)
  })

  it('builds prompts for attacked opposite-gender Cute Charm defenders', () => {
    const attacker = token({ id: 'a', species: 'Nidoran♂', gender: 'Male' })
    const defender = token({ id: 'd', species: 'Vulpix', gender: 'Female', abilityNames: ['Cute Charm'] })
    const sameGender = token({ id: 's', species: 'Buneary', gender: 'Male', abilityNames: ['Cute Charm'] })

    const prompts = buildCuteCharmReactionPrompts({
      attacker,
      moveName: 'Ember',
      attackedTargets: [defender, sameGender],
      idFactory: () => 'cute-1',
    })

    expect(prompts).toEqual([{
      id: 'cute-1',
      defenderId: 'd',
      defenderName: 'Vulpix',
      attackerId: 'a',
      attackerName: 'Nidoran♂',
      moveName: 'Ember',
    }])

    expect(buildCuteCharmReactionPrompts({
      attacker,
      moveName: 'Ember',
      attackedTargets: [defender],
      existingPrompts: prompts,
    })).toEqual([])
  })

  it('adds crush-specific Infatuation to the attacker', () => {
    const attacker = token({ id: 'a', gender: 'Male', conditions: ['Burned'] })
    const defender = token({ id: 'd', species: 'Vulpix', gender: 'Female', abilityNames: ['Cute Charm'] })

    expect(buildCuteCharmReactionConditionUpdate(attacker, defender)).toEqual({
      id: 'a',
      conditions: ['Burned', 'Infatuation: Vulpix'],
    })
  })
})
