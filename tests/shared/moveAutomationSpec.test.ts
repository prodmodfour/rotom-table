import { describe, expect, it } from 'vitest'
import {
  MOVE_SPEC_LIMITS,
  MOVE_SPEC_PHASES,
  MOVE_SPEC_SCHEMA_VERSION,
  MoveSpecValidationError,
  parseMoveSpec,
  type MoveSpecValidationCode,
} from '#shared/moveAutomation/spec'

const validSpec = () => ({
  schemaVersion: 2,
  canonicalId: 'Scratch',
  version: 1,
  targeting: {
    kind: 'area',
    minTargets: 1,
    maxTargets: 1,
    selector: {
      kind: 'relationship',
      relationship: 'enemy',
    },
    predicate: {
      relationship: 'enemy',
      willingness: 'any',
      excludeActor: true,
      statePredicates: [{ kind: 'vitality', value: 'conscious' }],
    },
  },
  preconditions: [{
    id: 'actor.conscious',
    predicate: {
      kind: 'placement-state',
      subject: 'actor',
      state: 'conscious',
    },
    failureReasonCode: 'actor.fainted',
  }],
  costs: [{
    id: 'cost.standard-action',
    phase: 'pay',
    cost: {
      kind: 'action-resource',
      resource: 'standard',
      amount: 1,
    },
  }],
  phases: [
    {
      phase: 'declare',
      operations: [{
        id: 'declare.scratch',
        kind: 'log',
        messageKey: 'move.declared',
      }],
    },
    {
      phase: 'accuracy',
      operations: [{
        id: 'accuracy.scratch',
        kind: 'roll',
        formula: '1d20',
      }],
    },
    {
      phase: 'damage',
      operations: [{
        id: 'damage.scratch',
        kind: 'damage',
        recipients: { kind: 'hit-targets' },
      }],
    },
    {
      phase: 'cleanup',
      operations: [],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Scratch',
    vfxKey: 'move.scratch',
    tags: ['contact', 'damage'],
  },
})

const expectSpecError = (
  value: unknown,
  code: MoveSpecValidationCode,
  path?: string,
): MoveSpecValidationError => {
  try {
    parseMoveSpec(value)
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(MoveSpecValidationError)
    expect((error as MoveSpecValidationError).code).toBe(code)
    if (path) expect((error as MoveSpecValidationError).path).toBe(path)
    return error as MoveSpecValidationError
  }
}

const expectDeeplyFrozen = (value: unknown, seen = new WeakSet<object>()): void => {
  if (typeof value !== 'object' || value === null || seen.has(value)) return
  seen.add(value)
  expect(Object.isFrozen(value)).toBe(true)
  for (const child of Object.values(value)) expectDeeplyFrozen(child, seen)
}

describe('MoveSpec v2 contract', () => {
  it('defines the canonical interpreter phase order', () => {
    expect(MOVE_SPEC_SCHEMA_VERSION).toBe(2)
    expect(MOVE_SPEC_PHASES).toEqual([
      'declare',
      'precondition',
      'pay',
      'target',
      'pre-hit',
      'accuracy',
      'hit',
      'miss',
      'damage',
      'after-damage',
      'ko',
      'movement',
      'schedule',
      'usage',
      'cleanup',
    ])
  })

  it('parses a versioned spec envelope with every required declaration', () => {
    const input = validSpec()
    const spec = parseMoveSpec(input)

    expect(spec).toEqual(input)
    expect(spec).toMatchObject({
      schemaVersion: 2,
      canonicalId: 'Scratch',
      version: 1,
      targeting: { kind: 'area', minTargets: 1, maxTargets: 1 },
      registeredHandlerId: null,
      presentation: { displayName: 'Scratch', vfxKey: 'move.scratch' },
    })
    expect(spec.preconditions).toHaveLength(1)
    expect(spec.costs).toHaveLength(1)
    expect(spec.phases.map(({ phase }) => phase)).toEqual([
      'declare',
      'accuracy',
      'damage',
      'cleanup',
    ])
    expect(spec.phases[2].operations[0]).toEqual({
      id: 'damage.scratch',
      kind: 'damage',
      recipients: { kind: 'hit-targets' },
    })
  })

  it('parses every bounded authoritative resource cost policy', () => {
    const spec = parseMoveSpec({
      ...validSpec(),
      costs: [
        { id: 'cost.full', phase: 'pay', cost: { kind: 'action-resource', resource: 'full', amount: 1 } },
        { id: 'cost.movement', phase: 'movement', cost: { kind: 'movement-distance', amount: 'resolved-distance' } },
        { id: 'cost.once', phase: 'usage', cost: { kind: 'once-per-turn', flagId: 'move.once' } },
        { id: 'cost.exhaust', phase: 'cleanup', cost: { kind: 'exhaust', timing: 'next-turn', forfeitCommand: true } },
        { id: 'cost.setup', phase: 'schedule', cost: { kind: 'setup-execute', step: 'set-up' } },
        { id: 'cost.priority', phase: 'declare', cost: { kind: 'priority', mode: 'limited' } },
        { id: 'cost.waived', phase: 'declare', cost: { kind: 'no-cost', reasonCode: 'move.triggered-child' } },
      ],
    })

    expect(spec.costs.map(({ cost }) => cost.kind)).toEqual([
      'action-resource',
      'movement-distance',
      'once-per-turn',
      'exhaust',
      'setup-execute',
      'priority',
      'no-cost',
    ])
    expect(spec.costs[0]?.cost).toEqual({
      kind: 'action-resource', resource: 'full', amount: 1,
    })
    expectDeeplyFrozen(spec.costs)
  })

  it('returns detached, deeply immutable plain JSON data', () => {
    const input = validSpec()
    const spec = parseMoveSpec(input)
    expectDeeplyFrozen(spec)

    input.targeting.selector.relationship = 'ally'
    input.targeting.predicate.relationship = 'ally'
    input.targeting.predicate.statePredicates[0].value = 'fainted'
    input.phases[2].operations[0].kind = 'client-patch'
    input.phases.push({ phase: 'cleanup', operations: [] })

    expect(spec.targeting.selector).toEqual({
      kind: 'relationship',
      relationship: 'enemy',
    })
    expect(spec.targeting.predicate).toEqual({
      relationship: 'enemy',
      willingness: 'any',
      excludeActor: true,
      statePredicates: [{ kind: 'vitality', value: 'conscious' }],
    })
    expect(spec.phases[2].operations[0].kind).toBe('damage')
    expect(JSON.parse(JSON.stringify(spec))).toEqual(spec)
    expect(structuredClone(spec)).toEqual(spec)
  })

  it('accepts a stable registered handler id without executable handler data', () => {
    const spec = parseMoveSpec({
      ...validSpec(),
      registeredHandlerId: 'move.scratch-v1',
    })

    expect(spec.registeredHandlerId).toBe('move.scratch-v1')
    expect(Object.keys(spec)).not.toContain('handler')
  })

  it('rejects unknown or missing fields at every envelope level', () => {
    expectSpecError(
      { ...validSpec(), callback: 'not-a-contract-field' },
      'invalid-spec',
      'spec',
    )
    const { presentation: _presentation, ...missingPresentation } = validSpec()
    expectSpecError(missingPresentation, 'invalid-spec', 'spec')
    expectSpecError(
      {
        ...validSpec(),
        targeting: { ...validSpec().targeting, range: 6 },
      },
      'invalid-spec',
      'spec.targeting',
    )
    expectSpecError(
      {
        ...validSpec(),
        preconditions: [{ ...validSpec().preconditions[0], executable: true }],
      },
      'invalid-spec',
      'spec.preconditions[0]',
    )
    expectSpecError(
      {
        ...validSpec(),
        costs: [{ ...validSpec().costs[0], patch: {} }],
      },
      'invalid-spec',
      'spec.costs[0]',
    )
    expectSpecError(
      {
        ...validSpec(),
        phases: [{ ...validSpec().phases[0], timing: 'browser' }],
      },
      'invalid-spec',
      'spec.phases[0]',
    )
    expectSpecError(
      {
        ...validSpec(),
        presentation: { ...validSpec().presentation, damage: 999 },
      },
      'invalid-spec',
      'spec.presentation',
    )
  })

  it('requires supported schema, targeting, phase, and version values', () => {
    expectSpecError(
      { ...validSpec(), schemaVersion: 1 },
      'unsupported-schema-version',
      'spec.schemaVersion',
    )
    expectSpecError(
      { ...validSpec(), version: 0 },
      'invalid-spec',
      'spec.version',
    )
    expectSpecError(
      {
        ...validSpec(),
        targeting: { ...validSpec().targeting, kind: 'browser-selected-script' },
      },
      'invalid-spec',
      'spec.targeting.kind',
    )
    expectSpecError(
      {
        ...validSpec(),
        targeting: { ...validSpec().targeting, kind: 'single-target' },
      },
      'invalid-spec',
      'spec.targeting.predicate',
    )
    expectSpecError(
      {
        ...validSpec(),
        costs: [{ ...validSpec().costs[0], phase: 'later' }],
      },
      'invalid-spec',
      'spec.costs[0].phase',
    )
    expectSpecError(
      {
        ...validSpec(),
        phases: [{ phase: 'later', operations: [] }],
      },
      'invalid-spec',
      'spec.phases[0].phase',
    )
  })

  it('requires unique stable ids and canonical phase-block ordering', () => {
    expectSpecError(
      {
        ...validSpec(),
        preconditions: [validSpec().preconditions[0], validSpec().preconditions[0]],
      },
      'duplicate-id',
      'spec.preconditions.id',
    )
    expectSpecError(
      {
        ...validSpec(),
        costs: [validSpec().costs[0], validSpec().costs[0]],
      },
      'duplicate-id',
      'spec.costs.id',
    )
    expectSpecError(
      {
        ...validSpec(),
        registeredHandlerId: 'Run arbitrary code',
      },
      'invalid-spec',
      'spec.registeredHandlerId',
    )
    expectSpecError(
      {
        ...validSpec(),
        presentation: {
          ...validSpec().presentation,
          tags: ['damage', 'damage'],
        },
      },
      'duplicate-id',
      'spec.presentation.tags',
    )
    expectSpecError(
      {
        ...validSpec(),
        phases: [
          { phase: 'damage', operations: [] },
          { phase: 'accuracy', operations: [] },
        ],
      },
      'invalid-phase-order',
      'spec.phases[1].phase',
    )
    expectSpecError(
      {
        ...validSpec(),
        phases: [
          { phase: 'damage', operations: [] },
          { phase: 'damage', operations: [] },
        ],
      },
      'invalid-phase-order',
      'spec.phases[1].phase',
    )
  })

  it('bounds target counts and structural collections', () => {
    expectSpecError(
      {
        ...validSpec(),
        targeting: { ...validSpec().targeting, minTargets: 2, maxTargets: 1 },
      },
      'invalid-spec',
      'spec.targeting',
    )
    expectSpecError(
      {
        ...validSpec(),
        targeting: {
          ...validSpec().targeting,
          maxTargets: MOVE_SPEC_LIMITS.targetCount + 1,
        },
      },
      'invalid-spec',
      'spec.targeting.maxTargets',
    )
    expectSpecError(
      {
        ...validSpec(),
        preconditions: Array.from(
          { length: MOVE_SPEC_LIMITS.preconditions + 1 },
          (_, index) => ({
            id: `precondition-${index}`,
            predicate: {},
            failureReasonCode: 'move.rejected',
          }),
        ),
      },
      'limit-exceeded',
      'spec.preconditions',
    )
    expectSpecError(
      {
        ...validSpec(),
        phases: [{
          phase: 'damage',
          operations: Array.from(
            { length: MOVE_SPEC_LIMITS.operationsPerPhase + 1 },
            () => ({}),
          ),
        }],
      },
      'limit-exceeded',
      'spec.phases[0].operations',
    )
  })

  it('rejects callbacks and every other non-JSON value without executing accessors', () => {
    expectSpecError(
      {
        ...validSpec(),
        phases: [{
          phase: 'damage',
          operations: [{ kind: 'damage', callback: () => ({ hp: 0 }) }],
        }],
      },
      'not-json',
      'spec.phases[0].operations[0].callback',
    )
    expectSpecError(
      {
        ...validSpec(),
        preconditions: [{
          ...validSpec().preconditions[0],
          predicate: { kind: 'source', compiled: undefined },
        }],
      },
      'not-json',
      'spec.preconditions[0].predicate.compiled',
    )
    expectSpecError(
      {
        ...validSpec(),
        costs: [{
          ...validSpec().costs[0],
          cost: { amount: Number.NaN },
        }],
      },
      'not-json',
      'spec.costs[0].cost.amount',
    )
    expectSpecError(
      {
        ...validSpec(),
        targeting: { ...validSpec().targeting, selector: new Date() },
      },
      'not-json',
      'spec.targeting.selector',
    )

    let getterCalled = false
    const operation = Object.defineProperty({}, 'kind', {
      enumerable: true,
      get: () => {
        getterCalled = true
        return 'damage'
      },
    })
    expectSpecError(
      {
        ...validSpec(),
        phases: [{ phase: 'damage', operations: [operation] }],
      },
      'not-json',
      'spec.phases[0].operations[0].kind',
    )
    expect(getterCalled).toBe(false)
  })

  it('rejects circular data and lossy array shapes', () => {
    const circular: Record<string, unknown> = { kind: 'predicate' }
    circular.self = circular
    expectSpecError(
      {
        ...validSpec(),
        preconditions: [{
          ...validSpec().preconditions[0],
          predicate: circular,
        }],
      },
      'not-json',
      'spec.preconditions[0].predicate.self',
    )

    const sparseOperations = new Array(1)
    expectSpecError(
      {
        ...validSpec(),
        phases: [{ phase: 'damage', operations: sparseOperations }],
      },
      'not-json',
      'spec.phases[0].operations[0]',
    )
  })
})
