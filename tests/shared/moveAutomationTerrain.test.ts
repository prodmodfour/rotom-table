import { describe, expect, it } from 'vitest'
import {
  ELECTRIC_GRASSY_TERRAIN_KINDS,
  GRASSY_TERRAIN_TURN_HEAL_PERCENT,
  electricGrassyTerrainDamagePolicy,
} from '#shared/moveAutomation/terrain'

describe('Electric and Grassy Terrain policy', () => {
  it('exposes exact canonical damage and healing values', () => {
    expect(ELECTRIC_GRASSY_TERRAIN_KINDS).toEqual(['electric', 'grassy'])
    expect(GRASSY_TERRAIN_TURN_HEAL_PERCENT).toBe(10)
    expect(electricGrassyTerrainDamagePolicy('electric', ' Electric ')).toEqual({
      value: 10,
      reasonCode: 'terrain.electric.electric-damage-bonus',
      typeId: 'electric',
    })
    expect(electricGrassyTerrainDamagePolicy('grassy', 'GRASS')).toEqual({
      value: 10,
      reasonCode: 'terrain.grassy.grass-damage-bonus',
      typeId: 'grass',
    })
    expect(electricGrassyTerrainDamagePolicy('electric', 'grass')).toBeNull()
    expect(electricGrassyTerrainDamagePolicy('grassy', 'electric')).toBeNull()
  })
})
