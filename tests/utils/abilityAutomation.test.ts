import { describe, expect, it } from 'vitest'
import {
  CELEBRATE_ABILITY_NAME,
  CUTE_CHARM_ABILITY_NAME,
  HEALER_ABILITY_NAME,
  INTIMIDATE_ABILITY_NAME,
  LEAF_GUARD_ABILITY_NAME,
  MOXIE_ABILITY_NAME,
  SHIELD_DUST_ABILITY_NAME,
  SWEET_VEIL_ABILITY_NAME,
  getAbilityAutomation,
  getAbilityAutomationCategory,
  mapAbilityTargetCandidates,
  resolveMapAbilityAutomationTransaction,
} from '~/utils/abilityAutomation'
import { MUD_DWELLER_ABILITY_NAME } from '~/utils/sheetPassiveAbilityEffects'
import {
  ILLUMINATE_ABILITY_NAME,
  KEEN_EYE_ABILITY_NAME,
  NO_GUARD_ABILITY_NAME,
} from '~/utils/sheetAbilityCombatModifiers'
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

const token = (id: string, overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
  id,
  species: id,
  slug: id,
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: `/${id}.png`,
  entityKind: 'pokemon',
  sheetKind: 'pokemon',
  sheetSlug: id,
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

describe('ability automation helpers', () => {
  it('classifies sheet and map ability automation categories', () => {
    expect(getAbilityAutomationCategory('Sand Veil')).toBe('sheet')
    expect(getAbilityAutomationCategory('Snow Cloak')).toBe('sheet')
    expect(getAbilityAutomationCategory(CELEBRATE_ABILITY_NAME)).toBe('map')
    expect(getAbilityAutomationCategory(CUTE_CHARM_ABILITY_NAME)).toBe('passive')
    expect(getAbilityAutomationCategory(HEALER_ABILITY_NAME)).toBe('map')
    expect(getAbilityAutomationCategory(INTIMIDATE_ABILITY_NAME)).toBe('map')
    expect(getAbilityAutomationCategory(LEAF_GUARD_ABILITY_NAME)).toBe('map')
    expect(getAbilityAutomationCategory(MOXIE_ABILITY_NAME)).toBe('map')
    expect(getAbilityAutomationCategory(ILLUMINATE_ABILITY_NAME)).toBe('passive')
    expect(getAbilityAutomationCategory(KEEN_EYE_ABILITY_NAME)).toBe('passive')
    expect(getAbilityAutomationCategory('Quick Feet')).toBe('passive')
    expect(getAbilityAutomationCategory(NO_GUARD_ABILITY_NAME)).toBe('passive')
    expect(getAbilityAutomationCategory(MUD_DWELLER_ABILITY_NAME)).toBe('passive')
    expect(getAbilityAutomationCategory(SHIELD_DUST_ABILITY_NAME)).toBe('passive')
    expect(getAbilityAutomationCategory(SWEET_VEIL_ABILITY_NAME)).toBe('passive')
    expect(getAbilityAutomationCategory('Run Away')).toBeNull()
  })

  it('marks local post-move ability prompts as assisted instead of automatic', () => {
    expect(getAbilityAutomation(CELEBRATE_ABILITY_NAME)?.label).toBe('Assisted')
    expect(getAbilityAutomation(CUTE_CHARM_ABILITY_NAME)?.label).toBe('Assisted')
    expect(getAbilityAutomation(MOXIE_ABILITY_NAME)?.label).toBe('Assisted')
    expect(getAbilityAutomation('Poison Point')?.label).toBe('Assisted')
  })

  it('targets other tokens and resolves Intimidate stage updates', () => {
    const user = token('user')
    const target = token('target', { combatStages: stages({ atk: -6 }) })
    expect(mapAbilityTargetCandidates(user, [user, target]).map((entry) => entry.id)).toEqual(['target'])

    const transaction = resolveMapAbilityAutomationTransaction({
      abilityName: INTIMIDATE_ABILITY_NAME,
      user,
      target,
    })

    expect(transaction).toMatchObject({
      userId: 'user',
      abilityName: INTIMIDATE_ABILITY_NAME,
      category: 'map',
      combatStageUpdates: [{ id: 'target', stages: { atk: -6 } }],
    })
  })

  it('resolves Celebrate as a self reminder to Disengage after hitting a target', () => {
    const user = token('user')
    const target = token('target')

    expect(mapAbilityTargetCandidates(user, [user, target], CELEBRATE_ABILITY_NAME)).toEqual([])

    const transaction = resolveMapAbilityAutomationTransaction({
      abilityName: CELEBRATE_ABILITY_NAME,
      user,
      target,
    })

    expect(transaction).toMatchObject({
      userId: 'user',
      abilityName: CELEBRATE_ABILITY_NAME,
      category: 'map',
      combatStageUpdates: [],
      conditionUpdates: [],
      logLines: [
        'user triggered Celebrate after hitting target.',
        'user may immediately Disengage 1 meter as a Free Action without provoking an Attack of Opportunity.',
      ],
    })
  })

  it('resolves Healer by curing all persistent and volatile status afflictions on a target', () => {
    const user = token('user')
    const target = token('target', { conditions: ['Burned', 'Confused', 'Disabled: Ember', 'Vulnerable'] })

    const transaction = resolveMapAbilityAutomationTransaction({
      abilityName: HEALER_ABILITY_NAME,
      user,
      target,
    })

    expect(transaction).toMatchObject({
      userId: 'user',
      abilityName: HEALER_ABILITY_NAME,
      category: 'map',
      combatStageUpdates: [],
      conditionUpdates: [{ id: 'target', conditions: ['Vulnerable'] }],
      logLines: [
        'user used Healer on target.',
        'target was cured of Burned, Confused, and Disabled: Ember.',
      ],
    })
  })

  it('resolves Leaf Guard by curing one user status affliction and noting Sunny Weather', () => {
    const user = token('user', { conditions: ['Burned', 'Confused', 'Vulnerable'] })

    expect(mapAbilityTargetCandidates(user, [user, token('target')], LEAF_GUARD_ABILITY_NAME)).toEqual([])

    const transaction = resolveMapAbilityAutomationTransaction({
      abilityName: LEAF_GUARD_ABILITY_NAME,
      user,
      fieldEffects: { weather: [{ kind: 'sunny' }] },
    })

    expect(transaction).toMatchObject({
      userId: 'user',
      abilityName: LEAF_GUARD_ABILITY_NAME,
      category: 'map',
      combatStageUpdates: [],
      conditionUpdates: [{ id: 'user', conditions: ['Confused', 'Vulnerable'] }],
      logLines: [
        'user used Leaf Guard.',
        'user was cured of Burned.',
        "Leaf Guard's frequency is ignored during Sunny Weather.",
      ],
    })
  })

  it('resolves Moxie as a self Attack stage update', () => {
    const user = token('user', { combatStages: stages({ atk: 2 }) })
    const target = token('target', { currentHp: 0 })

    expect(mapAbilityTargetCandidates(user, [user, target], MOXIE_ABILITY_NAME)).toEqual([])

    const transaction = resolveMapAbilityAutomationTransaction({
      abilityName: MOXIE_ABILITY_NAME,
      user,
      target,
    })

    expect(transaction).toMatchObject({
      userId: 'user',
      abilityName: MOXIE_ABILITY_NAME,
      category: 'map',
      combatStageUpdates: [{ id: 'user', stages: { atk: 3 } }],
      logLines: [
        'user triggered Moxie after causing target to faint.',
        "user's Attack rose by 1 Combat Stage.",
      ],
    })
  })
})
