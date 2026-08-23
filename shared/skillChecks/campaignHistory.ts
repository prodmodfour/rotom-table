import type { SkillCheckAcceptedResultV1 } from './contract'

export const CAMPAIGN_SKILL_CHECK_HISTORY_SCHEMA_VERSION = 1 as const
export const CAMPAIGN_SKILL_CHECK_HISTORY_STATES = Object.freeze(['accepted', 'cancelled', 'timed-out'] as const)
export const CAMPAIGN_SKILL_CHECK_HISTORY_OUTCOMES = Object.freeze([
  'success', 'failure', 'winner', 'loser', 'mixed', 'resolved', 'withheld',
] as const)

export type CampaignSkillCheckHistoryState = typeof CAMPAIGN_SKILL_CHECK_HISTORY_STATES[number]
export type CampaignSkillCheckHistoryOutcome =
  | SkillCheckAcceptedResultV1['outcome']
  | 'mixed'
  | 'resolved'
  | 'withheld'

export interface CampaignSkillCheckHistoryEntryV1 {
  readonly entryId: `campaign-skill-check-history:v1:${string}`
  readonly publicLabel: string
  readonly state: CampaignSkillCheckHistoryState
  readonly outcome: CampaignSkillCheckHistoryOutcome | null
  readonly terminalAt: number
}

export interface CampaignSkillCheckHistoryResponseV1 {
  readonly schemaVersion: typeof CAMPAIGN_SKILL_CHECK_HISTORY_SCHEMA_VERSION
  readonly projection: 'campaign-skill-check-history'
  readonly audience: 'gm' | 'owner'
  readonly entries: readonly CampaignSkillCheckHistoryEntryV1[]
  readonly serverNow: number
}

const fail = (path: string): never => { throw new Error(`skill-check.invalid-campaign-history:${path}`) }
const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(path)
  return value as Record<string, unknown>
}
const exact = (value: Record<string, unknown>, fields: readonly string[], path: string): void => {
  if (Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) fail(path)
}
const integer = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return fail(path)
  return Number(value)
}
const label = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 120 || /[\u0000-\u001f\u007f]/u.test(value)) return fail(path)
  return value
}

export const parseCampaignSkillCheckHistoryEntry = (value: unknown): CampaignSkillCheckHistoryEntryV1 => {
  const candidate = structuredClone(record(value, 'entry'))
  exact(candidate, ['entryId', 'publicLabel', 'state', 'outcome', 'terminalAt'], 'entry')
  if (typeof candidate.entryId !== 'string'
    || !/^campaign-skill-check-history:v1:[a-f0-9]{64}$/u.test(candidate.entryId)
    || !CAMPAIGN_SKILL_CHECK_HISTORY_STATES.includes(candidate.state as never)) return fail('entry')
  candidate.publicLabel = label(candidate.publicLabel, 'entry.publicLabel')
  candidate.terminalAt = integer(candidate.terminalAt, 'entry.terminalAt')
  if (candidate.state === 'accepted') {
    if (!CAMPAIGN_SKILL_CHECK_HISTORY_OUTCOMES.includes(candidate.outcome as never)) return fail('entry.outcome')
  }
  else if (candidate.outcome !== null) return fail('entry.outcome')
  return Object.freeze(candidate) as unknown as CampaignSkillCheckHistoryEntryV1
}

export const parseCampaignSkillCheckHistoryResponse = (value: unknown): CampaignSkillCheckHistoryResponseV1 => {
  const candidate = structuredClone(record(value, 'response'))
  exact(candidate, ['schemaVersion', 'projection', 'audience', 'entries', 'serverNow'], 'response')
  if (candidate.schemaVersion !== 1 || candidate.projection !== 'campaign-skill-check-history'
    || (candidate.audience !== 'gm' && candidate.audience !== 'owner')
    || !Array.isArray(candidate.entries) || candidate.entries.length > 20) return fail('response')
  candidate.entries = candidate.entries.map(parseCampaignSkillCheckHistoryEntry)
  candidate.serverNow = integer(candidate.serverNow, 'response.serverNow')
  const entries = candidate.entries as CampaignSkillCheckHistoryEntryV1[]
  if (new Set(entries.map(entry => entry.entryId)).size !== entries.length
    || entries.some((entry, index) => entry.terminalAt > Number(candidate.serverNow)
      || (index > 0 && entry.terminalAt > entries[index - 1]!.terminalAt))) return fail('response.entries')
  return Object.freeze({
    ...candidate,
    entries: Object.freeze(entries),
  }) as unknown as CampaignSkillCheckHistoryResponseV1
}
