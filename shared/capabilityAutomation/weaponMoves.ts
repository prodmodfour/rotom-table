import type { CharacterSheetMove } from '~/types/characterSheet'

export const WEAPON_MOVE_SOURCE_PATH = 'books/markdown/core/09-gear-and-items.md' as const
export const WEAPON_MOVE_SOURCE_SHA256 = 'b700b95186df42500c49575d8e7f5396188809cb46cc22c3cb3df7b1e9f6b1e0' as const

export interface CapabilityWeaponMoveDefinition extends CharacterSheetMove {
  readonly weaponRangePolicy: 'source-profile'
  readonly sourcePath: typeof WEAPON_MOVE_SOURCE_PATH
  readonly sourceSha256: typeof WEAPON_MOVE_SOURCE_SHA256
  readonly contestEligibility: {
    readonly status: 'unavailable'
    readonly reasonCode: 'weapon-move-no-canonical-contest-identity'
    readonly safeReason: 'Weapon Moves have no reviewed canonical Contest identity.'
  }
}

const weaponMove = (
  move: CharacterSheetMove,
): Readonly<CapabilityWeaponMoveDefinition> => Object.freeze({
  ...move,
  weaponRangePolicy: 'source-profile',
  sourcePath: WEAPON_MOVE_SOURCE_PATH,
  sourceSha256: WEAPON_MOVE_SOURCE_SHA256,
  contestEligibility: Object.freeze({
    status: 'unavailable',
    reasonCode: 'weapon-move-no-canonical-contest-identity',
    safeReason: 'Weapon Moves have no reviewed canonical Contest identity.',
  }),
})

/**
 * All twelve PTU core weapon Moves used by Living Weapon and equipment grants.
 *
 * They are intentionally capability-owned supplemental Moves rather than rows in
 * `data/reference/moves.json`: that catalog is the frozen Pokémon Move ruleset.
 * These source-bound definitions are legal only through an exact effective
 * Capability/equipment source, and fail closed as Contest appeals.
 */
export const CAPABILITY_WEAPON_MOVES = Object.freeze({
  'Backswing': weaponMove({
    name: 'Backswing', type: 'Normal', frequency: 'EOT', ac: 2, db: 7,
    category: 'Physical', range: 'Melee, 2 Targets', effect: 'None',
  }),
  'Bash!': weaponMove({
    name: 'Bash!', type: 'Normal', frequency: 'EOT', ac: 2, db: 7,
    category: 'Physical', range: 'Melee, 1 Target',
    effect: 'Bash! lowers the target’s Initiative to 0 for 1 full round on 15+.',
  }),
  'Bullseye': weaponMove({
    name: 'Bullseye', type: 'Normal', frequency: 'EOT', ac: 2, db: 6,
    category: 'Physical', range: 'Melee, 1 Target', effect: 'Bullseye is a Critical Hit on 16+.',
  }),
  'Cheap Shot': weaponMove({
    name: 'Cheap Shot', type: 'Normal', frequency: 'EOT', ac: 2, db: 5,
    category: 'Physical', range: 'Melee, 1 Target', effect: 'Cheap Shot cannot miss.',
  }),
  'Double Swipe': weaponMove({
    name: 'Double Swipe', type: 'Normal', frequency: 'EOT', ac: 2, db: 4,
    category: 'Physical', range: 'Melee, 2 Targets; or Melee, 1 Target, Double Strike', effect: 'None',
  }),
  'Pierce!': weaponMove({
    name: 'Pierce!', type: 'Normal', frequency: 'EOT', ac: 2, db: 7,
    category: 'Physical', range: 'Melee, 1 Target',
    effect: 'Pierce! deals an additional +10 damage against targets with Damage Reduction.',
  }),
  'Wounding Strike': weaponMove({
    name: 'Wounding Strike', type: 'Normal', frequency: 'EOT', ac: 2, db: 6,
    category: 'Physical', range: 'Melee, 1 Target', effect: 'The target loses a Tick of Hit Points.',
  }),
  'Bleed!': weaponMove({
    name: 'Bleed!', type: 'Normal', frequency: 'Scene x2', ac: 2, db: 9,
    category: 'Physical', range: 'Melee, 1 Target',
    effect: 'The target loses a Tick of Hit Points at the start of their next three turns.',
  }),
  'Deadly Strike': weaponMove({
    name: 'Deadly Strike', type: 'Normal', frequency: 'Scene x2', ac: 2, db: 6,
    category: 'Physical', range: 'Melee, 1 Target', effect: 'If Deadly Strike hits, it is a Critical Hit.',
  }),
  'Gouge': weaponMove({
    name: 'Gouge', type: 'Normal', frequency: 'Scene x2', ac: 2, db: 5,
    category: 'Physical', range: 'Melee, 1 Target, Double Strike',
    effect: 'If both hits of Gouge hit the target, the target gains an Injury.',
  }),
  'Titanic Slam': weaponMove({
    name: 'Titanic Slam', type: 'Normal', frequency: 'Scene x2', ac: 3, db: 11,
    category: 'Physical', range: 'Melee, 1 Target',
    effect: 'On even-numbered accuracy rolls, the target is Slowed for one full round.',
  }),
  'Triple Threat': weaponMove({
    name: 'Triple Threat', type: 'Normal', frequency: 'Scene x2', ac: 2, db: 7,
    category: 'Physical', range: 'Melee, 3 Targets', effect: 'None',
  }),
} satisfies Record<string, Readonly<CapabilityWeaponMoveDefinition>>)

export type CapabilityWeaponMoveName = keyof typeof CAPABILITY_WEAPON_MOVES

/** Definitions and executable handlers advance independently during closure. */
const NATIVE_CAPABILITY_WEAPON_MOVE_NAMES: ReadonlySet<CapabilityWeaponMoveName> = new Set(
  Object.keys(CAPABILITY_WEAPON_MOVES) as CapabilityWeaponMoveName[],
)

export const isNativeCapabilityWeaponMoveName = (
  moveName: string | null | undefined,
): boolean => {
  const canonicalId = capabilityWeaponMoveName(moveName)
  return canonicalId !== null && NATIVE_CAPABILITY_WEAPON_MOVE_NAMES.has(canonicalId)
}

const NORMALIZED_CAPABILITY_WEAPON_MOVE_NAMES = new Map(
  Object.keys(CAPABILITY_WEAPON_MOVES).map(name => [name.trim().toLocaleLowerCase('en-US'), name as CapabilityWeaponMoveName]),
)

export const capabilityWeaponMove = (
  moveName: string | null | undefined,
): CharacterSheetMove | null => {
  const canonicalId = NORMALIZED_CAPABILITY_WEAPON_MOVE_NAMES.get(
    moveName?.trim().toLocaleLowerCase('en-US') ?? '',
  )
  return canonicalId ? CAPABILITY_WEAPON_MOVES[canonicalId] : null
}

export const capabilityWeaponMoveName = (
  moveName: string | null | undefined,
): CapabilityWeaponMoveName | null => {
  const canonicalId = NORMALIZED_CAPABILITY_WEAPON_MOVE_NAMES.get(
    moveName?.trim().toLocaleLowerCase('en-US') ?? '',
  )
  return canonicalId ?? null
}

export const isCapabilityWeaponMoveName = (
  moveName: string | null | undefined,
): boolean => capabilityWeaponMoveName(moveName) !== null

/** Living Weapon grants are controlled by the linked wielder's Combat rank. */
export const livingWeaponMoveNames = (
  species: string | null | undefined,
  combatSkillRankValue: number | null | undefined,
): readonly CapabilityWeaponMoveName[] => {
  const canonicalSpecies = species?.trim().toLocaleLowerCase('en-US') ?? ''
  const rank = Number.isFinite(combatSkillRankValue) ? Math.floor(combatSkillRankValue ?? 0) : 0
  if (canonicalSpecies === 'honedge') return rank >= 4 ? ['Wounding Strike'] : []
  if (canonicalSpecies === 'doublade') return rank >= 4 ? ['Double Swipe'] : []
  if (canonicalSpecies === 'aegislash') return [
    ...(rank >= 4 ? ['Wounding Strike' as const] : []),
    ...(rank >= 6 ? ['Bleed!' as const] : []),
  ]
  return []
}
