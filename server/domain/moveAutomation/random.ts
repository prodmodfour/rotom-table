import { MOVE_EFFECT_OPERATION_LIMITS } from '#shared/moveAutomation/effects'
import {
  MOVE_AUTOMATION_ROLL_LEDGER_LIMITS,
  MoveAutomationRollLedgerValidationError,
  parseMoveAutomationRollLedger,
  type MoveAutomationRandomDrawFormula,
  type MoveAutomationRandomRollRequest,
  type MoveAutomationRandomRollResult,
  type MoveAutomationRandomRoller,
  type MoveAutomationRandomTableEntry,
  type MoveAutomationRandomTableRollRequest,
  type MoveAutomationRollLedgerEntry,
  type MoveAutomationRollModifier,
} from '#shared/moveAutomation/random'

export type AuthoritativeMoveRandomErrorCode =
  | 'invalid-random-source-value'
  | 'missing-random-draw'
  | 'excess-random-draws'
  | 'duplicate-roll-id'
  | 'roll-ledger-limit-exceeded'
  | 'invalid-roll-request'
  | 'table-result-missing'
  | 'random-already-completed'

export class AuthoritativeMoveRandomError extends Error {
  readonly code: AuthoritativeMoveRandomErrorCode

  constructor(code: AuthoritativeMoveRandomErrorCode, message: string) {
    super(message)
    this.name = 'AuthoritativeMoveRandomError'
    this.code = code
  }
}

export interface AuthoritativeMoveRandomDrawStream {
  draw(): number
  assertExhausted(): void
  readonly consumed: number
  readonly remaining: number
}

export type AuthoritativeMoveRandomSource = (() => number) | AuthoritativeMoveRandomDrawStream

export interface AuthoritativeMoveRandom extends MoveAutomationRandomRoller {
  snapshot(): readonly MoveAutomationRollLedgerEntry[]
  /** Seal the ledger and, for finite test streams, reject any unused draws. */
  complete(): readonly MoveAutomationRollLedgerEntry[]
}

const fail = (code: AuthoritativeMoveRandomErrorCode, message: string): never => {
  throw new AuthoritativeMoveRandomError(code, message)
}

const isValidRandomSourceValue = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1
)

const assertRandomSourceValue = (value: unknown, drawNumber: number): number => {
  if (!isValidRandomSourceValue(value)) {
    return fail(
      'invalid-random-source-value',
      `Random draw ${drawNumber} must be a finite number greater than or equal to 0 and less than 1.`,
    )
  }
  return value
}

/**
 * Exact test-only entropy stream. Resolution fails if it asks for an absent
 * draw, and `AuthoritativeMoveRandom.complete()` fails when a draw is unused.
 */
export const createFiniteAuthoritativeMoveRandomStream = (
  values: readonly number[],
): AuthoritativeMoveRandomDrawStream => {
  const draws = [...values]
  draws.forEach((value, index) => assertRandomSourceValue(value, index + 1))
  let index = 0

  return Object.freeze({
    draw: (): number => {
      const value = draws[index]
      if (value === undefined) {
        return fail(
          'missing-random-draw',
          `Resolution requested random draw ${index + 1}, but the finite stream contains only ${draws.length}.`,
        )
      }
      index += 1
      return value
    },
    assertExhausted: (): void => {
      if (index === draws.length) return
      fail(
        'excess-random-draws',
        `Resolution consumed ${index} of ${draws.length} finite random draws; ${draws.length - index} draw(s) remain.`,
      )
    },
    get consumed(): number {
      return index
    },
    get remaining(): number {
      return draws.length - index
    },
  })
}

const isRandomDrawStream = (
  source: AuthoritativeMoveRandomSource,
): source is AuthoritativeMoveRandomDrawStream => typeof source !== 'function'

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0)

const cloneModifiers = (
  modifiers: readonly MoveAutomationRollModifier[] | undefined,
): MoveAutomationRollModifier[] => (modifiers ?? []).map((modifier) => ({
  sourceId: modifier.sourceId,
  reason: modifier.reason,
  value: modifier.value,
}))

const formulaModifier = (formula: MoveAutomationRandomDrawFormula): number => (
  formula.kind === 'dice' ? formula.modifier : 0
)

const stableGeneratedRollId = (sequence: number): string => (
  `roll.${sequence.toString().padStart(4, '0')}`
)

const cloneDrawFormula = (
  formula: MoveAutomationRandomDrawFormula,
): MoveAutomationRandomDrawFormula => formula.kind === 'dice'
  ? {
      kind: 'dice',
      count: formula.count,
      sides: formula.sides,
      modifier: formula.modifier,
    }
  : {
      kind: 'uniform-integer',
      minimum: formula.minimum,
      maximum: formula.maximum,
    }

const assertDrawFormula = (formula: MoveAutomationRandomDrawFormula): void => {
  if (formula.kind === 'dice') {
    if (
      !Number.isSafeInteger(formula.count)
      || formula.count < 1
      || formula.count > MOVE_EFFECT_OPERATION_LIMITS.diceCount
      || !Number.isSafeInteger(formula.sides)
      || formula.sides < 2
      || formula.sides > MOVE_EFFECT_OPERATION_LIMITS.diceSides
      || !Number.isSafeInteger(formula.modifier)
      || Math.abs(formula.modifier) > MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude
    ) {
      fail('invalid-roll-request', 'Dice formulas must stay within the bounded effect-operation limits.')
    }
    return
  }

  if (
    !Number.isSafeInteger(formula.minimum)
    || !Number.isSafeInteger(formula.maximum)
    || formula.minimum > formula.maximum
    || Math.abs(formula.minimum) > MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude
    || Math.abs(formula.maximum) > MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude
  ) {
    fail('invalid-roll-request', 'Uniform integer formulas must contain an ordered bounded integer range.')
  }
}

const assertTableEntries = (
  entries: readonly MoveAutomationRandomTableEntry[],
): readonly MoveAutomationRandomTableEntry[] => {
  if (!entries.length || entries.length > MOVE_AUTOMATION_ROLL_LEDGER_LIMITS.tableEntries) {
    return fail(
      'invalid-roll-request',
      `Random tables must contain from 1 through ${MOVE_AUTOMATION_ROLL_LEDGER_LIMITS.tableEntries} entries.`,
    )
  }

  const normalized = entries.map((entry) => {
    if (
      !Number.isSafeInteger(entry.minimum)
      || !Number.isSafeInteger(entry.maximum)
      || entry.minimum > entry.maximum
      || !Number.isFinite(entry.value)
      || Math.abs(entry.value) > MOVE_AUTOMATION_ROLL_LEDGER_LIMITS.numericMagnitude
    ) {
      return fail('invalid-roll-request', 'Random table ranges and values must be finite and bounded.')
    }
    return { minimum: entry.minimum, maximum: entry.maximum, value: entry.value }
  }).sort((left, right) => left.minimum - right.minimum || left.maximum - right.maximum)

  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index]!.minimum <= normalized[index - 1]!.maximum) {
      fail('invalid-roll-request', 'Random table ranges may not overlap.')
    }
  }
  return normalized
}

const freezeLedger = (
  ledger: readonly MoveAutomationRollLedgerEntry[],
): readonly MoveAutomationRollLedgerEntry[] => Object.freeze(ledger.map((entry) => Object.freeze({
  ...entry,
  formula: Object.freeze({ ...entry.formula }),
  naturalResults: Object.freeze([...entry.naturalResults]),
  modifiers: Object.freeze(entry.modifiers.map((modifier) => Object.freeze({ ...modifier }))),
})))

const validationFailure = (error: MoveAutomationRollLedgerValidationError): never => {
  const code: AuthoritativeMoveRandomErrorCode = error.code === 'limit-exceeded'
    ? 'roll-ledger-limit-exceeded'
    : error.code === 'duplicate-roll-id'
      ? 'duplicate-roll-id'
      : 'invalid-roll-request'
  return fail(code, error.message)
}

export const createAuthoritativeMoveRandom = (
  source: AuthoritativeMoveRandomSource = Math.random,
): AuthoritativeMoveRandom => {
  const ledger: MoveAutomationRollLedgerEntry[] = []
  const rollIds = new Set<string>()
  let requestSequence = 0
  let sourceDraws = 0
  let completedLedger: readonly MoveAutomationRollLedgerEntry[] | null = null

  const assertOpen = (): void => {
    if (completedLedger) fail('random-already-completed', 'The authoritative random ledger is already complete.')
  }

  const nextSourceValue = (): number => {
    sourceDraws += 1
    const value = isRandomDrawStream(source) ? source.draw() : source()
    return assertRandomSourceValue(value, sourceDraws)
  }

  const drawFormula = (
    formula: MoveAutomationRandomDrawFormula,
  ): readonly number[] => {
    assertDrawFormula(formula)
    if (formula.kind === 'dice') {
      return Array.from(
        { length: formula.count },
        () => 1 + Math.floor(nextSourceValue() * formula.sides),
      )
    }
    const range = formula.maximum - formula.minimum + 1
    return [formula.minimum + Math.floor(nextSourceValue() * range)]
  }

  const assertCapacity = (): void => {
    if (ledger.length >= MOVE_AUTOMATION_ROLL_LEDGER_LIMITS.entries) {
      fail(
        'roll-ledger-limit-exceeded',
        `A move may record at most ${MOVE_AUTOMATION_ROLL_LEDGER_LIMITS.entries} random rolls.`,
      )
    }
  }

  const reserveRollId = (requestedId: string | undefined): string => {
    requestSequence += 1
    const rollId = requestedId ?? stableGeneratedRollId(requestSequence)
    if (rollIds.has(rollId)) {
      fail('duplicate-roll-id', `Random roll ID ${rollId} was requested more than once.`)
    }
    rollIds.add(rollId)
    return rollId
  }

  const append = (
    entry: MoveAutomationRollLedgerEntry,
  ): MoveAutomationRandomRollResult => {
    let parsed: MoveAutomationRollLedgerEntry
    try {
      parsed = parseMoveAutomationRollLedger([entry], 'rollLedger')[0]!
    }
    catch (error) {
      if (error instanceof MoveAutomationRollLedgerValidationError) return validationFailure(error)
      throw error
    }
    ledger.push(parsed)
    const formulaMod = entry.formula.kind === 'dice' ? entry.formula.modifier : 0
    return Object.freeze({
      naturalResults: Object.freeze([...entry.naturalResults]),
      naturalResult: entry.naturalResult,
      modifiedResult: entry.naturalResult + formulaMod + sum(entry.modifiers.map(({ value }) => value)),
      finalValue: entry.finalValue,
    })
  }

  const roll = (
    request: MoveAutomationRandomRollRequest,
  ): MoveAutomationRandomRollResult => {
    assertOpen()
    assertCapacity()
    const rollId = reserveRollId(request.rollId)
    const formula = cloneDrawFormula(request.formula)
    const modifiers = cloneModifiers(request.modifiers)
    const naturalResults = drawFormula(formula)
    const naturalResult = sum(naturalResults)
    const modifiedResult = naturalResult + formulaModifier(formula) + sum(modifiers.map(({ value }) => value))
    return append({
      rollId,
      parentEffectId: request.parentEffectId,
      formula,
      reason: request.reason,
      naturalResults,
      naturalResult,
      modifiers,
      finalValue: modifiedResult,
    })
  }

  const rollTable = (
    request: MoveAutomationRandomTableRollRequest,
  ): MoveAutomationRandomRollResult => {
    assertOpen()
    assertCapacity()
    const rollId = reserveRollId(request.rollId)
    const draw = cloneDrawFormula(request.drawFormula)
    const entries = assertTableEntries(request.entries)
    const modifiers = cloneModifiers(request.modifiers)
    const naturalResults = drawFormula(draw)
    const naturalResult = sum(naturalResults)
    const modifiedResult = naturalResult + formulaModifier(draw) + sum(modifiers.map(({ value }) => value))
    const selected = entries.find((entry) => (
      modifiedResult >= entry.minimum && modifiedResult <= entry.maximum
    )) ?? fail(
      'table-result-missing',
      `Random table ${request.formula.tableId} has no entry for result ${modifiedResult}.`,
    )
    const result = append({
      rollId,
      parentEffectId: request.parentEffectId,
      formula: { kind: 'table', tableId: request.formula.tableId },
      reason: request.reason,
      naturalResults,
      naturalResult,
      modifiers,
      finalValue: selected.value,
    })
    return Object.freeze({ ...result, modifiedResult })
  }

  const snapshot = (): readonly MoveAutomationRollLedgerEntry[] => (
    completedLedger ?? freezeLedger(parseMoveAutomationRollLedger(ledger, 'rollLedger'))
  )

  const complete = (): readonly MoveAutomationRollLedgerEntry[] => {
    if (completedLedger) return completedLedger
    if (isRandomDrawStream(source)) source.assertExhausted()
    completedLedger = snapshot()
    return completedLedger
  }

  return Object.freeze({ roll, rollTable, snapshot, complete })
}
