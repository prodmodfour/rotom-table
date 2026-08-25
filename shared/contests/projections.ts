import { contestCatalog, contestChart } from './catalog'
export { explainContestTypeRelationship } from './typeRelationship'
import { contestActiveContestants, contestCurrentContestant, contestCurrentPerformer, contestPerformerIsPokemon, contestPerformerIsTrainer, type ContestAppealLedgerEntryV1, type ContestDocumentV1, type ContestantStateV1 } from './document'
import { resolveTrainerParticipantMethodTurn, type ContestParticipantPerformerKind } from './participantMethods'
import type { ContestLetter, ContestStatId } from './ids'

export interface ContestPositionProjectionV1 {
  readonly contestantId: string
  readonly position: number
  readonly turnNumber: number
  readonly adjacentContestantIds: readonly string[]
  readonly centerOfAttention: boolean
}
export interface ContestPublicPerformerProjectionV1 {
  readonly performerKind: 'trainer' | 'pokemon'
  readonly displayName: string
  readonly portraitUrl: string | null
  readonly activePerformer: boolean
  readonly voltage: number
}
export interface ContestScoreboardRowProjectionV1 {
  readonly contestantId: string
  readonly displayName: string
  /** Compatibility label for ordinary Pokémon-only scoreboards. */
  readonly pokemonName: string
  readonly portraitUrl: string | null
  /** Public paired identity and per-performer Voltage; never includes sheet or provider authority. */
  readonly performers: readonly ContestPublicPerformerProjectionV1[]
  readonly letter: ContestLetter | null
  readonly appeal: number
  readonly fumble: number
  readonly finalScore: number
  readonly voltage: number
  readonly active: boolean
  readonly placement: number | null
  readonly position: ContestPositionProjectionV1 | null
}
export type ContestPublicHistoryProjectionV1 = Omit<ContestDocumentV1['history'][number], 'operationId'>
/** Public consequence keeps visible score arithmetic but omits sheet-derived performer identity. */
export type ContestPublicAppealConsequenceProjectionV1 = Omit<ContestAppealLedgerEntryV1['consequences'][number], 'performerId'>
/** Public contributor keeps arithmetic and labels but omits provider/implementation identity. */
export type ContestPublicAppealContributorProjectionV1 = Omit<ContestAppealLedgerEntryV1['contributors'][number], 'id'>
/** Public accepted result omits operation, journal, correction, option, provider, and performer authority. */
export type ContestPublicAppealProjectionV1 = Omit<ContestAppealLedgerEntryV1,
  'operationId' | 'journalIds' | 'correctionIds' | 'performerId' | 'moveOptionId' | 'partnerEffectTargetPerformerId' | 'adjacentPerformerIds' | 'contributors' | 'consequences'
> & {
  readonly contributors: readonly ContestPublicAppealContributorProjectionV1[]
  readonly consequences: readonly ContestPublicAppealConsequenceProjectionV1[]
}

/** Role-safe reward summary. Exact sheets, operation IDs, attention IDs, and combined evidence stay diagnostic-only. */
export interface ContestPublicSettlementProjectionV1 {
  readonly status: 'preview' | 'committed'
  readonly entries: readonly {
    readonly contestantId: string
    readonly placement: number
    readonly finalScore: number
    readonly experienceByPokemon: readonly { readonly experience: number }[]
    readonly ribbon: boolean
  }[]
  readonly money: number
  readonly items: readonly {
    readonly itemId: string
    readonly quantity: number
    readonly targetContestantId: string | null
  }[]
  readonly attentionItemCount: number
}

export interface ContestPublicBattleProjectionV1 {
  readonly declaredPokemonPerTrainer: number | null
  readonly roundBudget: number | null
  readonly encounter: null | {
    readonly status: 'linked'
    readonly encounterId: string
    readonly mapSlug: string
    readonly openingRound: 1
    readonly deployedCount: number
    readonly readyReserveCount: number
  }
}

export interface ContestPublicProjectionV1 {
  readonly schemaVersion: 1
  readonly contestId: string
  readonly revision: number
  readonly updatedAt: number
  readonly display: ContestDocumentV1['display']
  readonly variantId: ContestDocumentV1['variantId']
  /** Public Battle counters and safe cockpit destination; never contains blend hashes, sheets, providers, or consent authority. */
  readonly battle: ContestPublicBattleProjectionV1 | null
  readonly participantVariantId: ContestDocumentV1['participantVariantId']
  readonly participantMethodId: ContestDocumentV1['participantMethodId']
  readonly rotationOrderPolicy: ContestDocumentV1['policy']['rotationOrderPolicy']
  readonly supercontestFestival: boolean
  readonly contestTypeId: ContestStatId | null
  readonly currentRoundContestTypeId: ContestStatId | null
  readonly stage: ContestDocumentV1['stage']
  readonly paused: boolean
  readonly round: number
  readonly turnIndex: number
  readonly activeContestantId: string | null
  readonly pendingInterventionAppealId: string | null
  readonly festivalHeat: number
  readonly scoreboard: readonly ContestScoreboardRowProjectionV1[]
  readonly acceptedAppeals: readonly ContestPublicAppealProjectionV1[]
  readonly history: readonly ContestPublicHistoryProjectionV1[]
  readonly declaredPrize: ContestDocumentV1['policy']['prize'] | null
  readonly settlement: ContestPublicSettlementProjectionV1 | null
  readonly cancellationReason: string | null
}
export interface ContestOwnerProjectionV1 extends ContestPublicProjectionV1 {
  readonly audience: 'owner'
  readonly ownerContestantId: string
  readonly ownContestant: ContestantStateV1
  /** Exact accepted Appeal authority for this owner entry only. */
  readonly ownAcceptedAppeals: ContestDocumentV1['appealLedger']
  readonly ownCurrentPerformerId: string | null
  readonly ownLegalPerformerIds: readonly string[]
  readonly ownsCurrentDecision: boolean
}
export interface ContestGmProjectionV1 extends Omit<ContestPublicProjectionV1, 'history' | 'acceptedAppeals'> {
  readonly audience: 'gm' | 'diagnostic'
  /** Exact current action authority; omitted from public projections. */
  readonly currentLegalPerformerIds: readonly string[]
  readonly history: ContestDocumentV1['history']
  readonly acceptedAppeals: ContestDocumentV1['appealLedger']
  readonly contestants: readonly ContestantStateV1[]
  readonly policy: ContestDocumentV1['policy']
  readonly gmNotes: string
  readonly corrections: ContestDocumentV1['corrections']
}
export interface ContestDiagnosticProjectionV1 extends ContestGmProjectionV1 {
  readonly audience: 'diagnostic'
  /** Exact sheet, operation, attention, and combined settlement authority. */
  readonly diagnosticSettlement: ContestDocumentV1['settlement']
  readonly acceptedAppeals: ContestDocumentV1['appealLedger']
  readonly diceJournal: ContestDocumentV1['diceJournal']
  /** GM diagnostic-only source hashes and at-most-once Battle handoff receipts. */
  readonly battleHandoffReceipts: ContestDocumentV1['battleHandoffReceipts']
  readonly battleVoltageLifecycleLedger: ContestDocumentV1['battleVoltageLifecycleLedger']
  readonly battleRecoveryReceipts: ContestDocumentV1['battleRecoveryReceipts']
  readonly catalogId: string
  readonly contributorIndex: Readonly<Record<string, readonly { readonly id: string, readonly dice: number, readonly explanation: string }[]>>
}
export type ContestRoleProjectionV1 = ContestPublicProjectionV1 | ContestOwnerProjectionV1 | ContestGmProjectionV1 | ContestDiagnosticProjectionV1

const publicHistory = (rows: ContestDocumentV1['history']): readonly ContestPublicHistoryProjectionV1[] => Object.freeze(rows.map(({ operationId: _operationId, ...row }) => Object.freeze(row)))
const publicSettlement = (document: ContestDocumentV1): ContestPublicSettlementProjectionV1 | null => {
  const settlement = document.settlement
  if (!settlement) return null
  const contestantIdByTrainer = new Map(document.contestants.map(contestant => [contestant.trainerSheetSlug, contestant.contestantId]))
  return Object.freeze({
    status: settlement.status,
    entries: Object.freeze(settlement.entries.map(entry => Object.freeze({
      contestantId: entry.contestantId,
      placement: entry.placement,
      finalScore: entry.finalScore,
      experienceByPokemon: Object.freeze(entry.experienceByPokemon.map(award => Object.freeze({ experience: award.experience }))),
      ribbon: entry.ribbon,
    }))),
    money: settlement.money,
    items: Object.freeze(settlement.items.map(item => Object.freeze({
      itemId: item.itemId,
      quantity: item.quantity,
      targetContestantId: item.targetTrainerSlug === null ? null : contestantIdByTrainer.get(item.targetTrainerSlug) ?? null,
    }))),
    attentionItemCount: settlement.attentionItemIds.length,
  })
}
const publicConsequences = (rows: ContestAppealLedgerEntryV1['consequences']): readonly ContestPublicAppealConsequenceProjectionV1[] => {
  const aggregate = new Map<string, { contestantId: string, appealDelta: number, fumbleDelta: number, voltageDelta: number, reason: string }>()
  for (const { performerId: _performerId, ...row } of rows) {
    const key = `${row.contestantId}:${row.reason}`
    const existing = aggregate.get(key)
    if (existing) {
      existing.appealDelta += row.appealDelta
      existing.fumbleDelta += row.fumbleDelta
      existing.voltageDelta += row.voltageDelta
    } else aggregate.set(key, { ...row })
  }
  return Object.freeze([...aggregate.values()].map(row => Object.freeze(row)))
}
const publicAppeals = (rows: ContestDocumentV1['appealLedger']): readonly ContestPublicAppealProjectionV1[] => Object.freeze(rows.map(({
  operationId: _operationId,
  journalIds: _journalIds,
  correctionIds: _correctionIds,
  performerId: _performerId,
  moveOptionId: _moveOptionId,
  partnerEffectTargetPerformerId: _partnerEffectTargetPerformerId,
  adjacentPerformerIds: _adjacentPerformerIds,
  contributors,
  consequences,
  ...row
}) => Object.freeze({
  ...row,
  contributors: Object.freeze(contributors.map(({ id: _id, ...contributor }) => Object.freeze(contributor))),
  consequences: publicConsequences(consequences),
})))

const positionMap = (document: ContestDocumentV1): ReadonlyMap<string, ContestPositionProjectionV1> => {
  const active = contestActiveContestants(document)
  if (document.round < 1 || active.length < 3 || active.length > 5) return new Map()
  const chart = contestChart(active.length)
  const round = chart.rounds[Math.min(document.round, chart.rounds.length) - 1]
  if (!round) return new Map()
  const byLetter = new Map(active.map(row => [row.letter, row]))
  const positions = round.lineup.map((letter, index) => ({ contestant: byLetter.get(letter as ContestLetter), index })).filter((row): row is { contestant: ContestantStateV1, index: number } => Boolean(row.contestant))
  return new Map(positions.map(({ contestant, index }) => [contestant.contestantId, Object.freeze({
    contestantId: contestant.contestantId,
    position: index,
    turnNumber: chart.positionTurnNumbers[index]!,
    adjacentContestantIds: Object.freeze(positions.filter(other => Math.abs(other.index - index) === 1).map(other => other.contestant.contestantId)),
    centerOfAttention: index === chart.centerPosition,
  })]))
}

const publicBattleProjection = (document: ContestDocumentV1): ContestPublicBattleProjectionV1 | null => {
  if (!document.battle) return null
  const binding = document.battle.encounter
  return Object.freeze({
    declaredPokemonPerTrainer: document.battle.declaredPokemonPerTrainer,
    roundBudget: document.battle.roundBudget,
    encounter: binding ? Object.freeze({
      status: 'linked' as const,
      encounterId: binding.link.encounterId,
      mapSlug: binding.link.linkedMapSlug,
      openingRound: binding.openingRound,
      deployedCount: binding.openingInitiativeOrderIds.length,
      readyReserveCount: binding.teams.reduce((sum, team) => sum + team.pokemon.filter(member => member.openingPlacementId === null).length, 0),
    }) : null,
  })
}

export const projectContestPublic = (document: ContestDocumentV1): ContestPublicProjectionV1 => {
  const positions = positionMap(document)
  const current = contestCurrentContestant(document)
  return Object.freeze({
    schemaVersion: 1,
    contestId: document.contestId,
    revision: document.revision,
    updatedAt: document.updatedAt,
    display: document.display,
    variantId: document.variantId,
    battle: publicBattleProjection(document),
    participantVariantId: document.participantVariantId,
    participantMethodId: document.participantMethodId,
    rotationOrderPolicy: document.policy.rotationOrderPolicy,
    supercontestFestival: document.policy.supercontestFestival,
    contestTypeId: document.contestTypeId,
    currentRoundContestTypeId: document.currentRoundContestTypeId,
    stage: document.stage,
    paused: document.paused,
    round: document.round,
    turnIndex: document.turnIndex,
    activeContestantId: current?.contestantId ?? null,
    pendingInterventionAppealId: document.pendingInterventionAppealId,
    festivalHeat: document.festivalHeat,
    scoreboard: Object.freeze(document.contestants.map(contestant => {
      const rotationIndex = document.variantId === 'rotation' && document.stage === 'performance' ? contestant.rotationOrder[document.round - 1] : undefined
      const selected = Number.isInteger(rotationIndex) ? contestant.performers[Number(rotationIndex)] : undefined
      const performer = selected && contestPerformerIsPokemon(selected) ? selected : contestant.performers.find(contestPerformerIsPokemon)
      const publicPerformers = document.variantId === 'battle'
        ? contestant.performers.filter(contestPerformerIsPokemon).map(candidate => Object.freeze({ performerKind: 'pokemon' as const, displayName: candidate.displayName, portraitUrl: candidate.portraitUrl, activePerformer: false, voltage: contestant.performerVoltages[candidate.performerId] ?? 0 }))
        : document.participantVariantId === 'trainer-participant'
          ? contestant.performers
              .filter(candidate => contestPerformerIsTrainer(candidate) || candidate.performerId === performer?.performerId)
              .map(candidate => Object.freeze({
                performerKind: candidate.performerKind,
                displayName: candidate.displayName,
                portraitUrl: candidate.portraitUrl,
                activePerformer: contestPerformerIsTrainer(candidate) || candidate.performerId === performer?.performerId,
                voltage: document.participantMethodId === 'simultaneous' ? contestant.performerVoltages[candidate.performerId] ?? 0 : contestant.voltage,
              }))
          : performer ? [Object.freeze({ performerKind: 'pokemon' as const, displayName: performer.displayName, portraitUrl: performer.portraitUrl, activePerformer: true, voltage: contestant.voltage })] : []
      return Object.freeze({
        contestantId: contestant.contestantId,
        displayName: contestant.displayName,
        pokemonName: performer?.displayName ?? 'Performer',
        portraitUrl: performer?.portraitUrl ?? null,
        performers: Object.freeze(publicPerformers),
        letter: contestant.letter,
        appeal: contestant.appeal,
        fumble: contestant.fumble,
        finalScore: contestant.finalScore ?? contestant.appeal - contestant.fumble,
        voltage: contestant.voltage,
        active: !contestant.withdrawn,
        placement: contestant.finalPlacement,
        position: positions.get(contestant.contestantId) ?? null,
      })
    })),
    acceptedAppeals: publicAppeals(document.appealLedger),
    history: publicHistory(document.history.filter(row => row.visibility === 'public')),
    declaredPrize: document.policy.prize.declared ? document.policy.prize : null,
    settlement: publicSettlement(document),
    cancellationReason: document.cancellationReason,
  })
}

const legalPerformerIdsFor = (document: ContestDocumentV1, contestant: ContestantStateV1 | null): readonly string[] => {
  const current = contestCurrentContestant(document)
  if (!contestant || document.stage !== 'performance' || current?.contestantId !== contestant.contestantId || (document.variantId === 'rotation' && !Number.isInteger(contestant.rotationOrder[document.round - 1]))) return Object.freeze([])
  if (document.participantVariantId !== 'trainer-participant' || document.participantMethodId === null) return Object.freeze([contestCurrentPerformer(document, contestant).performerId])
  const trainer = contestant.performers.find(contestPerformerIsTrainer)
  const pokemon = document.variantId === 'rotation' ? contestCurrentPerformer(document, contestant) : contestant.performers.find(contestPerformerIsPokemon)
  const currentTurn = document.turnIndex + 1
  const atCurrentCursor = (appeal: ContestAppealLedgerEntryV1): boolean => appeal.contestantId === contestant.contestantId && appeal.round === document.round && appeal.turn === currentTurn && (document.variantId !== 'festival' || Number(/-(\d+)-(\d+)-(\d+)-(\d+)$/u.exec(appeal.appealId)?.[1] ?? 0) === document.festivalHeat)
  const acceptedKinds = document.appealLedger.filter(atCurrentCursor).map(appeal => contestPerformerIsTrainer(contestant.performers.find(performer => performer.performerId === appeal.performerId)!) ? 'trainer' as const : 'pokemon' as const)
  const previousAppeal = [...document.appealLedger].reverse().find(appeal => appeal.contestantId === contestant.contestantId && !atCurrentCursor(appeal))
  const previousPerformer = previousAppeal ? contestant.performers.find(performer => performer.performerId === previousAppeal.performerId) : null
  const previousKind: ContestParticipantPerformerKind | null = previousPerformer ? contestPerformerIsTrainer(previousPerformer) ? 'trainer' : 'pokemon' : null
  const turn = resolveTrainerParticipantMethodTurn({ methodId: document.participantMethodId, acceptedPerformerKindsThisRound: acceptedKinds, previousRoundTerminalPerformerKind: previousKind })
  return trainer && pokemon && contestPerformerIsPokemon(pokemon)
    ? Object.freeze(turn.legalNextPerformerKinds.map(kind => (kind === 'trainer' ? trainer : pokemon).performerId))
    : Object.freeze([])
}

export const projectContestOwner = (document: ContestDocumentV1, profileId: string): ContestOwnerProjectionV1 | null => {
  const contestant = document.contestants.find(row => row.controller.kind === 'profile' && row.controller.profileId === profileId)
  if (!contestant) return null
  const current = contestCurrentContestant(document)
  const legalPerformerIds = legalPerformerIdsFor(document, contestant)
  return Object.freeze({
    ...projectContestPublic(document),
    history: publicHistory(document.history.filter(row => row.visibility === 'public' || (row.visibility === 'owner' && (row.contestantId === null || row.contestantId === contestant.contestantId)))),
    audience: 'owner',
    ownerContestantId: contestant.contestantId,
    ownContestant: contestant,
    ownAcceptedAppeals: Object.freeze(document.appealLedger.filter(row => row.contestantId === contestant.contestantId)),
    ownCurrentPerformerId: legalPerformerIds.length === 1 ? legalPerformerIds[0]! : null,
    ownLegalPerformerIds: legalPerformerIds,
    ownsCurrentDecision: current?.contestantId === contestant.contestantId,
  })
}

export const projectContestGm = (document: ContestDocumentV1): ContestGmProjectionV1 => Object.freeze({
  ...projectContestPublic(document),
  history: Object.freeze(document.history.filter(row => row.visibility !== 'diagnostic')),
  acceptedAppeals: document.appealLedger,
  audience: 'gm',
  currentLegalPerformerIds: legalPerformerIdsFor(document, contestCurrentContestant(document)),
  contestants: document.contestants,
  policy: document.policy,
  gmNotes: document.gmNotes,
  corrections: document.corrections,
})

export const projectContestDiagnostic = (document: ContestDocumentV1): ContestDiagnosticProjectionV1 => {
  const contributorIndex: Record<string, readonly { id: string, dice: number, explanation: string }[]> = {}
  for (const contestant of document.contestants) for (const performer of contestant.performers) for (const statId of Object.keys(performer.dicePools) as ContestStatId[]) {
    contributorIndex[`${performer.performerId}:${statId}`] = Object.freeze(performer.dicePools[statId].contributors.map(row => ({ id: row.id, dice: row.dice, explanation: row.explanation })))
  }
  return Object.freeze({ ...projectContestGm(document), diagnosticSettlement: document.settlement, history: Object.freeze([...document.history]), acceptedAppeals: document.appealLedger, audience: 'diagnostic', diceJournal: document.diceJournal, battleHandoffReceipts: document.battleHandoffReceipts, battleVoltageLifecycleLedger: document.battleVoltageLifecycleLedger, battleRecoveryReceipts: document.battleRecoveryReceipts, catalogId: contestCatalog.catalogId, contributorIndex: Object.freeze(contributorIndex) })
}
