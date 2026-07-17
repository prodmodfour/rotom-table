import {
  MOVE_RANDOM_SELECTION_LIMITS,
  parseMoveRandomTableDefinition,
  randomSelectionRollId,
  type MoveRandomTableDefinition,
  type MoveRandomTableEntry,
} from '#shared/moveAutomation/randomTables'
import type { AuthoritativeMoveRandom } from './random'

export type MoveRandomOperationErrorCode =
  | 'no-random-candidates'
  | 'random-weight-overflow'
  | 'random-result-invalid'
  | 'random-rerolls-exhausted'

export class MoveRandomOperationError extends Error {
  readonly code: MoveRandomOperationErrorCode

  constructor(code: MoveRandomOperationErrorCode, message: string) {
    super(message)
    this.name = 'MoveRandomOperationError'
    this.code = code
  }
}

export interface MoveRandomCandidate<Value> {
  readonly id: string
  readonly weight: number
  readonly value: Value
}

export interface ResolveMoveRandomCandidatesInput<Value> {
  readonly selectionId: string
  readonly rollId: string
  readonly parentEffectId: string
  readonly reasonCode: string
  readonly candidates: readonly MoveRandomCandidate<Value>[]
  readonly maximumRerolls: number
  readonly random: AuthoritativeMoveRandom
  /** Server-only applicability check run after each authoritative draw. */
  readonly isCandidateValid?: (candidate: MoveRandomCandidate<Value>) => boolean
  /** Reserve one root-scoped retry before another draw is requested. */
  readonly reserveRetry?: () => void
}

export interface MoveRandomCandidateResolution<Value> {
  readonly candidateCount: number
  readonly selectedId: string
  readonly selected: Value
  readonly attemptCount: number
  readonly rollIds: readonly string[]
}

export interface ResolveMoveRandomTableInput {
  readonly definition: MoveRandomTableDefinition
  readonly rollId: string
  readonly parentEffectId: string
  readonly reasonCode: string
  readonly random: AuthoritativeMoveRandom
  readonly isEntryValid?: (entry: MoveRandomTableEntry) => boolean
  readonly reserveRetry?: () => void
}

const fail = (code: MoveRandomOperationErrorCode, message: string): never => {
  throw new MoveRandomOperationError(code, message)
}

const boundedCandidates = <Value>(
  candidates: readonly MoveRandomCandidate<Value>[],
): readonly MoveRandomCandidate<Value>[] => {
  if (candidates.length === 0) {
    return fail('no-random-candidates', 'A reviewed random selection has no source candidates.')
  }
  if (candidates.length > MOVE_RANDOM_SELECTION_LIMITS.moveCandidates) {
    return fail(
      'no-random-candidates',
      `A reviewed random selection may contain at most ${MOVE_RANDOM_SELECTION_LIMITS.moveCandidates} candidates.`,
    )
  }
  const seen = new Set<string>()
  let totalWeight = 0
  const result = candidates.map((candidate) => {
    if (
      typeof candidate.id !== 'string'
      || candidate.id.length === 0
      || candidate.id.length > MOVE_RANDOM_SELECTION_LIMITS.canonicalMoveLength
      || candidate.id.trim() !== candidate.id
      || /[\u0000-\u001f\u007f]/.test(candidate.id)
      || seen.has(candidate.id)
      || !Number.isSafeInteger(candidate.weight)
      || candidate.weight < 1
      || candidate.weight > MOVE_RANDOM_SELECTION_LIMITS.weight
    ) {
      return fail(
        'random-result-invalid',
        'Random candidates must have unique bounded IDs and positive integer weights.',
      )
    }
    seen.add(candidate.id)
    totalWeight += candidate.weight
    if (!Number.isSafeInteger(totalWeight) || totalWeight > MOVE_RANDOM_SELECTION_LIMITS.totalWeight) {
      return fail(
        'random-weight-overflow',
        `Random candidate weight must not exceed ${MOVE_RANDOM_SELECTION_LIMITS.totalWeight} in total.`,
      )
    }
    return Object.freeze({ ...candidate })
  })
  return Object.freeze(result)
}

const tableRanges = <Value>(
  candidates: readonly MoveRandomCandidate<Value>[],
): {
  readonly maximum: number
  readonly entries: readonly { minimum: number; maximum: number; value: number }[]
} => {
  let cursor = 1
  const entries = candidates.map((candidate, index) => {
    const minimum = cursor
    const maximum = minimum + candidate.weight - 1
    cursor = maximum + 1
    return Object.freeze({ minimum, maximum, value: index + 1 })
  })
  return Object.freeze({ maximum: cursor - 1, entries: Object.freeze(entries) })
}

/**
 * Resolve one reviewed weighted candidate set. Invalid selected candidates are
 * redrawn only within the declaration's finite retry bound. The public result
 * intentionally contains a count and selected identity, never alternatives.
 */
export const resolveMoveRandomCandidates = <Value>(
  input: ResolveMoveRandomCandidatesInput<Value>,
): MoveRandomCandidateResolution<Value> => {
  if (
    !Number.isSafeInteger(input.maximumRerolls)
    || input.maximumRerolls < 0
    || input.maximumRerolls > MOVE_RANDOM_SELECTION_LIMITS.maximumRerolls
  ) {
    return fail(
      'random-result-invalid',
      `Random rerolls must be from 0 through ${MOVE_RANDOM_SELECTION_LIMITS.maximumRerolls}.`,
    )
  }
  const candidates = boundedCandidates(input.candidates)
  const ranges = tableRanges(candidates)
  const rollIds: string[] = []
  const maximumAttempts = input.maximumRerolls + 1

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    if (attempt > 1) input.reserveRetry?.()
    const rollId = randomSelectionRollId(input.rollId, attempt)
    const result = input.random.rollTable({
      rollId,
      parentEffectId: input.parentEffectId,
      formula: { kind: 'table', tableId: input.selectionId },
      drawFormula: { kind: 'uniform-integer', minimum: 1, maximum: ranges.maximum },
      entries: ranges.entries,
      reason: input.reasonCode,
    })
    rollIds.push(rollId)
    const candidateIndex = result.finalValue - 1
    const selected = candidates[candidateIndex]
      ?? fail(
        'random-result-invalid',
        `Random table ${input.selectionId} returned unknown candidate index ${result.finalValue}.`,
      )
    if (input.isCandidateValid && !input.isCandidateValid(selected)) {
      if (attempt < maximumAttempts) continue
      return fail(
        'random-rerolls-exhausted',
        `Random selection ${input.selectionId} did not find an applicable candidate in ${maximumAttempts} attempt(s).`,
      )
    }
    return Object.freeze({
      candidateCount: candidates.length,
      selectedId: selected.id,
      selected: selected.value,
      attemptCount: attempt,
      rollIds: Object.freeze([...rollIds]),
    })
  }

  return fail('random-rerolls-exhausted', `Random selection ${input.selectionId} exhausted its attempts.`)
}

/** Resolve one strictly parsed equal/weighted operation table. */
export const resolveMoveRandomTable = (
  input: ResolveMoveRandomTableInput,
): MoveRandomCandidateResolution<MoveRandomTableEntry> => {
  const definition = parseMoveRandomTableDefinition(input.definition)
  return resolveMoveRandomCandidates({
    selectionId: definition.tableId,
    rollId: input.rollId,
    parentEffectId: input.parentEffectId,
    reasonCode: input.reasonCode,
    candidates: definition.entries.map(entry => ({
      id: entry.id,
      weight: entry.weight ?? 1,
      value: entry,
    })),
    maximumRerolls: definition.maximumRerolls,
    random: input.random,
    isCandidateValid: input.isEntryValid
      ? candidate => input.isEntryValid!(candidate.value)
      : undefined,
    reserveRetry: input.reserveRetry,
  })
}
