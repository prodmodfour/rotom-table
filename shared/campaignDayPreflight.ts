import { CAMPAIGN_ATTENTION_REASONS, type CampaignAttentionReason } from './campaignAttention/model'
import { CAMPAIGN_DAY_MINUTES } from './campaignDay'

export const CAMPAIGN_DAY_PREFLIGHT_SCHEMA_VERSION = 1 as const
export const CAMPAIGN_DAY_PREFLIGHT_ID_RE = /^campaign-day-preflight:v1:[a-f0-9]{64}$/
export const CAMPAIGN_DAY_PREFLIGHT_AFFECTED_SHEET_LIMIT = 100
export const CAMPAIGN_DAY_PREFLIGHT_BLOCKER_LIMIT = 32
export const CAMPAIGN_DAY_PREFLIGHT_CHANGE_KINDS = [
  'hit-points', 'injury', 'conditions', 'daily-moves', 'trainer-ap', 'daily-resources',
] as const
export type CampaignDayPreflightChangeKind = typeof CAMPAIGN_DAY_PREFLIGHT_CHANGE_KINDS[number]
export type CampaignDayPreflightState = 'ready' | 'blocked' | 'already-accepted'

export interface CampaignDayPreflightClockV1 {
  readonly currentCampaignMinute: number
  readonly targetCampaignMinute: number
  readonly minutesAdvanced: typeof CAMPAIGN_DAY_MINUTES
}

export interface CampaignDayPreflightAffectedSheetV1 {
  readonly kind: 'pokemon' | 'trainer'
  readonly label: string
  readonly href: string
  readonly changes: readonly CampaignDayPreflightChangeKind[]
}

export interface CampaignDayPreflightImpactV1 {
  readonly totalSheets: number
  readonly affectedSheetCount: number
  readonly affectedSheets: readonly CampaignDayPreflightAffectedSheetV1[]
  readonly additionalAffectedSheets: number
  readonly pokemonAffected: number
  readonly trainerAffected: number
  readonly hitPointsRestored: number
  readonly injuriesHealed: number
  readonly conditionsCleared: number
  readonly dailyMoveUsesCleared: number
  readonly dailyMoveEntriesCleared: number
  readonly trainerApRestored: number
  readonly reconciledEggs: number
  readonly creditedEggCampaignMinutes: number
  readonly skippedPausedEggCampaignMinutes: number
  readonly expiredEffects: number
}

export interface CampaignDayPreflightBlockerV1 {
  readonly kind: 'active-encounter' | 'unfinished-settlement' | 'attention'
  readonly reason: CampaignAttentionReason | null
  readonly label: string
  readonly count: number
  readonly href: string
}

export interface CampaignDayAcceptedPostflightV1 {
  readonly replayed: boolean
  readonly impact: CampaignDayPreflightImpactV1
}

export interface CampaignDayPreflightProjectionV1 {
  readonly schemaVersion: typeof CAMPAIGN_DAY_PREFLIGHT_SCHEMA_VERSION
  readonly state: CampaignDayPreflightState
  readonly preflightId: string | null
  readonly clock: CampaignDayPreflightClockV1
  readonly blockers: readonly CampaignDayPreflightBlockerV1[]
  readonly impact: CampaignDayPreflightImpactV1
  readonly accepted: CampaignDayAcceptedPostflightV1 | null
}

type Row = Record<string, unknown>
const CONTROL = /\p{C}/u
const object = (value: unknown, path: string): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object.`)
  return value as Row
}
const exact = (value: Row, fields: readonly string[], path: string): void => {
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw new Error(`${path} must contain exactly ${fields.join(', ')}.`)
  }
}
const integer = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${path} must be a non-negative safe integer.`)
  return Number(value)
}
const text = (value: unknown, path: string, maximum = 120): string => {
  if (typeof value !== 'string' || value.trim() !== value || value.length < 1
    || value.length > maximum || CONTROL.test(value)) {
    throw new Error(`${path} must be trimmed visible text from 1 through ${maximum} characters.`)
  }
  return value
}
const href = (value: unknown, path: string): string => {
  const parsed = text(value, path, 1_000)
  if (!parsed.startsWith('/') || parsed.startsWith('//') || parsed.includes('\\')) {
    throw new Error(`${path} must be an app-relative route.`)
  }
  return parsed
}

const parseClock = (value: unknown, path: string): CampaignDayPreflightClockV1 => {
  const row = object(value, path)
  exact(row, ['currentCampaignMinute', 'targetCampaignMinute', 'minutesAdvanced'], path)
  const currentCampaignMinute = integer(row.currentCampaignMinute, `${path}.currentCampaignMinute`)
  const targetCampaignMinute = integer(row.targetCampaignMinute, `${path}.targetCampaignMinute`)
  if (row.minutesAdvanced !== CAMPAIGN_DAY_MINUTES
    || currentCampaignMinute > Number.MAX_SAFE_INTEGER - CAMPAIGN_DAY_MINUTES
    || targetCampaignMinute !== currentCampaignMinute + CAMPAIGN_DAY_MINUTES) {
    throw new Error(`${path} must describe exactly one reviewed campaign day.`)
  }
  return Object.freeze({ currentCampaignMinute, targetCampaignMinute, minutesAdvanced: CAMPAIGN_DAY_MINUTES })
}

const parseAffectedSheet = (value: unknown, path: string): CampaignDayPreflightAffectedSheetV1 => {
  const row = object(value, path)
  exact(row, ['kind', 'label', 'href', 'changes'], path)
  if (row.kind !== 'pokemon' && row.kind !== 'trainer') throw new Error(`${path}.kind must be pokemon or trainer.`)
  if (!Array.isArray(row.changes) || row.changes.length < 1
    || row.changes.length > CAMPAIGN_DAY_PREFLIGHT_CHANGE_KINDS.length) {
    throw new Error(`${path}.changes must be a non-empty bounded array.`)
  }
  const changes = row.changes.map((entry, index) => {
    if (typeof entry !== 'string' || !CAMPAIGN_DAY_PREFLIGHT_CHANGE_KINDS.includes(entry as CampaignDayPreflightChangeKind)) {
      throw new Error(`${path}.changes[${index}] is not supported.`)
    }
    return entry as CampaignDayPreflightChangeKind
  })
  if (new Set(changes).size !== changes.length) throw new Error(`${path}.changes must be unique.`)
  return Object.freeze({
    kind: row.kind,
    label: text(row.label, `${path}.label`),
    href: href(row.href, `${path}.href`),
    changes: Object.freeze(changes),
  })
}

const parseImpact = (value: unknown, path: string): CampaignDayPreflightImpactV1 => {
  const row = object(value, path)
  const fields = [
    'totalSheets', 'affectedSheetCount', 'affectedSheets', 'additionalAffectedSheets',
    'pokemonAffected', 'trainerAffected', 'hitPointsRestored', 'injuriesHealed',
    'conditionsCleared', 'dailyMoveUsesCleared', 'dailyMoveEntriesCleared',
    'trainerApRestored', 'reconciledEggs', 'creditedEggCampaignMinutes',
    'skippedPausedEggCampaignMinutes', 'expiredEffects',
  ] as const
  exact(row, fields, path)
  if (!Array.isArray(row.affectedSheets)
    || row.affectedSheets.length > CAMPAIGN_DAY_PREFLIGHT_AFFECTED_SHEET_LIMIT) {
    throw new Error(`${path}.affectedSheets must be bounded to ${CAMPAIGN_DAY_PREFLIGHT_AFFECTED_SHEET_LIMIT} rows.`)
  }
  const affectedSheets = row.affectedSheets.map((entry, index) => parseAffectedSheet(entry, `${path}.affectedSheets[${index}]`))
  const keys = affectedSheets.map(entry => `${entry.kind}\u0000${entry.href}`)
  if (new Set(keys).size !== keys.length || keys.some((key, index) => index > 0 && keys[index - 1]! >= key)) {
    throw new Error(`${path}.affectedSheets must have unique deterministic kind/route order.`)
  }
  const impact: CampaignDayPreflightImpactV1 = Object.freeze({
    totalSheets: integer(row.totalSheets, `${path}.totalSheets`),
    affectedSheetCount: integer(row.affectedSheetCount, `${path}.affectedSheetCount`),
    affectedSheets: Object.freeze(affectedSheets),
    additionalAffectedSheets: integer(row.additionalAffectedSheets, `${path}.additionalAffectedSheets`),
    pokemonAffected: integer(row.pokemonAffected, `${path}.pokemonAffected`),
    trainerAffected: integer(row.trainerAffected, `${path}.trainerAffected`),
    hitPointsRestored: integer(row.hitPointsRestored, `${path}.hitPointsRestored`),
    injuriesHealed: integer(row.injuriesHealed, `${path}.injuriesHealed`),
    conditionsCleared: integer(row.conditionsCleared, `${path}.conditionsCleared`),
    dailyMoveUsesCleared: integer(row.dailyMoveUsesCleared, `${path}.dailyMoveUsesCleared`),
    dailyMoveEntriesCleared: integer(row.dailyMoveEntriesCleared, `${path}.dailyMoveEntriesCleared`),
    trainerApRestored: integer(row.trainerApRestored, `${path}.trainerApRestored`),
    reconciledEggs: integer(row.reconciledEggs, `${path}.reconciledEggs`),
    creditedEggCampaignMinutes: integer(row.creditedEggCampaignMinutes, `${path}.creditedEggCampaignMinutes`),
    skippedPausedEggCampaignMinutes: integer(row.skippedPausedEggCampaignMinutes, `${path}.skippedPausedEggCampaignMinutes`),
    expiredEffects: integer(row.expiredEffects, `${path}.expiredEffects`),
  })
  if (impact.affectedSheetCount !== impact.pokemonAffected + impact.trainerAffected
    || impact.affectedSheetCount !== impact.affectedSheets.length + impact.additionalAffectedSheets
    || impact.affectedSheetCount > impact.totalSheets) {
    throw new Error(`${path} sheet counts must reconcile exactly.`)
  }
  return impact
}

const parseBlocker = (value: unknown, path: string): CampaignDayPreflightBlockerV1 => {
  const row = object(value, path)
  exact(row, ['kind', 'reason', 'label', 'count', 'href'], path)
  if (row.kind !== 'active-encounter' && row.kind !== 'unfinished-settlement' && row.kind !== 'attention') {
    throw new Error(`${path}.kind is not supported.`)
  }
  const reason = row.reason === null
    ? null
    : typeof row.reason === 'string' && CAMPAIGN_ATTENTION_REASONS.includes(row.reason as CampaignAttentionReason)
      ? row.reason as CampaignAttentionReason
      : (() => { throw new Error(`${path}.reason is not supported.`) })()
  if ((row.kind === 'attention') !== (reason !== null)) throw new Error(`${path}.reason must exist only for attention blockers.`)
  const count = integer(row.count, `${path}.count`)
  if (count < 1) throw new Error(`${path}.count must be positive.`)
  return Object.freeze({
    kind: row.kind,
    reason,
    label: text(row.label, `${path}.label`),
    count,
    href: href(row.href, `${path}.href`),
  })
}

export const parseCampaignDayPreflightProjection = (
  value: unknown,
  path = 'campaignDayPreflight',
): CampaignDayPreflightProjectionV1 => {
  const row = object(value, path)
  exact(row, ['schemaVersion', 'state', 'preflightId', 'clock', 'blockers', 'impact', 'accepted'], path)
  if (row.schemaVersion !== CAMPAIGN_DAY_PREFLIGHT_SCHEMA_VERSION) throw new Error(`${path}.schemaVersion must be 1.`)
  if (row.state !== 'ready' && row.state !== 'blocked' && row.state !== 'already-accepted') {
    throw new Error(`${path}.state is not supported.`)
  }
  const preflightId = row.preflightId === null
    ? null
    : typeof row.preflightId === 'string' && CAMPAIGN_DAY_PREFLIGHT_ID_RE.test(row.preflightId)
      ? row.preflightId
      : (() => { throw new Error(`${path}.preflightId is malformed.`) })()
  if (!Array.isArray(row.blockers) || row.blockers.length > CAMPAIGN_DAY_PREFLIGHT_BLOCKER_LIMIT) {
    throw new Error(`${path}.blockers must be bounded to ${CAMPAIGN_DAY_PREFLIGHT_BLOCKER_LIMIT} rows.`)
  }
  const blockers = row.blockers.map((entry, index) => parseBlocker(entry, `${path}.blockers[${index}]`))
  const blockerKeys = blockers.map(entry => `${entry.kind}\u0000${entry.reason ?? ''}\u0000${entry.href}`)
  if (new Set(blockerKeys).size !== blockerKeys.length) throw new Error(`${path}.blockers must be unique.`)
  let accepted: CampaignDayAcceptedPostflightV1 | null = null
  if (row.accepted !== null) {
    const acceptedRow = object(row.accepted, `${path}.accepted`)
    exact(acceptedRow, ['replayed', 'impact'], `${path}.accepted`)
    if (typeof acceptedRow.replayed !== 'boolean') throw new Error(`${path}.accepted.replayed must be a boolean.`)
    accepted = Object.freeze({
      replayed: acceptedRow.replayed,
      impact: parseImpact(acceptedRow.impact, `${path}.accepted.impact`),
    })
  }
  if (row.state === 'ready' && (preflightId === null || blockers.length !== 0 || accepted !== null)) {
    throw new Error(`${path} ready state must have one preflight identity and no blockers or accepted result.`)
  }
  if (row.state === 'blocked' && (preflightId === null || blockers.length === 0 || accepted !== null)) {
    throw new Error(`${path} blocked state must have one preflight identity and blockers only.`)
  }
  if (row.state === 'already-accepted' && (preflightId !== null || blockers.length !== 0 || accepted === null)) {
    throw new Error(`${path} accepted state must have only one accepted result.`)
  }
  return Object.freeze({
    schemaVersion: CAMPAIGN_DAY_PREFLIGHT_SCHEMA_VERSION,
    state: row.state,
    preflightId,
    clock: parseClock(row.clock, `${path}.clock`),
    blockers: Object.freeze(blockers),
    impact: parseImpact(row.impact, `${path}.impact`),
    accepted,
  })
}
