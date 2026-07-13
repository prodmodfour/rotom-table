import {
  ENCOUNTER_ACTION_TYPES,
  ENCOUNTER_RESOURCE_LIMITS,
  type EncounterActionType,
} from './encounterResources'

/**
 * Reviewed, JSON-only action-economy declarations for MoveSpec v2.
 *
 * These values describe mechanics only. The browser never supplies them and
 * the server reducer, rather than the interpreter, owns authoritative state.
 */
export const MOVE_RESOURCE_COST_KINDS = [
  'action-resource',
  'movement-distance',
  'once-per-turn',
  'exhaust',
  'setup-execute',
  'priority',
  'no-cost',
] as const

export const MOVE_PRIORITY_COST_MODES = [
  'standard',
  'limited',
  'advanced',
] as const

export const MOVE_SETUP_EXECUTE_COST_STEPS = [
  'set-up',
  'execute',
] as const

export const MOVE_RESOURCE_COST_LIMITS = Object.freeze({
  identifierChars: ENCOUNTER_RESOURCE_LIMITS.identifierChars,
  amount: ENCOUNTER_RESOURCE_LIMITS.amount,
})

export type MoveResourceCostKind = (typeof MOVE_RESOURCE_COST_KINDS)[number]
export type MovePriorityCostMode = (typeof MOVE_PRIORITY_COST_MODES)[number]
export type MoveSetupExecuteCostStep = (typeof MOVE_SETUP_EXECUTE_COST_STEPS)[number]

export interface MoveActionResourceCost {
  readonly kind: 'action-resource'
  readonly resource: EncounterActionType
  readonly amount: number
}

export interface MoveMovementDistanceCost {
  readonly kind: 'movement-distance'
  /** Resolved distance always comes from the authoritative movement oracle. */
  readonly amount: 'resolved-distance' | number
}

export interface MoveOncePerTurnCost {
  readonly kind: 'once-per-turn'
  readonly flagId: string
}

export interface MoveExhaustCost {
  readonly kind: 'exhaust'
  readonly timing: 'next-turn'
  /** PTU Exhaust also forfeits the linked Trainer command. */
  readonly forfeitCommand: boolean
}

export interface MoveSetupExecuteCost {
  readonly kind: 'setup-execute'
  readonly step: MoveSetupExecuteCostStep
}

export interface MovePriorityCost {
  readonly kind: 'priority'
  readonly mode: MovePriorityCostMode
}

export interface MoveNoCost {
  readonly kind: 'no-cost'
  /** Reviewed explanation for an action/resource exception. */
  readonly reasonCode: string
}

export type MoveResourceCost =
  | MoveActionResourceCost
  | MoveMovementDistanceCost
  | MoveOncePerTurnCost
  | MoveExhaustCost
  | MoveSetupExecuteCost
  | MovePriorityCost
  | MoveNoCost

export type MoveResourceCostValidationCode =
  | 'invalid-resource-cost'
  | 'limit-exceeded'
  | 'unknown-resource-cost'

export class MoveResourceCostValidationError extends Error {
  readonly code: MoveResourceCostValidationCode
  readonly path: string

  constructor(
    code: MoveResourceCostValidationCode,
    path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'MoveResourceCostValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>

const ACTION_FIELDS = ['kind', 'resource', 'amount'] as const
const MOVEMENT_FIELDS = ['kind', 'amount'] as const
const ONCE_PER_TURN_FIELDS = ['kind', 'flagId'] as const
const EXHAUST_FIELDS = ['kind', 'timing', 'forfeitCommand'] as const
const SETUP_EXECUTE_FIELDS = ['kind', 'step'] as const
const PRIORITY_FIELDS = ['kind', 'mode'] as const
const NO_COST_FIELDS = ['kind', 'reasonCode'] as const

const COST_KIND_SET = new Set<string>(MOVE_RESOURCE_COST_KINDS)
const ACTION_TYPE_SET = new Set<string>(ENCOUNTER_ACTION_TYPES)
const PRIORITY_MODE_SET = new Set<string>(MOVE_PRIORITY_COST_MODES)
const SETUP_STEP_SET = new Set<string>(MOVE_SETUP_EXECUTE_COST_STEPS)
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

const fail = (
  code: MoveResourceCostValidationCode,
  path: string,
  message: string,
): never => {
  throw new MoveResourceCostValidationError(code, path, message)
}

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const parseRecord = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainRecord(value)) {
    return fail('invalid-resource-cost', path, 'must be a plain object.')
  }
  return value
}

const assertExactFields = (
  value: UnknownRecord,
  fields: readonly string[],
  path: string,
): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length === 0 && unknown.length === 0) return
  fail(
    'invalid-resource-cost',
    path,
    `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`,
  )
}

const parseStableId = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MOVE_RESOURCE_COST_LIMITS.identifierChars
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
    || !STABLE_ID_PATTERN.test(value)
  ) {
    return fail(
      'invalid-resource-cost',
      path,
      'must be a lowercase bounded stable identifier.',
    )
  }
  return value
}

const parseAmount = (value: unknown, path: string): number => {
  if (
    !Number.isSafeInteger(value)
    || Number(value) < 1
    || Number(value) > MOVE_RESOURCE_COST_LIMITS.amount
  ) {
    return fail(
      'limit-exceeded',
      path,
      `must be a safe integer from 1 through ${MOVE_RESOURCE_COST_LIMITS.amount}.`,
    )
  }
  return Number(value)
}

/** Parse one exact bounded MoveSpec action/resource cost. */
export const parseMoveResourceCost = (
  value: unknown,
  path = 'moveResourceCost',
): MoveResourceCost => {
  const cost = parseRecord(value, path)
  const kind = cost.kind
  if (typeof kind !== 'string' || !COST_KIND_SET.has(kind)) {
    return fail(
      'unknown-resource-cost',
      `${path}.kind`,
      'must be a supported move resource cost kind.',
    )
  }

  if (kind === 'action-resource') {
    assertExactFields(cost, ACTION_FIELDS, path)
    if (typeof cost.resource !== 'string' || !ACTION_TYPE_SET.has(cost.resource)) {
      fail(
        'invalid-resource-cost',
        `${path}.resource`,
        'must be Standard, Shift, Swift, Free, Full, Interrupt, or Reaction.',
      )
    }
    return {
      kind,
      resource: cost.resource as EncounterActionType,
      amount: parseAmount(cost.amount, `${path}.amount`),
    }
  }

  if (kind === 'movement-distance') {
    assertExactFields(cost, MOVEMENT_FIELDS, path)
    return {
      kind,
      amount: cost.amount === 'resolved-distance'
        ? cost.amount
        : parseAmount(cost.amount, `${path}.amount`),
    }
  }

  if (kind === 'once-per-turn') {
    assertExactFields(cost, ONCE_PER_TURN_FIELDS, path)
    return {
      kind,
      flagId: parseStableId(cost.flagId, `${path}.flagId`),
    }
  }

  if (kind === 'exhaust') {
    assertExactFields(cost, EXHAUST_FIELDS, path)
    if (cost.timing !== 'next-turn') {
      fail('invalid-resource-cost', `${path}.timing`, 'must be next-turn.')
    }
    if (typeof cost.forfeitCommand !== 'boolean') {
      fail('invalid-resource-cost', `${path}.forfeitCommand`, 'must be boolean.')
    }
    return { kind, timing: 'next-turn', forfeitCommand: cost.forfeitCommand as boolean }
  }

  if (kind === 'setup-execute') {
    assertExactFields(cost, SETUP_EXECUTE_FIELDS, path)
    if (typeof cost.step !== 'string' || !SETUP_STEP_SET.has(cost.step)) {
      fail('invalid-resource-cost', `${path}.step`, 'must be set-up or execute.')
    }
    return { kind, step: cost.step as MoveSetupExecuteCostStep }
  }

  if (kind === 'priority') {
    assertExactFields(cost, PRIORITY_FIELDS, path)
    if (typeof cost.mode !== 'string' || !PRIORITY_MODE_SET.has(cost.mode)) {
      fail('invalid-resource-cost', `${path}.mode`, 'must be standard, limited, or advanced.')
    }
    return { kind, mode: cost.mode as MovePriorityCostMode }
  }

  assertExactFields(cost, NO_COST_FIELDS, path)
  return {
    kind: 'no-cost',
    reasonCode: parseStableId(cost.reasonCode, `${path}.reasonCode`),
  }
}
