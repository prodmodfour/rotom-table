import {
  ABILITY_FIELD_CHANGES,
  ABILITY_FIELD_KINDS,
  ABILITY_FIELD_OUTCOMES,
  type AbilityFieldChange,
  type AbilityFieldKind,
  type AbilityFieldOutcome,
} from './events'
import type { AbilitySpecJsonObject } from './spec'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_FIELD_EVENT_PREDICATE_KIND = 'ability-field-fact' as const
export const ABILITY_FIELD_SOURCE_RELATIONS = ['any', 'owner', 'other', 'none'] as const
export const ABILITY_FIELD_PRESENCE_FILTERS = ['any', 'present', 'absent'] as const

export interface AbilityFieldEventPredicate extends AbilitySpecJsonObject {
  readonly kind: typeof ABILITY_FIELD_EVENT_PREDICATE_KIND
  readonly fieldKinds: readonly AbilityFieldKind[]
  readonly changes: readonly AbilityFieldChange[]
  readonly outcomes: readonly AbilityFieldOutcome[]
  readonly fieldIds: readonly string[]
  readonly sourceRelation: (typeof ABILITY_FIELD_SOURCE_RELATIONS)[number]
  readonly resultingPresence: (typeof ABILITY_FIELD_PRESENCE_FILTERS)[number]
  readonly minimumLayerAfter: number | null
}

export class AbilityFieldEventPredicateValidationError extends Error {
  constructor(readonly code: 'invalid-predicate' | 'not-json' | 'limit-exceeded', readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityFieldEventPredicateValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const FIELDS = [
  'kind', 'fieldKinds', 'changes', 'outcomes', 'fieldIds', 'sourceRelation',
  'resultingPresence', 'minimumLayerAfter',
] as const
const ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const fail = (code: AbilityFieldEventPredicateValidationError['code'], path: string, detail: string): never => {
  throw new AbilityFieldEventPredicateValidationError(code, path, detail)
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

export const parseAbilityFieldEventPredicate = (
  value: unknown,
  path = 'abilityFieldEventPredicate',
): AbilityFieldEventPredicate => {
  const cloned = cloneStrictJson(value, path, {
    limits: { depth: 4, nodes: 384, objectFields: 12, arrayEntries: 64, stringLength: 160, objectKeyLength: 160 },
    rootLabel: 'ability field-event predicate', valueLabel: 'ability field-event predicates',
    failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
    failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
  })
  if (!isPlainJsonObject(cloned)) fail('invalid-predicate', path, 'must be an object.')
  const input = cloned as UnknownRecord
  const expected = new Set<string>(FIELDS)
  if (FIELDS.some(field => !Object.prototype.hasOwnProperty.call(input, field))
    || Object.keys(input).some(field => !expected.has(field))
    || input.kind !== ABILITY_FIELD_EVENT_PREDICATE_KIND) fail('invalid-predicate', path, 'has invalid shape.')
  if (!Array.isArray(input.fieldIds) || input.fieldIds.length > 64) {
    fail('limit-exceeded', `${path}.fieldIds`, 'must be bounded.')
  }
  const fieldIds = (input.fieldIds as readonly unknown[]).map((entry, index) => {
    if (typeof entry !== 'string' || !ID_PATTERN.test(entry)) {
      fail('invalid-predicate', `${path}.fieldIds[${index}]`, 'must be a stable ID.')
    }
    return entry as string
  })
  if (new Set(fieldIds).size !== fieldIds.length
    || fieldIds.some((id, index) => index > 0 && id <= fieldIds[index - 1]!)) {
    fail('invalid-predicate', `${path}.fieldIds`, 'must use unique code-point order.')
  }
  const minimumLayerAfter = input.minimumLayerAfter === null
    ? null
    : Number.isSafeInteger(input.minimumLayerAfter) && Number(input.minimumLayerAfter) >= 0
      && Number(input.minimumLayerAfter) <= 64
      ? Number(input.minimumLayerAfter)
      : fail('invalid-predicate', `${path}.minimumLayerAfter`, 'is out of bounds.')
  const parsed = {
    kind: ABILITY_FIELD_EVENT_PREDICATE_KIND,
    fieldKinds: ordered(input.fieldKinds, `${path}.fieldKinds`, ABILITY_FIELD_KINDS),
    changes: ordered(input.changes, `${path}.changes`, ABILITY_FIELD_CHANGES),
    outcomes: ordered(input.outcomes, `${path}.outcomes`, ABILITY_FIELD_OUTCOMES),
    fieldIds: Object.freeze(fieldIds),
    sourceRelation: oneOf(input.sourceRelation, `${path}.sourceRelation`, ABILITY_FIELD_SOURCE_RELATIONS),
    resultingPresence: oneOf(
      input.resultingPresence,
      `${path}.resultingPresence`,
      ABILITY_FIELD_PRESENCE_FILTERS,
    ),
    minimumLayerAfter,
  }
  if (parsed.fieldKinds.length === 0 && parsed.changes.length === 0
    && parsed.outcomes.length === 0 && parsed.fieldIds.length === 0
    && parsed.sourceRelation === 'any' && parsed.resultingPresence === 'any'
    && minimumLayerAfter === null) fail('invalid-predicate', path, 'must constrain at least one field fact.')
  return deepFreezeStrictJson(parsed) as AbilityFieldEventPredicate
}
