import type { CharacterSheetMove } from '~/types/characterSheet'

/**
 * PTU weapon Moves referenced by the canonical Living Weapon and Wielder rules.
 *
 * They are intentionally capability-owned supplemental Moves rather than rows in
 * `data/reference/moves.json`: that catalog is the frozen Pokémon Move ruleset,
 * while these four definitions come from the core weapon chapter and are only
 * legal through an exact effective Capability/equipment source.
 */
export const CAPABILITY_WEAPON_MOVES = Object.freeze({
  'Backswing': Object.freeze({
    name: 'Backswing',
    type: 'Normal',
    frequency: 'EOT',
    ac: 2,
    db: 7,
    category: 'Physical',
    range: 'Melee, 2 Targets',
    effect: 'None',
  }),
  'Cheap Shot': Object.freeze({
    name: 'Cheap Shot',
    type: 'Normal',
    frequency: 'EOT',
    ac: 2,
    db: 5,
    category: 'Physical',
    range: 'Melee, 1 Target',
    effect: 'Cheap Shot cannot miss.',
  }),
  'Double Swipe': Object.freeze({
    name: 'Double Swipe',
    type: 'Normal',
    frequency: 'EOT',
    ac: 2,
    db: 4,
    category: 'Physical',
    range: 'Melee, 2 Targets; or Melee, 1 Target, Double Strike',
    effect: 'None',
  }),
  'Wounding Strike': Object.freeze({
    name: 'Wounding Strike',
    type: 'Normal',
    frequency: 'EOT',
    ac: 2,
    db: 6,
    category: 'Physical',
    range: 'Melee, 1 Target',
    effect: 'The target loses a Tick of Hit Points.',
  }),
  'Bleed!': Object.freeze({
    name: 'Bleed!',
    type: 'Normal',
    frequency: 'Scene x2',
    ac: 2,
    db: 9,
    category: 'Physical',
    range: 'Melee, 1 Target',
    effect: 'The target loses a Tick of Hit Points at the start of their next three turns.',
  }),
} satisfies Record<string, CharacterSheetMove>)

export type CapabilityWeaponMoveName = keyof typeof CAPABILITY_WEAPON_MOVES

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
