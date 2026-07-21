import {
  ABILITY_MOVE_DAMAGE_CLASSES,
  ABILITY_MOVE_EVENT_TIMINGS,
  ABILITY_MOVE_KEYWORDS,
  type AbilityMoveDamageClass,
  type AbilityMoveEventTiming,
  type AbilityMoveKeyword,
} from './events'
import type { AbilitySpecJsonObject } from './spec'
import { POKEMON_TYPE_IDS, type PokemonTypeId } from '../pokemonTypes'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_MOVE_EVENT_PREDICATE_KIND = 'ability-move-fact' as const
export const ABILITY_MOVE_EVENT_USER_RELATIONS = ['any', 'owner', 'other'] as const
export const ABILITY_MOVE_EVENT_TARGET_RELATIONS = [
  'any', 'declared', 'attacked', 'hit', 'missed', 'critical', 'not-targeted',
] as const
export type AbilityMoveEventUserRelation = (typeof ABILITY_MOVE_EVENT_USER_RELATIONS)[number]
export type AbilityMoveEventTargetRelation = (typeof ABILITY_MOVE_EVENT_TARGET_RELATIONS)[number]

export interface AbilityMoveEventPredicate extends AbilitySpecJsonObject {
  readonly kind: typeof ABILITY_MOVE_EVENT_PREDICATE_KIND
  readonly timings: readonly AbilityMoveEventTiming[]
  readonly moveTypes: readonly PokemonTypeId[]
  readonly damageClasses: readonly AbilityMoveDamageClass[]
  readonly keywordsAny: readonly AbilityMoveKeyword[]
  readonly keywordsAll: readonly AbilityMoveKeyword[]
  readonly userRelation: AbilityMoveEventUserRelation
  readonly targetRelation: AbilityMoveEventTargetRelation
}

export type AbilityMoveEventPredicateValidationCode =
  | 'invalid-predicate'
  | 'duplicate-value'
  | 'not-json'
  | 'limit-exceeded'

export class AbilityMoveEventPredicateValidationError extends Error {
  readonly code: AbilityMoveEventPredicateValidationCode
  readonly path: string

  constructor(code: AbilityMoveEventPredicateValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityMoveEventPredicateValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const FIELDS = [
  'kind', 'timings', 'moveTypes', 'damageClasses', 'keywordsAny', 'keywordsAll',
  'userRelation', 'targetRelation',
] as const

const fail = (
  code: AbilityMoveEventPredicateValidationCode,
  path: string,
  detail: string,
): never => {
  throw new AbilityMoveEventPredicateValidationError(code, path, detail)
}

const orderedEnum = <Value extends string>(input: {
  readonly value: unknown
  readonly path: string
  readonly values: readonly Value[]
}): readonly Value[] => {
  if (!Array.isArray(input.value) || input.value.length > input.values.length) {
    fail('limit-exceeded', input.path, 'must be a bounded array.')
  }
  const values = (input.value as readonly unknown[]).map((value, index) => {
    const position = input.values.indexOf(value as Value)
    if (position < 0) fail('invalid-predicate', `${input.path}[${index}]`, 'is unsupported.')
    return { value: value as Value, position }
  })
  if (new Set(values.map(entry => entry.value)).size !== values.length) {
    fail('duplicate-value', input.path, 'must not repeat values.')
  }
  if (values.some((entry, index) => index > 0 && entry.position <= values[index - 1]!.position)) {
    fail('invalid-predicate', input.path, 'must use canonical value order.')
  }
  return Object.freeze(values.map(entry => entry.value))
}

export const parseAbilityMoveEventPredicate = (
  value: unknown,
  path = 'abilityMoveEventPredicate',
): AbilityMoveEventPredicate => {
  const cloned = cloneStrictJson(value, path, {
    limits: {
      depth: 4,
      nodes: 256,
      objectFields: 12,
      arrayEntries: 64,
      stringLength: 160,
      objectKeyLength: 160,
    },
    rootLabel: 'ability move-event predicate',
    valueLabel: 'ability move-event predicates',
    failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
    failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
  })
  if (!isPlainJsonObject(cloned)) fail('invalid-predicate', path, 'must be an object.')
  const input = cloned as UnknownRecord
  const expected = new Set<string>(FIELDS)
  if (
    FIELDS.some(field => !Object.prototype.hasOwnProperty.call(input, field))
    || Object.keys(input).some(field => !expected.has(field))
    || input.kind !== ABILITY_MOVE_EVENT_PREDICATE_KIND
  ) fail('invalid-predicate', path, 'has an invalid shape or kind.')
  const timings = orderedEnum({ value: input.timings, path: `${path}.timings`, values: ABILITY_MOVE_EVENT_TIMINGS })
  const moveTypes = orderedEnum({ value: input.moveTypes, path: `${path}.moveTypes`, values: POKEMON_TYPE_IDS })
  const damageClasses = orderedEnum({
    value: input.damageClasses,
    path: `${path}.damageClasses`,
    values: ABILITY_MOVE_DAMAGE_CLASSES,
  })
  const keywordsAny = orderedEnum({
    value: input.keywordsAny,
    path: `${path}.keywordsAny`,
    values: ABILITY_MOVE_KEYWORDS,
  })
  const keywordsAll = orderedEnum({
    value: input.keywordsAll,
    path: `${path}.keywordsAll`,
    values: ABILITY_MOVE_KEYWORDS,
  })
  if (!ABILITY_MOVE_EVENT_USER_RELATIONS.includes(input.userRelation as AbilityMoveEventUserRelation)) {
    fail('invalid-predicate', `${path}.userRelation`, 'is unsupported.')
  }
  if (!ABILITY_MOVE_EVENT_TARGET_RELATIONS.includes(input.targetRelation as AbilityMoveEventTargetRelation)) {
    fail('invalid-predicate', `${path}.targetRelation`, 'is unsupported.')
  }
  const userRelation = input.userRelation as AbilityMoveEventUserRelation
  const targetRelation = input.targetRelation as AbilityMoveEventTargetRelation
  if (
    timings.length === 0
    && moveTypes.length === 0
    && damageClasses.length === 0
    && keywordsAny.length === 0
    && keywordsAll.length === 0
    && userRelation === 'any'
    && targetRelation === 'any'
  ) fail('invalid-predicate', path, 'must constrain at least one reviewed move fact.')
  return deepFreezeStrictJson({
    kind: ABILITY_MOVE_EVENT_PREDICATE_KIND,
    timings,
    moveTypes,
    damageClasses,
    keywordsAny,
    keywordsAll,
    userRelation,
    targetRelation,
  }) as AbilityMoveEventPredicate
}
