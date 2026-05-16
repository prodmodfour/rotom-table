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
})
