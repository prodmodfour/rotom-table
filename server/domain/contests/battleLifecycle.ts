import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  battleContestHandoffCanonicalJson,
  parseBattleContestHandoffDelivery,
  type BattleContestHandoffDeliveryV1,
  type BattleContestKnockoutHandoffFactV1,
  type BattleContestSwitchHandoffFactV1,
} from '#shared/contests/battleBlend'
import type { ContestDocumentV1 } from '#shared/contests/document'
import type { EncounterDocument } from '#shared/encounterDocuments/model'
import {
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  validateLivePlayCommandEnvelope,
} from '#shared/livePlayCommands'
import { parseLivePlayMoveStatePatchPayload } from '#shared/livePlayMoveState'
import {
  parseEncounterHistory,
  type EncounterHistory,
  type EncounterKnockoutHistory,
  type EncounterLifecycleKnockoutHistory,
  type EncounterSwitchHistory,
} from '#shared/moveAutomation/encounterHistory'
import { parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { TabletopMap, SheetPlacement } from '~/types/map'
import type { SqliteLivePlayOpRecord } from '../../storage/opRepository'
import { createLivePlayCommandHash } from '../../livePlay/opResult'
import { encounterSceneId } from '../moveAutomation/planSceneLifecycle'
import { initiativeLifecycleSourceOperationId } from '../moveAutomation/planInitiativeLifecycle'
import { deriveBattleContestAcceptedMoveDelivery } from './battleAcceptedMove'

export type BattleContestLifecycleDerivationCode =
  | 'battle-contest.lifecycle-source-not-accepted'
  | 'battle-contest.lifecycle-result-missing'
  | 'battle-contest.lifecycle-result-ambiguous'
  | 'battle-contest.lifecycle-result-mismatch'

export class BattleContestLifecycleDerivationError extends Error {
  constructor(readonly code: BattleContestLifecycleDerivationCode, message: string) {
    super(message)
    this.name = 'BattleContestLifecycleDerivationError'
  }
}
const fail = (code: BattleContestLifecycleDerivationCode, message: string): never => {
  throw new BattleContestLifecycleDerivationError(code, message)
}
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const canonical = (value: unknown, path = 'battleContestLifecycleSource'): string => stableJsonStringify(value, {
  path,
  limits: { maxDepth: 48, maxNodes: 100_000, maxArrayEntries: 10_000, maxObjectFields: 512, maxStringLength: 100_000 },
})
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

export interface DeriveBattleContestVoltageLifecycleInputV1 {
  readonly document: ContestDocumentV1
  readonly encounterDocument: EncounterDocument
  readonly map: TabletopMap
  readonly sourceOperation: SqliteLivePlayOpRecord
  /** Root accepted live-play operation, never a client-authored consequence. */
  readonly sourceOperationId: string
  /** Exact typed Encounter-history event to consume. */
  readonly sourceResultId: string
  readonly contestOperationId: string
}

export interface DerivedBattleContestVoltageLifecycleV1 {
  readonly delivery: BattleContestHandoffDeliveryV1
  readonly targetPokemonSheetSlug: string | null
  readonly sourcePokemonSheetSlug: string | null
  readonly recalledPokemonSheetSlug: string | null
  readonly sentOutPokemonSheetSlug: string | null
  readonly opposingActivePokemonSheetSlugs: readonly string[]
}

const commonAuthority = (input: DeriveBattleContestVoltageLifecycleInputV1) => {
  const binding = input.document.battle?.encounter
  if (!binding || input.document.variantId !== 'battle' || input.document.stage !== 'performance'
    || binding.link.encounterId !== input.encounterDocument.encounterId
    || binding.link.linkedMapSlug !== input.map.slug
    || input.encounterDocument.battleContest?.link.linkId !== binding.link.linkId) {
    return fail('battle-contest.lifecycle-result-mismatch', 'Contest, Encounter Document, linked map, and Performance authority do not agree.')
  }
  const source = input.sourceOperation
  if (source.opId !== input.sourceOperationId || source.mapSlug !== input.map.slug || !source.result.ok) {
    return fail('battle-contest.lifecycle-source-not-accepted', 'Lifecycle source must be one persisted accepted operation on the linked map.')
  }
  if (!Number.isSafeInteger(input.map.revision) || source.result.revision > Number(input.map.revision)
    || source.resultRevision !== undefined && source.resultRevision !== source.result.revision) {
    return fail('battle-contest.lifecycle-result-mismatch', 'Persisted source revision is not part of current linked-map authority.')
  }
  const validation = validateLivePlayCommandEnvelope(source.command)
  if (!validation.valid || validation.command.opId !== source.opId || validation.command.mapSlug !== source.mapSlug
    || createLivePlayCommandHash(validation.command) !== source.commandHash
    || validation.command.baseRevision >= source.result.revision) {
    return fail('battle-contest.lifecycle-result-mismatch', 'Persisted source command, hash, map, operation, and accepted revision do not agree.')
  }
  let history: EncounterHistory
  try { history = parseEncounterHistory(input.map.encounterState?.history) }
  catch { return fail('battle-contest.lifecycle-result-mismatch', 'Linked-map Encounter history is malformed.') }
  const sceneId = input.map.activeScene ? encounterSceneId(input.map.slug, input.map.activeScene) : null
  if (sceneId === null || history.sceneId !== sceneId || binding.sceneId !== sceneId) {
    return fail('battle-contest.lifecycle-result-mismatch', 'Lifecycle source is not bound to the active linked Encounter Scene.')
  }
  return { binding, source, command: validation.command, history, sceneId }
}

const movePatch = (source: SqliteLivePlayOpRecord) => {
  const result = source.result
  if (!result.ok) return fail('battle-contest.lifecycle-source-not-accepted', 'Move source result is not accepted.')
  const patches = result.patches.filter(patch => patch.type === LIVE_PLAY_PATCH_TYPES.MOVE_STATE)
  if (patches.length !== 1) return fail(patches.length === 0 ? 'battle-contest.lifecycle-result-missing' : 'battle-contest.lifecycle-result-ambiguous', 'Accepted Move source must contain exactly one move.state patch.')
  const patch = patches[0]!
  const parsed = parseLivePlayMoveStatePatchPayload(patch.payload)
  if (!parsed.valid || patch.mapSlug !== source.mapSlug || patch.revision !== result.revision) return fail('battle-contest.lifecycle-result-mismatch', 'Accepted Move patch is malformed or does not match the source revision.')
  return parsed.payload
}

const lifecyclePatchHistory = (source: SqliteLivePlayOpRecord): EncounterHistory => {
  const result = source.result
  if (!result.ok) return fail('battle-contest.lifecycle-source-not-accepted', 'Lifecycle source result is not accepted.')
  const patches = result.patches.filter(patch => patch.type === LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE)
  if (patches.length !== 1) return fail(patches.length === 0 ? 'battle-contest.lifecycle-result-missing' : 'battle-contest.lifecycle-result-ambiguous', 'Accepted lifecycle source must contain exactly one initiative patch.')
  const patch = patches[0]!
  const payload = record(patch.payload)
  const lifecycle = record(payload?.lifecycle)
  const currentEncounterState = lifecycle?.currentEncounterState
  const events = Array.isArray(lifecycle?.events) ? lifecycle.events : []
  if (patch.mapSlug !== source.mapSlug || patch.revision !== result.revision
    || payload?.command !== LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE || !currentEncounterState) {
    return fail('battle-contest.lifecycle-result-mismatch', 'Accepted initiative patch lacks exact lifecycle state authority.')
  }
  let history: EncounterHistory
  try { history = parseEncounterState(currentEncounterState).history }
  catch { return fail('battle-contest.lifecycle-result-mismatch', 'Accepted lifecycle patch contains malformed Encounter state.') }
  if (!events.some(event => record(event)?.kind === 'lifecycle-ko')) return fail('battle-contest.lifecycle-result-missing', 'Accepted lifecycle patch has no typed lifecycle knockout event.')
  return history
}

const placementPatchAuthority = (source: SqliteLivePlayOpRecord, commandType: string): {
  readonly history: EncounterHistory
  readonly previous: SheetPlacement | null
  readonly current: SheetPlacement | null
} => {
  const result = source.result
  if (!result.ok) return fail('battle-contest.lifecycle-source-not-accepted', 'Presence source result is not accepted.')
  const patches = result.patches.filter(patch => patch.type === LIVE_PLAY_PATCH_TYPES.MAP_PLACEMENTS)
  if (patches.length !== 1) return fail(patches.length === 0 ? 'battle-contest.lifecycle-result-missing' : 'battle-contest.lifecycle-result-ambiguous', 'Accepted presence source must contain exactly one map.placements patch.')
  const patch = patches[0]!, payload = record(patch.payload)
  if (!payload || patch.mapSlug !== source.mapSlug || patch.revision !== result.revision
    || payload.command !== commandType || payload.currentEncounterState === undefined) {
    return fail('battle-contest.lifecycle-result-mismatch', 'Accepted presence patch lacks exact command, revision, and Encounter-history authority.')
  }
  let history: EncounterHistory
  try { history = parseEncounterState(payload.currentEncounterState).history }
  catch { return fail('battle-contest.lifecycle-result-mismatch', 'Accepted presence patch contains malformed Encounter state.') }
  const parsePlacement = (value: unknown, label: string): SheetPlacement | null => {
    if (value === null) return null
    const placement = record(value)
    if (!placement || typeof placement.id !== 'string' || !placement.id
      || placement.sheetKind !== 'pokemon' || typeof placement.sheetSlug !== 'string' || !placement.sheetSlug
      || typeof placement.sideId !== 'string' || !placement.sideId) {
      return fail('battle-contest.lifecycle-result-mismatch', `${label} is not one exact side-bound Pokémon placement.`)
    }
    return placement as unknown as SheetPlacement
  }
  const previous = parsePlacement(payload.previous, 'Previous presence authority')
  const current = parsePlacement(payload.current, 'Current presence authority')
  if (payload.placementId !== (previous?.id ?? current?.id)) return fail('battle-contest.lifecycle-result-mismatch', 'Presence patch placement identity does not match its before/after authority.')
  return { history, previous, current }
}

const uniqueByEventId = <T extends { readonly eventId: string }>(
  rows: readonly T[],
  eventId: string,
  label: string,
): T => {
  const matches = rows.filter(row => row.eventId === eventId)
  if (matches.length === 0) return fail('battle-contest.lifecycle-result-missing', `${label} event is absent from current Encounter history.`)
  if (matches.length !== 1) return fail('battle-contest.lifecycle-result-ambiguous', `${label} event identity resolves more than once.`)
  return matches[0]!
}

const exactPatchRow = <T>(current: T, patch: T, label: string): void => {
  if (canonical(current, `${label}.current`) !== canonical(patch, `${label}.patch`)) return fail('battle-contest.lifecycle-result-mismatch', `${label} changed between accepted result and current map authority.`)
}

const pokemonPlacement = (
  placements: readonly SheetPlacement[],
  placementId: string | null,
  label: string,
): SheetPlacement | null => {
  if (placementId === null) return null
  const matches = placements.filter(placement => placement.id === placementId && placement.sheetKind === 'pokemon')
  if (matches.length !== 1) return fail('battle-contest.lifecycle-result-mismatch', `${label} does not identify exactly one Pokémon placement.`)
  return matches[0]!
}

const enrolledTeamForPlacement = (
  input: DeriveBattleContestVoltageLifecycleInputV1,
  placement: SheetPlacement,
) => {
  const binding = input.document.battle!.encounter!
  const matches = binding.teams.filter(team => team.sideId === placement.sideId && team.pokemon.some(member => member.sheetSlug === placement.sheetSlug))
  if (matches.length !== 1) return fail('battle-contest.lifecycle-result-mismatch', 'Pokémon placement is outside the immutable Battle team and side enrollment.')
  return matches[0]!
}

const opposingActiveSlugs = (
  input: DeriveBattleContestVoltageLifecycleInputV1,
  teamSideId: string,
): readonly string[] => {
  const binding = input.document.battle!.encounter!
  const opponents = binding.teams.filter(team => team.sideId !== teamSideId)
  if (opponents.length !== 1) return fail('battle-contest.lifecycle-result-mismatch', 'Battle lifecycle source does not resolve exactly one opposing Trainer team.')
  const opponent = opponents[0]!
  return Object.freeze(input.map.placements.filter(placement => placement.sheetKind === 'pokemon'
    && placement.sideId === opponent.sideId
    && opponent.pokemon.some(member => member.sheetSlug === placement.sheetSlug))
    .map(placement => placement.sheetSlug))
}

const sourceMaterialHash = (source: SqliteLivePlayOpRecord, row: unknown): string => digest(canonical({
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
  lifecycleRow: row,
}))

const deliveryFor = (input: {
  readonly commandInput: DeriveBattleContestVoltageLifecycleInputV1
  readonly sceneId: string
  readonly fact: BattleContestKnockoutHandoffFactV1 | BattleContestSwitchHandoffFactV1
}): BattleContestHandoffDeliveryV1 => {
  const binding = input.commandInput.document.battle!.encounter!
  const source = input.commandInput.sourceOperation
  const fact = input.fact
  return parseBattleContestHandoffDelivery({
    schemaVersion: 1,
    operationId: input.commandInput.contestOperationId,
    readSet: {
      schemaVersion: 1,
      linkId: binding.link.linkId,
      contestId: input.commandInput.document.contestId,
      contestRevision: input.commandInput.document.revision,
      encounterId: input.commandInput.encounterDocument.encounterId,
      encounterDocumentRevision: input.commandInput.encounterDocument.revision,
      linkedMapSlug: input.commandInput.map.slug,
      encounterRevision: input.commandInput.map.revision,
      encounterSceneId: input.sceneId,
    },
    fact,
    handoffSha256: digest(battleContestHandoffCanonicalJson(fact)),
  })
}

/**
 * Reconstruct one KO or switch handoff from accepted operation patches and
 * exact current map-owned history. No cause, actor, target, round, or exception
 * claim is accepted from the coordinator caller.
 */
export const deriveBattleContestVoltageLifecycleDelivery = (
  input: DeriveBattleContestVoltageLifecycleInputV1,
): DerivedBattleContestVoltageLifecycleV1 => {
  const authority = commonAuthority(input)
  const eventMatches = [
    ...authority.history.knockouts.filter(row => row.eventId === input.sourceResultId).map(row => ({ kind: 'attack' as const, row })),
    ...authority.history.lifecycleKnockouts.filter(row => row.eventId === input.sourceResultId).map(row => ({ kind: 'lifecycle' as const, row })),
    ...authority.history.switches.filter(row => row.eventId === input.sourceResultId).map(row => ({ kind: 'switch' as const, row })),
  ]
  if (eventMatches.length === 0) return fail('battle-contest.lifecycle-result-missing', 'Source result identity has no matching typed KO or switch history row.')
  if (eventMatches.length !== 1) return fail('battle-contest.lifecycle-result-ambiguous', 'Source result identity matches more than one lifecycle history row.')
  const matched = eventMatches[0]!
  const suffixMaterial = `${authority.binding.link.linkId}\n${input.sourceResultId}`

  if (matched.kind === 'attack') {
    const row = matched.row as EncounterKnockoutHistory
    const acceptedMove = deriveBattleContestAcceptedMoveDelivery({
      document: input.document,
      encounterDocument: input.encounterDocument,
      map: input.map,
      sourceOperation: input.sourceOperation,
      sourceOperationId: input.sourceOperationId,
      sourceResolutionId: row.resolutionId,
      contestOperationId: input.contestOperationId,
    })
    if (acceptedMove.fact.kind !== 'accepted-move') throw new Error('Accepted Move derivation returned the wrong handoff kind.')
    const patch = movePatch(authority.source)
    const patchHistory = parseEncounterHistory(patch.changes.encounterState?.current.history)
    const patchRow = uniqueByEventId(patchHistory.knockouts, row.eventId, 'Attack knockout patch')
    exactPatchRow(row, patchRow, 'Attack knockout')
    if (row.actorPlacementId !== acceptedMove.fact.payload.actorPlacementId || row.canonicalId !== acceptedMove.fact.payload.canonicalMoveId
      || row.round === null || row.round === undefined || !acceptedMove.fact.payload.hitTargetIds.includes(row.targetPlacementId)) {
      return fail('battle-contest.lifecycle-result-mismatch', 'Attack knockout does not match the accepted Move actor, identity, round, or hit targets.')
    }
    const sourcePlacement = pokemonPlacement(input.map.placements, row.actorPlacementId, 'Attack knockout source')!
    const targetPlacement = pokemonPlacement(input.map.placements, row.targetPlacementId, 'Attack knockout target')!
    enrolledTeamForPlacement(input, sourcePlacement)
    enrolledTeamForPlacement(input, targetPlacement)
    const sourceResultSha256 = sourceMaterialHash(authority.source, row)
    const fact: BattleContestKnockoutHandoffFactV1 = {
      schemaVersion: 1,
      handoffId: `battle-contest-handoff:v1:${digest(`${suffixMaterial}\n${sourceResultSha256}`).slice(0, 40)}`,
      linkId: authority.binding.link.linkId,
      sourceResultId: row.eventId,
      sourceResultSha256,
      occurredAt: authority.source.createdAt,
      kind: 'knockout',
      payload: {
        eventId: row.eventId,
        sourceOperationId: row.sourceOperationId,
        sceneId: authority.sceneId,
        round: row.round,
        targetPlacementId: row.targetPlacementId,
        sourcePlacementId: row.actorPlacementId,
        causalResolutionId: row.resolutionId,
        causalCanonicalId: row.canonicalId,
        cause: 'attack',
      },
    }
    return Object.freeze({
      delivery: deliveryFor({ commandInput: input, sceneId: authority.sceneId, fact }),
      targetPokemonSheetSlug: targetPlacement.sheetSlug,
      sourcePokemonSheetSlug: sourcePlacement.sheetSlug,
      recalledPokemonSheetSlug: null,
      sentOutPokemonSheetSlug: null,
      opposingActivePokemonSheetSlugs: Object.freeze([]),
    })
  }

  if (matched.kind === 'lifecycle') {
    if (authority.command.type !== LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE) return fail('battle-contest.lifecycle-result-mismatch', 'Lifecycle knockout must come from one accepted nextInitiative boundary.')
    const row = matched.row as EncounterLifecycleKnockoutHistory
    const patchHistory = lifecyclePatchHistory(authority.source)
    const patchRow = uniqueByEventId(patchHistory.lifecycleKnockouts, row.eventId, 'Lifecycle knockout patch')
    exactPatchRow(row, patchRow, 'Lifecycle knockout')
    if (row.sourceOperationId !== initiativeLifecycleSourceOperationId(authority.source.opId) || row.round === null) return fail('battle-contest.lifecycle-result-mismatch', 'Lifecycle knockout lacks exact source-operation and Encounter-round authority.')
    const targetPlacement = pokemonPlacement(input.map.placements, row.targetPlacementId, 'Lifecycle knockout target')!
    const targetTeam = enrolledTeamForPlacement(input, targetPlacement)
    const sourceResultSha256 = sourceMaterialHash(authority.source, row)
    const fact: BattleContestKnockoutHandoffFactV1 = {
      schemaVersion: 1,
      handoffId: `battle-contest-handoff:v1:${digest(`${suffixMaterial}\n${sourceResultSha256}`).slice(0, 40)}`,
      linkId: authority.binding.link.linkId,
      sourceResultId: row.eventId,
      sourceResultSha256,
      occurredAt: authority.source.createdAt,
      kind: 'knockout',
      payload: {
        eventId: row.eventId,
        sourceOperationId: row.sourceOperationId,
        sceneId: authority.sceneId,
        round: row.round,
        targetPlacementId: row.targetPlacementId,
        sourcePlacementId: null,
        causalResolutionId: null,
        causalCanonicalId: null,
        cause: row.cause,
      },
    }
    return Object.freeze({
      delivery: deliveryFor({ commandInput: input, sceneId: authority.sceneId, fact }),
      targetPokemonSheetSlug: targetPlacement.sheetSlug,
      sourcePokemonSheetSlug: null,
      recalledPokemonSheetSlug: null,
      sentOutPokemonSheetSlug: null,
      opposingActivePokemonSheetSlugs: opposingActiveSlugs(input, targetTeam.sideId),
    })
  }

  const row = matched.row as EncounterSwitchHistory
  let recalled: SheetPlacement | null
  let sentOut: SheetPlacement | null
  let encounterRound: number
  let causalResolutionId: string | null
  let causalCanonicalId: string | null
  if (authority.command.type === LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE) {
    const sourceMoves = authority.history.moveUses.filter(move => move.completion?.sourceOperationId === authority.source.opId)
    if (sourceMoves.length === 0) return fail('battle-contest.lifecycle-result-missing', 'Accepted switch source has no completed primary Move history.')
    if (sourceMoves.length !== 1) return fail('battle-contest.lifecycle-result-ambiguous', 'Accepted switch source has ambiguous completed Move ancestry.')
    const sourceMove = sourceMoves[0]!
    const acceptedMove = deriveBattleContestAcceptedMoveDelivery({
      document: input.document,
      encounterDocument: input.encounterDocument,
      map: input.map,
      sourceOperation: input.sourceOperation,
      sourceOperationId: input.sourceOperationId,
      sourceResolutionId: sourceMove.resolutionId,
      contestOperationId: input.contestOperationId,
    })
    if (acceptedMove.fact.kind !== 'accepted-move' || acceptedMove.fact.payload.round === null || row.round !== acceptedMove.fact.payload.round) return fail('battle-contest.lifecycle-result-mismatch', 'Switch source has no matching accepted Move and Encounter-round authority.')
    const patch = movePatch(authority.source)
    const patchHistory = parseEncounterHistory(patch.changes.encounterState?.current.history)
    const patchRow = uniqueByEventId(patchHistory.switches, row.eventId, 'Switch patch')
    exactPatchRow(row, patchRow, 'Switch')
    const placements = patch.changes.placements
    if (!placements) return fail('battle-contest.lifecycle-result-mismatch', 'Accepted switch patch has no exact before/after placement authority.')
    recalled = pokemonPlacement(placements.previous, row.recalledPlacementId, 'Recalled Pokémon')
    sentOut = pokemonPlacement(placements.current, row.sentOutPlacementId, 'Sent-out Pokémon')
    encounterRound = acceptedMove.fact.payload.round
    causalResolutionId = sourceMove.resolutionId
    causalCanonicalId = sourceMove.canonicalId
  } else if (authority.command.type === LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN && row.kind === 'recall') {
    const patch = placementPatchAuthority(authority.source, authority.command.type)
    const patchRow = uniqueByEventId(patch.history.switches, row.eventId, 'Recall patch')
    exactPatchRow(row, patchRow, 'Recall')
    if (row.sourceOperationId !== authority.source.opId || row.round === null || row.causalProviderId !== null
      || row.recalledPlacementId !== patch.previous?.id || patch.current !== null) {
      return fail('battle-contest.lifecycle-result-mismatch', 'Manual recall history does not match exact accepted delete-token authority.')
    }
    recalled = patch.previous
    sentOut = null
    encounterRound = row.round
    causalResolutionId = null
    causalCanonicalId = null
  } else {
    return fail('battle-contest.lifecycle-result-mismatch', 'Switch authority requires one accepted primary Move or manual Pokémon recall operation.')
  }
  if (recalled) enrolledTeamForPlacement(input, recalled)
  if (sentOut) enrolledTeamForPlacement(input, sentOut)
  if (row.kind === 'switch' && (!recalled || !sentOut || recalled.sideId !== sentOut.sideId)
    || row.kind === 'recall' && (!recalled || sentOut !== null)
    || row.kind === 'send-out' && (recalled !== null || !sentOut)) return fail('battle-contest.lifecycle-result-mismatch', 'Switch history does not match exact before/after Pokémon placements.')
  const sourceResultSha256 = sourceMaterialHash(authority.source, row)
  const fact: BattleContestSwitchHandoffFactV1 = {
    schemaVersion: 1,
    handoffId: `battle-contest-handoff:v1:${digest(`${suffixMaterial}\n${sourceResultSha256}`).slice(0, 40)}`,
    linkId: authority.binding.link.linkId,
    sourceResultId: row.eventId,
    sourceResultSha256,
    occurredAt: authority.source.createdAt,
    kind: 'switch',
    payload: {
      eventId: row.eventId,
      sourceOperationId: row.sourceOperationId,
      sceneId: authority.sceneId,
      round: encounterRound,
      switchKind: row.kind,
      recalledPlacementId: row.recalledPlacementId,
      sentOutPlacementId: row.sentOutPlacementId,
      causalResolutionId,
      causalCanonicalId,
      causalProviderId: row.causalProviderId,
    },
  }
  return Object.freeze({
    delivery: deliveryFor({ commandInput: input, sceneId: authority.sceneId, fact }),
    targetPokemonSheetSlug: null,
    sourcePokemonSheetSlug: null,
    recalledPokemonSheetSlug: recalled?.sheetSlug ?? null,
    sentOutPokemonSheetSlug: sentOut?.sheetSlug ?? null,
    opposingActivePokemonSheetSlugs: Object.freeze([]),
  })
}
