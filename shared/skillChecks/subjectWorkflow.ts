import { SKILL_CHECK_SKILL_IDS, SKILL_CHECK_STATES, parseSkillCheckId, parseSkillCheckOperationId, parseSkillCheckSubjectId, type RespondSkillCheckCommandV1, type SkillCheckAcceptedResultV1, type SkillCheckResponse, type SkillCheckState } from './contract'

export type SkillCheckSubjectUnavailableReason =
  | 'already-responded'
  | 'check-not-pending'
  | 'expired-awaiting-timeout'
  | 'skill-authority-unavailable'

export interface SkillCheckSubjectModifierContributorViewV1 {
  readonly label: string
  readonly value: number
}

export type SkillCheckSubjectSkillAuthorityV1 =
  | {
      readonly status: 'available'
      readonly skillId: typeof SKILL_CHECK_SKILL_IDS[number]
      readonly diceCount: number
      readonly visibleFlatModifier: number
      readonly contributors: readonly SkillCheckSubjectModifierContributorViewV1[]
      readonly privateGmAdjustment: 'none' | 'may-apply'
    }
  | {
      readonly status: 'unavailable'
      readonly skillId: typeof SKILL_CHECK_SKILL_IDS[number]
      readonly reason: 'skill-authority-unavailable'
    }

export type SkillCheckSubjectComparisonViewV1 =
  | {
      readonly kind: 'dc'
      readonly difficultyClass: number | null
      readonly disclosure: 'visible' | 'after-acceptance' | 'gm-only'
    }
  | {
      readonly kind: 'opposed'
      readonly tiePolicyLabel: 'Server rerolls ties, then uses a journaled fair coin after ten ties.'
    }

export interface SkillCheckSubjectResultViewV1 {
  readonly visibility: 'visible' | 'withheld'
  readonly finalTotal: number | null
  readonly outcome: SkillCheckAcceptedResultV1['outcome'] | null
}

export interface SkillCheckSubjectHistoryEntryViewV1 {
  readonly entryId: `skill-check-subject-history:v1:${string}`
  readonly kind: 'requested' | 'responded' | 'accepted' | 'cancelled' | 'timed-out' | 'corrected'
  readonly headline: string
  readonly createdAt: number
}

export interface SkillCheckSubjectRequestViewV1 {
  readonly schemaVersion: 1
  readonly projection: 'subject'
  readonly checkId: `skill-check:v1:${string}`
  readonly revision: number
  readonly state: SkillCheckState
  readonly subjectId: `skill-check-subject:v1:${string}`
  readonly subjectKind: 'trainer' | 'pokemon'
  readonly subjectLabel: string
  readonly publicLabel: string
  readonly prompt: string
  readonly response: SkillCheckResponse
  readonly skillAuthority: SkillCheckSubjectSkillAuthorityV1
  readonly comparison: SkillCheckSubjectComparisonViewV1
  readonly group: {
    readonly subjectCount: number
    readonly acceptedCount: number
  }
  readonly canRespond: boolean
  readonly canDecline: boolean
  readonly unavailableReason: SkillCheckSubjectUnavailableReason | null
  readonly result: SkillCheckSubjectResultViewV1 | null
  readonly history: readonly SkillCheckSubjectHistoryEntryViewV1[]
  readonly expiresAt: number | null
  readonly updatedAt: number
}

export interface LoadSubjectSkillChecksResponseV1 {
  readonly schemaVersion: 1
  readonly requests: readonly SkillCheckSubjectRequestViewV1[]
  readonly serverNow: number
}

export interface RespondSubjectSkillCheckReceiptV1 {
  readonly schemaVersion: 1
  readonly operationId: RespondSkillCheckCommandV1['operationId']
  readonly checkId: RespondSkillCheckCommandV1['checkId']
  readonly subjectId: RespondSkillCheckCommandV1['subjectId']
  readonly commandKind: 'respond'
  readonly revision: number
  readonly state: SkillCheckState
  readonly response: Exclude<SkillCheckResponse, 'pending'>
  readonly updatedAt: number
  readonly exactReplay: boolean
}

export interface RespondSubjectSkillCheckResponseV1 {
  readonly schemaVersion: 1
  readonly receipt: RespondSubjectSkillCheckReceiptV1
  readonly request: SkillCheckSubjectRequestViewV1
}

const fail = (path: string): never => { throw new Error(`skill-check.invalid-subject-workflow-response:${path}`) }
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
const nullableInteger = (value: unknown, path: string): number | null => value === null ? null : integer(value, path)
const deepFreeze = <Value>(value: Value): Value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

const parseSkillAuthority = (value: unknown, path: string): SkillCheckSubjectSkillAuthorityV1 => {
  const candidate = record(value, path)
  if (candidate.status === 'unavailable') {
    exact(candidate, ['status', 'skillId', 'reason'], path)
    if (!SKILL_CHECK_SKILL_IDS.includes(candidate.skillId as never) || candidate.reason !== 'skill-authority-unavailable') return fail(path)
    return candidate as unknown as SkillCheckSubjectSkillAuthorityV1
  }
  exact(candidate, ['status', 'skillId', 'diceCount', 'visibleFlatModifier', 'contributors', 'privateGmAdjustment'], path)
  if (candidate.status !== 'available' || !SKILL_CHECK_SKILL_IDS.includes(candidate.skillId as never)
    || (candidate.privateGmAdjustment !== 'none' && candidate.privateGmAdjustment !== 'may-apply')) return fail(path)
  integer(candidate.diceCount, `${path}.diceCount`, 1, 6)
  integer(candidate.visibleFlatModifier, `${path}.visibleFlatModifier`, -100, 100)
  if (!Array.isArray(candidate.contributors) || candidate.contributors.length > 100) return fail(`${path}.contributors`)
  for (const [index, contributorValue] of candidate.contributors.entries()) {
    const contributor = record(contributorValue, `${path}.contributors[${index}]`)
    exact(contributor, ['label', 'value'], `${path}.contributors[${index}]`)
    text(contributor.label, `${path}.contributors[${index}].label`, 200)
    integer(contributor.value, `${path}.contributors[${index}].value`, -100, 100)
  }
  const visibleTotal = (candidate.contributors as Array<{ value: number }>).reduce((sum, contributor) => sum + contributor.value, 0)
  if (visibleTotal !== candidate.visibleFlatModifier) return fail(`${path}.visibleFlatModifier`)
  return candidate as unknown as SkillCheckSubjectSkillAuthorityV1
}

const parseComparison = (value: unknown, path: string): SkillCheckSubjectComparisonViewV1 => {
  const candidate = record(value, path)
  if (candidate.kind === 'opposed') {
    exact(candidate, ['kind', 'tiePolicyLabel'], path)
    if (candidate.tiePolicyLabel !== 'Server rerolls ties, then uses a journaled fair coin after ten ties.') return fail(path)
    return candidate as unknown as SkillCheckSubjectComparisonViewV1
  }
  exact(candidate, ['kind', 'difficultyClass', 'disclosure'], path)
  if (candidate.kind !== 'dc' || !['visible', 'after-acceptance', 'gm-only'].includes(String(candidate.disclosure))) return fail(path)
  if (candidate.difficultyClass !== null) integer(candidate.difficultyClass, `${path}.difficultyClass`, 1, 100)
  if (candidate.disclosure === 'visible' && candidate.difficultyClass === null) return fail(path)
  if (candidate.disclosure !== 'visible' && candidate.difficultyClass !== null && candidate.disclosure === 'gm-only') return fail(path)
  return candidate as unknown as SkillCheckSubjectComparisonViewV1
}

export const parseSkillCheckSubjectRequestView = (value: unknown): SkillCheckSubjectRequestViewV1 => {
  const candidate = structuredClone(record(value, 'request'))
  exact(candidate, [
    'schemaVersion', 'projection', 'checkId', 'revision', 'state', 'subjectId', 'subjectKind', 'subjectLabel',
    'publicLabel', 'prompt', 'response', 'skillAuthority', 'comparison', 'group', 'canRespond', 'canDecline',
    'unavailableReason', 'result', 'history', 'expiresAt', 'updatedAt',
  ], 'request')
  if (candidate.schemaVersion !== 1 || candidate.projection !== 'subject'
    || !SKILL_CHECK_STATES.includes(candidate.state as never)
    || (candidate.subjectKind !== 'trainer' && candidate.subjectKind !== 'pokemon')
    || !['pending', 'accepted', 'declined'].includes(String(candidate.response))
    || typeof candidate.canRespond !== 'boolean' || typeof candidate.canDecline !== 'boolean') return fail('request')
  parseSkillCheckId(candidate.checkId)
  parseSkillCheckSubjectId(candidate.subjectId)
  integer(candidate.revision, 'request.revision', 1)
  text(candidate.subjectLabel, 'request.subjectLabel', 120)
  text(candidate.publicLabel, 'request.publicLabel', 120)
  text(candidate.prompt, 'request.prompt', 2000)
  candidate.skillAuthority = parseSkillAuthority(candidate.skillAuthority, 'request.skillAuthority')
  candidate.comparison = parseComparison(candidate.comparison, 'request.comparison')
  const group = record(candidate.group, 'request.group')
  exact(group, ['subjectCount', 'acceptedCount'], 'request.group')
  const subjectCount = integer(group.subjectCount, 'request.group.subjectCount', 1, 32)
  const acceptedCount = integer(group.acceptedCount, 'request.group.acceptedCount', 0, subjectCount)
  if (acceptedCount > subjectCount) return fail('request.group')
  const reasons: readonly unknown[] = [null, 'already-responded', 'check-not-pending', 'expired-awaiting-timeout', 'skill-authority-unavailable']
  if (!reasons.includes(candidate.unavailableReason)) return fail('request.unavailableReason')
  if (candidate.canDecline && !candidate.canRespond) return fail('request.canDecline')
  if (candidate.canRespond !== (candidate.unavailableReason === null)) return fail('request.unavailableReason')
  if (candidate.canRespond && candidate.response !== 'pending') return fail('request.response')
  if (candidate.result !== null) {
    const result = record(candidate.result, 'request.result')
    exact(result, ['visibility', 'finalTotal', 'outcome'], 'request.result')
    if (result.visibility !== 'visible' && result.visibility !== 'withheld') return fail('request.result.visibility')
    if (result.visibility === 'visible') {
      integer(result.finalTotal, 'request.result.finalTotal', -100, 1000)
      if (!['success', 'failure', 'winner', 'loser'].includes(String(result.outcome))) return fail('request.result.outcome')
    }
    else if (result.finalTotal !== null || result.outcome !== null) return fail('request.result')
  }
  if (!Array.isArray(candidate.history) || candidate.history.length > 5000) return fail('request.history')
  for (const [index, historyValue] of candidate.history.entries()) {
    const path = `request.history[${index}]`
    const history = record(historyValue, path)
    exact(history, ['entryId', 'kind', 'headline', 'createdAt'], path)
    if (typeof history.entryId !== 'string'
      || !/^skill-check-subject-history:v1:[a-z0-9][a-z0-9-]{0,79}$/u.test(history.entryId)
      || !['requested', 'responded', 'accepted', 'cancelled', 'timed-out', 'corrected'].includes(String(history.kind))) return fail(path)
    text(history.headline, `${path}.headline`, 200)
    integer(history.createdAt, `${path}.createdAt`)
  }
  const historyEntries = candidate.history as Array<{ entryId: string, kind: string, createdAt: number }>
  const historyIds = historyEntries.map(entry => entry.entryId)
  if (new Set(historyIds).size !== historyIds.length || historyEntries[0]?.kind !== 'requested') return fail('request.history')
  nullableInteger(candidate.expiresAt, 'request.expiresAt')
  const updatedAt = integer(candidate.updatedAt, 'request.updatedAt')
  if (historyEntries.some((entry, index) => entry.createdAt > updatedAt
    || (index > 0 && entry.createdAt < historyEntries[index - 1]!.createdAt))) return fail('request.history')
  const terminalHistoryKind = candidate.state === 'accepted'
    ? 'accepted'
    : candidate.state === 'cancelled'
      ? 'cancelled'
      : candidate.state === 'timed-out'
        ? 'timed-out'
        : null
  if ((candidate.state === 'accepted') !== (candidate.result !== null)
    || (terminalHistoryKind === null
      ? historyEntries.some(entry => ['accepted', 'cancelled', 'timed-out', 'corrected'].includes(entry.kind))
      : !historyEntries.some(entry => entry.kind === terminalHistoryKind))) return fail('request.history')
  return deepFreeze(candidate as unknown as SkillCheckSubjectRequestViewV1)
}

export const parseLoadSubjectSkillChecksResponse = (value: unknown): LoadSubjectSkillChecksResponseV1 => {
  const candidate = structuredClone(record(value, 'response'))
  exact(candidate, ['schemaVersion', 'requests', 'serverNow'], 'response')
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.requests) || candidate.requests.length > 500) return fail('response')
  candidate.serverNow = integer(candidate.serverNow, 'response.serverNow')
  candidate.requests = candidate.requests.map(parseSkillCheckSubjectRequestView)
  const keys = (candidate.requests as SkillCheckSubjectRequestViewV1[]).map(request => `${request.checkId}:${request.subjectId}`)
  if (new Set(keys).size !== keys.length) return fail('response.requests')
  return deepFreeze(candidate as unknown as LoadSubjectSkillChecksResponseV1)
}

const parseReceipt = (value: unknown): RespondSubjectSkillCheckReceiptV1 => {
  const candidate = record(value, 'receipt')
  exact(candidate, ['schemaVersion', 'operationId', 'checkId', 'subjectId', 'commandKind', 'revision', 'state', 'response', 'updatedAt', 'exactReplay'], 'receipt')
  if (candidate.schemaVersion !== 1 || candidate.commandKind !== 'respond'
    || !SKILL_CHECK_STATES.includes(candidate.state as never)
    || (candidate.response !== 'accepted' && candidate.response !== 'declined')
    || typeof candidate.exactReplay !== 'boolean') return fail('receipt')
  parseSkillCheckOperationId(candidate.operationId)
  parseSkillCheckId(candidate.checkId)
  parseSkillCheckSubjectId(candidate.subjectId)
  integer(candidate.revision, 'receipt.revision', 2)
  integer(candidate.updatedAt, 'receipt.updatedAt')
  if (candidate.response === 'accepted' && candidate.state !== 'pending' && candidate.state !== 'ready') return fail('receipt.state')
  if (candidate.response === 'declined' && candidate.state !== 'pending') return fail('receipt.state')
  return candidate as unknown as RespondSubjectSkillCheckReceiptV1
}

export const parseRespondSubjectSkillCheckResponse = (value: unknown): RespondSubjectSkillCheckResponseV1 => {
  const candidate = structuredClone(record(value, 'response'))
  exact(candidate, ['schemaVersion', 'receipt', 'request'], 'response')
  if (candidate.schemaVersion !== 1) return fail('response.schemaVersion')
  const receipt = parseReceipt(candidate.receipt)
  const request = parseSkillCheckSubjectRequestView(candidate.request)
  if (receipt.checkId !== request.checkId || receipt.subjectId !== request.subjectId
    || receipt.revision > request.revision || receipt.updatedAt > request.updatedAt
    || (receipt.revision === request.revision
      && (receipt.state !== request.state || receipt.response !== request.response || receipt.updatedAt !== request.updatedAt))) {
    return fail('response.authority')
  }
  return deepFreeze({ schemaVersion: 1, receipt, request })
}
