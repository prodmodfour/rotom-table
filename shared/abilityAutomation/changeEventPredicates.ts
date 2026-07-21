import {
  ABILITY_CHANGE_OUTCOMES,
  ABILITY_COMBAT_STAGE_STATS,
  ABILITY_STAT_KINDS,
  ABILITY_STAT_LAYERS,
  type AbilityChangeOutcome,
  type AbilityCombatStageStat,
  type AbilityStatKind,
  type AbilityStatLayer,
} from './events'
import type { AbilitySpecJsonObject } from './spec'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_VALUE_CHANGE_EVENT_PREDICATE_KIND = 'ability-value-change-fact' as const
export const ABILITY_VALUE_CHANGE_EVENT_KINDS = ['combat-stage', 'stat'] as const
export const ABILITY_VALUE_CHANGE_OWNER_ROLES = ['subject', 'actor', 'either', 'other'] as const
export const ABILITY_VALUE_CHANGE_SOURCE_RELATIONS = ['any', 'owner', 'other', 'none'] as const
export const ABILITY_VALUE_CHANGE_DIRECTIONS = ['any', 'raised', 'lowered', 'unchanged'] as const

export interface AbilityValueChangeEventPredicate extends AbilitySpecJsonObject {
  readonly kind: typeof ABILITY_VALUE_CHANGE_EVENT_PREDICATE_KIND
  readonly eventKinds: readonly (typeof ABILITY_VALUE_CHANGE_EVENT_KINDS)[number][]
  readonly combatStageStats: readonly AbilityCombatStageStat[]
  readonly statKinds: readonly AbilityStatKind[]
  readonly statLayers: readonly AbilityStatLayer[]
  readonly outcomes: readonly AbilityChangeOutcome[]
  readonly ownerRole: (typeof ABILITY_VALUE_CHANGE_OWNER_ROLES)[number]
  readonly sourceRelation: (typeof ABILITY_VALUE_CHANGE_SOURCE_RELATIONS)[number]
  readonly direction: (typeof ABILITY_VALUE_CHANGE_DIRECTIONS)[number]
  readonly minimumAbsoluteDelta: number | null
}

export class AbilityValueChangeEventPredicateValidationError extends Error {
  constructor(readonly code: 'invalid-predicate' | 'not-json' | 'limit-exceeded', readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityValueChangeEventPredicateValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const FIELDS = [
  'kind', 'eventKinds', 'combatStageStats', 'statKinds', 'statLayers', 'outcomes',
  'ownerRole', 'sourceRelation', 'direction', 'minimumAbsoluteDelta',
] as const
const fail = (code: AbilityValueChangeEventPredicateValidationError['code'], path: string, detail: string): never => {
  throw new AbilityValueChangeEventPredicateValidationError(code, path, detail)
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

export const parseAbilityValueChangeEventPredicate = (
  value: unknown,
  path = 'abilityValueChangeEventPredicate',
): AbilityValueChangeEventPredicate => {
  const cloned = cloneStrictJson(value, path, {
    limits: { depth: 4, nodes: 384, objectFields: 16, arrayEntries: 64, stringLength: 160, objectKeyLength: 160 },
    rootLabel: 'ability value-change predicate', valueLabel: 'ability value-change predicates',
    failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
    failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
  })
  if (!isPlainJsonObject(cloned)) fail('invalid-predicate', path, 'must be an object.')
  const input = cloned as UnknownRecord
  const expected = new Set<string>(FIELDS)
  if (FIELDS.some(field => !Object.prototype.hasOwnProperty.call(input, field))
    || Object.keys(input).some(field => !expected.has(field))
    || input.kind !== ABILITY_VALUE_CHANGE_EVENT_PREDICATE_KIND) fail('invalid-predicate', path, 'has invalid shape.')
  const minimumAbsoluteDelta = input.minimumAbsoluteDelta === null
    ? null
    : Number.isSafeInteger(input.minimumAbsoluteDelta) && Number(input.minimumAbsoluteDelta) >= 0
      && Number(input.minimumAbsoluteDelta) <= 10_000_000
      ? Number(input.minimumAbsoluteDelta)
      : fail('invalid-predicate', `${path}.minimumAbsoluteDelta`, 'is out of bounds.')
  const parsed = {
    kind: ABILITY_VALUE_CHANGE_EVENT_PREDICATE_KIND,
    eventKinds: ordered(input.eventKinds, `${path}.eventKinds`, ABILITY_VALUE_CHANGE_EVENT_KINDS),
    combatStageStats: ordered(
      input.combatStageStats,
      `${path}.combatStageStats`,
      ABILITY_COMBAT_STAGE_STATS,
    ),
    statKinds: ordered(input.statKinds, `${path}.statKinds`, ABILITY_STAT_KINDS),
    statLayers: ordered(input.statLayers, `${path}.statLayers`, ABILITY_STAT_LAYERS),
    outcomes: ordered(input.outcomes, `${path}.outcomes`, ABILITY_CHANGE_OUTCOMES),
    ownerRole: oneOf(input.ownerRole, `${path}.ownerRole`, ABILITY_VALUE_CHANGE_OWNER_ROLES),
    sourceRelation: oneOf(
      input.sourceRelation,
      `${path}.sourceRelation`,
      ABILITY_VALUE_CHANGE_SOURCE_RELATIONS,
    ),
    direction: oneOf(input.direction, `${path}.direction`, ABILITY_VALUE_CHANGE_DIRECTIONS),
    minimumAbsoluteDelta,
  }
  const constrained = parsed.eventKinds.length > 0 || parsed.combatStageStats.length > 0
    || parsed.statKinds.length > 0 || parsed.statLayers.length > 0 || parsed.outcomes.length > 0
    || parsed.ownerRole !== 'either' || parsed.sourceRelation !== 'any'
    || parsed.direction !== 'any' || minimumAbsoluteDelta !== null
  if (!constrained) fail('invalid-predicate', path, 'must constrain at least one change fact.')
  return deepFreezeStrictJson(parsed) as AbilityValueChangeEventPredicate
}
