export const AA079_MEGA_LAUNCHER_MOVE_IDS = Object.freeze([
  'Aura Sphere',
  'Dark Pulse',
  'Dragon Pulse',
  'Water Pulse',
] as const)

export const AA079_MARVEL_SCALE_CONDITIONS = Object.freeze([
  'Sleep',
  'Paralysis',
  'Burned',
  'Frozen',
  'Poisoned',
  'Badly Poisoned',
] as const)

export const AA079_MEMORY_WIPE_MODE_IDS = Object.freeze([
  'swift',
  'standard',
  'extended',
] as const)
export type Aa079MemoryWipeMode = (typeof AA079_MEMORY_WIPE_MODE_IDS)[number]

export const AA079_MAGNET_PULL_PLAN_IDS = Object.freeze([
  'push-and-maximum-range',
  'push-and-minimum-range',
  'pull-and-maximum-range',
  'pull-and-minimum-range',
  'maximum-and-minimum-range',
] as const)
export type Aa079MagnetPullPlanId = (typeof AA079_MAGNET_PULL_PLAN_IDS)[number]

export const AA079_MIMICRY_FIELD_TYPES = Object.freeze({
  beach: ['ground', 'water'],
  cave: ['rock', 'dark'],
  desert: ['ground', 'rock'],
  forest: ['grass'],
  freshwater: ['water'],
  ocean: ['water'],
  grassland: ['normal', 'grass'],
  marsh: ['water', 'poison'],
  mountain: ['rock', 'ground'],
  rainforest: ['grass', 'poison'],
  taiga: ['ice', 'grass'],
  tundra: ['ice'],
  urban: ['normal', 'steel'],
} as const)

/** Server-owned map-material evidence for canonical Mimicry field rows. */
export const AA079_MIMICRY_FIELD_TAGS = Object.freeze({
  beach: ['shoreline', 'sand', 'beach'],
  cave: ['cave', 'cavern', 'shadow'],
  desert: ['desert', 'sand', 'dune'],
  forest: ['forest', 'grove', 'woodland'],
  freshwater: ['river', 'freshwater', 'lake'],
  ocean: ['ocean', 'deep-water', 'sea'],
  grassland: ['grassland', 'meadow', 'plains'],
  marsh: ['marsh', 'wetland', 'mud', 'peat', 'muck', 'silt'],
  mountain: ['mountain', 'gravel', 'cliff'],
  rainforest: ['rainforest', 'jungle'],
  taiga: ['taiga', 'boreal'],
  tundra: ['tundra', 'permafrost'],
  urban: ['urban', 'facility', 'street', 'tile', 'metal', 'nursery'],
} as const)

export const AA079_MIMICRY_WEATHER_TYPE = Object.freeze({
  sunny: 'fire',
  rainy: 'water',
  hail: 'ice',
  sandstorm: 'rock',
} as const)

export const AA079_MIMIC_MOVE_LIST_TAG = 'aa079.mimic-copy' as const
export const AA079_MIMITREE_REARM_TAG = 'aa079.mimitree-rearm' as const

export const aa079HasMimitreeRearm = (input: {
  readonly effects: readonly import('../moveAutomation/encounterEffects').EncounterEffect[] | undefined
  readonly placementId: string
}): boolean => (input.effects ?? []).some(effect => (
  effect.kind === 'capability'
  && effect.suppression.sources.length === 0
  && effect.affected.placementIds.includes(input.placementId)
  && effect.tags.includes(AA079_MIMITREE_REARM_TAG)
  && effect.payload.action === 'grant'
  && effect.payload.capabilityId === 'aa079.mimitree.ignore-mimic-frequency'
))

export const AA079_MAGICIAN_ITEM_SET_ID = 'ability.magician.target-held' as const
export const AA079_MAGICIAN_TARGET_REQUIREMENT_ID = 'ability.magician.target-equipped' as const
export const AA079_MAGICIAN_ACTOR_REQUIREMENT_ID = 'ability.magician.actor-equipped' as const
export const AA079_MAGICIAN_DESTINATION_ID = 'ability.magician.actor-held' as const
export const AA079_MAGICIAN_REQUEST_PREFIX = 'ability.magician.request' as const

const MAGIC_GUARD_EXACT_REASONS = new Set([
  'ability.hay-fever.hit-point-loss',
  'ability.iron-barbs.attacker-hp-loss',
  'ability.rough-skin.attacker-hp-loss',
  'ability.liquid-ooze.leech-seed-reversal',
  'move.leech-seed.turn-start-loss',
  'vortex.turn-start-tick',
])

/** Reviewed non-attack HP-loss lanes blocked by Magic Guard. */
export const aa079MagicGuardBlocksReason = (reasonCode: string): boolean => (
  MAGIC_GUARD_EXACT_REASONS.has(reasonCode)
  || reasonCode.startsWith('zone.hazard.')
  || reasonCode.startsWith('weather.')
  || reasonCode.startsWith('status-affliction.')
  || reasonCode.startsWith('condition.residual.')
  || reasonCode.includes('.recoil')
  || reasonCode.includes('vortex')
  || reasonCode.includes('leech-seed')
)
