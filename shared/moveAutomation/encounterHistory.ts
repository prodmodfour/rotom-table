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
  moveAncestryPerScene: 512,
  eventMoveLinksPerScene: 1_024,
  childMoves: 64,
  identifierChars: 160,
  canonicalMoveChars: 160,
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
  readonly actorPlacementId: string
}

export interface EncounterDeclaredMoveHistory extends EncounterHistoryMoveRecord {
  readonly targetPlacementIds: readonly string[]
}

export interface EncounterCompletedMoveHistory extends EncounterHistoryMoveRecord {
  readonly attackedTargetIds: readonly string[]
  readonly hitTargetIds: readonly string[]
  readonly outcome: EncounterHistoryMoveOutcome
}

export interface EncounterDamagingMoveHistory extends EncounterHistoryMoveRecord {
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
}

export interface EncounterKnockoutHistory extends EncounterHistoryMoveRecord {
  readonly targetPlacementId: string
  readonly hitIndex: number | null
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
  readonly moveAncestry: readonly EncounterMoveAncestryHistory[]
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

const HISTORY_FIELDS = [
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
const TURN_FIELDS = ['round', 'turn', 'placementId'] as const
const MOVE_FIELDS = [
  'eventId',
  'sourceOperationId',
  'resolutionId',
  'canonicalId',
  'actorPlacementId',
] as const
const DECLARED_MOVE_FIELDS = [...MOVE_FIELDS, 'targetPlacementIds'] as const
const COMPLETED_MOVE_FIELDS = [
  ...MOVE_FIELDS,
  'attackedTargetIds',
  'hitTargetIds',
  'outcome',
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
const CONSECUTIVE_MOVE_FIELDS = [
  'placementId',
  'canonicalId',
  'count',
  'lastResolutionId',
] as const
const SWITCH_FIELDS = [
  'eventId',
  'sourceOperationId',
  'kind',
  'recalledPlacementId',
  'sentOutPlacementId',
] as const
const KNOCKOUT_FIELDS = [...MOVE_FIELDS, 'targetPlacementId', 'hitIndex'] as const
const ANCESTRY_FIELDS = [
  'resolutionId',
  'parentResolutionId',
  'childResolutionIds',
] as const
const EVENT_MOVE_LINK_FIELDS = ['eventId', 'resolutionId'] as const

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const SWITCH_KIND_SET = new Set<string>(ENCOUNTER_HISTORY_SWITCH_KINDS)
const MOVE_OUTCOME_SET = new Set<string>(ENCOUNTER_HISTORY_MOVE_OUTCOMES)
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

const parseNullableStableId = (value: unknown, path: string): string | null => (
  value === null ? null : parseStableId(value, path)
)

const parsePlacementId = (value: unknown, path: string): string => (
  parseBoundedText(value, path)
)

const parseNullablePlacementId = (value: unknown, path: string): string | null => (
  value === null ? null : parsePlacementId(value, path)
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

const parseMoveCommon = (
  record: UnknownRecord,
  path: string,
): EncounterHistoryMoveRecord => ({
  eventId: parseStableId(record.eventId, `${path}.eventId`),
  sourceOperationId: parseStableId(record.sourceOperationId, `${path}.sourceOperationId`),
  resolutionId: parseStableId(record.resolutionId, `${path}.resolutionId`),
  canonicalId: parseBoundedText(
    record.canonicalId,
    `${path}.canonicalId`,
    ENCOUNTER_HISTORY_LIMITS.canonicalMoveChars,
  ),
  actorPlacementId: parsePlacementId(record.actorPlacementId, `${path}.actorPlacementId`),
})

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
  const record = parseExactRecord(value, DECLARED_MOVE_FIELDS, path)
  return {
    ...parseMoveCommon(record, path),
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
  const record = parseExactRecord(value, COMPLETED_MOVE_FIELDS, path)
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
    ...parseMoveCommon(record, path),
    attackedTargetIds,
    hitTargetIds,
    outcome,
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
  const record = parseExactRecord(value, DAMAGING_MOVE_FIELDS, path)
  return {
    ...parseMoveCommon(record, path),
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
  const record = parseExactRecord(value, CONSECUTIVE_MOVE_FIELDS, path)
  return {
    placementId: parsePlacementId(record.placementId, `${path}.placementId`),
    canonicalId: parseBoundedText(
      record.canonicalId,
      `${path}.canonicalId`,
      ENCOUNTER_HISTORY_LIMITS.canonicalMoveChars,
    ),
    count: parseInteger(record.count, `${path}.count`, 1, ENCOUNTER_HISTORY_LIMITS.amount),
    lastResolutionId: parseStableId(record.lastResolutionId, `${path}.lastResolutionId`),
  }
}

const parseSwitch = (value: unknown, path: string): EncounterSwitchHistory => {
  const record = parseExactRecord(value, SWITCH_FIELDS, path)
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
    sourceOperationId: parseStableId(record.sourceOperationId, `${path}.sourceOperationId`),
    kind,
    recalledPlacementId,
    sentOutPlacementId,
  }
}

const parseKnockout = (value: unknown, path: string): EncounterKnockoutHistory => {
  const record = parseExactRecord(value, KNOCKOUT_FIELDS, path)
  return {
    ...parseMoveCommon(record, path),
    targetPlacementId: parsePlacementId(record.targetPlacementId, `${path}.targetPlacementId`),
    hitIndex: parseNullableInteger(
      record.hitIndex,
      `${path}.hitIndex`,
      1,
      ENCOUNTER_HISTORY_LIMITS.hitIndex,
    ),
  }
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
  moveAncestry: [],
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
  assertExactFields(history, HISTORY_FIELDS, path)

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
  const moveAncestry = parseArray(
    history.moveAncestry,
    `${path}.moveAncestry`,
    ENCOUNTER_HISTORY_LIMITS.moveAncestryPerScene,
  ).map((entry, index) => parseMoveAncestry(entry, `${path}.moveAncestry[${index}]`))
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
  assertUnique(moveAncestry.map(entry => entry.resolutionId), `${path}.moveAncestry.resolutionId`)
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
    moveAncestry,
    eventMoveLinks,
  }
}
