import {
  MOVE_EFFECT_OPERATION_KINDS,
  MoveEffectOperationValidationError,
  parseMoveEffectOperation,
  type MoveEffectOperation,
  type MoveEffectOperationKind,
  type MoveEffectSourceReference,
} from '../moveAutomation/effects'
import type { MoveSpecPhase } from '../moveAutomation/spec'
import type {
  AbilitySpecJsonObject,
  AbilitySpecPhase,
} from './spec'
import { isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_SHARED_EFFECT_NODE_KIND = 'shared-effect' as const

export const ABILITY_SHARED_EFFECT_SOURCE_KINDS = [
  'ability',
  'operation',
  'encounter-effect',
  'lifecycle-event',
] as const
export type AbilitySharedEffectSourceKind =
  (typeof ABILITY_SHARED_EFFECT_SOURCE_KINDS)[number]

export const ABILITY_SHARED_EFFECT_OPERATION_KINDS = MOVE_EFFECT_OPERATION_KINDS.filter(kind => (
  kind !== 'usage' && kind !== 'history'
))

export interface AbilitySharedEffectSourceReference {
  readonly kind: AbilitySharedEffectSourceKind
  readonly id: string
}

export type AbilitySharedKernelOperation = Omit<MoveEffectOperation, 'phase' | 'source'> & {
  readonly source: AbilitySharedEffectSourceReference
}

export interface AbilitySharedEffectNode {
  readonly kind: typeof ABILITY_SHARED_EFFECT_NODE_KIND
  readonly operation: AbilitySharedKernelOperation
}

export type AbilitySharedEffectValidationCode =
  | 'invalid-shared-effect'
  | 'unsupported-operation'
  | 'phase-required'

export class AbilitySharedEffectValidationError extends Error {
  readonly code: AbilitySharedEffectValidationCode
  readonly path: string

  constructor(code: AbilitySharedEffectValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilitySharedEffectValidationError'
    this.code = code
    this.path = path
  }
}

const NODE_FIELDS = ['kind', 'operation'] as const
const OPERATION_FIELDS = ['id', 'kind', 'source', 'recipients', 'reasonCode', 'payload'] as const
const SOURCE_FIELDS = ['kind', 'id'] as const
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SOURCE_KIND_SET = new Set<string>(ABILITY_SHARED_EFFECT_SOURCE_KINDS)
const OPERATION_KIND_SET = new Set<string>(ABILITY_SHARED_EFFECT_OPERATION_KINDS)

const fail = (
  code: AbilitySharedEffectValidationCode,
  path: string,
  detail: string,
): never => {
  throw new AbilitySharedEffectValidationError(code, path, detail)
}

const exact = (value: Record<string, unknown>, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length || unknown.length) {
    fail('invalid-shared-effect', path, 'must contain exactly the supported fields.')
  }
}

const stableId = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length > 160 || !STABLE_ID_PATTERN.test(value)) {
    return fail('invalid-shared-effect', path, 'must be a bounded stable identifier.')
  }
  return value
}

/** Internal parser phase mapping only; parsed output retains the ability phase outside this node. */
export const sharedKernelMovePhaseForAbilityPhase = (
  phase: AbilitySpecPhase,
): MoveSpecPhase => {
  switch (phase) {
    case 'eligibility': return 'precondition'
    case 'reserve':
    case 'pay': return 'pay'
    case 'target': return 'target'
    case 'pre-effect': return 'pre-hit'
    case 'effect': return 'hit'
    case 'after-effect': return 'after-damage'
    case 'schedule': return 'schedule'
    case 'cleanup': return 'cleanup'
  }
}

/**
 * Parse an ability-native wrapper through the reusable Move effect grammar.
 * The temporary parser source/phase never escape; authority and traces retain
 * the original ability source and enclosing AbilitySpec phase.
 */
export const parseAbilitySharedEffectNode = (
  value: AbilitySpecJsonObject,
  path: string,
  phase: AbilitySpecPhase | null,
): AbilitySpecJsonObject => {
  if (phase === null) return fail('phase-required', path, 'requires an enclosing AbilitySpec phase.')
  if (!isPlainJsonObject(value)) return fail('invalid-shared-effect', path, 'must be an object.')
  exact(value, NODE_FIELDS, path)
  if (value.kind !== ABILITY_SHARED_EFFECT_NODE_KIND) {
    fail('invalid-shared-effect', `${path}.kind`, `must be ${ABILITY_SHARED_EFFECT_NODE_KIND}.`)
  }
  const operation = value.operation
  if (!isPlainJsonObject(operation)) {
    return fail('invalid-shared-effect', `${path}.operation`, 'must be an object.')
  }
  exact(operation, OPERATION_FIELDS, `${path}.operation`)
  if (typeof operation.kind !== 'string' || !OPERATION_KIND_SET.has(operation.kind)) {
    fail('unsupported-operation', `${path}.operation.kind`, 'is not reusable for abilities.')
  }
  const source = operation.source
  if (!isPlainJsonObject(source)) {
    return fail('invalid-shared-effect', `${path}.operation.source`, 'must be an object.')
  }
  exact(source, SOURCE_FIELDS, `${path}.operation.source`)
  if (typeof source.kind !== 'string' || !SOURCE_KIND_SET.has(source.kind)) {
    fail('invalid-shared-effect', `${path}.operation.source.kind`, 'is not an ability effect source.')
  }
  const sourceId = stableId(source.id, `${path}.operation.source.id`)
  const abilitySource: AbilitySharedEffectSourceReference = {
    kind: source.kind as AbilitySharedEffectSourceKind,
    id: sourceId,
  }
  const parserSource: MoveEffectSourceReference = abilitySource.kind === 'ability'
    ? { kind: 'move', id: sourceId }
    : abilitySource as MoveEffectSourceReference

  let parsed: MoveEffectOperation
  try {
    parsed = parseMoveEffectOperation({
      ...operation,
      phase: sharedKernelMovePhaseForAbilityPhase(phase),
      source: parserSource,
    }, `${path}.operation`)
  }
  catch (error) {
    if (error instanceof MoveEffectOperationValidationError) {
      return fail('invalid-shared-effect', error.path, 'does not satisfy the shared effect grammar.')
    }
    throw error
  }

  const { phase: _parserPhase, source: _parserSource, ...shared } = parsed
  const output: AbilitySharedEffectNode = {
    kind: ABILITY_SHARED_EFFECT_NODE_KIND,
    operation: {
      ...shared,
      source: abilitySource,
    } as AbilitySharedKernelOperation,
  }
  return output as unknown as AbilitySpecJsonObject
}

export const isAbilitySharedEffectNode = (
  value: AbilitySpecJsonObject,
): value is AbilitySpecJsonObject & AbilitySharedEffectNode => value.kind === ABILITY_SHARED_EFFECT_NODE_KIND

export const abilitySharedEffectOperationKind = (
  node: AbilitySharedEffectNode,
): MoveEffectOperationKind => node.operation.kind
