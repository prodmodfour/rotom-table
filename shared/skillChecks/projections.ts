import {
  SKILL_CHECK_STATES,
  parseSkillCheckId,
  parseSkillCheckSubjectId,
  type SkillCheckDocumentV1,
  type SkillCheckModifierContributorV1,
  type SkillCheckState,
} from './contract'
import { parseSkillCheckDocument } from './persistence'
import { parseSkillCheckSubjectRequestView, type SkillCheckSubjectRequestViewV1 } from './subjectWorkflow'

export interface SkillCheckGmSubjectProjectionV1 {
  readonly subjectId: `skill-check-subject:v1:${string}`
  readonly label: string
  readonly modifierAuthority:
    | {
        readonly status: 'available'
        readonly diceCount: number
        readonly flatModifier: number
        readonly contributors: readonly SkillCheckModifierContributorV1[]
      }
    | {
        readonly status: 'unavailable'
        readonly reason: 'skill-authority-unavailable'
      }
}

export interface SkillCheckGmProjectionV1 {
  readonly schemaVersion: 1
  readonly projection: 'gm'
  readonly document: SkillCheckDocumentV1
  readonly subjects: readonly SkillCheckGmSubjectProjectionV1[]
}

export interface SkillCheckSpectatorHistoryEntryV1 {
  readonly entryId: `skill-check-public-history:v1:${string}`
  readonly kind: 'requested' | 'accepted' | 'cancelled' | 'timed-out' | 'corrected'
  readonly headline: string
  readonly createdAt: number
}

export interface SkillCheckSpectatorProjectionV1 {
  readonly schemaVersion: 1
  readonly projection: 'spectator'
  readonly checkId: `skill-check:v1:${string}`
  readonly revision: number
  readonly state: SkillCheckState
  readonly publicLabel: string
  readonly pendingCount: number
  readonly result: null | {
    readonly visibility: 'visible' | 'withheld'
    readonly successfulSubjects: number | null
    readonly failedSubjects: number | null
    readonly winners: number | null
    readonly losers: number | null
  }
  readonly history: readonly SkillCheckSpectatorHistoryEntryV1[]
  readonly updatedAt: number
}

export type SkillCheckRoleProjectionResponseV1 =
  | {
      readonly schemaVersion: 1
      readonly audience: 'gm'
      readonly checks: readonly SkillCheckGmProjectionV1[]
      readonly serverNow: number
    }
  | {
      readonly schemaVersion: 1
      readonly audience: 'subject'
      readonly checks: readonly SkillCheckSubjectRequestViewV1[]
      readonly serverNow: number
    }
  | {
      readonly schemaVersion: 1
      readonly audience: 'spectator'
      readonly checks: readonly SkillCheckSpectatorProjectionV1[]
      readonly serverNow: number
    }

const fail = (path: string): never => { throw new Error(`skill-check.invalid-role-projection:${path}`) }
const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(path)
  return value as Record<string, unknown>
}
const exact = (value: Record<string, unknown>, fields: readonly string[], path: string): void => {
  if (Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) fail(path)
}
const integer = (value: unknown, path: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) return fail(path)
  return Number(value)
}
const text = (value: unknown, path: string, maximum: number): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) return fail(path)
  return value
}
const deepFreeze = <Value>(value: Value): Value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

const parseContributor = (value: unknown, path: string): SkillCheckModifierContributorV1 => {
  const candidate = record(value, path)
  exact(candidate, ['contributorId', 'label', 'value', 'visibility'], path)
  text(candidate.contributorId, `${path}.contributorId`, 240)
  text(candidate.label, `${path}.label`, 200)
  integer(candidate.value, `${path}.value`, -100, 100)
  if (candidate.visibility !== 'gm-and-subject' && candidate.visibility !== 'gm-only') return fail(`${path}.visibility`)
  return candidate as unknown as SkillCheckModifierContributorV1
}

export const parseSkillCheckGmProjection = (value: unknown): SkillCheckGmProjectionV1 => {
  const candidate = structuredClone(record(value, 'projection'))
  exact(candidate, ['schemaVersion', 'projection', 'document', 'subjects'], 'projection')
  if (candidate.schemaVersion !== 1 || candidate.projection !== 'gm' || !Array.isArray(candidate.subjects)) return fail('projection')
  const document = parseSkillCheckDocument(candidate.document)
  if (candidate.subjects.length !== document.subjects.length) return fail('projection.subjects')
  const subjects = candidate.subjects.map((subjectValue, index): SkillCheckGmSubjectProjectionV1 => {
    const path = `projection.subjects[${index}]`
    const subject = record(subjectValue, path)
    exact(subject, ['subjectId', 'label', 'modifierAuthority'], path)
    parseSkillCheckSubjectId(subject.subjectId)
    text(subject.label, `${path}.label`, 120)
    if (subject.subjectId !== document.subjects[index]?.subjectId) return fail(`${path}.subjectId`)
    const authority = record(subject.modifierAuthority, `${path}.modifierAuthority`)
    if (authority.status === 'unavailable') {
      exact(authority, ['status', 'reason'], `${path}.modifierAuthority`)
      if (authority.reason !== 'skill-authority-unavailable') return fail(`${path}.modifierAuthority`)
    }
    else {
      exact(authority, ['status', 'diceCount', 'flatModifier', 'contributors'], `${path}.modifierAuthority`)
      if (authority.status !== 'available' || !Array.isArray(authority.contributors) || authority.contributors.length > 100) {
        return fail(`${path}.modifierAuthority`)
      }
      integer(authority.diceCount, `${path}.modifierAuthority.diceCount`, 1, 6)
      integer(authority.flatModifier, `${path}.modifierAuthority.flatModifier`, -100, 100)
      authority.contributors = authority.contributors.map((contributor, contributorIndex) => (
        parseContributor(contributor, `${path}.modifierAuthority.contributors[${contributorIndex}]`)
      ))
      if ((authority.contributors as SkillCheckModifierContributorV1[])
        .reduce((sum, contributor) => sum + contributor.value, 0) !== authority.flatModifier) {
        return fail(`${path}.modifierAuthority.flatModifier`)
      }
    }
    return subject as unknown as SkillCheckGmSubjectProjectionV1
  })
  candidate.document = document
  candidate.subjects = subjects
  return deepFreeze(candidate as unknown as SkillCheckGmProjectionV1)
}

const parseSpectatorHistory = (value: unknown, index: number): SkillCheckSpectatorHistoryEntryV1 => {
  const path = `projection.history[${index}]`
  const candidate = record(value, path)
  exact(candidate, ['entryId', 'kind', 'headline', 'createdAt'], path)
  if (typeof candidate.entryId !== 'string'
    || !/^skill-check-public-history:v1:[a-z0-9][a-z0-9-]{0,79}$/u.test(candidate.entryId)
    || !['requested', 'accepted', 'cancelled', 'timed-out', 'corrected'].includes(String(candidate.kind))) return fail(path)
  text(candidate.headline, `${path}.headline`, 200)
  integer(candidate.createdAt, `${path}.createdAt`)
  return candidate as unknown as SkillCheckSpectatorHistoryEntryV1
}

export const parseSkillCheckSpectatorProjection = (value: unknown): SkillCheckSpectatorProjectionV1 => {
  const candidate = structuredClone(record(value, 'projection'))
  exact(candidate, [
    'schemaVersion', 'projection', 'checkId', 'revision', 'state', 'publicLabel', 'pendingCount',
    'result', 'history', 'updatedAt',
  ], 'projection')
  if (candidate.schemaVersion !== 1 || candidate.projection !== 'spectator'
    || !SKILL_CHECK_STATES.includes(candidate.state as never) || !Array.isArray(candidate.history)) return fail('projection')
  parseSkillCheckId(candidate.checkId)
  integer(candidate.revision, 'projection.revision', 1)
  text(candidate.publicLabel, 'projection.publicLabel', 120)
  integer(candidate.pendingCount, 'projection.pendingCount', 0, 32)
  if (candidate.result !== null) {
    const result = record(candidate.result, 'projection.result')
    exact(result, ['visibility', 'successfulSubjects', 'failedSubjects', 'winners', 'losers'], 'projection.result')
    if (result.visibility !== 'visible' && result.visibility !== 'withheld') return fail('projection.result.visibility')
    for (const field of ['successfulSubjects', 'failedSubjects', 'winners', 'losers'] as const) {
      if (result.visibility === 'visible') integer(result[field], `projection.result.${field}`, 0, 32)
      else if (result[field] !== null) return fail(`projection.result.${field}`)
    }
  }
  if ((candidate.state === 'accepted') !== (candidate.result !== null)) return fail('projection.result')
  candidate.history = candidate.history.map(parseSpectatorHistory)
  const historyEntries = candidate.history as SkillCheckSpectatorHistoryEntryV1[]
  const historyIds = historyEntries.map(entry => entry.entryId)
  const updatedAt = integer(candidate.updatedAt, 'projection.updatedAt')
  if (new Set(historyIds).size !== historyIds.length || historyEntries[0]?.kind !== 'requested'
    || historyEntries.some((entry, index) => entry.createdAt > updatedAt
      || (index > 0 && entry.createdAt < historyEntries[index - 1]!.createdAt))) return fail('projection.history')
  const terminalHistoryKind = candidate.state === 'accepted'
    ? 'accepted'
    : candidate.state === 'cancelled'
      ? 'cancelled'
      : candidate.state === 'timed-out'
        ? 'timed-out'
        : null
  if (terminalHistoryKind === null
    ? historyEntries.some(entry => ['accepted', 'cancelled', 'timed-out', 'corrected'].includes(entry.kind))
    : !historyEntries.some(entry => entry.kind === terminalHistoryKind)) return fail('projection.history')
  return deepFreeze(candidate as unknown as SkillCheckSpectatorProjectionV1)
}

export const parseSkillCheckRoleProjectionResponse = (value: unknown): SkillCheckRoleProjectionResponseV1 => {
  const candidate = structuredClone(record(value, 'response'))
  exact(candidate, ['schemaVersion', 'audience', 'checks', 'serverNow'], 'response')
  if (candidate.schemaVersion !== 1 || !['gm', 'subject', 'spectator'].includes(String(candidate.audience))
    || !Array.isArray(candidate.checks) || candidate.checks.length > 500) return fail('response')
  candidate.serverNow = integer(candidate.serverNow, 'response.serverNow')
  candidate.checks = candidate.checks.map(check => {
    if (candidate.audience === 'gm') return parseSkillCheckGmProjection(check)
    if (candidate.audience === 'subject') return parseSkillCheckSubjectRequestView(check)
    return parseSkillCheckSpectatorProjection(check)
  })
  return deepFreeze(candidate as unknown as SkillCheckRoleProjectionResponseV1)
}
