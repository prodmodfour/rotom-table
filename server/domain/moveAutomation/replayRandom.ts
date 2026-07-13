import type { MoveAutomationRollLedgerEntry } from '#shared/moveAutomation/random'
import type { AuthoritativeMoveRandomSource } from './random'

export type MoveAutomationReplayRandomErrorCode = 'unsupported-replay-formula'

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

const sourceValueForInteger = (
  value: number,
  minimum: number,
  maximum: number,
): number => {
  const range = maximum - minimum + 1
  return (value - minimum + 0.5) / range
}

/**
 * Replay every already-recorded natural draw before using fresh server entropy.
 * The resumed interpreter subsequently compares its complete prefix ledger with
 * durable state, so changed formulas/modifiers fail closed rather than reroll.
 */
export const createMoveAutomationReplayRandomSource = (
  ledger: readonly MoveAutomationRollLedgerEntry[],
  fresh: AuthoritativeMoveRandomSource = Math.random,
): AuthoritativeMoveRandomSource => {
  const replayValues = ledger.flatMap((entry) => {
    if (entry.formula.kind === 'dice') {
      const { sides } = entry.formula
      return entry.naturalResults.map(result => sourceValueForInteger(result, 1, sides))
    }
    if (entry.formula.kind === 'uniform-integer') {
      const { minimum, maximum } = entry.formula
      return entry.naturalResults.map(result => sourceValueForInteger(
        result,
        minimum,
        maximum,
      ))
    }
    return fail(
      'unsupported-replay-formula',
      `Stored table roll ${entry.rollId} cannot be replayed without its reviewed draw formula.`,
    )
  })
  let replayIndex = 0

  const freshDraw = (): number => typeof fresh === 'function' ? fresh() : fresh.draw()
  return () => {
    const replay = replayValues[replayIndex]
    if (replay !== undefined) {
      replayIndex += 1
      return replay
    }
    return freshDraw()
  }
}
