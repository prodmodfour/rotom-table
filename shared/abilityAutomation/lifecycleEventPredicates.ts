import {
  ABILITY_LIFECYCLE_BOUNDARIES,
  ABILITY_LIFECYCLE_TRANSITIONS,
  type AbilityLifecycleBoundary,
  type AbilityLifecycleTransition,
} from './events'
import type { AbilitySpecJsonObject } from './spec'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_LIFECYCLE_EVENT_PREDICATE_KIND = 'ability-lifecycle-fact' as const
export const ABILITY_LIFECYCLE_SUBJECT_RELATIONS = ['any', 'owner', 'other', 'global'] as const

export interface AbilityLifecycleEventPredicate extends AbilitySpecJsonObject {
  readonly kind: typeof ABILITY_LIFECYCLE_EVENT_PREDICATE_KIND
  readonly boundaries: readonly AbilityLifecycleBoundary[]
  readonly transitions: readonly AbilityLifecycleTransition[]
  readonly subjectRelation: (typeof ABILITY_LIFECYCLE_SUBJECT_RELATIONS)[number]
  readonly minimumOrdinal: number | null
}

export class AbilityLifecycleEventPredicateValidationError extends Error {
  constructor(readonly code: 'invalid-predicate' | 'not-json' | 'limit-exceeded', readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityLifecycleEventPredicateValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const FIELDS = ['kind', 'boundaries', 'transitions', 'subjectRelation', 'minimumOrdinal'] as const
const fail = (code: AbilityLifecycleEventPredicateValidationError['code'], path: string, detail: string): never => {
  throw new AbilityLifecycleEventPredicateValidationError(code, path, detail)
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
    fail('invalid-predicate', path, 'must use unique canonical order.')
  }
  return Object.freeze(parsed.map(entry => entry.value))
}

export const parseAbilityLifecycleEventPredicate = (
  value: unknown,
  path = 'abilityLifecycleEventPredicate',
): AbilityLifecycleEventPredicate => {
  const cloned = cloneStrictJson(value, path, {
    limits: { depth: 4, nodes: 192, objectFields: 8, arrayEntries: 16, stringLength: 160, objectKeyLength: 160 },
    rootLabel: 'ability lifecycle-event predicate', valueLabel: 'ability lifecycle-event predicates',
    failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
    failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
  })
  if (!isPlainJsonObject(cloned)) fail('invalid-predicate', path, 'must be an object.')
  const input = cloned as UnknownRecord
  const expected = new Set<string>(FIELDS)
  if (FIELDS.some(field => !Object.prototype.hasOwnProperty.call(input, field))
    || Object.keys(input).some(field => !expected.has(field))
    || input.kind !== ABILITY_LIFECYCLE_EVENT_PREDICATE_KIND) fail('invalid-predicate', path, 'has invalid shape.')
  if (!ABILITY_LIFECYCLE_SUBJECT_RELATIONS.includes(input.subjectRelation as never)) {
    fail('invalid-predicate', `${path}.subjectRelation`, 'is unsupported.')
  }
  const minimumOrdinal = input.minimumOrdinal === null
    ? null
    : Number.isSafeInteger(input.minimumOrdinal) && Number(input.minimumOrdinal) >= 0
      && Number(input.minimumOrdinal) <= 10_000_000
      ? Number(input.minimumOrdinal)
      : fail('invalid-predicate', `${path}.minimumOrdinal`, 'is out of bounds.')
  const parsed = {
    kind: ABILITY_LIFECYCLE_EVENT_PREDICATE_KIND,
    boundaries: ordered(input.boundaries, `${path}.boundaries`, ABILITY_LIFECYCLE_BOUNDARIES),
    transitions: ordered(input.transitions, `${path}.transitions`, ABILITY_LIFECYCLE_TRANSITIONS),
    subjectRelation: input.subjectRelation as (typeof ABILITY_LIFECYCLE_SUBJECT_RELATIONS)[number],
    minimumOrdinal,
  }
  if (parsed.boundaries.length === 0 && parsed.transitions.length === 0
    && parsed.subjectRelation === 'any' && minimumOrdinal === null) {
    fail('invalid-predicate', path, 'must constrain at least one lifecycle fact.')
  }
  return deepFreezeStrictJson(parsed) as AbilityLifecycleEventPredicate
}
