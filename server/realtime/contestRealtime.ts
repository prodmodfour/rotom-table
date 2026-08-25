import type { PlayerProfileId } from '#shared/playerProfiles'
import type { ContestCommandKind } from '#shared/contests/operations'
import type { ContestDocumentV1 } from '#shared/contests/document'
import { contestCurrentContestant } from '#shared/contests/document'
import { contestGmRealtimeChannel, contestOwnerRealtimeChannel, contestRealtimeChannel, type ContestChangedRealtimePayloadV1, type ContestRealtimeEventType } from '#shared/contests/realtime'
import type { AppendRealtimeEventInput } from '../storage/realtimeEventRepository'

const eventTypeFor: Readonly<Record<ContestCommandKind, ContestRealtimeEventType>> = Object.freeze({
  'create-contest': 'contest.created', 'update-settings': 'contest.setup.changed', 'set-participant-method': 'contest.setup.changed', 'enroll-contestant': 'contest.setup.changed', 'remove-contestant': 'contest.setup.changed',
  'start-introduction': 'contest.setup.changed', 'declare-introduction': 'contest.introduction.accepted', 'restart-introduction': 'contest.setup.changed',
  'create-battle-encounter': 'contest.performance.started', 'score-battle-accepted-move': 'contest.appeal.accepted', 'apply-battle-voltage-lifecycle': 'contest.voltage.changed', 'end-battle-contest': 'contest.performance.completed', 'start-performance': 'contest.performance.started', 'select-rotation-performer': 'contest.rotation.performer-selected', 'declare-appeal': 'contest.appeal.accepted', 'use-intervention': 'contest.intervention.accepted', 'pass-intervention': 'contest.intervention.passed',
  'set-paused': 'contest.setup.changed', 'apply-correction': 'contest.corrected', 'declare-prize': 'contest.prize.declared', 'prepare-settlement': 'contest.settlement.prepared',
  'commit-settlement': 'contest.completed', 'cancel-contest': 'contest.cancelled',
})
const payload = (document: ContestDocumentV1, input: { operationId: string, clientId: string|null, audience: 'public'|'gm'|'owner', changedAt: number }): ContestChangedRealtimePayloadV1 => Object.freeze({
  schemaVersion: 1, contestId: document.contestId, revision: document.revision, stage: document.stage, round: document.round,
  activeContestantId: contestCurrentContestant(document)?.contestantId ?? null, operationId: input.operationId, clientId: input.clientId,
  audience: input.audience, changedAt: input.changedAt,
})
export const contestRealtimeAppendInputs = (input: {
  readonly document: ContestDocumentV1
  readonly commandKind: ContestCommandKind
  readonly operationId: string
  readonly clientId: string | null
  readonly timestamp: number
}): readonly AppendRealtimeEventInput[] => {
  const primaryType = eventTypeFor[input.commandKind]
  const operationHistory = input.document.history.filter(row => row.operationId === input.operationId)
  const types = [...new Set<ContestRealtimeEventType>([
    primaryType,
    ...(operationHistory.some(row => row.type === 'round-advanced' || row.type === 'festival-elimination') ? ['contest.round.advanced' as const] : []),
    ...(operationHistory.some(row => row.type === 'performance-completed' || row.type === 'battle-ended-round-budget' || row.type === 'battle-ended-all-pokemon-ko') ? ['contest.performance.completed' as const] : []),
  ])]
  const profiles = [...new Set(input.document.contestants.flatMap(row => row.controller.kind === 'profile' ? [row.controller.profileId] : []))]
  return Object.freeze(types.flatMap(type => [
    {
      event: { channel: contestRealtimeChannel(input.document.contestId), type, data: payload(input.document, { ...input, audience: 'public', changedAt: input.timestamp }) },
      access: { kind: 'contest-access' as const, contestId: input.document.contestId, audience: 'public' as const, profileId: null },
      dedupeKey: `${input.operationId}:${type}:public`, timestamp: input.timestamp,
    },
    {
      event: { channel: contestGmRealtimeChannel(input.document.contestId), type, data: payload(input.document, { ...input, audience: 'gm', changedAt: input.timestamp }) },
      access: { kind: 'contest-access' as const, contestId: input.document.contestId, audience: 'gm' as const, profileId: null },
      dedupeKey: `${input.operationId}:${type}:gm`, timestamp: input.timestamp,
    },
    ...profiles.map((profileId: PlayerProfileId): AppendRealtimeEventInput => ({
      event: { channel: contestOwnerRealtimeChannel(input.document.contestId, profileId), type, data: payload(input.document, { ...input, audience: 'owner', changedAt: input.timestamp }) },
      access: { kind: 'contest-access', contestId: input.document.contestId, audience: 'owner', profileId },
      dedupeKey: `${input.operationId}:${type}:owner:${profileId}`, timestamp: input.timestamp,
    })),
  ]))
}
