import { describe, expect, it } from 'vitest'
import {
  ELECTRIC_GRASSY_TERRAIN_KINDS,
  GRASSY_TERRAIN_TURN_HEAL_PERCENT,
  MISTY_PSYCHIC_TERRAIN_KINDS,
  MOVE_AUTOMATION_TERRAIN_KINDS,
  electricGrassyTerrainDamagePolicy,
  terrainDamagePolicy,
} from '#shared/moveAutomation/terrain'

describe('authoritative Terrain policy', () => {
  it('exposes exact canonical damage and healing values', () => {
    expect(ELECTRIC_GRASSY_TERRAIN_KINDS).toEqual(['electric', 'grassy'])
    expect(MISTY_PSYCHIC_TERRAIN_KINDS).toEqual(['misty', 'psychic'])
    expect(MOVE_AUTOMATION_TERRAIN_KINDS).toEqual([
      'electric',
      'grassy',
      'misty',
      'psychic',
    ])
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
    expect(terrainDamagePolicy('misty', 'Dragon')).toEqual({
      value: -10,
      reasonCode: 'terrain.misty.dragon-damage-penalty',
      typeId: 'dragon',
    })
    expect(terrainDamagePolicy('psychic', 'PSYCHIC')).toEqual({
      value: 10,
      reasonCode: 'terrain.psychic.psychic-damage-bonus',
      typeId: 'psychic',
    })
    expect(electricGrassyTerrainDamagePolicy('electric', 'grass')).toBeNull()
    expect(terrainDamagePolicy('misty', 'fairy')).toBeNull()
    expect(terrainDamagePolicy('psychic', 'dragon')).toBeNull()
  })
})
