import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import { MoveEffectOperationValidationError } from '#shared/moveAutomation/effects'
import {
  buildAuthoritativeMoveRulesContext,
} from '~~/server/domain/moveAutomation/context'
import {
  MoveSpecExecutionError,
  executeMoveSpec,
} from '~~/server/domain/moveAutomation/executeSpec'
import {
  RegisteredMoveHandlerOutputValidationError,
  createRegisteredMoveHandlerRegistry,
  type RegisteredMoveHandlerRegistry,
} from '~~/server/domain/moveAutomation/handlers/registry'
import {
  createFiniteAuthoritativeMoveRandomStream,
  type AuthoritativeMoveRandomDrawStream,
} from '~~/server/domain/moveAutomation/random'
import {
  validateMoveSpec,
  type ValidatedMoveSpecDefinition,
} from '~~/server/domain/moveAutomation/validateSpec'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

interface TestOperation {
  id: string
  kind: string
  source: { kind: string; id: string }
  recipients: { kind: string }
  phase: string
  reasonCode: string
  payload: Record<string, unknown>
}

interface TestSpec {
  schemaVersion: number
  canonicalId: string
  version: number
  targeting: {
    kind: string
    minTargets: number
    maxTargets: number
    selector: Record<string, unknown> | null
  }
  preconditions: Array<{
    id: string
    predicate: Record<string, unknown>
    failureReasonCode: string
  }>
  costs: Record<string, unknown>[]
  phases: Array<{ phase: string; operations: TestOperation[] }>
  registeredHandlerId: string | null
  presentation: {
    displayName: string
    vfxKey: string | null
    tags: string[]
  }
}

const placement = (id: string, sheetSlug: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 0 },
})

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'movespec-arena',
  name: 'MoveSpec Arena',
  revision: 4,
  dimensions: { x: 8, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    placement('actor-token', 'actor', 0),
    placement('target-token', 'target', 1),
    placement('bystander-token', 'bystander', 2),
  ],
  lights: [],
  initiative: { activeId: 'actor-token', round: 1 },
})

const pokemonSheet = (slug: string): CharacterSheet => ({
  slug,
  nickname: slug,
  species: slug === 'target' ? 'Snorlax' : 'Pikachu',
  level: 20,
  revision: 3,
  movelist: slug === 'actor' ? [{ name: 'Tackle' }] : [],
  combat: { currentHp: 50 },
})

const intent = (): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  placementId: 'actor-token',
  moveName: 'Tackle',
  selection: { kind: 'single-target', targetPlacementId: 'target-token' },
})

const buildContext = (options: {
  readonly random?: AuthoritativeMoveRandomDrawStream
  readonly candidatePlacementIds?: readonly string[]
  readonly selectedPlacementIds?: readonly string[]
} = {}) => buildAuthoritativeMoveRulesContext({
  map: mapFixture(),
  pokemonSheets: new Map([
    ['actor', pokemonSheet('actor')],
    ['target', pokemonSheet('target')],
    ['bystander', pokemonSheet('bystander')],
  ]),
  trainerSheets: new Map<string, TrainerSheet>(),
  intent: intent(),
  candidatePlacementIds: options.candidatePlacementIds ?? ['target-token'],
  selectedPlacementIds: options.selectedPlacementIds ?? ['target-token'],
  random: options.random ?? createFiniteAuthoritativeMoveRandomStream([]),
  time: 10_000,
})

const logOperation = (
  id: string,
  phase: string,
  recipients = 'none',
): TestOperation => ({
  id,
  kind: 'log',
  source: { kind: 'move', id: 'move.interpreter-test' },
  recipients: { kind: recipients },
  phase,
  reasonCode: `move.interpreter-test.${id.split('.').at(-1)}`,
  payload: {
    messageKey: `move.interpreter-test.${id.split('.').at(-1)}`,
    arguments: [],
  },
})

const rollOperation = (): TestOperation => ({
  id: 'operation.accuracy',
  kind: 'roll',
  source: { kind: 'move', id: 'move.interpreter-test' },
  recipients: { kind: 'none' },
  phase: 'accuracy',
  reasonCode: 'move.interpreter-test.accuracy',
  payload: {
    rollId: 'roll.accuracy',
    formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
  },
})

const baseSpec = (): TestSpec => ({
  schemaVersion: 2,
  canonicalId: 'Interpreter Test',
  version: 1,
  targeting: {
    kind: 'none',
    minTargets: 0,
    maxTargets: 0,
    selector: null,
  },
  preconditions: [],
  costs: [],
  phases: [],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Interpreter Test',
    vfxKey: null,
    tags: ['test-only'],
  },
})

const definitionFor = (
  spec: TestSpec,
  handlerRegistry?: RegisteredMoveHandlerRegistry,
): ValidatedMoveSpecDefinition => validateMoveSpec(spec, { handlerRegistry })

const traceEventsOfKind = <Kind extends string>(
  result: ReturnType<typeof executeMoveSpec>,
  kind: Kind,
) => result.trace.events.filter(event => event.kind === kind)

describe('phased MoveSpec interpreter', () => {
  it('walks canonical phases, evaluates predicates and selectors, emits logs, and stays pure', () => {
    const spec = baseSpec()
    spec.targeting = {
      kind: 'single-target',
      minTargets: 1,
      maxTargets: 1,
      selector: {
        kind: 'intersection',
        selectors: [
          { kind: 'selected-targets' },
          { kind: 'candidate-targets' },
        ],
      },
    }
    spec.preconditions = [{
      id: 'actor.can-declare',
      predicate: {
        kind: 'all',
        predicates: [
          { kind: 'constant', value: true },
          {
            kind: 'comparison',
            operator: 'greater-than',
            left: { kind: 'constant', value: 3 },
            right: { kind: 'constant', value: 2 },
          },
          {
            kind: 'not',
            predicate: { kind: 'constant', value: false },
          },
        ],
      },
      failureReasonCode: 'actor.cannot-declare',
    }]
    spec.phases = [
      { phase: 'declare', operations: [logOperation('operation.declared', 'declare', 'actor')] },
      { phase: 'target', operations: [logOperation('operation.targeted', 'target', 'attacked-targets')] },
      { phase: 'cleanup', operations: [logOperation('operation.completed', 'cleanup')] },
    ]

    const context = buildContext({
      candidatePlacementIds: ['target-token'],
      selectedPlacementIds: ['bystander-token', 'target-token'],
    })
    const mapBefore = structuredClone(context.map)
    const sheetsBefore = structuredClone(context.resolvedSheets)
    const result = executeMoveSpec({ definition: definitionFor(spec), context })

    expect(result.kind).toBe('complete')
    expect(result.targetIds).toEqual(['target-token'])
    expect(result.operations.map(({ operation, recipientIds }) => ({
      id: operation.id,
      recipientIds,
    }))).toEqual([
      { id: 'operation.declared', recipientIds: ['actor-token'] },
      { id: 'operation.targeted', recipientIds: ['target-token'] },
      { id: 'operation.completed', recipientIds: [] },
    ])
    expect(traceEventsOfKind(result, 'phase-transition').map(event => (
      event.kind === 'phase-transition' ? event.to : null
    ))).toEqual(['declare', 'precondition', 'target', 'cleanup'])
    expect(traceEventsOfKind(result, 'predicate')).toEqual([
      expect.objectContaining({
        kind: 'predicate',
        predicateId: 'actor.can-declare',
        outcome: true,
        reasonCode: 'precondition-passed',
      }),
    ])
    expect(traceEventsOfKind(result, 'target')).toEqual([
      expect.objectContaining({ targetId: 'target-token', outcome: 'included' }),
      expect.objectContaining({ targetId: 'bystander-token', outcome: 'excluded' }),
    ])
    expect(traceEventsOfKind(result, 'operation').map(event => (
      event.kind === 'operation' ? event.operationId : null
    ))).toEqual(['operation.declared', 'operation.targeted', 'operation.completed'])
    expect(result.rollLedger).toEqual([])
    expect(result.sheetReads).toEqual([])
    expect(context.map).toEqual(mapBefore)
    expect(context.resolvedSheets).toEqual(sheetsBefore)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.operations)).toBe(true)
    expect(Object.isFrozen(result.targetIds)).toBe(true)
  })

  it('resolves injected rolls into the ledger and trace before finishing', () => {
    const spec = baseSpec()
    spec.phases = [
      { phase: 'accuracy', operations: [rollOperation()] },
      { phase: 'cleanup', operations: [logOperation('operation.completed', 'cleanup')] },
    ]
    const stream = createFiniteAuthoritativeMoveRandomStream([0.5])

    const result = executeMoveSpec({
      definition: definitionFor(spec),
      context: buildContext({ random: stream }),
    })

    expect(result.kind).toBe('complete')
    expect(stream.consumed).toBe(1)
    expect(stream.remaining).toBe(0)
    expect(result.rollLedger).toEqual([
      expect.objectContaining({
        rollId: 'roll.accuracy',
        parentEffectId: 'operation.accuracy',
        naturalResults: [11],
        naturalResult: 11,
        finalValue: 11,
      }),
    ])
    expect(traceEventsOfKind(result, 'roll')).toEqual([
      expect.objectContaining({
        kind: 'roll',
        phase: 'accuracy',
        roll: expect.objectContaining({ rollId: 'roll.accuracy', finalValue: 11 }),
      }),
    ])
  })

  it('stops at an unresolved typed choice without running later operations or sealing randomness', () => {
    const spec = baseSpec()
    spec.phases = [
      { phase: 'declare', operations: [logOperation('operation.declared', 'declare')] },
      {
        phase: 'hit',
        operations: [{
          id: 'operation.choose-branch',
          kind: 'choice-request',
          source: { kind: 'move', id: 'move.interpreter-test' },
          recipients: { kind: 'actor' },
          phase: 'hit',
          reasonCode: 'move.interpreter-test.choose-branch',
          payload: {
            requestId: 'request.branch',
            promptKey: 'move.interpreter-test.choose-branch',
            options: [
              { id: 'option.one', labelKey: 'move.interpreter-test.option-one' },
              { id: 'option.two', labelKey: 'move.interpreter-test.option-two' },
            ],
            allowPass: true,
          },
        }],
      },
      { phase: 'cleanup', operations: [logOperation('operation.never-runs', 'cleanup')] },
    ]
    const stream = createFiniteAuthoritativeMoveRandomStream([0.25])

    const result = executeMoveSpec({
      definition: definitionFor(spec),
      context: buildContext({ random: stream }),
    })

    expect(result.kind).toBe('pending-request')
    if (result.kind !== 'pending-request') return
    expect(result.request).toEqual({
      kind: 'choice',
      operationId: 'operation.choose-branch',
      phase: 'hit',
      reasonCode: 'move.interpreter-test.choose-branch',
      recipientIds: ['actor-token'],
      requestId: 'request.branch',
      promptKey: 'move.interpreter-test.choose-branch',
      options: [
        { id: 'option.one', labelKey: 'move.interpreter-test.option-one' },
        { id: 'option.two', labelKey: 'move.interpreter-test.option-two' },
      ],
      allowPass: true,
    })
    expect(result.operations.map(({ operation }) => operation.id)).toEqual([
      'operation.declared',
      'operation.choose-branch',
    ])
    expect(traceEventsOfKind(result, 'phase-transition').map(event => (
      event.kind === 'phase-transition' ? event.to : null
    ))).toEqual(['declare', 'hit'])
    expect(traceEventsOfKind(result, 'choice')).toEqual([
      expect.objectContaining({
        requestId: 'request.branch',
        requestKind: 'choice',
        outcome: 'requested',
      }),
    ])
    expect(stream.consumed).toBe(0)
    expect(stream.remaining).toBe(1)
  })

  it('returns a traced rejection for failed preconditions and target-count mismatches', () => {
    const failedPrecondition = baseSpec()
    failedPrecondition.preconditions = [{
      id: 'actor.allowed',
      predicate: { kind: 'constant', value: false },
      failureReasonCode: 'actor.not-allowed',
    }]
    failedPrecondition.phases = [
      { phase: 'cleanup', operations: [logOperation('operation.never-runs', 'cleanup')] },
    ]

    const preconditionResult = executeMoveSpec({
      definition: definitionFor(failedPrecondition),
      context: buildContext(),
    })
    expect(preconditionResult).toMatchObject({
      kind: 'rejected',
      operations: [],
      rejection: {
        code: 'precondition-failed',
        reasonCode: 'actor.not-allowed',
        preconditionId: 'actor.allowed',
      },
    })
    expect(traceEventsOfKind(preconditionResult, 'predicate')).toEqual([
      expect.objectContaining({ outcome: false, reasonCode: 'actor.not-allowed' }),
    ])

    const invalidTargetCount = baseSpec()
    invalidTargetCount.targeting = {
      kind: 'multi-target',
      minTargets: 1,
      maxTargets: 1,
      selector: { kind: 'selected-targets' },
    }
    const targetResult = executeMoveSpec({
      definition: definitionFor(invalidTargetCount),
      context: buildContext({ selectedPlacementIds: ['target-token', 'bystander-token'] }),
    })
    expect(targetResult).toMatchObject({
      kind: 'rejected',
      rejection: {
        code: 'target-count-out-of-range',
        actualTargetCount: 2,
        minimumTargetCount: 1,
        maximumTargetCount: 1,
      },
    })
  })

  it('revalidates every operation before execution, randomness, or persistence planning', () => {
    const spec = baseSpec()
    spec.phases = [
      { phase: 'accuracy', operations: [rollOperation()] },
      { phase: 'cleanup', operations: [logOperation('operation.completed', 'cleanup')] },
    ]
    const forged = structuredClone(definitionFor(spec)) as unknown as { spec: TestSpec }
    forged.spec.phases[1]!.operations[0]!.kind = 'state-patch'
    const stream = createFiniteAuthoritativeMoveRandomStream([0.5])
    const context = buildContext({ random: stream })
    const mapBefore = structuredClone(context.map)

    expect(() => executeMoveSpec({
      definition: forged as unknown as ValidatedMoveSpecDefinition,
      context,
    }))
      .toThrowError(expect.objectContaining({
        name: MoveEffectOperationValidationError.name,
        code: 'unknown-operation-kind',
        path: 'spec.phases[1].operations[0].kind',
      }))
    expect(stream.consumed).toBe(0)
    expect(stream.remaining).toBe(1)
    expect(context.random.snapshot()).toEqual([])
    expect(context.map).toEqual(mapBefore)
  })

  it('runs a version-pinned pure handler through the same operation and trace interpreter', () => {
    let receivedContextKeys: readonly string[] = []
    const handlerRegistry = createRegisteredMoveHandlerRegistry([{
      id: 'move.contextual-log',
      version: 4,
      run: (context) => {
        receivedContextKeys = Object.keys(context).sort()
        expect(Object.isFrozen(context)).toBe(true)
        expect(Object.isFrozen(context.map)).toBe(true)
        expect('random' in context).toBe(false)
        expect('time' in context).toBe(false)
        expect('idFactory' in context).toBe(false)
        context.reads.recordPlacement(context.actor.placement)
        return {
          operations: [logOperation('handler.contextual-log', 'hit', 'actor')],
          traceEntries: [{
            kind: 'predicate',
            phase: 'hit',
            predicateId: 'handler.contextual-calculation',
            outcome: true,
            reasonCode: 'handler.contextual-calculation-passed',
            input: { actorLevel: context.actor.token.level },
          }],
        }
      },
    }])
    const spec = baseSpec()
    spec.registeredHandlerId = 'move.contextual-log'
    const definition = definitionFor(spec, handlerRegistry)
    const context = buildContext()
    const originalNow = Date.now
    const originalRandom = Math.random
    Date.now = () => { throw new Error('handler execution used an ambient clock') }
    Math.random = () => { throw new Error('handler execution used ambient randomness') }
    let result: ReturnType<typeof executeMoveSpec>
    try {
      result = executeMoveSpec({ definition, context, handlerRegistry })
    }
    finally {
      Date.now = originalNow
      Math.random = originalRandom
    }

    expect(result.kind).toBe('complete')
    expect(definition.registeredHandler).toEqual({ id: 'move.contextual-log', version: 4 })
    expect(receivedContextKeys).toEqual([
      'actor',
      'candidatePlacements',
      'intent',
      'map',
      'queries',
      'reads',
      'resolvedSheets',
      'ruleset',
      'selectedPlacements',
    ])
    expect(result.operations).toEqual([{
      operation: logOperation('handler.contextual-log', 'hit', 'actor'),
      recipientIds: ['actor-token'],
    }])
    expect(result.sheetReads).toEqual([
      { kind: 'pokemon', slug: 'actor', revision: 3 },
    ])
    expect(traceEventsOfKind(result, 'phase-transition')).toEqual([
      expect.objectContaining({ kind: 'phase-transition', to: 'hit' }),
    ])
    expect(traceEventsOfKind(result, 'predicate')).toEqual([
      expect.objectContaining({
        predicateId: 'handler.contextual-calculation',
        outcome: true,
        reasonCode: 'handler.contextual-calculation-passed',
      }),
    ])
    expect(traceEventsOfKind(result, 'operation')).toEqual([
      expect.objectContaining({ operationId: 'handler.contextual-log', outcome: 'applied' }),
    ])
  })

  it('enforces one combined operation budget before handler operations can run', () => {
    const handlerRegistry = createRegisteredMoveHandlerRegistry([{
      id: 'move.oversized-handler',
      version: 1,
      run: () => ({
        operations: Array.from({ length: 128 }, (_, index) =>
          logOperation(`handler.log-${index}`, 'hit')),
        traceEntries: [],
      }),
    }])
    const spec = baseSpec()
    spec.registeredHandlerId = 'move.oversized-handler'
    spec.phases = [{
      phase: 'declare',
      operations: [logOperation('spec.declared', 'declare')],
    }]

    expect(() => executeMoveSpec({
      definition: definitionFor(spec, handlerRegistry),
      context: buildContext(),
      handlerRegistry,
    })).toThrowError(expect.objectContaining({
      name: RegisteredMoveHandlerOutputValidationError.name,
      code: 'limit-exceeded',
      path: 'handlerOutput.operations',
    }))
  })

  it('fails closed before phases for costs and unsupported expressions', () => {
    const context = buildContext()

    const withCost = baseSpec()
    withCost.costs = [{ id: 'cost.action', phase: 'pay', cost: { kind: 'standard-action' } }]
    expect(() => executeMoveSpec({ definition: definitionFor(withCost), context }))
      .toThrowError(expect.objectContaining({
        name: MoveSpecExecutionError.name,
        code: 'cost-unsupported',
      }))

    const withExpression = baseSpec()
    withExpression.preconditions = [{
      id: 'actor.level-check',
      predicate: {
        kind: 'comparison',
        operator: 'greater-than',
        left: { kind: 'stat', subject: { kind: 'actor' }, stat: 'level' },
        right: { kind: 'constant', value: 1 },
      },
      failureReasonCode: 'actor.level-too-low',
    }]
    expect(() => executeMoveSpec({ definition: definitionFor(withExpression), context: buildContext() }))
      .toThrowError(expect.objectContaining({
        name: MoveSpecExecutionError.name,
        code: 'expression-unsupported',
      }))
  })
})
