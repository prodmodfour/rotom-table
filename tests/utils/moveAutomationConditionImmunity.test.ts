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

  it('blocks Blindness with Keen Eye but not Total Blindness', () => {
    expect(moveAutomationConditionImmunitySource('Blindness', token({ abilityNames: ['Keen Eye'] }))).toBe('Keen Eye')
    expect(moveAutomationConditionImmunitySource('Blind', token({ abilityNames: ['keen-eye'] }))).toBe('Keen Eye')
    expect(moveAutomationConditionImmunitySource('Total Blindness', token({ abilityNames: ['Keen Eye'] }))).toBeNull()
  })

  it('blocks Sleep with Sweet Veil on the target or nearby providers', () => {
    const target = token({ position: { x: 0, y: 0, z: 0 } })
    const nearbyProvider = token({
      id: 'provider',
      species: 'Aromatisse',
      abilityNames: ['Sweet Veil'],
      position: { x: 3, y: 0, z: 0 },
    })
    const distantProvider = token({
      id: 'distant',
      species: 'Distant',
      abilityNames: ['Sweet Veil'],
      position: { x: 4, y: 0, z: 0 },
    })

    expect(moveAutomationConditionImmunitySource('Sleep', token({ abilityNames: ['Sweet Veil'] }))).toBe('Sweet Veil')
    expect(moveAutomationConditionImmunitySource('Sleep', target, null, {
      sweetVeilProviderCandidates: [nearbyProvider],
      isAlly: () => true,
    })).toBe('Sweet Veil (Aromatisse)')
    expect(moveAutomationConditionImmunitySource('Sleep', target, null, {
      sweetVeilProviderCandidates: [nearbyProvider],
      isAlly: () => false,
    })).toBeNull()
    expect(moveAutomationConditionImmunitySource('Sleep', target, null, {
      sweetVeilProviderCandidates: [distantProvider],
      isAlly: () => true,
    })).toBeNull()
  })
})
