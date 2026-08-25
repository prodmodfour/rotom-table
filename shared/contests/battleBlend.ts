import { stableJsonStringify } from '../automation/stableJson'
import type { EncounterHistoryMoveOutcome } from '../moveAutomation/encounterHistory'
import type { EncounterActionType } from '../moveAutomation/encounterResources'
import {
  parseMoveHistoryBranchSelections,
  parseMoveHistoryMoveListSource,
  parseMoveHistoryOrigin,
  type MoveHistoryBranchSelection,
  type MoveHistoryMoveListSource,
  type MoveHistoryOrigin,
} from '../moveAutomation/moveHistoryMetadata'
import { computeRulesetSourceSha256 } from '../ruleset/sourceHash'
import {
  parseContestAppealId,
  parseContestId,
  parseContestOperationId,
} from './ids'

/**
 * Battle Contest blend boundary.
 *
 * The link and handoff envelopes are coordination evidence, never a third
 * combat or Contest mechanics engine. Encounter facts are derived from already
 * accepted live-play results. The Contest engine consumes those immutable
 * facts while each engine remains the sole writer of its own documents.
 */
export const BATTLE_CONTEST_BLEND_SCHEMA_VERSION = 1 as const
export const BATTLE_CONTEST_BLEND_CONTRACT_ID = 'battle-contest-blend:v1' as const

export const BATTLE_CONTEST_HANDOFF_KINDS = Object.freeze([
  'accepted-move',
  'knockout',
  'switch',
  'turn-start',
  'round-boundary',
  'encounter-ended',
] as const)
export type BattleContestHandoffKind = typeof BATTLE_CONTEST_HANDOFF_KINDS[number]

export const BATTLE_CONTEST_SOURCE_ACTION_KINDS = Object.freeze([
  'pokemon-move',
  'struggle-attack',
  'combat-maneuver',
] as const)
export type BattleContestSourceActionKind = typeof BATTLE_CONTEST_SOURCE_ACTION_KINDS[number]

export type BattleContestLinkId = `battle-contest-link:v1:${string}`
export type BattleContestHandoffId = `battle-contest-handoff:v1:${string}`

/** Immutable identity shared by the blend coordinator and both engine reads. */
export interface BattleContestLinkV1 {
  readonly schemaVersion: typeof BATTLE_CONTEST_BLEND_SCHEMA_VERSION
  readonly linkId: BattleContestLinkId
  readonly contestId: string
  readonly encounterId: string
  readonly linkedMapSlug: string
  /** Hash of the two reviewed Contest rosters at the moment linking begins. */
  readonly contestRosterSha256: string
  readonly createdAt: number
}

/** Exact read set required before one handoff may change Contest authority. */
export interface BattleContestRevisionReadSetV1 {
  readonly schemaVersion: typeof BATTLE_CONTEST_BLEND_SCHEMA_VERSION
  readonly linkId: BattleContestLinkId
  readonly contestId: string
  readonly contestRevision: number
  readonly encounterId: string
  readonly encounterDocumentRevision: number
  readonly linkedMapSlug: string
  /** Map revision is the encounter-mechanics revision used by failure fixtures. */
  readonly encounterRevision: number
  readonly encounterSceneId: string
}

interface BattleContestHandoffFactBaseV1 {
  readonly schemaVersion: typeof BATTLE_CONTEST_BLEND_SCHEMA_VERSION
  readonly handoffId: BattleContestHandoffId
  readonly linkId: BattleContestLinkId
  readonly sourceResultId: string
  /** Hash of the persisted accepted operation plus its matching history row. */
  readonly sourceResultSha256: string
  readonly occurredAt: number
}

export interface BattleContestReplacementAttentionV1 {
  readonly knockoutEventId: string
  readonly replacementEventId: string
  readonly turnStartEventId: string
  readonly encounterTurn: number
}

export interface BattleContestAcceptedMovePayloadV1 {
  readonly completionEventId: string
  readonly sourceOperationId: string
  readonly resolutionId: string
  readonly sceneId: string
  readonly round: number | null
  readonly completionOrder: number
  readonly actorPlacementId: string
  readonly canonicalMoveId: string
  readonly specVersion: number
  readonly actionType: EncounterActionType
  /** Encounter-owned classification; Contest policy decides whether it scores. */
  readonly sourceActionKind: BattleContestSourceActionKind
  readonly origin: MoveHistoryOrigin
  readonly moveListSource: MoveHistoryMoveListSource
  readonly attackedTargetIds: readonly string[]
  readonly hitTargetIds: readonly string[]
  readonly outcome: EncounterHistoryMoveOutcome
  readonly succeeded: boolean
  readonly branches: readonly MoveHistoryBranchSelection[]
  /** Present exactly when this Move occurs on a KO replacement's first acting turn. */
  readonly replacementAttention: BattleContestReplacementAttentionV1 | null
}

export interface BattleContestAcceptedMoveHandoffFactV1 extends BattleContestHandoffFactBaseV1 {
  readonly kind: 'accepted-move'
  readonly payload: BattleContestAcceptedMovePayloadV1
}

export interface BattleContestKnockoutPayloadV1 {
  readonly eventId: string
  readonly sourceOperationId: string
  readonly sceneId: string
  readonly round: number | null
  readonly targetPlacementId: string
  readonly sourcePlacementId: string | null
  readonly causalResolutionId: string | null
  readonly causalCanonicalId: string | null
  readonly cause: 'attack' | 'damage-over-time' | 'other'
}
export interface BattleContestKnockoutHandoffFactV1 extends BattleContestHandoffFactBaseV1 {
  readonly kind: 'knockout'
  readonly payload: BattleContestKnockoutPayloadV1
}

export interface BattleContestSwitchPayloadV1 {
  readonly eventId: string
  readonly sourceOperationId: string
  readonly sceneId: string
  readonly round: number | null
  readonly switchKind: 'switch' | 'recall' | 'send-out'
  readonly recalledPlacementId: string | null
  readonly sentOutPlacementId: string | null
  readonly causalResolutionId: string | null
  readonly causalCanonicalId: string | null
  readonly causalProviderId: string | null
}
export interface BattleContestSwitchHandoffFactV1 extends BattleContestHandoffFactBaseV1 {
  readonly kind: 'switch'
  readonly payload: BattleContestSwitchPayloadV1
}

export interface BattleContestTurnStartPayloadV1 {
  readonly eventId: string
  readonly sourceOperationId: string
  readonly sceneId: string
  readonly round: number
  readonly turn: number
  readonly actorPlacementId: string
  readonly replacementAfterKnockout: boolean
  readonly knockoutEventId: string | null
}
export interface BattleContestTurnStartHandoffFactV1 extends BattleContestHandoffFactBaseV1 {
  readonly kind: 'turn-start'
  readonly payload: BattleContestTurnStartPayloadV1
}

export interface BattleContestRoundBoundaryPayloadV1 {
  readonly eventId: string
  readonly sourceOperationId: string
  readonly sceneId: string
  readonly completedRound: number
  readonly nextRound: number | null
}
export interface BattleContestRoundBoundaryHandoffFactV1 extends BattleContestHandoffFactBaseV1 {
  readonly kind: 'round-boundary'
  readonly payload: BattleContestRoundBoundaryPayloadV1
}

export interface BattleContestEncounterEndedPayloadV1 {
  readonly eventId: string
  readonly sourceOperationId: string
  readonly sceneId: string
  readonly round: number | null
  readonly reason: 'completed' | 'cancelled' | 'gm-ended'
  readonly allKnockedOutSideIds: readonly string[]
}
export interface BattleContestEncounterEndedHandoffFactV1 extends BattleContestHandoffFactBaseV1 {
  readonly kind: 'encounter-ended'
  readonly payload: BattleContestEncounterEndedPayloadV1
}

export type BattleContestHandoffFactV1 =
  | BattleContestAcceptedMoveHandoffFactV1
  | BattleContestKnockoutHandoffFactV1
  | BattleContestSwitchHandoffFactV1
  | BattleContestTurnStartHandoffFactV1
  | BattleContestRoundBoundaryHandoffFactV1
  | BattleContestEncounterEndedHandoffFactV1

/** One server-internal delivery. No client route accepts this envelope directly. */
export interface BattleContestHandoffDeliveryV1 {
  readonly schemaVersion: typeof BATTLE_CONTEST_BLEND_SCHEMA_VERSION
  readonly operationId: string
  readonly readSet: BattleContestRevisionReadSetV1
  readonly fact: BattleContestHandoffFactV1
  /** SHA-256 of canonical JSON for fact only; read-set revisions may be refreshed. */
  readonly handoffSha256: string
}

export type BattleContestHandoffReceiptOutcome =
  | 'scored-appeal'
  | 'canonical-exclusion'
  | 'lifecycle-applied'
  | 'contest-ended'

/** Contest-owned at-most-once receipt for one immutable encounter fact. */
export interface BattleContestHandoffReceiptV1 {
  readonly handoffId: BattleContestHandoffId
  readonly handoffSha256: string
  readonly sourceResultId: string
  readonly operationId: string
  readonly contestRevisionBefore: number
  readonly contestRevisionAfter: number
  readonly encounterRevision: number
  readonly outcome: BattleContestHandoffReceiptOutcome
  readonly appealId: string | null
  readonly appliedAt: number
}

export type BattleContestBlendValidationCode =
  | 'battle-contest.invalid-shape'
  | 'battle-contest.invalid-identity'
  | 'battle-contest.invalid-hash'
  | 'battle-contest.link-mismatch'
  | 'battle-contest.contest-revision-stale'
  | 'battle-contest.encounter-document-revision-stale'
  | 'battle-contest.encounter-revision-stale'
  | 'battle-contest.encounter-scene-stale'
  | 'battle-contest.handoff-conflict'
  | 'battle-contest.cross-document-write'

export class BattleContestBlendContractError extends Error {
  constructor(
    readonly code: BattleContestBlendValidationCode,
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'BattleContestBlendContractError'
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/u
const CONTROL = /[\u0000-\u001f\u007f]/u
const LINK_ID = /^battle-contest-link:v1:[a-z0-9][a-z0-9-]{0,79}$/u
const HANDOFF_ID = /^battle-contest-handoff:v1:[a-z0-9][a-z0-9-]{0,79}$/u
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u
const MOVE_OUTCOMES = new Set<EncounterHistoryMoveOutcome>(['no-target', 'miss', 'hit', 'mixed'])
const ACTION_TYPES = new Set<EncounterActionType>(['standard', 'shift', 'swift', 'free', 'full', 'interrupt', 'reaction'])

const fail = (code: BattleContestBlendValidationCode, path: string, message: string): never => {
  throw new BattleContestBlendContractError(code, path, message)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('battle-contest.invalid-shape', path, 'must be an object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (Object.keys(value).length !== fields.length
    || fields.some(field => !Object.hasOwn(value, field))
    || Object.keys(value).some(field => !expected.has(field))) {
    fail('battle-contest.invalid-shape', path, `must contain exactly: ${fields.join(', ')}.`)
  }
}
const text = (value: unknown, path: string, maximum = 200): string => {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > maximum || CONTROL.test(value)) {
    return fail('battle-contest.invalid-identity', path, `must be bounded, trimmed, control-free text of at most ${maximum} characters.`)
  }
  return value
}
const stableId = (value: unknown, path: string): string => {
  const parsed = text(value, path)
  return STABLE_ID.test(parsed) ? parsed : fail('battle-contest.invalid-identity', path, 'must be a stable identifier.')
}
const nullableStableId = (value: unknown, path: string): string | null => value === null ? null : stableId(value, path)
const linkId = (value: unknown, path = 'linkId'): BattleContestLinkId => {
  const parsed = text(value, path)
  return LINK_ID.test(parsed) ? parsed as BattleContestLinkId : fail('battle-contest.invalid-identity', path, 'must be a Battle Contest link identity.')
}
const handoffId = (value: unknown, path = 'handoffId'): BattleContestHandoffId => {
  const parsed = text(value, path)
  return HANDOFF_ID.test(parsed) ? parsed as BattleContestHandoffId : fail('battle-contest.invalid-identity', path, 'must be a Battle Contest handoff identity.')
}
const sha256 = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value)
  ? value
  : fail('battle-contest.invalid-hash', path, 'must be one lowercase SHA-256 digest.')
const integer = (value: unknown, path: string, minimum = 0): number => Number.isSafeInteger(value) && Number(value) >= minimum
  ? Number(value)
  : fail('battle-contest.invalid-shape', path, `must be a safe integer of at least ${minimum}.`)
const nullableRound = (value: unknown, path: string): number | null => value === null ? null : integer(value, path, 1)
const boolean = (value: unknown, path: string): boolean => typeof value === 'boolean'
  ? value
  : fail('battle-contest.invalid-shape', path, 'must be boolean.')
const uniqueIds = (value: unknown, path: string, maximum = 64): readonly string[] => {
  if (!Array.isArray(value) || value.length > maximum) return fail('battle-contest.invalid-shape', path, `must be an array of at most ${maximum} stable IDs.`)
  const parsed = value.map((entry, index) => stableId(entry, `${path}[${index}]`))
  if (new Set(parsed).size !== parsed.length) fail('battle-contest.invalid-shape', path, 'must not contain duplicate IDs.')
  return Object.freeze(parsed)
}
const enumValue = <T extends string>(value: unknown, values: readonly T[], path: string): T => (
  typeof value === 'string' && values.includes(value as T)
    ? value as T
    : fail('battle-contest.invalid-shape', path, `must be one of: ${values.join(', ')}.`)
)
const freeze = <T>(value: T): T => Object.freeze(structuredClone(value)) as T

export const parseBattleContestLink = (value: unknown): BattleContestLinkV1 => {
  const row = record(value, 'link')
  exact(row, ['schemaVersion', 'linkId', 'contestId', 'encounterId', 'linkedMapSlug', 'contestRosterSha256', 'createdAt'], 'link')
  if (row.schemaVersion !== 1) fail('battle-contest.invalid-shape', 'link.schemaVersion', 'is unsupported.')
  return freeze({
    schemaVersion: 1,
    linkId: linkId(row.linkId, 'link.linkId'),
    contestId: parseContestId(row.contestId, 'link.contestId'),
    encounterId: stableId(row.encounterId, 'link.encounterId'),
    linkedMapSlug: stableId(row.linkedMapSlug, 'link.linkedMapSlug'),
    contestRosterSha256: sha256(row.contestRosterSha256, 'link.contestRosterSha256'),
    createdAt: integer(row.createdAt, 'link.createdAt'),
  })
}

export const parseBattleContestRevisionReadSet = (value: unknown): BattleContestRevisionReadSetV1 => {
  const row = record(value, 'readSet')
  exact(row, ['schemaVersion', 'linkId', 'contestId', 'contestRevision', 'encounterId', 'encounterDocumentRevision', 'linkedMapSlug', 'encounterRevision', 'encounterSceneId'], 'readSet')
  if (row.schemaVersion !== 1) fail('battle-contest.invalid-shape', 'readSet.schemaVersion', 'is unsupported.')
  return freeze({
    schemaVersion: 1,
    linkId: linkId(row.linkId, 'readSet.linkId'),
    contestId: parseContestId(row.contestId, 'readSet.contestId'),
    contestRevision: integer(row.contestRevision, 'readSet.contestRevision'),
    encounterId: stableId(row.encounterId, 'readSet.encounterId'),
    encounterDocumentRevision: integer(row.encounterDocumentRevision, 'readSet.encounterDocumentRevision'),
    linkedMapSlug: stableId(row.linkedMapSlug, 'readSet.linkedMapSlug'),
    encounterRevision: integer(row.encounterRevision, 'readSet.encounterRevision'),
    encounterSceneId: stableId(row.encounterSceneId, 'readSet.encounterSceneId'),
  })
}

const parseBase = (row: UnknownRecord, path: string): Omit<BattleContestHandoffFactBaseV1, never> => {
  if (row.schemaVersion !== 1) fail('battle-contest.invalid-shape', `${path}.schemaVersion`, 'is unsupported.')
  return {
    schemaVersion: 1,
    handoffId: handoffId(row.handoffId, `${path}.handoffId`),
    linkId: linkId(row.linkId, `${path}.linkId`),
    sourceResultId: stableId(row.sourceResultId, `${path}.sourceResultId`),
    sourceResultSha256: sha256(row.sourceResultSha256, `${path}.sourceResultSha256`),
    occurredAt: integer(row.occurredAt, `${path}.occurredAt`),
  }
}
const parseCommonEvent = (payload: UnknownRecord, path: string) => ({
  eventId: stableId(payload.eventId, `${path}.eventId`),
  sourceOperationId: stableId(payload.sourceOperationId, `${path}.sourceOperationId`),
  sceneId: stableId(payload.sceneId, `${path}.sceneId`),
})

const parseAcceptedMovePayload = (value: unknown, path: string): BattleContestAcceptedMovePayloadV1 => {
  const row = record(value, path)
  exact(row, ['completionEventId', 'sourceOperationId', 'resolutionId', 'sceneId', 'round', 'completionOrder', 'actorPlacementId', 'canonicalMoveId', 'specVersion', 'actionType', 'sourceActionKind', 'origin', 'moveListSource', 'attackedTargetIds', 'hitTargetIds', 'outcome', 'succeeded', 'branches', 'replacementAttention'], path)
  const outcome = typeof row.outcome === 'string' && MOVE_OUTCOMES.has(row.outcome as EncounterHistoryMoveOutcome)
    ? row.outcome as EncounterHistoryMoveOutcome
    : fail('battle-contest.invalid-shape', `${path}.outcome`, 'must be a canonical encounter move outcome.')
  const actionType = typeof row.actionType === 'string' && ACTION_TYPES.has(row.actionType as EncounterActionType)
    ? row.actionType as EncounterActionType
    : fail('battle-contest.invalid-shape', `${path}.actionType`, 'must be a canonical encounter action type.')
  const attackedTargetIds = uniqueIds(row.attackedTargetIds, `${path}.attackedTargetIds`)
  const hitTargetIds = uniqueIds(row.hitTargetIds, `${path}.hitTargetIds`)
  if (hitTargetIds.some(id => !attackedTargetIds.includes(id))
    || outcome === 'no-target' && (attackedTargetIds.length !== 0 || hitTargetIds.length !== 0)
    || outcome === 'miss' && (attackedTargetIds.length === 0 || hitTargetIds.length !== 0)
    || outcome === 'hit' && (attackedTargetIds.length === 0 || hitTargetIds.length !== attackedTargetIds.length)
    || outcome === 'mixed' && (hitTargetIds.length === 0 || hitTargetIds.length >= attackedTargetIds.length)) {
    fail('battle-contest.invalid-shape', `${path}.outcome`, 'does not match the authoritative attacked and hit target sets.')
  }
  const replacementAttention = row.replacementAttention === null
    ? null
    : (() => {
        const attention = record(row.replacementAttention, `${path}.replacementAttention`)
        exact(attention, ['knockoutEventId', 'replacementEventId', 'turnStartEventId', 'encounterTurn'], `${path}.replacementAttention`)
        return {
          knockoutEventId: stableId(attention.knockoutEventId, `${path}.replacementAttention.knockoutEventId`),
          replacementEventId: stableId(attention.replacementEventId, `${path}.replacementAttention.replacementEventId`),
          turnStartEventId: stableId(attention.turnStartEventId, `${path}.replacementAttention.turnStartEventId`),
          encounterTurn: integer(attention.encounterTurn, `${path}.replacementAttention.encounterTurn`),
        }
      })()
  return freeze({
    completionEventId: stableId(row.completionEventId, `${path}.completionEventId`),
    sourceOperationId: stableId(row.sourceOperationId, `${path}.sourceOperationId`),
    resolutionId: stableId(row.resolutionId, `${path}.resolutionId`),
    sceneId: stableId(row.sceneId, `${path}.sceneId`),
    round: nullableRound(row.round, `${path}.round`),
    completionOrder: integer(row.completionOrder, `${path}.completionOrder`, 1),
    actorPlacementId: stableId(row.actorPlacementId, `${path}.actorPlacementId`),
    canonicalMoveId: text(row.canonicalMoveId, `${path}.canonicalMoveId`, 160),
    specVersion: integer(row.specVersion, `${path}.specVersion`, 1),
    actionType,
    sourceActionKind: enumValue(row.sourceActionKind, BATTLE_CONTEST_SOURCE_ACTION_KINDS, `${path}.sourceActionKind`),
    origin: parseMoveHistoryOrigin(row.origin, `${path}.origin`),
    moveListSource: parseMoveHistoryMoveListSource(row.moveListSource, `${path}.moveListSource`),
    attackedTargetIds,
    hitTargetIds,
    outcome,
    succeeded: boolean(row.succeeded, `${path}.succeeded`),
    branches: parseMoveHistoryBranchSelections(row.branches, `${path}.branches`),
    replacementAttention,
  })
}

export const parseBattleContestHandoffFact = (value: unknown): BattleContestHandoffFactV1 => {
  const row = record(value, 'fact')
  exact(row, ['schemaVersion', 'handoffId', 'linkId', 'sourceResultId', 'sourceResultSha256', 'occurredAt', 'kind', 'payload'], 'fact')
  const base = parseBase(row, 'fact')
  const kind = enumValue(row.kind, BATTLE_CONTEST_HANDOFF_KINDS, 'fact.kind')
  if (kind === 'accepted-move') return freeze({ ...base, kind, payload: parseAcceptedMovePayload(row.payload, 'fact.payload') })

  const payload = record(row.payload, 'fact.payload')
  if (kind === 'knockout') {
    exact(payload, ['eventId', 'sourceOperationId', 'sceneId', 'round', 'targetPlacementId', 'sourcePlacementId', 'causalResolutionId', 'causalCanonicalId', 'cause'], 'fact.payload')
    const sourcePlacementId = nullableStableId(payload.sourcePlacementId, 'fact.payload.sourcePlacementId')
    const causalResolutionId = nullableStableId(payload.causalResolutionId, 'fact.payload.causalResolutionId')
    const causalCanonicalId = payload.causalCanonicalId === null ? null : text(payload.causalCanonicalId, 'fact.payload.causalCanonicalId', 160)
    const cause = enumValue(payload.cause, ['attack', 'damage-over-time', 'other'] as const, 'fact.payload.cause')
    if (cause === 'attack' ? sourcePlacementId === null || causalResolutionId === null || causalCanonicalId === null : sourcePlacementId !== null || causalResolutionId !== null || causalCanonicalId !== null) {
      fail('battle-contest.invalid-shape', 'fact.payload', 'attack ancestry must exist exactly for an attack knockout.')
    }
    return freeze({ ...base, kind, payload: {
      ...parseCommonEvent(payload, 'fact.payload'),
      round: nullableRound(payload.round, 'fact.payload.round'),
      targetPlacementId: stableId(payload.targetPlacementId, 'fact.payload.targetPlacementId'),
      sourcePlacementId,
      causalResolutionId,
      causalCanonicalId,
      cause,
    } })
  }
  if (kind === 'switch') {
    exact(payload, ['eventId', 'sourceOperationId', 'sceneId', 'round', 'switchKind', 'recalledPlacementId', 'sentOutPlacementId', 'causalResolutionId', 'causalCanonicalId', 'causalProviderId'], 'fact.payload')
    const switchKind = enumValue(payload.switchKind, ['switch', 'recall', 'send-out'] as const, 'fact.payload.switchKind')
    const recalledPlacementId = nullableStableId(payload.recalledPlacementId, 'fact.payload.recalledPlacementId')
    const sentOutPlacementId = nullableStableId(payload.sentOutPlacementId, 'fact.payload.sentOutPlacementId')
    if ((switchKind === 'recall' && (recalledPlacementId === null || sentOutPlacementId !== null))
      || (switchKind === 'send-out' && (recalledPlacementId !== null || sentOutPlacementId === null))
      || (switchKind === 'switch' && (recalledPlacementId === null || sentOutPlacementId === null))) {
      fail('battle-contest.invalid-shape', 'fact.payload', 'switch identities do not match switchKind.')
    }
    return freeze({ ...base, kind, payload: {
      ...parseCommonEvent(payload, 'fact.payload'),
      round: nullableRound(payload.round, 'fact.payload.round'),
      switchKind,
      recalledPlacementId,
      sentOutPlacementId,
      causalResolutionId: nullableStableId(payload.causalResolutionId, 'fact.payload.causalResolutionId'),
      causalCanonicalId: payload.causalCanonicalId === null ? null : text(payload.causalCanonicalId, 'fact.payload.causalCanonicalId', 160),
      causalProviderId: payload.causalProviderId === null ? null : text(payload.causalProviderId, 'fact.payload.causalProviderId', 200),
    } })
  }
  if (kind === 'turn-start') {
    exact(payload, ['eventId', 'sourceOperationId', 'sceneId', 'round', 'turn', 'actorPlacementId', 'replacementAfterKnockout', 'knockoutEventId'], 'fact.payload')
    const replacementAfterKnockout = boolean(payload.replacementAfterKnockout, 'fact.payload.replacementAfterKnockout')
    const knockoutEventId = nullableStableId(payload.knockoutEventId, 'fact.payload.knockoutEventId')
    if (replacementAfterKnockout !== (knockoutEventId !== null)) fail('battle-contest.invalid-shape', 'fact.payload.knockoutEventId', 'must be present exactly for a post-KO replacement turn.')
    return freeze({ ...base, kind, payload: {
      ...parseCommonEvent(payload, 'fact.payload'),
      round: integer(payload.round, 'fact.payload.round', 1),
      turn: integer(payload.turn, 'fact.payload.turn'),
      actorPlacementId: stableId(payload.actorPlacementId, 'fact.payload.actorPlacementId'),
      replacementAfterKnockout,
      knockoutEventId,
    } })
  }
  if (kind === 'round-boundary') {
    exact(payload, ['eventId', 'sourceOperationId', 'sceneId', 'completedRound', 'nextRound'], 'fact.payload')
    const completedRound = integer(payload.completedRound, 'fact.payload.completedRound', 1)
    const nextRound = payload.nextRound === null ? null : integer(payload.nextRound, 'fact.payload.nextRound', 1)
    if (nextRound !== null && nextRound !== completedRound + 1) fail('battle-contest.invalid-shape', 'fact.payload.nextRound', 'must be the next sequential round or null.')
    return freeze({ ...base, kind, payload: { ...parseCommonEvent(payload, 'fact.payload'), completedRound, nextRound } })
  }
  exact(payload, ['eventId', 'sourceOperationId', 'sceneId', 'round', 'reason', 'allKnockedOutSideIds'], 'fact.payload')
  return freeze({ ...base, kind: 'encounter-ended', payload: {
    ...parseCommonEvent(payload, 'fact.payload'),
    round: nullableRound(payload.round, 'fact.payload.round'),
    reason: enumValue(payload.reason, ['completed', 'cancelled', 'gm-ended'] as const, 'fact.payload.reason'),
    allKnockedOutSideIds: uniqueIds(payload.allKnockedOutSideIds, 'fact.payload.allKnockedOutSideIds', 32),
  } })
}

export const parseBattleContestHandoffDelivery = (value: unknown): BattleContestHandoffDeliveryV1 => {
  const row = record(value, 'delivery')
  exact(row, ['schemaVersion', 'operationId', 'readSet', 'fact', 'handoffSha256'], 'delivery')
  if (row.schemaVersion !== 1) fail('battle-contest.invalid-shape', 'delivery.schemaVersion', 'is unsupported.')
  const readSet = parseBattleContestRevisionReadSet(row.readSet)
  const fact = parseBattleContestHandoffFact(row.fact)
  const operationId = parseContestOperationId(row.operationId, 'delivery.operationId')
  if (fact.linkId !== readSet.linkId) fail('battle-contest.link-mismatch', 'delivery.fact.linkId', 'must match the read set link.')
  if ('sceneId' in fact.payload && fact.payload.sceneId !== readSet.encounterSceneId) fail('battle-contest.encounter-scene-stale', 'delivery.fact.payload.sceneId', 'must match the read set scene.')
  return freeze({ schemaVersion: 1, operationId, readSet, fact, handoffSha256: sha256(row.handoffSha256, 'delivery.handoffSha256') })
}

export const battleContestHandoffCanonicalJson = (fact: BattleContestHandoffFactV1): string =>
  stableJsonStringify(parseBattleContestHandoffFact(fact), {
    path: 'battleContestHandoffFact',
    limits: { maxDepth: 16, maxNodes: 2_000, maxArrayEntries: 128, maxObjectFields: 32, maxStringLength: 200 },
  })

export const computeBattleContestHandoffSha256 = async (fact: BattleContestHandoffFactV1): Promise<string> =>
  computeRulesetSourceSha256(battleContestHandoffCanonicalJson(fact))

export const assertBattleContestHandoffHash = async (deliveryInput: BattleContestHandoffDeliveryV1): Promise<void> => {
  const delivery = parseBattleContestHandoffDelivery(deliveryInput)
  const actual = await computeBattleContestHandoffSha256(delivery.fact)
  if (actual !== delivery.handoffSha256) fail('battle-contest.invalid-hash', 'delivery.handoffSha256', 'does not bind the canonical handoff fact.')
}

export interface BattleContestCurrentRevisionStateV1 {
  readonly contestId: string
  readonly contestRevision: number
  readonly encounterId: string
  readonly encounterDocumentRevision: number
  readonly linkedMapSlug: string
  readonly encounterRevision: number
  readonly encounterSceneId: string
}

/** Revalidate the exact three-document read set immediately before commit. */
export const assertBattleContestRevisionCoupling = (
  deliveryInput: BattleContestHandoffDeliveryV1,
  linkInput: BattleContestLinkV1,
  current: BattleContestCurrentRevisionStateV1,
): void => {
  const delivery = parseBattleContestHandoffDelivery(deliveryInput)
  const link = parseBattleContestLink(linkInput)
  const expected = delivery.readSet
  if (expected.linkId !== link.linkId || delivery.fact.linkId !== link.linkId
    || expected.contestId !== link.contestId || expected.encounterId !== link.encounterId
    || expected.linkedMapSlug !== link.linkedMapSlug
    || current.contestId !== link.contestId || current.encounterId !== link.encounterId
    || current.linkedMapSlug !== link.linkedMapSlug) {
    fail('battle-contest.link-mismatch', 'delivery.readSet', 'does not identify the immutable linked authorities.')
  }
  if (current.contestRevision !== expected.contestRevision) fail('battle-contest.contest-revision-stale', 'delivery.readSet.contestRevision', 'Contest authority changed before handoff commit.')
  if (current.encounterDocumentRevision !== expected.encounterDocumentRevision) fail('battle-contest.encounter-document-revision-stale', 'delivery.readSet.encounterDocumentRevision', 'Encounter document authority changed before handoff commit.')
  if (current.encounterRevision !== expected.encounterRevision) fail('battle-contest.encounter-revision-stale', 'delivery.readSet.encounterRevision', 'Encounter map authority changed before handoff commit.')
  if (current.encounterSceneId !== expected.encounterSceneId) fail('battle-contest.encounter-scene-stale', 'delivery.readSet.encounterSceneId', 'Encounter scene changed before handoff commit.')
}

export const parseBattleContestHandoffReceipt = (value: unknown): BattleContestHandoffReceiptV1 => {
  const row = record(value, 'receipt')
  exact(row, ['handoffId', 'handoffSha256', 'sourceResultId', 'operationId', 'contestRevisionBefore', 'contestRevisionAfter', 'encounterRevision', 'outcome', 'appealId', 'appliedAt'], 'receipt')
  const outcome = enumValue(row.outcome, ['scored-appeal', 'canonical-exclusion', 'lifecycle-applied', 'contest-ended'] as const, 'receipt.outcome')
  const appealId = row.appealId === null ? null : parseContestAppealId(row.appealId, 'receipt.appealId')
  if ((outcome === 'scored-appeal') !== (appealId !== null)) fail('battle-contest.invalid-shape', 'receipt.appealId', 'must exist exactly for a scored Appeal.')
  const contestRevisionBefore = integer(row.contestRevisionBefore, 'receipt.contestRevisionBefore')
  const contestRevisionAfter = integer(row.contestRevisionAfter, 'receipt.contestRevisionAfter')
  if (contestRevisionAfter !== contestRevisionBefore + 1) fail('battle-contest.invalid-shape', 'receipt.contestRevisionAfter', 'must advance Contest authority exactly once.')
  return freeze({
    handoffId: handoffId(row.handoffId, 'receipt.handoffId'),
    handoffSha256: sha256(row.handoffSha256, 'receipt.handoffSha256'),
    sourceResultId: stableId(row.sourceResultId, 'receipt.sourceResultId'),
    operationId: parseContestOperationId(row.operationId, 'receipt.operationId'),
    contestRevisionBefore,
    contestRevisionAfter,
    encounterRevision: integer(row.encounterRevision, 'receipt.encounterRevision'),
    outcome,
    appealId,
    appliedAt: integer(row.appliedAt, 'receipt.appliedAt'),
  })
}

export type BattleContestHandoffDeliveryDecision =
  | { readonly kind: 'apply' }
  | { readonly kind: 'exact-retry', readonly receipt: BattleContestHandoffReceiptV1 }

/** At-most-once decision keyed by both source result identity and fact hash. */
export const decideBattleContestHandoffDelivery = (
  receiptsInput: readonly BattleContestHandoffReceiptV1[],
  deliveryInput: BattleContestHandoffDeliveryV1,
): BattleContestHandoffDeliveryDecision => {
  const receipts = receiptsInput.map(parseBattleContestHandoffReceipt)
  const delivery = parseBattleContestHandoffDelivery(deliveryInput)
  const duplicateIds = receipts.map(receipt => receipt.handoffId)
  if (new Set(duplicateIds).size !== duplicateIds.length) fail('battle-contest.handoff-conflict', 'receipts', 'contains duplicate handoff identities.')
  const existing = receipts.find(receipt => receipt.handoffId === delivery.fact.handoffId
    || receipt.sourceResultId === delivery.fact.sourceResultId)
  if (!existing) return Object.freeze({ kind: 'apply' })
  if (existing.handoffId !== delivery.fact.handoffId
    || existing.sourceResultId !== delivery.fact.sourceResultId
    || existing.handoffSha256 !== delivery.handoffSha256) {
    fail('battle-contest.handoff-conflict', 'delivery.fact', 'reuses an accepted source identity with different handoff material.')
  }
  return Object.freeze({ kind: 'exact-retry', receipt: existing })
}

export type BattleContestEngineOwner = 'contest-engine' | 'encounter-engine' | 'blend-coordinator'
export type BattleContestWriteAuthority =
  | 'contest-document'
  | 'contest-operation'
  | 'encounter-document'
  | 'encounter-map'
  | 'live-play-operation'
  | 'blend-link'

export interface BattleContestEngineWritePlanV1 {
  readonly owner: BattleContestEngineOwner
  readonly writes: readonly BattleContestWriteAuthority[]
}

const ALLOWED_WRITES: Readonly<Record<BattleContestEngineOwner, ReadonlySet<BattleContestWriteAuthority>>> = Object.freeze({
  'contest-engine': new Set<BattleContestWriteAuthority>(['contest-document', 'contest-operation']),
  'encounter-engine': new Set<BattleContestWriteAuthority>(['encounter-document', 'encounter-map', 'live-play-operation']),
  'blend-coordinator': new Set<BattleContestWriteAuthority>(['blend-link']),
})

/** Structural enforcement for the no-cross-document-write architecture rule. */
export const assertBattleContestEngineWriteBoundary = (plan: BattleContestEngineWritePlanV1): void => {
  const allowed = ALLOWED_WRITES[plan.owner]
  if (!allowed || !Array.isArray(plan.writes) || new Set(plan.writes).size !== plan.writes.length
    || plan.writes.some(write => !allowed.has(write))) {
    fail('battle-contest.cross-document-write', 'writePlan', `${plan.owner} may commit only its owned Battle Contest authorities.`)
  }
}
