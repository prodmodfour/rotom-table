import { contestCatalog, contestChart, contestStatById } from './catalog'
import { contestActiveContestants, contestCurrentContestant, contestCurrentPerformer, type ContestAppealLedgerEntryV1, type ContestDocumentV1, type ContestantStateV1 } from './document'
import type { ContestLetter, ContestStatId } from './ids'

export interface ContestPositionProjectionV1 {
  readonly contestantId: string
  readonly position: number
  readonly turnNumber: number
  readonly adjacentContestantIds: readonly string[]
  readonly centerOfAttention: boolean
}
export interface ContestScoreboardRowProjectionV1 {
  readonly contestantId: string
  readonly displayName: string
  readonly pokemonName: string
  readonly portraitUrl: string | null
  readonly letter: ContestLetter | null
  readonly appeal: number
  readonly fumble: number
  readonly finalScore: number
  readonly voltage: number
  readonly active: boolean
  readonly placement: number | null
  readonly position: ContestPositionProjectionV1 | null
}
export interface ContestPublicProjectionV1 {
  readonly schemaVersion: 1
  readonly contestId: string
  readonly revision: number
  readonly updatedAt: number
  readonly display: ContestDocumentV1['display']
  readonly variantId: ContestDocumentV1['variantId']
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
  readonly acceptedAppeals: readonly ContestAppealLedgerEntryV1[]
  readonly history: readonly ContestDocumentV1['history'][number][]
  readonly declaredPrize: ContestDocumentV1['policy']['prize'] | null
  readonly settlement: ContestDocumentV1['settlement']
  readonly cancellationReason: string | null
}
export interface ContestOwnerProjectionV1 extends ContestPublicProjectionV1 {
  readonly audience: 'owner'
  readonly ownerContestantId: string
  readonly ownContestant: ContestantStateV1
  readonly ownCurrentPerformerId: string | null
  readonly ownsCurrentDecision: boolean
}
export interface ContestGmProjectionV1 extends ContestPublicProjectionV1 {
  readonly audience: 'gm' | 'diagnostic'
  readonly contestants: readonly ContestantStateV1[]
  readonly policy: ContestDocumentV1['policy']
  readonly gmNotes: string
  readonly corrections: ContestDocumentV1['corrections']
}
export interface ContestDiagnosticProjectionV1 extends ContestGmProjectionV1 {
  readonly audience: 'diagnostic'
  readonly diceJournal: ContestDocumentV1['diceJournal']
  readonly catalogId: string
  readonly contributorIndex: Readonly<Record<string, readonly { readonly id: string, readonly dice: number, readonly explanation: string }[]>>
}
export type ContestRoleProjectionV1 = ContestPublicProjectionV1 | ContestOwnerProjectionV1 | ContestGmProjectionV1 | ContestDiagnosticProjectionV1

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
      const rotationIndex = document.variantId === 'rotation' && document.stage === 'performance' ? contestant.rotationOrder[document.round - 1] : 0
      const performer = Number.isInteger(rotationIndex) ? contestant.performers[Number(rotationIndex)] : undefined
      return Object.freeze({
        contestantId: contestant.contestantId,
        displayName: contestant.displayName,
        pokemonName: performer?.displayName ?? 'Performer',
        portraitUrl: performer?.portraitUrl ?? null,
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
    acceptedAppeals: Object.freeze(document.appealLedger.map(row => Object.freeze({ ...row }))),
    history: Object.freeze(document.history.filter(row => row.visibility === 'public')),
    declaredPrize: document.policy.prize.declared ? document.policy.prize : null,
    settlement: document.settlement,
    cancellationReason: document.cancellationReason,
  })
}

export const projectContestOwner = (document: ContestDocumentV1, profileId: string): ContestOwnerProjectionV1 | null => {
  const contestant = document.contestants.find(row => row.controller.kind === 'profile' && row.controller.profileId === profileId)
  if (!contestant) return null
  const current = contestCurrentContestant(document)
  return Object.freeze({
    ...projectContestPublic(document),
    history: Object.freeze(document.history.filter(row => row.visibility === 'public' || (row.visibility === 'owner' && (row.contestantId === null || row.contestantId === contestant.contestantId)))),
    audience: 'owner',
    ownerContestantId: contestant.contestantId,
    ownContestant: contestant,
    ownCurrentPerformerId: document.stage === 'performance' && (document.variantId !== 'rotation' || Number.isInteger(contestant.rotationOrder[document.round - 1])) ? contestCurrentPerformer(document, contestant).performerId : null,
    ownsCurrentDecision: current?.contestantId === contestant.contestantId,
  })
}

export const projectContestGm = (document: ContestDocumentV1): ContestGmProjectionV1 => Object.freeze({
  ...projectContestPublic(document),
  history: Object.freeze(document.history.filter(row => row.visibility !== 'diagnostic')),
  audience: 'gm',
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
  return Object.freeze({ ...projectContestGm(document), history: Object.freeze([...document.history]), audience: 'diagnostic', diceJournal: document.diceJournal, catalogId: contestCatalog.catalogId, contributorIndex: Object.freeze(contributorIndex) })
}

export const explainContestTypeRelationship = (moveTypeId: ContestStatId, contestTypeId: ContestStatId): { readonly relationship: 'matching' | 'allied' | 'opposed', readonly dice: number, readonly explanation: string } => {
  if (moveTypeId === contestTypeId) return Object.freeze({ relationship: 'matching', dice: contestCatalog.performance.appealTypeModifiers.matching, explanation: `${contestStatById.get(moveTypeId)!.label} matches the Contest: +1d6.` })
  if (contestStatById.get(contestTypeId)!.alliedStatIds.includes(moveTypeId)) return Object.freeze({ relationship: 'allied', dice: 0, explanation: `${contestStatById.get(moveTypeId)!.label} is allied: no modifier.` })
  return Object.freeze({ relationship: 'opposed', dice: -1, explanation: `${contestStatById.get(moveTypeId)!.label} is opposed: -1d6 (zero causes a fumble).` })
}
