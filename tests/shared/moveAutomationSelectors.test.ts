import { describe, expect, it } from 'vitest'
import {
  MOVE_SELECTOR_KINDS,
  MOVE_SELECTOR_LEAF_KINDS,
  MOVE_SELECTOR_LIMITS,
  MoveSelectorValidationError,
  parseMoveSelector,
  type MoveSelectorValidationCode,
} from '#shared/moveAutomation/selectors'

const expectSelectorError = (
  value: unknown,
  code: MoveSelectorValidationCode,
  path?: string,
): MoveSelectorValidationError => {
  try {
    parseMoveSelector(value)
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(MoveSelectorValidationError)
    expect((error as MoveSelectorValidationError).code).toBe(code)
    if (path) expect((error as MoveSelectorValidationError).path).toBe(path)
    return error as MoveSelectorValidationError
  }
}

const expectDeeplyFrozen = (value: unknown, seen = new WeakSet<object>()): void => {
  if (typeof value !== 'object' || value === null || seen.has(value)) return
  seen.add(value)
  expect(Object.isFrozen(value)).toBe(true)
  for (const child of Object.values(value)) expectDeeplyFrozen(child, seen)
}

describe('MoveSpec selector AST', () => {
  it('defines interpreter-owned leaves without accepting placement ids', () => {
    expect(MOVE_SELECTOR_KINDS).toEqual([
      'actor',
      'current-target',
      'selected-targets',
      'candidate-targets',
      'attacked-targets',
      'hit-targets',
      'missed-targets',
      'damaged-targets',
      'fainted-targets',
      'area-targets',
      'source-placement',
      'union',
      'intersection',
      'difference',
    ])

    expect(MOVE_SELECTOR_LEAF_KINDS.map(kind => parseMoveSelector({ kind }))).toEqual(
      MOVE_SELECTOR_LEAF_KINDS.map(kind => ({ kind })),
    )
    expectSelectorError(
      { kind: 'selected-targets', placementIds: ['client-selected-id'] },
      'invalid-selector',
      'selector',
    )
    expectSelectorError(
      { kind: 'client-selected-targets' },
      'unknown-selector-kind',
      'selector.kind',
    )
  })

  it('parses bounded set union, intersection, and difference composition', () => {
    const selector = parseMoveSelector({
      kind: 'difference',
      source: {
        kind: 'intersection',
        selectors: [
          { kind: 'area-targets' },
          {
            kind: 'union',
            selectors: [{ kind: 'hit-targets' }, { kind: 'missed-targets' }],
          },
        ],
      },
      exclude: { kind: 'actor' },
    })

    expect(selector).toEqual({
      kind: 'difference',
      source: {
        kind: 'intersection',
        selectors: [
          { kind: 'area-targets' },
          {
            kind: 'union',
            selectors: [{ kind: 'hit-targets' }, { kind: 'missed-targets' }],
          },
        ],
      },
      exclude: { kind: 'actor' },
    })
    expectDeeplyFrozen(selector)
    expect(JSON.parse(JSON.stringify(selector))).toEqual(selector)
    expect(structuredClone(selector)).toEqual(selector)
  })

  it('returns detached data and rejects malformed composition', () => {
    const input = {
      kind: 'union',
      selectors: [{ kind: 'actor' }, { kind: 'selected-targets' }],
    }
    const selector = parseMoveSelector(input)
    input.selectors[0].kind = 'candidate-targets'
    input.selectors.push({ kind: 'hit-targets' })

    expect(selector).toEqual({
      kind: 'union',
      selectors: [{ kind: 'actor' }, { kind: 'selected-targets' }],
    })
    expectSelectorError(
      { kind: 'union', selectors: [{ kind: 'actor' }] },
      'invalid-selector',
      'selector.selectors',
    )
    expectSelectorError(
      { kind: 'difference', source: { kind: 'actor' } },
      'invalid-selector',
      'selector',
    )
    expectSelectorError(
      {
        kind: 'difference',
        source: { kind: 'actor' },
        exclude: { kind: 'selected-targets' },
        callback: 'not-allowed',
      },
      'invalid-selector',
      'selector',
    )
  })

  it('enforces list size, aggregate node count, and recursion depth', () => {
    expectSelectorError(
      {
        kind: 'union',
        selectors: Array.from(
          { length: MOVE_SELECTOR_LIMITS.listSize + 1 },
          () => ({ kind: 'actor' }),
        ),
      },
      'limit-exceeded',
      'selector.selectors',
    )

    const crowded = {
      kind: 'union',
      selectors: Array.from({ length: MOVE_SELECTOR_LIMITS.listSize }, () => ({
        kind: 'union',
        selectors: Array.from({ length: 8 }, () => ({ kind: 'actor' })),
      })),
    }
    expectSelectorError(crowded, 'limit-exceeded')

    let deep: unknown = { kind: 'actor' }
    for (let index = 0; index < MOVE_SELECTOR_LIMITS.depth; index += 1) {
      deep = { kind: 'difference', source: deep, exclude: { kind: 'actor' } }
    }
    expectSelectorError(deep, 'limit-exceeded')
  })

  it('rejects accessors, class instances, symbols, and lossy arrays without execution', () => {
    let getterCalled = false
    const selector = Object.defineProperty({}, 'kind', {
      enumerable: true,
      get: () => {
        getterCalled = true
        return 'actor'
      },
    })
    expectSelectorError(selector, 'not-json', 'selector.kind')
    expect(getterCalled).toBe(false)
    expectSelectorError(new Date(), 'not-json', 'selector')

    const sparse = new Array(2)
    sparse[0] = { kind: 'actor' }
    expectSelectorError(
      { kind: 'union', selectors: sparse },
      'not-json',
      'selector.selectors[1]',
    )

    const symbolSelector = { kind: 'actor' }
    Object.defineProperty(symbolSelector, Symbol('script'), { value: () => 'run' })
    expectSelectorError(symbolSelector, 'not-json', 'selector')
  })
})
