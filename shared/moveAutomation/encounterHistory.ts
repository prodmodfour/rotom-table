import type { EncounterActionType } from './encounterResources'
import type { EncounterEventLifecycleKoCause } from './events'
import {
  MOVE_HISTORY_METADATA_LIMITS,
  MoveHistoryMetadataValidationError,
  moveHistoryIdentitiesEqual,
  parseMoveHistoryBranchSelections,
  parseMoveHistoryIdentity,
  type MoveHistoryBranchSelection,
  type MoveHistoryIdentity,
  type MoveHistoryMoveListSource,
  type MoveHistoryOrigin,
} from './moveHistoryMetadata'

/**
 * Bounded map-owned indexes derived only from authoritative encounter events.
 *
 * The indexes retain scene-local move ancestry and switch/KO facts plus current
 * turn/round windows. They deliberately store structured identities and
 * numeric outcomes rather than rendering or parsing prose combat logs.
 */
export const ENCOUNTER_HISTORY_SWITCH_KINDS = [
  'switch',
  'recall',
  'send-out',
] as const

export const ENCOUNTER_HISTORY_MOVE_OUTCOMES = [
  'no-target',
  'miss',
  'hit',
  'mixed',
] as const

export const ENCOUNTER_HISTORY_DAMAGE_CLASSES = [
  'physical',
  'special',
  'direct',
] as const

export const ENCOUNTER_HISTORY_LIMITS = Object.freeze({
  placementIndexes: 256,
  targetPlacements: 64,
  damageSourcesPerWindow: 512,
  switchesPerScene: 512,
  knockoutsPerScene: 512,
  lifecycleKnockoutsPerScene: 512,
  replacementsPerScene: 256,
  roundBoundariesPerScene: 128,
  moveAncestryPerScene: 512,
  moveUsesPerScene: 512,
  eventMoveLinksPerScene: 1_024,
  childMoves: 64,
  branchSelections: MOVE_HISTORY_METADATA_LIMITS.branchSelections,
  identifierChars: MOVE_HISTORY_METADATA_LIMITS.identifierChars,
  canonicalMoveChars: MOVE_HISTORY_METADATA_LIMITS.canonicalMoveChars,
  round: 1_000_000,
  turn: 1_000_000,
  hitIndex: 100,
  amount: Number.MAX_SAFE_INTEGER,
})

export type EncounterHistorySwitchKind =
  (typeof ENCOUNTER_HISTORY_SWITCH_KINDS)[number]
export type EncounterHistoryMoveOutcome =
  (typeof ENCOUNTER_HISTORY_MOVE_OUTCOMES)[number]
export type EncounterHistoryDamageClass =
  (typeof ENCOUNTER_HISTORY_DAMAGE_CLASSES)[number]

export interface EncounterHistoryTurn {
  readonly round: number
  /** Zero-based monotonic authoritative encounter turn sequence. */
  readonly turn: number
  readonly placementId: string
}

export interface EncounterHistoryMoveRecord {
  readonly eventId: string
  readonly sourceOperationId: string
  readonly resolutionId: string
  readonly canonicalId: string
  /** Null only for a legacy MA-063 record whose provenance predates MA-158. */
  readonly specVersion: number | null
  readonly actorPlacementId: string
  /** Null only for a legacy MA-063 record. New authoritative events require it. */
  readonly actionType: EncounterActionType | null
  readonly origin: MoveHistoryOrigin | null
  readonly moveListSource: MoveHistoryMoveListSource | null
}

export interface EncounterDeclaredMoveHistory extends EncounterHistoryMoveRecord {
  readonly targetPlacementIds: readonly string[]
}

export interface EncounterCompletedMoveHistory extends EncounterHistoryMoveRecord {
  readonly attackedTargetIds: readonly string[]
  readonly hitTargetIds: readonly string[]
  readonly outcome: EncounterHistoryMoveOutcome
  /** Null only when a legacy MA-063 row did not retain semantic success. */
  readonly succeeded: boolean | null
  /** Null only when a legacy MA-063 row did not retain branch evidence. */
  readonly branches: readonly MoveHistoryBranchSelection[] | null
}

export interface EncounterMoveUseDeclaration {
  readonly eventId: string
  readonly sourceOperationId: string
  /** Authoritative encounter round, null outside initiative or in migrated history. */
  readonly round?: number | null
  /** One-based scene-local authoritative declaration order. */
  readonly order: number
  readonly targetPlacementIds: readonly string[]
}

export interface EncounterMoveUseCompletion {
  readonly eventId: string
  readonly sourceOperationId: string
  /** Authoritative encounter round, null outside initiative or in migrated history. */
  readonly round?: number | null
  /** One-based scene-local authoritative completion order. */
  readonly order: number
  readonly attackedTargetIds: readonly string[]
  readonly hitTargetIds: readonly string[]
  readonly outcome: EncounterHistoryMoveOutcome
  readonly succeeded: boolean
  readonly branches: readonly MoveHistoryBranchSelection[]
}

/**
 * One scene-local move resolution. Independent declaration/completion order
 * values preserve exact event order when a parent resumes after a child.
 */
export interface EncounterMoveUseHistory extends MoveHistoryIdentity {
  readonly declaration: EncounterMoveUseDeclaration | null
  readonly completion: EncounterMoveUseCompletion | null
}

export interface EncounterDamagingMoveHistory extends EncounterHistoryMoveRecord {
  readonly round?: number | null
  readonly targetPlacementId: string
  readonly hitIndex: number
  readonly hitPointLoss: number
  readonly temporaryHitPointLoss: number
  readonly damageClass: EncounterHistoryDamageClass
  readonly moveType: string | null
}

/** Aggregate actual loss from one move resolution to one recipient in a window. */
export interface EncounterDamageBySourceHistory {
  readonly resolutionId: string
  readonly canonicalId: string
  readonly sourcePlacementId: string
  readonly targetPlacementId: string
  readonly hitPointLoss: number
  readonly temporaryHitPointLoss: number
}

export interface EncounterConsecutiveMoveHistory {
  readonly placementId: string
  readonly canonicalId: string
  /** Null only for a legacy MA-063 row that did not retain target identity. */
  readonly targetPlacementId: string | null
  readonly count: number
  readonly lastResolutionId: string
}

/** Recall/send-out use null for the side of the transition they do not contain. */
export interface EncounterSwitchHistory {
  readonly eventId: string
  readonly sourceOperationId: string
  readonly kind: EncounterHistorySwitchKind
  readonly recalledPlacementId: string | null
  readonly sentOutPlacementId: string | null
  readonly sideId: string | null
  readonly round: number | null
  /** Typed server-authored Feature provider, normalized to null for legacy rows. */
  readonly causalProviderId: string | null
}

/** One exact send-out that replaced a knocked-out placement on the same side. */
export interface EncounterKnockoutReplacementHistory {
  readonly replacementEventId: string
  readonly sourceOperationId: string
  readonly knockoutEventId: string
  readonly knockedOutPlacementId: string
  readonly replacementPlacementId: string
  readonly sideId: string
  readonly sentOutRound: number | null
  readonly firstTurnEventId: string | null
  readonly firstActingRound: number | null
  readonly firstActingTurn: number | null
}

export interface EncounterRoundBoundaryHistory {
  readonly eventId: string
  readonly sourceOperationId: string
  readonly completedRound: number
  readonly nextRound: number | null
  readonly nextRoundEventId: string | null
}

export interface EncounterKnockoutHistory extends EncounterHistoryMoveRecord {
  readonly round?: number | null
  readonly targetPlacementId: string
  readonly hitIndex: number | null
}

/** Non-Move knockout evidence emitted after one authoritative lifecycle HP reduction. */
export interface EncounterLifecycleKnockoutHistory {
  readonly eventId: string
  readonly sourceOperationId: string
  readonly sourceEffectOperationId: string
  readonly round: number | null
  readonly targetPlacementId: string
  readonly cause: EncounterEventLifecycleKoCause
}

export interface EncounterMoveAncestryHistory {
  readonly resolutionId: string
  readonly parentResolutionId: string | null
  readonly childResolutionIds: readonly string[]
}

/** Recent event-to-resolution links let later causal children recover ancestry. */
export interface EncounterEventMoveLink {
  readonly eventId: string
  readonly resolutionId: string
}

export interface EncounterHistory {
  /** Null outside a currently identified scene. */
  readonly sceneId: string | null
  /** Current authoritative round window; null before initiative starts. */
  readonly currentRound: number | null
  /** Current/most recently opened turn window; null before one starts. */
  readonly currentTurn: EncounterHistoryTurn | null
  readonly lastDeclaredMoves: readonly EncounterDeclaredMoveHistory[]
  readonly lastCompletedMoves: readonly EncounterCompletedMoveHistory[]
  readonly lastDamagingMovesReceived: readonly EncounterDamagingMoveHistory[]
  readonly damageBySourceThisTurn: readonly EncounterDamageBySourceHistory[]
  readonly damageBySourceThisRound: readonly EncounterDamageBySourceHistory[]
  readonly actedThisTurnPlacementIds: readonly string[]
  readonly actedThisRoundPlacementIds: readonly string[]
  readonly consecutiveMoves: readonly EncounterConsecutiveMoveHistory[]
  readonly switchedPlacementIds: readonly string[]
  readonly faintedPlacementIds: readonly string[]
  readonly switches: readonly EncounterSwitchHistory[]
  readonly knockouts: readonly EncounterKnockoutHistory[]
  readonly lifecycleKnockouts: readonly EncounterLifecycleKnockoutHistory[]
  readonly knockoutReplacements: readonly EncounterKnockoutReplacementHistory[]
  readonly roundBoundaries: readonly EncounterRoundBoundaryHistory[]
  readonly moveAncestry: readonly EncounterMoveAncestryHistory[]
  readonly moveUses: readonly EncounterMoveUseHistory[]
  readonly eventMoveLinks: readonly EncounterEventMoveLink[]
}

export type EncounterHistoryValidationCode =
  | 'invalid-encounter-history'
  | 'limit-exceeded'
  | 'duplicate-id'

export class EncounterHistoryValidationError extends Error {
  readonly code: EncounterHistoryValidationCode
  readonly path: string
  readonly detail: string

  constructor(
    code: EncounterHistoryValidationCode,
    path: string,
    detail: string,
  ) {
    super(`${path}: ${detail}`)
    this.name = 'EncounterHistoryValidationError'
    this.code = code
    this.path = path
    this.detail = detail
  }
}

type UnknownRecord = Record<string, unknown>

const LEGACY_HISTORY_FIELDS = [
  'sceneId',
  'currentRound',
  'currentTurn',
  'lastDeclaredMoves',
  'lastCompletedMoves',
  'lastDamagingMovesReceived',
  'damageBySourceThisTurn',
  'damageBySourceThisRound',
  'actedThisTurnPlacementIds',
  'actedThisRoundPlacementIds',
  'consecutiveMoves',
  'switchedPlacementIds',
  'faintedPlacementIds',
  'switches',
  'knockouts',
  'moveAncestry',
  'eventMoveLinks',
] as const
const PRE_LIFECYCLE_KO_HISTORY_FIELDS = [...LEGACY_HISTORY_FIELDS, 'moveUses'] as const
const PRE_REPLACEMENT_HISTORY_FIELDS = [...PRE_LIFECYCLE_KO_HISTORY_FIELDS, 'lifecycleKnockouts'] as const
const PRE_ROUND_BOUNDARY_HISTORY_FIELDS = [...PRE_REPLACEMENT_HISTORY_FIELDS, 'knockoutReplacements'] as const
const HISTORY_FIELDS = [...PRE_ROUND_BOUNDARY_HISTORY_FIELDS, 'roundBoundaries'] as const
const TURN_FIELDS = ['round', 'turn', 'placementId'] as const
const LEGACY_MOVE_FIELDS = [
  'eventId',
  'sourceOperationId',
  'resolutionId',
  'canonicalId',
  'actorPlacementId',
] as const
const MOVE_METADATA_FIELDS = [
  'specVersion',
  'actionType',
  'origin',
  'moveListSource',
] as const
const MOVE_FIELDS = [...LEGACY_MOVE_FIELDS, ...MOVE_METADATA_FIELDS] as const
const LEGACY_DECLARED_MOVE_FIELDS = [...LEGACY_MOVE_FIELDS, 'targetPlacementIds'] as const
const DECLARED_MOVE_FIELDS = [...MOVE_FIELDS, 'targetPlacementIds'] as const
const LEGACY_COMPLETED_MOVE_FIELDS = [
  ...LEGACY_MOVE_FIELDS,
  'attackedTargetIds',
  'hitTargetIds',
  'outcome',
] as const
const COMPLETED_MOVE_FIELDS = [
  ...MOVE_FIELDS,
  'attackedTargetIds',
  'hitTargetIds',
  'outcome',
  'succeeded',
  'branches',
] as const
const LEGACY_DAMAGING_MOVE_FIELDS = [
  ...LEGACY_MOVE_FIELDS,
  'targetPlacementId',
  'hitIndex',
  'hitPointLoss',
  'temporaryHitPointLoss',
  'damageClass',
  'moveType',
] as const
const DAMAGING_MOVE_FIELDS = [
  ...MOVE_FIELDS,
  'targetPlacementId',
  'hitIndex',
  'hitPointLoss',
  'temporaryHitPointLoss',
  'damageClass',
  'moveType',
] as const
const DAMAGE_SOURCE_FIELDS = [
  'resolutionId',
  'canonicalId',
  'sourcePlacementId',
  'targetPlacementId',
  'hitPointLoss',
  'temporaryHitPointLoss',
] as const
const LEGACY_CONSECUTIVE_MOVE_FIELDS = [
  'placementId',
  'canonicalId',
  'count',
  'lastResolutionId',
] as const
const CONSECUTIVE_MOVE_FIELDS = [
  'placementId',
  'canonicalId',
  'targetPlacementId',
  'count',
  'lastResolutionId',
] as const
const LEGACY_SWITCH_FIELDS = [
  'eventId',
  'sourceOperationId',
  'kind',
  'recalledPlacementId',
  'sentOutPlacementId',
] as const
const PROVIDER_SWITCH_FIELDS = [...LEGACY_SWITCH_FIELDS, 'causalProviderId'] as const
const SWITCH_FIELDS = [...PROVIDER_SWITCH_FIELDS, 'sideId', 'round'] as const
const LEGACY_KNOCKOUT_FIELDS = [
  ...LEGACY_MOVE_FIELDS,
  'targetPlacementId',
  'hitIndex',
] as const
const KNOCKOUT_FIELDS = [...MOVE_FIELDS, 'targetPlacementId', 'hitIndex'] as const
const KNOCKOUT_REPLACEMENT_FIELDS = [
  'replacementEventId',
  'sourceOperationId',
  'knockoutEventId',
  'knockedOutPlacementId',
  'replacementPlacementId',
  'sideId',
  'sentOutRound',
  'firstTurnEventId',
  'firstActingRound',
  'firstActingTurn',
] as const
const ROUND_BOUNDARY_FIELDS = ['eventId', 'sourceOperationId', 'completedRound', 'nextRound', 'nextRoundEventId'] as const
const LIFECYCLE_KNOCKOUT_FIELDS = [
  'eventId',
  'sourceOperationId',
  'sourceEffectOperationId',
  'round',
  'targetPlacementId',
  'cause',
] as const
const MOVE_USE_FIELDS = [
  'resolutionId',
  'canonicalId',
  'specVersion',
  'actorPlacementId',
  'actionType',
  'origin',
  'moveListSource',
  'declaration',
  'completion',
] as const
const MOVE_USE_DECLARATION_FIELDS = [
  'eventId',
  'sourceOperationId',
  'order',
  'targetPlacementIds',
] as const
const MOVE_USE_COMPLETION_FIELDS = [
  'eventId',
  'sourceOperationId',
  'order',
  'attackedTargetIds',
  'hitTargetIds',
  'outcome',
  'succeeded',
  'branches',
] as const
const ANCESTRY_FIELDS = [
  'resolutionId',
  'parentResolutionId',
  'childResolutionIds',
] as const
const EVENT_MOVE_LINK_FIELDS = ['eventId', 'resolutionId'] as const

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const LIVE_PLAY_OPERATION_ID_PATTERN = /^op_[A-Za-z0-9_-]{8,96}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const SWITCH_KIND_SET = new Set<string>(ENCOUNTER_HISTORY_SWITCH_KINDS)
const MOVE_OUTCOME_SET = new Set<string>(ENCOUNTER_HISTORY_MOVE_OUTCOMES)
const LIFECYCLE_KNOCKOUT_CAUSE_SET = new Set<string>(['damage-over-time', 'other'])
const DAMAGE_CLASS_SET = new Set<string>(ENCOUNTER_HISTORY_DAMAGE_CLASSES)

const fail = (
  code: EncounterHistoryValidationCode,
  path: string,
  detail: string,
): never => {
  throw new EncounterHistoryValidationError(code, path, detail)
}

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const parseRecord = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainRecord(value)) {
    return fail('invalid-encounter-history', path, 'must be a plain object.')
  }
  return value
}

const assertExactFields = (
  record: UnknownRecord,
  fields: readonly string[],
  path: string,
): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(record, field))
  const unknown = Object.keys(record).filter(field => !expected.has(field))
  if (missing.length === 0 && unknown.length === 0) return

  const details = [
    missing.length > 0 ? `missing ${missing.join(', ')}` : '',
    unknown.length > 0 ? `unknown ${unknown.join(', ')}` : '',
  ].filter(Boolean).join('; ')
  fail(
    'invalid-encounter-history',
    path,
    `must contain exactly the supported fields (${details}).`,
  )
}

const parseExactRecord = (
  value: unknown,
  fields: readonly string[],
  path: string,
): UnknownRecord => {
  const record = parseRecord(value, path)
  assertExactFields(record, fields, path)
  return record
}

const parseRecordWithOptionalRound = (
  value: unknown,
  fields: readonly string[],
  path: string,
): UnknownRecord => {
  const record = parseRecord(value, path)
  const expected = new Set([...fields, 'round'])
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(record, field))
  const unknown = Object.keys(record).filter(field => !expected.has(field))
  if (missing.length > 0 || unknown.length > 0) {
    fail(
      'invalid-encounter-history',
      path,
      `must contain the supported fields${missing.length ? `; missing ${missing.join(', ')}` : ''}${unknown.length ? `; unknown ${unknown.join(', ')}` : ''}.`,
    )
  }
  return record
}

const hasExactFields = (
  record: UnknownRecord,
  fields: readonly string[],
): boolean => {
  const expected = new Set(fields)
  return Object.keys(record).length === fields.length
    && fields.every(field => Object.prototype.hasOwnProperty.call(record, field))
    && Object.keys(record).every(field => expected.has(field))
}

const parseCurrentOrLegacyRecord = (
  value: unknown,
  currentFields: readonly string[],
  legacyFields: readonly string[],
  path: string,
): { readonly record: UnknownRecord; readonly legacy: boolean } => {
  const record = parseRecord(value, path)
  if (hasExactFields(record, currentFields)) return { record, legacy: false }
  if (hasExactFields(record, legacyFields)) return { record, legacy: true }
  assertExactFields(record, currentFields, path)
  return { record, legacy: false }
}

const parseCurrentOrLegacyRecordWithOptionalRound = (
  value: unknown,
  currentFields: readonly string[],
  legacyFields: readonly string[],
  path: string,
): { readonly record: UnknownRecord; readonly legacy: boolean } => {
  const record = parseRecord(value, path)
  const withoutRound = Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== 'round'),
  )
  if (hasExactFields(withoutRound, currentFields)) return { record, legacy: false }
  if (hasExactFields(withoutRound, legacyFields)) return { record, legacy: true }
  assertExactFields(withoutRound, currentFields, path)
  return { record, legacy: false }
}

const translateMetadataError = (error: unknown): never => {
  if (error instanceof MoveHistoryMetadataValidationError) {
    fail(
      error.code === 'limit-exceeded'
        ? 'limit-exceeded'
        : error.code === 'duplicate-id'
          ? 'duplicate-id'
          : 'invalid-encounter-history',
      error.path,
      error.detail,
    )
  }
  throw error
}

const parseArray = (
  value: unknown,
  path: string,
  maximum: number,
): readonly unknown[] => {
  if (!Array.isArray(value)) {
    return fail('invalid-encounter-history', path, 'must be an array.')
  }
  if (value.length > maximum) {
    fail('limit-exceeded', path, `must contain at most ${maximum} entries.`)
  }
  return value
}

const parseBoundedText = (
  value: unknown,
  path: string,
  maximum = ENCOUNTER_HISTORY_LIMITS.identifierChars,
): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return fail(
      'invalid-encounter-history',
      path,
      'must be a non-empty, trimmed string without control characters.',
    )
  }
  if (value.length > maximum) {
    fail('limit-exceeded', path, `must contain at most ${maximum} characters.`)
  }
  return value
}

const parseStableId = (value: unknown, path: string): string => {
  const id = parseBoundedText(value, path)
  if (!STABLE_ID_PATTERN.test(id)) {
    fail('invalid-encounter-history', path, 'must be a lowercase stable identifier.')
  }
  return id
}

const parseSourceOperationId = (value: unknown, path: string): string => {
  const id = parseBoundedText(value, path)
  if (!STABLE_ID_PATTERN.test(id) && !LIVE_PLAY_OPERATION_ID_PATTERN.test(id)) {
    fail('invalid-encounter-history', path, 'must be a stable identifier or live-play operation ID.')
  }
  return id
}

const parseNullableStableId = (value: unknown, path: string): string | null => (
  value === null ? null : parseStableId(value, path)
)

const parsePlacementId = (value: unknown, path: string): string => (
  parseBoundedText(value, path)
)

const parseNullablePlacementId = (value: unknown, path: string): string | null => (
  value === null ? null : parsePlacementId(value, path)
)

const parseNullableSideId = (value: unknown, path: string): string | null => (
  value === null ? null : parseStableId(value, path)
)

const parseInteger = (
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number => {
  if (!Number.isSafeInteger(value)) {
    return fail('invalid-encounter-history', path, 'must be a safe integer.')
  }
  const parsed = Number(value)
  if (parsed < minimum || parsed > maximum) {
    fail('limit-exceeded', path, `must be from ${minimum} through ${maximum}.`)
  }
  return parsed
}

const parseNullableInteger = (
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number | null => value === null
  ? null
  : parseInteger(value, path, minimum, maximum)

const parseEnum = <Value extends string>(
  value: unknown,
  values: ReadonlySet<string>,
  path: string,
  description: string,
): Value => {
  if (typeof value !== 'string' || !values.has(value)) {
    return fail('invalid-encounter-history', path, `must be ${description}.`)
  }
  return value as Value
}

const parseBoolean = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') {
    return fail('invalid-encounter-history', path, 'must be a boolean.')
  }
  return value
}

const parseBranches = (
  value: unknown,
  path: string,
): readonly MoveHistoryBranchSelection[] => {
  try {
    return parseMoveHistoryBranchSelections(value, path)
  }
  catch (error) {
    return translateMetadataError(error)
  }
}

const assertUnique = (
  values: readonly string[],
  path: string,
): void => {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) fail('duplicate-id', path, `must not duplicate ${value}.`)
    seen.add(value)
  }
}

const parsePlacementIds = (
  value: unknown,
  path: string,
  maximum: number = ENCOUNTER_HISTORY_LIMITS.placementIndexes,
): readonly string[] => {
  const ids = parseArray(value, path, maximum)
    .map((entry, index) => parsePlacementId(entry, `${path}[${index}]`))
  assertUnique(ids, path)
  return ids
}

const parseMoveIdentity = (
  record: UnknownRecord,
  path: string,
): MoveHistoryIdentity => {
  try {
    return parseMoveHistoryIdentity({
      resolutionId: record.resolutionId,
      canonicalId: record.canonicalId,
      specVersion: record.specVersion,
      actorPlacementId: record.actorPlacementId,
      actionType: record.actionType,
      origin: record.origin,
      moveListSource: record.moveListSource,
    }, path)
  }
  catch (error) {
    return translateMetadataError(error)
  }
}

const hasLegacyMoveMetadata = (record: UnknownRecord, legacyShape: boolean): boolean => (
  legacyShape || MOVE_METADATA_FIELDS.every(field => record[field] === null)
)

const parseMoveCommon = (
  record: UnknownRecord,
  path: string,
  legacy: boolean,
): EncounterHistoryMoveRecord => {
  const normalizedLegacy = hasLegacyMoveMetadata(record, legacy)
  const legacyIdentity = {
    resolutionId: parseStableId(record.resolutionId, `${path}.resolutionId`),
    canonicalId: parseBoundedText(
      record.canonicalId,
      `${path}.canonicalId`,
      ENCOUNTER_HISTORY_LIMITS.canonicalMoveChars,
    ),
    actorPlacementId: parsePlacementId(record.actorPlacementId, `${path}.actorPlacementId`),
  }
  const identity = normalizedLegacy ? null : parseMoveIdentity(record, path)
  return {
    eventId: parseStableId(record.eventId, `${path}.eventId`),
    sourceOperationId: parseSourceOperationId(record.sourceOperationId, `${path}.sourceOperationId`),
    resolutionId: identity?.resolutionId ?? legacyIdentity.resolutionId,
    canonicalId: identity?.canonicalId ?? legacyIdentity.canonicalId,
    specVersion: identity?.specVersion ?? null,
    actorPlacementId: identity?.actorPlacementId ?? legacyIdentity.actorPlacementId,
    actionType: identity?.actionType ?? null,
    origin: identity?.origin ?? null,
    moveListSource: identity?.moveListSource ?? null,
  }
}

const expectedMoveOutcome = (
  attackedTargetIds: readonly string[],
  hitTargetIds: readonly string[],
): EncounterHistoryMoveOutcome => {
  if (attackedTargetIds.length === 0) return 'no-target'
  if (hitTargetIds.length === 0) return 'miss'
  if (attackedTargetIds.length === hitTargetIds.length) return 'hit'
  return 'mixed'
}

const parseDeclaredMove = (
  value: unknown,
  path: string,
): EncounterDeclaredMoveHistory => {
  const { record, legacy } = parseCurrentOrLegacyRecord(
    value,
    DECLARED_MOVE_FIELDS,
    LEGACY_DECLARED_MOVE_FIELDS,
    path,
  )
  return {
    ...parseMoveCommon(record, path, legacy),
    targetPlacementIds: parsePlacementIds(
      record.targetPlacementIds,
      `${path}.targetPlacementIds`,
      ENCOUNTER_HISTORY_LIMITS.targetPlacements,
    ),
  }
}

const parseCompletedMove = (
  value: unknown,
  path: string,
): EncounterCompletedMoveHistory => {
  const { record, legacy } = parseCurrentOrLegacyRecord(
    value,
    COMPLETED_MOVE_FIELDS,
    LEGACY_COMPLETED_MOVE_FIELDS,
    path,
  )
  const attackedTargetIds = parsePlacementIds(
    record.attackedTargetIds,
    `${path}.attackedTargetIds`,
    ENCOUNTER_HISTORY_LIMITS.targetPlacements,
  )
  const hitTargetIds = parsePlacementIds(
    record.hitTargetIds,
    `${path}.hitTargetIds`,
    ENCOUNTER_HISTORY_LIMITS.targetPlacements,
  )
  const attacked = new Set(attackedTargetIds)
  const unknownHit = hitTargetIds.find(id => !attacked.has(id))
  if (unknownHit !== undefined) {
    fail(
      'invalid-encounter-history',
      `${path}.hitTargetIds`,
      `contains ${unknownHit}, which is not an attacked target.`,
    )
  }
  const outcome = parseEnum<EncounterHistoryMoveOutcome>(
    record.outcome,
    MOVE_OUTCOME_SET,
    `${path}.outcome`,
    'no-target, miss, hit, or mixed',
  )
  const expected = expectedMoveOutcome(attackedTargetIds, hitTargetIds)
  if (outcome !== expected) {
    fail('invalid-encounter-history', `${path}.outcome`, `must be ${expected} for these targets.`)
  }
  return {
    ...parseMoveCommon(record, path, legacy),
    attackedTargetIds,
    hitTargetIds,
    outcome,
    // MA-063 did not retain semantic success or branch decisions. Keep them
    // unknown rather than deriving mechanics from its coarser hit outcome.
    succeeded: hasLegacyMoveMetadata(record, legacy)
      ? null
      : parseBoolean(record.succeeded, `${path}.succeeded`),
    branches: hasLegacyMoveMetadata(record, legacy)
      ? null
      : parseBranches(record.branches, `${path}.branches`),
  }
}

const parseDamageAmounts = (
  record: UnknownRecord,
  path: string,
): Pick<EncounterDamagingMoveHistory, 'hitPointLoss' | 'temporaryHitPointLoss'> => {
  const hitPointLoss = parseInteger(
    record.hitPointLoss,
    `${path}.hitPointLoss`,
    0,
    ENCOUNTER_HISTORY_LIMITS.amount,
  )
  const temporaryHitPointLoss = parseInteger(
    record.temporaryHitPointLoss,
    `${path}.temporaryHitPointLoss`,
    0,
    ENCOUNTER_HISTORY_LIMITS.amount,
  )
  if (hitPointLoss === 0 && temporaryHitPointLoss === 0) {
    fail('invalid-encounter-history', path, 'must contain positive actual damage.')
  }
  return { hitPointLoss, temporaryHitPointLoss }
}

const parseDamagingMove = (
  value: unknown,
  path: string,
): EncounterDamagingMoveHistory => {
  const { record, legacy } = parseCurrentOrLegacyRecordWithOptionalRound(
    value,
    DAMAGING_MOVE_FIELDS,
    LEGACY_DAMAGING_MOVE_FIELDS,
    path,
  )
  return {
    ...parseMoveCommon(record, path, legacy),
    round: Object.prototype.hasOwnProperty.call(record, 'round')
      ? parseNullableInteger(record.round, `${path}.round`, 1, ENCOUNTER_HISTORY_LIMITS.round)
      : null,
    targetPlacementId: parsePlacementId(record.targetPlacementId, `${path}.targetPlacementId`),
    hitIndex: parseInteger(
      record.hitIndex,
      `${path}.hitIndex`,
      1,
      ENCOUNTER_HISTORY_LIMITS.hitIndex,
    ),
    ...parseDamageAmounts(record, path),
    damageClass: parseEnum<EncounterHistoryDamageClass>(
      record.damageClass,
      DAMAGE_CLASS_SET,
      `${path}.damageClass`,
      'physical, special, or direct',
    ),
    moveType: record.moveType === null
      ? null
      : parseStableId(record.moveType, `${path}.moveType`),
  }
}

const parseDamageSource = (
  value: unknown,
  path: string,
): EncounterDamageBySourceHistory => {
  const record = parseExactRecord(value, DAMAGE_SOURCE_FIELDS, path)
  return {
    resolutionId: parseStableId(record.resolutionId, `${path}.resolutionId`),
    canonicalId: parseBoundedText(
      record.canonicalId,
      `${path}.canonicalId`,
      ENCOUNTER_HISTORY_LIMITS.canonicalMoveChars,
    ),
    sourcePlacementId: parsePlacementId(record.sourcePlacementId, `${path}.sourcePlacementId`),
    targetPlacementId: parsePlacementId(record.targetPlacementId, `${path}.targetPlacementId`),
    ...parseDamageAmounts(record, path),
  }
}

const parseConsecutiveMove = (
  value: unknown,
  path: string,
): EncounterConsecutiveMoveHistory => {
  const { record, legacy } = parseCurrentOrLegacyRecord(
    value,
    CONSECUTIVE_MOVE_FIELDS,
    LEGACY_CONSECUTIVE_MOVE_FIELDS,
    path,
  )
  return {
    placementId: parsePlacementId(record.placementId, `${path}.placementId`),
    canonicalId: parseBoundedText(
      record.canonicalId,
      `${path}.canonicalId`,
      ENCOUNTER_HISTORY_LIMITS.canonicalMoveChars,
    ),
    targetPlacementId: legacy
      ? null
      : parseNullablePlacementId(
          record.targetPlacementId,
          `${path}.targetPlacementId`,
        ),
    count: parseInteger(record.count, `${path}.count`, 1, ENCOUNTER_HISTORY_LIMITS.amount),
    lastResolutionId: parseStableId(record.lastResolutionId, `${path}.lastResolutionId`),
  }
}

const parseSwitch = (value: unknown, path: string): EncounterSwitchHistory => {
  const candidate = parseRecord(value, path)
  const hasCausalProvider = Object.prototype.hasOwnProperty.call(candidate, 'causalProviderId')
  const hasSideAndRound = Object.prototype.hasOwnProperty.call(candidate, 'sideId')
    || Object.prototype.hasOwnProperty.call(candidate, 'round')
  const record = parseExactRecord(value, hasSideAndRound ? SWITCH_FIELDS : hasCausalProvider ? PROVIDER_SWITCH_FIELDS : LEGACY_SWITCH_FIELDS, path)
  const kind = parseEnum<EncounterHistorySwitchKind>(
    record.kind,
    SWITCH_KIND_SET,
    `${path}.kind`,
    'switch, recall, or send-out',
  )
  const recalledPlacementId = parseNullablePlacementId(
    record.recalledPlacementId,
    `${path}.recalledPlacementId`,
  )
  const sentOutPlacementId = parseNullablePlacementId(
    record.sentOutPlacementId,
    `${path}.sentOutPlacementId`,
  )
  if (
    (kind === 'switch' && (
      recalledPlacementId === null
      || sentOutPlacementId === null
      || recalledPlacementId === sentOutPlacementId
    ))
    || (kind === 'recall' && (recalledPlacementId === null || sentOutPlacementId !== null))
    || (kind === 'send-out' && (recalledPlacementId !== null || sentOutPlacementId === null))
  ) {
    fail('invalid-encounter-history', path, `placement identities do not match ${kind} semantics.`)
  }
  return {
    eventId: parseStableId(record.eventId, `${path}.eventId`),
    sourceOperationId: parseSourceOperationId(record.sourceOperationId, `${path}.sourceOperationId`),
    kind,
    recalledPlacementId,
    sentOutPlacementId,
    sideId: hasSideAndRound ? parseNullableSideId(record.sideId, `${path}.sideId`) : null,
    round: hasSideAndRound ? parseNullableInteger(record.round, `${path}.round`, 1, ENCOUNTER_HISTORY_LIMITS.round) : null,
    causalProviderId: hasCausalProvider && record.causalProviderId !== null
      ? parseBoundedText(record.causalProviderId, `${path}.causalProviderId`)
      : null,
  }
}

const parseKnockout = (value: unknown, path: string): EncounterKnockoutHistory => {
  const { record, legacy } = parseCurrentOrLegacyRecordWithOptionalRound(
    value,
    KNOCKOUT_FIELDS,
    LEGACY_KNOCKOUT_FIELDS,
    path,
  )
  return {
    ...parseMoveCommon(record, path, legacy),
    round: Object.prototype.hasOwnProperty.call(record, 'round')
      ? parseNullableInteger(record.round, `${path}.round`, 1, ENCOUNTER_HISTORY_LIMITS.round)
      : null,
    targetPlacementId: parsePlacementId(record.targetPlacementId, `${path}.targetPlacementId`),
    hitIndex: parseNullableInteger(
      record.hitIndex,
      `${path}.hitIndex`,
      1,
      ENCOUNTER_HISTORY_LIMITS.hitIndex,
    ),
  }
}

const parseRoundBoundary = (value: unknown, path: string): EncounterRoundBoundaryHistory => {
  const row = parseExactRecord(value, ROUND_BOUNDARY_FIELDS, path)
  const completedRound = parseInteger(row.completedRound, `${path}.completedRound`, 1, ENCOUNTER_HISTORY_LIMITS.round)
  const nextRound = parseNullableInteger(row.nextRound, `${path}.nextRound`, 1, ENCOUNTER_HISTORY_LIMITS.round)
  const nextRoundEventId = parseNullableStableId(row.nextRoundEventId, `${path}.nextRoundEventId`)
  if ((nextRound === null) !== (nextRoundEventId === null) || nextRound !== null && nextRound !== completedRound + 1) {
    fail('invalid-encounter-history', path, 'next-round identity must be absent or identify the next sequential round.')
  }
  return {
    eventId: parseStableId(row.eventId, `${path}.eventId`),
    sourceOperationId: parseSourceOperationId(row.sourceOperationId, `${path}.sourceOperationId`),
    completedRound,
    nextRound,
    nextRoundEventId,
  }
}

const parseLifecycleKnockout = (
  value: unknown,
  path: string,
): EncounterLifecycleKnockoutHistory => {
  const record = parseExactRecord(value, LIFECYCLE_KNOCKOUT_FIELDS, path)
  return {
    eventId: parseStableId(record.eventId, `${path}.eventId`),
    sourceOperationId: parseSourceOperationId(record.sourceOperationId, `${path}.sourceOperationId`),
    sourceEffectOperationId: parseStableId(record.sourceEffectOperationId, `${path}.sourceEffectOperationId`),
    round: parseNullableInteger(record.round, `${path}.round`, 1, ENCOUNTER_HISTORY_LIMITS.round),
    targetPlacementId: parsePlacementId(record.targetPlacementId, `${path}.targetPlacementId`),
    cause: parseEnum<EncounterEventLifecycleKoCause>(
      record.cause,
      LIFECYCLE_KNOCKOUT_CAUSE_SET,
      `${path}.cause`,
      'damage-over-time or other',
    ),
  }
}

const parseKnockoutReplacement = (
  value: unknown,
  path: string,
): EncounterKnockoutReplacementHistory => {
  const record = parseExactRecord(value, KNOCKOUT_REPLACEMENT_FIELDS, path)
  const firstTurnEventId = parseNullableStableId(record.firstTurnEventId, `${path}.firstTurnEventId`)
  const firstActingRound = parseNullableInteger(record.firstActingRound, `${path}.firstActingRound`, 1, ENCOUNTER_HISTORY_LIMITS.round)
  const firstActingTurn = parseNullableInteger(record.firstActingTurn, `${path}.firstActingTurn`, 0, ENCOUNTER_HISTORY_LIMITS.turn)
  if ((firstTurnEventId === null) !== (firstActingRound === null) || (firstTurnEventId === null) !== (firstActingTurn === null)) {
    fail('invalid-encounter-history', path, 'first-turn identity, round, and turn must be all null or all present.')
  }
  return {
    replacementEventId: parseStableId(record.replacementEventId, `${path}.replacementEventId`),
    sourceOperationId: parseSourceOperationId(record.sourceOperationId, `${path}.sourceOperationId`),
    knockoutEventId: parseStableId(record.knockoutEventId, `${path}.knockoutEventId`),
    knockedOutPlacementId: parsePlacementId(record.knockedOutPlacementId, `${path}.knockedOutPlacementId`),
    replacementPlacementId: parsePlacementId(record.replacementPlacementId, `${path}.replacementPlacementId`),
    sideId: parseStableId(record.sideId, `${path}.sideId`),
    sentOutRound: parseNullableInteger(record.sentOutRound, `${path}.sentOutRound`, 1, ENCOUNTER_HISTORY_LIMITS.round),
    firstTurnEventId,
    firstActingRound,
    firstActingTurn,
  }
}

const parseMoveUse = (
  value: unknown,
  path: string,
): EncounterMoveUseHistory => {
  const record = parseExactRecord(value, MOVE_USE_FIELDS, path)
  const identity = parseMoveIdentity(record, path)
  const declaration = record.declaration === null
    ? null
    : (() => {
        const declarationPath = `${path}.declaration`
        const input = parseRecordWithOptionalRound(
          record.declaration,
          MOVE_USE_DECLARATION_FIELDS,
          declarationPath,
        )
        return {
          eventId: parseStableId(input.eventId, `${declarationPath}.eventId`),
          sourceOperationId: parseSourceOperationId(
            input.sourceOperationId,
            `${declarationPath}.sourceOperationId`,
          ),
          round: Object.prototype.hasOwnProperty.call(input, 'round')
            ? parseNullableInteger(
                input.round,
                `${declarationPath}.round`,
                1,
                ENCOUNTER_HISTORY_LIMITS.round,
              )
            : null,
          order: parseInteger(
            input.order,
            `${declarationPath}.order`,
            1,
            ENCOUNTER_HISTORY_LIMITS.amount,
          ),
          targetPlacementIds: parsePlacementIds(
            input.targetPlacementIds,
            `${declarationPath}.targetPlacementIds`,
            ENCOUNTER_HISTORY_LIMITS.targetPlacements,
          ),
        }
      })()
  const completion = record.completion === null
    ? null
    : (() => {
        const completionPath = `${path}.completion`
        const input = parseRecordWithOptionalRound(
          record.completion,
          MOVE_USE_COMPLETION_FIELDS,
          completionPath,
        )
        const attackedTargetIds = parsePlacementIds(
          input.attackedTargetIds,
          `${completionPath}.attackedTargetIds`,
          ENCOUNTER_HISTORY_LIMITS.targetPlacements,
        )
        const hitTargetIds = parsePlacementIds(
          input.hitTargetIds,
          `${completionPath}.hitTargetIds`,
          ENCOUNTER_HISTORY_LIMITS.targetPlacements,
        )
        const attacked = new Set(attackedTargetIds)
        const unknownHit = hitTargetIds.find(id => !attacked.has(id))
        if (unknownHit !== undefined) {
          fail(
            'invalid-encounter-history',
            `${completionPath}.hitTargetIds`,
            `contains ${unknownHit}, which is not an attacked target.`,
          )
        }
        const outcome = parseEnum<EncounterHistoryMoveOutcome>(
          input.outcome,
          MOVE_OUTCOME_SET,
          `${completionPath}.outcome`,
          'no-target, miss, hit, or mixed',
        )
        const expected = expectedMoveOutcome(attackedTargetIds, hitTargetIds)
        if (outcome !== expected) {
          fail(
            'invalid-encounter-history',
            `${completionPath}.outcome`,
            `must be ${expected} for these targets.`,
          )
        }
        return {
          eventId: parseStableId(input.eventId, `${completionPath}.eventId`),
          sourceOperationId: parseSourceOperationId(
            input.sourceOperationId,
            `${completionPath}.sourceOperationId`,
          ),
          round: Object.prototype.hasOwnProperty.call(input, 'round')
            ? parseNullableInteger(
                input.round,
                `${completionPath}.round`,
                1,
                ENCOUNTER_HISTORY_LIMITS.round,
              )
            : null,
          order: parseInteger(
            input.order,
            `${completionPath}.order`,
            1,
            ENCOUNTER_HISTORY_LIMITS.amount,
          ),
          attackedTargetIds,
          hitTargetIds,
          outcome,
          succeeded: parseBoolean(input.succeeded, `${completionPath}.succeeded`),
          branches: parseBranches(input.branches, `${completionPath}.branches`),
        }
      })()
  return { ...identity, declaration, completion }
}

const parseMoveAncestry = (
  value: unknown,
  path: string,
): EncounterMoveAncestryHistory => {
  const record = parseExactRecord(value, ANCESTRY_FIELDS, path)
  const resolutionId = parseStableId(record.resolutionId, `${path}.resolutionId`)
  const parentResolutionId = parseNullableStableId(
    record.parentResolutionId,
    `${path}.parentResolutionId`,
  )
  const childResolutionIds = parseArray(
    record.childResolutionIds,
    `${path}.childResolutionIds`,
    ENCOUNTER_HISTORY_LIMITS.childMoves,
  ).map((entry, index) => parseStableId(entry, `${path}.childResolutionIds[${index}]`))
  assertUnique(childResolutionIds, `${path}.childResolutionIds`)
  if (parentResolutionId === resolutionId || childResolutionIds.includes(resolutionId)) {
    fail('invalid-encounter-history', path, 'a move resolution cannot be its own parent or child.')
  }
  return { resolutionId, parentResolutionId, childResolutionIds }
}

const completeIdentityFromRecord = (
  record: EncounterHistoryMoveRecord,
): MoveHistoryIdentity | null => {
  if (
    record.specVersion === null
    || record.actionType === null
    || record.origin === null
    || record.moveListSource === null
  ) return null
  return {
    resolutionId: record.resolutionId,
    canonicalId: record.canonicalId,
    specVersion: record.specVersion,
    actorPlacementId: record.actorPlacementId,
    actionType: record.actionType,
    origin: record.origin,
    moveListSource: record.moveListSource,
  }
}

const sameStrings = (left: readonly string[], right: readonly string[]): boolean => (
  left.length === right.length && left.every((value, index) => value === right[index])
)

const sameBranches = (
  left: readonly MoveHistoryBranchSelection[],
  right: readonly MoveHistoryBranchSelection[],
): boolean => left.length === right.length && left.every((branch, index) => {
  const candidate = right[index]
  return candidate !== undefined
    && candidate.selectionId === branch.selectionId
    && candidate.recipientId === branch.recipientId
    && candidate.branchId === branch.branchId
})

const parseEventMoveLink = (
  value: unknown,
  path: string,
): EncounterEventMoveLink => {
  const record = parseExactRecord(value, EVENT_MOVE_LINK_FIELDS, path)
  return {
    eventId: parseStableId(record.eventId, `${path}.eventId`),
    resolutionId: parseStableId(record.resolutionId, `${path}.resolutionId`),
  }
}

/** Return fresh arrays so maps and reducer snapshots never share history state. */
export const createEmptyEncounterHistory = (): EncounterHistory => ({
  sceneId: null,
  currentRound: null,
  currentTurn: null,
  lastDeclaredMoves: [],
  lastCompletedMoves: [],
  lastDamagingMovesReceived: [],
  damageBySourceThisTurn: [],
  damageBySourceThisRound: [],
  actedThisTurnPlacementIds: [],
  actedThisRoundPlacementIds: [],
  consecutiveMoves: [],
  switchedPlacementIds: [],
  faintedPlacementIds: [],
  switches: [],
  knockouts: [],
  lifecycleKnockouts: [],
  knockoutReplacements: [],
  roundBoundaries: [],
  moveAncestry: [],
  moveUses: [],
  eventMoveLinks: [],
})

/**
 * Parse and detach one canonical history index set.
 *
 * The empty object was the reserved MA-050 representation. It remains a
 * read-compatible legacy value and canonicalizes to the typed empty indexes.
 */
export const parseEncounterHistory = (
  value: unknown,
  path = 'encounterState.history',
): EncounterHistory => {
  const history = parseRecord(value, path)
  if (Object.keys(history).length === 0) return createEmptyEncounterHistory()
  const legacyShape = hasExactFields(history, LEGACY_HISTORY_FIELDS)
  const preLifecycleKoShape = hasExactFields(history, PRE_LIFECYCLE_KO_HISTORY_FIELDS)
  const preReplacementShape = hasExactFields(history, PRE_REPLACEMENT_HISTORY_FIELDS)
  const preRoundBoundaryShape = hasExactFields(history, PRE_ROUND_BOUNDARY_HISTORY_FIELDS)
  if (!legacyShape && !preLifecycleKoShape && !preReplacementShape && !preRoundBoundaryShape) assertExactFields(history, HISTORY_FIELDS, path)

  const currentRound = parseNullableInteger(
    history.currentRound,
    `${path}.currentRound`,
    1,
    ENCOUNTER_HISTORY_LIMITS.round,
  )
  const currentTurn = history.currentTurn === null
    ? null
    : (() => {
        const turn = parseExactRecord(history.currentTurn, TURN_FIELDS, `${path}.currentTurn`)
        const parsed: EncounterHistoryTurn = {
          round: parseInteger(
            turn.round,
            `${path}.currentTurn.round`,
            1,
            ENCOUNTER_HISTORY_LIMITS.round,
          ),
          turn: parseInteger(
            turn.turn,
            `${path}.currentTurn.turn`,
            0,
            ENCOUNTER_HISTORY_LIMITS.turn,
          ),
          placementId: parsePlacementId(
            turn.placementId,
            `${path}.currentTurn.placementId`,
          ),
        }
        if (currentRound !== parsed.round) {
          fail(
            'invalid-encounter-history',
            `${path}.currentTurn.round`,
            'must match currentRound.',
          )
        }
        return parsed
      })()

  const lastDeclaredMoves = parseArray(
    history.lastDeclaredMoves,
    `${path}.lastDeclaredMoves`,
    ENCOUNTER_HISTORY_LIMITS.placementIndexes,
  ).map((entry, index) => parseDeclaredMove(entry, `${path}.lastDeclaredMoves[${index}]`))
  const lastCompletedMoves = parseArray(
    history.lastCompletedMoves,
    `${path}.lastCompletedMoves`,
    ENCOUNTER_HISTORY_LIMITS.placementIndexes,
  ).map((entry, index) => parseCompletedMove(entry, `${path}.lastCompletedMoves[${index}]`))
  const lastDamagingMovesReceived = parseArray(
    history.lastDamagingMovesReceived,
    `${path}.lastDamagingMovesReceived`,
    ENCOUNTER_HISTORY_LIMITS.placementIndexes,
  ).map((entry, index) => parseDamagingMove(
    entry,
    `${path}.lastDamagingMovesReceived[${index}]`,
  ))
  const damageBySourceThisTurn = parseArray(
    history.damageBySourceThisTurn,
    `${path}.damageBySourceThisTurn`,
    ENCOUNTER_HISTORY_LIMITS.damageSourcesPerWindow,
  ).map((entry, index) => parseDamageSource(entry, `${path}.damageBySourceThisTurn[${index}]`))
  const damageBySourceThisRound = parseArray(
    history.damageBySourceThisRound,
    `${path}.damageBySourceThisRound`,
    ENCOUNTER_HISTORY_LIMITS.damageSourcesPerWindow,
  ).map((entry, index) => parseDamageSource(entry, `${path}.damageBySourceThisRound[${index}]`))
  const actedThisTurnPlacementIds = parsePlacementIds(
    history.actedThisTurnPlacementIds,
    `${path}.actedThisTurnPlacementIds`,
  )
  const actedThisRoundPlacementIds = parsePlacementIds(
    history.actedThisRoundPlacementIds,
    `${path}.actedThisRoundPlacementIds`,
  )
  const consecutiveMoves = parseArray(
    history.consecutiveMoves,
    `${path}.consecutiveMoves`,
    ENCOUNTER_HISTORY_LIMITS.placementIndexes,
  ).map((entry, index) => parseConsecutiveMove(entry, `${path}.consecutiveMoves[${index}]`))
  const switchedPlacementIds = parsePlacementIds(
    history.switchedPlacementIds,
    `${path}.switchedPlacementIds`,
  )
  const faintedPlacementIds = parsePlacementIds(
    history.faintedPlacementIds,
    `${path}.faintedPlacementIds`,
  )
  const switches = parseArray(
    history.switches,
    `${path}.switches`,
    ENCOUNTER_HISTORY_LIMITS.switchesPerScene,
  ).map((entry, index) => parseSwitch(entry, `${path}.switches[${index}]`))
  const knockouts = parseArray(
    history.knockouts,
    `${path}.knockouts`,
    ENCOUNTER_HISTORY_LIMITS.knockoutsPerScene,
  ).map((entry, index) => parseKnockout(entry, `${path}.knockouts[${index}]`))
  const lifecycleKnockouts = legacyShape || preLifecycleKoShape
    ? []
    : parseArray(
        history.lifecycleKnockouts,
        `${path}.lifecycleKnockouts`,
        ENCOUNTER_HISTORY_LIMITS.lifecycleKnockoutsPerScene,
      ).map((entry, index) => parseLifecycleKnockout(entry, `${path}.lifecycleKnockouts[${index}]`))
  const knockoutReplacements = legacyShape || preLifecycleKoShape || preReplacementShape
    ? []
    : parseArray(
        history.knockoutReplacements,
        `${path}.knockoutReplacements`,
        ENCOUNTER_HISTORY_LIMITS.replacementsPerScene,
      ).map((entry, index) => parseKnockoutReplacement(entry, `${path}.knockoutReplacements[${index}]`))
  const roundBoundaries = legacyShape || preLifecycleKoShape || preReplacementShape || preRoundBoundaryShape
    ? []
    : parseArray(
        history.roundBoundaries,
        `${path}.roundBoundaries`,
        ENCOUNTER_HISTORY_LIMITS.roundBoundariesPerScene,
      ).map((entry, index) => parseRoundBoundary(entry, `${path}.roundBoundaries[${index}]`))
  const moveAncestry = parseArray(
    history.moveAncestry,
    `${path}.moveAncestry`,
    ENCOUNTER_HISTORY_LIMITS.moveAncestryPerScene,
  ).map((entry, index) => parseMoveAncestry(entry, `${path}.moveAncestry[${index}]`))
  const moveUses = legacyShape
    ? []
    : parseArray(
        history.moveUses,
        `${path}.moveUses`,
        ENCOUNTER_HISTORY_LIMITS.moveUsesPerScene,
      ).map((entry, index) => parseMoveUse(entry, `${path}.moveUses[${index}]`))
  const eventMoveLinks = parseArray(
    history.eventMoveLinks,
    `${path}.eventMoveLinks`,
    ENCOUNTER_HISTORY_LIMITS.eventMoveLinksPerScene,
  ).map((entry, index) => parseEventMoveLink(entry, `${path}.eventMoveLinks[${index}]`))

  assertUnique(lastDeclaredMoves.map(entry => entry.actorPlacementId), `${path}.lastDeclaredMoves.actorPlacementId`)
  assertUnique(lastCompletedMoves.map(entry => entry.actorPlacementId), `${path}.lastCompletedMoves.actorPlacementId`)
  assertUnique(lastDamagingMovesReceived.map(entry => entry.targetPlacementId), `${path}.lastDamagingMovesReceived.targetPlacementId`)
  assertUnique(
    damageBySourceThisTurn.map(entry => `${entry.resolutionId}\u0000${entry.targetPlacementId}`),
    `${path}.damageBySourceThisTurn.source`,
  )
  assertUnique(
    damageBySourceThisRound.map(entry => `${entry.resolutionId}\u0000${entry.targetPlacementId}`),
    `${path}.damageBySourceThisRound.source`,
  )
  assertUnique(consecutiveMoves.map(entry => entry.placementId), `${path}.consecutiveMoves.placementId`)
  assertUnique(switches.map(entry => entry.eventId), `${path}.switches.eventId`)
  assertUnique(knockouts.map(entry => entry.eventId), `${path}.knockouts.eventId`)
  assertUnique(lifecycleKnockouts.map(entry => entry.eventId), `${path}.lifecycleKnockouts.eventId`)
  assertUnique(lifecycleKnockouts.map(entry => entry.sourceEffectOperationId), `${path}.lifecycleKnockouts.sourceEffectOperationId`)
  assertUnique(knockoutReplacements.map(entry => entry.replacementEventId), `${path}.knockoutReplacements.replacementEventId`)
  assertUnique(knockoutReplacements.map(entry => entry.knockoutEventId), `${path}.knockoutReplacements.knockoutEventId`)
  assertUnique(knockoutReplacements.map(entry => entry.replacementPlacementId), `${path}.knockoutReplacements.replacementPlacementId`)
  assertUnique(roundBoundaries.map(entry => entry.eventId), `${path}.roundBoundaries.eventId`)
  assertUnique(roundBoundaries.map(entry => entry.sourceOperationId), `${path}.roundBoundaries.sourceOperationId`)
  for (const replacement of knockoutReplacements) {
    const knockout = [...knockouts, ...lifecycleKnockouts].find(entry => entry.eventId === replacement.knockoutEventId)
    const switchEntry = switches.find(entry => entry.eventId === replacement.replacementEventId)
    if (!knockout || knockout.targetPlacementId !== replacement.knockedOutPlacementId) {
      fail('invalid-encounter-history', `${path}.knockoutReplacements`, `replacement ${replacement.replacementEventId} has no exact knockout target.`)
    }
    if (!switchEntry || switchEntry.sentOutPlacementId !== replacement.replacementPlacementId || switchEntry.sideId !== replacement.sideId) {
      fail('invalid-encounter-history', `${path}.knockoutReplacements`, `replacement ${replacement.replacementEventId} has no exact same-side send-out.`)
    }
    if (replacement.firstActingRound !== null && replacement.sentOutRound !== null && replacement.firstActingRound < replacement.sentOutRound) {
      fail('invalid-encounter-history', `${path}.knockoutReplacements`, `replacement ${replacement.replacementEventId} acts before its send-out round.`)
    }
  }
  assertUnique(moveAncestry.map(entry => entry.resolutionId), `${path}.moveAncestry.resolutionId`)
  assertUnique(moveUses.map(entry => entry.resolutionId), `${path}.moveUses.resolutionId`)
  const declarationOrders = moveUses.flatMap(use => (
    use.declaration ? [String(use.declaration.order)] : []
  ))
  const completionOrders = moveUses.flatMap(use => (
    use.completion ? [String(use.completion.order)] : []
  ))
  assertUnique(declarationOrders, `${path}.moveUses.declaration.order`)
  assertUnique(completionOrders, `${path}.moveUses.completion.order`)
  assertUnique(eventMoveLinks.map(entry => entry.eventId), `${path}.eventMoveLinks.eventId`)

  const ancestryById = new Map(moveAncestry.map(entry => [entry.resolutionId, entry]))
  for (const relation of moveAncestry) {
    for (const childId of relation.childResolutionIds) {
      const child = ancestryById.get(childId)
      if (child && child.parentResolutionId !== relation.resolutionId) {
        fail(
          'invalid-encounter-history',
          `${path}.moveAncestry`,
          `child ${childId} does not point back to parent ${relation.resolutionId}.`,
        )
      }
    }
    if (relation.parentResolutionId !== null) {
      const parent = ancestryById.get(relation.parentResolutionId)
      if (parent && !parent.childResolutionIds.includes(relation.resolutionId)) {
        fail(
          'invalid-encounter-history',
          `${path}.moveAncestry`,
          `parent ${parent.resolutionId} does not list child ${relation.resolutionId}.`,
        )
      }
    }
  }
  const moveUseById = new Map(moveUses.map(entry => [entry.resolutionId, entry]))
  for (const use of moveUses) {
    if (!ancestryById.has(use.resolutionId)) {
      fail(
        'invalid-encounter-history',
        `${path}.moveUses`,
        `resolution ${use.resolutionId} has no ancestry record.`,
      )
    }
    if (use.completion !== null && use.declaration === null) {
      fail(
        'invalid-encounter-history',
        `${path}.moveUses`,
        `resolution ${use.resolutionId} completed without a retained declaration.`,
      )
    }
  }
  const latestUseDeclarationByActor = new Map<string, EncounterMoveUseHistory>()
  const latestUseCompletionByActor = new Map<string, EncounterMoveUseHistory>()
  for (const use of [...moveUses].sort((left, right) => (
    (left.declaration?.order ?? 0) - (right.declaration?.order ?? 0)
  ))) {
    if (use.declaration) latestUseDeclarationByActor.set(use.actorPlacementId, use)
  }
  for (const use of [...moveUses].sort((left, right) => (
    (left.completion?.order ?? 0) - (right.completion?.order ?? 0)
  ))) {
    if (use.completion) latestUseCompletionByActor.set(use.actorPlacementId, use)
  }
  for (const [actorPlacementId, use] of latestUseDeclarationByActor) {
    if (!lastDeclaredMoves.some(entry => (
      entry.actorPlacementId === actorPlacementId && entry.resolutionId === use.resolutionId
    ))) {
      fail(
        'invalid-encounter-history',
        `${path}.lastDeclaredMoves`,
        `actor ${actorPlacementId} does not index its latest scene declaration.`,
      )
    }
  }
  for (const [actorPlacementId, use] of latestUseCompletionByActor) {
    if (!lastCompletedMoves.some(entry => (
      entry.actorPlacementId === actorPlacementId && entry.resolutionId === use.resolutionId
    ))) {
      fail(
        'invalid-encounter-history',
        `${path}.lastCompletedMoves`,
        `actor ${actorPlacementId} does not index its latest scene completion.`,
      )
    }
  }
  for (const entry of [
    ...lastDeclaredMoves,
    ...lastCompletedMoves,
    ...lastDamagingMovesReceived,
    ...knockouts,
  ]) {
    const use = moveUseById.get(entry.resolutionId)
    const identity = completeIdentityFromRecord(entry)
    if (use && (!identity || !moveHistoryIdentitiesEqual(identity, use))) {
      fail(
        'invalid-encounter-history',
        `${path}.moveUses`,
        `resolution ${entry.resolutionId} conflicts with a retained move index.`,
      )
    }
  }
  for (const entry of lastDeclaredMoves) {
    const use = moveUseById.get(entry.resolutionId)
    const declaration = use?.declaration
    if (use && (!declaration || (
      declaration.eventId !== entry.eventId
      || declaration.sourceOperationId !== entry.sourceOperationId
      || !sameStrings(declaration.targetPlacementIds, entry.targetPlacementIds)
    ))) {
      fail(
        'invalid-encounter-history',
        `${path}.lastDeclaredMoves`,
        `resolution ${entry.resolutionId} conflicts with its scene move-use declaration.`,
      )
    }
  }
  for (const entry of lastCompletedMoves) {
    const use = moveUseById.get(entry.resolutionId)
    const completion = use?.completion
    if (use && (!completion || (
      completion.eventId !== entry.eventId
      || completion.sourceOperationId !== entry.sourceOperationId
      || completion.outcome !== entry.outcome
      || completion.succeeded !== entry.succeeded
      || !sameStrings(completion.attackedTargetIds, entry.attackedTargetIds)
      || !sameStrings(completion.hitTargetIds, entry.hitTargetIds)
      || entry.branches === null
      || !sameBranches(completion.branches, entry.branches)
    ))) {
      fail(
        'invalid-encounter-history',
        `${path}.lastCompletedMoves`,
        `resolution ${entry.resolutionId} conflicts with its scene move-use completion.`,
      )
    }
  }
  for (const link of eventMoveLinks) {
    if (!ancestryById.has(link.resolutionId)) {
      fail(
        'invalid-encounter-history',
        `${path}.eventMoveLinks`,
        `event ${link.eventId} references unknown resolution ${link.resolutionId}.`,
      )
    }
  }

  return {
    sceneId: parseNullableStableId(history.sceneId, `${path}.sceneId`),
    currentRound,
    currentTurn,
    lastDeclaredMoves,
    lastCompletedMoves,
    lastDamagingMovesReceived,
    damageBySourceThisTurn,
    damageBySourceThisRound,
    actedThisTurnPlacementIds,
    actedThisRoundPlacementIds,
    consecutiveMoves,
    switchedPlacementIds,
    faintedPlacementIds,
    switches,
    knockouts,
    lifecycleKnockouts,
    knockoutReplacements,
    roundBoundaries,
    moveAncestry,
    moveUses,
    eventMoveLinks,
  }
}
