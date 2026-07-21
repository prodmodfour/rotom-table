import {
  ABILITY_MOVE_DAMAGE_CLASSES,
  ABILITY_STRIKE_ACCURACY_OUTCOMES,
  ABILITY_STRIKE_DIRECTNESS,
  ABILITY_STRIKE_EFFECTIVENESS,
  ABILITY_STRIKE_EVENT_TIMINGS,
  ABILITY_STRIKE_RANGE_CONTEXTS,
  type AbilityMoveDamageClass,
  type AbilityStrikeAccuracyOutcome,
  type AbilityStrikeDirectness,
  type AbilityStrikeEffectiveness,
  type AbilityStrikeEventTiming,
  type AbilityStrikeRangeContext,
} from './events'
import type { AbilitySpecJsonObject } from './spec'
import { POKEMON_TYPE_IDS, type PokemonTypeId } from '../pokemonTypes'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_STRIKE_EVENT_PREDICATE_KIND = 'ability-strike-fact' as const
export const ABILITY_STRIKE_CONTACT_FILTERS = ['any', 'required', 'forbidden'] as const
export const ABILITY_STRIKE_CRITICAL_FILTERS = ['any', 'required', 'forbidden'] as const
export const ABILITY_STRIKE_OWNER_ROLES = ['attacker', 'defender', 'either', 'other'] as const
export const ABILITY_STRIKE_PREVENTION_FILTERS = ['any', 'prevented', 'unprevented'] as const
export const ABILITY_STRIKE_INDEX_FILTERS = ['any', 'first', 'last'] as const

export interface AbilityStrikeEventPredicate extends AbilitySpecJsonObject {
  readonly kind: typeof ABILITY_STRIKE_EVENT_PREDICATE_KIND
  readonly timings: readonly AbilityStrikeEventTiming[]
  readonly accuracyOutcomes: readonly AbilityStrikeAccuracyOutcome[]
  readonly rangeContexts: readonly AbilityStrikeRangeContext[]
  readonly directness: readonly AbilityStrikeDirectness[]
  readonly moveTypes: readonly PokemonTypeId[]
  readonly damageClasses: readonly AbilityMoveDamageClass[]
  readonly effectiveness: readonly AbilityStrikeEffectiveness[]
  readonly contact: (typeof ABILITY_STRIKE_CONTACT_FILTERS)[number]
  readonly critical: (typeof ABILITY_STRIKE_CRITICAL_FILTERS)[number]
  readonly ownerRole: (typeof ABILITY_STRIKE_OWNER_ROLES)[number]
  readonly prevention: (typeof ABILITY_STRIKE_PREVENTION_FILTERS)[number]
  readonly strikeIndex: (typeof ABILITY_STRIKE_INDEX_FILTERS)[number]
  readonly minimumHpLoss: number | null
  readonly minimumTotalLoss: number | null
}

export type AbilityStrikeEventPredicateValidationCode =
  | 'invalid-predicate'
  | 'duplicate-value'
  | 'not-json'
  | 'limit-exceeded'

export class AbilityStrikeEventPredicateValidationError extends Error {
  readonly code: AbilityStrikeEventPredicateValidationCode
  readonly path: string

  constructor(code: AbilityStrikeEventPredicateValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityStrikeEventPredicateValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const FIELDS = [
  'kind', 'timings', 'accuracyOutcomes', 'rangeContexts', 'directness', 'moveTypes',
  'damageClasses', 'effectiveness', 'contact', 'critical', 'ownerRole', 'prevention',
  'strikeIndex', 'minimumHpLoss', 'minimumTotalLoss',
] as const

const fail = (
  code: AbilityStrikeEventPredicateValidationCode,
  path: string,
  detail: string,
): never => {
  throw new AbilityStrikeEventPredicateValidationError(code, path, detail)
}

const orderedEnum = <Value extends string>(
  value: unknown,
  path: string,
  supported: readonly Value[],
): readonly Value[] => {
  if (!Array.isArray(value) || value.length > supported.length) {
    fail('limit-exceeded', path, 'must be a bounded array.')
  }
  const parsed = (value as readonly unknown[]).map((entry, index) => {
    const order = supported.indexOf(entry as Value)
    if (order < 0) fail('invalid-predicate', `${path}[${index}]`, 'is unsupported.')
    return { value: entry as Value, order }
  })
  if (new Set(parsed.map(entry => entry.value)).size !== parsed.length) {
    fail('duplicate-value', path, 'must not repeat values.')
  }
  if (parsed.some((entry, index) => index > 0 && entry.order <= parsed[index - 1]!.order)) {
    fail('invalid-predicate', path, 'must use canonical value order.')
  }
  return Object.freeze(parsed.map(entry => entry.value))
}

const nullableLoss = (value: unknown, path: string): number | null => {
  if (value === null) return null
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 10_000_000) {
    fail('invalid-predicate', path, 'must be a bounded non-negative integer or null.')
  }
  return Number(value)
}

const oneOf = <Value extends string>(
  value: unknown,
  path: string,
  supported: readonly Value[],
): Value => supported.includes(value as Value)
  ? value as Value
  : fail('invalid-predicate', path, 'is unsupported.')

export const parseAbilityStrikeEventPredicate = (
  value: unknown,
  path = 'abilityStrikeEventPredicate',
): AbilityStrikeEventPredicate => {
  const cloned = cloneStrictJson(value, path, {
    limits: {
      depth: 4,
      nodes: 512,
      objectFields: 20,
      arrayEntries: 64,
      stringLength: 160,
      objectKeyLength: 160,
    },
    rootLabel: 'ability strike-event predicate',
    valueLabel: 'ability strike-event predicates',
    failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
    failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
  })
  if (!isPlainJsonObject(cloned)) fail('invalid-predicate', path, 'must be an object.')
  const input = cloned as UnknownRecord
  const expected = new Set<string>(FIELDS)
  if (FIELDS.some(field => !Object.prototype.hasOwnProperty.call(input, field))
    || Object.keys(input).some(field => !expected.has(field))
    || input.kind !== ABILITY_STRIKE_EVENT_PREDICATE_KIND) {
    fail('invalid-predicate', path, 'has an invalid shape or kind.')
  }
  const parsed = {
    kind: ABILITY_STRIKE_EVENT_PREDICATE_KIND,
    timings: orderedEnum(input.timings, `${path}.timings`, ABILITY_STRIKE_EVENT_TIMINGS),
    accuracyOutcomes: orderedEnum(
      input.accuracyOutcomes,
      `${path}.accuracyOutcomes`,
      ABILITY_STRIKE_ACCURACY_OUTCOMES,
    ),
    rangeContexts: orderedEnum(
      input.rangeContexts,
      `${path}.rangeContexts`,
      ABILITY_STRIKE_RANGE_CONTEXTS,
    ),
    directness: orderedEnum(input.directness, `${path}.directness`, ABILITY_STRIKE_DIRECTNESS),
    moveTypes: orderedEnum(input.moveTypes, `${path}.moveTypes`, POKEMON_TYPE_IDS),
    damageClasses: orderedEnum(
      input.damageClasses,
      `${path}.damageClasses`,
      ABILITY_MOVE_DAMAGE_CLASSES,
    ),
    effectiveness: orderedEnum(
      input.effectiveness,
      `${path}.effectiveness`,
      ABILITY_STRIKE_EFFECTIVENESS,
    ),
    contact: oneOf(input.contact, `${path}.contact`, ABILITY_STRIKE_CONTACT_FILTERS),
    critical: oneOf(input.critical, `${path}.critical`, ABILITY_STRIKE_CRITICAL_FILTERS),
    ownerRole: oneOf(input.ownerRole, `${path}.ownerRole`, ABILITY_STRIKE_OWNER_ROLES),
    prevention: oneOf(input.prevention, `${path}.prevention`, ABILITY_STRIKE_PREVENTION_FILTERS),
    strikeIndex: oneOf(input.strikeIndex, `${path}.strikeIndex`, ABILITY_STRIKE_INDEX_FILTERS),
    minimumHpLoss: nullableLoss(input.minimumHpLoss, `${path}.minimumHpLoss`),
    minimumTotalLoss: nullableLoss(input.minimumTotalLoss, `${path}.minimumTotalLoss`),
  }
  const unconstrained = Object.values(parsed).every((entry) => {
    if (Array.isArray(entry)) return entry.length === 0
    return entry === ABILITY_STRIKE_EVENT_PREDICATE_KIND
      || entry === 'any'
      || entry === null
  })
  if (unconstrained) fail('invalid-predicate', path, 'must constrain at least one reviewed strike fact.')
  return deepFreezeStrictJson(parsed) as AbilityStrikeEventPredicate
}
