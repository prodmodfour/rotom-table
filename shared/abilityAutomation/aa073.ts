import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'

export const AA073_GULP_MISSILE_CAPABILITY = 'aa073.gulp-missile.armed' as const
export const AA073_GULP_MISSILE_TRIGGER_MOVES = Object.freeze([
  'Stockpile', 'Surf', 'Dive',
] as const)
export const AA073_GUTS_CONDITIONS = Object.freeze([
  'Burned', 'Poisoned', 'Badly Poisoned', 'Paralysis', 'Frozen', 'Sleep', 'Bad Sleep',
] as const)
export const AA073_HAY_FEVER_IMMUNE_TYPES = Object.freeze([
  'bug', 'grass', 'poison',
] as const)
export const AA073_HARVEST_TRADE_CAPABILITY = 'aa073.harvest.berry-traded-this-turn' as const
export const AA073_HARVEST_TAILS_CAPABILITY = 'aa073.harvest.tails-this-scene' as const

export const aa073ActiveEncounterEffect = (effect: EncounterEffect): boolean => (
  effect.suppression.sources.length === 0
  && (effect.duration.remaining === null || effect.duration.remaining > 0)
)
