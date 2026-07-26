import type { AbilityEntityEntry } from './entities'

export const AA080_MINI_NOSE_TEMPLATE_ID = 'template.mini-nose' as const
export const AA080_DREEPY_TEMPLATE_ID = 'template.dreepy-token' as const
export const AA080_MINI_NOSE_TAG = 'aa080.mini-nose' as const
export const AA080_DREEPY_TAG = 'aa080.dreepy' as const
export const AA080_MINI_NOSE_MAXIMUM = 3 as const
export const AA080_DREEPY_PLACEMENT_COUNT = 2 as const
export const AA080_DREEPY_MAXIMUM = AA080_DREEPY_PLACEMENT_COUNT
export const AA080_ENTITY_FOOTPRINT = 1 as const
export const AA080_ENTITY_CLEARANCE = 1 as const
export const AA080_MINI_NOSE_MOVEMENT_SPEED = 4 as const
export const AA080_DREEPY_MOVEMENT_SPEED = 4 as const
export const AA080_MINI_NOSE_TETHER_METERS = 5 as const

export const AA080_MOODY_STAGE_BY_ROLL = Object.freeze({
  1: 'atk',
  2: 'def',
  3: 'satk',
  4: 'sdef',
  5: 'spd',
  6: 'acc',
} as const)

export type Aa080MoodyRoll = keyof typeof AA080_MOODY_STAGE_BY_ROLL

/**
 * Canonical abilities whose frozen rules text classifies them as Defensive.
 * Mold Breaker consults this reviewed identity set; runtime prose is never parsed.
 */
export const AA080_DEFENSIVE_ABILITY_IDS = Object.freeze([
  'Aroma Veil',
  'Battle Armor',
  'Big Pecks',
  'Blur',
  'Bodyguard',
  'Bulletproof',
  'Cave Crasher',
  'Clear Body',
  'Courage',
  'Delayed Reaction',
  'Disguise',
  'Dodge',
  'Emergency Exit',
  'Fade Away',
  'Filter',
  'Flash Fire',
  'Fluffy',
  'Flying Fly Trap',
  'Friend Guard',
  'Full Metal Body',
  'Fur Coat',
  'Glisten',
  'Hyper Cutter',
  'Ice Scales',
  'Illuminate',
  'Immunity',
  'Insomnia',
  'Instinct',
  'Levitate',
  'Limber',
  'Magic Bounce',
  'Magic Guard',
  'Motor Drive',
  'Mud Shield',
  'Multiscale',
  'Oblivious',
  'Overcoat',
  'Own Tempo',
  'Parry',
  'Pastel Veil',
  'Perish Body',
  'Permafrost',
  'Prism Armor',
  'Sap Sipper',
  'Shadow Shield',
  'Shell Armor',
  'Shield Dust',
  'Solid Rock',
  'Soundproof',
  'Stamina',
  'Sturdy',
  'Sweet Veil',
  'Thick Fat',
  'Tochukaso',
  'Tolerance',
  'Type Strategist',
  'Vigor',
  'Vital Spirit',
  'Volt Absorb',
  'Water Absorb',
  'Water Bubble',
  'Water Compaction',
  'Water Veil',
  'White Smoke',
  'Windveiled',
  'Winter’s Kiss',
  'Wonder Guard',
  'Wonder Skin',
] as const)

const DEFENSIVE_ABILITY_ID_SET: ReadonlySet<string> = new Set(AA080_DEFENSIVE_ABILITY_IDS)

export const aa080IsDefensiveAbility = (canonicalId: string): boolean => (
  DEFENSIVE_ABILITY_ID_SET.has(canonicalId)
)

export const aa080IsMiniNoseEntity = (
  entity: Pick<AbilityEntityEntry, 'canonicalId' | 'kind' | 'payload' | 'tags'>,
): boolean => entity.canonicalId === 'Mini-Noses'
  && entity.kind === 'subordinate'
  && entity.payload.kind === 'subordinate'
  && entity.payload.templateId === AA080_MINI_NOSE_TEMPLATE_ID
  && entity.tags.includes(AA080_MINI_NOSE_TAG)

export const aa080IsDreepyEntity = (
  entity: Pick<AbilityEntityEntry, 'canonicalId' | 'kind' | 'payload' | 'tags'>,
): boolean => entity.canonicalId === 'Missile Launch'
  && entity.kind === 'subordinate'
  && entity.payload.kind === 'subordinate'
  && entity.payload.templateId === AA080_DREEPY_TEMPLATE_ID
  && entity.tags.includes(AA080_DREEPY_TAG)

export const aa080EntityIsActive = (
  entity: Pick<AbilityEntityEntry, 'currentHp'>,
): boolean => entity.currentHp === null || entity.currentHp > 0
