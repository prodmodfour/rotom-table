import { describe, expect, it } from 'vitest'
import {
  MoveAutomationRollLedgerValidationError,
  parseMoveAutomationRollLedger,
  type MoveAutomationRollLedgerEntry,
} from '#shared/moveAutomation/random'

const entry = (overrides: Partial<MoveAutomationRollLedgerEntry> = {}): MoveAutomationRollLedgerEntry => ({
  rollId: 'roll.accuracy.1',
  parentEffectId: 'effect.accuracy',
  formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
  reason: 'Accuracy check',
  naturalResults: [14],
  naturalResult: 14,
  modifiers: [{ sourceId: 'user-accuracy', reason: 'User Accuracy', value: 2 }],
  finalValue: 16,
  ...overrides,
})

const expectInvalid = (value: unknown, code: MoveAutomationRollLedgerValidationError['code']) => {
  try {
    parseMoveAutomationRollLedger(value)
  }
  catch (error) {
    expect(error).toBeInstanceOf(MoveAutomationRollLedgerValidationError)
    expect((error as MoveAutomationRollLedgerValidationError).code).toBe(code)
    return error as MoveAutomationRollLedgerValidationError
  }
  throw new Error(`Expected ${code}`)
}

describe('move automation roll-ledger contract', () => {
  it('strictly parses detached dice and table entries', () => {
    const source = [
      entry(),
      entry({
        rollId: 'roll.hit-count.1',
        parentEffectId: 'effect.hit-count',
        formula: { kind: 'table', tableId: 'five-strike-hit-count' },
        reason: 'Hit-count table',
        naturalResults: [8],
        naturalResult: 8,
        modifiers: [],
        finalValue: 5,
      }),
    ]

    const parsed = parseMoveAutomationRollLedger(source)

    expect(parsed).toEqual(source)
    expect(parsed).not.toBe(source)
    expect(parsed[0]).not.toBe(source[0])
    expect(parsed[0]?.naturalResults).not.toBe(source[0]?.naturalResults)
  })

  it('rejects duplicate IDs, unknown fields, impossible totals, and malformed formulas', () => {
    expectInvalid([entry(), entry()], 'duplicate-roll-id')
    expectInvalid([{ ...entry(), clientRoll: 20 }], 'invalid-roll-ledger')
    expectInvalid([{ ...entry(), naturalResult: 13 }], 'invalid-roll-ledger')
    expectInvalid([{ ...entry(), finalValue: 99 }], 'invalid-roll-ledger')
    expectInvalid([entry({
      formula: { kind: 'dice', count: 2, sides: 20, modifier: 0 },
    })], 'invalid-roll-ledger')
  })
})
