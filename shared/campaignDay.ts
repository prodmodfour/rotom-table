import { cloneStrictJson, deepFreezeStrictJson } from './automation/strictJson'

export const CAMPAIGN_DAY_OPERATION_SCHEMA_VERSION = 1 as const
/** Reviewed singleton-clock meaning of one campaign day. */
export const CAMPAIGN_DAY_MINUTES = 1_440 as const
export const CAMPAIGN_DAY_MAX_EXPIRED_EFFECTS = 4_096 as const
export const CAMPAIGN_DAY_OPERATION_ID_RE = /^campaign-day:v1:[0-9a-f]{32}$/
export type CampaignDayOperationId = string & { readonly __campaignDayOperationId: true }

export interface CampaignDayOperationCommandV1 {
  readonly schemaVersion: 1
  readonly operationId: CampaignDayOperationId
  readonly kind: 'advance-one-day'
  readonly days: 1
}

export interface CampaignDayClockResultV1 {
  readonly previousRevision: number
  readonly revision: number
  readonly previousCampaignMinute: number
  readonly campaignMinute: number
  readonly minutesAdvanced: number
  /** Breeding-compatible clock operation retained by the shared clock archive. */
  readonly clockOperationId: string
  /** Number of due Eggs durably reconciled to this exact clock checkpoint. */
  readonly reconciledEggs: number
  readonly creditedEggCampaignMinutes: number
  readonly skippedPausedEggCampaignMinutes: number
  /** False only when another bounded equal-target continuation is required. */
  readonly eggBatchComplete: boolean
}

export interface CampaignDayExpiredEffectV1 {
  readonly mapSlug: string
  readonly effectId: string
  readonly durationKind: 'campaign-time'
  readonly expiresAtCampaignMinute: number
}

export interface CampaignDayOperationAcceptedV1 {
  readonly schemaVersion: 1
  readonly operationId: CampaignDayOperationId
  readonly commandSha256: string
  readonly ok: true
  readonly totalSheets: number
  readonly updatedSheets: number
  readonly pokemonSheets: number
  readonly trainerSheets: number
  readonly pokemonUpdated: number
  readonly trainerUpdated: number
  readonly hitPointsRestored: number
  readonly injuriesHealed: number
  readonly dailyMoveUsesCleared: number
  readonly dailyMoveEntriesCleared: number
  readonly conditionsCleared: number
  readonly trainerApRestored: number
  readonly campaignClock: CampaignDayClockResultV1
  readonly expiredEffects: readonly CampaignDayExpiredEffectV1[]
}

export interface CampaignNextDayResult extends CampaignDayOperationAcceptedV1 {
  readonly replayed: boolean
}

export class CampaignDayContractError extends Error {
  readonly path: string
  constructor(path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'CampaignDayContractError'
    this.path = path
  }
}

type Row = Record<string, unknown>
const COMMAND_FIELDS = ['schemaVersion', 'operationId', 'kind', 'days'] as const
const RESULT_FIELDS = [
  'schemaVersion', 'operationId', 'commandSha256', 'ok', 'totalSheets', 'updatedSheets',
  'pokemonSheets', 'trainerSheets', 'pokemonUpdated', 'trainerUpdated', 'hitPointsRestored',
  'injuriesHealed', 'dailyMoveUsesCleared', 'dailyMoveEntriesCleared', 'conditionsCleared',
  'trainerApRestored', 'campaignClock', 'expiredEffects',
] as const
const CLOCK_FIELDS = [
  'previousRevision', 'revision', 'previousCampaignMinute', 'campaignMinute',
  'minutesAdvanced', 'clockOperationId', 'reconciledEggs', 'creditedEggCampaignMinutes',
  'skippedPausedEggCampaignMinutes', 'eggBatchComplete',
] as const
const EFFECT_FIELDS = ['mapSlug', 'effectId', 'durationKind', 'expiresAtCampaignMinute'] as const
const SHA256 = /^[0-9a-f]{64}$/
const STABLE_ID = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const fail = (path: string, message: string): never => { throw new CampaignDayContractError(path, message) }
const clone = (value: unknown, label: string): unknown => cloneStrictJson(value, label, {
  limits: { depth: 6, nodes: 50_000, objectFields: 32, arrayEntries: CAMPAIGN_DAY_MAX_EXPIRED_EFFECTS, stringLength: 200, objectKeyLength: 80 },
  rootLabel: label,
  valueLabel: 'campaign-day data',
  failNotJson: (path, detail) => fail(path, detail),
  failLimit: (path, detail) => fail(path, detail),
})
const exact = (value: unknown, fields: readonly string[], path: string): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object.')
  const row = value as Row
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !allowed.has(field))) {
    fail(path, `must contain exactly: ${fields.join(', ')}.`)
  }
  return row
}
const integer = (value: unknown, path: string): number => Number.isSafeInteger(value) && Number(value) >= 0
  ? Number(value)
  : fail(path, 'must be a nonnegative safe integer.')
const boundedId = (value: unknown, path: string): string => typeof value === 'string'
  && value.length >= 1 && value.length <= 200 && value.trim() === value && STABLE_ID.test(value)
  ? value
  : fail(path, 'must be a bounded lowercase stable identifier.')
export const parseCampaignDayOperationId = (value: unknown, path = 'operationId'): CampaignDayOperationId => (
  typeof value === 'string' && CAMPAIGN_DAY_OPERATION_ID_RE.test(value)
    ? value as CampaignDayOperationId
    : fail(path, 'must match campaign-day:v1:<32 lowercase hex>.')
)

export const parseCampaignDayOperationCommandV1 = (
  value: unknown,
  path = 'campaignDayCommand',
): CampaignDayOperationCommandV1 => {
  const row = exact(clone(value, path), COMMAND_FIELDS, path)
  if (row.schemaVersion !== 1 || row.kind !== 'advance-one-day' || row.days !== 1) {
    fail(path, 'must be the supported v1 one-day advancement command.')
  }
  return deepFreezeStrictJson({
    schemaVersion: 1,
    operationId: parseCampaignDayOperationId(row.operationId, `${path}.operationId`),
    kind: 'advance-one-day',
    days: 1,
  })
}

const parseClock = (value: unknown, path: string): CampaignDayClockResultV1 => {
  const row = exact(value, CLOCK_FIELDS, path)
  const previousRevision = integer(row.previousRevision, `${path}.previousRevision`)
  const revision = integer(row.revision, `${path}.revision`)
  const previousCampaignMinute = integer(row.previousCampaignMinute, `${path}.previousCampaignMinute`)
  const campaignMinute = integer(row.campaignMinute, `${path}.campaignMinute`)
  const minutesAdvanced = integer(row.minutesAdvanced, `${path}.minutesAdvanced`)
  if (revision !== previousRevision + 1 || minutesAdvanced !== CAMPAIGN_DAY_MINUTES
    || previousCampaignMinute > Number.MAX_SAFE_INTEGER - minutesAdvanced
    || campaignMinute !== previousCampaignMinute + minutesAdvanced) {
    fail(path, `must describe exactly one ${CAMPAIGN_DAY_MINUTES}-minute campaign day and one forward clock revision.`)
  }
  const clockOperationId = boundedId(row.clockOperationId, `${path}.clockOperationId`)
  if (!/^breeding-operation:v1:[0-9a-f]{32}$/.test(clockOperationId)) {
    fail(`${path}.clockOperationId`, 'must be a breeding-compatible clock operation ID.')
  }
  const reconciledEggs = integer(row.reconciledEggs, `${path}.reconciledEggs`)
  const creditedEggCampaignMinutes = integer(
    row.creditedEggCampaignMinutes,
    `${path}.creditedEggCampaignMinutes`,
  )
  const skippedPausedEggCampaignMinutes = integer(
    row.skippedPausedEggCampaignMinutes,
    `${path}.skippedPausedEggCampaignMinutes`,
  )
  if (typeof row.eggBatchComplete !== 'boolean') {
    fail(`${path}.eggBatchComplete`, 'must be a boolean.')
  }
  if (!row.eggBatchComplete) {
    fail(`${path}.eggBatchComplete`, 'must be true before a campaign day can be accepted.')
  }
  if (reconciledEggs === 0
    && (creditedEggCampaignMinutes !== 0 || skippedPausedEggCampaignMinutes !== 0)) {
    fail(path, 'cannot report Egg campaign minutes without a reconciled Egg.')
  }
  return {
    previousRevision,
    revision,
    previousCampaignMinute,
    campaignMinute,
    minutesAdvanced,
    clockOperationId,
    reconciledEggs,
    creditedEggCampaignMinutes,
    skippedPausedEggCampaignMinutes,
    eggBatchComplete: true,
  }
}

export const parseCampaignDayOperationAcceptedV1 = (
  value: unknown,
  path = 'campaignDayResult',
): CampaignDayOperationAcceptedV1 => {
  const row = exact(clone(value, path), RESULT_FIELDS, path)
  if (row.schemaVersion !== 1 || row.ok !== true) {
    fail(path, 'must be an accepted v1 result.')
  }
  const commandSha256 = typeof row.commandSha256 === 'string' && SHA256.test(row.commandSha256)
    ? row.commandSha256
    : fail(`${path}.commandSha256`, 'must be a lowercase command SHA-256.')
  const numeric = (field: typeof RESULT_FIELDS[number]): number => integer(row[field], `${path}.${field}`)
  const campaignClock = parseClock(row.campaignClock, `${path}.campaignClock`)
  const rawExpiredEffects: unknown[] = Array.isArray(row.expiredEffects)
    ? row.expiredEffects
    : fail(`${path}.expiredEffects`, 'must be an array.')
  const expiredEffects = rawExpiredEffects.map((entry, index): CampaignDayExpiredEffectV1 => {
    const effectPath = `${path}.expiredEffects[${index}]`
    const effect = exact(entry, EFFECT_FIELDS, effectPath)
    if (effect.durationKind !== 'campaign-time') fail(`${effectPath}.durationKind`, 'must be campaign-time.')
    const expiresAtCampaignMinute = integer(effect.expiresAtCampaignMinute, `${effectPath}.expiresAtCampaignMinute`)
    if (expiresAtCampaignMinute > campaignClock.campaignMinute) {
      fail(`${effectPath}.expiresAtCampaignMinute`, 'cannot be later than the committed campaign minute.')
    }
    return {
      mapSlug: boundedId(effect.mapSlug, `${effectPath}.mapSlug`),
      effectId: boundedId(effect.effectId, `${effectPath}.effectId`),
      durationKind: 'campaign-time',
      expiresAtCampaignMinute,
    }
  })
  const keys = expiredEffects.map(effect => `${effect.mapSlug}\u0000${effect.effectId}`)
  if (new Set(keys).size !== keys.length || keys.some((key, index) => index > 0 && keys[index - 1]! >= key)) {
    fail(`${path}.expiredEffects`, 'must be unique in strict map/effect identity order.')
  }
  const result: CampaignDayOperationAcceptedV1 = {
    schemaVersion: 1,
    operationId: parseCampaignDayOperationId(row.operationId, `${path}.operationId`),
    commandSha256,
    ok: true,
    totalSheets: numeric('totalSheets'),
    updatedSheets: numeric('updatedSheets'),
    pokemonSheets: numeric('pokemonSheets'),
    trainerSheets: numeric('trainerSheets'),
    pokemonUpdated: numeric('pokemonUpdated'),
    trainerUpdated: numeric('trainerUpdated'),
    hitPointsRestored: numeric('hitPointsRestored'),
    injuriesHealed: numeric('injuriesHealed'),
    dailyMoveUsesCleared: numeric('dailyMoveUsesCleared'),
    dailyMoveEntriesCleared: numeric('dailyMoveEntriesCleared'),
    conditionsCleared: numeric('conditionsCleared'),
    trainerApRestored: numeric('trainerApRestored'),
    campaignClock,
    expiredEffects,
  }
  if (result.updatedSheets !== result.pokemonUpdated + result.trainerUpdated
    || result.totalSheets !== result.pokemonSheets + result.trainerSheets
    || result.pokemonUpdated > result.pokemonSheets
    || result.trainerUpdated > result.trainerSheets
    || result.updatedSheets > result.totalSheets) {
    fail(path, 'sheet summary totals and updated bounds must reconcile exactly.')
  }
  return deepFreezeStrictJson(result)
}

export const projectCampaignNextDayResult = (
  result: CampaignDayOperationAcceptedV1,
  replayed: boolean,
): CampaignNextDayResult => deepFreezeStrictJson({ ...parseCampaignDayOperationAcceptedV1(result), replayed })

export const parseCampaignNextDayResult = (
  value: unknown,
  path = 'campaignNextDayResult',
): CampaignNextDayResult => {
  const row = exact(clone(value, path), [...RESULT_FIELDS, 'replayed'], path)
  if (typeof row.replayed !== 'boolean') fail(`${path}.replayed`, 'must be a boolean.')
  const replayed = row.replayed as boolean
  const accepted = Object.fromEntries(RESULT_FIELDS.map(field => [field, row[field]]))
  return projectCampaignNextDayResult(
    parseCampaignDayOperationAcceptedV1(accepted, path),
    replayed,
  )
}
