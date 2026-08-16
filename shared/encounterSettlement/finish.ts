import {
  parseEncounterSettlementCommitCommand,
  type EncounterSettlementCommitCommand,
} from './atomicCommit'
import type {
  EncounterSettlementCleanupKind,
  EncounterSettlementConsequenceKind,
  EncounterSettlementGateKind,
} from './document'

export const FINISH_ENCOUNTER_VIEW_SCHEMA_VERSION = 1 as const

export type FinishEncounterGateAction = 'return-to-encounter' | 'open-director' | 'refresh-review'

export interface FinishEncounterGateView {
  readonly kind: EncounterSettlementGateKind | 'outcome-decision' | 'reward-allocation' | 'capture-decision' | 'cleanup-blocker'
  readonly title: string
  readonly detail: string
  readonly action: FinishEncounterGateAction
  readonly actionLabel: string
}

export interface FinishEncounterConsequenceView {
  readonly kind: EncounterSettlementConsequenceKind
  readonly label: string
  readonly count: number
  readonly detail: string
}

export interface FinishEncounterRewardView {
  readonly kind: 'experience' | 'money' | 'item' | 'capture' | 'narrative'
  readonly label: string
  readonly amountLabel: string
  readonly destinationLabel: string
  readonly detail: string | null
}

export interface FinishEncounterOutcomeView {
  readonly kind: 'objective' | 'clock' | 'phase' | 'stake' | 'campaign-consequence' | 'encounter'
  readonly label: string
  readonly resultLabel: string
  readonly visibility: 'public' | 'gm'
}

export interface FinishEncounterCleanupView {
  readonly kind: EncounterSettlementCleanupKind
  readonly label: string
  readonly sourceCount: number
  readonly actionLabel: string
  readonly detail: string
}

export interface FinishEncounterOutstandingWorkView {
  readonly kind: 'level-threshold' | 'capture-review' | 'medical-review' | 'equipment-review' | 'continuation-review'
  readonly label: string
  readonly detail: string
}

export interface FinishEncounterContinuationView {
  readonly kind: 'encounter-library' | 'group-inventory' | 'campaign'
  readonly label: string
  readonly href: string
  readonly detail: string
}

export interface FinishEncounterAcceptedSummary {
  readonly completedAtCampaignMinute: number
  readonly changedSheetCount: number
  readonly changedGroupCount: number
  readonly historyFactCount: number
  readonly attentionSourceCount: number
  readonly replayed: boolean
}

export interface FinishEncounterView {
  readonly schemaVersion: typeof FINISH_ENCOUNTER_VIEW_SCHEMA_VERSION
  readonly state: 'ready' | 'blocked' | 'accepted'
  readonly encounterName: string
  readonly participantCount: number
  readonly readinessLabel: string
  readonly readinessDetail: string
  readonly gates: readonly FinishEncounterGateView[]
  readonly consequences: readonly FinishEncounterConsequenceView[]
  readonly rewards: readonly FinishEncounterRewardView[]
  readonly outcomes: readonly FinishEncounterOutcomeView[]
  readonly cleanup: readonly FinishEncounterCleanupView[]
  readonly outstandingWork: readonly FinishEncounterOutstandingWorkView[]
  readonly continuations: readonly FinishEncounterContinuationView[]
  /** Opaque GM-only command material. It is never rendered as user-facing evidence. */
  readonly command: EncounterSettlementCommitCommand | null
  readonly accepted: FinishEncounterAcceptedSummary | null
}

export class FinishEncounterViewParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FinishEncounterViewParseError'
  }
}

const fail = (path: string): never => {
  throw new FinishEncounterViewParseError(`Invalid Finish Encounter view at ${path}.`)
}
const object = (value: unknown, path: string): Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : fail(path)
)
const keys = (value: Record<string, unknown>, expected: readonly string[], path: string): void => {
  const actual = Object.keys(value).sort()
  const sorted = [...expected].sort()
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) fail(path)
}
const text = (value: unknown, path: string, max = 500): string => (
  typeof value === 'string' && value.trim().length >= 1 && value.length <= max ? value : fail(path)
)
const optionalText = (value: unknown, path: string): string | null => (
  value === null ? null : text(value, path)
)
const integer = (value: unknown, path: string): number => (
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fail(path)
)
const oneOf = <Value extends string>(value: unknown, allowed: readonly Value[], path: string): Value => (
  typeof value === 'string' && allowed.includes(value as Value) ? value as Value : fail(path)
)
const array = <Value>(
  value: unknown,
  path: string,
  maximum: number,
  parse: (row: unknown, rowPath: string) => Value,
): readonly Value[] => {
  const rows: readonly unknown[] = Array.isArray(value) ? value : fail(path)
  if (rows.length > maximum) fail(path)
  return Object.freeze(rows.map((row, index) => parse(row, `${path}[${index}]`)))
}

const GATE_KINDS: readonly FinishEncounterGateView['kind'][] = [
  'pending-reaction', 'pending-resolution', 'uncertain-command', 'unallocated-reward',
  'capture-destination', 'stale-snapshot', 'revision-conflict', 'invalid-participant',
  'cleanup-decision', 'unsupported-authority', 'private-choice', 'gm-adjudication',
  'outcome-decision', 'reward-allocation', 'capture-decision', 'cleanup-blocker',
]
const CONSEQUENCE_KINDS: readonly EncounterSettlementConsequenceKind[] = ['hp', 'injuries', 'conditions', 'equipment']
const CLEANUP_KINDS: readonly EncounterSettlementCleanupKind[] = [
  'combat-stages', 'temporary-effects', 'duration-effects', 'encounter-resources',
  'reservations', 'zones', 'ground-items', 'encounter-items', 'initiative',
]

const parseGate = (value: unknown, path: string): FinishEncounterGateView => {
  const row = object(value, path)
  keys(row, ['kind', 'title', 'detail', 'action', 'actionLabel'], path)
  return Object.freeze({
    kind: oneOf(row.kind, GATE_KINDS, `${path}.kind`),
    title: text(row.title, `${path}.title`, 200),
    detail: text(row.detail, `${path}.detail`, 1_000),
    action: oneOf(row.action, ['return-to-encounter', 'open-director', 'refresh-review'], `${path}.action`),
    actionLabel: text(row.actionLabel, `${path}.actionLabel`, 100),
  })
}
const parseConsequence = (value: unknown, path: string): FinishEncounterConsequenceView => {
  const row = object(value, path)
  keys(row, ['kind', 'label', 'count', 'detail'], path)
  return Object.freeze({
    kind: oneOf(row.kind, CONSEQUENCE_KINDS, `${path}.kind`),
    label: text(row.label, `${path}.label`, 200),
    count: integer(row.count, `${path}.count`),
    detail: text(row.detail, `${path}.detail`, 1_000),
  })
}
const parseReward = (value: unknown, path: string): FinishEncounterRewardView => {
  const row = object(value, path)
  keys(row, ['kind', 'label', 'amountLabel', 'destinationLabel', 'detail'], path)
  return Object.freeze({
    kind: oneOf(row.kind, ['experience', 'money', 'item', 'capture', 'narrative'], `${path}.kind`),
    label: text(row.label, `${path}.label`, 200),
    amountLabel: text(row.amountLabel, `${path}.amountLabel`, 200),
    destinationLabel: text(row.destinationLabel, `${path}.destinationLabel`, 200),
    detail: optionalText(row.detail, `${path}.detail`),
  })
}
const parseOutcome = (value: unknown, path: string): FinishEncounterOutcomeView => {
  const row = object(value, path)
  keys(row, ['kind', 'label', 'resultLabel', 'visibility'], path)
  return Object.freeze({
    kind: oneOf(row.kind, ['objective', 'clock', 'phase', 'stake', 'campaign-consequence', 'encounter'], `${path}.kind`),
    label: text(row.label, `${path}.label`, 200),
    resultLabel: text(row.resultLabel, `${path}.resultLabel`, 200),
    visibility: oneOf(row.visibility, ['public', 'gm'], `${path}.visibility`),
  })
}
const parseCleanup = (value: unknown, path: string): FinishEncounterCleanupView => {
  const row = object(value, path)
  keys(row, ['kind', 'label', 'sourceCount', 'actionLabel', 'detail'], path)
  return Object.freeze({
    kind: oneOf(row.kind, CLEANUP_KINDS, `${path}.kind`),
    label: text(row.label, `${path}.label`, 200),
    sourceCount: integer(row.sourceCount, `${path}.sourceCount`),
    actionLabel: text(row.actionLabel, `${path}.actionLabel`, 200),
    detail: text(row.detail, `${path}.detail`, 1_000),
  })
}
const parseOutstanding = (value: unknown, path: string): FinishEncounterOutstandingWorkView => {
  const row = object(value, path)
  keys(row, ['kind', 'label', 'detail'], path)
  return Object.freeze({
    kind: oneOf(row.kind, ['level-threshold', 'capture-review', 'medical-review', 'equipment-review', 'continuation-review'], `${path}.kind`),
    label: text(row.label, `${path}.label`, 200),
    detail: text(row.detail, `${path}.detail`, 1_000),
  })
}
const parseContinuation = (value: unknown, path: string): FinishEncounterContinuationView => {
  const row = object(value, path)
  keys(row, ['kind', 'label', 'href', 'detail'], path)
  const href = text(row.href, `${path}.href`, 500)
  if (!href.startsWith('/') || href.startsWith('//')) fail(`${path}.href`)
  return Object.freeze({
    kind: oneOf(row.kind, ['encounter-library', 'group-inventory', 'campaign'], `${path}.kind`),
    label: text(row.label, `${path}.label`, 200),
    href,
    detail: text(row.detail, `${path}.detail`, 1_000),
  })
}
const parseAccepted = (value: unknown, path: string): FinishEncounterAcceptedSummary => {
  const row = object(value, path)
  keys(row, ['completedAtCampaignMinute', 'changedSheetCount', 'changedGroupCount', 'historyFactCount', 'attentionSourceCount', 'replayed'], path)
  const replayed = typeof row.replayed === 'boolean' ? row.replayed : fail(`${path}.replayed`)
  return Object.freeze({
    completedAtCampaignMinute: integer(row.completedAtCampaignMinute, `${path}.completedAtCampaignMinute`),
    changedSheetCount: integer(row.changedSheetCount, `${path}.changedSheetCount`),
    changedGroupCount: integer(row.changedGroupCount, `${path}.changedGroupCount`),
    historyFactCount: integer(row.historyFactCount, `${path}.historyFactCount`),
    attentionSourceCount: integer(row.attentionSourceCount, `${path}.attentionSourceCount`),
    replayed,
  })
}

export const parseFinishEncounterView = (value: unknown): FinishEncounterView => {
  const row = object(value, 'view')
  keys(row, [
    'schemaVersion', 'state', 'encounterName', 'participantCount', 'readinessLabel',
    'readinessDetail', 'gates', 'consequences', 'rewards', 'outcomes', 'cleanup',
    'outstandingWork', 'continuations', 'command', 'accepted',
  ], 'view')
  if (row.schemaVersion !== FINISH_ENCOUNTER_VIEW_SCHEMA_VERSION) fail('view.schemaVersion')
  const state = oneOf(row.state, ['ready', 'blocked', 'accepted'], 'view.state')
  const command = row.command === null ? null : parseEncounterSettlementCommitCommand(row.command)
  const accepted = row.accepted === null ? null : parseAccepted(row.accepted, 'view.accepted')
  if ((state === 'ready') !== (command !== null) || (state === 'accepted') !== (accepted !== null)) {
    fail('view.state')
  }
  return Object.freeze({
    schemaVersion: FINISH_ENCOUNTER_VIEW_SCHEMA_VERSION,
    state,
    encounterName: text(row.encounterName, 'view.encounterName', 200),
    participantCount: integer(row.participantCount, 'view.participantCount'),
    readinessLabel: text(row.readinessLabel, 'view.readinessLabel', 200),
    readinessDetail: text(row.readinessDetail, 'view.readinessDetail', 1_000),
    gates: array(row.gates, 'view.gates', 100, parseGate),
    consequences: array(row.consequences, 'view.consequences', 20, parseConsequence),
    rewards: array(row.rewards, 'view.rewards', 1_000, parseReward),
    outcomes: array(row.outcomes, 'view.outcomes', 1_000, parseOutcome),
    cleanup: array(row.cleanup, 'view.cleanup', 20, parseCleanup),
    outstandingWork: array(row.outstandingWork, 'view.outstandingWork', 100, parseOutstanding),
    continuations: array(row.continuations, 'view.continuations', 10, parseContinuation),
    command,
    accepted,
  })
}
