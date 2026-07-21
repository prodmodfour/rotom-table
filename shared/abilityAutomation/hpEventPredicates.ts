import {
  ABILITY_FAINT_TRANSITIONS,
  ABILITY_HP_CHANGE_KINDS,
  type AbilityFaintTransition,
  type AbilityHpChangeKind,
} from './events'
import type { AbilitySpecJsonObject } from './spec'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_HP_EVENT_PREDICATE_KIND = 'ability-hp-fact' as const
export const ABILITY_HP_OWNER_ROLES = ['subject', 'actor', 'either', 'other'] as const
export const ABILITY_HP_BOOLEAN_FILTERS = ['any', 'required', 'forbidden'] as const
export const ABILITY_HP_INJURY_FILTERS = ['any', 'increased', 'decreased', 'unchanged'] as const
export const ABILITY_HP_TEMPORARY_FILTERS = ['any', 'gained', 'lost', 'unchanged'] as const
export const ABILITY_HP_THRESHOLD_FILTERS = [
  'any', 'zero', 'below-third', 'below-half', 'at-or-above-half',
] as const

export interface AbilityHpEventPredicate extends AbilitySpecJsonObject {
  readonly kind: typeof ABILITY_HP_EVENT_PREDICATE_KIND
  readonly changeKinds: readonly AbilityHpChangeKind[]
  readonly faintTransitions: readonly AbilityFaintTransition[]
  readonly ownerRole: (typeof ABILITY_HP_OWNER_ROLES)[number]
  readonly massiveDamage: (typeof ABILITY_HP_BOOLEAN_FILTERS)[number]
  readonly crossedZero: (typeof ABILITY_HP_BOOLEAN_FILTERS)[number]
  readonly injuryChange: (typeof ABILITY_HP_INJURY_FILTERS)[number]
  readonly temporaryChange: (typeof ABILITY_HP_TEMPORARY_FILTERS)[number]
  readonly hpThreshold: (typeof ABILITY_HP_THRESHOLD_FILTERS)[number]
  readonly minimumAppliedAmount: number | null
}

export class AbilityHpEventPredicateValidationError extends Error {
  readonly code: 'invalid-predicate' | 'not-json' | 'limit-exceeded'
  readonly path: string

  constructor(code: 'invalid-predicate' | 'not-json' | 'limit-exceeded', path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityHpEventPredicateValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const FIELDS = [
  'kind', 'changeKinds', 'faintTransitions', 'ownerRole', 'massiveDamage', 'crossedZero',
  'injuryChange', 'temporaryChange', 'hpThreshold', 'minimumAppliedAmount',
] as const

const fail = (
  code: 'invalid-predicate' | 'not-json' | 'limit-exceeded',
  path: string,
  detail: string,
): never => { throw new AbilityHpEventPredicateValidationError(code, path, detail) }

const ordered = <Value extends string>(
  value: unknown,
  path: string,
  supported: readonly Value[],
): readonly Value[] => {
  if (!Array.isArray(value) || value.length > supported.length) fail('limit-exceeded', path, 'must be bounded.')
  const result = (value as readonly unknown[]).map((entry, index) => {
    const order = supported.indexOf(entry as Value)
    if (order < 0) fail('invalid-predicate', `${path}[${index}]`, 'is unsupported.')
    return { value: entry as Value, order }
  })
  if (new Set(result.map(entry => entry.value)).size !== result.length
    || result.some((entry, index) => index > 0 && entry.order <= result[index - 1]!.order)) {
    fail('invalid-predicate', path, 'must contain unique canonical-order values.')
  }
  return Object.freeze(result.map(entry => entry.value))
}

const oneOf = <Value extends string>(value: unknown, path: string, supported: readonly Value[]): Value => (
  supported.includes(value as Value)
    ? value as Value
    : fail('invalid-predicate', path, 'is unsupported.')
)

export const parseAbilityHpEventPredicate = (
  value: unknown,
  path = 'abilityHpEventPredicate',
): AbilityHpEventPredicate => {
  const cloned = cloneStrictJson(value, path, {
    limits: { depth: 4, nodes: 256, objectFields: 16, arrayEntries: 32, stringLength: 160, objectKeyLength: 160 },
    rootLabel: 'ability HP-event predicate',
    valueLabel: 'ability HP-event predicates',
    failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
    failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
  })
  if (!isPlainJsonObject(cloned)) fail('invalid-predicate', path, 'must be an object.')
  const input = cloned as UnknownRecord
  const expected = new Set<string>(FIELDS)
  if (FIELDS.some(field => !Object.prototype.hasOwnProperty.call(input, field))
    || Object.keys(input).some(field => !expected.has(field))
    || input.kind !== ABILITY_HP_EVENT_PREDICATE_KIND) fail('invalid-predicate', path, 'has invalid shape.')
  const minimumAppliedAmount = input.minimumAppliedAmount === null
    ? null
    : Number.isSafeInteger(input.minimumAppliedAmount) && Number(input.minimumAppliedAmount) >= 0
      && Number(input.minimumAppliedAmount) <= 10_000_000
      ? Number(input.minimumAppliedAmount)
      : fail('invalid-predicate', `${path}.minimumAppliedAmount`, 'is out of bounds.')
  const parsed = {
    kind: ABILITY_HP_EVENT_PREDICATE_KIND,
    changeKinds: ordered(input.changeKinds, `${path}.changeKinds`, ABILITY_HP_CHANGE_KINDS),
    faintTransitions: ordered(
      input.faintTransitions,
      `${path}.faintTransitions`,
      ABILITY_FAINT_TRANSITIONS,
    ),
    ownerRole: oneOf(input.ownerRole, `${path}.ownerRole`, ABILITY_HP_OWNER_ROLES),
    massiveDamage: oneOf(input.massiveDamage, `${path}.massiveDamage`, ABILITY_HP_BOOLEAN_FILTERS),
    crossedZero: oneOf(input.crossedZero, `${path}.crossedZero`, ABILITY_HP_BOOLEAN_FILTERS),
    injuryChange: oneOf(input.injuryChange, `${path}.injuryChange`, ABILITY_HP_INJURY_FILTERS),
    temporaryChange: oneOf(input.temporaryChange, `${path}.temporaryChange`, ABILITY_HP_TEMPORARY_FILTERS),
    hpThreshold: oneOf(input.hpThreshold, `${path}.hpThreshold`, ABILITY_HP_THRESHOLD_FILTERS),
    minimumAppliedAmount,
  }
  const constrained = parsed.changeKinds.length > 0
    || parsed.faintTransitions.length > 0
    || parsed.ownerRole !== 'either'
    || parsed.massiveDamage !== 'any'
    || parsed.crossedZero !== 'any'
    || parsed.injuryChange !== 'any'
    || parsed.temporaryChange !== 'any'
    || parsed.hpThreshold !== 'any'
    || minimumAppliedAmount !== null
  if (!constrained) fail('invalid-predicate', path, 'must constrain at least one HP fact.')
  return deepFreezeStrictJson(parsed) as AbilityHpEventPredicate
}
