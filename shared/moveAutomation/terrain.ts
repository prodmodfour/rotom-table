export const ELECTRIC_GRASSY_TERRAIN_KINDS = ['electric', 'grassy'] as const
export type ElectricGrassyTerrainKind = (typeof ELECTRIC_GRASSY_TERRAIN_KINDS)[number]

export const MISTY_PSYCHIC_TERRAIN_KINDS = ['misty', 'psychic'] as const
export type MistyPsychicTerrainKind = (typeof MISTY_PSYCHIC_TERRAIN_KINDS)[number]

export const MOVE_AUTOMATION_TERRAIN_KINDS = [
  ...ELECTRIC_GRASSY_TERRAIN_KINDS,
  ...MISTY_PSYCHIC_TERRAIN_KINDS,
] as const
export type MoveAutomationTerrainKind = (typeof MOVE_AUTOMATION_TERRAIN_KINDS)[number]

export const GRASSY_TERRAIN_TURN_HEAL_PERCENT = 10 as const

export interface TerrainDamagePolicy {
  readonly value: 10 | -10
  readonly reasonCode:
    | 'terrain.electric.electric-damage-bonus'
    | 'terrain.grassy.grass-damage-bonus'
    | 'terrain.misty.dragon-damage-penalty'
    | 'terrain.psychic.psychic-damage-bonus'
  readonly typeId: 'electric' | 'grass' | 'dragon' | 'psychic'
}

export type ElectricGrassyTerrainDamagePolicy = TerrainDamagePolicy & {
  readonly value: 10
  readonly reasonCode:
    | 'terrain.electric.electric-damage-bonus'
    | 'terrain.grassy.grass-damage-bonus'
  readonly typeId: 'electric' | 'grass'
}

export interface MistyTerrainConditionProtection {
  readonly kind: 'ignore-first-turn'
  readonly terrainKind: 'misty'
  readonly zoneId: string
  readonly sourceLabel: string
  readonly reasonCode: 'terrain.misty.first-turn-status-protection'
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
  misty: Object.freeze({
    value: -10,
    reasonCode: 'terrain.misty.dragon-damage-penalty',
    typeId: 'dragon',
  }),
  psychic: Object.freeze({
    value: 10,
    reasonCode: 'terrain.psychic.psychic-damage-bonus',
    typeId: 'psychic',
  }),
} as const satisfies Record<MoveAutomationTerrainKind, TerrainDamagePolicy>)

/** Canonical Terrain Damage Roll rule shared by v1 adaptation and v2 planning. */
export const terrainDamagePolicy = (
  terrain: MoveAutomationTerrainKind,
  moveType: string,
): TerrainDamagePolicy | null => {
  const policy = TERRAIN_DAMAGE_POLICIES[terrain]
  return moveType.trim().toLowerCase() === policy.typeId ? policy : null
}

/** Backwards-compatible narrow policy for the MA-140 Electric/Grassy callers. */
export const electricGrassyTerrainDamagePolicy = (
  terrain: ElectricGrassyTerrainKind,
  moveType: string,
): ElectricGrassyTerrainDamagePolicy | null => (
  terrainDamagePolicy(terrain, moveType) as ElectricGrassyTerrainDamagePolicy | null
)
