import { describe, expect, it } from 'vitest'
import {
  INTIMIDATE_ABILITY_NAME,
  MOXIE_ABILITY_NAME,
  getAbilityAutomationCategory,
  mapAbilityTargetCandidates,
  resolveMapAbilityAutomationTransaction,
} from '~/utils/abilityAutomation'
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
    expect(getAbilityAutomationCategory(INTIMIDATE_ABILITY_NAME)).toBe('map')
    expect(getAbilityAutomationCategory(MOXIE_ABILITY_NAME)).toBe('map')
    expect(getAbilityAutomationCategory('Quick Feet')).toBe('passive')
    expect(getAbilityAutomationCategory('Run Away')).toBeNull()
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
