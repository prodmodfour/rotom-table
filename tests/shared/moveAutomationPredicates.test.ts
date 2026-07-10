import { describe, expect, it } from 'vitest'
import {
  MOVE_COMPARISON_OPERATORS,
  MOVE_PREDICATE_KINDS,
  MOVE_PREDICATE_LIMITS,
  MovePredicateValidationError,
  parseMovePredicate,
  type MovePredicateValidationCode,
} from '#shared/moveAutomation/predicates'

const constantExpression = (value: string | number | boolean | null) => ({
  kind: 'constant',
  value,
})
const constantPredicate = (value: boolean) => ({ kind: 'constant', value })

const expectPredicateError = (
  value: unknown,
  code: MovePredicateValidationCode,
  path?: string,
): MovePredicateValidationError => {
  try {
    parseMovePredicate(value)
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(MovePredicateValidationError)
    expect((error as MovePredicateValidationError).code).toBe(code)
    if (path) expect((error as MovePredicateValidationError).path).toBe(path)
    return error as MovePredicateValidationError
  }
}

const expectDeeplyFrozen = (value: unknown, seen = new WeakSet<object>()): void => {
  if (typeof value !== 'object' || value === null || seen.has(value)) return
  seen.add(value)
  expect(Object.isFrozen(value)).toBe(true)
  for (const child of Object.values(value)) expectDeeplyFrozen(child, seen)
}

describe('MoveSpec boolean predicate AST', () => {
  it('defines closed comparison and boolean-composition unions', () => {
    expect(MOVE_PREDICATE_KINDS).toEqual([
      'constant',
      'comparison',
      'all',
      'any',
      'not',
    ])
    expect(MOVE_COMPARISON_OPERATORS).toEqual([
      'equal',
      'not-equal',
      'less-than',
      'less-than-or-equal',
      'greater-than',
      'greater-than-or-equal',
    ])
    expect(parseMovePredicate(constantPredicate(true))).toEqual(constantPredicate(true))
  })

  it('parses each comparison operator over typed expressions', () => {
    for (const operator of MOVE_COMPARISON_OPERATORS) {
      expect(parseMovePredicate({
        kind: 'comparison',
        operator,
        left: {
          kind: 'hp-ratio',
          subject: { kind: 'current-target' },
          ratio: 'current-to-maximum',
        },
        right: constantExpression(0.5),
      })).toEqual({
        kind: 'comparison',
        operator,
        left: {
          kind: 'hp-ratio',
          subject: { kind: 'current-target' },
          ratio: 'current-to-maximum',
        },
        right: constantExpression(0.5),
      })
    }
  })

  it('composes type, weather, terrain, and history comparisons with all/any/not', () => {
    const predicate = parseMovePredicate({
      kind: 'all',
      predicates: [
        {
          kind: 'comparison',
          operator: 'equal',
          left: { kind: 'weather' },
          right: constantExpression('sunny'),
        },
        {
          kind: 'any',
          predicates: [
            {
              kind: 'comparison',
              operator: 'equal',
              left: {
                kind: 'type',
                of: 'primary',
                subject: { kind: 'current-target' },
              },
              right: constantExpression('Fire'),
            },
            {
              kind: 'not',
              predicate: {
                kind: 'comparison',
                operator: 'equal',
                left: {
                  kind: 'move-history',
                  subject: { kind: 'actor' },
                  query: 'acted-this-turn',
                },
                right: constantExpression(true),
              },
            },
          ],
        },
        {
          kind: 'comparison',
          operator: 'not-equal',
          left: { kind: 'terrain' },
          right: constantExpression(null),
        },
      ],
    })

    expect(predicate).toMatchObject({
      kind: 'all',
      predicates: [
        { kind: 'comparison', left: { kind: 'weather' } },
        { kind: 'any', predicates: [{ kind: 'comparison' }, { kind: 'not' }] },
        { kind: 'comparison', left: { kind: 'terrain' } },
      ],
    })
    expectDeeplyFrozen(predicate)
    expect(JSON.parse(JSON.stringify(predicate))).toEqual(predicate)
    expect(structuredClone(predicate)).toEqual(predicate)
  })

  it('returns detached data', () => {
    const input = {
      kind: 'all',
      predicates: [
        constantPredicate(true),
        {
          kind: 'comparison',
          operator: 'greater-than',
          left: constantExpression(3),
          right: constantExpression(2),
        },
      ],
    }
    const predicate = parseMovePredicate(input)
    input.predicates[0].kind = 'not'
    input.predicates.push(constantPredicate(false))

    expect(predicate).toEqual({
      kind: 'all',
      predicates: [
        constantPredicate(true),
        {
          kind: 'comparison',
          operator: 'greater-than',
          left: constantExpression(3),
          right: constantExpression(2),
        },
      ],
    })
  })

  it('rejects source strings, regex nodes, callbacks, and unknown shapes', () => {
    expectPredicateError('actor.hp > 0', 'not-json', 'predicate')
    expectPredicateError(
      { kind: 'source', source: 'actor.hp > 0' },
      'unknown-predicate-kind',
      'predicate.kind',
    )
    expectPredicateError(
      { kind: 'regex', pattern: '.*', input: 'target.type' },
      'unknown-predicate-kind',
      'predicate.kind',
    )
    expectPredicateError(
      {
        kind: 'comparison',
        operator: 'equal',
        left: constantExpression(1),
        right: constantExpression(1),
        evaluate: () => true,
      },
      'invalid-predicate',
      'predicate',
    )
    expectPredicateError(
      {
        kind: 'comparison',
        operator: 'matches',
        left: constantExpression('Fire'),
        right: constantExpression('F.*'),
      },
      'invalid-predicate',
      'predicate.operator',
    )
    expectPredicateError(
      {
        kind: 'comparison',
        operator: 'equal',
        left: { kind: 'client-value', value: 1 },
        right: constantExpression(1),
      },
      'unknown-expression-kind',
      'predicate.left.kind',
    )
  })

  it('enforces non-empty bounded lists, node count, depth, and nested strings', () => {
    expectPredicateError(
      { kind: 'all', predicates: [] },
      'invalid-predicate',
      'predicate.predicates',
    )
    expectPredicateError(
      {
        kind: 'any',
        predicates: Array.from(
          { length: MOVE_PREDICATE_LIMITS.listSize + 1 },
          () => constantPredicate(true),
        ),
      },
      'limit-exceeded',
      'predicate.predicates',
    )
    expectPredicateError(
      {
        kind: 'comparison',
        operator: 'equal',
        left: constantExpression('x'.repeat(MOVE_PREDICATE_LIMITS.stringLength + 1)),
        right: constantExpression('x'),
      },
      'limit-exceeded',
      'predicate.left.value',
    )

    const crowded = {
      kind: 'all',
      predicates: Array.from({ length: MOVE_PREDICATE_LIMITS.listSize }, () => ({
        kind: 'any',
        predicates: Array.from({ length: 8 }, () => constantPredicate(true)),
      })),
    }
    expectPredicateError(crowded, 'limit-exceeded')

    let deep: unknown = constantPredicate(true)
    for (let index = 0; index < MOVE_PREDICATE_LIMITS.depth; index += 1) {
      deep = { kind: 'not', predicate: deep }
    }
    expectPredicateError(deep, 'limit-exceeded')
  })

  it('rejects invalid booleans and non-JSON/accessor input without execution', () => {
    expectPredicateError(
      { kind: 'constant', value: 'true' },
      'invalid-predicate',
      'predicate.value',
    )
    expectPredicateError(
      { kind: 'not', predicate: constantPredicate(true), script: 'invert' },
      'invalid-predicate',
      'predicate',
    )

    let getterCalled = false
    const predicate = Object.defineProperty({ kind: 'constant' }, 'value', {
      enumerable: true,
      get: () => {
        getterCalled = true
        return true
      },
    })
    expectPredicateError(predicate, 'not-json', 'predicate.value')
    expect(getterCalled).toBe(false)
    expectPredicateError(new Date(), 'not-json', 'predicate')

    const sparsePredicates = new Array(2)
    sparsePredicates[0] = constantPredicate(true)
    expectPredicateError(
      { kind: 'all', predicates: sparsePredicates },
      'not-json',
      'predicate.predicates[1]',
    )
  })
})
