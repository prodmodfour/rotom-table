import type { ContestStage } from './ids'
import type { ContestStatId } from './ids'
import type { ContestPublicAppealProjectionV1, ContestPublicHistoryProjectionV1 } from './projections'

export const BATTLE_CONTEST_LIVEPLAY_SCHEMA_VERSION = 1 as const

export type BattleContestLiveplayAudience = 'gm' | 'owner' | 'public'

/** Role-safe remaining team dice. Provider, sheet, and journal authority never enters this projection. */
export interface BattleContestLiveplayPoolV1 {
  readonly contestantId: string
  readonly displayName: string
  readonly remaining: Readonly<Record<ContestStatId, number>>
}

export interface BattleContestLiveplayPerformerV1 {
  readonly displayName: string
  readonly portraitUrl: string | null
  readonly voltage: number
  readonly active: boolean
}

export interface BattleContestLiveplayScoreV1 {
  readonly contestantId: string
  readonly displayName: string
  readonly appeal: number
  readonly finalScore: number
  readonly placement: number | null
  readonly active: boolean
  readonly performers: readonly BattleContestLiveplayPerformerV1[]
}

/**
 * A choice reconstructed by the server from one persisted accepted Encounter Move.
 * No source operation, result, placement, sheet, provider, or hash identity is public.
 */
export interface BattleContestLiveplayAppealDecisionV1 {
  readonly kind: 'score-accepted-move'
  readonly contestantId: string
  readonly contestantDisplayName: string
  readonly pokemonDisplayName: string
  readonly moveName: string
  readonly round: number
  readonly maximumSpend: 3
  readonly canResolve: boolean
  readonly waitingForDisplayName: string
}

export interface BattleContestLiveplayProjectionV1 {
  readonly schemaVersion: typeof BATTLE_CONTEST_LIVEPLAY_SCHEMA_VERSION
  readonly audience: BattleContestLiveplayAudience
  readonly contestId: string
  readonly revision: number
  readonly updatedAt: number
  readonly title: string
  readonly contestTypeId: ContestStatId
  readonly stage: ContestStage
  readonly paused: boolean
  readonly round: number
  readonly roundBudget: number
  readonly scores: readonly BattleContestLiveplayScoreV1[]
  /** GM sees both teams, the acting owner sees only their own team, and public sees none. */
  readonly visibleTeamPools: readonly BattleContestLiveplayPoolV1[]
  readonly pendingAppeal: BattleContestLiveplayAppealDecisionV1 | null
  /** True while one or more server-owned non-interactive handoffs still need reconciliation. */
  readonly synchronizing: boolean
  readonly acceptedAppeals: readonly ContestPublicAppealProjectionV1[]
  readonly history: readonly ContestPublicHistoryProjectionV1[]
  readonly actionsBlocked: boolean
  readonly exactRetry: boolean
}

export interface BattleContestLiveplayResponseV1 {
  readonly ok: true
  readonly battleContest: BattleContestLiveplayProjectionV1 | null
}

export interface BattleContestLiveplaySpendV1 {
  readonly beauty: number
  readonly cool: number
  readonly cute: number
  readonly smart: number
  readonly tough: number
}

export type BattleContestLiveplayCommandV1 =
  | {
      readonly schemaVersion: typeof BATTLE_CONTEST_LIVEPLAY_SCHEMA_VERSION
      readonly command: 'synchronize'
      readonly encounterId: string
    }
  | {
      readonly schemaVersion: typeof BATTLE_CONTEST_LIVEPLAY_SCHEMA_VERSION
      readonly command: 'score-appeal'
      readonly encounterId: string
      readonly expectedContestRevision: number
      readonly spentDice: BattleContestLiveplaySpendV1
    }
