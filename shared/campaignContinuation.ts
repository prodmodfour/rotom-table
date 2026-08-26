import {
  parseCampaignAttentionProjection,
  type CampaignAttentionProjectionV1,
} from './campaignAttention/projection'

export const CAMPAIGN_CONTINUATION_SCHEMA_VERSION = 1 as const
export const CAMPAIGN_CONTINUATION_SNAPSHOT_ID_RE = /^campaign-continuation-snapshot:v1:[a-f0-9]{64}$/

export interface CampaignActiveEncounterSummaryV1 {
  readonly label: string
  readonly state: 'active' | 'paused'
  readonly round: number
  readonly participantCount: number
  readonly href: string
}

export interface CampaignUnfinishedSettlementSummaryV1 {
  readonly label: string
  readonly state: 'needs-review' | 'ready-to-finish' | 'finishing'
  readonly openWorkCount: number | null
  readonly href: string
}

export interface CampaignReadyPreparationSummaryV1 {
  readonly label: string
  readonly state: 'ready' | 'in-progress'
  readonly sceneCount: number
  readonly href: string
}

export interface CampaignEggSummaryV1 {
  readonly active: number
  readonly incubating: number
  readonly ready: number
  readonly needsAdjudication: number
  readonly hatching: number
  readonly href: string
}

export interface CampaignContinuationProjectionV1 {
  readonly schemaVersion: typeof CAMPAIGN_CONTINUATION_SCHEMA_VERSION
  readonly snapshotId: string
  readonly attention: CampaignAttentionProjectionV1
  readonly activeEncounter: CampaignActiveEncounterSummaryV1 | null
  readonly additionalActiveEncounters: number
  readonly unfinishedSettlement: CampaignUnfinishedSettlementSummaryV1 | null
  readonly additionalUnfinishedSettlements: number
  readonly readyPreparation: CampaignReadyPreparationSummaryV1 | null
  readonly additionalReadyPreparations: number
  readonly eggs: CampaignEggSummaryV1
}

const object = (value: unknown, path: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`)
  }
  return value as Record<string, unknown>
}
const exact = (value: Record<string, unknown>, fields: readonly string[], path: string): void => {
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
const text = (value: unknown, path: string, maximum: number): string => {
  if (typeof value !== 'string' || value.trim() !== value || value.length < 1
    || value.length > maximum || /\p{C}/u.test(value)) {
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
const nullableInteger = (value: unknown, path: string): number | null => value === null ? null : integer(value, path)

const encounter = (value: unknown, path: string): CampaignActiveEncounterSummaryV1 | null => {
  if (value === null) return null
  const input = object(value, path)
  exact(input, ['label', 'state', 'round', 'participantCount', 'href'], path)
  if (input.state !== 'active' && input.state !== 'paused') throw new Error(`${path}.state must be active or paused.`)
  return Object.freeze({
    label: text(input.label, `${path}.label`, 120),
    state: input.state,
    round: integer(input.round, `${path}.round`),
    participantCount: integer(input.participantCount, `${path}.participantCount`),
    href: href(input.href, `${path}.href`),
  })
}
const settlement = (value: unknown, path: string): CampaignUnfinishedSettlementSummaryV1 | null => {
  if (value === null) return null
  const input = object(value, path)
  exact(input, ['label', 'state', 'openWorkCount', 'href'], path)
  if (input.state !== 'needs-review' && input.state !== 'ready-to-finish' && input.state !== 'finishing') {
    throw new Error(`${path}.state must be a safe unfinished-settlement state.`)
  }
  return Object.freeze({
    label: text(input.label, `${path}.label`, 120),
    state: input.state,
    openWorkCount: nullableInteger(input.openWorkCount, `${path}.openWorkCount`),
    href: href(input.href, `${path}.href`),
  })
}
const readyPreparation = (value: unknown, path: string): CampaignReadyPreparationSummaryV1 | null => {
  if (value === null) return null
  const input = object(value, path)
  exact(input, ['label', 'state', 'sceneCount', 'href'], path)
  if (input.state !== 'ready' && input.state !== 'in-progress') throw new Error(`${path}.state must be ready or in-progress.`)
  return Object.freeze({
    label: text(input.label, `${path}.label`, 160),
    state: input.state,
    sceneCount: integer(input.sceneCount, `${path}.sceneCount`),
    href: href(input.href, `${path}.href`),
  })
}
const eggSummary = (value: unknown, path: string): CampaignEggSummaryV1 => {
  const input = object(value, path)
  exact(input, ['active', 'incubating', 'ready', 'needsAdjudication', 'hatching', 'href'], path)
  const parsed: CampaignEggSummaryV1 = Object.freeze({
    active: integer(input.active, `${path}.active`),
    incubating: integer(input.incubating, `${path}.incubating`),
    ready: integer(input.ready, `${path}.ready`),
    needsAdjudication: integer(input.needsAdjudication, `${path}.needsAdjudication`),
    hatching: integer(input.hatching, `${path}.hatching`),
    href: href(input.href, `${path}.href`),
  })
  if (parsed.active !== parsed.incubating + parsed.ready + parsed.needsAdjudication + parsed.hatching) {
    throw new Error(`${path}.active must exactly count active Egg states.`)
  }
  return parsed
}

export const parseCampaignContinuationProjection = (
  value: unknown,
  path = 'campaignContinuation',
): CampaignContinuationProjectionV1 => {
  const input = object(value, path)
  exact(input, [
    'schemaVersion', 'snapshotId', 'attention', 'activeEncounter',
    'additionalActiveEncounters', 'unfinishedSettlement',
    'additionalUnfinishedSettlements', 'readyPreparation',
    'additionalReadyPreparations', 'eggs',
  ], path)
  if (input.schemaVersion !== CAMPAIGN_CONTINUATION_SCHEMA_VERSION) {
    throw new Error(`${path}.schemaVersion must be 1.`)
  }
  if (typeof input.snapshotId !== 'string' || !CAMPAIGN_CONTINUATION_SNAPSHOT_ID_RE.test(input.snapshotId)) {
    throw new Error(`${path}.snapshotId must be one stable v1 continuation identity.`)
  }
  return Object.freeze({
    schemaVersion: CAMPAIGN_CONTINUATION_SCHEMA_VERSION,
    snapshotId: input.snapshotId,
    attention: parseCampaignAttentionProjection(input.attention, `${path}.attention`),
    activeEncounter: encounter(input.activeEncounter, `${path}.activeEncounter`),
    additionalActiveEncounters: integer(input.additionalActiveEncounters, `${path}.additionalActiveEncounters`),
    unfinishedSettlement: settlement(input.unfinishedSettlement, `${path}.unfinishedSettlement`),
    additionalUnfinishedSettlements: integer(input.additionalUnfinishedSettlements, `${path}.additionalUnfinishedSettlements`),
    readyPreparation: readyPreparation(input.readyPreparation, `${path}.readyPreparation`),
    additionalReadyPreparations: integer(input.additionalReadyPreparations, `${path}.additionalReadyPreparations`),
    eggs: eggSummary(input.eggs, `${path}.eggs`),
  })
}
