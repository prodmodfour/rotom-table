export const CAPABILITY_RUNTIME_STATE_SCHEMA_VERSION = 1 as const
export const CAPABILITY_USAGE_LEDGER_SCHEMA_VERSION = 1 as const

export const CAPABILITY_USAGE_PERIODS = ['daily', 'weekly', 'hourly', 'cooldown'] as const
export type CapabilityUsagePeriod = typeof CAPABILITY_USAGE_PERIODS[number]

export interface CapabilityUsageEntry {
  readonly id: string
  readonly canonicalId: string
  readonly actionId: string
  readonly capabilityInstanceId: string
  readonly period: CapabilityUsagePeriod
  readonly usedAt: number
  readonly availableAt: number | null
  /** Weekly uses count down authoritative campaign-day transitions, not wall-clock guesses. */
  readonly remainingDayAdvances: number | null
  readonly sourceOperationId: string
}

export interface CapabilityUsageLedger {
  readonly schemaVersion: typeof CAPABILITY_USAGE_LEDGER_SCHEMA_VERSION
  readonly entries: readonly CapabilityUsageEntry[]
}

export const CAPABILITY_MODE_KINDS = [
  'blended', 'glowing', 'illusion', 'inflated', 'invisible', 'intangible',
  'shadow-melded', 'shapechanged', 'shrunken', 'crowned', 'inside-machine',
  'zygarde-form', 'mega-evolved',
] as const
export type CapabilityModeKind = typeof CAPABILITY_MODE_KINDS[number]

export interface CapabilityModeState {
  readonly id: string
  readonly actorPlacementId: string
  readonly capabilityInstanceId: string
  readonly canonicalId: string
  readonly mode: CapabilityModeKind
  readonly description: string | null
  /** Retained non-prose branch parameters for this mode. */
  readonly configurationId: string | null
  readonly activatedAt: number
  readonly expiresAt: number | null
  readonly sourceOperationId: string
}

export const CAPABILITY_LINK_KINDS = [
  'as-one-mount', 'mount-rider', 'living-weapon', 'viral-fusion',
  'letter-press', 'zygarde-assembly', 'shadow-rider', 'marsupial-pouch',
] as const
export type CapabilityLinkKind = typeof CAPABILITY_LINK_KINDS[number]

export interface CapabilityLinkState {
  readonly id: string
  readonly kind: CapabilityLinkKind
  readonly ownerPlacementId: string
  readonly participantPlacementIds: readonly string[]
  readonly capabilityInstanceId: string
  readonly canonicalId: string
  readonly establishedAt: number
  /** Retained bounded choice such as a Viral Fusion signature Move. */
  readonly configurationId: string | null
  readonly sourceOperationId: string
}

export const CAPABILITY_TASK_KINDS = ['juicer', 'planter'] as const
export type CapabilityTaskKind = typeof CAPABILITY_TASK_KINDS[number]

export interface CapabilityCampaignTaskState {
  readonly id: string
  readonly kind: CapabilityTaskKind
  readonly actorPlacementId: string
  readonly capabilityInstanceId: string
  readonly canonicalId: string
  readonly inputCanonicalItemId: string | null
  readonly outputCanonicalItemId: string | null
  readonly startedAt: number
  readonly completesAt: number
  readonly sourceOperationId: string
}

export interface CapabilityPendingAdjudicationState {
  readonly requestId: string
  readonly actorPlacementId: string
  readonly capabilityInstanceId: string
  readonly canonicalId: string
  readonly actionId: string
  readonly requestedAt: number
  readonly expiresAt: number
  readonly sourceOperationId: string
}

export interface CapabilityCheckPenaltyState {
  readonly id: string
  readonly actorPlacementId: string
  readonly targetPlacementId: string
  readonly canonicalId: string
  readonly actionId: string
  readonly value: number
  readonly expiresAt: number
  readonly sourceOperationId: string
}

export interface CapabilityRuntimeState {
  readonly schemaVersion: typeof CAPABILITY_RUNTIME_STATE_SCHEMA_VERSION
  readonly usages: CapabilityUsageLedger
  readonly modes: readonly CapabilityModeState[]
  readonly links: readonly CapabilityLinkState[]
  readonly tasks: readonly CapabilityCampaignTaskState[]
  /** Public-safe summaries; private command choices remain in SQLite. */
  readonly pendingAdjudications: readonly CapabilityPendingAdjudicationState[]
  /** Per-target retry modifiers such as cumulative Telepathy failures. */
  readonly checkPenalties: readonly CapabilityCheckPenaltyState[]
}

export const CAPABILITY_STATE_LIMITS = Object.freeze({
  usages: 256,
  modes: 128,
  links: 64,
  tasks: 64,
  pendingAdjudications: 64,
  checkPenalties: 256,
  participantIds: 256,
  identifierChars: 240,
  canonicalChars: 160,
  descriptionChars: 500,
  timestamp: 9_007_199_254_740_991,
})

export class CapabilityStateValidationError extends Error {
  readonly code: 'invalid-capability-state' | 'limit-exceeded' | 'duplicate-id'
  constructor(code: CapabilityStateValidationError['code'], readonly path: string, readonly detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'CapabilityStateValidationError'
    this.code = code
  }
}

type UnknownRecord = Record<string, unknown>
const fail = (code: CapabilityStateValidationError['code'], path: string, detail: string): never => {
  throw new CapabilityStateValidationError(code, path, detail)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('invalid-capability-state', path, 'must be a plain object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.hasOwn(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length || unknown.length) fail('invalid-capability-state', path, `has invalid fields (missing ${missing.join(', ') || 'none'}; unknown ${unknown.join(', ') || 'none'}).`)
}
const boundedText = (value: unknown, path: string, maximum: number = CAPABILITY_STATE_LIMITS.identifierChars): string => {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) fail('invalid-capability-state', path, `must be trimmed text of at most ${maximum} characters.`)
  return value as string
}
const timestamp = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail('invalid-capability-state', path, 'must be a non-negative timestamp.')
  return value as number
}
const nullableTimestamp = (value: unknown, path: string): number | null => value === null ? null : timestamp(value, path)
const member = <T extends string>(set: readonly T[], value: unknown, path: string): T => {
  if (typeof value !== 'string' || !(set as readonly string[]).includes(value)) fail('invalid-capability-state', path, `must be one of ${set.join(', ')}.`)
  return value as T
}
const boundedList = (value: unknown, path: string, maximum: number): readonly unknown[] => {
  if (!Array.isArray(value)) fail('invalid-capability-state', path, 'must be an array.')
  const entries = value as unknown[]
  if (entries.length > maximum) fail('limit-exceeded', path, `must have at most ${maximum} entries.`)
  return entries
}
const assertUnique = (entries: readonly { readonly id: string }[], path: string): void => {
  const seen = new Set<string>()
  entries.forEach((entry, index) => {
    if (seen.has(entry.id)) fail('duplicate-id', `${path}[${index}].id`, `duplicates ${entry.id}.`)
    seen.add(entry.id)
  })
}

export const createEmptyCapabilityUsageLedger = (): CapabilityUsageLedger => ({ schemaVersion: 1, entries: [] })
export const createEmptyCapabilityRuntimeState = (): CapabilityRuntimeState => ({
  schemaVersion: 1,
  usages: createEmptyCapabilityUsageLedger(),
  modes: [],
  links: [],
  tasks: [],
  pendingAdjudications: [],
  checkPenalties: [],
})

export const parseCapabilityUsageLedger = (
  value: unknown,
  path = 'capabilityUsage',
): CapabilityUsageLedger => {
  const root = record(value, path)
  exact(root, ['schemaVersion', 'entries'], path)
  if (root.schemaVersion !== 1) fail('invalid-capability-state', `${path}.schemaVersion`, 'must be 1.')
  const entries = boundedList(root.entries, `${path}.entries`, CAPABILITY_STATE_LIMITS.usages).map((candidate, index): CapabilityUsageEntry => {
    const itemPath = `${path}.entries[${index}]`
    const entry = record(candidate, itemPath)
    exact(entry, ['id', 'canonicalId', 'actionId', 'capabilityInstanceId', 'period', 'usedAt', 'availableAt', 'remainingDayAdvances', 'sourceOperationId'], itemPath)
    const period = member(CAPABILITY_USAGE_PERIODS, entry.period, `${itemPath}.period`)
    const remaining = entry.remainingDayAdvances === null ? null : timestamp(entry.remainingDayAdvances, `${itemPath}.remainingDayAdvances`)
    if ((period === 'weekly') !== (remaining !== null)) fail('invalid-capability-state', `${itemPath}.remainingDayAdvances`, 'must be present exactly for weekly usage.')
    const availableAt = nullableTimestamp(entry.availableAt, `${itemPath}.availableAt`)
    if ((period === 'hourly' || period === 'cooldown') !== (availableAt !== null)) fail('invalid-capability-state', `${itemPath}.availableAt`, 'must be present exactly for hourly/cooldown usage.')
    return Object.freeze({
      id: boundedText(entry.id, `${itemPath}.id`),
      canonicalId: boundedText(entry.canonicalId, `${itemPath}.canonicalId`, CAPABILITY_STATE_LIMITS.canonicalChars),
      actionId: boundedText(entry.actionId, `${itemPath}.actionId`),
      capabilityInstanceId: boundedText(entry.capabilityInstanceId, `${itemPath}.capabilityInstanceId`),
      period,
      usedAt: timestamp(entry.usedAt, `${itemPath}.usedAt`),
      availableAt,
      remainingDayAdvances: remaining,
      sourceOperationId: boundedText(entry.sourceOperationId, `${itemPath}.sourceOperationId`),
    })
  })
  assertUnique(entries, `${path}.entries`)
  return Object.freeze({ schemaVersion: 1, entries: Object.freeze(entries) })
}

export const parseCapabilityRuntimeState = (
  value: unknown,
  path = 'capabilityRuntime',
): CapabilityRuntimeState => {
  const parsedRoot = record(value, path)
  const root: UnknownRecord = {
    ...parsedRoot,
    ...(Object.hasOwn(parsedRoot, 'pendingAdjudications') ? {} : { pendingAdjudications: [] }),
    ...(Object.hasOwn(parsedRoot, 'checkPenalties') ? {} : { checkPenalties: [] }),
  }
  exact(root, ['schemaVersion', 'usages', 'modes', 'links', 'tasks', 'pendingAdjudications', 'checkPenalties'], path)
  if (root.schemaVersion !== 1) fail('invalid-capability-state', `${path}.schemaVersion`, 'must be 1.')
  const modes = boundedList(root.modes, `${path}.modes`, CAPABILITY_STATE_LIMITS.modes).map((candidate, index): CapabilityModeState => {
    const itemPath = `${path}.modes[${index}]`
    const entry = record(candidate, itemPath)
    const normalizedEntry: UnknownRecord = Object.hasOwn(entry, 'configurationId') ? entry : { ...entry, configurationId: null }
    exact(normalizedEntry, ['id', 'actorPlacementId', 'capabilityInstanceId', 'canonicalId', 'mode', 'description', 'configurationId', 'activatedAt', 'expiresAt', 'sourceOperationId'], itemPath)
    return Object.freeze({
      id: boundedText(normalizedEntry.id, `${itemPath}.id`),
      actorPlacementId: boundedText(entry.actorPlacementId, `${itemPath}.actorPlacementId`),
      capabilityInstanceId: boundedText(entry.capabilityInstanceId, `${itemPath}.capabilityInstanceId`),
      canonicalId: boundedText(entry.canonicalId, `${itemPath}.canonicalId`, CAPABILITY_STATE_LIMITS.canonicalChars),
      mode: member(CAPABILITY_MODE_KINDS, entry.mode, `${itemPath}.mode`),
      description: normalizedEntry.description === null ? null : boundedText(normalizedEntry.description, `${itemPath}.description`, CAPABILITY_STATE_LIMITS.descriptionChars),
      configurationId: normalizedEntry.configurationId === null ? null : boundedText(normalizedEntry.configurationId, `${itemPath}.configurationId`, CAPABILITY_STATE_LIMITS.descriptionChars),
      activatedAt: timestamp(normalizedEntry.activatedAt, `${itemPath}.activatedAt`),
      expiresAt: nullableTimestamp(entry.expiresAt, `${itemPath}.expiresAt`),
      sourceOperationId: boundedText(entry.sourceOperationId, `${itemPath}.sourceOperationId`),
    })
  })
  const links = boundedList(root.links, `${path}.links`, CAPABILITY_STATE_LIMITS.links).map((candidate, index): CapabilityLinkState => {
    const itemPath = `${path}.links[${index}]`
    const entry = record(candidate, itemPath)
    const normalizedEntry: UnknownRecord = Object.hasOwn(entry, 'configurationId') ? entry : { ...entry, configurationId: null }
    exact(normalizedEntry, ['id', 'kind', 'ownerPlacementId', 'participantPlacementIds', 'capabilityInstanceId', 'canonicalId', 'establishedAt', 'configurationId', 'sourceOperationId'], itemPath)
    const participants = boundedList(entry.participantPlacementIds, `${itemPath}.participantPlacementIds`, CAPABILITY_STATE_LIMITS.participantIds)
      .map((id, participantIndex) => boundedText(id, `${itemPath}.participantPlacementIds[${participantIndex}]`))
    if (!participants.length || new Set(participants).size !== participants.length) fail('invalid-capability-state', `${itemPath}.participantPlacementIds`, 'must contain unique participants.')
    return Object.freeze({
      id: boundedText(entry.id, `${itemPath}.id`),
      kind: member(CAPABILITY_LINK_KINDS, entry.kind, `${itemPath}.kind`),
      ownerPlacementId: boundedText(entry.ownerPlacementId, `${itemPath}.ownerPlacementId`),
      participantPlacementIds: Object.freeze(participants),
      capabilityInstanceId: boundedText(entry.capabilityInstanceId, `${itemPath}.capabilityInstanceId`),
      canonicalId: boundedText(entry.canonicalId, `${itemPath}.canonicalId`, CAPABILITY_STATE_LIMITS.canonicalChars),
      establishedAt: timestamp(entry.establishedAt, `${itemPath}.establishedAt`),
      configurationId: normalizedEntry.configurationId === null
        ? null
        : boundedText(normalizedEntry.configurationId, `${itemPath}.configurationId`, CAPABILITY_STATE_LIMITS.canonicalChars),
      sourceOperationId: boundedText(normalizedEntry.sourceOperationId, `${itemPath}.sourceOperationId`),
    })
  })
  const tasks = boundedList(root.tasks, `${path}.tasks`, CAPABILITY_STATE_LIMITS.tasks).map((candidate, index): CapabilityCampaignTaskState => {
    const itemPath = `${path}.tasks[${index}]`
    const entry = record(candidate, itemPath)
    exact(entry, ['id', 'kind', 'actorPlacementId', 'capabilityInstanceId', 'canonicalId', 'inputCanonicalItemId', 'outputCanonicalItemId', 'startedAt', 'completesAt', 'sourceOperationId'], itemPath)
    const startedAt = timestamp(entry.startedAt, `${itemPath}.startedAt`)
    const completesAt = timestamp(entry.completesAt, `${itemPath}.completesAt`)
    if (completesAt <= startedAt) fail('invalid-capability-state', `${itemPath}.completesAt`, 'must be after startedAt.')
    const nullableId = (candidateValue: unknown, candidatePath: string): string | null => candidateValue === null ? null : boundedText(candidateValue, candidatePath)
    return Object.freeze({
      id: boundedText(entry.id, `${itemPath}.id`),
      kind: member(CAPABILITY_TASK_KINDS, entry.kind, `${itemPath}.kind`),
      actorPlacementId: boundedText(entry.actorPlacementId, `${itemPath}.actorPlacementId`),
      capabilityInstanceId: boundedText(entry.capabilityInstanceId, `${itemPath}.capabilityInstanceId`),
      canonicalId: boundedText(entry.canonicalId, `${itemPath}.canonicalId`, CAPABILITY_STATE_LIMITS.canonicalChars),
      inputCanonicalItemId: nullableId(entry.inputCanonicalItemId, `${itemPath}.inputCanonicalItemId`),
      outputCanonicalItemId: nullableId(entry.outputCanonicalItemId, `${itemPath}.outputCanonicalItemId`),
      startedAt,
      completesAt,
      sourceOperationId: boundedText(entry.sourceOperationId, `${itemPath}.sourceOperationId`),
    })
  })
  const pendingAdjudications = boundedList(root.pendingAdjudications, `${path}.pendingAdjudications`, CAPABILITY_STATE_LIMITS.pendingAdjudications).map((candidate, index): CapabilityPendingAdjudicationState => {
    const itemPath = `${path}.pendingAdjudications[${index}]`
    const entry = record(candidate, itemPath)
    exact(entry, ['requestId', 'actorPlacementId', 'capabilityInstanceId', 'canonicalId', 'actionId', 'requestedAt', 'expiresAt', 'sourceOperationId'], itemPath)
    const requestedAt = timestamp(entry.requestedAt, `${itemPath}.requestedAt`)
    const expiresAt = timestamp(entry.expiresAt, `${itemPath}.expiresAt`)
    if (expiresAt <= requestedAt) fail('invalid-capability-state', `${itemPath}.expiresAt`, 'must be after requestedAt.')
    return Object.freeze({
      requestId: boundedText(entry.requestId, `${itemPath}.requestId`),
      actorPlacementId: boundedText(entry.actorPlacementId, `${itemPath}.actorPlacementId`),
      capabilityInstanceId: boundedText(entry.capabilityInstanceId, `${itemPath}.capabilityInstanceId`),
      canonicalId: boundedText(entry.canonicalId, `${itemPath}.canonicalId`, CAPABILITY_STATE_LIMITS.canonicalChars),
      actionId: boundedText(entry.actionId, `${itemPath}.actionId`),
      requestedAt,
      expiresAt,
      sourceOperationId: boundedText(entry.sourceOperationId, `${itemPath}.sourceOperationId`),
    })
  })
  const checkPenalties = boundedList(root.checkPenalties, `${path}.checkPenalties`, CAPABILITY_STATE_LIMITS.checkPenalties).map((candidate, index): CapabilityCheckPenaltyState => {
    const itemPath = `${path}.checkPenalties[${index}]`
    const entry = record(candidate, itemPath)
    exact(entry, ['id', 'actorPlacementId', 'targetPlacementId', 'canonicalId', 'actionId', 'value', 'expiresAt', 'sourceOperationId'], itemPath)
    if (!Number.isSafeInteger(entry.value) || (entry.value as number) >= 0 || (entry.value as number) < -1_000) {
      fail('invalid-capability-state', `${itemPath}.value`, 'must be a bounded negative integer.')
    }
    return Object.freeze({
      id: boundedText(entry.id, `${itemPath}.id`),
      actorPlacementId: boundedText(entry.actorPlacementId, `${itemPath}.actorPlacementId`),
      targetPlacementId: boundedText(entry.targetPlacementId, `${itemPath}.targetPlacementId`),
      canonicalId: boundedText(entry.canonicalId, `${itemPath}.canonicalId`, CAPABILITY_STATE_LIMITS.canonicalChars),
      actionId: boundedText(entry.actionId, `${itemPath}.actionId`),
      value: entry.value as number,
      expiresAt: timestamp(entry.expiresAt, `${itemPath}.expiresAt`),
      sourceOperationId: boundedText(entry.sourceOperationId, `${itemPath}.sourceOperationId`),
    })
  })
  assertUnique(modes, `${path}.modes`); assertUnique(links, `${path}.links`); assertUnique(tasks, `${path}.tasks`); assertUnique(checkPenalties, `${path}.checkPenalties`)
  if (new Set(pendingAdjudications.map(entry => entry.requestId)).size !== pendingAdjudications.length) {
    fail('duplicate-id', `${path}.pendingAdjudications`, 'contains duplicate request IDs.')
  }
  return Object.freeze({
    schemaVersion: 1,
    usages: parseCapabilityUsageLedger(root.usages, `${path}.usages`),
    modes: Object.freeze(modes),
    links: Object.freeze(links),
    tasks: Object.freeze(tasks),
    pendingAdjudications: Object.freeze(pendingAdjudications),
    checkPenalties: Object.freeze(checkPenalties),
  })
}

/** Apply one authoritative campaign-day boundary to lasting usage resources. */
export const advanceCapabilityUsageDay = (
  ledger: CapabilityUsageLedger | undefined,
  now: number,
): CapabilityUsageLedger | undefined => {
  if (!ledger) return undefined
  const parsed = parseCapabilityUsageLedger(ledger)
  const entries = parsed.entries.flatMap((entry): readonly CapabilityUsageEntry[] => {
    if (entry.period === 'daily') return []
    if (entry.period === 'weekly') {
      if ((entry.remainingDayAdvances ?? 1) <= 1) return []
      return [{ ...entry, remainingDayAdvances: (entry.remainingDayAdvances ?? 1) - 1 }]
    }
    if (entry.availableAt !== null && entry.availableAt <= now) return []
    return [entry]
  })
  return { schemaVersion: 1, entries }
}
