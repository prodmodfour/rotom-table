import type {
  MovementCapabilityKey,
  MovementCapabilitySpeeds,
  ShiftMovementCapabilityKey,
} from '~/types/movement'

export type { MovementCapabilityKey, MovementCapabilitySpeeds, ShiftMovementCapabilityKey }

export const SHIFT_MOVEMENT_CAPABILITY_KEYS: readonly ShiftMovementCapabilityKey[] = [
  'overland',
  'sky',
  'swim',
  'levitate',
  'burrow',
] as const

export const MOVEMENT_CAPABILITY_LABEL_BY_KEY: Record<MovementCapabilityKey, string> = {
  overland: 'Overland',
  sky: 'Sky',
  swim: 'Swim',
  levitate: 'Levitate',
  burrow: 'Burrow',
  teleporter: 'Teleporter',
}

export const MOVEMENT_CAPABILITY_KEY_BY_LABEL: Record<string, MovementCapabilityKey> = {
  overland: 'overland',
  sky: 'sky',
  swim: 'swim',
  levitate: 'levitate',
  burrow: 'burrow',
  teleporter: 'teleporter',
}

export const movementCapabilityLabel = (key: MovementCapabilityKey): string =>
  MOVEMENT_CAPABILITY_LABEL_BY_KEY[key]

export const normalizeMovementCapabilityLabel = (label: string): string =>
  label.trim().replace(/\s+/g, ' ').toLowerCase()

export const movementCapabilityKeyFromLabel = (label: string): MovementCapabilityKey | null =>
  MOVEMENT_CAPABILITY_KEY_BY_LABEL[normalizeMovementCapabilityLabel(label)] ?? null

export const normalizeMovementCapabilitySpeed = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.max(0, Math.trunc(parsed))
}

export const movementCapabilitySpeed = (
  capabilities: MovementCapabilitySpeeds | null | undefined,
  key: MovementCapabilityKey,
): number | undefined => normalizeMovementCapabilitySpeed(capabilities?.[key])

export const hasMovementCapability = (
  capabilities: MovementCapabilitySpeeds | null | undefined,
  key: MovementCapabilityKey,
): boolean => movementCapabilitySpeed(capabilities, key) != null

export const movementCapabilityLabels = (keys: readonly MovementCapabilityKey[]): string[] =>
  keys.map(movementCapabilityLabel)

/**
 * PTU Core Combat p.231: when a Shift uses multiple different Movement
 * Capabilities, average those Capability values and use that value as the
 * turn's maximum movement. Integer grid distances make fractional averages
 * effectively round down for legality.
 */
export const mixedMovementCapabilityLimit = (
  capabilities: MovementCapabilitySpeeds | null | undefined,
  keys: readonly MovementCapabilityKey[],
): number | null => {
  const uniqueKeys = Array.from(new Set(keys))
  if (!uniqueKeys.length) return 0

  const speeds = uniqueKeys.map((key) => movementCapabilitySpeed(capabilities, key))
  if (speeds.some((speed) => speed == null)) return null

  const total = (speeds as number[]).reduce((sum, speed) => sum + speed, 0)
  return Math.floor(total / uniqueKeys.length)
}

export const highestShiftMovementSpeed = (
  capabilities: MovementCapabilitySpeeds | null | undefined,
): number => SHIFT_MOVEMENT_CAPABILITY_KEYS.reduce((best, key) => {
  const speed = movementCapabilitySpeed(capabilities, key)
  return speed == null ? best : Math.max(best, speed)
}, 0)

export const bestAerialMovementCapability = (
  capabilities: MovementCapabilitySpeeds | null | undefined,
  heightMeters = 0,
): ShiftMovementCapabilityKey | null => {
  const sky = movementCapabilitySpeed(capabilities, 'sky')
  const levitate = movementCapabilitySpeed(capabilities, 'levitate')
  const levitateCanReach = levitate != null && heightMeters <= Math.floor(levitate / 2)

  if (sky == null && !levitateCanReach) return null
  if (sky != null && !levitateCanReach) return 'sky'
  if (sky == null && levitateCanReach) return 'levitate'

  return (sky ?? 0) >= (levitate ?? 0) ? 'sky' : 'levitate'
}
