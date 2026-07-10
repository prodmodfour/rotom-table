import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  MOVE_EFFECT_OPERATION_LIMITS,
  MoveEffectOperationValidationError,
} from '#shared/moveAutomation/effects'
import {
  MOVE_RULE_AST_LIMITS,
} from '#shared/moveAutomation/ast'
import {
  MoveSelectorValidationError,
} from '#shared/moveAutomation/selectors'
import {
  MoveSpecValidationError,
} from '#shared/moveAutomation/spec'
import {
  DEFAULT_MOVE_SPEC_RULESET_VERSION,
  MOVE_SPEC_DEFINITION_HASH_VERSION,
  MoveSpecDefinitionValidationError,
  validateMoveSpec,
  type MoveSpecDefinitionValidationCode,
} from '~~/server/domain/moveAutomation/validateSpec'
import {
  StableJsonSerializationError,
  stableJsonStringify,
} from '~~/server/domain/moveAutomation/stableJson'

interface TestOperation {
  id: string
  kind: string
  source: Record<string, string>
  recipients: Record<string, string>
  phase: string
  reasonCode: string
  payload: Record<string, unknown>
}

interface TestPhaseBlock {
  phase: string
  operations: TestOperation[]
}

interface TestPrecondition {
  id: string
  predicate: Record<string, unknown>
  failureReasonCode: string
}

interface TestSpec {
  schemaVersion: number
  canonicalId: string
  version: number
  targeting: {
    kind: string
    minTargets: number
    maxTargets: number
    selector: Record<string, unknown>
  }
  preconditions: TestPrecondition[]
  costs: unknown[]
  phases: TestPhaseBlock[]
  registeredHandlerId: string | null
  presentation: {
    displayName: string
    vfxKey: string | null
    tags: string[]
  }
}

const rollOperation = (
  overrides: Partial<TestOperation> = {},
): TestOperation => ({
  id: 'operation.accuracy',
  kind: 'roll',
  source: { kind: 'move', id: 'move.scratch' },
  recipients: { kind: 'none' },
  phase: 'accuracy',
  reasonCode: 'move.scratch.accuracy',
  payload: {
    rollId: 'roll.accuracy',
    formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
  },
  ...overrides,
})

const damageOperation = (
  overrides: Partial<TestOperation> = {},
): TestOperation => ({
  id: 'operation.damage',
  kind: 'damage',
  source: { kind: 'operation', id: 'operation.accuracy' },
  recipients: { kind: 'hit-targets' },
  phase: 'damage',
  reasonCode: 'move.scratch.damage',
  payload: {
    damageClass: 'physical',
    damageBase: 4,
    moveType: 'normal',
    accuracyRollId: 'roll.accuracy',
    criticalRollId: null,
  },
  ...overrides,
})

const validSpec = (): TestSpec => ({
  schemaVersion: 2,
  canonicalId: 'Scratch',
  version: 1,
  targeting: {
    kind: 'single-target',
    minTargets: 1,
    maxTargets: 1,
    selector: { kind: 'selected-targets' },
  },
  preconditions: [{
    id: 'actor.conscious',
    predicate: { kind: 'constant', value: true },
    failureReasonCode: 'actor.fainted',
  }],
  costs: [],
  phases: [
    { phase: 'accuracy', operations: [rollOperation()] },
    { phase: 'damage', operations: [damageOperation()] },
    { phase: 'cleanup', operations: [] },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Scratch',
    vfxKey: null,
    tags: ['damage', 'contact'],
  },
})

const expectDefinitionError = (
  callback: () => unknown,
  code: MoveSpecDefinitionValidationCode,
  path?: string,
): MoveSpecDefinitionValidationError => {
  try {
    callback()
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(MoveSpecDefinitionValidationError)
    expect((error as MoveSpecDefinitionValidationError).code).toBe(code)
    if (path) expect((error as MoveSpecDefinitionValidationError).path).toBe(path)
    return error as MoveSpecDefinitionValidationError
  }
}

const expectDeeplyFrozen = (value: unknown, seen = new WeakSet<object>()): void => {
  if (typeof value !== 'object' || value === null || seen.has(value)) return
  seen.add(value)
  expect(Object.isFrozen(value)).toBe(true)
  for (const child of Object.values(value)) expectDeeplyFrozen(child, seen)
}

const historyOperation = (id: string, phase: string): TestOperation => ({
  id,
  kind: 'history',
  source: { kind: 'move', id: 'move.scratch' },
  recipients: { kind: 'actor' },
  phase,
  reasonCode: 'move.scratch.history',
  payload: { event: 'move-completed', detailCode: null },
})

describe('stable MoveSpec JSON serialization', () => {
  it('sorts object keys recursively while preserving array order and canonical numbers', () => {
    const first = {
      z: 3,
      a: {
        y: [2, 1],
        b: -0,
      },
    }
    const second = {
      a: {
        b: 0,
        y: [2, 1],
      },
      z: 3,
    }

    expect(stableJsonStringify(first)).toBe('{"a":{"b":0,"y":[2,1]},"z":3}')
    expect(stableJsonStringify(second)).toBe(stableJsonStringify(first))
    expect(stableJsonStringify({ values: [1, 2] }))
      .not.toBe(stableJsonStringify({ values: [2, 1] }))
  })

  it('rejects lossy or executable input without invoking accessors', () => {
    let getterCalled = false
    const value = Object.defineProperty({ safe: true }, 'script', {
      enumerable: true,
      get: () => {
        getterCalled = true
        return 'run()'
      },
    })

    expect(() => stableJsonStringify(value)).toThrowError(expect.objectContaining({
      name: 'StableJsonSerializationError',
      code: 'not-json',
      path: 'value.script',
    }))
    expect(getterCalled).toBe(false)
    expect(() => stableJsonStringify({ value: Number.NaN }))
      .toThrowError(StableJsonSerializationError)
    expect(() => stableJsonStringify({ value: undefined }))
      .toThrowError(StableJsonSerializationError)

    const sparse = new Array(1)
    expect(() => stableJsonStringify(sparse)).toThrowError(expect.objectContaining({
      code: 'not-json',
      path: 'value[0]',
    }))
  })

  it('enforces caller-provided aggregate bounds', () => {
    expect(() => stableJsonStringify({ nested: { value: 1 } }, {
      limits: { maxDepth: 1 },
    })).toThrowError(expect.objectContaining({
      code: 'limit-exceeded',
      path: 'value.nested.value',
    }))
    expect(() => stableJsonStringify([1, 2], {
      limits: { maxNodes: 2 },
    })).toThrowError(expect.objectContaining({
      code: 'limit-exceeded',
      path: 'value[1]',
    }))
  })
})

describe('authoritative MoveSpec validation and hashing', () => {
  it('validates every typed node and returns immutable normalized hash material', () => {
    const result = validateMoveSpec(validSpec(), {
      capabilityIds: ['targeting.authoritative', 'hp.typed'],
    })

    expect(result.spec).toMatchObject({
      schemaVersion: 2,
      canonicalId: 'Scratch',
      version: 1,
      targeting: { selector: { kind: 'selected-targets' } },
      registeredHandlerId: null,
      presentation: { tags: ['contact', 'damage'] },
    })
    expect(result.spec.preconditions[0].predicate).toEqual({
      kind: 'constant',
      value: true,
    })
    expect(result.spec.phases.map(({ phase }) => phase)).toEqual([
      'accuracy',
      'damage',
      'cleanup',
    ])
    expect(result.spec.phases[1].operations[0]).toMatchObject({
      id: 'operation.damage',
      kind: 'damage',
      phase: 'damage',
    })
    expect(result.capabilityIds).toEqual(['hp.typed', 'targeting.authoritative'])
    expect(result.rulesetVersion).toEqual(DEFAULT_MOVE_SPEC_RULESET_VERSION)
    expect(result.definitionHash).toMatch(/^[a-f0-9]{64}$/)
    expect(createHash('sha256').update(result.canonicalJson).digest('hex'))
      .toBe(result.definitionHash)
    expect(JSON.parse(result.canonicalJson)).toMatchObject({
      definitionHashVersion: MOVE_SPEC_DEFINITION_HASH_VERSION,
      capabilityIds: ['hp.typed', 'targeting.authoritative'],
      spec: { canonicalId: 'Scratch' },
    })
    expectDeeplyFrozen(result)
  })

  it('normalizes omitted syntax defaults, phase order, tags, and object key order', () => {
    const explicit = validSpec()
    const semanticallyEquivalent = {
      presentation: {
        tags: ['contact', 'damage'],
        displayName: 'Scratch',
      },
      targeting: {
        selector: { kind: 'selected-targets' },
        maxTargets: 1,
        minTargets: 1,
        kind: 'single-target',
      },
      canonicalId: 'Scratch',
      schemaVersion: 2,
      version: 1,
      preconditions: [{
        failureReasonCode: 'actor.fainted',
        predicate: { value: true, kind: 'constant' },
        id: 'actor.conscious',
      }],
      phases: [
        { phase: 'cleanup' },
        { operations: [damageOperation()], phase: 'damage' },
        { operations: [rollOperation()], phase: 'accuracy' },
      ],
    }

    const first = validateMoveSpec(explicit, {
      capabilityIds: ['targeting.authoritative', 'hp.typed'],
    })
    const second = validateMoveSpec(semanticallyEquivalent, {
      capabilityIds: ['hp.typed', 'targeting.authoritative'],
    })

    expect(second.spec.costs).toEqual([])
    expect(second.spec.registeredHandlerId).toBeNull()
    expect(second.spec.presentation.vfxKey).toBeNull()
    expect(second.spec.phases[2]).toEqual({ phase: 'cleanup', operations: [] })
    expect(second.spec).toEqual(first.spec)
    expect(second.canonicalJson).toBe(first.canonicalJson)
    expect(second.definitionHash).toBe(first.definitionHash)
  })

  it('changes the hash for behavior, ordered operations, capabilities, or ruleset data', () => {
    const baseline = validateMoveSpec(validSpec(), {
      capabilityIds: ['targeting.authoritative', 'hp.typed'],
    })
    const changedDamage = validSpec()
    changedDamage.phases[1].operations[0].payload.damageBase = 5

    const extraLogs = validSpec()
    extraLogs.phases[2] = {
      phase: 'cleanup',
      operations: [
        {
          id: 'operation.log-first',
          kind: 'log',
          source: { kind: 'move', id: 'move.scratch' },
          recipients: { kind: 'none' },
          phase: 'cleanup',
          reasonCode: 'move.scratch.first',
          payload: { messageKey: 'move.first', arguments: [] },
        },
        {
          id: 'operation.log-second',
          kind: 'log',
          source: { kind: 'move', id: 'move.scratch' },
          recipients: { kind: 'none' },
          phase: 'cleanup',
          reasonCode: 'move.scratch.second',
          payload: { messageKey: 'move.second', arguments: [] },
        },
      ],
    }
    const reversedLogs = structuredClone(extraLogs)
    reversedLogs.phases[2].operations.reverse()

    expect(validateMoveSpec(changedDamage, {
      capabilityIds: ['targeting.authoritative', 'hp.typed'],
    }).definitionHash).not.toBe(baseline.definitionHash)
    expect(validateMoveSpec(reversedLogs).definitionHash)
      .not.toBe(validateMoveSpec(extraLogs).definitionHash)
    expect(validateMoveSpec(validSpec(), {
      capabilityIds: ['targeting.authoritative'],
    }).definitionHash).not.toBe(baseline.definitionHash)
    expect(validateMoveSpec(validSpec(), {
      capabilityIds: ['targeting.authoritative', 'hp.typed'],
      rulesetVersion: {
        ...DEFAULT_MOVE_SPEC_RULESET_VERSION,
        canonicalizationVersion: DEFAULT_MOVE_SPEC_RULESET_VERSION.canonicalizationVersion + 1,
      },
    }).definitionHash).not.toBe(baseline.definitionHash)
  })

  it('rejects unknown selector, predicate, operation, and phase IDs', () => {
    const invalidSelector = validSpec()
    invalidSelector.targeting.selector.kind = 'client-selected-targets'
    expect(() => validateMoveSpec(invalidSelector)).toThrowError(expect.objectContaining({
      name: MoveSelectorValidationError.name,
      code: 'unknown-selector-kind',
      path: 'spec.targeting.selector.kind',
    }))

    const invalidPredicate = validSpec()
    invalidPredicate.preconditions[0].predicate.kind = 'source-code'
    expect(() => validateMoveSpec(invalidPredicate)).toThrowError(expect.objectContaining({
      code: 'unknown-predicate-kind',
      path: 'spec.preconditions[0].predicate.kind',
    }))

    const invalidOperation = validSpec()
    invalidOperation.phases[1].operations[0].kind = 'state-patch'
    expect(() => validateMoveSpec(invalidOperation)).toThrowError(expect.objectContaining({
      name: MoveEffectOperationValidationError.name,
      code: 'unknown-operation-kind',
      path: 'spec.phases[1].operations[0].kind',
    }))

    const invalidPhase = validSpec()
    invalidPhase.phases[0].phase = 'browser-animation'
    expect(() => validateMoveSpec(invalidPhase)).toThrowError(expect.objectContaining({
      name: MoveSpecValidationError.name,
      code: 'invalid-spec',
      path: 'spec.phases[2].phase',
    }))
  })

  it('requires operation phases to match their containing canonical block', () => {
    const spec = validSpec()
    spec.phases[1].operations[0].phase = 'after-damage'

    expectDefinitionError(
      () => validateMoveSpec(spec),
      'phase-mismatch',
      'spec.phases[1].operations[0].phase',
    )
  })

  it('requires globally unique operation, roll, and request IDs', () => {
    const duplicateOperation = validSpec()
    duplicateOperation.phases[1].operations[0].id = 'operation.accuracy'
    expectDefinitionError(
      () => validateMoveSpec(duplicateOperation),
      'duplicate-id',
      'spec.phases[1].operations[0].id',
    )

    const duplicateRoll = validSpec()
    duplicateRoll.phases[0].operations.push(rollOperation({
      id: 'operation.critical',
      payload: {
        rollId: 'roll.accuracy',
        formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
      },
    }))
    expectDefinitionError(
      () => validateMoveSpec(duplicateRoll),
      'duplicate-id',
      'spec.phases[0].operations[1].payload.rollId',
    )

    const duplicateRequest = validSpec()
    duplicateRequest.phases = [{
      phase: 'movement',
      operations: [
        {
          id: 'operation.movement-one',
          kind: 'movement-request',
          source: { kind: 'move', id: 'move.scratch' },
          recipients: { kind: 'actor' },
          phase: 'movement',
          reasonCode: 'move.scratch.move-one',
          payload: {
            requestId: 'request.destination',
            mode: 'voluntary',
            distance: 2,
            destinationSetId: 'destinations.scratch',
          },
        },
        {
          id: 'operation.movement-two',
          kind: 'movement-request',
          source: { kind: 'move', id: 'move.scratch' },
          recipients: { kind: 'actor' },
          phase: 'movement',
          reasonCode: 'move.scratch.move-two',
          payload: {
            requestId: 'request.destination',
            mode: 'voluntary',
            distance: 1,
            destinationSetId: 'destinations.scratch-second',
          },
        },
      ],
    }]
    expectDefinitionError(
      () => validateMoveSpec(duplicateRequest),
      'duplicate-id',
      'spec.phases[0].operations[1].payload.requestId',
    )
  })

  it('requires local operation and roll references to resolve backward', () => {
    const unknownSource = validSpec()
    unknownSource.phases[1].operations[0].source.id = 'operation.missing'
    expectDefinitionError(
      () => validateMoveSpec(unknownSource),
      'unknown-reference',
      'spec.phases[1].operations[0].source.id',
    )

    const forwardSource = validSpec()
    forwardSource.phases[0].operations[0].source = {
      kind: 'operation',
      id: 'operation.damage',
    }
    expectDefinitionError(
      () => validateMoveSpec(forwardSource),
      'invalid-reference-order',
      'spec.phases[0].operations[0].source.id',
    )

    const unknownRoll = validSpec()
    unknownRoll.phases[1].operations[0].payload.accuracyRollId = 'roll.missing'
    expectDefinitionError(
      () => validateMoveSpec(unknownRoll),
      'unknown-reference',
      'spec.phases[1].operations[0].payload.accuracyRollId',
    )

    const forwardRoll = validSpec()
    forwardRoll.phases = [
      {
        phase: 'declare',
        operations: [damageOperation({
          source: { kind: 'move', id: 'move.scratch' },
          phase: 'declare',
        })],
      },
      { phase: 'accuracy', operations: [rollOperation()] },
    ]
    expectDefinitionError(
      () => validateMoveSpec(forwardRoll),
      'invalid-reference-order',
      'spec.phases[0].operations[0].payload.accuracyRollId',
    )
  })

  it('validates reviewed capability IDs and ruleset provenance', () => {
    expectDefinitionError(
      () => validateMoveSpec(validSpec(), { capabilityIds: ['runtime.unknown'] }),
      'unknown-capability',
      'capabilityIds[0]',
    )
    expectDefinitionError(
      () => validateMoveSpec(validSpec(), {
        capabilityIds: ['hp.typed', 'hp.typed'],
      }),
      'duplicate-id',
      'capabilityIds',
    )
    expectDefinitionError(
      () => validateMoveSpec(validSpec(), {
        rulesetVersion: {
          ...DEFAULT_MOVE_SPEC_RULESET_VERSION,
          sourceDataSha256: 'not-a-hash',
        },
      }),
      'invalid-ruleset-version',
      'rulesetVersion.sourceDataSha256',
    )
  })

  it('enforces aggregate operation and rule-AST complexity bounds', () => {
    const tooManyOperations = validSpec()
    tooManyOperations.phases = [
      {
        phase: 'declare',
        operations: Array.from({ length: 65 }, (_, index) =>
          historyOperation(`operation.declare-${index}`, 'declare')),
      },
      {
        phase: 'cleanup',
        operations: Array.from({ length: 64 }, (_, index) =>
          historyOperation(`operation.cleanup-${index}`, 'cleanup')),
      },
    ]
    expect(MOVE_EFFECT_OPERATION_LIMITS.operations).toBe(128)
    expectDefinitionError(
      () => validateMoveSpec(tooManyOperations),
      'limit-exceeded',
      'spec.phases',
    )

    const tooManyRuleNodes = validSpec()
    tooManyRuleNodes.preconditions = Array.from({ length: 64 }, (_, index) => ({
      id: `precondition-${index}`,
      predicate: {
        kind: 'all',
        predicates: Array.from({ length: 4 }, () => ({ kind: 'constant', value: true })),
      },
      failureReasonCode: 'move.rejected',
    }))
    expect(MOVE_RULE_AST_LIMITS.nodes).toBe(256)
    expectDefinitionError(
      () => validateMoveSpec(tooManyRuleNodes),
      'limit-exceeded',
      'spec.rules',
    )
  })

  it('detaches the validated definition from subsequent authoring mutations', () => {
    const input = validSpec()
    const result = validateMoveSpec(input)

    input.targeting.selector.kind = 'actor'
    input.phases[1].operations[0].payload.damageBase = 99
    input.presentation.tags.push('changed')

    expect(result.spec.targeting.selector).toEqual({ kind: 'selected-targets' })
    expect(result.spec.phases[1].operations[0]).toMatchObject({
      kind: 'damage',
      payload: { damageBase: 4 },
    })
    expect(result.spec.presentation.tags).toEqual(['contact', 'damage'])
  })
})
