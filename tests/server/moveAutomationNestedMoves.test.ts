import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parsePendingMoveResolution } from '#shared/moveAutomation/pendingResolution'
import type { MoveSpec } from '#shared/moveAutomation/spec'
import {
  buildAuthoritativeMoveRulesContext,
} from '~~/server/domain/moveAutomation/context'
import {
  executeMoveSpec,
  MoveSpecExecutionError,
} from '~~/server/domain/moveAutomation/executeSpec'
import {
  NESTED_MOVE_EXECUTION_LIMITS,
} from '~~/server/domain/moveAutomation/nestedExecution'
import {
  REGISTERED_MOVE_HANDLER_REGISTRY,
} from '~~/server/domain/moveAutomation/handlers/registry'
import {
  materializeMoveSpecSuspension,
} from '~~/server/domain/moveAutomation/materializeSuspension'
import {
  createMoveStateChangePlan,
} from '~~/server/domain/moveAutomation/plan'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveStateExecution,
} from '~~/server/domain/planAuthoritativeMoveState'
import {
  createFiniteAuthoritativeMoveRandomStream,
} from '~~/server/domain/moveAutomation/random'
import {
  reduceCompletedMoveSpec,
} from '~~/server/domain/moveAutomation/resolveImmediateSpec'
import { summarizeMoveResolutionTrace } from '~~/server/domain/moveAutomation/trace'
import { resumeMoveSpec } from '~~/server/domain/moveAutomation/resumeSpec'
import type {
  MoveAutomationRuntimeRegistry,
  MoveSpecV2Runtime,
} from '~~/server/domain/moveAutomation/registry'
import {
  validateMoveSpec,
  type ValidatedMoveSpecDefinition,
} from '~~/server/domain/moveAutomation/validateSpec'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { moveListOverlayEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'

const placement = (id: string, sheetSlug: string, x: number, z = 0): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z },
})

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'nested-move-arena',
  name: 'Nested Move Arena',
  revision: 8,
  dimensions: { x: 8, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    placement('actor-token', 'actor', 0),
    placement('target-token', 'target', 1),
    placement('bystander-token', 'bystander', 0, 1),
  ],
  lights: [],
  initiative: { activeId: 'actor-token', round: 1 },
  encounterState: createEmptyEncounterState(),
})

const sheet = (
  slug: string,
  movelist: readonly string[] = [],
): CharacterSheet => ({
  slug,
  nickname: slug,
  species: slug === 'target' ? 'Snorlax' : 'Pikachu',
  level: 20,
  revision: 3,
  movelist: movelist.map(name => ({ name })),
  stats: {
    atk: { stage: 0 },
    def: { stage: 0 },
    satk: { stage: 0 },
    sdef: { stage: 0 },
    spd: { stage: 0 },
  },
  combatStages: { acc: 0 },
  combat: { currentHp: 50 },
})

const pokemonSheets = (actorMovelist: readonly string[] = ['Tackle']) => new Map<string, CharacterSheet>([
  ['actor', sheet('actor', actorMovelist)],
  ['target', sheet('target')],
  ['bystander', sheet('bystander')],
])

const intent = (): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  placementId: 'actor-token',
  moveName: 'Tackle',
  selection: { kind: 'single-target', targetPlacementId: 'target-token' },
})

const roll = (id: string, phase: 'accuracy' | 'damage') => ({
  id,
  kind: 'roll',
  source: { kind: 'move', id: 'move.tackle' },
  recipients: { kind: 'none' },
  phase,
  reasonCode: `${id}.reason`,
  payload: {
    rollId: `${id}.roll`,
    formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
  },
})

const stage = (id: string) => ({
  id,
  kind: 'combat-stage',
  source: { kind: 'move', id: 'move.swords-dance' },
  recipients: { kind: 'actor' },
  phase: 'hit',
  reasonCode: `${id}.reason`,
  payload: {
    action: 'modify',
    stage: 'atk',
    selectedStage: null,
    value: 2,
    stageSource: null,
    rounding: null,
  },
})

const nestedOperation = (overrides: Record<string, unknown> = {}) => ({
  id: 'parent.invoke-child',
  kind: 'nested-move',
  source: { kind: 'move', id: 'move.tackle' },
  recipients: { kind: 'attacked-targets' },
  phase: 'hit',
  reasonCode: 'parent.invoke-reviewed-child',
  payload: {
    canonicalId: 'Swords Dance',
    actor: { kind: 'sole-recipient' },
    source: { kind: 'registered-spec' },
    targeting: { kind: 'operation-recipients' },
  },
  ...overrides,
})

const childSpec = (operations: readonly Record<string, unknown>[]): MoveSpec => {
  const byPhase = new Map<string, Record<string, unknown>[]>()
  for (const operation of operations) {
    const phase = String(operation.phase)
    byPhase.set(phase, [...(byPhase.get(phase) ?? []), operation])
  }
  return {
    schemaVersion: 2,
    canonicalId: 'Swords Dance',
    version: 1,
    targeting: {
      kind: 'self',
      minTargets: 1,
      maxTargets: 1,
      selector: { kind: 'actor' },
    },
    preconditions: [],
    costs: [],
    phases: ['accuracy', 'hit', 'usage'].flatMap(phase => {
      const phaseOperations = byPhase.get(phase)
      return phaseOperations ? [{ phase, operations: phaseOperations }] : []
    }),
    registeredHandlerId: null,
    presentation: {
      displayName: 'Swords Dance',
      vfxKey: null,
      tags: ['test-only'],
    },
  } as MoveSpec
}

const parentSpec = (operations: readonly Record<string, unknown>[]): MoveSpec => {
  const byPhase = new Map<string, Record<string, unknown>[]>()
  for (const operation of operations) {
    const phase = String(operation.phase)
    byPhase.set(phase, [...(byPhase.get(phase) ?? []), operation])
  }
  const phaseOrder = ['accuracy', 'hit', 'damage', 'usage']
  return {
    schemaVersion: 2,
    canonicalId: 'Tackle',
    version: 1,
    targeting: {
      kind: 'single-target',
      minTargets: 1,
      maxTargets: 1,
      selector: { kind: 'selected-targets' },
    },
    preconditions: [],
    costs: [],
    phases: phaseOrder.flatMap(phase => {
      const phaseOperations = byPhase.get(phase)
      return phaseOperations ? [{ phase, operations: phaseOperations }] : []
    }),
    registeredHandlerId: null,
    presentation: {
      displayName: 'Tackle',
      vfxKey: null,
      tags: ['test-only'],
    },
  } as MoveSpec
}

const runtime = (
  definition: ValidatedMoveSpecDefinition,
  sourceModule: string,
): MoveSpecV2Runtime => Object.freeze({
  canonicalId: definition.spec.canonicalId,
  kind: 'movespec-v2',
  version: definition.spec.version,
  definitionHash: definition.definitionHash,
  sourceModule,
  definition,
})

const registryFromDefinitions = (
  ...definitions: readonly ValidatedMoveSpecDefinition[]
): MoveAutomationRuntimeRegistry => {
  const entries = Object.freeze(definitions.map((definition, index) => runtime(
    definition,
    `tests/fixtures/nested-${index + 1}.ts`,
  )))
  const byId = new Map(entries.map(entry => [entry.canonicalId, entry]))
  return Object.freeze({
    size: entries.length,
    handlerRegistry: REGISTERED_MOVE_HANDLER_REGISTRY,
    resolve: (canonicalId: string) => byId.get(canonicalId) ?? null,
    entries: () => entries,
  })
}

const registryFor = (
  parentDefinition: ValidatedMoveSpecDefinition,
  childDefinition: ValidatedMoveSpecDefinition,
): MoveAutomationRuntimeRegistry => registryFromDefinitions(parentDefinition, childDefinition)

const contextFor = (options: {
  readonly registry: MoveAutomationRuntimeRegistry
  readonly random?: readonly number[]
  readonly candidatePlacementIds?: readonly string[]
  readonly actorMovelist?: readonly string[]
  readonly effects?: readonly EncounterEffect[]
} ) => {
  const map = mapFixture()
  if (options.effects) {
    map.encounterState = { ...map.encounterState!, effects: [...options.effects] }
  }
  return buildAuthoritativeMoveRulesContext({
    map,
    pokemonSheets: pokemonSheets(options.actorMovelist),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: intent(),
    candidatePlacementIds: options.candidatePlacementIds ?? ['target-token'],
    selectedPlacementIds: ['target-token'],
    random: createFiniteAuthoritativeMoveRandomStream(options.random ?? []),
    time: 12_000,
    resolutionId: 'resolution-parent',
    runtimeRegistry: options.registry,
  })
}

const childFieldOperation = {
  id: 'child.sun',
  kind: 'field',
  source: { kind: 'move', id: 'move.swords-dance' },
  recipients: { kind: 'none' },
  phase: 'hit',
  reasonCode: 'child.sunny-weather',
  payload: {
    action: 'apply',
    category: 'weather',
    fieldId: 'sunny',
    rounds: 5,
  },
}

const childUsageOperation = {
  id: 'child.usage',
  kind: 'usage',
  source: { kind: 'move', id: 'move.swords-dance' },
  recipients: { kind: 'actor' },
  phase: 'usage',
  reasonCode: 'child.frequency-use',
  payload: {
    action: 'spend',
    resourceId: 'swords-dance.frequency-use',
    amount: 1,
  },
}

const logOperation = (id: string) => ({
  id,
  kind: 'log',
  source: { kind: 'move', id: 'move.swords-dance' },
  recipients: { kind: 'none' },
  phase: 'hit',
  reasonCode: `${id}.reason`,
  payload: {
    messageKey: `${id}.message`,
    arguments: [],
  },
})

const usageOperation = {
  id: 'parent.usage',
  kind: 'usage',
  source: { kind: 'move', id: 'move.tackle' },
  recipients: { kind: 'actor' },
  phase: 'usage',
  reasonCode: 'parent.frequency-use',
  payload: {
    action: 'spend',
    resourceId: 'tackle.frequency-use',
    amount: 1,
  },
}

describe('reviewed nested MoveSpec execution', () => {
  it('shares RNG, uses the explicit child actor, and retains exact ancestry', () => {
    const childDefinition = validateMoveSpec(childSpec([
      roll('child.roll', 'accuracy'),
      stage('child.raise-attack'),
    ]))
    const parentDefinition = validateMoveSpec(parentSpec([
      roll('parent.before', 'accuracy'),
      nestedOperation(),
      roll('parent.after', 'damage'),
    ]))
    const registry = registryFor(parentDefinition, childDefinition)
    const context = contextFor({ registry, random: [0, 0.25, 0.5] })

    const result = executeMoveSpec({
      definition: parentDefinition,
      context,
      authoritativeTargetIds: ['target-token'],
      resolutionId: 'resolution-parent',
    })

    expect(result.kind).toBe('complete')
    if (result.kind !== 'complete') return
    expect(result.rollLedger.map(entry => entry.rollId)).toEqual([
      'parent.before.roll',
      'child.roll.roll',
      'parent.after.roll',
    ])
    expect(result.operations.map(emission => ({
      id: emission.operation.id,
      phase: emission.operation.phase,
      childResolutionId: emission.childResolutionId ?? null,
    }))).toEqual([
      { id: 'parent.before', phase: 'accuracy', childResolutionId: null },
      { id: 'parent.invoke-child', phase: 'hit', childResolutionId: null },
      {
        id: 'child.roll',
        phase: 'hit',
        childResolutionId: expect.stringMatching(/^resolution-nested-/),
      },
      {
        id: 'child.raise-attack',
        phase: 'hit',
        childResolutionId: expect.stringMatching(/^resolution-nested-/),
      },
      { id: 'parent.after', phase: 'damage', childResolutionId: null },
    ])
    expect(result.childExecutions).toHaveLength(1)
    expect(result.childExecutions[0]).toMatchObject({
      actorPlacementId: 'target-token',
      canonicalId: 'Swords Dance',
      operationIds: ['child.roll', 'child.raise-attack'],
      targetIds: ['target-token'],
      trace: {
        program: { canonicalId: 'Swords Dance' },
        ancestry: [{
          depth: 0,
          resolutionId: 'resolution-parent',
          canonicalId: 'Tackle',
          definitionHash: parentDefinition.definitionHash,
          parentOperationId: 'parent.invoke-child',
        }],
      },
    })
    expect(result.trace.events.filter(event => event.kind === 'child-move')).toEqual([
      expect.objectContaining({
        canonicalId: 'Swords Dance',
        depth: 1,
        outcome: 'started',
      }),
      expect.objectContaining({
        canonicalId: 'Swords Dance',
        depth: 1,
        outcome: 'completed',
      }),
    ])

    const parentEntry = context.queries.resolveActorMoveEntry('Tackle')
    expect(parentEntry.ok).toBe(true)
    if (!parentEntry.ok) return
    const reduced = reduceCompletedMoveSpec({
      context,
      runtime: runtime(parentDefinition, 'tests/fixtures/parent.ts'),
      entry: parentEntry.entry,
      authoritativeTargetIds: ['target-token'],
    }, result)
    expect(reduced.transaction.combatStageUpdates).toEqual([
      expect.objectContaining({
        id: 'target-token',
        stages: expect.objectContaining({ atk: 2 }),
      }),
    ])
    expect(reduced.transaction.combatStageUpdates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'actor-token' }),
    ]))
    expect(context.queries.resolveActorMoveEntry('Swords Dance')).toMatchObject({
      ok: false,
      reason: 'move-absent',
    })
  })

  it('restores serial durable target and child branch windows after reconnect before completing once', () => {
    const childDefinition = validateMoveSpec({
      ...childSpec([]),
      canonicalId: 'Scratch',
      targeting: {
        kind: 'single-target',
        minTargets: 1,
        maxTargets: 1,
        selector: { kind: 'selected-targets' },
      },
      phases: [{
        phase: 'hit',
        operations: [{
          id: 'child.choose-branch',
          kind: 'branch',
          source: { kind: 'move', id: 'move.scratch' },
          recipients: { kind: 'attacked-targets' },
          phase: 'hit',
          reasonCode: 'child.choose-effect',
          payload: {
            kind: 'choice',
            selectionId: 'child.effect',
            scope: 'resolution',
            requestId: 'child.branch-window',
            promptKey: 'move.child.choose-effect',
            options: [{
              id: 'boost',
              labelKey: 'move.child.boost',
              operationIds: ['child.raise-attack'],
            }, {
              id: 'skip',
              labelKey: 'move.child.skip',
              operationIds: ['child.skip-log'],
            }],
            pass: null,
          },
        }, {
          ...stage('child.raise-attack'),
          source: { kind: 'move', id: 'move.scratch' },
        }, {
          id: 'child.skip-log',
          kind: 'log',
          source: { kind: 'move', id: 'move.scratch' },
          recipients: { kind: 'none' },
          phase: 'hit',
          reasonCode: 'child.branch-skipped',
          payload: {
            messageKey: 'move.child.branch-skipped',
            arguments: [],
          },
        }],
      }],
      presentation: {
        displayName: 'Scratch',
        vfxKey: null,
        tags: ['test-only'],
      },
    })
    const invocation = nestedOperation({
      recipients: { kind: 'none' },
      phase: 'hit',
      payload: {
        canonicalId: 'Scratch',
        actor: { kind: 'parent-actor' },
        source: { kind: 'registered-spec' },
        targeting: {
          kind: 'fresh-choice',
          requestId: 'parent.child-target-window',
          promptKey: 'move.parent.choose-child-target',
          selector: {
            kind: 'difference',
            source: { kind: 'candidate-targets' },
            exclude: { kind: 'actor' },
          },
        },
      },
    })
    const parentDefinition = validateMoveSpec(parentSpec([invocation]))
    const registry = registryFor(parentDefinition, childDefinition)

    const first = executeMoveSpec({
      definition: parentDefinition,
      context: contextFor({
        registry,
        candidatePlacementIds: ['target-token', 'bystander-token'],
      }),
      authoritativeTargetIds: ['target-token'],
      resolutionId: 'resolution-parent',
    })
    expect(first.kind).toBe('pending-request')
    if (first.kind !== 'pending-request') return
    expect(first.request).toMatchObject({
      kind: 'nested-target-choice',
      requestId: 'parent.child-target-window',
      childCanonicalId: 'Scratch',
      recipientIds: ['actor-token'],
    })
    expect(first.request.options).toHaveLength(2)
    expect(first.childExecutions).toEqual([])
    const durableTargetWindow = materializeMoveSpecSuspension({
      resolutionId: 'resolution-parent',
      originOpId: 'op_nestedtarget0001',
      definition: parentDefinition,
      originMapSlug: 'nested-move-arena',
      originMapRevision: 8,
      actorPlacementId: 'actor-token',
      suspendedAt: 12_000,
      authoritativeSheetReads: first.sheetReads,
      execution: first,
      continuationMapRevision: 9,
      preWindowPlan: createMoveStateChangePlan([]),
    })
    expect(durableTargetWindow.pendingResolution.outstandingWindows[0]).toMatchObject({
      windowId: 'parent.child-target-window',
      operationId: 'parent.invoke-child',
      kind: 'choice',
      options: first.request.options,
    })
    const reconnectedTargetResolution = parsePendingMoveResolution(
      JSON.parse(JSON.stringify(durableTargetWindow.pendingResolution)),
    )
    expect(reconnectedTargetResolution).toEqual(durableTargetWindow.pendingResolution)

    const targetOptionId = first.request.options[1]!.id
    const resumed = resumeMoveSpec({
      pendingResolution: reconnectedTargetResolution,
      map: {
        ...mapFixture(),
        revision: 9,
        encounterState: {
          ...createEmptyEncounterState(),
          pendingResolutionSummaries: [durableTargetWindow.publicSummary],
        },
      },
      pokemonSheets: pokemonSheets(),
      trainerSheets: new Map<string, TrainerSheet>(),
      response: {
        requestId: 'parent.child-target-window',
        optionId: targetOptionId,
      },
      now: 12_001,
      random: createFiniteAuthoritativeMoveRandomStream([]),
      runtimeRegistry: registry,
    })
    expect(resumed).toMatchObject({
      kind: 'pending',
      execution: {
        request: {
          kind: 'branch-choice',
          requestId: 'child.branch-window',
        },
      },
    })

    const second = executeMoveSpec({
      definition: parentDefinition,
      context: contextFor({
        registry,
        candidatePlacementIds: ['target-token', 'bystander-token'],
      }),
      authoritativeTargetIds: ['target-token'],
      resolutionId: 'resolution-parent',
      responses: [{
        requestId: 'parent.child-target-window',
        optionId: targetOptionId,
      }],
    })
    expect(second.kind).toBe('pending-request')
    if (second.kind !== 'pending-request') return
    expect(second.request).toMatchObject({
      kind: 'branch-choice',
      requestId: 'child.branch-window',
      phase: 'hit',
    })
    expect(second.childExecutions[0]).toMatchObject({
      canonicalId: 'Scratch',
      targetIds: ['bystander-token'],
    })
    const durableBranchWindow = materializeMoveSpecSuspension({
      resolutionId: 'resolution-parent',
      originOpId: 'op_nestedbranch0001',
      definition: parentDefinition,
      originMapSlug: 'nested-move-arena',
      originMapRevision: 8,
      actorPlacementId: 'actor-token',
      suspendedAt: 12_000,
      authoritativeSheetReads: second.sheetReads,
      execution: second,
      continuationMapRevision: 9,
      preWindowPlan: createMoveStateChangePlan([]),
    })
    expect(durableBranchWindow.pendingResolution.outstandingWindows[0]).toMatchObject({
      windowId: 'child.branch-window',
      operationId: 'child.choose-branch',
      kind: 'choice',
      phase: 'hit',
    })
    const reconnectedBranchResolution = parsePendingMoveResolution({
      ...JSON.parse(JSON.stringify(durableBranchWindow.pendingResolution)),
      chosenOptions: [{
        windowId: 'parent.child-target-window',
        responseOpId: 'op_nestedtargetanswer',
        optionId: targetOptionId,
        chosenBy: { kind: 'gm', id: null },
        chosenAt: 12_000,
      }],
    })
    const completedAfterReconnect = resumeMoveSpec({
      pendingResolution: reconnectedBranchResolution,
      map: {
        ...mapFixture(),
        revision: 9,
        encounterState: {
          ...createEmptyEncounterState(),
          pendingResolutionSummaries: [durableBranchWindow.publicSummary],
        },
      },
      pokemonSheets: pokemonSheets(),
      trainerSheets: new Map<string, TrainerSheet>(),
      response: {
        requestId: 'child.branch-window',
        optionId: 'boost',
      },
      now: 12_002,
      random: createFiniteAuthoritativeMoveRandomStream([]),
      runtimeRegistry: registry,
    })
    if ('kind' in completedAfterReconnect) {
      throw new Error('Expected the reconnected nested response to complete.')
    }
    expect(completedAfterReconnect.transaction.combatStageUpdates).toEqual([
      expect.objectContaining({ id: 'actor-token', stages: expect.objectContaining({ atk: 2 }) }),
    ])
    expect(completedAfterReconnect.auditTrace.events.filter(event => (
      event.kind === 'operation' && event.operationId === 'child.raise-attack'
    ))).toHaveLength(1)

    const terminal = executeMoveSpec({
      definition: parentDefinition,
      context: contextFor({
        registry,
        candidatePlacementIds: ['target-token', 'bystander-token'],
      }),
      authoritativeTargetIds: ['target-token'],
      resolutionId: 'resolution-parent',
      responses: [{
        requestId: 'parent.child-target-window',
        optionId: targetOptionId,
      }, {
        requestId: 'child.branch-window',
        optionId: 'boost',
      }],
    })
    expect(terminal.kind).toBe('complete')
    expect(terminal.targetIds).toEqual(['target-token', 'bystander-token'])
    expect(terminal.childExecutions[0]?.resolutionId).toBe(
      second.childExecutions[0]?.resolutionId,
    )
    expect(terminal.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: expect.objectContaining({ id: 'child.raise-attack' }),
        recipientIds: ['actor-token'],
      }),
    ]))
  })

  it('composes child effects and parent usage into one authoritative state plan', () => {
    const childDefinition = validateMoveSpec(childSpec([
      stage('child.raise-attack'),
      childFieldOperation,
      childUsageOperation,
    ]))
    const parentDefinition = validateMoveSpec(parentSpec([
      nestedOperation(),
      usageOperation,
    ]))
    const registry = registryFor(parentDefinition, childDefinition)
    const plan = planAuthoritativeMoveStateExecution({
      map: mapFixture(),
      pokemonSheets: pokemonSheets(),
      trainerSheets: new Map<string, TrainerSheet>(),
      intent: intent(),
      random: createFiniteAuthoritativeMoveRandomStream([]),
      now: () => 12_000,
      operationId: 'op_nestedmove0001',
      pendingResolutionId: 'resolution-parent',
      runtimeRegistry: registry,
    })

    expect(isAuthoritativePendingMoveStatePlan(plan)).toBe(false)
    if (isAuthoritativePendingMoveStatePlan(plan)) return
    expect(plan.resolution.auditTrace.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'child-move',
        canonicalId: 'Swords Dance',
        outcome: 'completed',
      }),
    ]))
    expect(plan.nextMap.encounterState?.zones).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'weather',
        source: expect.objectContaining({
          operationId: 'child.sun',
          placementId: 'target-token',
        }),
      }),
    ]))
    expect(plan.sheetWrites).toEqual([
      expect.objectContaining({
        slug: 'target',
        changedFields: ['combatStages'],
        nextSheet: expect.objectContaining({
          stats: expect.objectContaining({
            atk: expect.objectContaining({ stage: 2 }),
          }),
        }),
      }),
    ])
    expect(plan.stateChanges.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'sheet-state',
        sourceOperationId: 'child.raise-attack',
      }),
      expect.objectContaining({
        kind: 'map-move-usage',
        sourceOperationId: 'child.usage',
      }),
      expect.objectContaining({ kind: 'encounter-state' }),
    ]))
  })

  it('selects a reviewed child from an authoritative move list without exposing alternatives', () => {
    const childDefinition = validateMoveSpec(childSpec([
      stage('child.raise-attack'),
    ]))
    const pooledOperation = nestedOperation({
      recipients: { kind: 'none' },
      payload: {
        canonicalId: null,
        actor: { kind: 'parent-actor' },
        source: {
          kind: 'random-move-pool',
          pool: {
            poolId: 'pool.sleep-talk-canary',
            rollId: 'roll.sleep-talk-canary',
            source: { kind: 'authoritative-move-lists', owners: 'actor' },
            allowCanonicalIds: ['Scratch', 'Swords Dance'],
            denyCanonicalIds: [],
            maximumRerolls: 1,
          },
        },
        targeting: { kind: 'operation-recipients' },
      },
    })
    const parentDefinition = validateMoveSpec(parentSpec([pooledOperation]))
    const registry = registryFor(parentDefinition, childDefinition)
    const context = contextFor({
      registry,
      random: [0, 0.99],
      actorMovelist: ['Scratch', 'Swords Dance'],
    })

    const result = executeMoveSpec({
      definition: parentDefinition,
      context,
      authoritativeTargetIds: ['target-token'],
      resolutionId: 'resolution-parent',
    })

    expect(result.kind).toBe('complete')
    expect(result.rollLedger).toMatchObject([
      {
        rollId: 'roll.sleep-talk-canary',
        formula: { kind: 'table', tableId: 'pool.sleep-talk-canary' },
        finalValue: 1,
      },
      {
        rollId: 'roll.sleep-talk-canary.reroll-1',
        formula: { kind: 'table', tableId: 'pool.sleep-talk-canary' },
        finalValue: 2,
      },
    ])
    expect(result.childExecutions).toEqual([
      expect.objectContaining({ canonicalId: 'Swords Dance', actorPlacementId: 'actor-token' }),
    ])
    const poolEvent = result.trace.events.find(event => (
      event.kind === 'operation' && event.operationId === 'parent.invoke-child'
    ))
    expect(poolEvent).toMatchObject({
      result: {
        randomSelection: {
          candidateCount: 2,
          selectedId: 'Swords Dance',
          attemptCount: 2,
        },
      },
    })
    expect(result.sheetReads).toEqual(expect.arrayContaining([
      { kind: 'pokemon', slug: 'actor', revision: 3 },
    ]))
    const publicTrace = summarizeMoveResolutionTrace(result.trace)
    expect(JSON.stringify(publicTrace)).not.toContain('Scratch')
    expect(JSON.stringify(publicTrace)).toContain('Swords Dance')
  })

  it('filters encounter-disabled moves from authoritative random move-list pools', () => {
    const childDefinition = validateMoveSpec(childSpec([
      stage('child.raise-attack'),
    ]))
    const pooledOperation = nestedOperation({
      recipients: { kind: 'none' },
      payload: {
        canonicalId: null,
        actor: { kind: 'parent-actor' },
        source: {
          kind: 'random-move-pool',
          pool: {
            poolId: 'pool.overlay-filter',
            rollId: 'roll.overlay-filter',
            source: { kind: 'authoritative-move-lists', owners: 'actor' },
            allowCanonicalIds: ['Scratch', 'Swords Dance'],
            denyCanonicalIds: [],
            maximumRerolls: 0,
          },
        },
        targeting: { kind: 'operation-recipients' },
      },
    })
    const parentDefinition = validateMoveSpec(parentSpec([pooledOperation]))
    const context = contextFor({
      registry: registryFor(parentDefinition, childDefinition),
      random: [0],
      actorMovelist: ['Scratch', 'Swords Dance'],
      effects: [{
        ...moveListOverlayEncounterEffectFixture({
          action: 'disable',
          canonicalMoveIds: ['Scratch'],
        }),
        id: 'effect.move-list.disable-scratch',
        affected: { placementIds: ['actor-token'], sideIds: [], cells: [] },
      }],
    })

    const result = executeMoveSpec({
      definition: parentDefinition,
      context,
      authoritativeTargetIds: ['target-token'],
      resolutionId: 'resolution-parent',
    })

    expect(result.kind).toBe('complete')
    expect(result.childExecutions).toEqual([
      expect.objectContaining({ canonicalId: 'Swords Dance' }),
    ])
    expect(result.trace.events.find(event => (
      event.kind === 'operation' && event.operationId === 'parent.invoke-child'
    ))).toMatchObject({
      result: {
        randomSelection: {
          candidateCount: 1,
          selectedId: 'Swords Dance',
          attemptCount: 1,
        },
      },
    })
  })

  it('rejects Metronome-style self recursion and mutual copy loops before they can recurse', () => {
    const selfDefinition = validateMoveSpec(parentSpec([nestedOperation({
      id: 'parent.invoke-self',
      recipients: { kind: 'actor' },
      payload: {
        canonicalId: 'Tackle',
        actor: { kind: 'parent-actor' },
        source: { kind: 'registered-spec' },
        targeting: { kind: 'operation-recipients' },
      },
    })]))
    const selfRegistry = registryFromDefinitions(selfDefinition)
    const selfContext = contextFor({ registry: selfRegistry })
    const selfMapBefore = structuredClone(selfContext.map)
    const selfSheetsBefore = structuredClone(selfContext.resolvedSheets)

    expect(() => executeMoveSpec({
      definition: selfDefinition,
      context: selfContext,
      authoritativeTargetIds: ['target-token'],
      resolutionId: 'resolution-parent',
    })).toThrowError(expect.objectContaining<Partial<MoveSpecExecutionError>>({
      code: 'nested-spec-already-visited',
    }))
    expect(selfContext.random.snapshot()).toEqual([])
    expect(selfContext.map).toEqual(selfMapBefore)
    expect(selfContext.resolvedSheets).toEqual(selfSheetsBefore)

    const childDefinition = validateMoveSpec(childSpec([nestedOperation({
      id: 'child.copy-parent',
      recipients: { kind: 'actor' },
      payload: {
        canonicalId: 'Tackle',
        actor: { kind: 'parent-actor' },
        source: { kind: 'registered-spec' },
        targeting: { kind: 'operation-recipients' },
      },
    })]))
    const parentDefinition = validateMoveSpec(parentSpec([nestedOperation()]))
    const copyRegistry = registryFor(parentDefinition, childDefinition)
    const copyContext = contextFor({ registry: copyRegistry })
    const copyMapBefore = structuredClone(copyContext.map)
    const copySheetsBefore = structuredClone(copyContext.resolvedSheets)

    expect(() => executeMoveSpec({
      definition: parentDefinition,
      context: copyContext,
      authoritativeTargetIds: ['target-token'],
      resolutionId: 'resolution-parent',
    })).toThrowError(expect.objectContaining<Partial<MoveSpecExecutionError>>({
      code: 'nested-spec-already-visited',
    }))
    expect(copyContext.random.snapshot()).toEqual([])
    expect(copyContext.map).toEqual(copyMapBefore)
    expect(copyContext.resolvedSheets).toEqual(copySheetsBefore)
  })

  it('stops a unique child chain at the aggregate nesting-depth boundary', () => {
    const canonicalIds = [
      'Tackle',
      'Swords Dance',
      'Scratch',
      'Ember',
      'Dragon Rage',
      'Synthesis',
      'Absorb',
      'Power Trip',
      'Double Kick',
      'Fury Attack',
    ] as const
    expect(canonicalIds).toHaveLength(NESTED_MOVE_EXECUTION_LIMITS.depth + 2)
    const definitions = canonicalIds.map((canonicalId, index) => {
      const nextCanonicalId = canonicalIds[index + 1]
      const operations = nextCanonicalId
        ? [nestedOperation({
            id: `chain.invoke-${index}`,
            source: { kind: 'move', id: `move.chain-${index}` },
            recipients: { kind: 'actor' },
            payload: {
              canonicalId: nextCanonicalId,
              actor: { kind: 'parent-actor' },
              source: { kind: 'registered-spec' },
              targeting: { kind: 'operation-recipients' },
            },
          })]
        : []
      return validateMoveSpec({
        ...childSpec(operations),
        canonicalId,
        presentation: {
          displayName: canonicalId,
          vfxKey: null,
          tags: ['test-only'],
        },
      })
    })
    const registry = registryFromDefinitions(...definitions)
    const context = contextFor({ registry })

    expect(() => executeMoveSpec({
      definition: definitions[0]!,
      context,
      resolutionId: 'resolution-parent',
    })).toThrowError(expect.objectContaining<Partial<MoveSpecExecutionError>>({
      code: 'nested-depth-limit-exceeded',
    }))
    expect(context.random.snapshot()).toEqual([])
  })

  it('enforces server-reviewed child bans before child execution', () => {
    const childDefinition = validateMoveSpec(childSpec([roll('child.roll', 'accuracy')]))
    const parentDefinition = validateMoveSpec(parentSpec([nestedOperation()]))
    const registry = registryFor(parentDefinition, childDefinition)
    const context = contextFor({ registry, random: [0.5] })

    expect(() => executeMoveSpec({
      definition: parentDefinition,
      context,
      authoritativeTargetIds: ['target-token'],
      resolutionId: 'resolution-parent',
      nestedExecutionPolicy: { bannedCanonicalIds: ['Swords Dance'] },
    })).toThrowError(expect.objectContaining<Partial<MoveSpecExecutionError>>({
      code: 'nested-spec-banned',
    }))
    expect(context.random.snapshot()).toEqual([])
  })

  it('rejects an oversized child program before planning or drawing randomness', () => {
    const childDefinition = validateMoveSpec(childSpec([
      roll('child.first-roll', 'accuracy'),
      ...Array.from({ length: 127 }, (_, index) => (
        logOperation(`child.log-${index.toString().padStart(3, '0')}`)
      )),
    ]))
    const parentDefinition = validateMoveSpec(parentSpec([nestedOperation()]))
    const registry = registryFor(parentDefinition, childDefinition)
    const map = mapFixture()
    const sheets = pokemonSheets()
    const mapBefore = structuredClone(map)
    const sheetsBefore = structuredClone([...sheets.entries()])
    const random = createFiniteAuthoritativeMoveRandomStream([0.5])

    expect(() => planAuthoritativeMoveStateExecution({
      map,
      pokemonSheets: sheets,
      trainerSheets: new Map<string, TrainerSheet>(),
      intent: intent(),
      random,
      now: () => 12_000,
      operationId: 'op_nestedlimit0001',
      pendingResolutionId: 'resolution-parent',
      runtimeRegistry: registry,
    })).toThrowError(expect.objectContaining<Partial<MoveSpecExecutionError>>({
      code: 'nested-operation-limit-exceeded',
    }))
    expect(random.consumed).toBe(0)
    expect(random.remaining).toBe(1)
    expect(map).toEqual(mapBefore)
    expect([...sheets.entries()]).toEqual(sheetsBefore)
  })

  it('bounds aggregate server-derived fresh-target candidates', () => {
    const crowdSize = NESTED_MOVE_EXECUTION_LIMITS.targets + 1
    const crowdPlacements = Array.from({ length: crowdSize }, (_, index) => (
      // Overlap is intentional: this interpreter-level budget fixture keeps
      // every authoritative candidate inside the reviewed Melee range.
      placement(`crowd-token-${index}`, `crowd-${index}`, 1)
    ))
    const map: TabletopMap = {
      ...mapFixture(),
      dimensions: { x: crowdSize + 2, y: 3, z: 8 },
      placements: [placement('actor-token', 'actor', 0), ...crowdPlacements],
    }
    const sheets = new Map<string, CharacterSheet>([
      ['actor', sheet('actor', ['Tackle'])],
      ...crowdPlacements.map((entry, index): [string, CharacterSheet] => [
        entry.sheetSlug,
        sheet(`crowd-${index}`),
      ]),
    ])
    const childDefinition = validateMoveSpec({
      ...childSpec([]),
      canonicalId: 'Scratch',
      targeting: {
        kind: 'single-target',
        minTargets: 1,
        maxTargets: 1,
        selector: { kind: 'selected-targets' },
      },
      presentation: {
        displayName: 'Scratch',
        vfxKey: null,
        tags: ['test-only'],
      },
    })
    const parentDefinition = validateMoveSpec(parentSpec([nestedOperation({
      recipients: { kind: 'none' },
      payload: {
        canonicalId: 'Scratch',
        actor: { kind: 'parent-actor' },
        source: { kind: 'registered-spec' },
        targeting: {
          kind: 'fresh-choice',
          requestId: 'parent.oversized-target-window',
          promptKey: 'move.parent.choose-target',
          selector: { kind: 'candidate-targets' },
        },
      },
    })]))
    const registry = registryFor(parentDefinition, childDefinition)
    const candidateIds = crowdPlacements.map(entry => entry.id)
    const context = buildAuthoritativeMoveRulesContext({
      map,
      pokemonSheets: sheets,
      trainerSheets: new Map<string, TrainerSheet>(),
      intent: {
        schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
        placementId: 'actor-token',
        moveName: 'Tackle',
        selection: {
          kind: 'single-target',
          targetPlacementId: crowdPlacements[0]!.id,
        },
      },
      candidatePlacementIds: candidateIds,
      selectedPlacementIds: [crowdPlacements[0]!.id],
      random: createFiniteAuthoritativeMoveRandomStream([]),
      time: 12_000,
      resolutionId: 'resolution-parent',
      runtimeRegistry: registry,
    })

    expect(() => executeMoveSpec({
      definition: parentDefinition,
      context,
      authoritativeTargetIds: [crowdPlacements[0]!.id],
      resolutionId: 'resolution-parent',
    })).toThrowError(expect.objectContaining<Partial<MoveSpecExecutionError>>({
      code: 'nested-target-limit-exceeded',
    }))
    expect(context.random.snapshot()).toEqual([])
  })

  it('fails closed when the reviewed child runtime or stable parent identity is absent', () => {
    const childDefinition = validateMoveSpec(childSpec([]))
    const parentDefinition = validateMoveSpec(parentSpec([nestedOperation()]))
    const registry = registryFor(parentDefinition, childDefinition)

    expect(() => executeMoveSpec({
      definition: parentDefinition,
      context: buildAuthoritativeMoveRulesContext({
        map: mapFixture(),
        pokemonSheets: pokemonSheets(),
        trainerSheets: new Map<string, TrainerSheet>(),
        intent: intent(),
        selectedPlacementIds: ['target-token'],
        random: createFiniteAuthoritativeMoveRandomStream([]),
        time: 12_000,
        runtimeRegistry: registry,
      }),
      authoritativeTargetIds: ['target-token'],
    })).toThrowError(expect.objectContaining<Partial<MoveSpecExecutionError>>({
      code: 'nested-resolution-id-missing',
    }))

    const parentOnlyRegistry: MoveAutomationRuntimeRegistry = Object.freeze({
      size: 1,
      handlerRegistry: REGISTERED_MOVE_HANDLER_REGISTRY,
      resolve: (canonicalId: string) => canonicalId === 'Tackle'
        ? runtime(parentDefinition, 'tests/fixtures/parent.ts')
        : null,
      entries: () => Object.freeze([runtime(parentDefinition, 'tests/fixtures/parent.ts')]),
    })
    expect(() => executeMoveSpec({
      definition: parentDefinition,
      context: contextFor({ registry: parentOnlyRegistry }),
      authoritativeTargetIds: ['target-token'],
      resolutionId: 'resolution-parent',
    })).toThrowError(expect.objectContaining<Partial<MoveSpecExecutionError>>({
      code: 'nested-runtime-unavailable',
    }))
  })
})
