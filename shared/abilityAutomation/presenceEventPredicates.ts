import {
  ABILITY_PRESENCE_OPERATIONS,
  type AbilityPresenceOperation,
} from './events'
import type { AbilitySpecJsonObject } from './spec'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_PRESENCE_EVENT_PREDICATE_KIND = 'ability-presence-fact' as const
export const ABILITY_PRESENCE_OWNER_ROLES = ['outgoing', 'incoming', 'either', 'other'] as const

export interface AbilityPresenceEventPredicate extends AbilitySpecJsonObject {
  readonly kind: typeof ABILITY_PRESENCE_EVENT_PREDICATE_KIND
  readonly operations: readonly AbilityPresenceOperation[]
  readonly ownerRole: (typeof ABILITY_PRESENCE_OWNER_ROLES)[number]
  readonly sideId: string | null
}

export class AbilityPresenceEventPredicateValidationError extends Error {
  constructor(readonly code: 'invalid-predicate' | 'not-json' | 'limit-exceeded', readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityPresenceEventPredicateValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const FIELDS = ['kind', 'operations', 'ownerRole', 'sideId'] as const
const ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const fail = (code: AbilityPresenceEventPredicateValidationError['code'], path: string, detail: string): never => {
  throw new AbilityPresenceEventPredicateValidationError(code, path, detail)
}

export const parseAbilityPresenceEventPredicate = (
  value: unknown,
  path = 'abilityPresenceEventPredicate',
): AbilityPresenceEventPredicate => {
  const cloned = cloneStrictJson(value, path, {
    limits: { depth: 4, nodes: 128, objectFields: 8, arrayEntries: 16, stringLength: 160, objectKeyLength: 160 },
    rootLabel: 'ability presence-event predicate', valueLabel: 'ability presence-event predicates',
    failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
    failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
  })
  if (!isPlainJsonObject(cloned)) fail('invalid-predicate', path, 'must be an object.')
  const input = cloned as UnknownRecord
  const expected = new Set<string>(FIELDS)
  if (FIELDS.some(field => !Object.prototype.hasOwnProperty.call(input, field))
    || Object.keys(input).some(field => !expected.has(field))
    || input.kind !== ABILITY_PRESENCE_EVENT_PREDICATE_KIND) fail('invalid-predicate', path, 'has invalid shape.')
  if (!Array.isArray(input.operations) || input.operations.length > ABILITY_PRESENCE_OPERATIONS.length) {
    fail('limit-exceeded', `${path}.operations`, 'must be bounded.')
  }
  const operations = (input.operations as readonly unknown[]).map((entry, index) => {
    const order = ABILITY_PRESENCE_OPERATIONS.indexOf(entry as AbilityPresenceOperation)
    if (order < 0) fail('invalid-predicate', `${path}.operations[${index}]`, 'is unsupported.')
    return { value: entry as AbilityPresenceOperation, order }
  })
  if (new Set(operations.map(entry => entry.value)).size !== operations.length
    || operations.some((entry, index) => index > 0 && entry.order <= operations[index - 1]!.order)) {
    fail('invalid-predicate', `${path}.operations`, 'must use unique canonical order.')
  }
  if (!ABILITY_PRESENCE_OWNER_ROLES.includes(input.ownerRole as never)) {
    fail('invalid-predicate', `${path}.ownerRole`, 'is unsupported.')
  }
  const sideId = input.sideId === null
    ? null
    : typeof input.sideId === 'string' && ID_PATTERN.test(input.sideId)
      ? input.sideId
      : fail('invalid-predicate', `${path}.sideId`, 'must be a stable ID or null.')
  if (operations.length === 0 && input.ownerRole === 'either' && sideId === null) {
    fail('invalid-predicate', path, 'must constrain at least one presence fact.')
  }
  return deepFreezeStrictJson({
    kind: ABILITY_PRESENCE_EVENT_PREDICATE_KIND,
    operations: Object.freeze(operations.map(entry => entry.value)),
    ownerRole: input.ownerRole as (typeof ABILITY_PRESENCE_OWNER_ROLES)[number],
    sideId,
  }) as AbilityPresenceEventPredicate
}
