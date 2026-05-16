import { describe, expect, it } from 'vitest'
import { moveAutomationConditionImmunitySource } from '~/utils/moveAutomationConditionImmunity'
import type { SpawnedPokemon } from '~/types/pokemon'

const token = (overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
  id: 'target',
  species: 'Target',
  slug: 'target',
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/sprite.png',
  entityKind: 'pokemon',
  position: { x: 0, y: 0, z: 0 },
  sheetKind: 'pokemon',
  sheetSlug: 'target',
  level: 10,
  currentHp: 40,
  maxHp: 40,
  atk: 5,
  satk: 5,
  def: 5,
  sdef: 5,
  spd: 5,
  evasion: { physical: 0, special: 0, speed: 0 },
  defenderTypes: ['Normal'],
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  conditions: [],
  tokenItems: [],
  ...overrides,
})

describe('move automation condition immunity', () => {
  it('blocks Stuck on Ghost-type targets', () => {
    expect(moveAutomationConditionImmunitySource('Stuck', token({ defenderTypes: ['Ghost'] }))).toBe('Ghost type')
    expect(moveAutomationConditionImmunitySource('Stuck', token({ defenderTypes: ['Normal'] }))).toBeNull()
  })

  it('blocks Sleep from Sweet Veil on the target or a nearby provider', () => {
    expect(moveAutomationConditionImmunitySource('Sleep', token({ abilityNames: ['Sweet Veil'] }))).toBe('Sweet Veil')

    const target = token({ id: 'target', position: { x: 0, y: 0, z: 0 } })
    const nearbyProvider = token({
      id: 'ally',
      species: 'Ally',
      abilityNames: ['Sweet Veil'],
      position: { x: 2, y: 0, z: 0 },
    })
    const distantProvider = token({
      id: 'far',
      species: 'Far',
      abilityNames: ['Sweet Veil'],
      position: { x: 10, y: 0, z: 0 },
    })

    expect(moveAutomationConditionImmunitySource('Sleep', target, null, {
      sweetVeilProviders: [nearbyProvider],
    })).toBe('Sweet Veil (Ally)')
    expect(moveAutomationConditionImmunitySource('Sleep', target, null, {
      sweetVeilProviders: [distantProvider],
    })).toBeNull()
  })
})
