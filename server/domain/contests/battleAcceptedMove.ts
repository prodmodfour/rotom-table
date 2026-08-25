import { createHash } from 'node:crypto'
import { LIVE_PLAY_COMMAND_TYPES, validateLivePlayCommandEnvelope, type ResolveMoveLivePlayCommand } from '#shared/livePlayCommands'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  battleContestHandoffCanonicalJson,
  parseBattleContestHandoffDelivery,
  type BattleContestAcceptedMoveHandoffFactV1,
  type BattleContestHandoffDeliveryV1,
  type BattleContestSourceActionKind,
} from '#shared/contests/battleBlend'
import type { ContestDocumentV1 } from '#shared/contests/document'
import type { EncounterDocument } from '#shared/encounterDocuments/model'
import { parseEncounterHistory } from '#shared/moveAutomation/encounterHistory'
import type { TabletopMap } from '~/types/map'
import { isStruggleAttackMoveName } from '~/utils/struggleMoves'
import { parseLivePlayMovePresentationSummary } from '#shared/livePlayMovePresentation'
import type { SqliteLivePlayOpRecord } from '../../storage/opRepository'
import { createLivePlayCommandHash } from '../../livePlay/opResult'
import { encounterSceneId } from '../moveAutomation/planSceneLifecycle'

export type BattleAcceptedMoveDerivationCode =
  | 'battle-contest.source-not-accepted'
  | 'battle-contest.source-result-missing'
  | 'battle-contest.source-result-ambiguous'
  | 'battle-contest.source-result-mismatch'
  | 'battle-contest.source-action-unknown'

export class BattleAcceptedMoveDerivationError extends Error {
  constructor(readonly code: BattleAcceptedMoveDerivationCode, message: string) {
    super(message)
    this.name = 'BattleAcceptedMoveDerivationError'
  }
}

const fail = (code: BattleAcceptedMoveDerivationCode, message: string): never => {
  throw new BattleAcceptedMoveDerivationError(code, message)
}
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const stringArray = (value: unknown): readonly string[] | null => Array.isArray(value) && value.every(entry => typeof entry === 'string') ? value : null
const sameStrings = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && left.every((entry, index) => entry === right[index])
const sourceActionKind = (canonicalMoveId: string, command: unknown): BattleContestSourceActionKind => {
  const commandType = command && typeof command === 'object' && !Array.isArray(command)
    ? (command as Record<string, unknown>).type
    : null
  if (commandType === LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER) return 'combat-maneuver'
  if (isStruggleAttackMoveName(canonicalMoveId)) return 'struggle-attack'
  if (commandType !== LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE) return fail('battle-contest.source-action-unknown', 'Accepted Move handoff requires one persisted resolveMove source operation.')
  return 'pokemon-move'
}

export interface DeriveBattleContestAcceptedMoveInputV1 {
  readonly document: ContestDocumentV1
  readonly encounterDocument: EncounterDocument
  readonly map: TabletopMap
  readonly sourceOperation: SqliteLivePlayOpRecord
  readonly sourceOperationId: string
  readonly sourceResolutionId: string
  readonly contestOperationId: string
}

/**
 * Derive one immutable Contest handoff only from a persisted accepted operation
 * and its exact matching map-owned completion row. No client result, roll, hit,
 * Move identity, Scene, round, or actor claim enters this function.
 */
export const deriveBattleContestAcceptedMoveDelivery = (
  input: DeriveBattleContestAcceptedMoveInputV1,
): BattleContestHandoffDeliveryV1 => {
  const binding = input.document.battle?.encounter
  if (!binding || input.document.variantId !== 'battle' || input.document.stage !== 'performance') {
    return fail('battle-contest.source-result-mismatch', 'Battle Contest must have one active immutable Encounter binding before Move handoff derivation.')
  }
  if (binding.link.encounterId !== input.encounterDocument.encounterId
    || binding.link.linkedMapSlug !== input.map.slug
    || input.encounterDocument.battleContest?.link.linkId !== binding.link.linkId) {
    return fail('battle-contest.source-result-mismatch', 'Contest, Encounter Document, and linked map identities do not agree.')
  }
  const source = input.sourceOperation
  if (source.opId !== input.sourceOperationId || source.mapSlug !== input.map.slug || !source.result.ok) {
    return fail('battle-contest.source-not-accepted', 'Move source must be one persisted accepted operation on the linked map.')
  }
  const mapRevision = input.map.revision
  if (!Number.isSafeInteger(mapRevision) || source.result.revision > Number(mapRevision) || source.resultRevision !== undefined && source.resultRevision !== source.result.revision) {
    return fail('battle-contest.source-result-mismatch', 'Persisted accepted operation revision is not part of current linked map authority.')
  }
  let history: ReturnType<typeof parseEncounterHistory>
  try {
    history = parseEncounterHistory(input.map.encounterState?.history)
  }
  catch {
    return fail('battle-contest.source-result-mismatch', 'Linked map Move history is malformed and cannot authorize a Contest handoff.')
  }
  const matches = history.moveUses.filter(move => move.resolutionId === input.sourceResolutionId && move.completion?.sourceOperationId === input.sourceOperationId)
  if (matches.length === 0) return fail('battle-contest.source-result-missing', 'Accepted operation has no matching completed Move history row.')
  if (matches.length !== 1) return fail('battle-contest.source-result-ambiguous', 'Accepted operation resolves to more than one matching completed Move history row.')
  const move = matches[0]!
  const commandValidation = validateLivePlayCommandEnvelope(source.command)
  const sourceCommand = commandValidation.valid ? commandValidation.command : null
  const resolveCommand = sourceCommand?.type === LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE ? sourceCommand as ResolveMoveLivePlayCommand : null
  if (!resolveCommand
    || createLivePlayCommandHash(resolveCommand) !== source.commandHash
    || resolveCommand.mapSlug !== input.map.slug || resolveCommand.opId !== input.sourceOperationId
    || resolveCommand.payload.placementId !== move.actorPlacementId
    || resolveCommand.baseRevision >= source.result.revision) {
    return fail('battle-contest.source-result-mismatch', 'Persisted source command does not match the completed Move actor, identity, operation, map, and accepted revision.')
  }
  const acceptedMovePatches = source.result.patches.filter(patch => patch.type === 'move.state')
  const acceptedPatch = acceptedMovePatches.length === 1 ? acceptedMovePatches[0]! : null
  const patchPayload = record(acceptedPatch?.payload)
  const patchChanges = record(patchPayload?.changes)
  const patchEncounterChange = record(patchChanges?.encounterState)
  const patchEncounterCurrent = record(patchEncounterChange?.current)
  let patchHistoryMove: typeof move | null = null
  let acceptedPatchHistory: ReturnType<typeof parseEncounterHistory> | null = null
  try {
    const patchHistory = parseEncounterHistory(patchEncounterCurrent?.history, 'acceptedOperation.result.patch.encounterState.history')
    acceptedPatchHistory = patchHistory
    const patchMatches = patchHistory.moveUses.filter(candidate => candidate.resolutionId === input.sourceResolutionId && candidate.completion?.sourceOperationId === input.sourceOperationId)
    patchHistoryMove = patchMatches.length === 1 ? patchMatches[0]! : null
  } catch { patchHistoryMove = null }
  const patchMove = record(patchPayload?.move)
  const patchPresentationResult = parseLivePlayMovePresentationSummary(patchPayload?.presentation)
  const patchPresentation = patchPresentationResult.valid ? patchPresentationResult.presentation : null
  const patchTransaction = record(patchMove?.transaction)
  const patchTrace = record(patchMove?.trace)
  const patchProgram = record(patchTrace?.program)
  const rootPresentation = record(source.result.presentation)
  const rootPresentationSource = record(rootPresentation?.source)
  if (!acceptedPatch || !patchHistoryMove || stableJsonStringify(patchHistoryMove) !== stableJsonStringify(move)
    || acceptedPatch.mapSlug !== input.map.slug || acceptedPatch.revision !== source.result.revision
    || patchPayload?.command !== 'resolveMove'
    || patchMove?.canonicalMoveName !== move.canonicalId || patchMove?.actorPlacementId !== move.actorPlacementId
    || patchPresentation?.operationId !== source.opId || patchPresentation.actorPlacementId !== move.actorPlacementId
    || patchPresentation.move.name !== move.canonicalId
    || patchProgram?.runtimeVersion !== move.specVersion
    || rootPresentation?.operationId !== source.opId || rootPresentationSource?.canonicalId !== move.canonicalId) {
    return fail('battle-contest.source-result-mismatch', 'Accepted result patch and presentation do not bind the completed Move identity, actor, version, operation, map, and revision.')
  }
  const completion = move.completion
  const acceptedTurn = acceptedPatchHistory?.currentTurn ?? null
  const replacementMatches = acceptedPatchHistory?.knockoutReplacements.filter(replacement => (
    replacement.replacementPlacementId === move.actorPlacementId
    && replacement.firstTurnEventId !== null
    && replacement.firstActingRound === completion?.round
    && replacement.firstActingRound === acceptedTurn?.round
    && replacement.firstActingTurn === acceptedTurn?.turn
    && acceptedTurn.placementId === move.actorPlacementId
  )) ?? []
  if (replacementMatches.length > 1) return fail('battle-contest.source-result-ambiguous', 'Accepted Move has ambiguous replacement Center of Attention authority.')
  const replacement = replacementMatches[0] ?? null
  if (replacement && !history.knockoutReplacements.some(candidate => stableJsonStringify(candidate) === stableJsonStringify(replacement))) {
    return fail('battle-contest.source-result-mismatch', 'Accepted Move replacement Center of Attention evidence is absent from current linked-map authority.')
  }
  const replacementAttention = replacement
    ? {
        knockoutEventId: replacement.knockoutEventId,
        replacementEventId: replacement.replacementEventId,
        turnStartEventId: replacement.firstTurnEventId!,
        encounterTurn: replacement.firstActingTurn!,
      }
    : null
  const resultAttackedTargetIds = stringArray(patchTransaction?.attackedTargetIds)
  const resultHitTargetIds = stringArray(patchTransaction?.hitTargetIds)
  if (!completion || !resultAttackedTargetIds || !resultHitTargetIds
    || !sameStrings(resultAttackedTargetIds, completion.attackedTargetIds)
    || !sameStrings(resultHitTargetIds, completion.hitTargetIds)
    || !sameStrings(patchPresentation?.attackedTargetIds ?? [], completion.attackedTargetIds)
    || !sameStrings(patchPresentation?.hitTargetIds ?? [], completion.hitTargetIds)
    || (patchPresentation?.outcomeKind === 'self' ? 'no-target' : patchPresentation?.outcomeKind) !== completion.outcome
    || completion.round === undefined || completion.round === null || history.sceneId === null
    || move.specVersion < 1 || completion.eventId.length === 0) {
    return fail('battle-contest.source-result-mismatch', 'Completed Move history lacks current Scene, round, version, or completion identity authority.')
  }
  const currentSceneId = input.map.activeScene ? encounterSceneId(input.map.slug, input.map.activeScene) : null
  if (currentSceneId === null || history.sceneId !== currentSceneId || binding.sceneId !== currentSceneId) {
    return fail('battle-contest.source-result-mismatch', 'Completed Move is not bound to the active linked Encounter Scene.')
  }

  const sourceMaterial = {
    schemaVersion: source.schemaVersion,
    mapSlug: source.mapSlug,
    opId: source.opId,
    commandHash: source.commandHash,
    command: source.command,
    result: source.result,
    resultRevision: source.resultRevision ?? null,
    moveCompensation: source.moveCompensation ?? null,
    correctionOriginOperationId: source.correctionOriginOperationId ?? null,
    createdAt: source.createdAt,
    recordedAt: source.recordedAt,
    completion: move,
  }
  const sourceResultSha256 = digest(stableJsonStringify(sourceMaterial, {
    path: 'battleContestAcceptedMoveSource',
    limits: { maxDepth: 48, maxNodes: 100_000, maxArrayEntries: 10_000, maxObjectFields: 512, maxStringLength: 100_000 },
  }))
  const handoffIdSuffix = digest(`${binding.link.linkId}\n${completion.eventId}\n${sourceResultSha256}`).slice(0, 40)
  const fact: BattleContestAcceptedMoveHandoffFactV1 = {
    schemaVersion: 1,
    handoffId: `battle-contest-handoff:v1:${handoffIdSuffix}`,
    linkId: binding.link.linkId,
    sourceResultId: completion.eventId,
    sourceResultSha256,
    occurredAt: source.createdAt,
    kind: 'accepted-move',
    payload: {
      completionEventId: completion.eventId,
      sourceOperationId: completion.sourceOperationId,
      resolutionId: move.resolutionId,
      sceneId: currentSceneId,
      round: completion.round,
      completionOrder: completion.order,
      actorPlacementId: move.actorPlacementId,
      canonicalMoveId: move.canonicalId,
      specVersion: move.specVersion,
      actionType: move.actionType,
      sourceActionKind: sourceActionKind(move.canonicalId, source.command),
      origin: move.origin,
      moveListSource: move.moveListSource,
      attackedTargetIds: completion.attackedTargetIds,
      hitTargetIds: completion.hitTargetIds,
      outcome: completion.outcome,
      succeeded: completion.succeeded,
      branches: completion.branches,
      replacementAttention,
    },
  }
  const handoffSha256 = digest(battleContestHandoffCanonicalJson(fact))
  return parseBattleContestHandoffDelivery({
    schemaVersion: 1,
    operationId: input.contestOperationId,
    readSet: {
      schemaVersion: 1,
      linkId: binding.link.linkId,
      contestId: input.document.contestId,
      contestRevision: input.document.revision,
      encounterId: input.encounterDocument.encounterId,
      encounterDocumentRevision: input.encounterDocument.revision,
      linkedMapSlug: input.map.slug,
      encounterRevision: input.map.revision,
      encounterSceneId: currentSceneId,
    },
    fact,
    handoffSha256,
  })
}
