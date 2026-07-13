import { createHash } from 'node:crypto'
import { ENCOUNTER_EFFECT_LIMITS } from '#shared/moveAutomation/encounterEffects'

export const MOVE_SEMI_INVULNERABLE_EFFECT_TAG = 'semi-invulnerable' as const
export const MOVE_SEMI_INVULNERABLE_CAPABILITY_PREFIX = 'movement.semi-invulnerable.' as const
export const MOVE_SEMI_INVULNERABLE_FAMILY_TAG_PREFIX = 'semi-family.' as const
export const MOVE_SEMI_INVULNERABLE_ROLE_TAG_PREFIX = 'semi-role.' as const

export const MOVE_SEMI_INVULNERABLE_LIMITS = Object.freeze({
  effectsPerSetup: 2,
  identifierChars: ENCOUNTER_EFFECT_LIMITS.identifierChars,
})

export type MoveSemiInvulnerableSetupErrorCode =
  | 'invalid-authority'
  | 'invalid-setup'
  | 'placement-not-found'
  | 'setup-conflict'
  | 'effect-limit-exceeded'
  | 'invalid-setup-effect'
  | 'incomplete-setup-group'
  | 'duplicate-setup-group'
  | 'setup-group-not-found'
  | 'invalid-cleanup'

export class MoveSemiInvulnerableSetupError extends Error {
  readonly code: MoveSemiInvulnerableSetupErrorCode

  constructor(code: MoveSemiInvulnerableSetupErrorCode, message: string) {
    super(message)
    this.name = 'MoveSemiInvulnerableSetupError'
    this.code = code
  }
}

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/

export const failMoveSemiInvulnerableSetup = (
  code: MoveSemiInvulnerableSetupErrorCode,
  message: string,
): never => {
  throw new MoveSemiInvulnerableSetupError(code, message)
}

export const deepFreezeMoveSemiInvulnerable = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreezeMoveSemiInvulnerable((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

export const assertMoveSemiInvulnerableStableId = (
  value: unknown,
  label: string,
): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MOVE_SEMI_INVULNERABLE_LIMITS.identifierChars
    || !STABLE_ID_PATTERN.test(value)
  ) {
    return failMoveSemiInvulnerableSetup(
      'invalid-setup',
      `${label} must be a bounded lowercase stable ID.`,
    )
  }
  return value
}

export const assertMoveSemiInvulnerableCanonicalText = (
  value: unknown,
  label: string,
): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MOVE_SEMI_INVULNERABLE_LIMITS.identifierChars
    || value.trim() !== value
  ) {
    return failMoveSemiInvulnerableSetup(
      'invalid-setup',
      `${label} must be bounded non-empty canonical text.`,
    )
  }
  return value
}

export const deriveMoveSemiInvulnerableId = (
  prefix: string,
  ...parts: readonly string[]
): string => {
  const digest = createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32)
  return `${prefix}.${digest}`
}
