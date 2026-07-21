import {
  ABILITY_ITEM_CHANGES,
  ABILITY_ITEM_OUTCOMES,
  ABILITY_ITEM_RESOURCE_KINDS,
  type AbilityItemChange,
  type AbilityItemOutcome,
  type AbilityItemResourceKind,
} from './events'
import type { AbilitySpecJsonObject } from './spec'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_ITEM_EVENT_PREDICATE_KIND = 'ability-item-fact' as const
export const ABILITY_ITEM_OWNER_ROLES = ['owner-before', 'owner-after', 'either', 'other'] as const
export const ABILITY_ITEM_SOURCE_RELATIONS = ['any', 'owner', 'other', 'none'] as const

export interface AbilityItemEventPredicate extends AbilitySpecJsonObject {
  readonly kind: typeof ABILITY_ITEM_EVENT_PREDICATE_KIND
  readonly changes: readonly AbilityItemChange[]
  readonly outcomes: readonly AbilityItemOutcome[]
  readonly resourceKinds: readonly AbilityItemResourceKind[]
  readonly itemIds: readonly string[]
  readonly ownerRole: (typeof ABILITY_ITEM_OWNER_ROLES)[number]
  readonly sourceRelation: (typeof ABILITY_ITEM_SOURCE_RELATIONS)[number]
  readonly minimumQuantityApplied: number | null
}

export class AbilityItemEventPredicateValidationError extends Error {
  constructor(readonly code: 'invalid-predicate' | 'not-json' | 'limit-exceeded', readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityItemEventPredicateValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const FIELDS = [
  'kind', 'changes', 'outcomes', 'resourceKinds', 'itemIds', 'ownerRole',
  'sourceRelation', 'minimumQuantityApplied',
] as const
const ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const fail = (code: AbilityItemEventPredicateValidationError['code'], path: string, detail: string): never => {
  throw new AbilityItemEventPredicateValidationError(code, path, detail)
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
const oneOf = <Value extends string>(value: unknown, path: string, supported: readonly Value[]): Value => (
  supported.includes(value as Value) ? value as Value : fail('invalid-predicate', path, 'is unsupported.')
)

export const parseAbilityItemEventPredicate = (
  value: unknown,
  path = 'abilityItemEventPredicate',
): AbilityItemEventPredicate => {
  const cloned = cloneStrictJson(value, path, {
    limits: { depth: 4, nodes: 384, objectFields: 12, arrayEntries: 64, stringLength: 160, objectKeyLength: 160 },
    rootLabel: 'ability item-event predicate', valueLabel: 'ability item-event predicates',
    failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
    failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
  })
  if (!isPlainJsonObject(cloned)) fail('invalid-predicate', path, 'must be an object.')
  const input = cloned as UnknownRecord
  const expected = new Set<string>(FIELDS)
  if (FIELDS.some(field => !Object.prototype.hasOwnProperty.call(input, field))
    || Object.keys(input).some(field => !expected.has(field))
    || input.kind !== ABILITY_ITEM_EVENT_PREDICATE_KIND) fail('invalid-predicate', path, 'has invalid shape.')
  if (!Array.isArray(input.itemIds) || input.itemIds.length > 64) {
    fail('limit-exceeded', `${path}.itemIds`, 'must be bounded.')
  }
  const itemIds = (input.itemIds as readonly unknown[]).map((entry, index) => {
    if (typeof entry !== 'string' || !ID_PATTERN.test(entry)) {
      fail('invalid-predicate', `${path}.itemIds[${index}]`, 'must be a stable ID.')
    }
    return entry as string
  })
  if (new Set(itemIds).size !== itemIds.length
    || itemIds.some((id, index) => index > 0 && id <= itemIds[index - 1]!)) {
    fail('invalid-predicate', `${path}.itemIds`, 'must use unique code-point order.')
  }
  const minimumQuantityApplied = input.minimumQuantityApplied === null
    ? null
    : Number.isSafeInteger(input.minimumQuantityApplied) && Number(input.minimumQuantityApplied) >= 0
      && Number(input.minimumQuantityApplied) <= 1_000_000
      ? Number(input.minimumQuantityApplied)
      : fail('invalid-predicate', `${path}.minimumQuantityApplied`, 'is out of bounds.')
  const parsed = {
    kind: ABILITY_ITEM_EVENT_PREDICATE_KIND,
    changes: ordered(input.changes, `${path}.changes`, ABILITY_ITEM_CHANGES),
    outcomes: ordered(input.outcomes, `${path}.outcomes`, ABILITY_ITEM_OUTCOMES),
    resourceKinds: ordered(input.resourceKinds, `${path}.resourceKinds`, ABILITY_ITEM_RESOURCE_KINDS),
    itemIds: Object.freeze(itemIds),
    ownerRole: oneOf(input.ownerRole, `${path}.ownerRole`, ABILITY_ITEM_OWNER_ROLES),
    sourceRelation: oneOf(input.sourceRelation, `${path}.sourceRelation`, ABILITY_ITEM_SOURCE_RELATIONS),
    minimumQuantityApplied,
  }
  if (parsed.changes.length === 0 && parsed.outcomes.length === 0
    && parsed.resourceKinds.length === 0 && parsed.itemIds.length === 0
    && parsed.ownerRole === 'either' && parsed.sourceRelation === 'any'
    && minimumQuantityApplied === null) fail('invalid-predicate', path, 'must constrain at least one item fact.')
  return deepFreezeStrictJson(parsed) as AbilityItemEventPredicate
}
