import { conditionBaseName } from '~/utils/statusConditions'
import {
  MOVE_VFX_TONE,
  moveVfxColorForTone,
  moveVfxColorForType,
  type MoveVfxPaletteEntry,
} from '~/utils/moveAnimationPalette'

/**
 * Generic status-cloud colour hints. These are not condition-specific art or
 * gameplay rules; they only let the reusable status primitive choose a readable
 * hue when a planner/event already knows which condition family was applied.
 */
const STATUS_CONDITION_TYPE_HINTS = new Map<string, string>([
  ['Burned', 'Fire'],
  ['Poisoned', 'Poison'],
  ['Badly Poisoned', 'Poison'],
  ['Paralysis', 'Electric'],
  ['Frozen', 'Ice'],
  ['Sleep', 'Psychic'],
  ['Confused', 'Psychic'],
  ['Cursed', 'Ghost'],
  ['Infatuation', 'Fairy'],
  ['Rage', 'Fighting'],
  ['Flinch', 'Fighting'],
  ['Blindness', 'Dark'],
  ['Total Blindness', 'Dark'],
  ['Suppressed', 'Dark'],
  ['Slowed', 'Ice'],
  ['Stuck', 'Ground'],
  ['Trapped', 'Ground'],
])

const STATUS_CONDITION_HINT_PRIORITY = [
  'Burned',
  'Poisoned',
  'Badly Poisoned',
  'Paralysis',
  'Frozen',
  'Sleep',
  'Confused',
  'Cursed',
  'Infatuation',
  'Rage',
  'Flinch',
  'Blindness',
  'Total Blindness',
  'Suppressed',
  'Slowed',
  'Stuck',
  'Trapped',
] as const

const nonEmptyConditionName = (condition: unknown): string | null => {
  if (typeof condition !== 'string') return null
  const canonical = conditionBaseName(condition)
  if (canonical) return canonical
  const trimmed = condition.trim()
  return trimmed ? trimmed : null
}

const conditionTypeHint = (condition: unknown): string | null => {
  const name = nonEmptyConditionName(condition)
  return name ? STATUS_CONDITION_TYPE_HINTS.get(name) ?? null : null
}

/** Returns a VFX palette hint for a single known condition, or null when generic status styling should be used. */
export const moveVfxStatusPaletteForCondition = (condition: unknown): MoveVfxPaletteEntry | null => {
  const typeHint = conditionTypeHint(condition)
  return typeHint ? moveVfxColorForType(typeHint) : null
}

const statusConditionsOrEmpty = (
  conditionNames: readonly unknown[] | null | undefined,
): readonly string[] => (
  Array.isArray(conditionNames)
    ? conditionNames.map(nonEmptyConditionName).filter((name): name is string => Boolean(name))
    : []
)

/**
 * Chooses one compact palette for a combined status-cloud event.
 *
 * Explicit non-status palettes win so future overrides/debug events can force a
 * hue. Otherwise the first recognized condition in the stable priority table is
 * used, with unknown/custom conditions falling back to generic status purple.
 */
export const moveVfxStatusPaletteForConditions = (
  conditionNames: readonly unknown[] | null | undefined,
  explicitPalette?: MoveVfxPaletteEntry,
): MoveVfxPaletteEntry => {
  if (explicitPalette && explicitPalette.key !== MOVE_VFX_TONE.status) return explicitPalette

  const conditions = new Set(statusConditionsOrEmpty(conditionNames))
  const prioritizedCondition = STATUS_CONDITION_HINT_PRIORITY.find((condition) => conditions.has(condition))
  const conditionPalette = prioritizedCondition
    ? moveVfxStatusPaletteForCondition(prioritizedCondition)
    : null

  return conditionPalette ?? explicitPalette ?? moveVfxColorForTone(MOVE_VFX_TONE.status)
}
