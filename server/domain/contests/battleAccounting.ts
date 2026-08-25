import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { CONTEST_STAT_IDS } from '#shared/contests/ids'
import { parseBattleContestHandoffDelivery, type BattleContestHandoffDeliveryV1 } from '#shared/contests/battleBlend'
import { parseContestDocument, type ContestDocumentV1 } from '#shared/contests/document'
import { parseLivePlayResolvedMoveResult } from '#shared/livePlayMoveResolution'
import { parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { SqliteLivePlayOpRecord } from '../../storage/opRepository'
import { moveFrequencyTracksOnMap, normalizeMapMoveUsage, parseMoveFrequency } from '~/utils/moveUsage'

export type BattleContestAccountingErrorCode = 'battle-contest.accounting-divergence'
export class BattleContestAccountingError extends Error {
  constructor(readonly code: BattleContestAccountingErrorCode, message: string) {
    super(message)
    this.name = 'BattleContestAccountingError'
  }
}
const fail = (message: string): never => { throw new BattleContestAccountingError('battle-contest.accounting-divergence', message) }
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const digest = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value, {
  path: 'battleContestAccounting',
  limits: { maxDepth: 48, maxNodes: 100_000, maxArrayEntries: 10_000, maxObjectFields: 512, maxStringLength: 100_000 },
})).digest('hex')
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)

export interface BattleContestSingleSpendProofV1 {
  readonly schemaVersion: 1
  readonly proofSha256: string
  readonly handoffId: string
  readonly sourceResultId: string
  readonly encounterOperationId: string
  readonly contestOperationId: string
  readonly exactRetry: boolean
  readonly encounterFrequency: {
    readonly kind: ReturnType<typeof parseMoveFrequency>['kind']
    readonly previousUses: number
    readonly acceptedUses: number
    readonly spendDelta: 0 | 1
  }
  readonly encounterAction: {
    readonly actionType: string
    readonly previousSpent: number
    readonly acceptedSpent: number
    readonly spendDelta: 1
  }
  readonly encounterRandom: { readonly drawCount: number, readonly journalSha256: string }
  readonly contestRandom: { readonly drawCount: number, readonly journalSha256: string }
  readonly contestDiceSpent: number
  readonly acceptedAppeals: 0 | 1
}

/**
 * Reconcile the Encounter-owned frequency/action/random evidence with the
 * Contest-owned receipt, shared-dice spend, and random journal before the
 * Contest transaction is accepted. This function writes neither authority.
 */
export const assertBattleContestSingleSpendConvergence = (input: {
  readonly before: ContestDocumentV1
  readonly after: ContestDocumentV1
  readonly delivery: BattleContestHandoffDeliveryV1
  readonly sourceOperation: SqliteLivePlayOpRecord
}): BattleContestSingleSpendProofV1 => {
  const before = parseContestDocument(input.before)
  const after = parseContestDocument(input.after)
  const delivery = parseBattleContestHandoffDelivery(input.delivery)
  if (delivery.fact.kind !== 'accepted-move') return fail('Single-spend reconciliation requires one accepted-Move handoff.')
  const source = input.sourceOperation
  if (source.opId !== delivery.fact.payload.sourceOperationId || !source.result.ok) return fail('Encounter operation is not the exact accepted handoff source.')
  const patches = source.result.patches.filter(patch => patch.type === 'move.state')
  if (patches.length !== 1) return fail('Accepted Encounter operation must contain exactly one Move state patch.')
  const payload = record(patches[0]!.payload), changes = record(payload?.changes)
  const parsedMove = parseLivePlayResolvedMoveResult(payload?.move)
  if (!parsedMove.valid) return fail('Accepted Encounter Move journal is malformed.')
  const move = parsedMove.move, fact = delivery.fact.payload
  if (move.actorPlacementId !== fact.actorPlacementId || move.canonicalMoveName !== fact.canonicalMoveId) return fail('Encounter Move journal diverges from the accepted handoff identity.')

  const frequency = parseMoveFrequency(move.frequency)
  const usageChange = record(changes?.moveUsage)
  const previousUsage = normalizeMapMoveUsage(usageChange?.previous)
  const acceptedUsage = normalizeMapMoveUsage(usageChange?.current)
  const previousEntry = previousUsage?.byPlacementId[fact.actorPlacementId]?.[move.moveKey]
  const acceptedEntry = acceptedUsage?.byPlacementId[fact.actorPlacementId]?.[move.moveKey]
  const previousUses = previousEntry?.uses ?? 0
  const acceptedUses = acceptedEntry?.uses ?? previousUses
  const tracked = moveFrequencyTracksOnMap(frequency)
  const frequencyDelta = acceptedUses - previousUses
  if (tracked) {
    if (!usageChange || acceptedEntry?.frequency !== frequency.kind || frequencyDelta !== 1) return fail('Encounter Move frequency must spend exactly once in the accepted patch.')
  } else if (frequencyDelta !== 0) return fail('Untracked Encounter Move frequency recorded an unexpected spend.')
  if (frequency.kind === 'daily') {
    const sheetRefs = Array.isArray(payload?.sheets) ? payload.sheets.map(record).filter((row): row is Record<string, unknown> => row !== null) : []
    const dailyWrites = sheetRefs.filter(row => row.kind === 'pokemon'
      && Array.isArray(row.placementIds) && row.placementIds.includes(fact.actorPlacementId)
      && Array.isArray(row.changedFields) && row.changedFields.includes('moveUsage'))
    if (dailyWrites.length !== 1) return fail('Daily Encounter Move frequency must bind exactly one authoritative Pokémon sheet spend.')
  }

  const encounterChange = record(changes?.encounterState)
  let previousEncounter, acceptedEncounter
  try {
    previousEncounter = parseEncounterState(encounterChange?.previous)
    acceptedEncounter = parseEncounterState(encounterChange?.current)
  } catch { return fail('Accepted Encounter action-resource transition is malformed.') }
  const previousSpent = previousEncounter.turnResources[fact.actorPlacementId]?.actions[fact.actionType].spent ?? 0
  const acceptedSpent = acceptedEncounter.turnResources[fact.actorPlacementId]?.actions[fact.actionType].spent ?? 0
  if (acceptedSpent - previousSpent !== 1) return fail('Encounter action resource must spend exactly once in the accepted patch.')

  const receipts = after.battleHandoffReceipts.filter(receipt => receipt.handoffId === delivery.fact.handoffId || receipt.sourceResultId === delivery.fact.sourceResultId)
  if (receipts.length !== 1) return fail('Contest must retain exactly one receipt for the accepted Encounter result.')
  const receipt = receipts[0]!
  if (receipt.handoffId !== delivery.fact.handoffId || receipt.sourceResultId !== delivery.fact.sourceResultId
    || receipt.handoffSha256 !== delivery.handoffSha256) return fail('Contest receipt diverges from Encounter handoff evidence.')
  const priorReceipt = before.battleHandoffReceipts.find(row => row.handoffId === receipt.handoffId || row.sourceResultId === receipt.sourceResultId)
  const exactRetry = priorReceipt !== undefined
  if (exactRetry) {
    if (!same(before, after) || !same(priorReceipt, receipt)) return fail('Exact handoff retry changed Contest authority.')
  } else if (after.revision !== before.revision + 1 || after.battleHandoffReceipts.length !== before.battleHandoffReceipts.length + 1) {
    return fail('First handoff acceptance must append exactly one Contest receipt and revision.')
  }

  const appeal = receipt.appealId === null ? null : after.appealLedger.find(row => row.appealId === receipt.appealId) ?? null
  if (fact.sourceActionKind === 'pokemon-move') {
    if (receipt.outcome !== 'scored-appeal' || !appeal || appeal.operationId !== receipt.operationId) return fail('Pokémon Move handoff must produce exactly one operation-bound Appeal.')
  } else if (receipt.outcome !== 'canonical-exclusion' || appeal !== null) return fail('Canonical exclusion must produce no Appeal or Contest roll.')
  if (!exactRetry && after.appealLedger.length !== before.appealLedger.length + (appeal ? 1 : 0)) return fail('Contest Appeal count diverges from the accepted handoff outcome.')

  const contestJournals = appeal ? appeal.journalIds.map(journalId => after.diceJournal.find(row => row.journalId === journalId) ?? fail('Appeal references missing Contest random evidence.')) : []
  if (contestJournals.some(row => row.operationId !== receipt.operationId && row.purpose === 'appeal')) return fail('Contest random journal diverges from the accepting operation.')
  if (!exactRetry && after.diceJournal.length !== before.diceJournal.length + contestJournals.length) return fail('Contest random journal appended more or fewer entries than the accepted Appeal.')
  const spent = appeal ? CONTEST_STAT_IDS.reduce((sum, statId) => sum + appeal.spentDice[statId], 0) : 0
  const teamSpends = after.contestants.flatMap(row => row.battleTeamDiceSpendJournal).filter(row => row.operationId === receipt.operationId)
  if (spent === 0 ? teamSpends.length !== 0 : teamSpends.length !== 1 || CONTEST_STAT_IDS.some(statId => teamSpends[0]!.spentDice[statId] !== appeal!.spentDice[statId])) return fail('Trainer-team Contest Dice spend does not match the accepted Appeal exactly once.')
  const priorTeamSpendCount = before.contestants.flatMap(row => row.battleTeamDiceSpendJournal).filter(row => row.operationId === receipt.operationId).length
  if (!exactRetry && teamSpends.length - priorTeamSpendCount !== (spent > 0 ? 1 : 0)) return fail('Trainer-team Contest Dice were spent more or fewer than once.')

  const encounterDrawCount = move.rollLedger.reduce((sum, row) => sum + row.naturalResults.length, 0)
  const contestDrawCount = contestJournals.reduce((sum, row) => sum + row.results.length, 0)
  const material = {
    handoffId: receipt.handoffId,
    sourceResultId: receipt.sourceResultId,
    encounterOperationId: source.opId,
    contestOperationId: receipt.operationId,
    frequency: { kind: frequency.kind, previousUses, acceptedUses, spendDelta: frequencyDelta },
    action: { actionType: fact.actionType, previousSpent, acceptedSpent, spendDelta: acceptedSpent - previousSpent },
    encounterRandom: move.rollLedger,
    contestRandom: contestJournals,
    contestDiceSpent: spent,
    acceptedAppealId: appeal?.appealId ?? null,
  }
  return Object.freeze({
    schemaVersion: 1,
    proofSha256: digest(material),
    handoffId: receipt.handoffId,
    sourceResultId: receipt.sourceResultId,
    encounterOperationId: source.opId,
    contestOperationId: receipt.operationId,
    exactRetry,
    encounterFrequency: Object.freeze({ kind: frequency.kind, previousUses, acceptedUses, spendDelta: (tracked ? 1 : 0) as 0 | 1 }),
    encounterAction: Object.freeze({ actionType: fact.actionType, previousSpent, acceptedSpent, spendDelta: 1 as const }),
    encounterRandom: Object.freeze({ drawCount: encounterDrawCount, journalSha256: digest(move.rollLedger) }),
    contestRandom: Object.freeze({ drawCount: contestDrawCount, journalSha256: digest(contestJournals) }),
    contestDiceSpent: spent,
    acceptedAppeals: (appeal ? 1 : 0) as 0 | 1,
  })
}
