import { trainerParticipantMethodById, type CanonicalTrainerParticipantMethod } from './catalog'
import { isContestParticipantMethodId, type ContestParticipantMethodId } from './ids'

export type ContestParticipantPerformerKind = 'trainer' | 'pokemon'

export class ContestParticipantMethodError extends Error {
  readonly code: 'contest.method-invalid' | 'contest.method-turn-conflict'
  constructor(code: ContestParticipantMethodError['code'], message: string) {
    super(message)
    this.name = 'ContestParticipantMethodError'
    this.code = code
  }
}

const fail = (code: ContestParticipantMethodError['code'], message: string): never => { throw new ContestParticipantMethodError(code, message) }
const isPerformerKind = (value: unknown): value is ContestParticipantPerformerKind => value === 'trainer' || value === 'pokemon'
const otherKind = (kind: ContestParticipantPerformerKind): ContestParticipantPerformerKind => kind === 'trainer' ? 'pokemon' : 'trainer'

export interface ResolveTrainerParticipantMethodTurnInputV1 {
  readonly methodId: ContestParticipantMethodId
  /** Accepted member kinds in this entry's current base-Contest round. */
  readonly acceptedPerformerKindsThisRound: readonly ContestParticipantPerformerKind[]
  /** Last accepted member kind before this round; null makes either alternating lead legal. */
  readonly previousRoundTerminalPerformerKind: ContestParticipantPerformerKind | null
}

export interface TrainerParticipantMethodTurnV1 {
  readonly methodId: ContestParticipantMethodId
  readonly appealsPerEntryPerRound: 1 | 2
  readonly acceptedAppealsThisRound: number
  readonly roundComplete: boolean
  readonly legalNextPerformerKinds: readonly ContestParticipantPerformerKind[]
  readonly voltageScope: 'per-performer' | 'shared-entry'
  readonly adjacentEffectScope: 'both-performers-of-adjacent-entry' | 'shared-entry'
  readonly crossPerformerEffectPolicy: readonly string[]
}

/**
 * Canonical pair scheduler. With no predecessor, either alternating lead is
 * legal; after the first accepted turn, alternation is exact and deterministic.
 */
export const resolveTrainerParticipantMethodTurn = (input: ResolveTrainerParticipantMethodTurnInputV1): TrainerParticipantMethodTurnV1 => {
  if (!isContestParticipantMethodId(input.methodId)) fail('contest.method-invalid', 'Trainer Participant method is not canonical.')
  if (input.previousRoundTerminalPerformerKind !== null && !isPerformerKind(input.previousRoundTerminalPerformerKind)) fail('contest.method-invalid', 'Previous alternating performer kind is invalid.')
  if (!Array.isArray(input.acceptedPerformerKindsThisRound) || input.acceptedPerformerKindsThisRound.some(kind => !isPerformerKind(kind))) fail('contest.method-invalid', 'Accepted method sequence contains an invalid performer kind.')
  const method = trainerParticipantMethodById.get(input.methodId) ?? fail('contest.method-invalid', 'Trainer Participant method has no source-bound policy.')
  const accepted = [...input.acceptedPerformerKindsThisRound]
  let legalNextPerformerKinds: readonly ContestParticipantPerformerKind[]
  let roundComplete = false
  if (method.id === 'simultaneous') {
    if (accepted.length > method.appealsPerEntryPerRound || accepted.length === 2 && accepted[0] === accepted[1]) fail('contest.method-turn-conflict', 'Simultaneous method requires each paired member exactly once per round.')
    roundComplete = accepted.length === method.appealsPerEntryPerRound
    legalNextPerformerKinds = roundComplete ? [] : accepted.length === 0 ? ['trainer', 'pokemon'] : [otherKind(accepted[0]!)]
  } else {
    if (accepted.length > method.appealsPerEntryPerRound) fail('contest.method-turn-conflict', 'Alternating method permits exactly one paired appeal per entry per round.')
    const expected = input.previousRoundTerminalPerformerKind === null ? ['trainer', 'pokemon'] as const : [otherKind(input.previousRoundTerminalPerformerKind)] as const
    if (accepted.length === 1 && !expected.includes(accepted[0] as never)) fail('contest.method-turn-conflict', 'Alternating method requires the other paired member after the previous accepted turn.')
    roundComplete = accepted.length === method.appealsPerEntryPerRound
    legalNextPerformerKinds = roundComplete ? [] : expected
  }
  return Object.freeze({
    methodId: method.id,
    appealsPerEntryPerRound: method.appealsPerEntryPerRound,
    acceptedAppealsThisRound: accepted.length,
    roundComplete,
    legalNextPerformerKinds: Object.freeze([...legalNextPerformerKinds]),
    voltageScope: method.voltageScope,
    adjacentEffectScope: method.adjacentEffectScope,
    crossPerformerEffectPolicy: Object.freeze([...method.crossPerformerEffectPolicy]),
  })
}

export const trainerParticipantMethodPolicy = (methodId: ContestParticipantMethodId): CanonicalTrainerParticipantMethod =>
  trainerParticipantMethodById.get(methodId) ?? fail('contest.method-invalid', 'Trainer Participant method has no source-bound policy.')
