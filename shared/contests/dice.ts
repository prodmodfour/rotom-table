import type { ContestDiceJournalEntryV1, ContestDocumentV1 } from './document'

export interface ContestRandomSource {
  /** Inclusive integer draw. The server owns this source. */
  nextInteger(minimum: number, maximum: number): number
}

export interface ContestDiceRollInput {
  readonly operationId: string
  readonly purpose: ContestDiceJournalEntryV1['purpose']
  readonly contestantId: string | null
  readonly round: number | null
  readonly count: number
  readonly dieSides?: number
  readonly replacesJournalId?: string | null
  readonly rerolledDieIndices?: readonly number[]
  readonly createdAt: number
}

const safeInteger = (value: unknown, label: string, minimum: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new Error(`${label} must be an integer from ${minimum} through ${maximum}`)
  return Number(value)
}

export const rollContestDice = (
  document: Pick<ContestDocumentV1, 'contestId' | 'diceJournal'>,
  input: ContestDiceRollInput,
  random: ContestRandomSource,
): ContestDiceJournalEntryV1 => {
  const count = safeInteger(input.count, 'count', 0, 200)
  const dieSides = safeInteger(input.dieSides ?? 6, 'dieSides', 2, 100)
  const rerolledDieIndices = [...(input.rerolledDieIndices ?? [])].map((index, position) => safeInteger(index, `rerolledDieIndices[${position}]`, 0, 999))
  if (new Set(rerolledDieIndices).size !== rerolledDieIndices.length || rerolledDieIndices.length && rerolledDieIndices.length !== count) throw new Error('rerolledDieIndices must uniquely identify every rerolled die')
  const results = Array.from({ length: count }, () => {
    const result = random.nextInteger(1, dieSides)
    return safeInteger(result, 'random result', 1, dieSides)
  })
  return Object.freeze({
    journalId: `${document.contestId}:dice:${document.diceJournal.length + 1}`,
    operationId: input.operationId,
    purpose: input.purpose,
    contestantId: input.contestantId,
    round: input.round,
    dieSides,
    results: Object.freeze(results),
    rerolledDieIndices: Object.freeze(rerolledDieIndices),
    replacesJournalId: input.replacesJournalId ?? null,
    createdAt: safeInteger(input.createdAt, 'createdAt', 0, Number.MAX_SAFE_INTEGER),
  })
}

export const rollContestTypeDie = (
  document: Pick<ContestDocumentV1, 'contestId' | 'diceJournal'>,
  input: Omit<ContestDiceRollInput, 'purpose' | 'count' | 'dieSides'>,
  random: ContestRandomSource,
): { readonly journal: ContestDiceJournalEntryV1, readonly typeDie: 1 | 2 | 3 | 4 | 5 } => {
  const results: number[] = []
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = safeInteger(random.nextInteger(1, 6), 'random result', 1, 6)
    results.push(result)
    if (result !== 6) {
      return Object.freeze({
        journal: Object.freeze({
          journalId: `${document.contestId}:dice:${document.diceJournal.length + 1}`,
          operationId: input.operationId,
          purpose: 'supercontest-type',
          contestantId: input.contestantId,
          round: input.round,
          dieSides: 6,
          results: Object.freeze(results),
          rerolledDieIndices: Object.freeze([]),
          replacesJournalId: input.replacesJournalId ?? null,
          createdAt: safeInteger(input.createdAt, 'createdAt', 0, Number.MAX_SAFE_INTEGER),
        }),
        typeDie: result as 1 | 2 | 3 | 4 | 5,
      })
    }
  }
  throw new Error('Contest type die exceeded the bounded reroll budget')
}

/** Deterministic source for fixtures only. Production passes a crypto-backed source. */
export const createSeededContestRandomSource = (seedInput: number): ContestRandomSource => {
  let state = (Math.floor(seedInput) >>> 0) || 0x9e3779b9
  return Object.freeze({
    nextInteger: (minimum: number, maximum: number) => {
      safeInteger(minimum, 'minimum', -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
      safeInteger(maximum, 'maximum', minimum, Number.MAX_SAFE_INTEGER)
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      state >>>= 0
      return minimum + (state % (maximum - minimum + 1))
    },
  })
}

export const createSequenceContestRandomSource = (sequence: readonly number[]): ContestRandomSource => {
  let cursor = 0
  return Object.freeze({
    nextInteger: (minimum: number, maximum: number) => {
      if (cursor >= sequence.length) throw new Error('Contest fixture random sequence exhausted')
      const value = sequence[cursor++]!
      return safeInteger(value, `sequence[${cursor - 1}]`, minimum, maximum)
    },
  })
}
