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
  createRegisteredMoveHandlerRegistry,
} from '~~/server/domain/moveAutomation/handlers/registry'
import {
  MoveAutomationTargetPredicateError,
} from '~~/server/domain/moveAutomation/predicates/target'
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
    predicate?: Record<string, unknown> | null
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

const multiHitOperation = (
  overrides: Partial<TestOperation> = {},
): TestOperation => ({
  id: 'operation.multi-hit',
  kind: 'multi-hit',
  source: { kind: 'move', id: 'move.scratch' },
  recipients: { kind: 'attacked-targets' },
  phase: 'damage',
  reasonCode: 'move.scratch.multi-hit',
  payload: {
    count: { kind: 'fixed', hits: 2 },
    accuracy: {
      kind: 'per-hit',
      rollId: 'roll.strike',
      formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
      stopOnMiss: false,
    },
    critical: { kind: 'accuracy' },
    damage: {
      damageClass: 'physical',
      damageBase: 4,
      moveType: 'normal',
      accuracyRollId: null,
      criticalRollId: null,
    },
    effects: [],
  },
  ...overrides,
})

const checkOperation = (
  overrides: Partial<TestOperation> = {},
): TestOperation => ({
  id: 'operation.check',
  kind: 'check',
  source: { kind: 'move', id: 'move.scratch' },
  recipients: { kind: 'attacked-targets' },
  phase: 'hit',
  reasonCode: 'move.scratch.check',
  payload: {
    kind: 'opposed',
    checkId: 'check.push',
    actorRoll: {
      rollId: 'roll.push.actor',
      source: {
        kind: 'fixed',
        formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
      },
      modifiers: [],
      reroll: { count: 0, keep: 'latest' },
      resourceReroll: null,
    },
    targetRoll: {
      rollId: 'roll.push.target',
      source: {
        kind: 'fixed',
        formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
      },
      modifiers: [],
      reroll: { count: 0, keep: 'latest' },
      resourceReroll: null,
    },
    tie: { kind: 'failure' },
    branches: { success: 'branch.push', failure: 'branch.steady' },
  },
  ...overrides,
})

const branchOperation = (
  operationIds: readonly string[],
  overrides: Partial<TestOperation> = {},
): TestOperation => ({
  id: 'operation.branch',
  kind: 'branch',
  source: { kind: 'move', id: 'move.scratch' },
  recipients: { kind: 'none' },
  phase: 'hit',
  reasonCode: 'move.scratch.branch',
  payload: {
    kind: 'predicate',
    selectionId: 'branch.hit-effect',
    scope: 'resolution',
    predicate: { kind: 'constant', value: true },
    whenTrue: { id: 'branch.apply', operationIds: [...operationIds] },
    whenFalse: { id: 'branch.skip', operationIds: [] },
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

  it('validates optional authoritative area relation and state predicates into hash material', () => {
    const spec = validSpec()
    spec.targeting.kind = 'area'
    spec.targeting.minTargets = 0
    spec.targeting.maxTargets = 32
    spec.targeting.selector = { kind: 'area-targets' }
    spec.targeting.predicate = {
      relationship: 'enemy',
      willingness: 'any',
      excludeActor: true,
      statePredicates: [{ kind: 'vitality', value: 'conscious' }],
    }

    const result = validateMoveSpec(spec)
    expect(result.spec.targeting.predicate).toEqual(spec.targeting.predicate)
    expect(JSON.parse(result.canonicalJson)).toMatchObject({
      spec: { targeting: { predicate: spec.targeting.predicate } },
    })

    const changed = structuredClone(spec)
    changed.targeting.predicate!.relationship = 'ally'
    expect(validateMoveSpec(changed).definitionHash).not.toBe(result.definitionHash)

    const invalid = structuredClone(spec)
    invalid.targeting.predicate = { relationship: 'browser-team', willingness: 'any', excludeActor: true }
    expect(() => validateMoveSpec(invalid)).toThrowError(expect.objectContaining({
      name: MoveAutomationTargetPredicateError.name,
      code: 'invalid-target-predicate',
    }))

    const nonArea = structuredClone(spec)
    nonArea.targeting.kind = 'single-target'
    expect(() => validateMoveSpec(nonArea)).toThrowError(expect.objectContaining({
      name: MoveSpecValidationError.name,
      code: 'invalid-spec',
      path: 'spec.targeting.predicate',
    }))
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

  it('rejects contradictory reviewed resource-cost combinations', () => {
    const fullAndShift = validSpec()
    fullAndShift.costs = [
      {
        id: 'cost.full',
        phase: 'pay',
        cost: { kind: 'action-resource', resource: 'full', amount: 1 },
      },
      {
        id: 'cost.shift',
        phase: 'movement',
        cost: { kind: 'action-resource', resource: 'shift', amount: 1 },
      },
    ]
    expectDefinitionError(
      () => validateMoveSpec(fullAndShift),
      'invalid-definition',
      'spec.costs',
    )

    const sharedReaction = validSpec()
    sharedReaction.costs = [
      {
        id: 'cost.interrupt',
        phase: 'declare',
        cost: { kind: 'action-resource', resource: 'interrupt', amount: 1 },
      },
      {
        id: 'cost.reaction',
        phase: 'pay',
        cost: { kind: 'action-resource', resource: 'reaction', amount: 1 },
      },
    ]
    expectDefinitionError(
      () => validateMoveSpec(sharedReaction),
      'invalid-definition',
      'spec.costs',
    )

    const duplicateFlag = validSpec()
    duplicateFlag.costs = [
      {
        id: 'cost.once-declare',
        phase: 'declare',
        cost: { kind: 'once-per-turn', flagId: 'move.once' },
      },
      {
        id: 'cost.once-usage',
        phase: 'usage',
        cost: { kind: 'once-per-turn', flagId: 'move.once' },
      },
    ]
    expectDefinitionError(
      () => validateMoveSpec(duplicateFlag),
      'duplicate-id',
      'spec.costs',
    )
  })

  it('changes the hash for behavior, ordered operations, capabilities, or ruleset data', () => {
    const baseline = validateMoveSpec(validSpec(), {
      capabilityIds: ['targeting.authoritative', 'hp.typed'],
    })
    const changedDamage = validSpec()
    changedDamage.phases[1].operations[0].payload.damageBase = 5
    const selectedDefenseAttack = validSpec()
    selectedDefenseAttack.phases[1].operations[0].payload.attackStat = {
      kind: 'stat',
      subject: { kind: 'actor' },
      stat: 'defense',
      combatStagePolicy: 'honor',
      stageModifierPolicy: 'honor',
    }
    const changedTypeRules = validSpec()
    changedTypeRules.phases[1].operations[0].payload.typeEffectiveness = {
      immunity: 'ignore',
      resistance: 'honor',
      weakness: 'honor',
      effectivenessOverride: null,
      defenderTypeOverrides: [],
    }
    const changedCriticalRules = validSpec()
    changedCriticalRules.phases[1].operations[0].payload.criticalHit = {
      trigger: { kind: 'always' },
      prevention: 'honor',
    }

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
    expect(validateMoveSpec(selectedDefenseAttack, {
      capabilityIds: ['targeting.authoritative', 'hp.typed'],
    }).definitionHash).not.toBe(baseline.definitionHash)
    expect(validateMoveSpec(changedTypeRules, {
      capabilityIds: ['targeting.authoritative', 'hp.typed'],
    }).definitionHash).not.toBe(baseline.definitionHash)
    expect(validateMoveSpec(changedCriticalRules, {
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

  it('rejects unknown handlers and binds registered handler versions into the hash', () => {
    const spec = validSpec()
    spec.registeredHandlerId = 'move.contextual-damage'

    expectDefinitionError(
      () => validateMoveSpec(spec),
      'unknown-handler',
      'spec.registeredHandlerId',
    )

    const registryAt = (version: number) => createRegisteredMoveHandlerRegistry([{
      id: 'move.contextual-damage',
      version,
      run: () => ({ operations: [], traceEntries: [] }),
    }])
    const versionOne = validateMoveSpec(spec, { handlerRegistry: registryAt(1) })
    const versionTwo = validateMoveSpec(spec, { handlerRegistry: registryAt(2) })

    expect(versionOne.registeredHandler).toEqual({
      id: 'move.contextual-damage',
      version: 1,
    })
    expect(JSON.parse(versionOne.canonicalJson)).toMatchObject({
      registeredHandler: { id: 'move.contextual-damage', version: 1 },
      spec: { registeredHandlerId: 'move.contextual-damage' },
    })
    expect(versionTwo.registeredHandler?.version).toBe(2)
    expect(versionTwo.definitionHash).not.toBe(versionOne.definitionHash)
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

    const duplicateCheckRoll = validSpec()
    const conflictingCheck = checkOperation()
    const conflictingActorRoll = conflictingCheck.payload.actorRoll as Record<string, unknown>
    conflictingActorRoll.rollId = 'roll.accuracy'
    duplicateCheckRoll.phases.push({ phase: 'hit', operations: [conflictingCheck] })
    expectDefinitionError(
      () => validateMoveSpec(duplicateCheckRoll),
      'duplicate-id',
      'spec.phases[1].operations[0].payload.actorRoll.rollId',
    )

    const firstCheck = checkOperation()
    const secondCheck = structuredClone(firstCheck)
    secondCheck.id = 'operation.check-second'
    const secondActorRoll = secondCheck.payload.actorRoll as Record<string, unknown>
    const secondTargetRoll = secondCheck.payload.targetRoll as Record<string, unknown>
    secondActorRoll.rollId = 'roll.push-second.actor'
    secondTargetRoll.rollId = 'roll.push-second.target'
    const duplicateCheckId = validSpec()
    duplicateCheckId.phases = [{ phase: 'hit', operations: [firstCheck, secondCheck] }]
    expectDefinitionError(
      () => validateMoveSpec(duplicateCheckId),
      'duplicate-id',
      'spec.phases[0].operations[1].payload.checkId',
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

  it('bounds durable movement choices to one voluntary actor-owned request', () => {
    const movementOperation = () => ({
      id: 'operation.movement-choice',
      kind: 'movement-request',
      source: { kind: 'move', id: 'move.scratch' },
      recipients: { kind: 'actor' },
      phase: 'movement',
      reasonCode: 'move.scratch.choose-destination',
      payload: {
        requestId: 'request.destination',
        mode: 'voluntary',
        distance: 3,
        destinationSetId: 'destinations.scratch',
        choice: {
          kind: 'destination',
          promptKey: 'move.scratch.choose-destination',
          allowPass: true,
        },
      },
    })
    const valid = validSpec()
    valid.phases.push({ phase: 'movement', operations: [movementOperation()] })
    expect(validateMoveSpec(valid).spec.phases
      .flatMap(block => block.operations)
      .find(operation => operation.id === 'operation.movement-choice')).toMatchObject({
      kind: 'movement-request',
      payload: { choice: { kind: 'destination' } },
    })

    const forced = structuredClone(valid)
    forced.phases.at(-1)!.operations[0]!.payload.mode = 'forced'
    expectDefinitionError(
      () => validateMoveSpec(forced),
      'invalid-definition',
    )

    const wrongPhase = structuredClone(valid)
    wrongPhase.phases.at(-1)!.phase = 'schedule'
    wrongPhase.phases.at(-1)!.operations[0]!.phase = 'schedule'
    expectDefinitionError(
      () => validateMoveSpec(wrongPhase),
      'invalid-definition',
      'spec.phases[2].operations[0].phase',
    )

    const targetOwned = structuredClone(valid)
    targetOwned.phases.at(-1)!.operations[0]!.recipients = { kind: 'hit-targets' }
    expectDefinitionError(
      () => validateMoveSpec(targetOwned),
      'invalid-definition',
    )

    const duplicate = structuredClone(valid)
    const second = movementOperation()
    second.id = 'operation.movement-choice-second'
    second.payload.requestId = 'request.destination-second'
    second.payload.destinationSetId = 'destinations.scratch-second'
    duplicate.phases.at(-1)!.operations.push(second)
    expectDefinitionError(
      () => validateMoveSpec(duplicate),
      'invalid-definition',
    )
  })

  it('bounds move-driven switch choices to one actor-owned movement-phase request', () => {
    const switchOperation = () => ({
      id: 'operation.switch-choice',
      kind: 'switch-request',
      source: { kind: 'move', id: 'move.scratch' },
      recipients: { kind: 'actor' },
      phase: 'movement',
      reasonCode: 'move.scratch.choose-replacement',
      payload: {
        requestId: 'request.switch-replacement',
        replacementSetId: 'replacements.scratch',
        promptKey: 'move.scratch.choose-replacement',
        required: true,
        positionPolicy: 'recalled-position',
        initiativePolicy: 'inherit-slot',
      },
    })
    const valid = validSpec()
    valid.phases.push({ phase: 'movement', operations: [switchOperation()] })
    expect(validateMoveSpec(valid).spec.phases
      .flatMap(block => block.operations)
      .find(operation => operation.id === 'operation.switch-choice')).toMatchObject({
      kind: 'switch-request',
      recipients: { kind: 'actor' },
      payload: { required: true, initiativePolicy: 'inherit-slot' },
    })

    const wrongPhase = structuredClone(valid)
    wrongPhase.phases.at(-1)!.phase = 'schedule'
    wrongPhase.phases.at(-1)!.operations[0]!.phase = 'schedule'
    expectDefinitionError(
      () => validateMoveSpec(wrongPhase),
      'invalid-definition',
      'spec.phases[2].operations[0].phase',
    )

    const targetOwned = structuredClone(valid)
    targetOwned.phases.at(-1)!.operations[0]!.recipients = { kind: 'hit-targets' }
    expectDefinitionError(() => validateMoveSpec(targetOwned), 'invalid-definition')

    const duplicate = structuredClone(valid)
    const second = switchOperation()
    second.id = 'operation.switch-choice-second'
    second.payload.requestId = 'request.switch-replacement-second'
    second.payload.replacementSetId = 'replacements.scratch-second'
    duplicate.phases.at(-1)!.operations.push(second)
    expectDefinitionError(() => validateMoveSpec(duplicate), 'invalid-definition')

    const withMovementChoice = structuredClone(valid)
    withMovementChoice.phases.at(-1)!.operations.unshift({
      id: 'operation.movement-choice',
      kind: 'movement-request',
      source: { kind: 'move', id: 'move.scratch' },
      recipients: { kind: 'actor' },
      phase: 'movement',
      reasonCode: 'move.scratch.choose-destination',
      payload: {
        requestId: 'request.destination',
        mode: 'voluntary',
        distance: 1,
        destinationSetId: 'destinations.scratch',
        choice: {
          kind: 'destination',
          promptKey: 'move.scratch.choose-destination',
          allowPass: false,
        },
      },
    })
    expectDefinitionError(() => validateMoveSpec(withMovementChoice), 'invalid-definition')
  })

  it('validates reviewed forced and voluntary spatial displacement declarations', () => {
    const displacementOperation = () => ({
      id: 'operation.weighted-push',
      kind: 'movement-request',
      source: { kind: 'move', id: 'move.scratch' },
      recipients: { kind: 'hit-targets' },
      phase: 'movement',
      reasonCode: 'move.scratch.weighted-push',
      payload: {
        requestId: 'request.weighted-push',
        mode: 'forced',
        distance: {
          kind: 'expression',
          expression: {
            kind: 'weight',
            subject: { kind: 'current-target' },
            metric: 'weight-class',
          },
          minimum: 0,
          maximum: 7,
          rounding: 'floor',
        },
        destinationSetId: null,
        displacement: {
          vector: { kind: 'away', source: { kind: 'actor' } },
          distancePolicy: 'up-to-distance',
          opportunityAttacks: 'ignore',
        },
      },
    })
    const valid = validSpec()
    valid.phases.push({ phase: 'movement', operations: [displacementOperation()] })
    const validated = validateMoveSpec(valid)
    expect(validated.spec.phases
      .flatMap(block => block.operations)
      .find(operation => operation.id === 'operation.weighted-push')).toMatchObject({
      kind: 'movement-request',
      payload: {
        mode: 'forced',
        displacement: {
          vector: { kind: 'away' },
          distancePolicy: 'up-to-distance',
        },
      },
    })

    const fullDistance = structuredClone(valid)
    const fullDistancePayload = fullDistance.phases.at(-1)!.operations[0]!.payload as {
      displacement: { distancePolicy: string }
    }
    fullDistancePayload.displacement.distancePolicy = 'full-distance-required'
    expect(validateMoveSpec(fullDistance).definitionHash).not.toBe(validated.definitionHash)

    const wrongPhase = structuredClone(valid)
    wrongPhase.phases.at(-1)!.phase = 'schedule'
    wrongPhase.phases.at(-1)!.operations[0]!.phase = 'schedule'
    expectDefinitionError(
      () => validateMoveSpec(wrongPhase),
      'invalid-definition',
      'spec.phases[2].operations[0].phase',
    )

    const noRecipients = structuredClone(valid)
    noRecipients.phases.at(-1)!.operations[0]!.recipients = { kind: 'none' }
    expectDefinitionError(
      () => validateMoveSpec(noRecipients),
      'invalid-definition',
      'spec.phases[2].operations[0].recipients',
    )
  })

  it('validates actor teleports and willing-ally position swap operation shapes', () => {
    const relocationOperation = (mode: 'teleport' | 'swap') => ({
      id: `operation.${mode}`,
      kind: 'movement-request',
      source: { kind: 'move', id: 'move.scratch' },
      recipients: {
        kind: mode === 'teleport' ? 'actor' : 'actor-and-attacked-targets',
      },
      phase: 'movement',
      reasonCode: `move.scratch.${mode}`,
      payload: {
        requestId: `request.${mode}`,
        mode,
        distance: 6,
        destinationSetId: mode === 'teleport' ? 'destinations.teleport' : null,
      },
    })
    const valid = validSpec()
    valid.phases.splice(-1, 0, {
      phase: 'movement',
      operations: [relocationOperation('teleport'), relocationOperation('swap')],
    })
    const validated = validateMoveSpec(valid)
    expect(validated.spec.phases[2]?.operations).toEqual([
      expect.objectContaining({
        kind: 'movement-request',
        recipients: { kind: 'actor' },
        payload: expect.objectContaining({
          mode: 'teleport',
          distance: 6,
          destinationSetId: 'destinations.teleport',
        }),
      }),
      expect.objectContaining({
        kind: 'movement-request',
        recipients: { kind: 'actor-and-attacked-targets' },
        payload: expect.objectContaining({ mode: 'swap', distance: 6, destinationSetId: null }),
      }),
    ])

    const wrongPhase = structuredClone(valid)
    wrongPhase.phases[2]!.phase = 'schedule'
    wrongPhase.phases[2]!.operations.forEach(operation => { operation.phase = 'schedule' })
    expectDefinitionError(
      () => validateMoveSpec(wrongPhase),
      'invalid-definition',
      'spec.phases[2].operations[0].phase',
    )

    const targetTeleport = structuredClone(valid)
    targetTeleport.phases[2]!.operations[0]!.recipients = { kind: 'hit-targets' }
    expectDefinitionError(
      () => validateMoveSpec(targetTeleport),
      'invalid-definition',
      'spec.phases[2].operations[0].payload',
    )

    const unboundTeleport = structuredClone(valid)
    unboundTeleport.phases[2]!.operations[0]!.payload.destinationSetId = null
    expectDefinitionError(
      () => validateMoveSpec(unboundTeleport),
      'invalid-definition',
      'spec.phases[2].operations[0].payload',
    )

    const oneSidedSwap = structuredClone(valid)
    oneSidedSwap.phases[2]!.operations[1]!.recipients = { kind: 'actor' }
    expectDefinitionError(
      () => validateMoveSpec(oneSidedSwap),
      'invalid-definition',
      'spec.phases[2].operations[1].payload',
    )

    const clientDestinationSwap = structuredClone(valid)
    clientDestinationSwap.phases[2]!.operations[1]!.payload.destinationSetId = 'browser.cells'
    expectDefinitionError(
      () => validateMoveSpec(clientDestinationSwap),
      'invalid-definition',
      'spec.phases[2].operations[1].payload',
    )
  })

  it('validates branch identities and later-operation control without executable payloads', () => {
    const branched = validSpec()
    branched.phases.splice(1, 0, {
      phase: 'hit',
      operations: [branchOperation(['operation.damage'])],
    })
    const validated = validateMoveSpec(branched)
    expect(validated.spec.phases[1]?.operations[0]).toMatchObject({
      kind: 'branch',
      payload: {
        selectionId: 'branch.hit-effect',
        whenTrue: { operationIds: ['operation.damage'] },
      },
    })

    const changed = structuredClone(branched)
    changed.phases[1]!.operations[0]!.payload.predicate = { kind: 'constant', value: false }
    expect(validateMoveSpec(changed).definitionHash).not.toBe(validated.definitionHash)

    const checkBranched = validSpec()
    checkBranched.phases = [
      {
        phase: 'hit',
        operations: [
          checkOperation(),
          branchOperation(['operation.success-log'], {
            id: 'operation.check-branch',
            recipients: { kind: 'attacked-targets' },
            payload: {
              kind: 'check',
              selectionId: 'branch.check-result',
              scope: 'recipient',
              checkId: 'check.push',
              branches: {
                success: { id: 'branch.push', operationIds: ['operation.success-log'] },
                failure: { id: 'branch.steady', operationIds: ['operation.failure-log'] },
              },
            },
          }),
        ],
      },
      {
        phase: 'cleanup',
        operations: [
          {
            id: 'operation.success-log',
            kind: 'log',
            source: { kind: 'move', id: 'move.scratch' },
            recipients: { kind: 'attacked-targets' },
            phase: 'cleanup',
            reasonCode: 'move.scratch.success',
            payload: { messageKey: 'move.scratch.success', arguments: [] },
          },
          {
            id: 'operation.failure-log',
            kind: 'log',
            source: { kind: 'move', id: 'move.scratch' },
            recipients: { kind: 'attacked-targets' },
            phase: 'cleanup',
            reasonCode: 'move.scratch.failure',
            payload: { messageKey: 'move.scratch.failure', arguments: [] },
          },
        ],
      },
    ]
    expect(validateMoveSpec(checkBranched).spec.phases[0]?.operations[1]).toMatchObject({
      kind: 'branch',
      payload: { kind: 'check', checkId: 'check.push' },
    })
    const mismatchedCheckBranch = structuredClone(checkBranched)
    mismatchedCheckBranch.phases[0]!.operations[1]!.payload.branches = {
      success: { id: 'branch.wrong', operationIds: ['operation.success-log'] },
      failure: { id: 'branch.steady', operationIds: ['operation.failure-log'] },
    }
    expectDefinitionError(
      () => validateMoveSpec(mismatchedCheckBranch),
      'invalid-definition',
      'spec.phases[0].operations[1].payload.branches.success.id',
    )

    const unknown = structuredClone(branched)
    unknown.phases[1]!.operations[0]!.payload.whenTrue = {
      id: 'branch.apply',
      operationIds: ['operation.missing'],
    }
    expectDefinitionError(
      () => validateMoveSpec(unknown),
      'unknown-reference',
      'spec.phases[1].operations[0].payload.whenTrue.operationIds[0]',
    )

    const backward = validSpec()
    backward.phases[2] = {
      phase: 'cleanup',
      operations: [branchOperation(['operation.damage'], {
        phase: 'cleanup',
      })],
    }
    expectDefinitionError(
      () => validateMoveSpec(backward),
      'invalid-reference-order',
      'spec.phases[2].operations[0].payload.whenTrue.operationIds[0]',
    )

    const duplicateController = validSpec()
    duplicateController.phases.splice(1, 0, {
      phase: 'hit',
      operations: [
        branchOperation(['operation.damage']),
        branchOperation(['operation.damage'], {
          id: 'operation.branch-second',
          payload: {
            kind: 'predicate',
            selectionId: 'branch.second',
            scope: 'resolution',
            predicate: { kind: 'constant', value: true },
            whenTrue: { id: 'branch.second-apply', operationIds: ['operation.damage'] },
            whenFalse: { id: 'branch.second-skip', operationIds: [] },
          },
        }),
      ],
    })
    expectDefinitionError(
      () => validateMoveSpec(duplicateController),
      'invalid-definition',
      'spec.phases[1].operations[1].payload.whenTrue.operationIds[0]',
    )

    const nested = validSpec()
    nested.phases.splice(1, 0, {
      phase: 'hit',
      operations: [
        branchOperation(['operation.branch-second']),
        branchOperation(['operation.damage'], {
          id: 'operation.branch-second',
          payload: {
            kind: 'predicate',
            selectionId: 'branch.second',
            scope: 'resolution',
            predicate: { kind: 'constant', value: true },
            whenTrue: { id: 'branch.second-apply', operationIds: ['operation.damage'] },
            whenFalse: { id: 'branch.second-skip', operationIds: [] },
          },
        }),
      ],
    })
    expectDefinitionError(
      () => validateMoveSpec(nested),
      'invalid-definition',
      'spec.phases[1].operations[0].payload.whenTrue.operationIds[0]',
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

  it('binds random condition choices to an earlier exact server roll and recipient set', () => {
    const randomConditionSpec = (): TestSpec => {
      const spec = validSpec()
      spec.phases.splice(1, 0, {
        phase: 'hit',
        operations: [
          rollOperation({
            id: 'operation.condition-roll',
            recipients: { kind: 'hit-targets' },
            phase: 'hit',
            reasonCode: 'move.scratch.condition-roll',
            payload: {
              rollId: 'roll.condition',
              formula: { kind: 'dice', count: 1, sides: 3, modifier: 0 },
            },
          }),
          {
            id: 'operation.random-condition',
            kind: 'condition',
            source: { kind: 'operation', id: 'operation.condition-roll' },
            recipients: { kind: 'hit-targets' },
            phase: 'hit',
            reasonCode: 'move.scratch.random-condition',
            payload: {
              action: 'random-choice',
              conditionId: null,
              conditionSource: null,
              filter: null,
              randomChoice: {
                rollId: 'roll.condition',
                conditionIds: ['burned', 'frozen', 'paralysis'],
              },
              duration: null,
              saveTiming: 'canonical',
              stackPolicy: { kind: 'refresh', maxStacks: null },
            },
          },
        ],
      })
      return spec
    }

    const valid = validateMoveSpec(randomConditionSpec())
    expect(valid.spec.phases.flatMap(phase => phase.operations).find(operation => (
      operation.id === 'operation.random-condition'
    ))).toMatchObject({
      kind: 'condition',
      payload: { randomChoice: { rollId: 'roll.condition' } },
    })

    const missing = randomConditionSpec()
    missing.phases[1].operations[1].payload.randomChoice = {
      rollId: 'roll.missing',
      conditionIds: ['burned', 'frozen', 'paralysis'],
    }
    expectDefinitionError(
      () => validateMoveSpec(missing),
      'unknown-reference',
      'spec.phases[1].operations[1].payload.randomChoice.rollId',
    )

    const wrongRange = randomConditionSpec()
    wrongRange.phases[1].operations[0].payload.formula = {
      kind: 'dice', count: 1, sides: 4, modifier: 0,
    }
    expectDefinitionError(
      () => validateMoveSpec(wrongRange),
      'invalid-definition',
      'spec.phases[1].operations[1].payload.randomChoice.rollId',
    )

    const mismatchedRecipients = randomConditionSpec()
    mismatchedRecipients.phases[1].operations[0].recipients = { kind: 'attacked-targets' }
    expectDefinitionError(
      () => validateMoveSpec(mismatchedRecipients),
      'invalid-definition',
      'spec.phases[1].operations[1].payload.randomChoice.rollId',
    )
  })

  it('binds hit-only condition thresholds to an earlier damage accuracy d20', () => {
    const triggeredConditionSpec = (): TestSpec => {
      const spec = validSpec()
      spec.phases[0]!.operations[0]!.recipients = { kind: 'attacked-targets' }
      spec.phases.splice(2, 0, {
        phase: 'after-damage',
        operations: [{
          id: 'operation.burn',
          kind: 'condition',
          source: { kind: 'operation', id: 'operation.damage' },
          recipients: { kind: 'hit-targets' },
          phase: 'after-damage',
          reasonCode: 'move.scratch.burn',
          payload: {
            action: 'apply',
            conditionId: 'burned',
            accuracyRollTrigger: {
              rollId: 'roll.accuracy',
              trigger: { kind: 'range', minimum: 18 },
            },
          },
        }],
      })
      return spec
    }

    expect(validateMoveSpec(triggeredConditionSpec()).spec.phases[2]?.operations[0])
      .toMatchObject({
        kind: 'condition',
        payload: {
          accuracyRollTrigger: {
            rollId: 'roll.accuracy',
            trigger: { kind: 'range', minimum: 18 },
          },
        },
      })

    const unknown = triggeredConditionSpec()
    ;(unknown.phases[2]!.operations[0]!.payload.accuracyRollTrigger as Record<string, unknown>)
      .rollId = 'roll.missing'
    expectDefinitionError(
      () => validateMoveSpec(unknown),
      'unknown-reference',
      'spec.phases[2].operations[0].payload.accuracyRollTrigger.rollId',
    )

    const forward = triggeredConditionSpec()
    const forwardCondition = forward.phases[2]!.operations[0]!
    forwardCondition.source = { kind: 'move', id: 'move.scratch' }
    forwardCondition.phase = 'declare'
    forward.phases[2] = { phase: 'declare', operations: [forwardCondition] }
    expectDefinitionError(
      () => validateMoveSpec(forward),
      'invalid-reference-order',
      'spec.phases[0].operations[0].payload.accuracyRollTrigger.rollId',
    )

    const wrongFormula = triggeredConditionSpec()
    wrongFormula.phases[0]!.operations[0]!.payload.formula = {
      kind: 'dice', count: 2, sides: 10, modifier: 0,
    }
    expectDefinitionError(
      () => validateMoveSpec(wrongFormula),
      'invalid-definition',
      'spec.phases[2].operations[0].payload.accuracyRollTrigger.rollId',
    )

    const notHitOnly = triggeredConditionSpec()
    notHitOnly.phases[2]!.operations[0]!.recipients = { kind: 'attacked-targets' }
    expectDefinitionError(
      () => validateMoveSpec(notHitOnly),
      'invalid-definition',
      'spec.phases[2].operations[0].payload.accuracyRollTrigger.rollId',
    )

    const notDamageLinked = triggeredConditionSpec()
    notDamageLinked.phases[1]!.operations[0]!.payload.accuracyRollId = null
    expectDefinitionError(
      () => validateMoveSpec(notDamageLinked),
      'invalid-definition',
      'spec.phases[2].operations[0].payload.accuracyRollTrigger.rollId',
    )
  })

  it('requires damage-linked HP and damage-timed costs to reference earlier damage', () => {
    const drainOperation = (damageOperationId: string): TestOperation => ({
      id: 'operation.drain',
      kind: 'heal',
      source: { kind: 'operation', id: 'operation.damage' },
      recipients: { kind: 'actor' },
      phase: 'after-damage',
      reasonCode: 'move.scratch.drain',
      payload: {
        mode: 'gain',
        pool: 'hit-points',
        calculation: {
          kind: 'damage-dealt',
          damageOperationId,
          percent: 50,
          aggregation: 'aggregate',
          preventedDamage: 'zero',
        },
        bounds: { minimum: null, maximum: null },
        rounding: 'floor',
        injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
      },
    })
    const valid = validSpec()
    valid.phases.splice(2, 0, {
      phase: 'after-damage',
      operations: [drainOperation('operation.damage')],
    })
    expect(validateMoveSpec(valid).spec.phases[2].operations[0]).toMatchObject({
      kind: 'heal',
      payload: { calculation: { damageOperationId: 'operation.damage' } },
    })

    const unknown = structuredClone(valid)
    unknown.phases[2].operations[0].payload.calculation = {
      ...(unknown.phases[2].operations[0].payload.calculation as Record<string, unknown>),
      damageOperationId: 'operation.missing',
    }
    expectDefinitionError(
      () => validateMoveSpec(unknown),
      'unknown-reference',
      'spec.phases[2].operations[0].payload.calculation.damageOperationId',
    )

    const wrongKind = structuredClone(valid)
    wrongKind.phases[2].operations[0].payload.calculation = {
      ...(wrongKind.phases[2].operations[0].payload.calculation as Record<string, unknown>),
      damageOperationId: 'operation.accuracy',
    }
    expectDefinitionError(
      () => validateMoveSpec(wrongKind),
      'invalid-definition',
      'spec.phases[2].operations[0].payload.calculation.damageOperationId',
    )

    const damageTimedCost = validSpec()
    damageTimedCost.phases.splice(2, 0, {
      phase: 'after-damage',
      operations: [{
        id: 'operation.cost',
        kind: 'direct-hp',
        source: { kind: 'move', id: 'move.scratch' },
        recipients: { kind: 'actor' },
        phase: 'after-damage',
        reasonCode: 'move.scratch.cost',
        payload: {
          mode: 'lose',
          pool: 'hit-points',
          calculation: { kind: 'fixed', value: 5 },
          copySource: null,
          bounds: { minimum: null, maximum: null },
          rounding: 'floor',
          applyTypeImmunity: false,
          cost: {
            kind: 'cost',
            timing: 'damage',
            minimumRemaining: 0,
            damageOperationId: 'operation.damage',
          },
          injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
        },
      }],
    })
    expect(validateMoveSpec(damageTimedCost).spec.phases[2].operations[0]).toMatchObject({
      payload: { cost: { timing: 'damage', damageOperationId: 'operation.damage' } },
    })
  })

  it('requires accuracy-gated direct HP to reference an earlier authoritative d20', () => {
    const directHp: TestOperation = {
      id: 'operation.fixed-loss',
      kind: 'direct-hp',
      source: { kind: 'move', id: 'move.dragon-rage' },
      recipients: { kind: 'hit-targets' },
      phase: 'damage',
      reasonCode: 'move.dragon-rage.fixed-loss',
      payload: {
        mode: 'lose',
        pool: 'hit-points',
        calculation: { kind: 'fixed', value: 15 },
        copySource: null,
        bounds: { minimum: null, maximum: null },
        rounding: 'floor',
        accuracyRollId: 'roll.accuracy',
        applyTypeImmunity: true,
        cost: null,
        injury: { hitPointMarkers: 'apply-after-operation', massiveDamage: 'never' },
      },
    }
    const valid = validSpec()
    valid.phases[0]!.operations = [rollOperation({
      recipients: { kind: 'attacked-targets' },
    })]
    valid.phases[1]!.operations = [directHp]

    expect(validateMoveSpec(valid).spec.phases[1]?.operations[0]).toMatchObject({
      kind: 'direct-hp',
      recipients: { kind: 'hit-targets' },
      payload: { accuracyRollId: 'roll.accuracy' },
    })

    const unknown = structuredClone(valid)
    unknown.phases[1]!.operations[0]!.payload.accuracyRollId = 'roll.missing'
    expectDefinitionError(
      () => validateMoveSpec(unknown),
      'unknown-reference',
      'spec.phases[1].operations[0].payload.accuracyRollId',
    )

    const forward = structuredClone(valid)
    forward.phases[0]!.operations = []
    forward.phases[1]!.operations = [
      { ...directHp, phase: 'damage' },
      rollOperation({ phase: 'damage', recipients: { kind: 'attacked-targets' } }),
    ]
    expectDefinitionError(
      () => validateMoveSpec(forward),
      'invalid-reference-order',
      'spec.phases[1].operations[0].payload.accuracyRollId',
    )

    const modified = structuredClone(valid)
    modified.phases[0]!.operations[0]!.payload.formula = {
      kind: 'dice',
      count: 1,
      sides: 20,
      modifier: 1,
    }
    expectDefinitionError(
      () => validateMoveSpec(modified),
      'invalid-definition',
      'spec.phases[1].operations[0].payload.accuracyRollId',
    )
  })

  it('requires linked HP loss to reference an earlier direct-HP operation with the same pool', () => {
    const source: TestOperation = {
      id: 'operation.sacrifice',
      kind: 'direct-hp',
      source: { kind: 'move', id: 'move.final-gambit' },
      recipients: { kind: 'actor' },
      phase: 'cleanup',
      reasonCode: 'move.final-gambit.sacrifice',
      payload: {
        mode: 'set',
        pool: 'hit-points',
        calculation: { kind: 'fixed', value: 0 },
        copySource: null,
        bounds: { minimum: null, maximum: null },
        rounding: 'floor',
        applyTypeImmunity: false,
        cost: {
          kind: 'sacrifice',
          timing: 'completion',
          minimumRemaining: null,
          damageOperationId: null,
        },
        injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
      },
    }
    const linked: TestOperation = {
      id: 'operation.final-loss',
      kind: 'direct-hp',
      source: { kind: 'operation', id: source.id },
      recipients: { kind: 'hit-targets' },
      phase: 'cleanup',
      reasonCode: 'move.final-gambit.final-loss',
      payload: {
        mode: 'lose',
        pool: 'hit-points',
        calculation: {
          kind: 'hp-lost',
          hpOperationId: source.id,
          pool: 'hit-points',
          percent: 100,
          aggregation: 'aggregate',
        },
        copySource: null,
        bounds: { minimum: null, maximum: null },
        rounding: 'floor',
        applyTypeImmunity: true,
        cost: null,
        injury: { hitPointMarkers: 'apply-after-operation', massiveDamage: 'never' },
      },
    }
    const valid = validSpec()
    valid.phases[2]!.operations = [source, linked]
    expect(validateMoveSpec(valid).spec.phases.at(-1)?.operations).toMatchObject([
      { id: source.id },
      { payload: { calculation: { hpOperationId: source.id } } },
    ])

    const unknown = structuredClone(valid)
    unknown.phases.at(-1)!.operations[1]!.payload.calculation = {
      ...(unknown.phases.at(-1)!.operations[1]!.payload.calculation as Record<string, unknown>),
      hpOperationId: 'operation.missing',
    }
    expectDefinitionError(
      () => validateMoveSpec(unknown),
      'unknown-reference',
      'spec.phases[2].operations[1].payload.calculation.hpOperationId',
    )

    const wrongKind = structuredClone(valid)
    wrongKind.phases.at(-1)!.operations[1]!.payload.calculation = {
      ...(wrongKind.phases.at(-1)!.operations[1]!.payload.calculation as Record<string, unknown>),
      hpOperationId: 'operation.damage',
    }
    expectDefinitionError(
      () => validateMoveSpec(wrongKind),
      'invalid-definition',
      'spec.phases[2].operations[1].payload.calculation.hpOperationId',
    )

    const wrongPool = structuredClone(valid)
    wrongPool.phases.at(-1)!.operations[1]!.payload.calculation = {
      ...(wrongPool.phases.at(-1)!.operations[1]!.payload.calculation as Record<string, unknown>),
      pool: 'temporary-hit-points',
    }
    expectDefinitionError(
      () => validateMoveSpec(wrongPool),
      'invalid-definition',
      'spec.phases[2].operations[1].payload.calculation.pool',
    )
  })

  it('validates canonical damage types and roll-backed critical triggers', () => {
    const unknownMoveType = validSpec()
    unknownMoveType.phases[1].operations[0].payload.moveType = 'mystery'
    expectDefinitionError(
      () => validateMoveSpec(unknownMoveType),
      'invalid-definition',
      'spec.phases[1].operations[0].payload.moveType',
    )

    const unknownDefenderType = validSpec()
    unknownDefenderType.phases[1].operations[0].payload.typeEffectiveness = {
      immunity: 'honor',
      resistance: 'honor',
      weakness: 'honor',
      effectivenessOverride: null,
      defenderTypeOverrides: [{ defenderType: 'mystery', relation: 'weak' }],
    }
    expectDefinitionError(
      () => validateMoveSpec(unknownDefenderType),
      'invalid-definition',
      'spec.phases[1].operations[0].payload.typeEffectiveness.defenderTypeOverrides[0].defenderType',
    )

    const unbackedCriticalRange = validSpec()
    unbackedCriticalRange.phases[1].operations[0].payload.accuracyRollId = null
    unbackedCriticalRange.phases[1].operations[0].payload.criticalHit = {
      trigger: { kind: 'range', minimum: 18 },
      prevention: 'honor',
    }
    expectDefinitionError(
      () => validateMoveSpec(unbackedCriticalRange),
      'invalid-definition',
      'spec.phases[1].operations[0].payload.criticalHit.trigger',
    )
  })

  it('validates multi-hit internal roll identity and critical/type policy', () => {
    const overlappingCoreEffect = validSpec()
    overlappingCoreEffect.phases[1]!.operations = [
      multiHitOperation(),
      damageOperation(),
    ]
    expectDefinitionError(
      () => validateMoveSpec(overlappingCoreEffect),
      'invalid-definition',
      'spec.phases[1].operations[1]',
    )

    const duplicateInternalRoll = validSpec()
    const multiHit = multiHitOperation()
    multiHit.payload.critical = {
      kind: 'per-hit',
      rollId: 'roll.strike',
      formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
    }
    duplicateInternalRoll.phases = [{ phase: 'damage', operations: [multiHit] }]
    expectDefinitionError(
      () => validateMoveSpec(duplicateInternalRoll),
      'duplicate-id',
      'spec.phases[0].operations[0].payload.critical.rollId',
    )

    const unbackedCritical = validSpec()
    const withoutCriticalRoll = multiHitOperation()
    withoutCriticalRoll.payload.critical = { kind: 'none' }
    const nestedDamage = withoutCriticalRoll.payload.damage as Record<string, unknown>
    nestedDamage.criticalHit = {
      trigger: { kind: 'range', minimum: 18 },
      prevention: 'honor',
    }
    unbackedCritical.phases = [{ phase: 'damage', operations: [withoutCriticalRoll] }]
    expectDefinitionError(
      () => validateMoveSpec(unbackedCritical),
      'invalid-definition',
      'spec.phases[0].operations[0].payload.damage.criticalHit.trigger',
    )

    const unknownType = validSpec()
    const invalidType = multiHitOperation()
    const invalidNestedDamage = invalidType.payload.damage as Record<string, unknown>
    invalidNestedDamage.moveType = 'mystery'
    unknownType.phases = [{ phase: 'damage', operations: [invalidType] }]
    expectDefinitionError(
      () => validateMoveSpec(unknownType),
      'invalid-definition',
      'spec.phases[0].operations[0].payload.damage.moveType',
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

    const aggregateBranchPredicates = validSpec()
    const crowdedPredicate = {
      kind: 'all',
      predicates: Array.from({ length: 32 }, () => ({
        kind: 'all',
        predicates: Array.from({ length: 3 }, () => ({ kind: 'constant', value: true })),
      })),
    }
    aggregateBranchPredicates.phases = [
      {
        phase: 'hit',
        operations: [
          branchOperation(['operation.first-log'], {
            payload: {
              kind: 'predicate',
              selectionId: 'branch.first',
              scope: 'resolution',
              predicate: crowdedPredicate,
              whenTrue: { id: 'branch.first-true', operationIds: ['operation.first-log'] },
              whenFalse: { id: 'branch.first-false', operationIds: [] },
            },
          }),
          branchOperation(['operation.second-log'], {
            id: 'operation.branch-second',
            payload: {
              kind: 'predicate',
              selectionId: 'branch.second',
              scope: 'resolution',
              predicate: crowdedPredicate,
              whenTrue: { id: 'branch.second-true', operationIds: ['operation.second-log'] },
              whenFalse: { id: 'branch.second-false', operationIds: [] },
            },
          }),
        ],
      },
      {
        phase: 'cleanup',
        operations: [
          historyOperation('operation.first-log', 'cleanup'),
          historyOperation('operation.second-log', 'cleanup'),
        ],
      },
    ]
    expectDefinitionError(
      () => validateMoveSpec(aggregateBranchPredicates),
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
