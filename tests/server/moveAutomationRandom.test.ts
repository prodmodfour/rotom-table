import { describe, expect, it } from 'vitest'
import {
  AuthoritativeMoveRandomError,
  createAuthoritativeMoveRandom,
  createFiniteAuthoritativeMoveRandomStream,
} from '~~/server/domain/moveAutomation/random'
import {
  createMoveAutomationReplayRandom,
  MoveAutomationReplayRandomError,
} from '~~/server/domain/moveAutomation/replayRandom'

const expectRandomError = (
  run: () => unknown,
  code: AuthoritativeMoveRandomError['code'],
): AuthoritativeMoveRandomError => {
  try {
    run()
  }
  catch (error) {
    expect(error).toBeInstanceOf(AuthoritativeMoveRandomError)
    expect((error as AuthoritativeMoveRandomError).code).toBe(code)
    return error as AuthoritativeMoveRandomError
  }
  throw new Error(`Expected ${code}`)
}

describe('authoritative move randomness', () => {
  it('records stable dice IDs, natural results, modifiers, and final values', () => {
    const stream = createFiniteAuthoritativeMoveRandomStream([0.5, 0, 0.75])
    const random = createAuthoritativeMoveRandom(stream)

    const accuracy = random.roll({
      parentEffectId: 'effect.accuracy',
      reason: 'Accuracy check',
      formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
      modifiers: [{ sourceId: 'user-accuracy', reason: 'User Accuracy', value: 2 }],
    })
    const damage = random.roll({
      parentEffectId: 'effect.damage',
      reason: 'Damage roll',
      formula: { kind: 'dice', count: 2, sides: 6, modifier: 3 },
    })

    expect(accuracy).toEqual({
      naturalResults: [11],
      naturalResult: 11,
      modifiedResult: 13,
      finalValue: 13,
    })
    expect(damage).toEqual({
      naturalResults: [1, 5],
      naturalResult: 6,
      modifiedResult: 9,
      finalValue: 9,
    })
    expect(random.complete()).toEqual([
      {
        rollId: 'roll.0001',
        parentEffectId: 'effect.accuracy',
        formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        reason: 'Accuracy check',
        naturalResults: [11],
        naturalResult: 11,
        modifiers: [{ sourceId: 'user-accuracy', reason: 'User Accuracy', value: 2 }],
        finalValue: 13,
      },
      {
        rollId: 'roll.0002',
        parentEffectId: 'effect.damage',
        formula: { kind: 'dice', count: 2, sides: 6, modifier: 3 },
        reason: 'Damage roll',
        naturalResults: [1, 5],
        naturalResult: 6,
        modifiers: [],
        finalValue: 9,
      },
    ])
    expect(stream.consumed).toBe(3)
    expect(stream.remaining).toBe(0)
    expect(Object.isFrozen(random.complete())).toBe(true)
    expect(Object.isFrozen(random.complete()[0]?.naturalResults)).toBe(true)
  })

  it('records reviewed table identity and its selected numeric result', () => {
    const random = createAuthoritativeMoveRandom(
      createFiniteAuthoritativeMoveRandomStream([0.99]),
    )

    const result = random.rollTable({
      rollId: 'hit-count.1',
      parentEffectId: 'effect.hit-count',
      reason: 'Five Strike hit count',
      formula: { kind: 'table', tableId: 'five-strike-hit-count' },
      drawFormula: { kind: 'dice', count: 1, sides: 8, modifier: 0 },
      entries: [
        { minimum: 1, maximum: 1, value: 1 },
        { minimum: 2, maximum: 3, value: 2 },
        { minimum: 4, maximum: 6, value: 3 },
        { minimum: 7, maximum: 7, value: 4 },
        { minimum: 8, maximum: 8, value: 5 },
      ],
    })

    expect(result).toEqual({
      naturalResults: [8],
      naturalResult: 8,
      modifiedResult: 8,
      finalValue: 5,
    })
    expect(random.complete()).toEqual([
      expect.objectContaining({
        rollId: 'hit-count.1',
        formula: { kind: 'table', tableId: 'five-strike-hit-count' },
        naturalResults: [8],
        naturalResult: 8,
        finalValue: 5,
      }),
    ])
  })

  it('replays durable table draws before consuming fresh continuation entropy', () => {
    const tableRequest = {
      rollId: 'hit-count.1',
      parentEffectId: 'effect.hit-count',
      reason: 'Five Strike hit count',
      formula: { kind: 'table' as const, tableId: 'five-strike-hit-count' },
      drawFormula: { kind: 'dice' as const, count: 1, sides: 8, modifier: 0 },
      entries: [
        { minimum: 1, maximum: 1, value: 1 },
        { minimum: 2, maximum: 3, value: 2 },
        { minimum: 4, maximum: 6, value: 3 },
        { minimum: 7, maximum: 7, value: 4 },
        { minimum: 8, maximum: 8, value: 5 },
      ],
    }
    const original = createAuthoritativeMoveRandom(
      createFiniteAuthoritativeMoveRandomStream([0.99]),
    )
    original.rollTable(tableRequest)
    const durableLedger = original.complete()
    const freshStream = createFiniteAuthoritativeMoveRandomStream([0])
    const replay = createMoveAutomationReplayRandom(durableLedger, freshStream)

    expect(replay.rollTable(tableRequest)).toEqual({
      naturalResults: [8],
      naturalResult: 8,
      modifiedResult: 8,
      finalValue: 5,
    })
    expect(freshStream.consumed).toBe(0)
    expect(replay.roll({
      rollId: 'continuation.roll',
      parentEffectId: 'effect.continuation',
      reason: 'Continuation roll',
      formula: { kind: 'dice', count: 1, sides: 6, modifier: 0 },
    })).toMatchObject({ naturalResult: 1, finalValue: 1 })
    expect(replay.complete()).toEqual([
      ...durableLedger,
      expect.objectContaining({ rollId: 'continuation.roll', naturalResult: 1 }),
    ])
    expect(freshStream.consumed).toBe(1)
  })

  it('fails closed when a durable table result no longer matches its reviewed request', () => {
    const original = createAuthoritativeMoveRandom(
      createFiniteAuthoritativeMoveRandomStream([0.99]),
    )
    original.rollTable({
      rollId: 'hit-count.1',
      parentEffectId: 'effect.hit-count',
      reason: 'Five Strike hit count',
      formula: { kind: 'table', tableId: 'five-strike-hit-count' },
      drawFormula: { kind: 'dice', count: 1, sides: 8, modifier: 0 },
      entries: [{ minimum: 1, maximum: 8, value: 5 }],
    })
    const replay = createMoveAutomationReplayRandom(original.complete(), () => 0)

    expect(() => replay.rollTable({
      rollId: 'hit-count.1',
      parentEffectId: 'effect.hit-count',
      reason: 'Five Strike hit count',
      formula: { kind: 'table', tableId: 'five-strike-hit-count' },
      drawFormula: { kind: 'dice', count: 1, sides: 8, modifier: 0 },
      entries: [{ minimum: 1, maximum: 8, value: 4 }],
    })).toThrowError(expect.objectContaining({
      name: 'MoveAutomationReplayRandomError',
      code: 'replay-request-mismatch',
    } satisfies Partial<MoveAutomationReplayRandomError>))
  })

  it('replays the same requests and finite draws to the same ledger', () => {
    const resolve = () => {
      const random = createAuthoritativeMoveRandom(
        createFiniteAuthoritativeMoveRandomStream([0.25, 0.75]),
      )
      random.roll({
        parentEffectId: 'effect.first',
        reason: 'First roll',
        formula: { kind: 'uniform-integer', minimum: 1, maximum: 4 },
      })
      random.roll({
        parentEffectId: 'effect.second',
        reason: 'Second roll',
        formula: { kind: 'dice', count: 1, sides: 6, modifier: 1 },
      })
      return random.complete()
    }

    expect(resolve()).toEqual(resolve())
  })

  it('rejects missing, excess, invalid, and duplicate draws or requests', () => {
    const missing = createAuthoritativeMoveRandom(
      createFiniteAuthoritativeMoveRandomStream([]),
    )
    expectRandomError(() => missing.roll({
      parentEffectId: 'effect.missing',
      reason: 'Missing draw',
      formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
    }), 'missing-random-draw')

    const excessStream = createFiniteAuthoritativeMoveRandomStream([0, 0.5])
    const excess = createAuthoritativeMoveRandom(excessStream)
    excess.roll({
      parentEffectId: 'effect.excess',
      reason: 'Excess draw',
      formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
    })
    expectRandomError(() => excess.complete(), 'excess-random-draws')
    expect(excessStream.remaining).toBe(1)

    expectRandomError(
      () => createFiniteAuthoritativeMoveRandomStream([1]),
      'invalid-random-source-value',
    )

    const duplicate = createAuthoritativeMoveRandom(
      createFiniteAuthoritativeMoveRandomStream([0]),
    )
    duplicate.roll({
      rollId: 'explicit-roll',
      parentEffectId: 'effect.duplicate',
      reason: 'First request',
      formula: { kind: 'dice', count: 1, sides: 6, modifier: 0 },
    })
    expectRandomError(() => duplicate.roll({
      rollId: 'explicit-roll',
      parentEffectId: 'effect.duplicate',
      reason: 'Duplicate request',
      formula: { kind: 'dice', count: 1, sides: 6, modifier: 0 },
    }), 'duplicate-roll-id')
    expect(duplicate.complete()).toHaveLength(1)
  })
})
