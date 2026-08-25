import { createHash } from 'node:crypto'
import type { ContestDocumentV1 } from '#shared/contests/document'
import type { EncounterDocument } from '#shared/encounterDocuments/model'
import { parseEncounterHistory } from '#shared/moveAutomation/encounterHistory'
import type { TabletopMap } from '~/types/map'
import type { SqliteLivePlayOpRecord } from '../../storage/opRepository'
import { initiativeLifecycleSourceOperationId } from '../moveAutomation/planInitiativeLifecycle'

export type BattleContestLiveplayHandoffV1 =
  | {
      readonly kind: 'accepted-move'
      readonly sourceOperationId: string
      readonly sourceResultId: string
      readonly sourceResolutionId: string
      readonly actorPlacementId: string
      readonly canonicalMoveId: string
      readonly round: number
    }
  | {
      readonly kind: 'voltage-lifecycle'
      readonly sourceOperationId: string
      readonly sourceResultId: string
    }
  | {
      readonly kind: 'battle-end'
      readonly sourceOperationId: string
      readonly sourceResultId: string
      readonly reason: 'all-pokemon-knocked-out' | 'round-budget'
    }

export interface FindNextBattleContestLiveplayHandoffInputV1 {
  readonly document: ContestDocumentV1
  readonly encounterDocument: EncounterDocument
  readonly map: TabletopMap
  readonly sourceOperations: readonly SqliteLivePlayOpRecord[]
  readonly pokemonHitPointsBySheetSlug: Readonly<Record<string, number>>
}

interface Candidate {
  readonly source: SqliteLivePlayOpRecord
  readonly sourceResultId: string
  readonly sourceResolutionId: string | null
  readonly actorPlacementId: string | null
  readonly canonicalMoveId: string | null
  readonly round: number | null
  readonly kind: 'accepted-move' | 'knockout' | 'switch' | 'round-boundary'
  readonly order: number
}

const switchLifecycleSourceOperationId = (operationId: string): string => (
  `switch.${createHash('sha256').update(operationId, 'utf8').digest('hex').slice(0, 24)}`
)

const sourceIndexes = (operations: readonly SqliteLivePlayOpRecord[]): ReadonlyMap<string, SqliteLivePlayOpRecord> => {
  const index = new Map<string, SqliteLivePlayOpRecord>()
  for (const operation of operations) {
    index.set(operation.opId, operation)
    index.set(initiativeLifecycleSourceOperationId(operation.opId), operation)
    index.set(switchLifecycleSourceOperationId(operation.opId), operation)
  }
  return index
}

const teamForPokemonSheet = (document: ContestDocumentV1, sheetSlug: string): string | null => {
  const teams = document.battle?.encounter?.teams ?? []
  const matches = teams.filter(team => team.pokemon.some(member => member.sheetSlug === sheetSlug))
  return matches.length === 1 ? matches[0]!.contestantId : null
}

const teamForPlacement = (document: ContestDocumentV1, map: TabletopMap, placementId: string): string | null => {
  const placement = map.placements.find(candidate => candidate.id === placementId)
  return placement?.sheetKind === 'pokemon' ? teamForPokemonSheet(document, placement.sheetSlug) : null
}

const completeTeamIsKnockedOut = (
  document: ContestDocumentV1,
  contestantId: string,
  hitPoints: Readonly<Record<string, number>>,
): boolean => {
  const team = document.battle?.encounter?.teams.find(candidate => candidate.contestantId === contestantId)
  return Boolean(team && team.pokemon.length > 0 && team.pokemon.every(member => {
    const value = hitPoints[member.sheetSlug]
    return value !== undefined && Number.isSafeInteger(value) && value <= 0
  }))
}

const acceptedRevision = (source: SqliteLivePlayOpRecord): number => source.result.ok ? source.result.revision : Number.MAX_SAFE_INTEGER
const sourceSort = (left: Candidate, right: Candidate): number => {
  if (left.source.createdAt !== right.source.createdAt) return left.source.createdAt - right.source.createdAt
  if (acceptedRevision(left.source) !== acceptedRevision(right.source)) return acceptedRevision(left.source) - acceptedRevision(right.source)
  if (left.source.opId !== right.source.opId) return left.source.opId.localeCompare(right.source.opId)
  return left.order - right.order
}

/**
 * Find the earliest unconsumed cross-engine fact from persisted Encounter
 * operation/history authority. The returned source identities remain server-only.
 */
export const findNextBattleContestLiveplayHandoff = (
  input: FindNextBattleContestLiveplayHandoffInputV1,
): BattleContestLiveplayHandoffV1 | null => {
  const binding = input.document.battle?.encounter
  if (input.document.variantId !== 'battle' || !binding || input.document.stage !== 'performance') return null
  if (binding.link.encounterId !== input.encounterDocument.encounterId
    || binding.link.linkedMapSlug !== input.map.slug
    || input.encounterDocument.battleContest?.link.linkId !== binding.link.linkId) {
    throw new Error('Battle Contest liveplay linkage is stale.')
  }

  const history = parseEncounterHistory(input.map.encounterState?.history)
  const consumed = new Set(input.document.battleHandoffReceipts.map(receipt => receipt.sourceResultId))
  const sources = sourceIndexes(input.sourceOperations.filter(operation => operation.result.ok && operation.mapSlug === input.map.slug))
  const candidates: Candidate[] = []

  for (const move of history.moveUses) {
    const completion = move.completion
    if (!completion || consumed.has(completion.eventId) || completion.round === null || completion.round === undefined) continue
    const source = sources.get(completion.sourceOperationId)
    if (!source) continue
    candidates.push({
      source,
      sourceResultId: completion.eventId,
      sourceResolutionId: move.resolutionId,
      actorPlacementId: move.actorPlacementId,
      canonicalMoveId: move.canonicalId,
      round: completion.round,
      kind: 'accepted-move',
      order: completion.order * 10,
    })
  }

  for (const knockout of history.knockouts) {
    if (consumed.has(knockout.eventId)) continue
    const source = sources.get(knockout.sourceOperationId)
    if (!source) continue
    candidates.push({ source, sourceResultId: knockout.eventId, sourceResolutionId: knockout.resolutionId,
      actorPlacementId: knockout.actorPlacementId, canonicalMoveId: knockout.canonicalId,
      round: knockout.round ?? null, kind: 'knockout', order: 1_000_001 })
  }
  for (const knockout of history.lifecycleKnockouts) {
    if (consumed.has(knockout.eventId)) continue
    const source = sources.get(knockout.sourceOperationId)
    if (!source) continue
    candidates.push({ source, sourceResultId: knockout.eventId, sourceResolutionId: null,
      actorPlacementId: null, canonicalMoveId: null, round: knockout.round,
      kind: 'knockout', order: 1 })
  }
  for (const transition of history.switches) {
    if (consumed.has(transition.eventId) || transition.kind === 'send-out') continue
    const source = sources.get(transition.sourceOperationId)
    if (!source) continue
    candidates.push({ source, sourceResultId: transition.eventId, sourceResolutionId: null,
      actorPlacementId: null, canonicalMoveId: null, round: transition.round,
      kind: 'switch', order: 1_000_002 })
  }
  for (const boundary of history.roundBoundaries) {
    if (consumed.has(boundary.eventId)) continue
    const source = sources.get(boundary.sourceOperationId)
    if (!source) continue
    candidates.push({ source, sourceResultId: boundary.eventId, sourceResolutionId: null,
      actorPlacementId: null, canonicalMoveId: null, round: boundary.completedRound,
      kind: 'round-boundary', order: 2_000_000 })
  }

  candidates.sort(sourceSort)
  for (const candidate of candidates) {
    if (candidate.kind === 'accepted-move') {
      return Object.freeze({
        kind: 'accepted-move',
        sourceOperationId: candidate.source.opId,
        sourceResultId: candidate.sourceResultId,
        sourceResolutionId: candidate.sourceResolutionId!,
        actorPlacementId: candidate.actorPlacementId!,
        canonicalMoveId: candidate.canonicalMoveId!,
        round: candidate.round!,
      })
    }
    if (candidate.kind === 'knockout') {
      const knockout = history.knockouts.find(row => row.eventId === candidate.sourceResultId)
        ?? history.lifecycleKnockouts.find(row => row.eventId === candidate.sourceResultId)
      const targetPlacementId = knockout?.targetPlacementId
      const contestantId = targetPlacementId ? teamForPlacement(input.document, input.map, targetPlacementId) : null
      if (contestantId && completeTeamIsKnockedOut(input.document, contestantId, input.pokemonHitPointsBySheetSlug)) {
        return Object.freeze({ kind: 'battle-end', sourceOperationId: candidate.source.opId,
          sourceResultId: candidate.sourceResultId, reason: 'all-pokemon-knocked-out' })
      }
      return Object.freeze({ kind: 'voltage-lifecycle', sourceOperationId: candidate.source.opId,
        sourceResultId: candidate.sourceResultId })
    }
    if (candidate.kind === 'switch') {
      return Object.freeze({ kind: 'voltage-lifecycle', sourceOperationId: candidate.source.opId,
        sourceResultId: candidate.sourceResultId })
    }
    if (candidate.kind === 'round-boundary' && candidate.round! >= input.document.battle!.roundBudget!) {
      return Object.freeze({ kind: 'battle-end', sourceOperationId: candidate.source.opId,
        sourceResultId: candidate.sourceResultId, reason: 'round-budget' })
    }
  }
  return null
}
