import type { SheetKind } from '~/types/map'
import { POKEMON_TYPES } from '~/utils/typeChart'
import {
  MOVE_AUTOMATION_TARGET_GROUNDING_STATES,
  MOVE_AUTOMATION_TARGET_SIZES,
  MOVE_AUTOMATION_TARGET_VITALITIES,
  type MoveAutomationTargetGrounding,
  type MoveAutomationTargetSize,
  type MoveAutomationTargetState,
  type MoveAutomationTargetVitality,
} from '../targetState'

export const MOVE_AUTOMATION_TARGET_STATE_PREDICATE_KINDS = [
  'vitality',
  'grounding',
  'switched',
  'acted',
  'damaged',
  'condition',
  'type',
  'immunity-tag',
  'size',
  'weight-class',
  'opposite-gender',
  'sheet-kind',
  'required-item',
] as const

export const MOVE_AUTOMATION_TARGET_HISTORY_WINDOWS = [
  'turn',
  'round',
] as const

export const MOVE_AUTOMATION_TARGET_SET_MATCH_POLICIES = [
  'any',
  'all',
  'none',
] as const

export const MOVE_AUTOMATION_TARGET_STATE_PREDICATE_LIMITS = Object.freeze({
  predicates: MOVE_AUTOMATION_TARGET_STATE_PREDICATE_KINDS.length,
  setEntries: 32,
  identifierChars: 160,
})

export type MoveAutomationTargetStatePredicateKind =
  (typeof MOVE_AUTOMATION_TARGET_STATE_PREDICATE_KINDS)[number]
export type MoveAutomationTargetHistoryWindow =
  (typeof MOVE_AUTOMATION_TARGET_HISTORY_WINDOWS)[number]
export type MoveAutomationTargetSetMatchPolicy =
  (typeof MOVE_AUTOMATION_TARGET_SET_MATCH_POLICIES)[number]

export interface MoveAutomationTargetVitalityPredicate {
  readonly kind: 'vitality'
  readonly value: MoveAutomationTargetVitality
}

export interface MoveAutomationTargetGroundingPredicate {
  readonly kind: 'grounding'
  readonly value: MoveAutomationTargetGrounding
}

export interface MoveAutomationTargetSwitchedPredicate {
  readonly kind: 'switched'
  /** Switch, recall, or send-out history in the current scene. */
  readonly value: boolean
}

export interface MoveAutomationTargetActedPredicate {
  readonly kind: 'acted'
  readonly window: MoveAutomationTargetHistoryWindow
  readonly value: boolean
}

export interface MoveAutomationTargetDamagedPredicate {
  readonly kind: 'damaged'
  readonly window: MoveAutomationTargetHistoryWindow
  readonly value: boolean
}

export interface MoveAutomationTargetConditionPredicate {
  readonly kind: 'condition'
  readonly conditionIds: readonly string[]
  readonly match: MoveAutomationTargetSetMatchPolicy
}

export interface MoveAutomationTargetTypePredicate {
  readonly kind: 'type'
  readonly typeIds: readonly string[]
  readonly match: MoveAutomationTargetSetMatchPolicy
}

export interface MoveAutomationTargetImmunityTagPredicate {
  readonly kind: 'immunity-tag'
  readonly immunityTagIds: readonly string[]
  readonly match: MoveAutomationTargetSetMatchPolicy
}

export interface MoveAutomationTargetSizePredicate {
  readonly kind: 'size'
  /** Target must have one of these canonical sizes. */
  readonly sizes: readonly MoveAutomationTargetSize[]
}

export interface MoveAutomationTargetWeightClassPredicate {
  readonly kind: 'weight-class'
  readonly minimum: number
  readonly maximum: number
}

export interface MoveAutomationTargetOppositeGenderPredicate {
  readonly kind: 'opposite-gender'
}

export interface MoveAutomationTargetSheetKindPredicate {
  readonly kind: 'sheet-kind'
  readonly sheetKinds: readonly SheetKind[]
}

export interface MoveAutomationTargetRequiredItemPredicate {
  readonly kind: 'required-item'
  readonly itemIds: readonly string[]
  readonly match: MoveAutomationTargetSetMatchPolicy
}

export type MoveAutomationTargetStatePredicate =
  | MoveAutomationTargetVitalityPredicate
  | MoveAutomationTargetGroundingPredicate
  | MoveAutomationTargetSwitchedPredicate
  | MoveAutomationTargetActedPredicate
  | MoveAutomationTargetDamagedPredicate
  | MoveAutomationTargetConditionPredicate
  | MoveAutomationTargetTypePredicate
  | MoveAutomationTargetImmunityTagPredicate
  | MoveAutomationTargetSizePredicate
  | MoveAutomationTargetWeightClassPredicate
  | MoveAutomationTargetOppositeGenderPredicate
  | MoveAutomationTargetSheetKindPredicate
  | MoveAutomationTargetRequiredItemPredicate

export type MoveAutomationTargetStatePredicateReasonCode =
  | 'target-state-included'
  | 'target-excluded-state-unavailable'
  | 'target-excluded-not-conscious'
  | 'target-excluded-not-fainted'
  | 'target-excluded-not-grounded'
  | 'target-excluded-not-airborne'
  | 'target-excluded-switch-state'
  | 'target-excluded-action-history'
  | 'target-excluded-damage-history'
  | 'target-excluded-condition'
  | 'target-excluded-type'
  | 'target-excluded-immunity-tag'
  | 'target-excluded-size'
  | 'target-excluded-weight-class'
  | 'target-excluded-gender'
  | 'target-excluded-sheet-kind'
  | 'target-excluded-required-item'

export interface MoveAutomationTargetStatePredicateEvaluation {
  readonly predicate: MoveAutomationTargetStatePredicate
  readonly outcome: 'included' | 'excluded'
  readonly reasonCode: MoveAutomationTargetStatePredicateReasonCode
}

export interface MoveAutomationTargetStatePredicateResult {
  readonly outcome: 'included' | 'excluded'
  readonly reasonCode: MoveAutomationTargetStatePredicateReasonCode
  /** Every clause is evaluated in reviewed order for deterministic audit evidence. */
  readonly evaluations: readonly MoveAutomationTargetStatePredicateEvaluation[]
}

export type MoveAutomationTargetStatePredicateErrorCode =
  | 'invalid-target-state-predicate'
  | 'limit-exceeded'
  | 'duplicate-predicate-kind'
  | 'duplicate-id'

export class MoveAutomationTargetStatePredicateError extends Error {
  readonly code: MoveAutomationTargetStatePredicateErrorCode
  readonly path: string

  constructor(
    code: MoveAutomationTargetStatePredicateErrorCode,
    path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'MoveAutomationTargetStatePredicateError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>

const PREDICATE_KIND_SET = new Set<string>(MOVE_AUTOMATION_TARGET_STATE_PREDICATE_KINDS)
const VITALITY_SET = new Set<string>(MOVE_AUTOMATION_TARGET_VITALITIES)
const GROUNDING_SET = new Set<string>(MOVE_AUTOMATION_TARGET_GROUNDING_STATES)
const HISTORY_WINDOW_SET = new Set<string>(MOVE_AUTOMATION_TARGET_HISTORY_WINDOWS)
const SET_MATCH_POLICY_SET = new Set<string>(MOVE_AUTOMATION_TARGET_SET_MATCH_POLICIES)
const SIZE_SET = new Set<string>(MOVE_AUTOMATION_TARGET_SIZES)
const TYPE_ID_SET = new Set<string>(POKEMON_TYPES.map(type => type.toLowerCase()))
const SHEET_KIND_SET = new Set<string>(['pokemon', 'trainer'])
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/

const fail = (
  code: MoveAutomationTargetStatePredicateErrorCode,
  path: string,
  message: string,
): never => {
  throw new MoveAutomationTargetStatePredicateError(code, path, message)
}

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const parseRecord = (value: unknown, path: string): UnknownRecord => (
  isPlainRecord(value)
    ? value
    : fail('invalid-target-state-predicate', path, 'must be a plain object.')
)

const assertExactFields = (
  record: UnknownRecord,
  fields: readonly string[],
  path: string,
): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(record, field))
  const unknown = Object.keys(record).filter(field => !expected.has(field))
  if (missing.length === 0 && unknown.length === 0) return
  const detail = [
    missing.length > 0 ? `missing ${missing.join(', ')}` : '',
    unknown.length > 0 ? `unknown ${unknown.join(', ')}` : '',
  ].filter(Boolean).join('; ')
  fail(
    'invalid-target-state-predicate',
    path,
    `must contain exactly the supported fields (${detail}).`,
  )
}

const parseEnum = <Value extends string>(
  value: unknown,
  values: ReadonlySet<string>,
  path: string,
  description: string,
): Value => typeof value === 'string' && values.has(value)
  ? value as Value
  : fail('invalid-target-state-predicate', path, `must be ${description}.`)

const parseBoolean = (value: unknown, path: string): boolean => (
  typeof value === 'boolean'
    ? value
    : fail('invalid-target-state-predicate', path, 'must be a boolean.')
)

const parseStableId = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MOVE_AUTOMATION_TARGET_STATE_PREDICATE_LIMITS.identifierChars
    || !STABLE_ID_PATTERN.test(value)
  ) {
    return fail(
      'invalid-target-state-predicate',
      path,
      `must be a lowercase stable ID of at most ${MOVE_AUTOMATION_TARGET_STATE_PREDICATE_LIMITS.identifierChars} characters.`,
    )
  }
  return value
}

const parseStableIdList = (
  value: unknown,
  path: string,
): readonly string[] => {
  if (!Array.isArray(value) || value.length === 0) {
    return fail('invalid-target-state-predicate', path, 'must be a non-empty array.')
  }
  if (value.length > MOVE_AUTOMATION_TARGET_STATE_PREDICATE_LIMITS.setEntries) {
    fail(
      'limit-exceeded',
      path,
      `must contain at most ${MOVE_AUTOMATION_TARGET_STATE_PREDICATE_LIMITS.setEntries} entries.`,
    )
  }
  const ids = value.map((entry, index) => parseStableId(entry, `${path}[${index}]`))
  if (new Set(ids).size !== ids.length) {
    fail('duplicate-id', path, 'must not contain duplicate IDs.')
  }
  return Object.freeze(ids)
}

const parseEnumList = <Value extends string>(
  value: unknown,
  values: ReadonlySet<string>,
  path: string,
  description: string,
): readonly Value[] => {
  if (!Array.isArray(value) || value.length === 0) {
    return fail('invalid-target-state-predicate', path, 'must be a non-empty array.')
  }
  if (value.length > MOVE_AUTOMATION_TARGET_STATE_PREDICATE_LIMITS.setEntries) {
    fail(
      'limit-exceeded',
      path,
      `must contain at most ${MOVE_AUTOMATION_TARGET_STATE_PREDICATE_LIMITS.setEntries} entries.`,
    )
  }
  const entries = value.map((entry, index) => parseEnum<Value>(
    entry,
    values,
    `${path}[${index}]`,
    description,
  ))
  if (new Set(entries).size !== entries.length) {
    fail('duplicate-id', path, 'must not contain duplicate values.')
  }
  return Object.freeze(entries)
}

const parseSetMatch = (
  value: unknown,
  path: string,
): MoveAutomationTargetSetMatchPolicy => parseEnum(
  value,
  SET_MATCH_POLICY_SET,
  path,
  'any, all, or none',
)

const parsePredicate = (
  value: unknown,
  path: string,
): MoveAutomationTargetStatePredicate => {
  const predicate = parseRecord(value, path)
  const kind = parseEnum<MoveAutomationTargetStatePredicateKind>(
    predicate.kind,
    PREDICATE_KIND_SET,
    `${path}.kind`,
    'a supported target-state predicate kind',
  )

  if (kind === 'vitality') {
    assertExactFields(predicate, ['kind', 'value'], path)
    return Object.freeze({
      kind,
      value: parseEnum<MoveAutomationTargetVitality>(
        predicate.value,
        VITALITY_SET,
        `${path}.value`,
        'conscious or fainted',
      ),
    })
  }
  if (kind === 'grounding') {
    assertExactFields(predicate, ['kind', 'value'], path)
    return Object.freeze({
      kind,
      value: parseEnum<MoveAutomationTargetGrounding>(
        predicate.value,
        GROUNDING_SET,
        `${path}.value`,
        'grounded or airborne',
      ),
    })
  }
  if (kind === 'switched') {
    assertExactFields(predicate, ['kind', 'value'], path)
    return Object.freeze({ kind, value: parseBoolean(predicate.value, `${path}.value`) })
  }
  if (kind === 'acted' || kind === 'damaged') {
    assertExactFields(predicate, ['kind', 'window', 'value'], path)
    const window = parseEnum<MoveAutomationTargetHistoryWindow>(
      predicate.window,
      HISTORY_WINDOW_SET,
      `${path}.window`,
      'turn or round',
    )
    const value = parseBoolean(predicate.value, `${path}.value`)
    return kind === 'acted'
      ? Object.freeze({ kind, window, value })
      : Object.freeze({ kind, window, value })
  }
  if (kind === 'condition') {
    assertExactFields(predicate, ['kind', 'conditionIds', 'match'], path)
    return Object.freeze({
      kind,
      conditionIds: parseStableIdList(predicate.conditionIds, `${path}.conditionIds`),
      match: parseSetMatch(predicate.match, `${path}.match`),
    })
  }
  if (kind === 'type') {
    assertExactFields(predicate, ['kind', 'typeIds', 'match'], path)
    return Object.freeze({
      kind,
      typeIds: parseEnumList(
        predicate.typeIds,
        TYPE_ID_SET,
        `${path}.typeIds`,
        'a canonical lowercase Pokémon type ID',
      ),
      match: parseSetMatch(predicate.match, `${path}.match`),
    })
  }
  if (kind === 'immunity-tag') {
    assertExactFields(predicate, ['kind', 'immunityTagIds', 'match'], path)
    return Object.freeze({
      kind,
      immunityTagIds: parseStableIdList(
        predicate.immunityTagIds,
        `${path}.immunityTagIds`,
      ),
      match: parseSetMatch(predicate.match, `${path}.match`),
    })
  }
  if (kind === 'size') {
    assertExactFields(predicate, ['kind', 'sizes'], path)
    return Object.freeze({
      kind,
      sizes: parseEnumList<MoveAutomationTargetSize>(
        predicate.sizes,
        SIZE_SET,
        `${path}.sizes`,
        'small, medium, large, huge, or gigantic',
      ),
    })
  }
  if (kind === 'weight-class') {
    assertExactFields(predicate, ['kind', 'minimum', 'maximum'], path)
    if (
      !Number.isSafeInteger(predicate.minimum)
      || Number(predicate.minimum) < 1
      || !Number.isSafeInteger(predicate.maximum)
      || Number(predicate.maximum) < Number(predicate.minimum)
    ) {
      return fail(
        'invalid-target-state-predicate',
        path,
        'weight-class bounds must be positive safe integers with minimum no greater than maximum.',
      )
    }
    return Object.freeze({
      kind,
      minimum: Number(predicate.minimum),
      maximum: Number(predicate.maximum),
    })
  }
  if (kind === 'opposite-gender') {
    assertExactFields(predicate, ['kind'], path)
    return Object.freeze({ kind })
  }
  if (kind === 'sheet-kind') {
    assertExactFields(predicate, ['kind', 'sheetKinds'], path)
    return Object.freeze({
      kind,
      sheetKinds: parseEnumList<SheetKind>(
        predicate.sheetKinds,
        SHEET_KIND_SET,
        `${path}.sheetKinds`,
        'pokemon or trainer',
      ),
    })
  }

  assertExactFields(predicate, ['kind', 'itemIds', 'match'], path)
  return Object.freeze({
    kind,
    itemIds: parseStableIdList(predicate.itemIds, `${path}.itemIds`),
    match: parseSetMatch(predicate.match, `${path}.match`),
  })
}

/** Strictly parse, detach, and freeze one all-of target-state declaration. */
export const parseMoveAutomationTargetStatePredicates = (
  value: unknown,
  path = 'predicate.statePredicates',
): readonly MoveAutomationTargetStatePredicate[] => {
  if (!Array.isArray(value) || value.length === 0) {
    return fail('invalid-target-state-predicate', path, 'must be a non-empty array.')
  }
  if (value.length > MOVE_AUTOMATION_TARGET_STATE_PREDICATE_LIMITS.predicates) {
    fail(
      'limit-exceeded',
      path,
      `must contain at most ${MOVE_AUTOMATION_TARGET_STATE_PREDICATE_LIMITS.predicates} predicates.`,
    )
  }
  const predicates = value.map((predicate, index) => parsePredicate(
    predicate,
    `${path}[${index}]`,
  ))
  const kinds = predicates.map(predicate => predicate.kind)
  if (new Set(kinds).size !== kinds.length) {
    fail('duplicate-predicate-kind', path, 'must not repeat a predicate kind.')
  }
  return Object.freeze(predicates)
}

const setMatches = (
  actualValues: readonly string[],
  expectedValues: readonly string[],
  policy: MoveAutomationTargetSetMatchPolicy,
): boolean => {
  const actual = new Set(actualValues)
  if (policy === 'any') return expectedValues.some(value => actual.has(value))
  if (policy === 'all') return expectedValues.every(value => actual.has(value))
  return expectedValues.every(value => !actual.has(value))
}

const evaluatePredicate = (
  state: MoveAutomationTargetState,
  predicate: MoveAutomationTargetStatePredicate,
  actorState: MoveAutomationTargetState | null,
): MoveAutomationTargetStatePredicateReasonCode => {
  if (predicate.kind === 'vitality') {
    if (state.vitality === predicate.value) return 'target-state-included'
    return predicate.value === 'conscious'
      ? 'target-excluded-not-conscious'
      : 'target-excluded-not-fainted'
  }
  if (predicate.kind === 'grounding') {
    if (state.grounding === predicate.value) return 'target-state-included'
    return predicate.value === 'grounded'
      ? 'target-excluded-not-grounded'
      : 'target-excluded-not-airborne'
  }
  if (predicate.kind === 'switched') {
    return state.switchedThisScene === predicate.value
      ? 'target-state-included'
      : 'target-excluded-switch-state'
  }
  if (predicate.kind === 'acted') {
    const acted = predicate.window === 'turn' ? state.actedThisTurn : state.actedThisRound
    return acted === predicate.value
      ? 'target-state-included'
      : 'target-excluded-action-history'
  }
  if (predicate.kind === 'damaged') {
    const damaged = predicate.window === 'turn'
      ? state.damagedThisTurn
      : state.damagedThisRound
    return damaged === predicate.value
      ? 'target-state-included'
      : 'target-excluded-damage-history'
  }
  if (predicate.kind === 'condition') {
    return setMatches(state.conditionIds, predicate.conditionIds, predicate.match)
      ? 'target-state-included'
      : 'target-excluded-condition'
  }
  if (predicate.kind === 'type') {
    return setMatches(state.typeIds, predicate.typeIds, predicate.match)
      ? 'target-state-included'
      : 'target-excluded-type'
  }
  if (predicate.kind === 'immunity-tag') {
    return setMatches(state.immunityTagIds, predicate.immunityTagIds, predicate.match)
      ? 'target-state-included'
      : 'target-excluded-immunity-tag'
  }
  if (predicate.kind === 'size') {
    return state.size !== null && predicate.sizes.includes(state.size)
      ? 'target-state-included'
      : 'target-excluded-size'
  }
  if (predicate.kind === 'weight-class') {
    return state.weightClass !== null
      && state.weightClass >= predicate.minimum
      && state.weightClass <= predicate.maximum
      ? 'target-state-included'
      : 'target-excluded-weight-class'
  }
  if (predicate.kind === 'opposite-gender') {
    const actorGender = actorState?.gender ?? 'unknown'
    return (
      (actorGender === 'male' && state.gender === 'female')
      || (actorGender === 'female' && state.gender === 'male')
    )
      ? 'target-state-included'
      : 'target-excluded-gender'
  }
  if (predicate.kind === 'sheet-kind') {
    return predicate.sheetKinds.includes(state.sheetKind)
      ? 'target-state-included'
      : 'target-excluded-sheet-kind'
  }
  return setMatches(state.itemIds, predicate.itemIds, predicate.match)
    ? 'target-state-included'
    : 'target-excluded-required-item'
}

/** Evaluate all reviewed clauses without rolls, costs, or state mutation. */
export const evaluateMoveAutomationTargetStatePredicates = (
  predicates: readonly MoveAutomationTargetStatePredicate[],
  state: MoveAutomationTargetState | null,
  actorState: MoveAutomationTargetState | null = null,
): MoveAutomationTargetStatePredicateResult => {
  if (state === null) {
    return Object.freeze({
      outcome: 'excluded',
      reasonCode: 'target-excluded-state-unavailable',
      evaluations: Object.freeze([]),
    })
  }

  const evaluations = predicates.map((predicate): MoveAutomationTargetStatePredicateEvaluation => {
    const reasonCode = evaluatePredicate(state, predicate, actorState)
    return Object.freeze({
      predicate,
      outcome: reasonCode === 'target-state-included' ? 'included' : 'excluded',
      reasonCode,
    })
  })
  const failed = evaluations.find(evaluation => evaluation.outcome === 'excluded')
  return Object.freeze({
    outcome: failed ? 'excluded' : 'included',
    reasonCode: failed?.reasonCode ?? 'target-state-included',
    evaluations: Object.freeze(evaluations),
  })
}
