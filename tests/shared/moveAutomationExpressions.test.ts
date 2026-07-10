import { describe, expect, it } from 'vitest'
import {
  MOVE_ARITHMETIC_OPERATORS,
  MOVE_EXPRESSION_KINDS,
  MOVE_EXPRESSION_LIMITS,
  MOVE_HISTORY_QUERIES,
  MoveExpressionValidationError,
  parseMoveExpression,
  type MoveExpressionValidationCode,
} from '#shared/moveAutomation/expressions'

const target = () => ({ kind: 'current-target' })
const constant = (value: string | number | boolean | null) => ({ kind: 'constant', value })

const expectExpressionError = (
  value: unknown,
  code: MoveExpressionValidationCode,
  path?: string,
): MoveExpressionValidationError => {
  try {
    parseMoveExpression(value)
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(MoveExpressionValidationError)
    expect((error as MoveExpressionValidationError).code).toBe(code)
    if (path) expect((error as MoveExpressionValidationError).path).toBe(path)
    return error as MoveExpressionValidationError
  }
}

const expectDeeplyFrozen = (value: unknown, seen = new WeakSet<object>()): void => {
  if (typeof value !== 'object' || value === null || seen.has(value)) return
  seen.add(value)
  expect(Object.isFrozen(value)).toBe(true)
  for (const child of Object.values(value)) expectDeeplyFrozen(child, seen)
}

describe('MoveSpec rules expression AST', () => {
  it('defines constants, arithmetic, aggregate, query, and context node kinds', () => {
    expect(MOVE_EXPRESSION_KINDS).toEqual([
      'constant',
      'arithmetic',
      'min',
      'max',
      'clamp',
      'lookup-table',
      'stat',
      'hp-ratio',
      'combat-stage',
      'weight',
      'type',
      'weather',
      'terrain',
      'move-history',
    ])
    expect(MOVE_ARITHMETIC_OPERATORS).toEqual([
      'add',
      'subtract',
      'multiply',
      'divide',
      'modulo',
    ])

    expect(parseMoveExpression(constant(4))).toEqual(constant(4))
    expect(parseMoveExpression(constant('Fire'))).toEqual(constant('Fire'))
    expect(parseMoveExpression(constant(true))).toEqual(constant(true))
    expect(parseMoveExpression(constant(null))).toEqual(constant(null))
  })

  it('parses arithmetic, min/max, and clamp without accepting source text', () => {
    const expression = parseMoveExpression({
      kind: 'clamp',
      value: {
        kind: 'arithmetic',
        operator: 'add',
        operands: [
          {
            kind: 'max',
            values: [constant(2), constant(4)],
          },
          {
            kind: 'min',
            values: [constant(8), constant(10)],
          },
        ],
      },
      minimum: constant(1),
      maximum: constant(20),
    })

    expect(expression.kind).toBe('clamp')
    expect(expression).toMatchObject({
      value: {
        kind: 'arithmetic',
        operator: 'add',
        operands: [{ kind: 'max' }, { kind: 'min' }],
      },
      minimum: { kind: 'constant', value: 1 },
      maximum: { kind: 'constant', value: 20 },
    })
    expectExpressionError('actor.attack + 2', 'not-json', 'expression')
    expectExpressionError(
      { kind: 'source', source: 'actor.attack + 2' },
      'unknown-expression-kind',
      'expression.kind',
    )
    expectExpressionError(
      {
        kind: 'arithmetic',
        operator: 'add',
        operands: [constant(1), constant(2)],
        eval: 'actor.attack + 2',
      },
      'invalid-expression',
      'expression',
    )
  })

  it('parses lookup tables with bounded scalar keys and recursive values', () => {
    const expression = parseMoveExpression({
      kind: 'lookup-table',
      input: { kind: 'weather' },
      entries: [
        { key: 'sunny', value: constant(2 / 3) },
        { key: 'rainy', value: constant(0.5) },
        { key: null, value: constant(0.5) },
      ],
      fallback: constant(0.5),
    })

    expect(expression).toEqual({
      kind: 'lookup-table',
      input: { kind: 'weather' },
      entries: [
        { key: 'sunny', value: constant(2 / 3) },
        { key: 'rainy', value: constant(0.5) },
        { key: null, value: constant(0.5) },
      ],
      fallback: constant(0.5),
    })
    expectExpressionError(
      {
        kind: 'lookup-table',
        input: constant('sunny'),
        entries: [
          { key: 'sunny', value: constant(2) },
          { key: 'sunny', value: constant(3) },
        ],
        fallback: constant(1),
      },
      'duplicate-key',
      'expression.entries.key',
    )
  })

  it('parses selected stats, HP ratios, stages, weight, type, and fields', () => {
    expect(parseMoveExpression({
      kind: 'stat',
      subject: target(),
      stat: 'special-defense',
    })).toEqual({ kind: 'stat', subject: target(), stat: 'special-defense' })
    expect(parseMoveExpression({
      kind: 'hp-ratio',
      subject: target(),
      ratio: 'missing-to-maximum',
    })).toEqual({
      kind: 'hp-ratio',
      subject: target(),
      ratio: 'missing-to-maximum',
    })
    expect(parseMoveExpression({
      kind: 'combat-stage',
      subject: { kind: 'actor' },
      stage: 'satk',
    })).toEqual({
      kind: 'combat-stage',
      subject: { kind: 'actor' },
      stage: 'satk',
    })
    expect(parseMoveExpression({
      kind: 'weight',
      subject: target(),
      metric: 'weight-class',
    })).toEqual({ kind: 'weight', subject: target(), metric: 'weight-class' })
    expect(parseMoveExpression({ kind: 'type', of: 'move', subject: null })).toEqual({
      kind: 'type',
      of: 'move',
      subject: null,
    })
    expect(parseMoveExpression({
      kind: 'type',
      of: 'primary',
      subject: target(),
    })).toEqual({ kind: 'type', of: 'primary', subject: target() })
    expect(parseMoveExpression({ kind: 'weather' })).toEqual({ kind: 'weather' })
    expect(parseMoveExpression({ kind: 'terrain' })).toEqual({ kind: 'terrain' })

    expectExpressionError(
      { kind: 'stat', subject: target(), stat: 'client-value' },
      'invalid-expression',
      'expression.stat',
    )
    expectExpressionError(
      { kind: 'type', of: 'move', subject: target() },
      'invalid-expression',
      'expression.subject',
    )
    expectExpressionError(
      { kind: 'type', of: 'primary', subject: null },
      'invalid-expression',
      'expression.subject',
    )
    expectExpressionError(
      { kind: 'weight', subject: { kind: 'placement-id', id: 'forged' }, metric: 'kilograms' },
      'unknown-selector-kind',
      'expression.subject.kind',
    )
  })

  it('parses only the closed move-history query set', () => {
    for (const query of MOVE_HISTORY_QUERIES) {
      expect(parseMoveExpression({
        kind: 'move-history',
        subject: { kind: 'actor' },
        query,
      })).toEqual({ kind: 'move-history', subject: { kind: 'actor' }, query })
    }
    expectExpressionError(
      {
        kind: 'move-history',
        subject: { kind: 'actor' },
        query: 'parse-log-text',
      },
      'invalid-expression',
      'expression.query',
    )
  })

  it('returns detached, deeply immutable, round-trip-safe JSON data', () => {
    const input = {
      kind: 'arithmetic',
      operator: 'multiply',
      operands: [
        { kind: 'stat', subject: { kind: 'actor' }, stat: 'attack' },
        constant(2),
      ],
    }
    const expression = parseMoveExpression(input)
    expectDeeplyFrozen(expression)

    input.operator = 'add'
    input.operands[0].kind = 'constant'
    input.operands.push(constant(99))

    expect(expression).toEqual({
      kind: 'arithmetic',
      operator: 'multiply',
      operands: [
        { kind: 'stat', subject: { kind: 'actor' }, stat: 'attack' },
        constant(2),
      ],
    })
    expect(JSON.parse(JSON.stringify(expression))).toEqual(expression)
    expect(structuredClone(expression)).toEqual(expression)
  })

  it('enforces expression list, string, numeric, depth, and aggregate node limits', () => {
    expectExpressionError(
      {
        kind: 'arithmetic',
        operator: 'add',
        operands: Array.from(
          { length: MOVE_EXPRESSION_LIMITS.listSize + 1 },
          () => constant(1),
        ),
      },
      'limit-exceeded',
      'expression.operands',
    )
    expectExpressionError(
      constant('x'.repeat(MOVE_EXPRESSION_LIMITS.stringLength + 1)),
      'limit-exceeded',
      'expression.value',
    )
    expectExpressionError(constant(Number.NaN), 'not-json', 'expression.value')
    expectExpressionError(
      constant(MOVE_EXPRESSION_LIMITS.numericMagnitude + 1),
      'limit-exceeded',
      'expression.value',
    )

    let deep: unknown = constant(1)
    for (let index = 0; index < MOVE_EXPRESSION_LIMITS.depth; index += 1) {
      deep = {
        kind: 'clamp',
        value: deep,
        minimum: constant(0),
        maximum: constant(10),
      }
    }
    expectExpressionError(deep, 'limit-exceeded')

    const crowded = {
      kind: 'arithmetic',
      operator: 'add',
      operands: Array.from({ length: MOVE_EXPRESSION_LIMITS.listSize }, () => ({
        kind: 'arithmetic',
        operator: 'add',
        operands: Array.from({ length: 8 }, () => constant(1)),
      })),
    }
    expectExpressionError(crowded, 'limit-exceeded')
  })

  it('enforces operator arity and rejects unknown fields and lossy input', () => {
    expectExpressionError(
      {
        kind: 'arithmetic',
        operator: 'subtract',
        operands: [constant(3), constant(2), constant(1)],
      },
      'invalid-expression',
      'expression.operands',
    )
    expectExpressionError(
      { kind: 'min', values: [] },
      'invalid-expression',
      'expression.values',
    )
    expectExpressionError(
      { kind: 'weather', clientWeather: 'sunny' },
      'invalid-expression',
      'expression',
    )

    let getterCalled = false
    const expression = Object.defineProperty({ kind: 'constant' }, 'value', {
      enumerable: true,
      get: () => {
        getterCalled = true
        return 1
      },
    })
    expectExpressionError(expression, 'not-json', 'expression.value')
    expect(getterCalled).toBe(false)
    expectExpressionError(
      { kind: 'constant', value: () => 1 },
      'not-json',
      'expression.value',
    )
    expectExpressionError(new Date(), 'not-json', 'expression')

    const sparseOperands = new Array(2)
    sparseOperands[0] = constant(1)
    expectExpressionError(
      { kind: 'arithmetic', operator: 'add', operands: sparseOperands },
      'not-json',
      'expression.operands[1]',
    )
  })
})
