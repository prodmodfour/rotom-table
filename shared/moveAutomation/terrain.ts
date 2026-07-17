export const ELECTRIC_GRASSY_TERRAIN_KINDS = ['electric', 'grassy'] as const
export type ElectricGrassyTerrainKind = (typeof ELECTRIC_GRASSY_TERRAIN_KINDS)[number]

export const GRASSY_TERRAIN_TURN_HEAL_PERCENT = 10 as const

export interface ElectricGrassyTerrainDamagePolicy {
  readonly value: 10
  readonly reasonCode:
    | 'terrain.electric.electric-damage-bonus'
    | 'terrain.grassy.grass-damage-bonus'
  readonly typeId: 'electric' | 'grass'
}

const TERRAIN_DAMAGE_POLICIES = Object.freeze({
  electric: Object.freeze({
    value: 10,
    reasonCode: 'terrain.electric.electric-damage-bonus',
    typeId: 'electric',
  }),
  grassy: Object.freeze({
    value: 10,
    reasonCode: 'terrain.grassy.grass-damage-bonus',
    typeId: 'grass',
  }),
} as const satisfies Record<ElectricGrassyTerrainKind, ElectricGrassyTerrainDamagePolicy>)

/** Canonical Electric/Grassy Damage Roll rule shared by v1 adaptation and v2 planning. */
export const electricGrassyTerrainDamagePolicy = (
  terrain: ElectricGrassyTerrainKind,
  moveType: string,
): ElectricGrassyTerrainDamagePolicy | null => {
  const policy = TERRAIN_DAMAGE_POLICIES[terrain]
  return moveType.trim().toLowerCase() === policy.typeId ? policy : null
}
