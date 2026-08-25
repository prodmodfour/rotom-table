import { battleContestVariant, contestCatalog, contestChart, contestEffectById } from '#shared/contests/catalog'
import { rollContestDice, rollContestTypeDie, type ContestRandomSource } from '#shared/contests/dice'
import {
  appendContestHistory,
  assertContestStageTransition,
  contestActiveContestants,
  contestCurrentContestant,
  contestCurrentPerformer,
  contestPerformerIsPokemon,
  contestPerformerIsTrainer,
  normalizeContestPrize,
  parseContestDocument,
  spendTrainerParticipantSharedDice,
  type ContestAppealContributorV1,
  type ContestAppealLedgerEntryV1,
  type ContestDocumentV1,
  type ContestantStateV1,
} from '#shared/contests/document'
import { CONTEST_LETTERS, CONTEST_STAT_IDS, emptyContestStatRecord, isContestEffectId, isContestStatId, type ContestEffectId, type ContestStatId } from '#shared/contests/ids'
import type { ContestCommandV1 } from '#shared/contests/operations'
import { explainContestTypeRelationship } from '#shared/contests/typeRelationship'
import { rejectContest } from '#shared/contests/validation'
import { assembleContestAppeal } from '#shared/contests/appealAssembly'
import { resolveTrainerParticipantMethodTurn, type ContestParticipantPerformerKind } from '#shared/contests/participantMethods'
import type { BattleContestEncounterBindingV1 } from '#shared/contests/battleEncounter'
import type { BattleContestRecoveryReceiptV1 } from '#shared/contests/battleRecovery'
import { parseBattleContestSettlementCoordination, type BattleContestSettlementCoordinationV1 } from '#shared/contests/battleSettlement'
import {
  resolveContestEffectConsequences,
  scoreContestAppealResults,
  terminalContestEffectVoltage,
} from '#shared/contests/effectResolution'

export interface ContestIntroductionBonusRollV1 {
  readonly sourceId: string
  readonly label: string
  readonly dice: number
  readonly statId: ContestStatId
}
export interface ContestIntroductionExecutionContextV1 {
  readonly skillDice: number
  readonly bonusRolls: readonly ContestIntroductionBonusRollV1[]
  readonly uglySixesCountAsOnes: boolean
  readonly graceFlexible: boolean
}
export interface ContestEngineContextV1 {
  readonly now: number
  readonly random: ContestRandomSource
  readonly enrollment?: ContestantStateV1
  readonly introduction?: ContestIntroductionExecutionContextV1
  /** Existing Encounter engine output accepted by the blend coordinator. */
  readonly battleEncounter?: BattleContestEncounterBindingV1
  /** Shared coordinator receipt for a linked Battle pause, resume, correction, or cancellation. */
  readonly battleRecovery?: BattleContestRecoveryReceiptV1
  /** Accepted combined Encounter/Contest settlement receipt. Required for a linked Battle commit. */
  readonly battleSettlementCoordination?: BattleContestSettlementCoordinationV1
}

type Mutable = Record<string, any>
const mutable = (document: ContestDocumentV1): Mutable => structuredClone(document) as Mutable
const cappedVoltage = (value: number): number => Math.max(contestCatalog.performance.voltage.minimum, Math.min(contestCatalog.performance.voltage.maximum, Math.floor(value)))
const requireStage = (document: ContestDocumentV1, ...stages: ContestDocumentV1['stage'][]): void => {
  if (!stages.includes(document.stage)) rejectContest('contest.stage-mismatch', `This action is not available during ${document.stage}.`, { legalAlternatives: stages.map(stage => `Wait for ${stage}.`), statusCode: 409 })
}
const requireRunning = (document: ContestDocumentV1): void => {
  if (document.paused) rejectContest('contest.paused', 'The GM paused this Contest.', { legalAlternatives: ['Wait for the GM to resume play.'], statusCode: 409 })
}
const contestantById = (document: ContestDocumentV1, contestantId: string): ContestantStateV1 => document.contestants.find(row => row.contestantId === contestantId)
  ?? rejectContest('contest.option-not-offered', 'That contestant is not enrolled.', { contestantId, legalAlternatives: document.contestants.map(row => row.contestantId) })
const history = (next: Mutable, source: ContestDocumentV1, input: { type: string, visibility?: 'public'|'owner'|'gm'|'diagnostic', contestantId?: string|null, headline: string, detail: string, operationId?: string|null, createdAt: number }): void => {
  next.history = appendContestHistory({ ...source, history: next.history } as ContestDocumentV1, { type: input.type, visibility: input.visibility ?? 'public', contestantId: input.contestantId ?? null, headline: input.headline, detail: input.detail, operationId: input.operationId ?? null, createdAt: input.createdAt })
}
const finish = (before: ContestDocumentV1, next: Mutable, now: number): ContestDocumentV1 => {
  next.revision = before.revision + 1
  next.updatedAt = now
  return parseContestDocument(next)
}
const pendingDefaults = (): ContestantStateV1['pendingEffects'] => Object.freeze({
  nextRoundBaseMoveDiceMultiplier: 1,
  fumbleProtectionRound: null,
  nextAppealAlignmentSteps: 0,
  nextAppealAlignmentTypeId: null,
  nextAppealBonusDice: 0,
  nextAppealTypeId: null,
  nextAppealEffectId: null,
  fixedAppealPerDie: false,
  targetPerformerId: null,
  blockedMoveOptionIds: Object.freeze([]),
  blockedMoveRound: null,
  blockedMovePerformerId: null,
})
const appendJournal = (next: Mutable, entry: unknown): void => { next.diceJournal.push(entry) }
const cleanupContestScope = (next: Mutable): void => {
  next.pendingInterventionAppealId = null
  for (const row of next.contestants as Mutable[]) {
    // Terminal documents retain accepted spend/usage evidence. Only unresolved
    // effects and temporary Ability dice expire at the Contest boundary.
    row.pendingEffects = pendingDefaults()
    for (const performer of row.performers) for (const statId of CONTEST_STAT_IDS) {
      const pool = performer.dicePools[statId]
      const spent = Math.max(0, Number(pool.total) - Number(pool.remaining))
      pool.contributors = pool.contributors.map((entry: Mutable) => entry.kind === 'ability' && entry.active
        ? { ...entry, active: false, explanation: `${entry.explanation} Contest-scoped contribution expired at the terminal boundary.` }
        : entry)
      pool.total = pool.contributors.reduce((sum: number, entry: Mutable) => sum + (entry.active ? Number(entry.dice) : 0), 0)
      pool.remaining = Math.max(0, pool.total - spent)
    }
  }
}

const typeForDie: Readonly<Record<number, ContestStatId>> = Object.freeze({ 1: 'cool', 2: 'tough', 3: 'beauty', 4: 'smart', 5: 'cute' })
const rollSupercontestType = (next: Mutable, source: ContestDocumentV1, operationId: string, round: number, now: number, random: ContestRandomSource): ContestStatId => {
  const result = rollContestTypeDie({ contestId: source.contestId, diceJournal: next.diceJournal }, { operationId, contestantId: null, round, createdAt: now }, random)
  appendJournal(next, result.journal)
  const statId = typeForDie[result.typeDie]!
  next.supercontestTypeByRound.push(statId)
  next.currentRoundContestTypeId = statId
  return statId
}

const assignLetters = (before: ContestDocumentV1, next: Mutable, operationId: string, now: number, random: ContestRandomSource): void => {
  const contestants = next.contestants as Mutable[]
  const groups = new Map<number, Mutable[]>()
  for (const row of contestants) {
    const score = Number(row.introduction.letterTotal)
    groups.set(score, [...(groups.get(score) ?? []), row])
  }
  const tieVectors = new Map<string, number[]>()
  for (const tied of groups.values()) {
    if (tied.length < 2) continue
    let unresolved = tied
    for (let attempt = 0; attempt < 24 && unresolved.length > 1; attempt += 1) {
      const journal = rollContestDice({ contestId: before.contestId, diceJournal: next.diceJournal }, { operationId, purpose: 'letter-tie', contestantId: null, round: null, count: unresolved.length, dieSides: 2, createdAt: now }, random)
      appendJournal(next, journal)
      unresolved.forEach((row, index) => tieVectors.set(row.contestantId, [...(tieVectors.get(row.contestantId) ?? []), journal.results[index]!]))
      const vectorKey = (row: Mutable): string => (tieVectors.get(row.contestantId) ?? []).join('')
      const duplicateKeys = new Set(unresolved.map(vectorKey).filter((key, index, all) => all.indexOf(key) !== index))
      unresolved = unresolved.filter(row => duplicateKeys.has(vectorKey(row)))
    }
  }
  contestants.sort((left, right) => Number(right.introduction.letterTotal) - Number(left.introduction.letterTotal)
    || (tieVectors.get(right.contestantId) ?? []).join('').localeCompare((tieVectors.get(left.contestantId) ?? []).join(''))
    || String(left.contestantId).localeCompare(String(right.contestantId)))
  contestants.forEach((row, index) => { row.letter = CONTEST_LETTERS[index] })
  // Enrollment order remains stable in storage; only the letter assignment is sorted.
  next.contestants = (before.contestants as readonly ContestantStateV1[]).map(original => contestants.find(row => row.contestantId === original.contestantId))
}

const journaledPlacementTieOrder = (before: ContestDocumentV1, next: Mutable, tied: Mutable[], operationId: string, round: number, now: number, random: ContestRandomSource): Mutable[] => {
  const vectors = new Map<string, number[]>()
  let unresolved = [...tied]
  for (let attempt = 0; attempt < 24 && unresolved.length > 1; attempt += 1) {
    const journal = rollContestDice({ contestId: before.contestId, diceJournal: next.diceJournal }, { operationId, purpose: 'placement-tie', contestantId: null, round, count: unresolved.length, dieSides: 2, createdAt: now }, random)
    appendJournal(next, journal)
    unresolved.forEach((row, position) => vectors.set(row.contestantId, [...(vectors.get(row.contestantId) ?? []), journal.results[position]!]))
    const keys = unresolved.map(row => (vectors.get(row.contestantId) ?? []).join(''))
    unresolved = unresolved.filter(row => keys.filter(key => key === (vectors.get(row.contestantId) ?? []).join('')).length > 1)
  }
  return [...tied].sort((left, right) => (vectors.get(right.contestantId) ?? []).join('').localeCompare((vectors.get(left.contestantId) ?? []).join('')) || String(left.contestantId).localeCompare(String(right.contestantId)))
}

const positionContext = (document: ContestDocumentV1, actor: ContestantStateV1): { center: boolean, adjacentIds: readonly string[] } => {
  const active = contestActiveContestants(document)
  const chart = contestChart(active.length)
  const round = chart.rounds[document.round - 1]!
  const actorPosition = round.lineup.indexOf(actor.letter!)
  const byLetter = new Map(active.map(row => [row.letter, row.contestantId]))
  return Object.freeze({
    center: actorPosition === chart.centerPosition,
    adjacentIds: Object.freeze(round.lineup.flatMap((letter, position) => Math.abs(position - actorPosition) === 1 ? [byLetter.get(letter as any)!] : [])),
  })
}
interface EffectConsequence { contestantId: string, performerId: string | null, appealDelta: number, fumbleDelta: number, voltageDelta: number, reason: string }
interface VoltageTarget { contestant: ContestantStateV1, performerId: string | null, voltage: number }
const simultaneousParticipant = (document: ContestDocumentV1): boolean => document.participantVariantId === 'trainer-participant' && document.participantMethodId === 'simultaneous'
const pairedPerformersAtRound = (document: ContestDocumentV1, contestant: ContestantStateV1, round = document.round): readonly ContestantStateV1['performers'][number][] => {
  const trainer = contestant.performers.find(contestPerformerIsTrainer)
  const pokemon = document.variantId === 'rotation' ? contestant.performers[contestant.rotationOrder[round - 1] ?? -1] : contestant.performers.find(contestPerformerIsPokemon)
  return trainer && pokemon && contestPerformerIsPokemon(pokemon) ? Object.freeze([trainer, pokemon]) : Object.freeze([])
}
const participantAppealProviderIds = (document: ContestDocumentV1, contestant: ContestantStateV1, performer: ContestantStateV1['performers'][number]): readonly string[] => {
  if (document.participantVariantId !== 'trainer-participant') return performer.providerIds
  const trainer = contestant.performers.find(contestPerformerIsTrainer)
  if (!trainer) throw new Error('Parsed Trainer Participant entry has no Trainer provider authority.')
  return Object.freeze([...new Set([...performer.providerIds, ...trainer.providerIds.filter(providerId => providerId.startsWith('feature:'))])])
}
const performerVoltage = (document: ContestDocumentV1, contestant: ContestantStateV1, performerId: string): number => simultaneousParticipant(document) ? contestant.performerVoltages[performerId] ?? 0 : contestant.voltage
const setPerformerVoltage = (document: ContestDocumentV1, contestant: Mutable, performerId: string, value: number): void => {
  if (simultaneousParticipant(document)) contestant.performerVoltages[performerId] = cappedVoltage(value)
  else contestant.voltage = cappedVoltage(value)
}
const voltageTargets = (document: ContestDocumentV1, contestant: ContestantStateV1): readonly VoltageTarget[] => simultaneousParticipant(document)
  ? pairedPerformersAtRound(document, contestant).map(performer => ({ contestant, performerId: performer.performerId, voltage: performerVoltage(document, contestant, performer.performerId) }))
  : Object.freeze([{ contestant, performerId: null, voltage: contestant.voltage }])
const scoreRoll = (results: readonly number[], effectId: ContestEffectId, center: boolean, fixedPerDie: boolean): { appeal: number, fumble: number } => scoreContestAppealResults(results, effectId, center, fixedPerDie)
const effectConsequences = (input: {
  document: ContestDocumentV1, actor: ContestantStateV1, actorPerformerId: string, actorVoltageRecipientPerformerId: string | null, effectId: ContestEffectId, results: readonly number[], adjacentIds: readonly string[], startingVoltage: number, appeal: number, fumble: number, repeatedMove: boolean, matchingType: boolean,
}): { appeal: number, fumble: number, actorVoltage: number, consequences: EffectConsequence[] } => {
  const adjacent = input.adjacentIds.map(id => contestantById(input.document, id))
  const actorPerformerScoped = simultaneousParticipant(input.document)
  const resolved = resolveContestEffectConsequences({
    effectId: input.effectId,
    results: input.results,
    actor: {
      contestantId: input.actor.contestantId,
      performerId: actorPerformerScoped ? input.actorPerformerId : null,
      voltage: input.startingVoltage,
    },
    attentionRecipient: input.actorVoltageRecipientPerformerId === null
      ? null
      : {
          contestantId: input.actor.contestantId,
          performerId: input.actorVoltageRecipientPerformerId,
          voltage: performerVoltage(input.document, input.actor, input.actorVoltageRecipientPerformerId),
        },
    adjacentVoltageTargets: adjacent.flatMap(entry => voltageTargets(input.document, entry).map(target => ({
      contestantId: entry.contestantId,
      performerId: target.performerId,
      voltage: target.voltage,
    }))),
    adjacentFumbleTargets: adjacent.map(entry => ({
      contestantId: entry.contestantId,
      protected: entry.pendingEffects.fumbleProtectionRound === input.document.round,
    })),
    repeatedMove: input.repeatedMove,
    matchingType: input.matchingType,
  })
  return {
    appeal: input.appeal,
    fumble: input.fumble,
    actorVoltage: resolved.actorVoltage,
    consequences: resolved.consequences.map(row => ({ ...row })),
  }
}

export const finalizeContestPerformancePlacements = (input: {
  readonly before: ContestDocumentV1
  readonly next: Mutable
  readonly operationId: string
  readonly now: number
  readonly random: ContestRandomSource
  readonly scorePolicy: 'appeal-minus-fumble' | 'appeal-points'
  readonly historyType?: string
  readonly historyDetail?: string
}): void => {
  const { before, next, operationId, now, random } = input
  assertContestStageTransition('performance', 'settling')
  next.stage = 'settling'; next.turnIndex = 0
  for (const row of next.contestants as Mutable[]) row.finalScore = input.scorePolicy === 'appeal-points' ? row.appeal : row.appeal - row.fumble
  const ordered = (next.contestants as Mutable[]).filter(row => !row.withdrawn).sort((left: Mutable, right: Mutable) => right.finalScore - left.finalScore || String(left.contestantId).localeCompare(String(right.contestantId)))
  let placement = 1
  for (let index = 0; index < ordered.length;) {
    const tied = ordered.filter((row: Mutable) => row.finalScore === ordered[index]!.finalScore && row.finalPlacement === null)
    const orderedTie = tied.length > 1 ? journaledPlacementTieOrder(before, next, tied, operationId, next.round, now, random) : tied
    for (const row of orderedTie) row.finalPlacement = placement++
    index += tied.length
  }
  history(next, before, {
    type: input.historyType ?? 'performance-completed',
    headline: 'Performance complete',
    detail: input.historyDetail ?? 'Final scores and placements are ready for settlement.',
    operationId,
    createdAt: now,
  })
}

const completePerformanceOrAdvance = (before: ContestDocumentV1, next: Mutable, operationId: string, now: number, random: ContestRandomSource): void => {
  const active = (next.contestants as Mutable[]).filter(row => !row.withdrawn)
  if (next.turnIndex + 1 < active.length) { next.turnIndex += 1; return }
  if (next.round < active.length) {
    next.round += 1; next.turnIndex = 0
    if (next.variantId === 'supercontest' || (next.variantId === 'festival' && next.policy.supercontestFestival)) rollSupercontestType(next, before, operationId, next.round, now, random)
    history(next, before, { type: 'round-advanced', headline: `Round ${next.round}`, detail: `Round ${next.round} begins.`, operationId, createdAt: now })
    return
  }
  if (next.variantId === 'festival' && active.length > 3) {
    const lowestScore = Math.min(...active.map(row => row.appeal - row.fumble))
    const lowestCandidates = active.filter(row => row.appeal - row.fumble === lowestScore)
    const lowest = lowestCandidates.length > 1 ? journaledPlacementTieOrder(before, next, lowestCandidates, operationId, next.round, now, random).at(-1)! : lowestCandidates[0]!
    lowest.withdrawn = true
    lowest.letter = null
    lowest.finalScore = lowest.appeal - lowest.fumble
    lowest.finalPlacement = active.length
    next.festivalHeat += 1; next.round = 1; next.turnIndex = 0
    const remaining = (next.contestants as Mutable[]).filter(row => !row.withdrawn).sort((left, right) => (right.appeal - right.fumble) - (left.appeal - left.fumble) || String(left.contestantId).localeCompare(String(right.contestantId)))
    remaining.forEach((row, index) => { row.letter = CONTEST_LETTERS[index]; row.fumble = 0; row.voltage = 0; for (const performerId of Object.keys(row.performerVoltages)) row.performerVoltages[performerId] = 0; row.lastMoveOptionId = null; row.pendingEffects = pendingDefaults() })
    if (next.policy.supercontestFestival) rollSupercontestType(next, before, operationId, 1, now, random)
    history(next, before, { type: 'festival-elimination', contestantId: lowest.contestantId, headline: `${lowest.displayName} leaves the Festival stage`, detail: `Festival heat ${next.festivalHeat} begins with appeal carried forward.`, operationId, createdAt: now })
    return
  }
  finalizeContestPerformancePlacements({
    before, next, operationId, now, random, scorePolicy: 'appeal-minus-fumble',
  })
}

const appealFestivalHeat = (appealId: string): number => Number(/-(\d+)-(\d+)-(\d+)-(\d+)$/u.exec(appealId)?.[1] ?? 1)
const trainerParticipantAppealAuthority = (document: ContestDocumentV1, contestant: ContestantStateV1): {
  readonly legalPerformers: readonly ContestantStateV1['performers'][number][]
  readonly pairedPokemon: ContestantStateV1['performers'][number]
  readonly legalPerformerIds: readonly string[]
  readonly acceptedAppealsThisTurn: number
  readonly roundComplete: boolean
} => {
  if (document.participantVariantId !== 'trainer-participant' || document.participantMethodId === null) throw new Error('Trainer Participant appeal authority requires one locked method.')
  const trainer = contestant.performers.find(contestPerformerIsTrainer)
  const pairedPokemon = document.variantId === 'rotation' ? contestCurrentPerformer(document, contestant) : contestant.performers.find(contestPerformerIsPokemon)
  if (!trainer || !pairedPokemon || !contestPerformerIsPokemon(pairedPokemon)) throw new Error('Parsed Trainer Participant entry has no exact Trainer/Pokémon appeal pair.')
  const currentTurn = document.turnIndex + 1
  const atCurrentCursor = (appeal: ContestAppealLedgerEntryV1): boolean => appeal.contestantId === contestant.contestantId && appeal.round === document.round && appeal.turn === currentTurn && (document.variantId !== 'festival' || appealFestivalHeat(appeal.appealId) === document.festivalHeat)
  const acceptedAppeals = document.appealLedger.filter(atCurrentCursor)
  const acceptedKinds = acceptedAppeals.map(appeal => {
    const acceptedPerformer = contestant.performers.find(candidate => candidate.performerId === appeal.performerId)
    if (!acceptedPerformer) throw new Error('Accepted participant appeal references a missing performer.')
    return (contestPerformerIsTrainer(acceptedPerformer) ? 'trainer' : 'pokemon') as ContestParticipantPerformerKind
  })
  const previousAppeal = [...document.appealLedger].reverse().find(appeal => appeal.contestantId === contestant.contestantId && !atCurrentCursor(appeal))
  const previousPerformer = previousAppeal ? contestant.performers.find(candidate => candidate.performerId === previousAppeal.performerId) : null
  const previousKind: ContestParticipantPerformerKind | null = previousPerformer ? contestPerformerIsTrainer(previousPerformer) ? 'trainer' : 'pokemon' : null
  const turn = resolveTrainerParticipantMethodTurn({ methodId: document.participantMethodId, acceptedPerformerKindsThisRound: acceptedKinds, previousRoundTerminalPerformerKind: previousKind })
  const legalPerformers = turn.legalNextPerformerKinds.map(kind => kind === 'trainer' ? trainer : pairedPokemon)
  return { legalPerformers: Object.freeze(legalPerformers), pairedPokemon, legalPerformerIds: Object.freeze(legalPerformers.map(candidate => candidate.performerId)), acceptedAppealsThisTurn: acceptedAppeals.length, roundComplete: turn.roundComplete }
}

const completeParticipantTurnOrAdvance = (before: ContestDocumentV1, next: Mutable, contestantId: string, operationId: string, now: number, random: ContestRandomSource): void => {
  if (before.participantVariantId === 'trainer-participant') {
    const afterAppeal = { ...before, appealLedger: next.appealLedger } as ContestDocumentV1
    const contestant = afterAppeal.contestants.find(row => row.contestantId === contestantId)!
    if (!trainerParticipantAppealAuthority(afterAppeal, contestant).roundComplete) return
  }
  completePerformanceOrAdvance(before, next, operationId, now, random)
}

const declareAppeal = (before: ContestDocumentV1, next: Mutable, command: Extract<ContestCommandV1, { commandKind: 'declare-appeal' }>, context: ContestEngineContextV1): void => {
  requireStage(before, 'performance'); requireRunning(before)
  if (before.pendingInterventionAppealId) rejectContest('contest.intervention-decision-required', 'Resolve or pass the accepted appeal reroll window before declaring another appeal.', { legalAlternatives: ['Use an offered reroll.', 'Pass the reroll window.'], statusCode: 409 })
  const currentCandidate = contestCurrentContestant(before)
  if (!currentCandidate) return rejectContest('contest.wrong-turn', 'No contestant currently has the turn.', { contestantId: command.contestantId, legalAlternatives: [], statusCode: 409 })
  const current = currentCandidate
  if (current.contestantId !== command.contestantId) return rejectContest('contest.wrong-turn', 'It is not this contestant’s turn.', { contestantId: command.contestantId, legalAlternatives: [`Wait for ${current.displayName}.`], statusCode: 409 })
  const participantAuthority = before.participantVariantId === 'trainer-participant' ? trainerParticipantAppealAuthority(before, current) : null
  const ordinaryPerformer = participantAuthority ? null : contestCurrentPerformer(before, current)
  const performer = participantAuthority?.legalPerformers.find(candidate => candidate.performerId === command.performerId) ?? ordinaryPerformer
  const legalPerformerIds = participantAuthority?.legalPerformerIds ?? (ordinaryPerformer ? [ordinaryPerformer.performerId] : [])
  if (!performer || !legalPerformerIds.includes(command.performerId)) return rejectContest('contest.option-not-offered', 'That performer is not active for this appeal.', { contestantId: current.contestantId, legalAlternatives: legalPerformerIds })
  if (current.pendingEffects.targetPerformerId !== null && current.pendingEffects.targetPerformerId !== performer.performerId) rejectContest('contest.intervention-decision-required', 'The accepted pre-appeal intervention is bound to the other paired performer.', { contestantId: current.contestantId, legalAlternatives: [current.pendingEffects.targetPerformerId], field: 'performerId', statusCode: 409 })
  const optionCandidate = performer.moves.find(row => row.optionId === command.moveOptionId)
  if (!optionCandidate) return rejectContest('contest.option-not-offered', 'That move was not in the authoritative offer.', { contestantId: current.contestantId, legalAlternatives: performer.moves.map(row => row.optionId) })
  const option = optionCandidate
  if (!option.available || !isContestStatId(option.typeId) || !isContestEffectId(option.effectId)) return rejectContest('contest.move-unavailable', option.unavailableReason ?? 'That move has no canonical Contest identity.', { contestantId: current.contestantId, legalAlternatives: performer.moves.filter(row => row.available).map(row => row.optionId) })
  const actor = (next.contestants as Mutable[]).find(row => row.contestantId === current.contestantId)!
  const nextPerformer = (actor.performers as Mutable[]).find(row => row.performerId === performer.performerId)!
  const pairedPoolPerformer = participantAuthority ? (actor.performers as Mutable[]).find(row => row.performerId === participantAuthority.pairedPokemon.performerId)! : nextPerformer
  const activeProviderIds = participantAppealProviderIds(before, current, performer)
  let effectId = (actor.pendingEffects.nextAppealEffectId ?? option.effectId) as ContestEffectId
  let moveTypeId = (actor.pendingEffects.nextAppealTypeId ?? option.typeId) as ContestStatId
  const partnerEffectTargetPerformerId = command.partnerEffectTargetPerformerId ?? null
  if (partnerEffectTargetPerformerId !== null) {
    const partnerIds = participantAuthority ? [participantAuthority.pairedPokemon.performerId, current.performers.find(contestPerformerIsTrainer)?.performerId] : []
    if (!simultaneousParticipant(before) || !['get-ready','attention-grabber'].includes(effectId) || partnerEffectTargetPerformerId === performer.performerId || !partnerIds.includes(partnerEffectTargetPerformerId) || effectId === 'get-ready' && participantAuthority!.acceptedAppealsThisTurn !== 0) rejectContest('contest.option-not-offered', 'That partner cannot receive this cross-performer effect at the current Simultaneous timing window.', { contestantId: current.contestantId, legalAlternatives: ['Leave the partner effect target empty.', ...(participantAuthority?.legalPerformerIds ?? [])], field: 'partnerEffectTargetPerformerId' })
  }
  const previousMoveOptionId = [...before.appealLedger].reverse().find(row => row.contestantId === current.contestantId && row.performerId === performer.performerId)?.moveOptionId ?? null
  const repeatedMove = previousMoveOptionId === option.optionId
  if (current.pendingEffects.nextAppealTypeId && current.pendingEffects.nextAppealEffectId && current.pendingEffects.blockedMoveRound === before.round + 1 && !current.pendingEffects.blockedMoveOptionIds.includes(option.optionId)) rejectContest('contest.option-not-offered', 'Adaptable Performance must perform one of its two selected source Moves.', { contestantId: current.contestantId, legalAlternatives: current.pendingEffects.blockedMoveOptionIds, field: 'moveOptionId' })
  if (repeatedMove && effectId !== 'reliable') rejectContest('contest.move-repeat-forbidden', 'A move cannot be used on consecutive appeals unless its effect is Reliable.', { contestantId: current.contestantId, legalAlternatives: performer.moves.filter(row => row.available && row.optionId !== option.optionId).map(row => row.optionId) })
  if (current.pendingEffects.blockedMoveRound === before.round && current.pendingEffects.blockedMovePerformerId === performer.performerId && current.pendingEffects.blockedMoveOptionIds.includes(option.optionId)) rejectContest('contest.move-blocked-by-intervention', 'Adaptable Performance prevents using either source Move on this round.', { contestantId: current.contestantId, legalAlternatives: performer.moves.filter(row => row.available && !current.pendingEffects.blockedMoveOptionIds.includes(row.optionId)).map(row => row.optionId) })
  const spent = emptyContestStatRecord(statId => Math.floor(Number(command.spentDice[statId] ?? 0)))
  const spentTotal = CONTEST_STAT_IDS.reduce((sum, statId) => sum + spent[statId], 0)
  if (spentTotal > contestCatalog.performance.contestDiceSpendMaximumPerAppeal) rejectContest('contest.dice-overspend', `At most ${contestCatalog.performance.contestDiceSpendMaximumPerAppeal} Contest dice may be spent on one appeal.`, { contestantId: current.contestantId, legalAlternatives: ['Reduce the Contest dice spend.'], field: 'spentDice' })
  if (before.variantId === 'rotation' && actor.teamContestDiceSpent + spentTotal > before.contestants.length * 2) rejectContest('contest.dice-overspend', `This Rotation team may spend at most ${before.contestants.length * 2} Contest dice across the whole Contest.`, { contestantId: current.contestantId, legalAlternatives: ['Reduce the spend to the team allowance.'], field: 'spentDice' })
  for (const statId of CONTEST_STAT_IDS) {
    const available = pairedPoolPerformer.dicePools[statId].remaining + (before.variantId === 'rotation' ? actor.teamDicePools[statId].remaining : 0)
    if (spent[statId] > available) rejectContest('contest.dice-overspend', `Only ${available} ${statId} dice remain.`, { contestantId: current.contestantId, legalAlternatives: ['Reduce the spend or choose another stat pool.'], field: `spentDice.${statId}` })
  }
  const contestTypeId = before.currentRoundContestTypeId ?? before.contestTypeId
  if (!isContestStatId(contestTypeId)) throw new Error('Running Contest has no canonical current type.')
  if (actor.pendingEffects.nextAppealAlignmentTypeId && actor.pendingEffects.nextAppealAlignmentTypeId !== moveTypeId) rejectContest('contest.intervention-window-closed', `The accepted alignment intervention requires a ${actor.pendingEffects.nextAppealAlignmentTypeId} Move.`, { contestantId: current.contestantId, legalAlternatives: performer.moves.filter(row => row.available && row.typeId === actor.pendingEffects.nextAppealAlignmentTypeId).map(row => row.optionId) })
  const effect = contestEffectById.get(effectId)!
  const startingVoltage = performerVoltage(before, current, performer.performerId)
  const adjacency = positionContext(before, current)
  const previousPerformerAppeal = [...before.appealLedger].reverse().find(row => row.contestantId === current.contestantId && row.performerId === performer.performerId)
  const transferredGetReady = simultaneousParticipant(before) && before.appealLedger.some(row => row.contestantId === current.contestantId && row.round === before.round && row.turn === before.turnIndex + 1 && (before.variantId !== 'festival' || appealFestivalHeat(row.appealId) === before.festivalHeat) && row.effectId === 'get-ready' && row.partnerEffectTargetPerformerId === performer.performerId)
  const multiplier = before.participantVariantId === 'trainer-participant'
    ? transferredGetReady || previousPerformerAppeal?.effectId === 'get-ready' && previousPerformerAppeal.partnerEffectTargetPerformerId === null ? 2 : 1
    : Math.max(1, Number(actor.pendingEffects.nextRoundBaseMoveDiceMultiplier || 1))
  const adjacentVoltages = adjacency.adjacentIds.flatMap(id => voltageTargets(before, contestantById(before, id)).map(target => target.voltage))
  const assembly = assembleContestAppeal({ effectId, moveTypeId, contestTypeId, spentDice: spentTotal, startingVoltage, adjacentVoltages, repeatedMove, baseMoveDiceMultiplier: multiplier, alignmentSteps: actor.pendingEffects.nextAppealAlignmentSteps, sonic: option.tags.includes('sonic'), voiceLessonsActive: activeProviderIds.includes('feature:Voice Lessons'), acceptedInterventionBonusDice: actor.pendingEffects.nextAppealBonusDice })
  const { baseDice, relationship, voltageDice, voiceDice, assembledRaw, assembledDice } = assembly
  const bonusDice = assembly.interventionDice
  const contributors: ContestAppealContributorV1[] = [
    { id: `effect:${effectId}`, label: effect.label, kind: 'base', dice: baseDice, explanation: `${effect.label} contributes ${baseDice} base dice${multiplier > 1 ? ` after ×${multiplier}` : ''}.` },
    { id: `type:${moveTypeId}:${contestTypeId}`, label: 'Contest alignment', kind: 'type', dice: relationship.dice, explanation: relationship.explanation },
    ...(spentTotal ? [{ id: 'contest-stat-spend', label: 'Contest stat dice', kind: 'contest-stat' as const, dice: spentTotal, explanation: `${spentTotal} prepared Contest dice spent.` }] : []),
    ...(voltageDice ? [{ id: 'start-voltage', label: 'Voltage', kind: 'voltage' as const, dice: voltageDice, explanation: `${startingVoltage} start-of-turn Voltage adds ${voltageDice}d6.` }] : []),
    ...(voiceDice ? [{ id: 'feature:Voice Lessons', label: 'Voice Lessons', kind: 'feature' as const, dice: 1, explanation: 'Sonic Move gains +1d6.' }] : []),
    ...(bonusDice ? [{ id: 'accepted-intervention', label: 'Intervention', kind: 'feature' as const, dice: bonusDice, explanation: `Accepted intervention adds ${bonusDice}d6.` }] : []),
  ]
  const fixed = actor.pendingEffects.fixedAppealPerDie === true
  const journal = rollContestDice({ contestId: before.contestId, diceJournal: next.diceJournal }, { operationId: command.operationId, purpose: 'appeal', contestantId: actor.contestantId, round: before.round, count: fixed ? 0 : assembledDice, dieSides: 6, createdAt: context.now }, context.random)
  appendJournal(next, journal)
  const acceptedResults = fixed ? Object.freeze(Array.from({ length: assembledDice }, () => 0)) : Object.freeze([...journal.results])
  let scored = scoreRoll(acceptedResults, effectId, adjacency.center, fixed)
  if (assembledRaw <= 0 && relationship.relationship === 'opposed') scored = { ...scored, fumble: scored.fumble + 1 }
  let savingGraceRemoved = 0, effectStartingVoltage = startingVoltage
  if (effectId === 'saving-grace') {
    savingGraceRemoved = Math.min(actor.fumble, startingVoltage)
    effectStartingVoltage = cappedVoltage(startingVoltage + (savingGraceRemoved <= 2 ? 1 : 0))
  }
  const applied = effectConsequences({ document: before, actor: current, actorPerformerId: performer.performerId, actorVoltageRecipientPerformerId: effectId === 'attention-grabber' ? partnerEffectTargetPerformerId : null, effectId, results: acceptedResults, adjacentIds: adjacency.adjacentIds, startingVoltage: effectStartingVoltage, appeal: scored.appeal, fumble: scored.fumble, repeatedMove, matchingType: relationship.relationship === 'matching' })
  if (savingGraceRemoved) applied.consequences.push({ contestantId: actor.contestantId, performerId: null, appealDelta: 0, fumbleDelta: -savingGraceRemoved, voltageDelta: 0, reason: 'Saving Grace' })
  actor.appeal += applied.appeal; actor.fumble += applied.fumble
  setPerformerVoltage(before, actor, performer.performerId, applied.actorVoltage)
  for (const consequence of applied.consequences) {
    const target = (next.contestants as Mutable[]).find(row => row.contestantId === consequence.contestantId)!
    target.appeal = Math.max(0, target.appeal + consequence.appealDelta)
    if (target.pendingEffects.fumbleProtectionRound !== before.round) target.fumble = Math.max(0, target.fumble + consequence.fumbleDelta)
    const actorVoltageConsequence = target.contestantId === actor.contestantId && (!simultaneousParticipant(before) || consequence.performerId === performer.performerId)
    if (!actorVoltageConsequence && consequence.voltageDelta !== 0) {
      if (consequence.performerId === null) target.voltage = cappedVoltage(target.voltage + consequence.voltageDelta)
      else target.performerVoltages[consequence.performerId] = cappedVoltage(target.performerVoltages[consequence.performerId] + consequence.voltageDelta)
    }
  }
  if (effectId === 'get-ready') actor.pendingEffects.nextRoundBaseMoveDiceMultiplier = before.participantVariantId === 'trainer-participant' ? 1 : 2
  else actor.pendingEffects.nextRoundBaseMoveDiceMultiplier = 1
  setPerformerVoltage(before, actor, performer.performerId, terminalContestEffectVoltage(
    effectId,
    performerVoltage(before, actor as ContestantStateV1, performer.performerId),
  ))
  if (effectId === 'saving-grace') actor.pendingEffects.fumbleProtectionRound = before.round
  if (before.participantVariantId === 'trainer-participant' && spentTotal > 0) {
    const trainer = actor.performers.find((candidate: Mutable) => candidate.performerKind === 'trainer')
    if (!trainer) throw new Error('Parsed Trainer Participant entry has no enrolled Trainer.')
    const transition = spendTrainerParticipantSharedDice({
      pokemonPools: pairedPoolPerformer.dicePools,
      teamPools: actor.teamDicePools,
      journal: actor.sharedDiceSpendJournal,
      enrolledPerformerIds: actor.performers.map((candidate: Mutable) => candidate.performerId),
      trainerPerformerId: trainer.performerId,
      pokemonPerformerId: pairedPoolPerformer.performerId,
      performerId: performer.performerId,
      operationId: command.operationId,
      spentDice: spent,
      createdAt: context.now,
    })
    pairedPoolPerformer.dicePools = transition.pokemonPools
    actor.teamDicePools = transition.teamPools
    actor.sharedDiceSpendJournal = transition.journal
  } else for (const statId of CONTEST_STAT_IDS) {
    if (before.variantId === 'rotation') {
      const shared = actor.teamDicePools[statId]
      const sharedSpend = Math.min(shared.remaining, spent[statId])
      shared.remaining -= sharedSpend
      pairedPoolPerformer.dicePools[statId].remaining -= spent[statId] - sharedSpend
    } else pairedPoolPerformer.dicePools[statId].remaining -= spent[statId]
  }
  if (before.variantId === 'rotation') actor.teamContestDiceSpent += spentTotal
  actor.lastMoveOptionId = option.optionId
  actor.pendingEffects.nextAppealAlignmentSteps = 0; actor.pendingEffects.nextAppealAlignmentTypeId = null; actor.pendingEffects.nextAppealBonusDice = 0; actor.pendingEffects.nextAppealTypeId = null; actor.pendingEffects.nextAppealEffectId = null; actor.pendingEffects.fixedAppealPerDie = false; actor.pendingEffects.targetPerformerId = null
  const appealId = `appeal:${before.contestId.split(':').at(-1)}-${before.festivalHeat}-${before.round}-${before.turnIndex + 1}-${before.appealLedger.length + 1}`
  const ledger: ContestAppealLedgerEntryV1 = Object.freeze({
    appealId, operationId: command.operationId, round: before.round, turn: before.turnIndex + 1, contestantId: actor.contestantId, performerId: performer.performerId,
    moveOptionId: option.optionId, moveLabel: option.label, moveTypeId, contestTypeId, effectId, partnerEffectTargetPerformerId, centerOfAttention: adjacency.center, adjacentContestantIds: adjacency.adjacentIds,
    adjacentPerformerIds: Object.freeze([]), spentDice: Object.freeze(spent), contributors: Object.freeze(contributors), baseMoveDiceMultiplier: multiplier as 1 | 2, assembledDice, journalIds: Object.freeze([journal.journalId]), acceptedResults,
    appealDelta: applied.appeal, fumbleDelta: applied.fumble, voltageBefore: startingVoltage, voltageAfter: performerVoltage(before, actor as ContestantStateV1, performer.performerId),
    consequences: Object.freeze(applied.consequences.map(row => Object.freeze({ ...row }))), acceptedAt: context.now, correctionIds: Object.freeze([]),
  })
  next.appealLedger.push(ledger)
  history(next, before, { type: 'appeal-accepted', contestantId: actor.contestantId, headline: `${actor.displayName} used ${option.label}`, detail: `${assembledDice}d6 resolved for +${applied.appeal} Appeal, +${applied.fumble} Fumble, Voltage ${startingVoltage} → ${performerVoltage(before, actor as ContestantStateV1, performer.performerId)}.`, operationId: command.operationId, createdAt: context.now })
  const providers = activeProviderIds
  const contestFashionUsageId = before.variantId === 'rotation' || before.participantVariantId === 'trainer-participant' ? `Contest Fashion@${performer.performerId}` : 'Contest Fashion'
  const hasPostAppealIntervention = !fixed && (
    (acceptedResults.length > 0 && !actor.usedInterventionIds.includes('Coordinator') && providers.includes('feature:Coordinator'))
    || (acceptedResults.includes(1) && !actor.usedInterventionIds.includes('Style Flourish') && providers.includes(`feature:Style Flourish:${moveTypeId}`))
    || (acceptedResults.includes(1) && !actor.usedInterventionIds.includes(contestFashionUsageId) && providers.includes(`item:Contest Fashion:${moveTypeId}`))
  )
  if (hasPostAppealIntervention) {
    next.pendingInterventionAppealId = appealId
    history(next, before, { type: 'intervention-window-opened', contestantId: actor.contestantId, headline: 'Appeal reroll decision', detail: 'An offered reroll must be used or explicitly passed before the turn advances.', operationId: command.operationId, createdAt: context.now })
  } else completeParticipantTurnOrAdvance(before, next, actor.contestantId, command.operationId, context.now, context.random)
}

const recalculateRerolledAppeal = (before: ContestDocumentV1, next: Mutable, command: Extract<ContestCommandV1, { commandKind: 'use-intervention' }>, indices: readonly number[], context: ContestEngineContextV1): void => {
  const ledgerIndex = (next.appealLedger as Mutable[]).findIndex(row => row.appealId === command.appealId)
  if (ledgerIndex < 0) rejectContest('contest.option-not-offered', 'That accepted appeal is unavailable for this intervention.', { contestantId: command.contestantId })
  const ledger = next.appealLedger[ledgerIndex] as Mutable
  if (ledger.contestantId !== command.contestantId) rejectContest('contest.controller-required', 'This intervention can affect only your own appeal.', { contestantId: command.contestantId, statusCode: 403 })
  const valid = [...new Set(indices)].filter(index => Number.isInteger(index) && index >= 0 && index < ledger.acceptedResults.length)
  if (!valid.length) rejectContest('contest.option-not-offered', 'Choose at least one eligible die to reroll.', { contestantId: command.contestantId })
  const journal = rollContestDice({ contestId: before.contestId, diceJournal: next.diceJournal }, { operationId: command.operationId, purpose: 'appeal-reroll', contestantId: command.contestantId, round: ledger.round, count: valid.length, dieSides: 6, rerolledDieIndices: valid, replacesJournalId: ledger.journalIds.at(-1) ?? null, createdAt: context.now }, context.random)
  appendJournal(next, journal)
  const results = [...ledger.acceptedResults]; valid.forEach((index, cursor) => { results[index] = journal.results[cursor] })
  let newScore = scoreRoll(results, ledger.effectId, ledger.centerOfAttention, false)
  const relationship = explainContestTypeRelationship(ledger.moveTypeId, ledger.contestTypeId)
  if (ledger.assembledDice === 0 && relationship.relationship === 'opposed') newScore = { ...newScore, fumble: newScore.fumble + 1 }
  const actor = (next.contestants as Mutable[]).find(row => row.contestantId === command.contestantId)!
  actor.appeal = Math.max(0, actor.appeal + newScore.appeal - ledger.appealDelta)
  actor.fumble = Math.max(0, actor.fumble + newScore.fumble - ledger.fumbleDelta)
  if (ledger.effectId === 'gamble') {
    const voltagePerformerId = simultaneousParticipant(before) ? ledger.performerId as string : null
    const existing = (ledger.consequences as Mutable[]).find(row => row.contestantId === actor.contestantId && row.performerId === voltagePerformerId && row.reason === 'Gamble')
    const oldDelta = Number(existing?.voltageDelta ?? 0)
    const acceptedVoltage = voltagePerformerId === null ? actor.voltage : actor.performerVoltages[voltagePerformerId]
    const voltageWithoutGamble = cappedVoltage(acceptedVoltage - oldDelta)
    const newDelta = cappedVoltage(voltageWithoutGamble + results.filter(value => value === 6).length) - voltageWithoutGamble
    const nextVoltage = cappedVoltage(voltageWithoutGamble + newDelta)
    if (voltagePerformerId === null) actor.voltage = nextVoltage
    else actor.performerVoltages[voltagePerformerId] = nextVoltage
    if (existing) existing.voltageDelta = newDelta
    else if (newDelta) ledger.consequences.push({ contestantId: actor.contestantId, performerId: voltagePerformerId, appealDelta: 0, fumbleDelta: 0, voltageDelta: newDelta, reason: 'Gamble' })
    ledger.voltageAfter = nextVoltage
  }
  if (ledger.effectId === 'tease') {
    const oldSixes = ledger.acceptedResults.filter((value: number) => value === 6).length
    const newSixes = results.filter(value => value === 6).length
    for (const targetId of ledger.adjacentContestantIds as string[]) {
      const target = (next.contestants as Mutable[]).find(row => row.contestantId === targetId)!
      if (target.pendingEffects.fumbleProtectionRound !== before.round) target.fumble = Math.max(0, target.fumble + newSixes - oldSixes)
      const existing = (ledger.consequences as Mutable[]).find(row => row.contestantId === targetId && row.reason === 'Tease')
      const acceptedDelta = target.pendingEffects.fumbleProtectionRound === before.round ? 0 : newSixes
      if (existing) existing.fumbleDelta = acceptedDelta
      else if (newSixes) ledger.consequences.push({ contestantId: targetId, performerId: null, appealDelta: 0, fumbleDelta: acceptedDelta, voltageDelta: 0, reason: 'Tease' })
    }
  }
  ledger.acceptedResults = results; ledger.journalIds = [...ledger.journalIds, journal.journalId]
  ledger.appealDelta = newScore.appeal; ledger.fumbleDelta = newScore.fumble
  ledger.correctionIds = [...ledger.correctionIds, command.operationId]
}

const useIntervention = (before: ContestDocumentV1, next: Mutable, command: Extract<ContestCommandV1, { commandKind: 'use-intervention' }>, context: ContestEngineContextV1): void => {
  requireStage(before, 'performance'); requireRunning(before)
  const source = contestantById(before, command.contestantId)
  const actor = (next.contestants as Mutable[]).find(row => row.contestantId === source.contestantId)!
  const id = command.interventionId
  const preAppeal = ['Reliable Performance','Adaptable Performance','Fabulous Max','Rule of Cool','Gleeful Steps','Calculated Assault','Macho Charge','Fashion Designer','Beautiful'].includes(id)
  const postAppeal = id === 'Coordinator' || id === 'Style Flourish' || id === 'Contest Fashion'
  const requestedPerformerId = command.targetPerformerId ?? null
  let currentPerformer: ContestantStateV1['performers'][number] | undefined
  if (before.participantVariantId === 'trainer-participant') {
    if (preAppeal) {
      if (contestCurrentContestant(before)?.contestantId !== source.contestantId) rejectContest('contest.intervention-window-closed', `${id} is available only immediately before this contestant’s appeal.`, { contestantId: source.contestantId })
      const authority = trainerParticipantAppealAuthority(before, source)
      if (requestedPerformerId === null || !authority.legalPerformerIds.includes(requestedPerformerId)) rejectContest('contest.option-not-offered', 'Choose one currently legal paired performer for this intervention.', { contestantId: source.contestantId, legalAlternatives: authority.legalPerformerIds, field: 'targetPerformerId' })
      currentPerformer = source.performers.find(performer => performer.performerId === requestedPerformerId)
    } else if (postAppeal) {
      const acceptedAppeal = command.appealId ? before.appealLedger.find(appeal => appeal.appealId === command.appealId) : null
      if (!acceptedAppeal || acceptedAppeal.contestantId !== source.contestantId || requestedPerformerId !== acceptedAppeal.performerId) rejectContest('contest.intervention-window-closed', 'Choose the exact performer from the pending paired appeal.', { contestantId: source.contestantId, field: 'targetPerformerId' })
      currentPerformer = acceptedAppeal ? source.performers.find(performer => performer.performerId === acceptedAppeal.performerId) : undefined
    } else rejectContest('contest.option-not-offered', `${id} has no paired-performer Contest action.`, { contestantId: source.contestantId })
  } else {
    if (requestedPerformerId !== null) rejectContest('contest.option-not-offered', 'Ordinary Contest interventions infer their active performer.', { contestantId: source.contestantId, field: 'targetPerformerId' })
    currentPerformer = contestCurrentPerformer(before, source)
  }
  if (!currentPerformer) return rejectContest('contest.option-not-offered', 'The exact paired performer is unavailable.', { contestantId: source.contestantId, field: 'targetPerformerId' })
  const providerIds = participantAppealProviderIds(before, source, currentPerformer)
  const providerMatch = providerIds.some(provider => provider === `feature:${id}` || provider === `ability:${id}` || provider === `item:${id}` || provider.startsWith(`item:${id}:`) || provider.startsWith(`feature:${id}:`))
  if (!providerMatch) rejectContest('contest.option-not-offered', 'That intervention is not provided by the enrolled sheets.', { contestantId: source.contestantId })
  if (command.targetContestantId !== null) rejectContest('contest.option-not-offered', 'This intervention does not offer a separate target.', { contestantId: source.contestantId, field: 'targetContestantId' })
  const choiceKeys = Object.keys(command.choices).sort()
  if (id === 'Adaptable Performance') {
    if (choiceKeys.join(',') !== 'effectMoveOptionId,typeMoveOptionId' || typeof command.choices.typeMoveOptionId !== 'string' || typeof command.choices.effectMoveOptionId !== 'string') rejectContest('contest.option-not-offered', 'Adaptable Performance requires exactly one type Move and one effect Move.', { contestantId: source.contestantId, field: 'choices' })
  } else if (choiceKeys.length) rejectContest('contest.option-not-offered', `${id} does not accept additional choices.`, { contestantId: source.contestantId, field: 'choices' })
  const oncePerContest = id !== 'Reliable Performance' && id !== 'Fashion Designer'
  const performerScoped = (before.variantId === 'rotation' || before.participantVariantId === 'trainer-participant') && (id === 'Beautiful' || id === 'Contest Fashion')
  const usageId = performerScoped ? `${id}@${currentPerformer.performerId}` : id
  if (oncePerContest && actor.usedInterventionIds.includes(usageId)) rejectContest('contest.resource-exhausted', `${id} has already been used by this provider in this Contest.`, { contestantId: source.contestantId })
  if (preAppeal && command.appealId !== null) rejectContest('contest.intervention-window-closed', 'Pre-appeal interventions cannot reference accepted appeal evidence.', { contestantId: source.contestantId, field: 'appealId' })
  if (preAppeal && before.pendingInterventionAppealId) rejectContest('contest.intervention-window-closed', 'The accepted appeal reroll window must close before another pre-appeal intervention.', { contestantId: source.contestantId })
  if (preAppeal && (before.stage !== 'performance' || contestCurrentContestant(before)?.contestantId !== source.contestantId)) rejectContest('contest.intervention-window-closed', `${id} is available only immediately before this contestant’s appeal.`, { contestantId: source.contestantId })
  if (preAppeal && actor.pendingEffects.targetPerformerId !== null && actor.pendingEffects.targetPerformerId !== currentPerformer.performerId) rejectContest('contest.intervention-conflict', 'Pending pre-appeal interventions are already bound to the other paired performer.', { contestantId: source.contestantId, legalAlternatives: [actor.pendingEffects.targetPerformerId] })
  if (id === 'Reliable Performance' && actor.pendingEffects.fixedAppealPerDie) rejectContest('contest.intervention-conflict', 'Reliable Performance is already committed to the pending appeal.', { contestantId: source.contestantId, legalAlternatives: ['Declare the pending appeal before using Reliable Performance again.'] })
  if (postAppeal) {
    if (!command.appealId || before.pendingInterventionAppealId !== command.appealId) rejectContest('contest.intervention-window-closed', 'Choose the currently pending accepted appeal to reroll.', { contestantId: source.contestantId })
    const appealCandidate = before.appealLedger.find(row => row.appealId === command.appealId)
    if (!appealCandidate || appealCandidate !== before.appealLedger.at(-1) || appealCandidate.round !== before.round || appealCandidate.contestantId !== source.contestantId) return rejectContest('contest.intervention-window-closed', 'Only the most recently accepted appeal remains in this reroll window.', { contestantId: source.contestantId })
    const appeal = appealCandidate
    let indices: number[]
    if (id === 'Coordinator') indices = appeal.acceptedResults.map((_value, index) => index)
    else indices = appeal.acceptedResults.flatMap((value, index) => value === 1 ? [index] : [])
    if (id === 'Contest Fashion' || id === 'Style Flourish') {
      const performer = source.performers.find(row => row.performerId === appeal.performerId)!
      const option = performer.moves.find(row => row.optionId === appeal.moveOptionId)
      const requiredProvider = id === 'Contest Fashion' ? `item:Contest Fashion:${option?.typeId}` : `feature:Style Flourish:${option?.typeId}`
      if (!option || !providerIds.includes(requiredProvider)) return rejectContest('contest.option-not-offered', `${id} does not match this move’s Contest type.`, { contestantId: source.contestantId })
    }
    recalculateRerolledAppeal(before, next, command, indices, context)
  } else if (id === 'Reliable Performance') actor.pendingEffects.fixedAppealPerDie = true
  else if (['Fabulous Max','Rule of Cool','Gleeful Steps','Calculated Assault','Macho Charge'].includes(id)) {
    if (actor.pendingEffects.nextAppealAlignmentSteps > 0) rejectContest('contest.intervention-conflict', 'Only one Style alignment intervention may modify an appeal.', { contestantId: source.contestantId, legalAlternatives: ['Declare the pending appeal before using another alignment intervention.'] })
    const requiredType = ({ 'Fabulous Max': 'beauty', 'Rule of Cool': 'cool', 'Gleeful Steps': 'cute', 'Calculated Assault': 'smart', 'Macho Charge': 'tough' } as const)[id as 'Fabulous Max'|'Rule of Cool'|'Gleeful Steps'|'Calculated Assault'|'Macho Charge']
    actor.pendingEffects.nextAppealAlignmentSteps += 1
    actor.pendingEffects.nextAppealAlignmentTypeId = requiredType
  }
  else if (id === 'Fashion Designer') actor.pendingEffects.nextAppealBonusDice += 2
  else if (id === 'Adaptable Performance') {
    const performer = currentPerformer
    const typeSource = performer.moves.find(row => row.optionId === command.choices.typeMoveOptionId && row.available && isContestStatId(row.typeId))
    const effectSource = performer.moves.find(row => row.optionId === command.choices.effectMoveOptionId && row.available && isContestEffectId(row.effectId))
    if (!typeSource) return rejectContest('contest.option-not-offered', 'Choose an available Move to supply the Contest type.', { contestantId: source.contestantId, legalAlternatives: performer.moves.filter(row => row.available).map(row => row.optionId) })
    if (!effectSource) return rejectContest('contest.option-not-offered', 'Choose an available Move to supply the Contest effect.', { contestantId: source.contestantId, legalAlternatives: performer.moves.filter(row => row.available).map(row => row.optionId) })
    if (typeSource.optionId === effectSource.optionId) rejectContest('contest.option-not-offered', 'The type and effect must come from two distinct Moves.', { contestantId: source.contestantId, legalAlternatives: performer.moves.filter(row => row.available && row.optionId !== typeSource.optionId).map(row => row.optionId) })
    actor.pendingEffects.nextAppealTypeId = typeSource.typeId; actor.pendingEffects.nextAppealEffectId = effectSource.effectId
    actor.pendingEffects.blockedMoveOptionIds = [typeSource.optionId, effectSource.optionId]
    actor.pendingEffects.blockedMoveRound = before.round + 1
    actor.pendingEffects.blockedMovePerformerId = performer.performerId
  } else if (id === 'Beautiful') {
    const target = (actor.performers as Mutable[]).find(row => row.performerId === currentPerformer.performerId)!
    target.dicePools.beauty.total += 2; target.dicePools.beauty.remaining += 2
    target.dicePools.beauty.contributors.push({ id: `ability:Beautiful:${command.operationId}`, kind: 'ability', statId: 'beauty', dice: 2, active: true, label: 'Beautiful', sourceId: command.operationId, explanation: 'Beautiful adds +2 Beauty dice for this Contest.' })
  } else rejectContest('contest.option-not-offered', `${id} has no selectable Contest action in this catalog.`, { contestantId: source.contestantId })
  if (before.participantVariantId === 'trainer-participant' && preAppeal && id !== 'Beautiful') actor.pendingEffects.targetPerformerId = currentPerformer.performerId
  if (oncePerContest) actor.usedInterventionIds.push(usageId)
  history(next, before, { type: 'intervention-accepted', contestantId: actor.contestantId, headline: `${id} accepted`, detail: 'The intervention was applied at its canonical timing window.', operationId: command.operationId, createdAt: context.now })
  if (postAppeal) {
    const appeal = (next.appealLedger as ContestAppealLedgerEntryV1[]).find(row => row.appealId === command.appealId)!
    const activePerformer = source.performers.find(row => row.performerId === appeal.performerId)!
    const providers = participantAppealProviderIds(before, source, activePerformer)
    const contestFashionUsageId = before.variantId === 'rotation' || before.participantVariantId === 'trainer-participant' ? `Contest Fashion@${appeal.performerId}` : 'Contest Fashion'
    const hasAnotherReroll = (appeal.acceptedResults.length > 0 && !actor.usedInterventionIds.includes('Coordinator') && providers.includes('feature:Coordinator'))
      || (appeal.acceptedResults.includes(1) && !actor.usedInterventionIds.includes('Style Flourish') && providers.includes(`feature:Style Flourish:${appeal.moveTypeId}`))
      || (appeal.acceptedResults.includes(1) && !actor.usedInterventionIds.includes(contestFashionUsageId) && providers.includes(`item:Contest Fashion:${appeal.moveTypeId}`))
    if (hasAnotherReroll) {
      next.pendingInterventionAppealId = appeal.appealId
      history(next, before, { type: 'intervention-window-opened', contestantId: actor.contestantId, headline: 'Another appeal reroll is available', detail: 'Use another offered reroll or explicitly keep the current result before the turn advances.', operationId: command.operationId, createdAt: context.now })
    } else {
      next.pendingInterventionAppealId = null
      completeParticipantTurnOrAdvance(before, next, actor.contestantId, command.operationId, context.now, context.random)
    }
  }
}

const passIntervention = (before: ContestDocumentV1, next: Mutable, command: Extract<ContestCommandV1, { commandKind: 'pass-intervention' }>, context: ContestEngineContextV1): void => {
  requireStage(before, 'performance'); requireRunning(before)
  if (before.pendingInterventionAppealId !== command.appealId) rejectContest('contest.intervention-window-closed', 'That reroll window is no longer pending.', { contestantId: command.contestantId })
  const appeal = before.appealLedger.find(row => row.appealId === command.appealId)
  if (!appeal || appeal.contestantId !== command.contestantId) rejectContest('contest.controller-required', 'Only the appealing contestant may pass this reroll window.', { contestantId: command.contestantId, statusCode: 403 })
  next.pendingInterventionAppealId = null
  history(next, before, { type: 'intervention-window-passed', contestantId: command.contestantId, headline: 'Reroll passed', detail: 'The accepted appeal stands and turn advancement resumes.', operationId: command.operationId, createdAt: context.now })
  completeParticipantTurnOrAdvance(before, next, command.contestantId, command.operationId, context.now, context.random)
}

const prepareSettlement = (before: ContestDocumentV1, next: Mutable, operationId: string, now: number): void => {
  requireStage(before, 'settling')
  if (!before.policy.prize.declared) rejectContest('contest.prize-undecided', 'Declare the final prize package, including an explicit no-prize package, before preparing settlement.', { legalAlternatives: ['Declare money and items.', 'Declare an empty prize package.'], statusCode: 409 })
  const enrolledTrainerSlugs = new Set(before.contestants.map(row => row.trainerSheetSlug))
  if (before.policy.prize.items.some(item => item.targetTrainerSlug !== null && !enrolledTrainerSlugs.has(item.targetTrainerSlug))) rejectContest('contest.prize-target-invalid', 'Every targeted prize must name an enrolled Trainer.', { legalAlternatives: ['Target the winner by leaving the Trainer blank.', 'Choose an enrolled Trainer.'] })
  if (before.settlement?.status === 'committed') rejectContest('contest.settlement-not-ready', 'This Contest is already settled.', { statusCode: 409 })
  const count = before.contestants.length
  const entries = [...before.contestants].sort((left, right) => (left.finalPlacement ?? 999) - (right.finalPlacement ?? 999)).map(contestant => {
    const placement = contestant.finalPlacement ?? count
    const pokemon = contestant.performers.filter(contestPerformerIsPokemon)
    const lowerPlacedPokemon = before.variantId === 'rotation' ? before.contestants.filter(row => (row.finalPlacement ?? count) > placement).reduce((sum, row) => sum + row.performers.filter(contestPerformerIsPokemon).length, 0) : 0
    const units = before.variantId === 'rotation' ? Math.ceil((lowerPlacedPokemon + 1) / 2) : Math.ceil((count - placement + 1) / 2)
    const perPokemon = pokemon.map(performer => Math.ceil(performer.level * units * before.policy.significanceMultiplier))
    let experienceByPokemon: { pokemonSheetSlug: string, experience: number }[]
    if (before.variantId === 'rotation') {
      const total = perPokemon.reduce((sum, value) => sum + value, 0)
      const base = Math.floor(total / pokemon.length); let remainder = total % pokemon.length
      experienceByPokemon = pokemon.map(performer => ({ pokemonSheetSlug: performer.pokemonSheetSlug, experience: base + (remainder-- > 0 ? 1 : 0) }))
    } else if (before.variantId === 'battle') {
      experienceByPokemon = pokemon.map((performer, performerIndex) => ({ pokemonSheetSlug: performer.pokemonSheetSlug, experience: perPokemon[performerIndex]! }))
    } else experienceByPokemon = [{ pokemonSheetSlug: pokemon[0]!.pokemonSheetSlug, experience: perPokemon[0]! }]
    return Object.freeze({ contestantId: contestant.contestantId, placement, finalScore: contestant.finalScore ?? contestant.appeal - contestant.fumble, experienceByPokemon: Object.freeze(experienceByPokemon), ribbon: before.policy.awardRibbon && placement === 1, trainerSheetSlug: contestant.trainerSheetSlug })
  })
  next.settlement = { settlementId: `${before.contestId}:settlement`, status: 'preview', entries, money: before.policy.prize.money, items: before.policy.prize.items, attentionItemIds: entries.flatMap(row => row.experienceByPokemon.filter(xp => xp.experience > 0).map(xp => `contest-level-check:${before.contestId}:${xp.pokemonSheetSlug}`)), battleCoordination: null, committedOperationId: null, committedAt: null }
  history(next, before, { type: 'settlement-prepared', headline: 'Settlement preview ready', detail: 'Placements, experience, ribbons, and declared prizes are listed for one atomic commit.', operationId, createdAt: now })
}

export const executeContestEngineCommand = (beforeInput: ContestDocumentV1, command: Exclude<ContestCommandV1, { commandKind: 'create-contest' }>, context: ContestEngineContextV1): ContestDocumentV1 => {
  const before = parseContestDocument(beforeInput)
  if (command.contestId !== before.contestId) throw new Error('Contest command/document identity mismatch.')
  const next = mutable(before)
  switch (command.commandKind) {
    case 'update-settings': {
      requireStage(before, 'setup')
      const patch = command.patch
      if (patch.name !== undefined) next.display.name = String(patch.name).slice(0, 120)
      if (patch.hallName !== undefined) next.display.hallName = String(patch.hallName).slice(0, 120)
      if (patch.description !== undefined) next.display.description = String(patch.description).slice(0, 1_000)
      if (patch.significanceMultiplier !== undefined) {
        const value = Number(patch.significanceMultiplier), min = contestCatalog.experience.significanceMultiplierMinimum, max = contestCatalog.experience.significanceMultiplierMaximum, step = contestCatalog.experience.significanceMultiplierStep
        if (!Number.isFinite(value) || value < min || value > max || value / step !== Math.round(value / step)) rejectContest('contest.stage-mismatch', 'Significance multiplier is outside reviewed policy bounds.', { field: 'significanceMultiplier' })
        next.policy.significanceMultiplier = value
      }
      if (patch.awardRibbon !== undefined) next.policy.awardRibbon = patch.awardRibbon === true
      if (patch.prize !== undefined) next.policy.prize = structuredClone(normalizeContestPrize(patch.prize))
      if (patch.gmNotes !== undefined) next.gmNotes = String(patch.gmNotes).slice(0, 4_000)
      history(next, before, { type: 'settings-updated', visibility: 'gm', headline: 'Contest settings updated', detail: 'The reviewed pre-start policy changed.', operationId: command.operationId, createdAt: context.now }); break
    }
    case 'set-participant-method': {
      requireStage(before, 'setup')
      if (before.participantVariantId !== 'trainer-participant') rejectContest('contest.method-unavailable', 'Participant methods are available only to Trainer Participant Contests.', { field: 'participantMethodId' })
      next.participantMethodId = command.participantMethodId
      for (const contestant of next.contestants as Mutable[]) contestant.performerVoltages = command.participantMethodId === 'simultaneous' ? Object.fromEntries(contestant.performers.map((performer: Mutable) => [performer.performerId, 0])) : {}
      history(next, before, { type: 'participant-method-selected', headline: `${command.participantMethodId === 'simultaneous' ? 'Simultaneous' : 'Alternating'} method selected`, detail: command.participantMethodId === 'simultaneous' ? 'Trainer and Pokémon will each appeal once per round in controller-chosen order.' : 'Trainer and Pokémon will alternate one appeal per entry round.', operationId: command.operationId, createdAt: context.now }); break
    }
    case 'enroll-contestant': {
      requireStage(before, 'setup')
      const enrollment = context.enrollment ?? (() => { throw new Error('Enrollment snapshot context is required.') })()
      if (enrollment.contestantId !== command.contestantId) throw new Error('Enrollment context identity mismatch.')
      const contestantMaximum = before.variantId === 'battle' ? battleContestVariant.trainerCount : 5
      if (before.contestants.length >= contestantMaximum) rejectContest('contest.contestant-count', before.variantId === 'battle' ? 'A Battle Contest supports exactly two Trainer teams.' : 'A Contest supports at most five contestants.', { legalAlternatives: ['Remove a contestant before enrolling another.'] })
      if (before.contestants.some(row => row.contestantId === enrollment.contestantId || row.trainerSheetSlug === enrollment.trainerSheetSlug)) rejectContest('contest.duplicate-contestant', 'This contestant or Trainer is already enrolled.', { contestantId: enrollment.contestantId })
      const existingPokemon = new Set(before.contestants.flatMap(row => row.performers.filter(contestPerformerIsPokemon).map(performer => performer.pokemonSheetSlug)))
      if (enrollment.performers.filter(contestPerformerIsPokemon).some(performer => existingPokemon.has(performer.pokemonSheetSlug))) rejectContest('contest.duplicate-pokemon', 'A Pokémon may enroll only once.', { contestantId: enrollment.contestantId })
      const acceptedEnrollment = structuredClone(enrollment) as Mutable
      acceptedEnrollment.performerVoltages = before.participantVariantId === 'trainer-participant' && before.participantMethodId === 'simultaneous' ? Object.fromEntries(acceptedEnrollment.performers.map((performer: Mutable) => [performer.performerId, 0])) : {}
      if (before.variantId === 'battle') {
        const rosterSize = acceptedEnrollment.performers.filter((performer: Mutable) => performer.performerKind === 'pokemon').length
        const declared = before.battle?.declaredPokemonPerTrainer
        if (declared !== null && declared !== rosterSize) rejectContest('contest.battle-team-size', `Both Battle Contest teams must declare exactly ${declared} Pokémon.`, { legalAlternatives: [`Choose exactly ${declared} distinct eligible Pokémon.`], field: 'pokemonSheetSlugs' })
        next.battle.declaredPokemonPerTrainer = declared ?? rosterSize
        next.battle.roundBudget = (declared ?? rosterSize) * 2
      }
      next.contestants.push(acceptedEnrollment)
      history(next, before, { type: 'contestant-enrolled', contestantId: enrollment.contestantId, headline: `${enrollment.displayName} enrolled`, detail: `${enrollment.performers.length} performer${enrollment.performers.length === 1 ? '' : 's'} ready.`, operationId: command.operationId, createdAt: context.now }); break
    }
    case 'remove-contestant': {
      requireStage(before, 'setup'); contestantById(before, command.contestantId)
      next.contestants = next.contestants.filter((row: Mutable) => row.contestantId !== command.contestantId)
      if (before.variantId === 'battle' && next.contestants.length === 0) { next.battle.declaredPokemonPerTrainer = null; next.battle.roundBudget = null }
      history(next, before, { type: 'contestant-removed', contestantId: command.contestantId, headline: 'Contestant removed', detail: 'The pre-start enrollment was removed.', operationId: command.operationId, createdAt: context.now }); break
    }
    case 'start-introduction': {
      requireStage(before, 'setup')
      if (before.participantVariantId === 'trainer-participant' && before.participantMethodId === null) rejectContest('contest.method-required', 'Choose a canonical Trainer Participant method before locking setup.', { legalAlternatives: ['Select Simultaneous.', 'Select Alternating.'], field: 'participantMethodId', statusCode: 409 })
      if (before.variantId === 'battle') {
        const declared = before.battle?.declaredPokemonPerTrainer
        if (before.contestants.length !== battleContestVariant.trainerCount || declared === null || before.contestants.some(row => row.performers.filter(contestPerformerIsPokemon).length !== declared)) rejectContest('contest.contestant-count', 'Start requires exactly two Trainer teams with the same declared roster of three through six Pokémon.', { legalAlternatives: ['Enroll both complete, equally sized teams.'] })
      } else if (before.contestants.length < 3 || before.contestants.length > 5) rejectContest('contest.contestant-count', 'Start requires three through five contestants.', { legalAlternatives: ['Enroll additional contestants.'] })
      if (before.variantId === 'rotation' && before.contestants.some(row => row.performers.filter(contestPerformerIsPokemon).length !== before.contestants.length || (before.policy.rotationOrderPolicy === 'predeclared' ? row.rotationOrder.length !== before.contestants.length : row.rotationOrder.length !== 0))) rejectContest('contest.rotation-team-size', `A ${before.contestants.length}-contestant Rotation Contest needs exactly ${before.contestants.length} distinct Pokémon performers and a ${before.policy.rotationOrderPolicy === 'predeclared' ? 'complete predeclared' : 'round-by-round'} order.`, { legalAlternatives: ['Adjust the lineup before locking enrollment.'] })
      assertContestStageTransition('setup', 'introduction'); next.stage = 'introduction'; next.policy.lockedAt = context.now
      history(next, before, { type: 'introduction-started', headline: 'Introduction stage', detail: 'Each Trainer chooses one canonical introduction skill.', operationId: command.operationId, createdAt: context.now }); break
    }
    case 'declare-introduction': {
      requireStage(before, 'introduction'); requireRunning(before)
      const source = contestantById(before, command.contestantId)
      if (source.introduction.status === 'accepted') rejectContest('contest.resource-exhausted', 'This Introduction has already been accepted.', { contestantId: source.contestantId })
      const execution = context.introduction ?? (() => { throw new Error('Introduction execution context is required.') })()
      const mapped = contestCatalog.contestStats.find(row => row.introductionSkillId === command.skillId)!.id
      if (command.generatedStatId !== mapped && !execution.graceFlexible) rejectContest('contest.option-not-offered', 'Without Grace, this skill generates only its mapped Contest stat.', { contestantId: source.contestantId, legalAlternatives: [mapped], field: 'generatedStatId' })
      const baseJournal = rollContestDice({ contestId: before.contestId, diceJournal: next.diceJournal }, { operationId: command.operationId, purpose: 'introduction', contestantId: source.contestantId, round: null, count: execution.skillDice, dieSides: 6, createdAt: context.now }, context.random)
      appendJournal(next, baseJournal)
      const bonusDice = execution.bonusRolls.reduce((sum, roll) => sum + roll.dice, 0)
      const bonusJournal = rollContestDice({ contestId: before.contestId, diceJournal: next.diceJournal }, { operationId: command.operationId, purpose: 'introduction-bonus', contestantId: source.contestantId, round: null, count: bonusDice, dieSides: 6, createdAt: context.now }, context.random)
      appendJournal(next, bonusJournal)
      const results = [...baseJournal.results, ...bonusJournal.results]
      const effectiveResults = (values: readonly number[]): readonly number[] => execution.uglySixesCountAsOnes ? values.map(value => value === 6 ? 1 : value) : values
      const successes = (values: readonly number[]): number => effectiveResults(values).filter(value => contestCatalog.introduction.successFaces.includes(value)).length
      const allocations: Array<{ sourceId: string, label: string, statId: ContestStatId, dice: number, results: readonly number[], generated: number }> = [{ sourceId: 'skill', label: command.skillId, statId: command.generatedStatId, dice: execution.skillDice, results: baseJournal.results, generated: successes(baseJournal.results) }]
      let bonusOffset = 0
      for (const roll of execution.bonusRolls) {
        const rollResults = bonusJournal.results.slice(bonusOffset, bonusOffset + roll.dice); bonusOffset += roll.dice
        allocations.push({ ...roll, results: rollResults, generated: successes(rollResults) })
      }
      const generatedDice = allocations.reduce((sum, allocation) => sum + allocation.generated, 0)
      const matching = before.variantId === 'standard' && mapped === before.contestTypeId
      const bonusAppeal = matching ? contestCatalog.introduction.standardMatchingAppealBonus : 0
      const row = (next.contestants as Mutable[]).find(candidate => candidate.contestantId === source.contestantId)!
      row.introduction = { status: 'accepted', performerId: source.introduction.performerId, skillId: command.skillId, generatedStatId: command.generatedStatId, skillRankDice: execution.skillDice, bonusDice, results, generatedDice, matchingAppealBonus: bonusAppeal, letterTotal: before.variantId === 'battle' ? 0 : generatedDice + (matching ? contestCatalog.introduction.standardMatchingLetterTotalBonus : 0), operationId: command.operationId }
      row.appeal += bonusAppeal
      const allocationLabels = allocations.filter(allocation => allocation.dice > 0).map(allocation => `${allocation.label} ${allocation.dice}d6 → ${allocation.generated} ${allocation.statId}`)
      for (const allocation of allocations.filter(candidate => candidate.generated > 0)) {
        const explanation = `${allocation.label} rolled ${allocation.dice}d6 and generated ${allocation.generated} ${allocation.statId} dice.${before.variantId === 'rotation' ? ' These are shared team dice; total Rotation spending remains capped separately.' : before.variantId === 'battle' ? ' These belong to the Trainer team and may be spent by any enrolled team Pokémon.' : ''}`
        const contribution = { id: `introduction:${command.operationId}:${allocation.sourceId}`, kind: 'introduction', statId: allocation.statId, dice: allocation.generated, active: true, label: allocation.label, sourceId: command.operationId, explanation }
        const pools = before.variantId === 'rotation' || before.variantId === 'battle' ? [row.teamDicePools[allocation.statId]] : row.performers.filter((performer: Mutable) => before.participantVariantId !== 'trainer-participant' || performer.performerKind === 'pokemon').map((performer: Mutable) => performer.dicePools[allocation.statId])
        for (const pool of pools) { pool.total += allocation.generated; pool.remaining += allocation.generated; pool.contributors = [...pool.contributors, contribution] }
      }
      history(next, before, { type: 'introduction-accepted', contestantId: source.contestantId, headline: `${source.displayName} introduced`, detail: `${results.length}d6 generated ${generatedDice} Contest Stat dice${bonusAppeal ? ` and +${bonusAppeal} Appeal` : ''}.`, operationId: command.operationId, createdAt: context.now })
      history(next, before, { type: 'introduction-evidence', visibility: 'owner', contestantId: source.contestantId, headline: 'Introduction roll evidence', detail: allocationLabels.join('; '), operationId: command.operationId, createdAt: context.now })
      if ((next.contestants as Mutable[]).every(candidate => candidate.introduction.status === 'accepted')) {
        if (before.variantId === 'battle') history(next, before, { type: 'battle-team-pools-ready', headline: 'Battle team pools ready', detail: 'Both Trainer Introductions are accepted without changing encounter initiative.', operationId: command.operationId, createdAt: context.now })
        else assignLetters(before, next, command.operationId, context.now, context.random)
      }
      break
    }
    case 'restart-introduction': {
      requireStage(before, 'introduction')
      for (const row of next.contestants as Mutable[]) {
        const accepted = row.introduction
        if (accepted.status === 'accepted' && accepted.generatedStatId && accepted.operationId) {
          let removed = false
          for (const statId of CONTEST_STAT_IDS) {
            const pools = before.variantId === 'rotation' || before.variantId === 'battle' ? [row.teamDicePools[statId]] : row.performers.filter((performer: Mutable) => before.participantVariantId !== 'trainer-participant' || performer.performerKind === 'pokemon').map((performer: Mutable) => performer.dicePools[statId])
            for (const pool of pools) {
              const contributions = pool.contributors.filter((entry: Mutable) => entry.sourceId === accepted.operationId || entry.id === `introduction:${accepted.operationId}`)
              const contributedDice = contributions.reduce((sum: number, entry: Mutable) => sum + Math.max(0, Number(entry.dice) || 0), 0)
              if (contributions.length) removed = true
              pool.total = Math.max(0, pool.total - contributedDice); pool.remaining = Math.max(0, pool.remaining - contributedDice)
              pool.contributors = pool.contributors.filter((entry: Mutable) => entry.sourceId !== accepted.operationId && entry.id !== `introduction:${accepted.operationId}`)
            }
          }
          // Compatibility with an early schema-v1 snapshot that omitted contributor provenance.
          if (!removed) {
            const pools = before.variantId === 'rotation' || before.variantId === 'battle' ? [row.teamDicePools[accepted.generatedStatId]] : row.performers.filter((performer: Mutable) => before.participantVariantId !== 'trainer-participant' || performer.performerKind === 'pokemon').map((performer: Mutable) => performer.dicePools[accepted.generatedStatId])
            for (const pool of pools) { pool.total = Math.max(0, pool.total - accepted.generatedDice); pool.remaining = Math.max(0, pool.remaining - accepted.generatedDice) }
          }
        }
        row.introduction = { status: 'pending', performerId: accepted.performerId, skillId: null, generatedStatId: null, skillRankDice: 0, bonusDice: 0, results: [], generatedDice: 0, matchingAppealBonus: 0, letterTotal: 0, operationId: null }; row.appeal = 0; row.letter = null
      }
      // Journal evidence is immutable; the superseded rolls remain diagnostic.
      history(next, before, { type: 'introduction-restarted', headline: 'Introduction restarted', detail: 'Prior journaled evidence remains in provenance; fresh declarations are required.', operationId: command.operationId, createdAt: context.now }); break
    }
    case 'create-battle-encounter': {
      requireStage(before, 'introduction'); requireRunning(before)
      if (before.variantId !== 'battle') rejectContest('contest.option-not-offered', 'Encounter linking is available only to Battle Contests.', { statusCode: 409 })
      if (before.battle?.encounter) rejectContest('contest.resource-exhausted', 'This Battle Contest already has its immutable linked encounter.', { statusCode: 409 })
      if (before.contestants.length !== battleContestVariant.trainerCount || before.contestants.some(row => row.introduction.status !== 'accepted')) rejectContest('contest.stage-mismatch', 'Both Trainer Introductions must be accepted before encounter linking.', { legalAlternatives: ['Complete both Trainer Introductions.'], statusCode: 409 })
      const binding = context.battleEncounter ?? (() => { throw new Error('Battle Encounter binding context is required.') })()
      if (binding.link.contestId !== before.contestId) throw new Error('Battle Encounter binding/Contest identity mismatch.')
      assertContestStageTransition('introduction', 'performance')
      next.battle.encounter = structuredClone(binding)
      next.stage = 'performance'; next.round = 1; next.turnIndex = 0; next.currentRoundContestTypeId = before.contestTypeId
      history(next, before, { type: 'battle-encounter-linked', headline: 'Battle encounter linked', detail: 'Opening placement, Encounter initiative, Scene, reserves, and turn order are active under existing Encounter authority.', operationId: command.operationId, createdAt: context.now })
      break
    }
    case 'start-performance': {
      requireStage(before, 'introduction'); requireRunning(before)
      if (before.variantId === 'battle') rejectContest('contest.stage-mismatch', 'Battle Performance begins only after the existing encounter authority is created and linked.', { legalAlternatives: ['Create and link the Battle encounter.'], statusCode: 409 })
      if (before.contestants.some(row => row.introduction.status !== 'accepted' || row.letter === null)) rejectContest('contest.stage-mismatch', 'Every Introduction and letter must be accepted first.', { legalAlternatives: ['Complete pending Introduction decisions.'] })
      assertContestStageTransition('introduction', 'performance'); next.stage = 'performance'; next.round = 1; next.turnIndex = 0
      if (before.variantId === 'supercontest' || (before.variantId === 'festival' && before.policy.supercontestFestival)) rollSupercontestType(next, before, command.operationId, 1, context.now, context.random)
      history(next, before, { type: 'performance-started', headline: 'Performance stage', detail: 'Round 1 begins from the canonical position chart.', operationId: command.operationId, createdAt: context.now }); break
    }
    case 'select-rotation-performer': {
      requireStage(before, 'performance'); requireRunning(before)
      if (before.variantId !== 'rotation' || before.policy.rotationOrderPolicy !== 'choose-each-round') rejectContest('contest.option-not-offered', 'This Contest uses a predeclared performer order.', { contestantId: command.contestantId })
      const currentCandidate = contestCurrentContestant(before)
      if (!currentCandidate) return rejectContest('contest.wrong-turn', 'No Rotation team currently has the turn.', { contestantId: command.contestantId, statusCode: 409 })
      const current = currentCandidate
      if (current.contestantId !== command.contestantId) rejectContest('contest.wrong-turn', 'Only the current Rotation team may select its performer.', { contestantId: command.contestantId, statusCode: 409 })
      if (current.rotationOrder[before.round - 1] !== undefined) rejectContest('contest.resource-exhausted', 'This round’s Rotation performer is already locked.', { contestantId: command.contestantId })
      const performerIndex = current.performers.findIndex(row => row.performerId === command.performerId)
      if (performerIndex < 0 || current.rotationOrder.includes(performerIndex)) rejectContest('contest.option-not-offered', 'Choose an unused performer from this Rotation team.', { contestantId: command.contestantId, legalAlternatives: current.performers.flatMap((row, index) => current.rotationOrder.includes(index) ? [] : [row.performerId]) })
      const actor = (next.contestants as Mutable[]).find(row => row.contestantId === current.contestantId)!
      actor.rotationOrder[before.round - 1] = performerIndex
      history(next, before, { type: 'rotation-performer-selected', contestantId: actor.contestantId, headline: `${actor.performers[performerIndex].displayName} takes the stage`, detail: `The round ${before.round} Rotation performer is locked.`, operationId: command.operationId, createdAt: context.now }); break
    }
    case 'declare-appeal': {
      if (before.variantId === 'battle') rejectContest('contest.option-not-offered', 'Battle Appeals are scored only from typed accepted Encounter Move results.', { statusCode: 409 })
      declareAppeal(before, next, command, context); break
    }
    case 'use-intervention': useIntervention(before, next, command, context); break
    case 'pass-intervention': passIntervention(before, next, command, context); break
    case 'set-paused': {
      requireStage(before, 'introduction', 'performance', 'settling'); next.paused = command.paused
      history(next, before, { type: command.paused ? 'contest-paused' : 'contest-resumed', headline: command.paused ? 'Contest paused' : 'Contest resumed', detail: command.paused ? 'Authoritative decisions are temporarily blocked.' : 'Authoritative decisions may continue.', operationId: command.operationId, createdAt: context.now }); break
    }
    case 'apply-correction': {
      requireStage(before, 'introduction', 'performance', 'settling')
      if (command.correctionKind === 'cancel-contest') {
        assertContestStageTransition(before.stage, 'cancelled'); next.stage = 'cancelled'; next.cancellationReason = command.reason; next.paused = false; cleanupContestScope(next)
        next.corrections.push({ correctionId: `${before.contestId}:correction:${next.corrections.length + 1}`, operationId: command.operationId, contestantId: null, performerId: null, kind: command.correctionKind, reason: command.reason, numericDelta: null, statId: null, priorValue: before.stage, nextValue: 'cancelled', createdAt: context.now })
      }
      else {
        const rowCandidate = command.contestantId ? (next.contestants as Mutable[]).find(candidate => candidate.contestantId === command.contestantId) : null
        if (!rowCandidate) return rejectContest('contest.option-not-offered', 'Choose an enrolled contestant for this correction.', {})
        const row = rowCandidate
        const delta = Number(command.numericDelta)
        if (command.correctionKind === 'voltage-delta' && simultaneousParticipant(before)) rejectContest('contest.correction-out-of-bounds', 'Simultaneous Voltage corrections require an exact performer identity and are unavailable through the shared-entry correction command.', { contestantId: command.contestantId, legalAlternatives: ['Record an explanatory correction without changing Voltage.', 'Cancel and rerun if performer Voltage authority is corrupt.'], field: 'correctionKind' })
        if (before.variantId !== 'battle' && command.performerId != null) rejectContest('contest.correction-out-of-bounds', 'Exact Pokémon correction targets are available only to Battle Voltage authority.', { contestantId: command.contestantId, field: 'performerId' })
        if (!Number.isInteger(delta) || Math.abs(delta) > contestCatalog.corrections.maximumAbsoluteNumericDelta) rejectContest('contest.correction-out-of-bounds', `Correction must be within ±${contestCatalog.corrections.maximumAbsoluteNumericDelta}.`, { field: 'numericDelta' })
        let prior: number|string|null = null; let after: number|string|null = null
        if (command.correctionKind === 'appeal-delta') { prior = row.appeal; row.appeal = Math.max(0, row.appeal + delta); after = row.appeal }
        if (command.correctionKind === 'fumble-delta') { prior = row.fumble; row.fumble = Math.max(0, row.fumble + delta); after = row.fumble }
        if (command.correctionKind === 'voltage-delta') {
          if (before.variantId === 'battle') {
            const performerId = command.performerId
            if (!performerId || !row.performers.some((performer: Mutable) => performer.performerKind === 'pokemon' && performer.performerId === performerId)) rejectContest('contest.correction-out-of-bounds', 'Choose one exact enrolled Pokémon on this Trainer team for a Battle Voltage correction.', { contestantId: command.contestantId, field: 'performerId' })
            prior = row.performerVoltages[performerId!]
            row.performerVoltages[performerId!] = cappedVoltage(Number(prior) + delta)
            after = row.performerVoltages[performerId!]
          } else { prior = row.voltage; row.voltage = cappedVoltage(row.voltage + delta); after = row.voltage }
        }
        if (command.correctionKind === 'dice-pool-delta') {
          if (!command.statId) return rejectContest('contest.correction-out-of-bounds', 'Choose a Contest stat pool.', { field: 'statId' })
          const statId = command.statId
          const pool = before.variantId === 'rotation' || before.variantId === 'battle' ? row.teamDicePools[statId] : row.performers.find((performer: Mutable) => performer.performerKind === 'pokemon').dicePools[statId]; prior = pool.remaining
          const corrected = Math.max(0, Math.min(pool.total, pool.remaining + delta))
          pool.remaining = corrected
          after = corrected
        }
        if (command.correctionKind === 'controller-reassignment') { prior = row.controller.kind === 'profile' ? row.controller.profileId : 'gm'; row.controller = command.replacementProfileId ? { kind: 'profile', profileId: command.replacementProfileId } : { kind: 'gm' }; after = command.replacementProfileId ?? 'gm' }
        if (before.stage === 'settling' && (command.correctionKind === 'appeal-delta' || command.correctionKind === 'fumble-delta')) {
          if (before.variantId === 'festival' && row.withdrawn) rejectContest('contest.correction-out-of-bounds', 'A completed Festival elimination cannot be reordered by a post-performance numeric correction.', { contestantId: row.contestantId, legalAlternatives: ['Record an explanatory correction without changing fixed elimination placement.'] })
          for (const contestant of next.contestants as Mutable[]) contestant.finalScore = before.variantId === 'battle' ? contestant.appeal : contestant.appeal - contestant.fumble
          const tieSignatures = (rows: readonly ContestantStateV1[]): Set<string> => {
            const byScore = new Map<number, string[]>()
            for (const candidate of rows.filter(contestant => !contestant.withdrawn)) byScore.set(Number(candidate.finalScore), [...(byScore.get(Number(candidate.finalScore)) ?? []), String(candidate.contestantId)])
            return new Set([...byScore.values()].filter(ids => ids.length > 1).map(ids => ids.sort().join(',')))
          }
          const priorTies = tieSignatures(before.contestants), nextTies = tieSignatures(next.contestants)
          if ([...nextTies].some(signature => !priorTies.has(signature))) rejectContest('contest.correction-out-of-bounds', 'This numeric correction would create a new final-score tie without journaled placement evidence.', { contestantId: row.contestantId, legalAlternatives: ['Choose a delta that leaves final scores distinct.', 'Cancel and rerun the Contest if placement tie authority must be regenerated.'] })
          const activeRows = (next.contestants as Mutable[]).filter(contestant => !contestant.withdrawn).sort((left, right) => right.finalScore - left.finalScore || Number(left.finalPlacement ?? 999) - Number(right.finalPlacement ?? 999) || String(left.contestantId).localeCompare(String(right.contestantId)))
          activeRows.forEach((contestant, index) => { contestant.finalPlacement = index + 1 })
          next.settlement = null
        }
        next.corrections.push({ correctionId: `${before.contestId}:correction:${next.corrections.length + 1}`, operationId: command.operationId, contestantId: command.contestantId, performerId: before.variantId === 'battle' && command.correctionKind === 'voltage-delta' ? command.performerId ?? null : null, kind: command.correctionKind, reason: command.reason, numericDelta: command.numericDelta, statId: command.statId, priorValue: prior, nextValue: after, createdAt: context.now })
      }
      history(next, before, { type: 'contest-corrected', headline: 'GM correction recorded', detail: command.reason, operationId: command.operationId, createdAt: context.now }); break
    }
    case 'declare-prize': {
      requireStage(before, 'setup', 'settling'); requireRunning(before)
      if (before.policy.prize.declared) rejectContest('contest.resource-exhausted', 'This prize package is already declared.', { statusCode: 409 })
      next.policy.prize = normalizeContestPrize({ ...before.policy.prize, declared: true })
      history(next, before, { type: 'prize-declared', headline: 'Prize package declared', detail: `${next.policy.prize.money} money and ${next.policy.prize.items.length} item write${next.policy.prize.items.length === 1 ? '' : 's'} are ready for settlement review.`, operationId: command.operationId, createdAt: context.now }); break
    }
    case 'prepare-settlement': requireRunning(before); prepareSettlement(before, next, command.operationId, context.now); break
    case 'commit-settlement': {
      requireStage(before, 'settling'); requireRunning(before)
      if (!before.settlement || before.settlement.status !== 'preview') rejectContest('contest.settlement-not-ready', 'Prepare and review settlement before commit.', { legalAlternatives: ['Prepare settlement.'] })
      if (before.variantId === 'battle') {
        const coordination = context.battleSettlementCoordination
          ? parseBattleContestSettlementCoordination(context.battleSettlementCoordination)
          : (() => { throw new Error('Battle Contest settlement requires one accepted combined Encounter settlement receipt.') })()
        if (coordination.status !== 'accepted' || coordination.contestId !== before.contestId
          || coordination.battleContestLinkId !== before.battle?.encounter?.link.linkId
          || coordination.acceptedByContestOperationId !== command.operationId
          || coordination.preparedByContestOperationId !== before.settlement!.battleCoordination?.preparedByContestOperationId) {
          throw new Error('Battle Contest settlement receipt does not match the prepared Contest-local transition.')
        }
        next.settlement.battleCoordination = coordination
      }
      next.settlement.status = 'committed'; next.settlement.committedOperationId = command.operationId; next.settlement.committedAt = context.now
      assertContestStageTransition('settling', 'completed'); next.stage = 'completed'; next.paused = false
      cleanupContestScope(next)
      history(next, before, { type: 'contest-completed', headline: 'Contest settled', detail: 'Placements, experience, ribbons, and prizes committed atomically.', operationId: command.operationId, createdAt: context.now }); break
    }
    case 'cancel-contest': {
      if (before.stage === 'completed' || before.stage === 'cancelled') rejectContest('contest.stage-mismatch', 'A terminal Contest cannot be cancelled again.', { statusCode: 409 })
      assertContestStageTransition(before.stage, 'cancelled'); next.stage = 'cancelled'; next.cancellationReason = command.reason; next.paused = false; cleanupContestScope(next)
      history(next, before, { type: 'contest-cancelled', headline: 'Contest cancelled', detail: command.reason, operationId: command.operationId, createdAt: context.now }); break
    }
  }
  const recoveryCommand = command.commandKind === 'set-paused' || command.commandKind === 'apply-correction' || command.commandKind === 'cancel-contest'
  if (before.variantId === 'battle' && before.battle?.encounter && recoveryCommand) {
    const receipt = context.battleRecovery ?? (() => { throw new Error('Linked Battle recovery requires one coordinator-owned receipt.') })()
    if (receipt.operationId !== command.operationId || receipt.linkId !== before.battle.encounter.link.linkId
      || receipt.contestRevisionBefore !== before.revision || receipt.contestRevisionAfter !== before.revision + 1
      || receipt.contestPausedBefore !== before.paused || receipt.contestPausedAfter !== Boolean(next.paused)) throw new Error('Battle recovery receipt does not match the Contest-local transition.')
    next.battleRecoveryReceipts.push(receipt)
    history(next, before, {
      type: 'battle-recovery-coordinated',
      visibility: 'public',
      headline: receipt.kind === 'pause' ? 'Battle Contest paused' : receipt.kind === 'resume' ? 'Battle Contest resumed' : receipt.kind === 'cancel' ? 'Battle Contest safely cancelled' : 'Battle Contest correction coordinated',
      detail: receipt.kind === 'correction' ? 'The bounded correction committed while both linked authorities remained paused.' : receipt.kind === 'cancel' ? 'Contest scoring closed while the linked encounter stopped at a safe paused boundary.' : `Contest and linked encounter authority moved to ${receipt.kind === 'pause' ? 'paused' : 'active'} together.`,
      operationId: command.operationId,
      createdAt: context.now,
    })
  }
  return finish(before, next, context.now)
}

export const createContestantState = (input: Omit<ContestantStateV1, 'introductionSkillDice'|'introduction'|'appeal'|'fumble'|'voltage'|'performerVoltages'|'letter'|'lastMoveOptionId'|'usedInterventionIds'|'teamDicePools'|'sharedDiceSpendJournal'|'battleTeamDiceSpendJournal'|'teamContestDiceSpent'|'pendingEffects'|'withdrawn'|'finalPlacement'|'finalScore'> & { readonly introductionSkillDice?: ContestantStateV1['introductionSkillDice'], readonly teamDicePools?: ContestantStateV1['teamDicePools'], readonly sharedDiceSpendJournal?: ContestantStateV1['sharedDiceSpendJournal'], readonly battleTeamDiceSpendJournal?: ContestantStateV1['battleTeamDiceSpendJournal'], readonly performerVoltages?: ContestantStateV1['performerVoltages'] }): ContestantStateV1 => Object.freeze({
  ...input,
  letter: null,
  introductionSkillDice: input.introductionSkillDice ?? Object.freeze({ charm: 2, command: 2, guile: 2, intimidate: 2, intuition: 2 }),
  introduction: Object.freeze({ status: 'pending', performerId: input.performers.find(performer => performer.performerKind === 'trainer')?.performerId ?? null, skillId: null, generatedStatId: null, skillRankDice: 0, bonusDice: 0, results: Object.freeze([]), generatedDice: 0, matchingAppealBonus: 0, letterTotal: 0, operationId: null }),
  appeal: 0, fumble: 0, voltage: 0, performerVoltages: input.performerVoltages ?? Object.freeze({}), lastMoveOptionId: null, usedInterventionIds: Object.freeze([]),
  teamDicePools: input.teamDicePools ?? Object.freeze(emptyContestStatRecord(() => Object.freeze({ total: 0, remaining: 0, contributors: Object.freeze([]) }))),
  sharedDiceSpendJournal: input.sharedDiceSpendJournal ?? Object.freeze([]), battleTeamDiceSpendJournal: input.battleTeamDiceSpendJournal ?? Object.freeze([]), teamContestDiceSpent: 0,
  pendingEffects: pendingDefaults(), withdrawn: false, finalPlacement: null, finalScore: null,
})
