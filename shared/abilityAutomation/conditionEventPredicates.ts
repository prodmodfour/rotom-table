import {
  ABILITY_CONDITION_OPERATIONS,
  ABILITY_CONDITION_OUTCOMES,
  type AbilityConditionOperation,
  type AbilityConditionOutcome,
} from './events'
import type { AbilitySpecJsonObject } from './spec'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_CONDITION_EVENT_PREDICATE_KIND = 'ability-condition-fact' as const
export const ABILITY_CONDITION_OWNER_ROLES = ['subject', 'actor', 'either', 'other'] as const
export const ABILITY_CONDITION_SOURCE_RELATIONS = ['any', 'owner', 'other', 'none'] as const
export const ABILITY_CONDITION_RESULT_FILTERS = ['any', 'present', 'absent'] as const
export const ABILITY_CONDITION_SAVE_FILTERS = ['any', 'required', 'forbidden'] as const

export interface AbilityConditionEventPredicate extends AbilitySpecJsonObject {
  readonly kind: typeof ABILITY_CONDITION_EVENT_PREDICATE_KIND
  readonly operations: readonly AbilityConditionOperation[]
  readonly outcomes: readonly AbilityConditionOutcome[]
  readonly conditionIds: readonly string[]
  readonly ownerRole: (typeof ABILITY_CONDITION_OWNER_ROLES)[number]
  readonly sourceRelation: (typeof ABILITY_CONDITION_SOURCE_RELATIONS)[number]
  readonly resultingState: (typeof ABILITY_CONDITION_RESULT_FILTERS)[number]
  readonly save: (typeof ABILITY_CONDITION_SAVE_FILTERS)[number]
}

export class AbilityConditionEventPredicateValidationError extends Error {
  constructor(readonly code: 'invalid-predicate' | 'not-json' | 'limit-exceeded', readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityConditionEventPredicateValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const FIELDS = ['kind', 'operations', 'outcomes', 'conditionIds', 'ownerRole', 'sourceRelation', 'resultingState', 'save'] as const
const ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const fail = (code: AbilityConditionEventPredicateValidationError['code'], path: string, detail: string): never => {
  throw new AbilityConditionEventPredicateValidationError(code, path, detail)
}
const ordered = <Value extends string>(value: unknown, path: string, supported: readonly Value[]): readonly Value[] => {
  if (!Array.isArray(value) || value.length > supported.length) fail('limit-exceeded', path, 'must be bounded.')
  const parsed = (value as readonly unknown[]).map((entry, index) => {
    const order = supported.indexOf(entry as Value)
    if (order < 0) fail('invalid-predicate', `${path}[${index}]`, 'is unsupported.')
    return { value: entry as Value, order }
  })
  if (new Set(parsed.map(entry => entry.value)).size !== parsed.length
    || parsed.some((entry, index) => index > 0 && entry.order <= parsed[index - 1]!.order)) {
    fail('invalid-predicate', path, 'must contain unique canonical-order values.')
  }
  return Object.freeze(parsed.map(entry => entry.value))
}
const oneOf = <Value extends string>(value: unknown, path: string, supported: readonly Value[]): Value => (
  supported.includes(value as Value) ? value as Value : fail('invalid-predicate', path, 'is unsupported.')
)

export const parseAbilityConditionEventPredicate = (
  value: unknown,
  path = 'abilityConditionEventPredicate',
): AbilityConditionEventPredicate => {
  const cloned = cloneStrictJson(value, path, {
    limits: { depth: 4, nodes: 256, objectFields: 12, arrayEntries: 64, stringLength: 160, objectKeyLength: 160 },
    rootLabel: 'ability condition-event predicate', valueLabel: 'ability condition-event predicates',
    failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
    failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
  })
  if (!isPlainJsonObject(cloned)) fail('invalid-predicate', path, 'must be an object.')
  const input = cloned as UnknownRecord
  const expected = new Set<string>(FIELDS)
  if (FIELDS.some(field => !Object.prototype.hasOwnProperty.call(input, field))
    || Object.keys(input).some(field => !expected.has(field))
    || input.kind !== ABILITY_CONDITION_EVENT_PREDICATE_KIND) fail('invalid-predicate', path, 'has invalid shape.')
  if (!Array.isArray(input.conditionIds) || input.conditionIds.length > 64) {
    fail('limit-exceeded', `${path}.conditionIds`, 'must be bounded.')
  }
  const conditionIds = (input.conditionIds as readonly unknown[]).map((entry, index) => {
    if (typeof entry !== 'string' || !ID_PATTERN.test(entry)) {
      fail('invalid-predicate', `${path}.conditionIds[${index}]`, 'must be a stable ID.')
    }
    return entry as string
  })
  if (new Set(conditionIds).size !== conditionIds.length
    || conditionIds.some((id, index) => index > 0 && id <= conditionIds[index - 1]!)) {
    fail('invalid-predicate', `${path}.conditionIds`, 'must use unique code-point order.')
  }
  const parsed = {
    kind: ABILITY_CONDITION_EVENT_PREDICATE_KIND,
    operations: ordered(input.operations, `${path}.operations`, ABILITY_CONDITION_OPERATIONS),
    outcomes: ordered(input.outcomes, `${path}.outcomes`, ABILITY_CONDITION_OUTCOMES),
    conditionIds: Object.freeze(conditionIds),
    ownerRole: oneOf(input.ownerRole, `${path}.ownerRole`, ABILITY_CONDITION_OWNER_ROLES),
    sourceRelation: oneOf(input.sourceRelation, `${path}.sourceRelation`, ABILITY_CONDITION_SOURCE_RELATIONS),
    resultingState: oneOf(input.resultingState, `${path}.resultingState`, ABILITY_CONDITION_RESULT_FILTERS),
    save: oneOf(input.save, `${path}.save`, ABILITY_CONDITION_SAVE_FILTERS),
  }
  if (parsed.operations.length === 0 && parsed.outcomes.length === 0 && conditionIds.length === 0
    && parsed.ownerRole === 'either' && parsed.sourceRelation === 'any'
    && parsed.resultingState === 'any' && parsed.save === 'any') {
    fail('invalid-predicate', path, 'must constrain at least one condition fact.')
  }
  return deepFreezeStrictJson(parsed) as AbilityConditionEventPredicate
}
