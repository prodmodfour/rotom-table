import {
  ABILITY_INITIATIVE_CHANGES,
  type AbilityInitiativeChange,
} from './events'
import type { AbilitySpecJsonObject } from './spec'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_INITIATIVE_EVENT_PREDICATE_KIND = 'ability-initiative-fact' as const
export const ABILITY_INITIATIVE_OWNER_ROLES = [
  'affected', 'active-before', 'active-after', 'either', 'other',
] as const
export const ABILITY_INITIATIVE_POSITION_FILTERS = [
  'any', 'entered', 'removed', 'earlier', 'later', 'unchanged',
] as const
export const ABILITY_INITIATIVE_CLOCK_FILTERS = ['any', 'turn-advanced', 'round-reset', 'unchanged'] as const

export interface AbilityInitiativeEventPredicate extends AbilitySpecJsonObject {
  readonly kind: typeof ABILITY_INITIATIVE_EVENT_PREDICATE_KIND
  readonly changes: readonly AbilityInitiativeChange[]
  readonly ownerRole: (typeof ABILITY_INITIATIVE_OWNER_ROLES)[number]
  readonly ownerPosition: (typeof ABILITY_INITIATIVE_POSITION_FILTERS)[number]
  readonly clock: (typeof ABILITY_INITIATIVE_CLOCK_FILTERS)[number]
}

export class AbilityInitiativeEventPredicateValidationError extends Error {
  constructor(readonly code: 'invalid-predicate' | 'not-json' | 'limit-exceeded', readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityInitiativeEventPredicateValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const FIELDS = ['kind', 'changes', 'ownerRole', 'ownerPosition', 'clock'] as const
const fail = (code: AbilityInitiativeEventPredicateValidationError['code'], path: string, detail: string): never => {
  throw new AbilityInitiativeEventPredicateValidationError(code, path, detail)
}
const oneOf = <Value extends string>(value: unknown, path: string, supported: readonly Value[]): Value => (
  supported.includes(value as Value) ? value as Value : fail('invalid-predicate', path, 'is unsupported.')
)

export const parseAbilityInitiativeEventPredicate = (
  value: unknown,
  path = 'abilityInitiativeEventPredicate',
): AbilityInitiativeEventPredicate => {
  const cloned = cloneStrictJson(value, path, {
    limits: { depth: 4, nodes: 192, objectFields: 8, arrayEntries: 16, stringLength: 160, objectKeyLength: 160 },
    rootLabel: 'ability initiative-event predicate', valueLabel: 'ability initiative-event predicates',
    failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
    failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
  })
  if (!isPlainJsonObject(cloned)) fail('invalid-predicate', path, 'must be an object.')
  const input = cloned as UnknownRecord
  const expected = new Set<string>(FIELDS)
  if (FIELDS.some(field => !Object.prototype.hasOwnProperty.call(input, field))
    || Object.keys(input).some(field => !expected.has(field))
    || input.kind !== ABILITY_INITIATIVE_EVENT_PREDICATE_KIND) fail('invalid-predicate', path, 'has invalid shape.')
  if (!Array.isArray(input.changes) || input.changes.length > ABILITY_INITIATIVE_CHANGES.length) {
    fail('limit-exceeded', `${path}.changes`, 'must be bounded.')
  }
  const changes = (input.changes as readonly unknown[]).map((entry, index) => {
    const order = ABILITY_INITIATIVE_CHANGES.indexOf(entry as AbilityInitiativeChange)
    if (order < 0) fail('invalid-predicate', `${path}.changes[${index}]`, 'is unsupported.')
    return { value: entry as AbilityInitiativeChange, order }
  })
  if (new Set(changes.map(entry => entry.value)).size !== changes.length
    || changes.some((entry, index) => index > 0 && entry.order <= changes[index - 1]!.order)) {
    fail('invalid-predicate', `${path}.changes`, 'must use unique canonical order.')
  }
  const parsed = {
    kind: ABILITY_INITIATIVE_EVENT_PREDICATE_KIND,
    changes: Object.freeze(changes.map(entry => entry.value)),
    ownerRole: oneOf(input.ownerRole, `${path}.ownerRole`, ABILITY_INITIATIVE_OWNER_ROLES),
    ownerPosition: oneOf(
      input.ownerPosition,
      `${path}.ownerPosition`,
      ABILITY_INITIATIVE_POSITION_FILTERS,
    ),
    clock: oneOf(input.clock, `${path}.clock`, ABILITY_INITIATIVE_CLOCK_FILTERS),
  }
  if (parsed.changes.length === 0 && parsed.ownerRole === 'either'
    && parsed.ownerPosition === 'any' && parsed.clock === 'any') {
    fail('invalid-predicate', path, 'must constrain at least one initiative fact.')
  }
  return deepFreezeStrictJson(parsed) as AbilityInitiativeEventPredicate
}
