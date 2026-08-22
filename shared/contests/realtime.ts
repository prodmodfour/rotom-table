import { parseContestId, parseContestOperationId, parseContestantId } from './ids'
import type { ContestStage } from './ids'

export const CONTEST_REALTIME_EVENT_TYPES = Object.freeze([
  'contest.created', 'contest.setup.changed', 'contest.introduction.accepted',
  'contest.performance.started', 'contest.rotation.performer-selected', 'contest.appeal.accepted', 'contest.intervention.accepted', 'contest.intervention.passed', 'contest.round.advanced', 'contest.performance.completed',
  'contest.corrected', 'contest.prize.declared', 'contest.settlement.prepared', 'contest.completed', 'contest.cancelled',
] as const)
export type ContestRealtimeEventType = typeof CONTEST_REALTIME_EVENT_TYPES[number]

export interface ContestChangedRealtimePayloadV1 {
  readonly schemaVersion: 1
  readonly contestId: string
  readonly revision: number
  readonly stage: ContestStage
  readonly round: number
  readonly activeContestantId: string | null
  readonly operationId: string
  readonly clientId: string | null
  readonly audience: 'public' | 'gm' | 'owner'
  readonly changedAt: number
}
export const contestRealtimeChannel = (contestId: string): string => `contest:${parseContestId(contestId)}`
export const contestGmRealtimeChannel = (contestId: string): string => `${contestRealtimeChannel(contestId)}:gm`
export const contestOwnerRealtimeChannel = (contestId: string, profileId: string): string => `${contestRealtimeChannel(contestId)}:owner:${profileId}`

export const parseContestChangedRealtimePayload = (value: unknown): ContestChangedRealtimePayloadV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Contest realtime payload must be an object.')
  const row = value as Record<string, unknown>
  const allowed = new Set(['schemaVersion','contestId','revision','stage','round','activeContestantId','operationId','clientId','audience','changedAt'])
  const unknown = Object.keys(row).find(key => !allowed.has(key)); if (unknown) throw new Error(`Contest realtime payload field ${unknown} is not recognized.`)
  if (row.schemaVersion !== 1) throw new Error('Contest realtime payload schemaVersion must be 1.')
  const contestId = parseContestId(row.contestId)
  const operationId = parseContestOperationId(row.operationId)
  if (!Number.isSafeInteger(row.revision) || Number(row.revision) < 0) throw new Error('Contest realtime revision is invalid.')
  if (!['setup','introduction','performance','settling','completed','cancelled'].includes(String(row.stage))) throw new Error('Contest realtime stage is invalid.')
  if (!Number.isSafeInteger(row.round) || Number(row.round) < 0) throw new Error('Contest realtime round is invalid.')
  if (row.audience !== 'public' && row.audience !== 'gm' && row.audience !== 'owner') throw new Error('Contest realtime audience is invalid.')
  if (row.clientId !== null && (typeof row.clientId !== 'string' || row.clientId.length > 100)) throw new Error('Contest realtime clientId is invalid.')
  if (row.activeContestantId !== null) parseContestantId(row.activeContestantId, 'activeContestantId')
  if (!Number.isSafeInteger(row.changedAt) || Number(row.changedAt) < 0) throw new Error('Contest realtime changedAt is invalid.')
  return Object.freeze({
    schemaVersion: 1,
    contestId,
    revision: Number(row.revision),
    stage: row.stage as ContestStage,
    round: Number(row.round),
    activeContestantId: typeof row.activeContestantId === 'string' ? row.activeContestantId : null,
    operationId,
    clientId: row.clientId as string | null,
    audience: row.audience,
    changedAt: Number(row.changedAt),
  })
}

const ALL_CONTEST_AUDIENCES = Object.freeze(['public', 'gm', 'owner'] as const)
export const CONTEST_EVENT_AUDIENCES: Readonly<Record<ContestRealtimeEventType, readonly ('public' | 'gm' | 'owner')[]>> = Object.freeze({
  'contest.created': ALL_CONTEST_AUDIENCES,
  'contest.setup.changed': ALL_CONTEST_AUDIENCES,
  'contest.introduction.accepted': ALL_CONTEST_AUDIENCES,
  'contest.performance.started': ALL_CONTEST_AUDIENCES,
  'contest.rotation.performer-selected': ALL_CONTEST_AUDIENCES,
  'contest.appeal.accepted': ALL_CONTEST_AUDIENCES,
  'contest.intervention.accepted': ALL_CONTEST_AUDIENCES,
  'contest.intervention.passed': ALL_CONTEST_AUDIENCES,
  'contest.round.advanced': ALL_CONTEST_AUDIENCES,
  'contest.performance.completed': ALL_CONTEST_AUDIENCES,
  'contest.corrected': ALL_CONTEST_AUDIENCES,
  'contest.prize.declared': ALL_CONTEST_AUDIENCES,
  'contest.settlement.prepared': ALL_CONTEST_AUDIENCES,
  'contest.completed': ALL_CONTEST_AUDIENCES,
  'contest.cancelled': ALL_CONTEST_AUDIENCES,
})
