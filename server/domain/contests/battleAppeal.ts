import { battleContestVariant, contestCatalog, contestEffectById } from '#shared/contests/catalog'
import { rollContestDice, type ContestRandomSource } from '#shared/contests/dice'
import {
  appendContestHistory,
  contestPerformerIsPokemon,
  parseContestDocument,
  spendBattleContestTeamDice,
  type ContestAppealContributorV1,
  type ContestAppealLedgerEntryV1,
  type ContestDocumentV1,
} from '#shared/contests/document'
import { assembleContestAppeal } from '#shared/contests/appealAssembly'
import { CONTEST_STAT_IDS, emptyContestStatRecord, isContestEffectId, isContestStatId, type ContestStatId } from '#shared/contests/ids'
import {
  decideBattleContestHandoffDelivery,
  parseBattleContestHandoffDelivery,
  parseBattleContestHandoffReceipt,
  type BattleContestHandoffDeliveryV1,
  type BattleContestHandoffReceiptV1,
} from '#shared/contests/battleBlend'
import {
  cappedContestVoltage,
  resolveContestEffectConsequences,
  scoreContestAppealResults,
  terminalContestEffectVoltage,
} from '#shared/contests/effectResolution'

export type BattleContestAppealErrorCode =
  | 'battle-contest.appeal-stage-mismatch'
  | 'battle-contest.appeal-source-mismatch'
  | 'battle-contest.appeal-actor-mismatch'
  | 'battle-contest.appeal-move-unavailable'
  | 'battle-contest.appeal-effect-unsupported'
  | 'battle-contest.appeal-adjacency-mismatch'
  | 'battle-contest.appeal-spend-invalid'
  | 'battle-contest.appeal-retry-conflict'

export class BattleContestAppealError extends Error {
  constructor(readonly code: BattleContestAppealErrorCode, message: string) {
    super(message)
    this.name = 'BattleContestAppealError'
  }
}
const fail = (code: BattleContestAppealErrorCode, message: string): never => { throw new BattleContestAppealError(code, message) }
const mutable = (value: ContestDocumentV1): Record<string, any> => structuredClone(value) as Record<string, any>
const totalSpent = (spent: Readonly<Record<ContestStatId, number>>): number => CONTEST_STAT_IDS.reduce((sum, statId) => sum + spent[statId], 0)
const normalizedSpend = (value: Readonly<Record<ContestStatId, number>>): Readonly<Record<ContestStatId, number>> => Object.freeze(emptyContestStatRecord(statId => {
  const amount = Number(value[statId] ?? 0)
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > contestCatalog.performance.contestDiceSpendMaximumPerAppeal) return fail('battle-contest.appeal-spend-invalid', `Battle Appeal ${statId} spend must be a bounded whole number.`)
  return amount
}))
const sameSpend = (left: Readonly<Record<ContestStatId, number>>, right: Readonly<Record<ContestStatId, number>>): boolean => CONTEST_STAT_IDS.every(statId => left[statId] === right[statId])

export interface ExecuteBattleContestAcceptedMoveAppealInputV1 {
  readonly document: ContestDocumentV1
  readonly delivery: BattleContestHandoffDeliveryV1
  /** Null is permitted only for canonical exclusions, which never score or spend. */
  readonly actorPokemonSheetSlug: string | null
  /** Current opposing on-field Pokémon, derived only by the server coordinator. */
  readonly adjacentPokemonSheetSlugs: readonly string[]
  readonly spentDice: Readonly<Record<ContestStatId, number>>
  readonly now: number
  readonly random: ContestRandomSource
}
export interface ExecuteBattleContestAcceptedMoveAppealResultV1 {
  readonly document: ContestDocumentV1
  readonly receipt: BattleContestHandoffReceiptV1
  readonly appeal: ContestAppealLedgerEntryV1 | null
  readonly exactRetry: boolean
}

/**
 * Contest-owned half of the accepted-Move handoff. It writes no Encounter,
 * map, live-play operation, Scene, initiative, Move resource, or sheet state.
 */
export const executeBattleContestAcceptedMoveAppeal = (
  input: ExecuteBattleContestAcceptedMoveAppealInputV1,
): ExecuteBattleContestAcceptedMoveAppealResultV1 => {
  const before = parseContestDocument(input.document)
  const delivery = parseBattleContestHandoffDelivery(input.delivery)
  const spent = normalizedSpend(input.spentDice)
  const spentTotal = totalSpent(spent)
  if (spentTotal > contestCatalog.performance.contestDiceSpendMaximumPerAppeal) return fail('battle-contest.appeal-spend-invalid', `At most ${contestCatalog.performance.contestDiceSpendMaximumPerAppeal} team dice may be spent on one accepted Move.`)
  if (before.variantId !== 'battle' || before.stage !== 'performance' || !before.battle?.encounter) return fail('battle-contest.appeal-stage-mismatch', 'Accepted Move Appeals require one linked Battle Contest in Performance.')
  if (delivery.fact.kind !== 'accepted-move' || delivery.fact.linkId !== before.battle.encounter.link.linkId) return fail('battle-contest.appeal-source-mismatch', 'Delivery is not one accepted Move from this immutable Battle link.')

  const decision = decideBattleContestHandoffDelivery(before.battleHandoffReceipts, delivery)
  if (decision.kind === 'exact-retry') {
    const appeal = decision.receipt.appealId === null ? null : before.appealLedger.find(row => row.appealId === decision.receipt.appealId) ?? null
    if (appeal ? !sameSpend(appeal.spentDice, spent) : spentTotal !== 0) return fail('battle-contest.appeal-retry-conflict', 'Accepted Move handoff was retried with changed Contest Dice material.')
    return Object.freeze({ document: before, receipt: decision.receipt, appeal, exactRetry: true })
  }

  const payload = delivery.fact.payload
  const next = mutable(before)
  const receipt = (outcome: BattleContestHandoffReceiptV1['outcome'], appealId: string | null): BattleContestHandoffReceiptV1 => parseBattleContestHandoffReceipt({
    handoffId: delivery.fact.handoffId,
    handoffSha256: delivery.handoffSha256,
    sourceResultId: delivery.fact.sourceResultId,
    operationId: delivery.operationId,
    contestRevisionBefore: before.revision,
    contestRevisionAfter: before.revision + 1,
    encounterRevision: delivery.readSet.encounterRevision,
    outcome,
    appealId,
    appliedAt: input.now,
  })
  const appendHistory = (entry: Parameters<typeof appendContestHistory>[1]): void => { next.history = appendContestHistory({ ...before, history: next.history } as ContestDocumentV1, entry) }
  const finish = (acceptedReceipt: BattleContestHandoffReceiptV1): ContestDocumentV1 => {
    next.battleHandoffReceipts.push(acceptedReceipt)
    next.revision = before.revision + 1
    next.updatedAt = input.now
    return parseContestDocument(next)
  }

  if (payload.sourceActionKind === 'struggle-attack' || payload.sourceActionKind === 'combat-maneuver') {
    if (spentTotal !== 0) return fail('battle-contest.appeal-spend-invalid', 'Struggle Attacks and combat maneuvers cannot spend Contest Dice because they produce no Appeal Roll.')
    const acceptedReceipt = receipt('canonical-exclusion', null)
    appendHistory({
      type: 'battle-appeal-excluded', visibility: 'public', contestantId: null,
      headline: 'No Battle Appeal Roll', detail: payload.sourceActionKind === 'struggle-attack' ? 'A performed Struggle Attack is not a Contest Move.' : 'A combat maneuver is not a Contest Move.',
      operationId: delivery.operationId, createdAt: input.now,
    })
    return Object.freeze({ document: finish(acceptedReceipt), receipt: acceptedReceipt, appeal: null, exactRetry: false })
  }

  const encounterRound = payload.round
  if (encounterRound === null) return fail('battle-contest.appeal-source-mismatch', 'Accepted Pokémon Move has no Encounter round authority.')
  if (input.actorPokemonSheetSlug === null) return fail('battle-contest.appeal-actor-mismatch', 'Accepted Pokémon Move actor has no current linked-map Pokémon sheet authority.')
  const contestant = before.contestants.find(row => row.performers.some(performer => contestPerformerIsPokemon(performer) && performer.pokemonSheetSlug === input.actorPokemonSheetSlug))
  const performer = contestant?.performers.find(candidate => contestPerformerIsPokemon(candidate) && candidate.pokemonSheetSlug === input.actorPokemonSheetSlug)
  if (!contestant || !performer || !contestPerformerIsPokemon(performer)) return fail('battle-contest.appeal-actor-mismatch', 'Accepted Move actor is not one enrolled Pokémon on either linked Battle team.')
  const options = performer.moves.filter(row => row.canonicalMoveId === payload.canonicalMoveId && row.available)
  const option = options.length === 1 ? options[0]! : null
  if (!option || !isContestStatId(option.typeId) || !isContestEffectId(option.effectId)) return fail('battle-contest.appeal-move-unavailable', 'Accepted Move must have exactly one available app-owned canonical Contest identity in the enrolled snapshot.')
  if (!battleContestVariant.contestEffectPolicy.supportedEffectIds.includes(option.effectId)) return fail('battle-contest.appeal-effect-unsupported', 'Accepted Move has no reviewed Battle Contest Effect handler.')
  const adjacentSlugs = [...input.adjacentPokemonSheetSlugs]
  if (adjacentSlugs.length < battleContestVariant.contestEffectPolicy.onFieldPokemonMinimumPerTrainer
    || adjacentSlugs.length > battleContestVariant.contestEffectPolicy.onFieldPokemonMaximumPerTrainer
    || new Set(adjacentSlugs).size !== adjacentSlugs.length) return fail('battle-contest.appeal-adjacency-mismatch', 'Battle Contest Effects require exactly every opposing on-field Pokémon from linked-map placement authority.')
  const adjacentPerformers = adjacentSlugs.map((sheetSlug) => {
    const matches = before.contestants.flatMap(row => row.contestantId === contestant.contestantId
      ? []
      : row.performers.filter(candidate => contestPerformerIsPokemon(candidate) && candidate.pokemonSheetSlug === sheetSlug).map(candidate => ({ contestant: row, performer: candidate })))
    if (matches.length !== 1) return fail('battle-contest.appeal-adjacency-mismatch', 'Opposing field authority does not identify exactly one enrolled Pokémon on the other Battle team.')
    return matches[0]!
  })
  const adjacentContestantIds = [...new Set(adjacentPerformers.map(row => row.contestant.contestantId))]
  if (adjacentContestantIds.length !== 1) return fail('battle-contest.appeal-adjacency-mismatch', 'Battle Contest adjacency must resolve to the one opposing Trainer team.')

  const actor = next.contestants.find((row: any) => row.contestantId === contestant.contestantId)!
  const effectId = option.effectId
  const moveTypeId = option.typeId
  const contestTypeId = before.contestTypeId
  if (!isContestStatId(contestTypeId)) throw new Error('Linked Battle Contest has no fixed canonical Contest type.')
  const startingVoltage = contestant.performerVoltages[performer.performerId] ?? 0
  const priorPerformerAppeal = [...before.appealLedger].reverse().find(row => row.performerId === performer.performerId)
  const repeatedMove = priorPerformerAppeal?.moveOptionId === option.optionId
  const baseMoveDiceMultiplier = priorPerformerAppeal?.effectId === 'get-ready' && priorPerformerAppeal.round === encounterRound - 1 ? 2 : 1
  const adjacentVoltages = adjacentPerformers.map(row => row.contestant.performerVoltages[row.performer.performerId] ?? 0)
  const assembly = assembleContestAppeal({
    effectId, moveTypeId, contestTypeId, spentDice: spentTotal, startingVoltage, adjacentVoltages,
    repeatedMove, baseMoveDiceMultiplier, alignmentSteps: 0,
    sonic: option.tags.includes('sonic'), voiceLessonsActive: performer.providerIds.includes('feature:Voice Lessons'), acceptedInterventionBonusDice: 0,
  })
  const effect = contestEffectById.get(effectId)!
  const contributors: ContestAppealContributorV1[] = [
    { id: `effect:${effectId}`, label: effect.label, kind: 'base', dice: assembly.baseDice, explanation: `${effect.label} contributes ${assembly.baseDice} base dice${baseMoveDiceMultiplier > 1 ? ` after ×${baseMoveDiceMultiplier}` : ''}.` },
    { id: `type:${moveTypeId}:${contestTypeId}`, label: 'Contest alignment', kind: 'type', dice: assembly.relationship.dice, explanation: assembly.relationship.explanation },
    ...(spentTotal ? [{ id: 'contest-stat-spend', label: 'Contest stat dice', kind: 'contest-stat' as const, dice: spentTotal, explanation: `${spentTotal} Trainer-team Contest dice spent.` }] : []),
    ...(assembly.voltageDice ? [{ id: 'start-voltage', label: 'Voltage', kind: 'voltage' as const, dice: assembly.voltageDice, explanation: `${startingVoltage} active-Pokémon Voltage adds ${assembly.voltageDice}d6.` }] : []),
    ...(assembly.voiceDice ? [{ id: 'feature:Voice Lessons', label: 'Voice Lessons', kind: 'feature' as const, dice: 1, explanation: 'Sonic Move gains +1d6.' }] : []),
  ]
  const journal = rollContestDice({ contestId: before.contestId, diceJournal: next.diceJournal }, {
    operationId: delivery.operationId, purpose: 'appeal', contestantId: contestant.contestantId,
    round: encounterRound, count: assembly.assembledDice, dieSides: 6, createdAt: input.now,
  }, input.random)
  next.diceJournal.push(journal)
  const centerOfAttention = payload.replacementAttention !== null
  let scored = scoreContestAppealResults(journal.results, effectId, centerOfAttention)
  if (assembly.assembledRaw <= 0 && assembly.relationship.relationship === 'opposed') scored = { ...scored, fumble: scored.fumble + 1 }
  const fumbleBeforeAppeal = actor.fumble
  actor.appeal += scored.appeal
  actor.fumble += scored.fumble
  const savingGraceRemoved = effectId === 'saving-grace' ? Math.min(startingVoltage, fumbleBeforeAppeal) : 0
  if (savingGraceRemoved) actor.fumble -= savingGraceRemoved
  const effectStartingVoltage = effectId === 'saving-grace'
    ? cappedContestVoltage(startingVoltage + (savingGraceRemoved <= 2 ? 1 : 0))
    : startingVoltage
  const effectResult = resolveContestEffectConsequences({
    effectId,
    results: journal.results,
    actor: { contestantId: contestant.contestantId, performerId: performer.performerId, voltage: effectStartingVoltage },
    attentionRecipient: null,
    adjacentVoltageTargets: adjacentPerformers.map(row => ({
      contestantId: row.contestant.contestantId,
      performerId: row.performer.performerId,
      voltage: row.contestant.performerVoltages[row.performer.performerId] ?? 0,
    })),
    adjacentFumbleTargets: adjacentContestantIds.map(contestantId => ({
      contestantId,
      protected: adjacentPerformers
        .filter(row => row.contestant.contestantId === contestantId)
        .every(row => before.appealLedger.some(appeal => appeal.round === encounterRound && appeal.performerId === row.performer.performerId && appeal.effectId === 'saving-grace')),
    })),
    repeatedMove,
    matchingType: assembly.relationship.relationship === 'matching',
  })
  const consequences: Array<{ contestantId: string, performerId: string | null, appealDelta: number, fumbleDelta: number, voltageDelta: number, reason: string }> = effectResult.consequences.map(row => ({ ...row }))
  if (savingGraceRemoved) consequences.push({ contestantId: contestant.contestantId, performerId: null, appealDelta: 0, fumbleDelta: -savingGraceRemoved, voltageDelta: 0, reason: 'Saving Grace' })
  actor.performerVoltages[performer.performerId] = terminalContestEffectVoltage(effectId, effectResult.actorVoltage)
  for (const consequence of effectResult.consequences) {
    if (consequence.contestantId === contestant.contestantId && consequence.performerId === performer.performerId) continue
    const target = next.contestants.find((row: any) => row.contestantId === consequence.contestantId)
    if (!target) return fail('battle-contest.appeal-adjacency-mismatch', 'Contest Effect target left the immutable Battle enrollment.')
    target.appeal += consequence.appealDelta
    target.fumble = Math.max(0, target.fumble + consequence.fumbleDelta)
    if (consequence.performerId !== null) target.performerVoltages[consequence.performerId] = cappedContestVoltage((target.performerVoltages[consequence.performerId] ?? 0) + consequence.voltageDelta)
  }
  if (spentTotal > 0) {
    const transition = spendBattleContestTeamDice({
      teamPools: actor.teamDicePools, journal: actor.battleTeamDiceSpendJournal,
      enrolledPokemonPerformerIds: actor.performers.filter((candidate: any) => candidate.performerKind === 'pokemon').map((candidate: any) => candidate.performerId),
      performerId: performer.performerId, operationId: delivery.operationId, spentDice: spent, createdAt: input.now,
    })
    actor.teamDicePools = transition.teamPools
    actor.battleTeamDiceSpendJournal = transition.journal
    actor.teamContestDiceSpent += spentTotal
  }
  actor.lastMoveOptionId = option.optionId
  const contestSlug = before.contestId.split(':').at(-1)!.replace(/[^a-z0-9-]/gu, '-').slice(0, 60)
  const appealId = `appeal:${contestSlug}-battle-${before.appealLedger.length + 1}`
  const appeal: ContestAppealLedgerEntryV1 = Object.freeze({
    appealId, operationId: delivery.operationId, round: encounterRound, turn: payload.completionOrder,
    contestantId: contestant.contestantId, performerId: performer.performerId,
    moveOptionId: option.optionId, moveLabel: option.label, moveTypeId, contestTypeId, effectId,
    partnerEffectTargetPerformerId: null, centerOfAttention, adjacentContestantIds: Object.freeze(adjacentContestantIds),
    adjacentPerformerIds: Object.freeze(adjacentPerformers.map(row => row.performer.performerId)),
    spentDice: spent, contributors: Object.freeze(contributors), baseMoveDiceMultiplier,
    assembledDice: assembly.assembledDice, journalIds: Object.freeze([journal.journalId]), acceptedResults: journal.results,
    appealDelta: scored.appeal, fumbleDelta: scored.fumble, voltageBefore: startingVoltage, voltageAfter: actor.performerVoltages[performer.performerId],
    consequences: Object.freeze(consequences.map(row => Object.freeze(row))), acceptedAt: input.now, correctionIds: Object.freeze([]),
  })
  next.appealLedger.push(appeal)
  appendHistory({
    type: 'battle-appeal-accepted', visibility: 'public', contestantId: contestant.contestantId,
    headline: `${performer.displayName} performed ${option.label}`,
    detail: `${assembly.assembledDice}d6 resolved for +${scored.appeal} Appeal and +${scored.fumble} Fumble from an accepted Encounter Move${centerOfAttention ? ' on the post-KO replacement’s first acting turn' : ''}.`,
    operationId: delivery.operationId, createdAt: input.now,
  })
  const acceptedReceipt = receipt('scored-appeal', appealId)
  return Object.freeze({ document: finish(acceptedReceipt), receipt: acceptedReceipt, appeal, exactRetry: false })
}
