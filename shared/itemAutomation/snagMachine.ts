import { deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const SNAG_MACHINE_STATE_SCHEMA_VERSION = 1 as const
export const SNAG_MACHINE_LARGE_DAILY_LIMIT = 5 as const
export const SNAG_BALL_ATTACK_ROLL_PENALTY = -2 as const

export type SnagMachineVariant = 'portable' | 'large'
export type SnagMachineHistoryKind = 'converted' | 'thrown' | 'expired'

export interface SnagBallConversionV1 {
  readonly conversionId: string
  readonly variant: SnagMachineVariant
  /** Private exact machine identity: equipped whole item or stable inventory row. */
  readonly machineSourceInstanceId: string
  /** Private exact homogeneous Poké Ball inventory row. */
  readonly ballSourceInstanceId: string
  readonly ballCanonicalItemId: string
  readonly campaignDayIndex: number
  readonly declarationRound: number | null
  readonly readyRound: number | null
  readonly expiresAfterRound: number | null
  readonly approvedOperationId: string
  readonly gmLegalityNote: string | null
}

export interface SnagMachineHistoryEntryV1 {
  readonly historyId: string
  readonly kind: SnagMachineHistoryKind
  readonly conversionId: string
  readonly variant: SnagMachineVariant
  readonly machineSourceInstanceId: string
  readonly ballSourceInstanceId: string
  readonly ballCanonicalItemId: string
  readonly campaignDayIndex: number
  readonly encounterRound: number | null
  readonly operationId: string
}

export interface SnagMachineStateV1 {
  readonly schemaVersion: typeof SNAG_MACHINE_STATE_SCHEMA_VERSION
  readonly revision: number
  readonly conversions: readonly SnagBallConversionV1[]
  readonly history: readonly SnagMachineHistoryEntryV1[]
}

type UnknownRecord = Record<string, unknown>
const MAX_CONVERSIONS = 256
const MAX_HISTORY = 512
const CONVERSION_ID = /^snag-conversion:v1:[a-f0-9]{32}$/u
const HISTORY_ID = /^snag-history:v1:[a-f0-9]{32}$/u
const SOURCE_ID = /^(?:equipped-item:v1:[a-f0-9]{32}|item-instance:[^\u0000-\u001f\u007f]{1,220})$/u
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,199}$/u

const fail = (path: string, detail: string): never => { throw new Error(`${path}: ${detail}`) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail(path, 'must be a plain object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = [...fields].sort()
  const actual = Object.keys(value).sort()
  if (expected.length !== actual.length || expected.some((field, index) => field !== actual[index])) {
    fail(path, `must contain exactly ${fields.join(', ')}.`)
  }
}
const integer = (value: unknown, path: string): number => Number.isSafeInteger(value) && Number(value) >= 0
  ? Number(value) : fail(path, 'must be a safe non-negative integer.')
const nullableInteger = (value: unknown, path: string): number | null => value === null ? null : integer(value, path)
const text = (value: unknown, path: string, maximum = 200): string => {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(value)) fail(path, 'must be bounded non-empty trimmed text.')
  return value as string
}
const nullableText = (value: unknown, path: string, maximum = 500): string | null => value === null
  ? null : text(value, path, maximum)
const sourceId = (value: unknown, path: string): string => {
  const parsed = text(value, path, 240)
  if (!SOURCE_ID.test(parsed)) fail(path, 'must be a private exact equipment or inventory source identity.')
  return parsed
}
const operationId = (value: unknown, path: string): string => {
  const parsed = text(value, path)
  if (!OPERATION_ID.test(parsed)) fail(path, 'must be a stable operation identity.')
  return parsed
}
const variant = (value: unknown, path: string): SnagMachineVariant => value === 'portable' || value === 'large'
  ? value : fail(path, 'must be portable or large.')

const parseConversion = (value: unknown, path: string): SnagBallConversionV1 => {
  const row = record(value, path)
  exact(row, [
    'conversionId', 'variant', 'machineSourceInstanceId', 'ballSourceInstanceId',
    'ballCanonicalItemId', 'campaignDayIndex', 'declarationRound', 'readyRound',
    'expiresAfterRound', 'approvedOperationId', 'gmLegalityNote',
  ], path)
  const parsedVariant = variant(row.variant, `${path}.variant`)
  const conversionId = text(row.conversionId, `${path}.conversionId`)
  if (!CONVERSION_ID.test(conversionId)) fail(`${path}.conversionId`, 'is invalid.')
  const declarationRound = nullableInteger(row.declarationRound, `${path}.declarationRound`)
  const readyRound = nullableInteger(row.readyRound, `${path}.readyRound`)
  const expiresAfterRound = nullableInteger(row.expiresAfterRound, `${path}.expiresAfterRound`)
  if (parsedVariant === 'portable') {
    if (declarationRound === null || declarationRound < 1
      || readyRound !== declarationRound + 1 || expiresAfterRound !== readyRound) {
      fail(path, 'portable conversion must become active after one round and expire after that round.')
    }
  }
  else if (declarationRound !== null || readyRound !== null || expiresAfterRound !== null) {
    fail(path, 'large-machine conversions must be permanent and round-independent.')
  }
  return {
    conversionId,
    variant: parsedVariant,
    machineSourceInstanceId: sourceId(row.machineSourceInstanceId, `${path}.machineSourceInstanceId`),
    ballSourceInstanceId: sourceId(row.ballSourceInstanceId, `${path}.ballSourceInstanceId`),
    ballCanonicalItemId: text(row.ballCanonicalItemId, `${path}.ballCanonicalItemId`),
    campaignDayIndex: integer(row.campaignDayIndex, `${path}.campaignDayIndex`),
    declarationRound,
    readyRound,
    expiresAfterRound,
    approvedOperationId: operationId(row.approvedOperationId, `${path}.approvedOperationId`),
    gmLegalityNote: nullableText(row.gmLegalityNote, `${path}.gmLegalityNote`),
  }
}

const parseHistory = (value: unknown, path: string): SnagMachineHistoryEntryV1 => {
  const row = record(value, path)
  exact(row, [
    'historyId', 'kind', 'conversionId', 'variant', 'machineSourceInstanceId',
    'ballSourceInstanceId', 'ballCanonicalItemId', 'campaignDayIndex', 'encounterRound', 'operationId',
  ], path)
  const historyId = text(row.historyId, `${path}.historyId`)
  if (!HISTORY_ID.test(historyId)) fail(`${path}.historyId`, 'is invalid.')
  if (row.kind !== 'converted' && row.kind !== 'thrown' && row.kind !== 'expired') {
    fail(`${path}.kind`, 'is invalid.')
  }
  const conversionId = text(row.conversionId, `${path}.conversionId`)
  if (!CONVERSION_ID.test(conversionId)) fail(`${path}.conversionId`, 'is invalid.')
  return {
    historyId,
    kind: row.kind as SnagMachineHistoryKind,
    conversionId,
    variant: variant(row.variant, `${path}.variant`),
    machineSourceInstanceId: sourceId(row.machineSourceInstanceId, `${path}.machineSourceInstanceId`),
    ballSourceInstanceId: sourceId(row.ballSourceInstanceId, `${path}.ballSourceInstanceId`),
    ballCanonicalItemId: text(row.ballCanonicalItemId, `${path}.ballCanonicalItemId`),
    campaignDayIndex: integer(row.campaignDayIndex, `${path}.campaignDayIndex`),
    encounterRound: nullableInteger(row.encounterRound, `${path}.encounterRound`),
    operationId: operationId(row.operationId, `${path}.operationId`),
  }
}

export const initialSnagMachineState = (): SnagMachineStateV1 => deepFreezeStrictJson({
  schemaVersion: 1,
  revision: 0,
  conversions: [],
  history: [],
})

export const parseSnagMachineState = (value: unknown): SnagMachineStateV1 => {
  if (value === undefined || value === null) return initialSnagMachineState()
  const root = record(value, 'snagMachineState')
  exact(root, ['schemaVersion', 'revision', 'conversions', 'history'], 'snagMachineState')
  if (root.schemaVersion !== 1) fail('snagMachineState.schemaVersion', 'is unsupported.')
  if (!Array.isArray(root.conversions) || root.conversions.length > MAX_CONVERSIONS) {
    fail('snagMachineState.conversions', 'must be a bounded array.')
  }
  if (!Array.isArray(root.history) || root.history.length > MAX_HISTORY) {
    fail('snagMachineState.history', 'must be a bounded array.')
  }
  const conversionRows = root.conversions as unknown[]
  const historyRows = root.history as unknown[]
  const conversions = conversionRows.map((entry, index) => parseConversion(entry, `snagMachineState.conversions[${index}]`))
  const history = historyRows.map((entry, index) => parseHistory(entry, `snagMachineState.history[${index}]`))
  if (new Set(conversions.map(entry => entry.conversionId)).size !== conversions.length
    || new Set(history.map(entry => entry.historyId)).size !== history.length) {
    fail('snagMachineState', 'contains duplicate identities.')
  }
  for (const conversion of conversions) {
    if (!history.some(entry => entry.kind === 'converted' && entry.conversionId === conversion.conversionId
      && entry.variant === conversion.variant && entry.machineSourceInstanceId === conversion.machineSourceInstanceId
      && entry.ballSourceInstanceId === conversion.ballSourceInstanceId)) {
      fail('snagMachineState.conversions', 'must retain matching conversion history.')
    }
  }
  return deepFreezeStrictJson({
    schemaVersion: 1,
    revision: integer(root.revision, 'snagMachineState.revision'),
    conversions,
    history,
  })
}

export const snagConvertedUnitsForBallRow = (
  state: SnagMachineStateV1,
  ballSourceInstanceId: string,
): number => state.conversions.filter(entry => entry.ballSourceInstanceId === ballSourceInstanceId).length

export const snagLargeMachineUsesOnCampaignDay = (input: {
  readonly state: SnagMachineStateV1
  readonly machineSourceInstanceId: string
  readonly campaignDayIndex: number
}): number => input.state.history.filter(entry => (
  entry.kind === 'converted'
  && entry.variant === 'large'
  && entry.machineSourceInstanceId === input.machineSourceInstanceId
  && entry.campaignDayIndex === input.campaignDayIndex
)).length

const boundedHistory = (
  history: readonly SnagMachineHistoryEntryV1[],
  activeConversions: readonly SnagBallConversionV1[],
): readonly SnagMachineHistoryEntryV1[] => {
  const activeIds = new Set(activeConversions.map(conversion => conversion.conversionId))
  const latestLargeDayByMachine = new Map<string, number>()
  for (const entry of history) {
    if (entry.kind !== 'converted' || entry.variant !== 'large') continue
    latestLargeDayByMachine.set(
      entry.machineSourceInstanceId,
      Math.max(latestLargeDayByMachine.get(entry.machineSourceInstanceId) ?? -1, entry.campaignDayIndex),
    )
  }
  // Conversion evidence for every still-reserved unit and the latest Large
  // machine/day quota is authority, not disposable audit decoration.
  const protectedIds = new Set(history.filter(entry => (
    (entry.kind === 'converted' && activeIds.has(entry.conversionId))
    || (entry.kind === 'converted' && entry.variant === 'large'
      && latestLargeDayByMachine.get(entry.machineSourceInstanceId) === entry.campaignDayIndex)
  )).map(entry => entry.historyId))
  if (protectedIds.size > MAX_HISTORY) {
    fail('snagMachineState.history', 'has too much active conversion or current daily-quota authority to retain safely.')
  }
  const disposableCapacity = MAX_HISTORY - protectedIds.size
  const disposable = history.filter(entry => !protectedIds.has(entry.historyId))
  const recentDisposableIds = new Set((disposableCapacity === 0 ? [] : disposable.slice(-disposableCapacity))
    .map(entry => entry.historyId))
  return history.filter(entry => protectedIds.has(entry.historyId) || recentDisposableIds.has(entry.historyId))
}

export const addSnagBallConversion = (input: {
  readonly state: SnagMachineStateV1
  readonly conversion: SnagBallConversionV1
  readonly historyId: string
}): SnagMachineStateV1 => {
  const conversions = [...input.state.conversions, input.conversion]
  const history = [...input.state.history, {
    historyId: input.historyId,
    kind: 'converted' as const,
    conversionId: input.conversion.conversionId,
    variant: input.conversion.variant,
    machineSourceInstanceId: input.conversion.machineSourceInstanceId,
    ballSourceInstanceId: input.conversion.ballSourceInstanceId,
    ballCanonicalItemId: input.conversion.ballCanonicalItemId,
    campaignDayIndex: input.conversion.campaignDayIndex,
    encounterRound: input.conversion.declarationRound,
    operationId: input.conversion.approvedOperationId,
  }]
  return parseSnagMachineState({
    schemaVersion: 1,
    revision: input.state.revision + 1,
    conversions,
    history: boundedHistory(history, conversions),
  })
}

export type ResolveSnagBallForThrowResult =
  | { readonly kind: 'ordinary', readonly state: SnagMachineStateV1 }
  | { readonly kind: 'blocked', readonly reason: 'portable-conversion-not-ready', readonly state: SnagMachineStateV1 }
  | { readonly kind: 'snag-ball', readonly conversion: SnagBallConversionV1, readonly state: SnagMachineStateV1 }

/**
 * Resolve the exact next unit from a homogeneous inventory row. Expired portable
 * authority is cleaned in the returned state; callers persist it atomically with
 * the throw. An unexpired not-yet-ready unit remains reserved and blocks use.
 */
export const resolveSnagBallForThrow = (input: {
  readonly state: SnagMachineStateV1
  readonly ballSourceInstanceId: string
  readonly currentRound: number | null
  readonly operationId: string
  readonly historyIdFor: (conversionId: string) => string
}): ResolveSnagBallForThrowResult => {
  const relevant = input.state.conversions.filter(entry => entry.ballSourceInstanceId === input.ballSourceInstanceId)
  const expired = relevant.filter(entry => entry.variant === 'portable'
    && (input.currentRound === null || input.currentRound > entry.expiresAfterRound!))
  const retained = input.state.conversions.filter(entry => !expired.some(candidate => candidate.conversionId === entry.conversionId))
  const expiredHistory = expired.map(entry => ({
    historyId: input.historyIdFor(entry.conversionId),
    kind: 'expired' as const,
    conversionId: entry.conversionId,
    variant: entry.variant,
    machineSourceInstanceId: entry.machineSourceInstanceId,
    ballSourceInstanceId: entry.ballSourceInstanceId,
    ballCanonicalItemId: entry.ballCanonicalItemId,
    campaignDayIndex: entry.campaignDayIndex,
    encounterRound: input.currentRound,
    operationId: input.operationId,
  }))
  const cleaned = expired.length === 0 ? input.state : parseSnagMachineState({
    schemaVersion: 1,
    revision: input.state.revision + 1,
    conversions: retained,
    history: boundedHistory([...input.state.history, ...expiredHistory], retained),
  })
  const candidates = cleaned.conversions.filter(entry => entry.ballSourceInstanceId === input.ballSourceInstanceId)
  const blocked = candidates.some(entry => entry.variant === 'portable'
    && (input.currentRound === null || input.currentRound < entry.readyRound!))
  if (blocked) return deepFreezeStrictJson({ kind: 'blocked', reason: 'portable-conversion-not-ready', state: cleaned })
  const active = candidates.find(entry => entry.variant === 'portable'
    && input.currentRound === entry.readyRound)
    ?? candidates.find(entry => entry.variant === 'large')
  if (!active) return deepFreezeStrictJson({ kind: 'ordinary', state: cleaned })
  const nextConversions = cleaned.conversions.filter(entry => entry.conversionId !== active.conversionId)
  const nextHistory: SnagMachineHistoryEntryV1[] = [...cleaned.history, {
    historyId: input.historyIdFor(active.conversionId),
    kind: 'thrown',
    conversionId: active.conversionId,
    variant: active.variant,
    machineSourceInstanceId: active.machineSourceInstanceId,
    ballSourceInstanceId: active.ballSourceInstanceId,
    ballCanonicalItemId: active.ballCanonicalItemId,
    campaignDayIndex: active.campaignDayIndex,
    encounterRound: input.currentRound,
    operationId: input.operationId,
  }]
  const next = parseSnagMachineState({
    schemaVersion: 1,
    revision: cleaned.revision + 1,
    conversions: nextConversions,
    history: boundedHistory(nextHistory, nextConversions),
  })
  return deepFreezeStrictJson({ kind: 'snag-ball', conversion: active, state: next })
}
