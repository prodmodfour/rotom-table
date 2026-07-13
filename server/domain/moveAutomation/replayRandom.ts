import {
  parseMoveAutomationRollLedger,
  type MoveAutomationRandomDrawFormula,
  type MoveAutomationRandomRollRequest,
  type MoveAutomationRandomRollResult,
  type MoveAutomationRandomTableRollRequest,
  type MoveAutomationRollLedgerEntry,
  type MoveAutomationRollModifier,
} from '#shared/moveAutomation/random'
import { sameJsonValue } from '~/utils/serialization'
import {
  createAuthoritativeMoveRandom,
  type AuthoritativeMoveRandom,
  type AuthoritativeMoveRandomSource,
} from './random'

export type MoveAutomationReplayRandomErrorCode =
  | 'replay-request-mismatch'
  | 'replay-prefix-incomplete'

export class MoveAutomationReplayRandomError extends Error {
  readonly code: MoveAutomationReplayRandomErrorCode

  constructor(code: MoveAutomationReplayRandomErrorCode, message: string) {
    super(message)
    this.name = 'MoveAutomationReplayRandomError'
    this.code = code
  }
}

const fail = (
  code: MoveAutomationReplayRandomErrorCode,
  message: string,
): never => {
  throw new MoveAutomationReplayRandomError(code, message)
}

const stableGeneratedRollId = (sequence: number): string => (
  `roll.${sequence.toString().padStart(4, '0')}`
)

const formulaModifier = (formula: MoveAutomationRandomDrawFormula): number => (
  formula.kind === 'dice' ? formula.modifier : 0
)

const modifiers = (
  value: readonly MoveAutomationRollModifier[] | undefined,
): readonly MoveAutomationRollModifier[] => value ?? []

const modifierTotal = (value: readonly MoveAutomationRollModifier[]): number => (
  value.reduce((total, modifier) => total + modifier.value, 0)
)

const freezeLedger = (
  value: readonly MoveAutomationRollLedgerEntry[],
): readonly MoveAutomationRollLedgerEntry[] => Object.freeze(
  parseMoveAutomationRollLedger(value, 'replayRollLedger').map(entry => Object.freeze({
    ...entry,
    formula: Object.freeze({ ...entry.formula }),
    naturalResults: Object.freeze([...entry.naturalResults]),
    modifiers: Object.freeze(entry.modifiers.map(modifier => Object.freeze({ ...modifier }))),
  })),
)

const resultFromEntry = (
  entry: MoveAutomationRollLedgerEntry,
  modifiedResult: number,
): MoveAutomationRandomRollResult => Object.freeze({
  naturalResults: Object.freeze([...entry.naturalResults]),
  naturalResult: entry.naturalResult,
  modifiedResult,
  finalValue: entry.finalValue,
})

const assertNaturalResultsMatchFormula = (
  entry: MoveAutomationRollLedgerEntry,
  formula: MoveAutomationRandomDrawFormula,
): void => {
  if (formula.kind === 'dice') {
    if (
      entry.naturalResults.length !== formula.count
      || entry.naturalResults.some(result => result < 1 || result > formula.sides)
    ) {
      fail(
        'replay-request-mismatch',
        `Stored roll ${entry.rollId} does not match its current reviewed dice draw formula.`,
      )
    }
    return
  }
  if (
    entry.naturalResults.length !== 1
    || entry.naturalResults[0]! < formula.minimum
    || entry.naturalResults[0]! > formula.maximum
  ) {
    fail(
      'replay-request-mismatch',
      `Stored roll ${entry.rollId} does not match its current reviewed integer draw formula.`,
    )
  }
}

const assertRequestIdentity = (input: {
  readonly entry: MoveAutomationRollLedgerEntry
  readonly rollId: string
  readonly parentEffectId: string
  readonly reason: string
  readonly modifiers: readonly MoveAutomationRollModifier[]
}): void => {
  if (
    input.entry.rollId !== input.rollId
    || input.entry.parentEffectId !== input.parentEffectId
    || input.entry.reason !== input.reason
    || !sameJsonValue(input.entry.modifiers, input.modifiers)
  ) {
    fail(
      'replay-request-mismatch',
      `Stored roll ${input.entry.rollId} does not match the current reviewed random request.`,
    )
  }
}

/**
 * Replay a durable random prefix as typed roll results before delegating later
 * requests to fresh server entropy. Replaying at the roller boundary preserves
 * table draw formulas, which are intentionally not duplicated in ledger rows.
 */
export const createMoveAutomationReplayRandom = (
  ledger: readonly MoveAutomationRollLedgerEntry[],
  freshSource: AuthoritativeMoveRandomSource = Math.random,
): AuthoritativeMoveRandom => {
  const durable = freezeLedger(ledger)
  const fresh = createAuthoritativeMoveRandom(freshSource)
  const usedRollIds = new Set<string>()
  let requestSequence = 0
  let replayIndex = 0
  let completed: readonly MoveAutomationRollLedgerEntry[] | null = null

  const beginRequest = (requestedRollId: string | undefined): {
    readonly rollId: string
    readonly entry: MoveAutomationRollLedgerEntry | null
  } => {
    if (completed) {
      return fail('replay-request-mismatch', 'The replay random ledger is already complete.')
    }
    requestSequence += 1
    const rollId = requestedRollId ?? stableGeneratedRollId(requestSequence)
    if (usedRollIds.has(rollId)) {
      return fail('replay-request-mismatch', `Random roll ID ${rollId} was requested more than once.`)
    }
    usedRollIds.add(rollId)
    return { rollId, entry: durable[replayIndex] ?? null }
  }

  const consume = (entry: MoveAutomationRollLedgerEntry): void => {
    replayIndex += 1
    if (durable[replayIndex - 1]?.rollId !== entry.rollId) {
      fail('replay-request-mismatch', `Stored roll ${entry.rollId} was consumed out of order.`)
    }
  }

  const roll = (request: MoveAutomationRandomRollRequest): MoveAutomationRandomRollResult => {
    const current = beginRequest(request.rollId)
    if (!current.entry) return fresh.roll({ ...request, rollId: current.rollId })
    const requestModifiers = modifiers(request.modifiers)
    assertRequestIdentity({
      entry: current.entry,
      rollId: current.rollId,
      parentEffectId: request.parentEffectId,
      reason: request.reason,
      modifiers: requestModifiers,
    })
    if (!sameJsonValue(current.entry.formula, request.formula)) {
      return fail(
        'replay-request-mismatch',
        `Stored roll ${current.entry.rollId} does not match its current reviewed formula.`,
      )
    }
    assertNaturalResultsMatchFormula(current.entry, request.formula)
    consume(current.entry)
    return resultFromEntry(current.entry, current.entry.finalValue)
  }

  const rollTable = (
    request: MoveAutomationRandomTableRollRequest,
  ): MoveAutomationRandomRollResult => {
    const current = beginRequest(request.rollId)
    if (!current.entry) return fresh.rollTable({ ...request, rollId: current.rollId })
    const requestModifiers = modifiers(request.modifiers)
    assertRequestIdentity({
      entry: current.entry,
      rollId: current.rollId,
      parentEffectId: request.parentEffectId,
      reason: request.reason,
      modifiers: requestModifiers,
    })
    if (!sameJsonValue(current.entry.formula, request.formula)) {
      return fail(
        'replay-request-mismatch',
        `Stored table roll ${current.entry.rollId} does not match its current reviewed table.`,
      )
    }
    assertNaturalResultsMatchFormula(current.entry, request.drawFormula)
    const modifiedResult = current.entry.naturalResult
      + formulaModifier(request.drawFormula)
      + modifierTotal(requestModifiers)
    const selected = request.entries.find(entry => (
      modifiedResult >= entry.minimum && modifiedResult <= entry.maximum
    ))
    if (!selected || selected.value !== current.entry.finalValue) {
      return fail(
        'replay-request-mismatch',
        `Stored table roll ${current.entry.rollId} does not match its current reviewed result.`,
      )
    }
    consume(current.entry)
    return resultFromEntry(current.entry, modifiedResult)
  }

  const snapshot = (): readonly MoveAutomationRollLedgerEntry[] => Object.freeze([
    ...durable.slice(0, replayIndex),
    ...fresh.snapshot(),
  ])

  const complete = (): readonly MoveAutomationRollLedgerEntry[] => {
    if (completed) return completed
    if (replayIndex !== durable.length) {
      return fail(
        'replay-prefix-incomplete',
        `Resumed execution consumed ${replayIndex} of ${durable.length} durable random rolls.`,
      )
    }
    completed = Object.freeze([
      ...durable,
      ...fresh.complete(),
    ])
    return completed
  }

  return Object.freeze({ roll, rollTable, snapshot, complete })
}
