import { battleContestVariant, contestCatalog } from '#shared/contests/catalog'
import {
  appendContestHistory,
  contestPerformerIsPokemon,
  parseContestDocument,
  type BattleContestRecallExceptionIdV1,
  type BattleContestVoltageLifecycleLedgerEntryV1,
  type BattleContestVoltageLifecycleRuleV1,
  type BattleContestVoltageTransitionV1,
  type ContestDocumentV1,
  type ContestPokemonPerformerSnapshotV1,
  type ContestantStateV1,
} from '#shared/contests/document'
import {
  decideBattleContestHandoffDelivery,
  parseBattleContestHandoffDelivery,
  parseBattleContestHandoffReceipt,
  type BattleContestHandoffDeliveryV1,
  type BattleContestHandoffReceiptV1,
} from '#shared/contests/battleBlend'

export type BattleContestVoltageLifecycleErrorCode =
  | 'battle-contest.lifecycle-stage-mismatch'
  | 'battle-contest.lifecycle-source-mismatch'
  | 'battle-contest.lifecycle-pokemon-mismatch'
  | 'battle-contest.lifecycle-active-opponent-ambiguous'
  | 'battle-contest.lifecycle-retry-conflict'

export class BattleContestVoltageLifecycleError extends Error {
  constructor(readonly code: BattleContestVoltageLifecycleErrorCode, message: string) {
    super(message)
    this.name = 'BattleContestVoltageLifecycleError'
  }
}

const fail = (code: BattleContestVoltageLifecycleErrorCode, message: string): never => {
  throw new BattleContestVoltageLifecycleError(code, message)
}
const mutable = (value: ContestDocumentV1): Record<string, any> => structuredClone(value) as Record<string, any>
const cap = (value: number): number => Math.max(
  contestCatalog.performance.voltage.minimum,
  Math.min(contestCatalog.performance.voltage.maximum, value),
)

interface EnrolledPokemon {
  readonly contestant: ContestantStateV1
  readonly performer: ContestPokemonPerformerSnapshotV1
}

const enrolledPokemonBySlug = (
  document: ContestDocumentV1,
  sheetSlug: string | null,
  label: string,
): EnrolledPokemon => {
  if (sheetSlug === null) return fail('battle-contest.lifecycle-pokemon-mismatch', `${label} has no server-derived Pokémon sheet authority.`)
  const matches = document.contestants.flatMap(contestant => contestant.performers.flatMap(performer => (
    contestPerformerIsPokemon(performer) && performer.pokemonSheetSlug === sheetSlug
      ? [{ contestant, performer }]
      : []
  )))
  if (matches.length !== 1) return fail('battle-contest.lifecycle-pokemon-mismatch', `${label} is not exactly one Pokémon in the immutable Battle enrollment.`)
  return matches[0]!
}

const transitionFor = (
  member: EnrolledPokemon,
  ruleDelta: -2 | 0 | 2,
): BattleContestVoltageTransitionV1 => {
  const voltageBefore = member.contestant.performerVoltages[member.performer.performerId]
  if (typeof voltageBefore !== 'number' || !Number.isSafeInteger(voltageBefore)) return fail('battle-contest.lifecycle-pokemon-mismatch', 'Battle Pokémon has no exact Voltage ledger value.')
  return Object.freeze({
    contestantId: member.contestant.contestantId,
    performerId: member.performer.performerId,
    ruleDelta,
    voltageBefore,
    voltageAfter: cap(voltageBefore + ruleDelta),
  })
}

const recallException = (input: {
  readonly canonicalId: string | null
  readonly providerId: string | null
}): BattleContestRecallExceptionIdV1 | null => {
  if (input.canonicalId === 'Baton Pass' || input.canonicalId === 'U-Turn' || input.canonicalId === 'Volt Switch') return input.canonicalId
  if (input.providerId !== null && (battleContestVariant.voltagePolicy.jugglerRecallExceptionProviderIds as readonly string[]).includes(input.providerId)) return 'Juggler-equivalent-switch'
  return null
}

export interface ExecuteBattleContestVoltageLifecycleInputV1 {
  readonly document: ContestDocumentV1
  readonly delivery: BattleContestHandoffDeliveryV1
  /** Exact current or source-patch identities derived by the server coordinator. */
  readonly targetPokemonSheetSlug: string | null
  readonly sourcePokemonSheetSlug: string | null
  readonly recalledPokemonSheetSlug: string | null
  readonly sentOutPokemonSheetSlug: string | null
  readonly opposingActivePokemonSheetSlugs: readonly string[]
  readonly now: number
}

export interface ExecuteBattleContestVoltageLifecycleResultV1 {
  readonly document: ContestDocumentV1
  readonly receipt: BattleContestHandoffReceiptV1
  readonly lifecycle: BattleContestVoltageLifecycleLedgerEntryV1
  readonly exactRetry: boolean
}

/** Contest-owned KO/recall consequence application; no Encounter authority is written. */
export const executeBattleContestVoltageLifecycle = (
  input: ExecuteBattleContestVoltageLifecycleInputV1,
): ExecuteBattleContestVoltageLifecycleResultV1 => {
  const before = parseContestDocument(input.document)
  const delivery = parseBattleContestHandoffDelivery(input.delivery)
  if (before.variantId !== 'battle' || before.stage !== 'performance' || !before.battle?.encounter) {
    return fail('battle-contest.lifecycle-stage-mismatch', 'Battle Voltage lifecycle handoffs require one linked Battle Contest in Performance.')
  }
  if ((delivery.fact.kind !== 'knockout' && delivery.fact.kind !== 'switch')
    || delivery.fact.linkId !== before.battle.encounter.link.linkId) {
    return fail('battle-contest.lifecycle-source-mismatch', 'Delivery is not one KO or switch fact from this immutable Battle link.')
  }

  const decision = decideBattleContestHandoffDelivery(before.battleHandoffReceipts, delivery)
  if (decision.kind === 'exact-retry') {
    if (decision.receipt.outcome !== 'lifecycle-applied') return fail('battle-contest.lifecycle-retry-conflict', 'Battle handoff identity was already consumed by a different Contest outcome.')
    const lifecycle = before.battleVoltageLifecycleLedger.find(entry => entry.operationId === decision.receipt.operationId
      && entry.handoffId === decision.receipt.handoffId && entry.sourceResultId === decision.receipt.sourceResultId)
    if (!lifecycle) return fail('battle-contest.lifecycle-retry-conflict', 'Accepted lifecycle receipt has no matching immutable Voltage evidence.')
    return Object.freeze({ document: before, receipt: decision.receipt, lifecycle, exactRetry: true })
  }

  const round = delivery.fact.payload.round
  if (round === null) return fail('battle-contest.lifecycle-source-mismatch', 'Battle Voltage lifecycle fact has no Encounter-round authority.')
  let sourceKind: 'knockout' | 'switch'
  let rule: BattleContestVoltageLifecycleRuleV1
  let causalCanonicalId: string | null = null
  let causalProviderId: string | null = null
  let recallExceptionId: BattleContestRecallExceptionIdV1 | null = null
  let transitions: readonly BattleContestVoltageTransitionV1[]
  let headline: string
  let detail: string

  if (delivery.fact.kind === 'knockout') {
    sourceKind = 'knockout'
    const target = enrolledPokemonBySlug(before, input.targetPokemonSheetSlug, 'Knockout target')
    if (delivery.fact.payload.cause === 'attack') {
      const source = enrolledPokemonBySlug(before, input.sourcePokemonSheetSlug, 'Attack knockout source')
      if (source.contestant.contestantId === target.contestant.contestantId) return fail('battle-contest.lifecycle-pokemon-mismatch', 'Attack KO Voltage requires opposing immutable Battle teams.')
      rule = 'attack-knockout'
      causalCanonicalId = delivery.fact.payload.causalCanonicalId
      transitions = Object.freeze([transitionFor(source, battleContestVariant.voltagePolicy.attackKoDelta)])
      headline = `${source.performer.displayName} gained Voltage`
      detail = `${source.performer.displayName} gained +2 Voltage for knocking out an opposing Pokémon with ${causalCanonicalId}.`
    } else if (delivery.fact.payload.cause === 'damage-over-time') {
      if (input.opposingActivePokemonSheetSlugs.length !== 1 || new Set(input.opposingActivePokemonSheetSlugs).size !== 1) return fail('battle-contest.lifecycle-active-opponent-ambiguous', 'Damage-over-time KO Voltage requires exactly one current opposing active Pokémon from linked-map authority.')
      const recipient = enrolledPokemonBySlug(before, input.opposingActivePokemonSheetSlugs[0]!, 'Damage-over-time KO recipient')
      if (recipient.contestant.contestantId === target.contestant.contestantId) return fail('battle-contest.lifecycle-pokemon-mismatch', 'Damage-over-time KO Voltage must redirect to the opposing Trainer’s active Pokémon.')
      rule = 'damage-over-time-knockout'
      transitions = Object.freeze([transitionFor(recipient, battleContestVariant.voltagePolicy.attackKoDelta)])
      headline = `${recipient.performer.displayName} gained Voltage`
      detail = `${recipient.performer.displayName} gained +2 Voltage when an opposing Pokémon was knocked out by damage over time.`
    } else {
      rule = 'other-knockout'
      transitions = Object.freeze([])
      headline = 'Knockout recorded'
      detail = 'The non-attack knockout produced no Battle Contest Voltage change.'
    }
  } else {
    sourceKind = 'switch'
    const payload = delivery.fact.payload
    if (payload.switchKind === 'send-out' || payload.recalledPlacementId === null) return fail('battle-contest.lifecycle-source-mismatch', 'A send-out without a recall has no P11-072 Voltage consequence.')
    const recalled = enrolledPokemonBySlug(before, input.recalledPokemonSheetSlug, 'Recalled Pokémon')
    if (payload.switchKind === 'switch') {
      const sentOut = enrolledPokemonBySlug(before, input.sentOutPokemonSheetSlug, 'Sent-out Pokémon')
      if (sentOut.contestant.contestantId !== recalled.contestant.contestantId || sentOut.performer.performerId === recalled.performer.performerId) return fail('battle-contest.lifecycle-pokemon-mismatch', 'Switch handoff must replace the recalled Pokémon with a distinct teammate.')
    } else if (input.sentOutPokemonSheetSlug !== null) return fail('battle-contest.lifecycle-pokemon-mismatch', 'Recall-only authority cannot claim a sent-out Pokémon.')
    causalCanonicalId = payload.causalCanonicalId
    causalProviderId = payload.causalProviderId
    recallExceptionId = recallException({ canonicalId: causalCanonicalId, providerId: causalProviderId })
    rule = recallExceptionId === null ? 'recall' : 'recall-exception'
    transitions = Object.freeze([transitionFor(recalled, recallExceptionId === null ? battleContestVariant.voltagePolicy.recallDelta : 0)])
    headline = recallExceptionId === null ? `${recalled.performer.displayName} lost Voltage` : `${recalled.performer.displayName} preserved Voltage`
    detail = recallExceptionId === null
      ? `${recalled.performer.displayName} lost 2 Voltage when recalled.`
      : `${recalled.performer.displayName} retained Voltage through the ${recallExceptionId} recall exception.`
  }

  const next = mutable(before)
  for (const transition of transitions) {
    const contestant = next.contestants.find((candidate: any) => candidate.contestantId === transition.contestantId)
      ?? fail('battle-contest.lifecycle-pokemon-mismatch', 'Voltage recipient left the immutable Battle enrollment.')
    contestant.performerVoltages[transition.performerId] = transition.voltageAfter
  }
  const lifecycleId = `battle-voltage-lifecycle:v1:${delivery.fact.handoffId.slice('battle-contest-handoff:v1:'.length)}`
  const lifecycle: BattleContestVoltageLifecycleLedgerEntryV1 = Object.freeze({
    lifecycleId,
    operationId: delivery.operationId,
    handoffId: delivery.fact.handoffId,
    sourceResultId: delivery.fact.sourceResultId,
    sourceKind,
    rule,
    encounterRound: round,
    causalCanonicalId,
    causalProviderId,
    recallExceptionId,
    transitions,
    acceptedAt: input.now,
  })
  const receipt = parseBattleContestHandoffReceipt({
    handoffId: delivery.fact.handoffId,
    handoffSha256: delivery.handoffSha256,
    sourceResultId: delivery.fact.sourceResultId,
    operationId: delivery.operationId,
    contestRevisionBefore: before.revision,
    contestRevisionAfter: before.revision + 1,
    encounterRevision: delivery.readSet.encounterRevision,
    outcome: 'lifecycle-applied',
    appealId: null,
    appliedAt: input.now,
  })
  next.battleVoltageLifecycleLedger.push(lifecycle)
  next.battleHandoffReceipts.push(receipt)
  next.history = appendContestHistory({ ...before, history: next.history } as ContestDocumentV1, {
    type: 'battle-voltage-lifecycle-applied',
    visibility: 'public',
    contestantId: transitions[0]?.contestantId ?? null,
    headline,
    detail,
    operationId: delivery.operationId,
    createdAt: input.now,
  })
  next.revision = before.revision + 1
  next.updatedAt = input.now
  return Object.freeze({ document: parseContestDocument(next), receipt, lifecycle, exactRetry: false })
}
