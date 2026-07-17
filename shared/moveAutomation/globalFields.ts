/** Canonical mechanics constants for the remaining battlefield-wide fields. */
import type { EncounterNumericModifierEffect } from './encounterEffects'

export const MOVE_AUTOMATION_ITEM_EFFECT_SCOPES = [
  'pokemon-held',
  'trainer-accessory',
  'trainer-other-equipment',
] as const

export const MOVE_AUTOMATION_ITEM_EFFECT_TIMINGS = [
  'static',
  'trigger',
  'activated',
  'consumable',
] as const

export type MoveAutomationItemEffectScope =
  (typeof MOVE_AUTOMATION_ITEM_EFFECT_SCOPES)[number]
export type MoveAutomationItemEffectTiming =
  (typeof MOVE_AUTOMATION_ITEM_EFFECT_TIMINGS)[number]

/** Magic Room suppresses benefits only from passive and triggered equipment effects. */
export const MAGIC_ROOM_SUPPRESSED_ITEM_EFFECT_TIMINGS = [
  'static',
  'trigger',
] as const satisfies readonly MoveAutomationItemEffectTiming[]

export const magicRoomSuppressesItemEffectTiming = (
  timing: MoveAutomationItemEffectTiming,
): boolean => (MAGIC_ROOM_SUPPRESSED_ITEM_EFFECT_TIMINGS as readonly string[]).includes(timing)

/** PTU Gravity applies this flat modifier to every Accuracy Roll. */
export const GRAVITY_ACCURACY_ROLL_BONUS = 2 as const

/** Sky/Levitate may end a Shift no higher than this while Gravity is active. */
export const GRAVITY_MAX_AERIAL_END_ALTITUDE_METERS = 1 as const

/** Tailwind is one non-stacking, side-owned scene modifier. */
export const TAILWIND_INITIATIVE_BONUS = 5 as const
export const TAILWIND_EFFECT_TAG = 'field.tailwind' as const
export const TAILWIND_EFFECT_ID_PREFIX = 'effect.field.tailwind.' as const

/** Recognize only the exact canonical Tailwind shape used for non-stacking queries. */
export const isTailwindInitiativeEffect = (
  effect: EncounterNumericModifierEffect,
): boolean => (
  effect.id.startsWith(TAILWIND_EFFECT_ID_PREFIX)
  && effect.tags.includes(TAILWIND_EFFECT_TAG)
  && effect.duration.kind === 'scene'
  && effect.affected.placementIds.length === 0
  && effect.affected.sideIds.length === 1
  && effect.affected.cells.length === 0
  && effect.stacks === 1
  && effect.stackPolicy.kind === 'refresh'
  && effect.payload.attribute === 'initiative'
  && effect.payload.operation === 'add'
  && effect.payload.value === TAILWIND_INITIATIVE_BONUS
  && effect.payload.rounding === 'none'
)
