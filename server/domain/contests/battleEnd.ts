import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { ContestRandomSource } from '#shared/contests/dice'
import { parseContestDocument, type ContestDocumentV1 } from '#shared/contests/document'
import {
  battleContestHandoffCanonicalJson,
  decideBattleContestHandoffDelivery,
  parseBattleContestHandoffDelivery,
  parseBattleContestHandoffReceipt,
  type BattleContestEncounterEndedHandoffFactV1,
  type BattleContestHandoffDeliveryV1,
  type BattleContestHandoffReceiptV1,
  type BattleContestRoundBoundaryHandoffFactV1,
} from '#shared/contests/battleBlend'
import type { EncounterDocument } from '#shared/encounterDocuments/model'
import { LIVE_PLAY_COMMAND_TYPES, LIVE_PLAY_PATCH_TYPES, validateLivePlayCommandEnvelope } from '#shared/livePlayCommands'
import { parseEncounterHistory, type EncounterHistory } from '#shared/moveAutomation/encounterHistory'
import { parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { TabletopMap } from '~/types/map'
import type { SqliteLivePlayOpRecord } from '../../storage/opRepository'
import { createLivePlayCommandHash } from '../../livePlay/opResult'
import { encounterSceneId } from '../moveAutomation/planSceneLifecycle'
import { initiativeLifecycleSourceOperationId } from '../moveAutomation/planInitiativeLifecycle'
import { finalizeContestPerformancePlacements } from './engine'
import { deriveBattleContestVoltageLifecycleDelivery } from './battleLifecycle'

export type BattleContestEndConditionV1 = 'round-budget-exhausted' | 'one-trainer-all-pokemon-knocked-out'
export type BattleContestEndErrorCode =
  | 'battle-contest.end-stage-mismatch'
  | 'battle-contest.end-source-not-accepted'
  | 'battle-contest.end-source-missing'
  | 'battle-contest.end-source-ambiguous'
  | 'battle-contest.end-source-mismatch'
  | 'battle-contest.end-condition-not-met'

export class BattleContestEndError extends Error {
  constructor(readonly code: BattleContestEndErrorCode, message: string) {
    super(message)
    this.name = 'BattleContestEndError'
  }
}
const fail = (code: BattleContestEndErrorCode, message: string): never => { throw new BattleContestEndError(code, message) }
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const canonical = (value: unknown, path = 'battleContestEndSource'): string => stableJsonStringify(value, {
  path,
  limits: { maxDepth: 48, maxNodes: 100_000, maxArrayEntries: 10_000, maxObjectFields: 512, maxStringLength: 100_000 },
})
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

interface BattleEndDerivationInputV1 {
  readonly document: ContestDocumentV1
  readonly encounterDocument: EncounterDocument
  readonly map: TabletopMap
  readonly sourceOperation: SqliteLivePlayOpRecord
  readonly sourceOperationId: string
  readonly sourceResultId: string
  readonly contestOperationId: string
}

const commonAuthority = (input: BattleEndDerivationInputV1) => {
  const document = parseContestDocument(input.document)
  const binding = document.battle?.encounter
  if (document.variantId !== 'battle' || document.stage !== 'performance' || !binding) return fail('battle-contest.end-stage-mismatch', 'Battle end derivation requires one linked Contest in Performance.')
  if (binding.link.encounterId !== input.encounterDocument.encounterId
    || binding.link.linkedMapSlug !== input.map.slug
    || input.encounterDocument.battleContest?.link.linkId !== binding.link.linkId) return fail('battle-contest.end-source-mismatch', 'Contest, Encounter Document, and linked map identities do not agree.')
  const source = input.sourceOperation
  if (source.opId !== input.sourceOperationId || source.mapSlug !== input.map.slug || !source.result.ok) return fail('battle-contest.end-source-not-accepted', 'Battle end source must be one persisted accepted linked-map operation.')
  const validated = validateLivePlayCommandEnvelope(source.command)
  if (!validated.valid || validated.command.opId !== source.opId || createLivePlayCommandHash(validated.command) !== source.commandHash
    || validated.command.baseRevision >= source.result.revision || source.result.revision > Number(input.map.revision)
    || source.resultRevision !== undefined && source.resultRevision !== source.result.revision) return fail('battle-contest.end-source-mismatch', 'Persisted end command, hash, map, and accepted revision do not agree.')
  let history: EncounterHistory
  try { history = parseEncounterHistory(input.map.encounterState?.history) }
  catch { return fail('battle-contest.end-source-mismatch', 'Current linked-map Encounter history is malformed.') }
  const sceneId = input.map.activeScene ? encounterSceneId(input.map.slug, input.map.activeScene) : null
  if (!sceneId || history.sceneId !== sceneId || binding.sceneId !== sceneId) return fail('battle-contest.end-source-mismatch', 'Battle end source is outside the immutable active Scene.')
  return { document, binding, source, command: validated.command, history, sceneId }
}

const readSet = (input: BattleEndDerivationInputV1, sceneId: string) => ({
  schemaVersion: 1 as const,
  linkId: input.document.battle!.encounter!.link.linkId,
  contestId: input.document.contestId,
  contestRevision: input.document.revision,
  encounterId: input.encounterDocument.encounterId,
  encounterDocumentRevision: input.encounterDocument.revision,
  linkedMapSlug: input.map.slug,
  encounterRevision: input.map.revision!,
  encounterSceneId: sceneId,
})
const delivery = (input: BattleEndDerivationInputV1, sceneId: string, fact: BattleContestRoundBoundaryHandoffFactV1 | BattleContestEncounterEndedHandoffFactV1): BattleContestHandoffDeliveryV1 => parseBattleContestHandoffDelivery({
  schemaVersion: 1,
  operationId: input.contestOperationId,
  readSet: readSet(input, sceneId),
  fact,
  handoffSha256: digest(battleContestHandoffCanonicalJson(fact)),
})

export const deriveBattleContestRoundBudgetEndDelivery = (input: BattleEndDerivationInputV1): BattleContestHandoffDeliveryV1 => {
  const authority = commonAuthority(input)
  if (authority.command.type !== LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE) return fail('battle-contest.end-source-mismatch', 'Round-budget exhaustion requires one accepted nextInitiative boundary.')
  const acceptedResult = authority.source.result
  if (!acceptedResult.ok) return fail('battle-contest.end-source-not-accepted', 'Round-budget source operation was not accepted.')
  const patches = acceptedResult.patches.filter(patch => patch.type === LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE)
  if (patches.length !== 1) return fail(patches.length ? 'battle-contest.end-source-ambiguous' : 'battle-contest.end-source-missing', 'Round-budget source must contain exactly one initiative patch.')
  const patch = patches[0]!, payload = record(patch.payload), lifecycle = record(payload?.lifecycle)
  if (patch.mapSlug !== input.map.slug || patch.revision !== acceptedResult.revision
    || payload?.command !== LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE || lifecycle?.currentEncounterState === undefined) return fail('battle-contest.end-source-mismatch', 'Accepted round-budget patch lacks exact lifecycle authority.')
  let patchHistory: EncounterHistory
  try { patchHistory = parseEncounterState(lifecycle.currentEncounterState).history }
  catch { return fail('battle-contest.end-source-mismatch', 'Accepted round-budget patch Encounter state is malformed.') }
  const currentMatches = authority.history.roundBoundaries.filter(row => row.eventId === input.sourceResultId)
  const patchMatches = patchHistory.roundBoundaries.filter(row => row.eventId === input.sourceResultId)
  if (!currentMatches.length || !patchMatches.length) return fail('battle-contest.end-source-missing', 'Accepted round boundary is absent from patch or current history.')
  if (currentMatches.length !== 1 || patchMatches.length !== 1) return fail('battle-contest.end-source-ambiguous', 'Accepted round boundary resolves more than once.')
  const row = currentMatches[0]!, patchRow = patchMatches[0]!
  if (canonical(row) !== canonical(patchRow) || row.sourceOperationId !== initiativeLifecycleSourceOperationId(authority.source.opId)
    || row.completedRound !== authority.document.battle!.roundBudget || row.nextRound !== row.completedRound + 1
    || input.map.initiative?.round !== row.nextRound) return fail('battle-contest.end-condition-not-met', 'Accepted round boundary has not exhausted the immutable Battle round budget.')
  const events = Array.isArray(lifecycle.events) ? lifecycle.events : []
  if (!events.some(event => record(event)?.eventId === row.eventId && record(event)?.kind === 'round-end')
    || !events.some(event => record(event)?.eventId === row.nextRoundEventId && record(event)?.kind === 'round-start')) return fail('battle-contest.end-source-mismatch', 'Accepted lifecycle patch does not retain both exact round-boundary events.')
  const sourceResultSha256 = digest(canonical({ source: authority.source, roundBoundary: row }))
  const fact: BattleContestRoundBoundaryHandoffFactV1 = {
    schemaVersion: 1,
    handoffId: `battle-contest-handoff:v1:${digest(`${authority.binding.link.linkId}\n${row.eventId}\n${sourceResultSha256}`).slice(0, 40)}`,
    linkId: authority.binding.link.linkId,
    sourceResultId: row.eventId,
    sourceResultSha256,
    occurredAt: authority.source.createdAt,
    kind: 'round-boundary',
    payload: {
      eventId: row.eventId,
      sourceOperationId: row.sourceOperationId,
      sceneId: authority.sceneId,
      completedRound: row.completedRound,
      nextRound: row.nextRound,
    },
  }
  return delivery(input, authority.sceneId, fact)
}

export const deriveBattleContestAllPokemonKnockedOutEndDelivery = (input: BattleEndDerivationInputV1 & {
  readonly pokemonHitPointsBySheetSlug: Readonly<Record<string, number>>
}): BattleContestHandoffDeliveryV1 => {
  const authority = commonAuthority(input)
  const knockout = deriveBattleContestVoltageLifecycleDelivery({
    document: authority.document,
    encounterDocument: input.encounterDocument,
    map: input.map,
    sourceOperation: input.sourceOperation,
    sourceOperationId: input.sourceOperationId,
    sourceResultId: input.sourceResultId,
    contestOperationId: input.contestOperationId,
  })
  if (knockout.delivery.fact.kind !== 'knockout' || knockout.targetPokemonSheetSlug === null) return fail('battle-contest.end-source-mismatch', 'All-knocked-out ending requires one exact accepted knockout source.')
  const targetTeams = authority.binding.teams.filter(team => team.pokemon.some(member => member.sheetSlug === knockout.targetPokemonSheetSlug))
  if (targetTeams.length !== 1) return fail('battle-contest.end-source-mismatch', 'Final knockout target is outside one immutable Battle team.')
  const hpRows = authority.binding.teams.flatMap(team => team.pokemon.map(member => ({ sideId: team.sideId, sheetSlug: member.sheetSlug, currentHp: input.pokemonHitPointsBySheetSlug[member.sheetSlug] })))
  if (hpRows.some(row => !Number.isSafeInteger(row.currentHp))) return fail('battle-contest.end-source-mismatch', 'All enrolled Pokémon require authoritative integer current HP.')
  const allKnockedOutSideIds = authority.binding.teams.filter(team => team.pokemon.every(member => Number(input.pokemonHitPointsBySheetSlug[member.sheetSlug]) <= 0)).map(team => team.sideId).sort()
  if (!allKnockedOutSideIds.includes(targetTeams[0]!.sideId)) return fail('battle-contest.end-condition-not-met', 'The final knockout did not leave its Trainer team with all Pokémon knocked out.')
  const sourceResultSha256 = digest(canonical({ knockoutFact: knockout.delivery.fact, hpRows }))
  const sourceResultId = `battle-end:${digest(`${knockout.delivery.fact.sourceResultId}\n${sourceResultSha256}`).slice(0, 48)}`
  const fact: BattleContestEncounterEndedHandoffFactV1 = {
    schemaVersion: 1,
    handoffId: `battle-contest-handoff:v1:${digest(`${authority.binding.link.linkId}\n${sourceResultId}\n${sourceResultSha256}`).slice(0, 40)}`,
    linkId: authority.binding.link.linkId,
    sourceResultId,
    sourceResultSha256,
    occurredAt: authority.source.createdAt,
    kind: 'encounter-ended',
    payload: {
      eventId: `event:battle-end:${digest(sourceResultId).slice(0, 32)}`,
      sourceOperationId: knockout.delivery.fact.payload.sourceOperationId,
      sceneId: authority.sceneId,
      round: knockout.delivery.fact.payload.round,
      reason: 'completed',
      allKnockedOutSideIds,
    },
  }
  return delivery(input, authority.sceneId, fact)
}

export interface ExecuteBattleContestEndResultV1 {
  readonly document: ContestDocumentV1
  readonly receipt: BattleContestHandoffReceiptV1
  readonly condition: BattleContestEndConditionV1
  readonly winnerContestantId: string
  readonly exactRetry: boolean
}

export const executeBattleContestEnd = (input: {
  readonly document: ContestDocumentV1
  readonly delivery: BattleContestHandoffDeliveryV1
  readonly now: number
  readonly random: ContestRandomSource
}): ExecuteBattleContestEndResultV1 => {
  const before = parseContestDocument(input.document)
  const parsedDelivery = parseBattleContestHandoffDelivery(input.delivery)
  const decision = decideBattleContestHandoffDelivery(before.battleHandoffReceipts, parsedDelivery)
  if (decision.kind === 'exact-retry') {
    if (decision.receipt.outcome !== 'contest-ended' || !['settling', 'completed'].includes(before.stage)) return fail('battle-contest.end-source-mismatch', 'Exact end retry does not bind the terminal Battle state.')
    const winner = before.contestants.find(row => row.finalPlacement === 1) ?? fail('battle-contest.end-source-mismatch', 'Terminal Battle state has no winner.')
    const history = before.history.find(row => row.operationId === decision.receipt.operationId)
    return Object.freeze({ document: before, receipt: decision.receipt, condition: history?.type === 'battle-ended-round-budget' ? 'round-budget-exhausted' : 'one-trainer-all-pokemon-knocked-out', winnerContestantId: winner.contestantId, exactRetry: true })
  }
  if (before.variantId !== 'battle' || before.stage !== 'performance' || !before.battle?.encounter || parsedDelivery.fact.linkId !== before.battle.encounter.link.linkId) return fail('battle-contest.end-stage-mismatch', 'Battle end execution requires one linked Contest in Performance.')
  let condition: BattleContestEndConditionV1
  let endingRound: number
  let historyType: string
  let historyDetail: string
  if (parsedDelivery.fact.kind === 'round-boundary') {
    if (parsedDelivery.fact.payload.completedRound !== before.battle.roundBudget || parsedDelivery.fact.payload.nextRound !== Number(before.battle.roundBudget) + 1) return fail('battle-contest.end-condition-not-met', 'Round-boundary handoff does not exhaust this Battle round budget.')
    condition = 'round-budget-exhausted'; endingRound = parsedDelivery.fact.payload.completedRound
    historyType = 'battle-ended-round-budget'; historyDetail = `The ${endingRound}-round Battle budget was exhausted; Appeal points determine the winner.`
  } else if (parsedDelivery.fact.kind === 'encounter-ended') {
    if (parsedDelivery.fact.payload.reason !== 'completed' || parsedDelivery.fact.payload.round === null || parsedDelivery.fact.payload.allKnockedOutSideIds.length < 1
      || parsedDelivery.fact.payload.allKnockedOutSideIds.some(sideId => !before.battle!.encounter!.teams.some(team => team.sideId === sideId))) return fail('battle-contest.end-condition-not-met', 'Encounter-ended handoff does not identify an all-knocked-out Battle side.')
    condition = 'one-trainer-all-pokemon-knocked-out'; endingRound = parsedDelivery.fact.payload.round
    historyType = 'battle-ended-all-pokemon-ko'; historyDetail = 'One Trainer has no conscious enrolled Pokémon; Appeal points determine the winner.'
  } else return fail('battle-contest.end-source-mismatch', 'Battle end execution accepts only round-boundary or encounter-ended facts.')
  if (endingRound < 1 || endingRound > Number(before.battle.roundBudget)) return fail('battle-contest.end-condition-not-met', 'Battle ending round is outside the immutable round budget.')
  const next = structuredClone(before) as Record<string, any>
  next.round = endingRound
  finalizeContestPerformancePlacements({ before, next, operationId: parsedDelivery.operationId, now: input.now, random: input.random, scorePolicy: 'appeal-points', historyType, historyDetail })
  const receipt = parseBattleContestHandoffReceipt({
    handoffId: parsedDelivery.fact.handoffId,
    handoffSha256: parsedDelivery.handoffSha256,
    sourceResultId: parsedDelivery.fact.sourceResultId,
    operationId: parsedDelivery.operationId,
    contestRevisionBefore: before.revision,
    contestRevisionAfter: before.revision + 1,
    encounterRevision: parsedDelivery.readSet.encounterRevision,
    outcome: 'contest-ended',
    appealId: null,
    appliedAt: input.now,
  })
  next.battleHandoffReceipts.push(receipt)
  next.revision = before.revision + 1
  next.updatedAt = input.now
  const document = parseContestDocument(next)
  const winner = document.contestants.find(row => row.finalPlacement === 1) ?? fail('battle-contest.end-source-mismatch', 'Battle finalization produced no winner.')
  return Object.freeze({ document, receipt, condition, winnerContestantId: winner.contestantId, exactRetry: false })
}
