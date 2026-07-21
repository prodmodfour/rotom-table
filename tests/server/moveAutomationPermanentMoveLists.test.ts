import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_EVENT_SCHEMA_VERSION,
  parseEncounterEvents,
  type EncounterMoveIdentity,
} from '#shared/moveAutomation/events'
import {
  createEmptyEncounterState,
  parseEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import {
  parseMoveEffectOperation,
  type MovePermanentMoveListEffectOperation,
} from '#shared/moveAutomation/effects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  buildAuthoritativeMoveRulesContext,
  type AuthoritativeMoveRulesContext,
} from '~~/server/domain/moveAutomation/context'
import {
  createMoveStateChangePlan,
  type MoveStateChangeInput,
} from '~~/server/domain/moveAutomation/plan'
import {
  mergeDisjointMoveSheetStateChanges,
} from '~~/server/domain/moveAutomation/mergeSheetStateChanges'
import {
  MovePermanentMoveListReductionError,
  reducePermanentMoveListOperations,
  type MoveResolvedPermanentMoveListOperation,
} from '~~/server/domain/moveAutomation/reducers/permanentMoveLists'
import {
  reduceEncounterLifecycle,
} from '~~/server/domain/moveAutomation/reduceLifecycle'
import {
  createSketchMoveListReplacementOperation,
  SketchMoveListReplacementError,
} from '~~/server/domain/moveAutomation/sketchMoveListReplacement'
import {
  REGISTERED_MOVE_HANDLER_REGISTRY,
} from '~~/server/domain/moveAutomation/handlers/registry'
import type {
  MoveAutomationRuntimeRegistry,
  MoveSpecV2Runtime,
} from '~~/server/domain/moveAutomation/registry'
import {
  validateMoveSpec,
} from '~~/server/domain/moveAutomation/validateSpec'
import {
  planAuthoritativeMoveState,
} from '~~/server/domain/planAuthoritativeMoveState'
import {
  createMoveResolutionTrace,
  reduceMoveResolutionTrace,
} from '~~/server/domain/moveAutomation/trace'
import { deepCloneJson } from '~/utils/serialization'

const actorId = 'sketch-actor'
const targetId = 'sketch-target'
const mapRevision = 7
const plannedAt = 1_700_000_000_000

const placement = (
  id: string,
  sheetSlug: string,
  x: number,
  sheetKind: 'pokemon' | 'trainer' = 'pokemon',
): SheetPlacement => ({
  id,
  sheetKind,
  sheetSlug,
  position: { x, y: 0, z: 0 },
})

const moveIdentity = (
  resolutionId: string,
  canonicalId: string,
  actorPlacementId: string,
): EncounterMoveIdentity => ({
  resolutionId,
  canonicalId,
  specVersion: 2,
  actorPlacementId,
  actionType: 'standard',
  origin: { kind: 'direct' },
  moveListSource: { kind: 'placement', placementId: actorPlacementId },
})

const historyState = (
  canonicalId = 'Tackle',
  resolutionId = 'resolution.target-tackle',
) => {
  const move = moveIdentity(resolutionId, canonicalId, targetId)
  const events = parseEncounterEvents([{
    schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
    eventId: 'event.scene-start',
    kind: 'scene-start',
    sourceOperationId: 'op.scene-start',
    causalParentEventId: null,
    reasonCode: 'scene-started',
    sceneId: 'scene.sketch-test',
  }, {
    schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
    eventId: `event.${resolutionId}.declared`,
    kind: 'move-declared',
    sourceOperationId: 'op.target-move',
    causalParentEventId: null,
    reasonCode: 'target-move-declared',
    move,
    targetPlacementIds: [actorId],
  }, {
    schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
    eventId: `event.${resolutionId}.completed`,
    kind: 'move-completed',
    sourceOperationId: 'op.target-move',
    causalParentEventId: `event.${resolutionId}.declared`,
    reasonCode: 'target-move-completed',
    move,
    attackedTargetIds: [actorId],
    hitTargetIds: [actorId],
    outcome: 'hit',
    succeeded: true,
    branches: [],
  }])
  return reduceEncounterLifecycle(createEmptyEncounterState(), events).state
}

const pokemonSheet = (
  slug: string,
  moves: readonly string[],
  revision = 3,
): CharacterSheet => ({
  slug,
  nickname: slug,
  species: slug === 'target' ? 'Smeargle' : 'Pikachu',
  level: 20,
  revision,
  combat: { currentHp: 40 },
  movelist: moves.map(name => ({ name })),
})

const mapFixture = (encounterState = historyState()): TabletopMap => ({
  schemaVersion: 2,
  slug: 'permanent-move-list-arena',
  name: 'Permanent Move List Arena',
  revision: mapRevision,
  dimensions: { x: 8, y: 2, z: 8 },
  voxels: [],
  placements: [
    placement(actorId, 'actor', 0),
    placement(targetId, 'target', 1),
  ],
  lights: [],
  encounterState,
})

const contextFixture = (options: {
  readonly actorMoves?: readonly string[]
  readonly encounterState?: ReturnType<typeof historyState>
  readonly resolutionId?: string | null
  readonly actorAbility?: string
} = {}): AuthoritativeMoveRulesContext => {
  const context = buildAuthoritativeMoveRulesContext({
    map: mapFixture(options.encounterState),
    pokemonSheets: new Map<string, CharacterSheet>([
      ['actor', {
        ...pokemonSheet('actor', options.actorMoves ?? ['Sketch', 'Growl']),
        ...(options.actorAbility ? { abilities: [{ name: options.actorAbility }] } : {}),
      }],
      ['target', pokemonSheet('target', ['Tackle'])],
    ]),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: 1,
      placementId: actorId,
      moveName: 'Sketch',
      selection: { kind: 'single-target', targetPlacementId: targetId },
    },
    selectedPlacementIds: [targetId],
    random: () => { throw new Error('Permanent move-list tests do not use randomness.') },
    time: plannedAt,
    ...(options.resolutionId === null
      ? {}
      : { resolutionId: options.resolutionId ?? 'resolution.current-sketch' }),
  })
  return options.resolutionId === null
    ? Object.freeze({ ...context, resolutionId: null })
    : context
}

const moveListOperation = (
  id: string,
  payload: Record<string, unknown>,
): MovePermanentMoveListEffectOperation => parseMoveEffectOperation({
  id,
  kind: 'permanent-move-list',
  source: { kind: 'move', id: 'move.sketch' },
  recipients: { kind: 'actor' },
  phase: 'hit',
  reasonCode: `sketch.${id}`,
  payload,
}) as MovePermanentMoveListEffectOperation

const traceFor = (
  operations: readonly MovePermanentMoveListEffectOperation[],
) => {
  let trace = createMoveResolutionTrace({
    program: {
      canonicalId: 'Sketch',
      runtimeKind: 'movespec-v2',
      runtimeVersion: 1,
      definitionHash: 'a'.repeat(64),
    },
    ruleset: {
      rulesetId: 'ruleset.test',
      sourceDataSha256: 'b'.repeat(64),
    },
    ancestry: [],
  })
  trace = reduceMoveResolutionTrace(trace, {
    kind: 'phase-transition',
    from: null,
    to: 'hit',
    reasonCode: 'hit-phase',
  })
  for (const operation of operations) {
    trace = reduceMoveResolutionTrace(trace, {
      kind: 'operation',
      phase: operation.phase,
      operationId: operation.id,
      operationKind: operation.kind,
      recipientIds: [actorId],
      outcome: 'applied',
      reasonCode: operation.reasonCode,
      input: operation.payload as never,
      result: { status: 'emitted' },
    })
  }
  return trace
}

const emission = (
  operation: MovePermanentMoveListEffectOperation,
): MoveResolvedPermanentMoveListOperation => ({
  operation,
  recipientIds: [actorId],
})

const reduce = (
  context: AuthoritativeMoveRulesContext,
  operations: readonly MovePermanentMoveListEffectOperation[],
) => reducePermanentMoveListOperations({
  context,
  operations: operations.map(emission),
  dynamicRecipients: {
    attackedTargetIds: [targetId],
    hitTargetIds: [targetId],
    missedTargetIds: [],
    damagedTargetIds: [],
    faintedTargetIds: [],
  },
  trace: traceFor(operations),
})

const expectReductionError = (
  action: () => unknown,
  code: MovePermanentMoveListReductionError['code'],
): void => {
  try {
    action()
    expect.unreachable(`Expected permanent move-list error ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(MovePermanentMoveListReductionError)
    expect(error).toMatchObject({ code })
  }
}

describe('permanent move-list mutations', () => {
  it('replaces Sketch in place from the selected target latest authoritative move history', () => {
    const context = contextFixture()
    const operation = createSketchMoveListReplacementOperation(context)
    const before = JSON.stringify({ map: context.map, sheet: context.actor.sheet.sheet })

    const result = reduce(context, [operation])
    const change = result.stateChanges.changes[0]

    expect(JSON.stringify({ map: context.map, sheet: context.actor.sheet.sheet })).toBe(before)
    expect(operation.payload).toEqual({
      action: 'replace',
      replacedMoveId: 'Sketch',
      moveId: 'Tackle',
      acquisition: {
        kind: 'encounter-history',
        sourcePlacementId: targetId,
        sourceResolutionId: 'resolution.target-tackle',
      },
    })
    expect(change).toMatchObject({
      kind: 'sheet-state',
      expectedRevision: 3,
      sourceOperationId: 'sketch.replace-self',
      changedFields: ['movelist'],
      scope: { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'actor' },
      compensation: {
        kind: 'unavailable',
        safety: 'externally-observed',
        reasonCode: 'permanent-move-list-correction-not-reviewed',
      },
      current: {
        revision: 4,
        updatedAt: plannedAt,
        movelist: [{
          name: 'Tackle',
          type: 'Normal',
          permanentMoveSource: {
            schemaVersion: 1,
            mutation: 'replace',
            sourceMoveId: 'Sketch',
            sourcePlacementId: actorId,
            sourceResolutionId: 'resolution.current-sketch',
            sourceOperationId: 'sketch.replace-self',
            acquiredFrom: {
              kind: 'encounter-history',
              sourcePlacementId: targetId,
              sourceResolutionId: 'resolution.target-tackle',
            },
            recordedAt: plannedAt,
          },
        }, { name: 'Growl' }],
      },
    })
    expect(result.operationResults).toEqual([expect.objectContaining({
      action: 'replace',
      outcome: 'applied',
      recipients: [expect.objectContaining({
        slotIndex: 0,
        previousMoveId: 'Sketch',
        currentMoveId: 'Tackle',
      })],
    })])
    expect(result.sheetReads).toEqual([
      { kind: 'pokemon', slug: 'actor', revision: 3 },
    ])
    expect(result.trace.events).toContainEqual(expect.objectContaining({
      kind: 'operation',
      operationId: 'sketch.replace-self',
      outcome: 'applied',
      result: expect.objectContaining({ status: 'applied', action: 'replace' }),
    }))
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(change?.current)).toBe(true)
  })

  it('supports reviewed add and remove operations as one ordered sheet CAS write', () => {
    const context = contextFixture({ actorMoves: ['Sketch', 'Growl'] })
    const remove = moveListOperation('sketch.remove-growl', {
      action: 'remove',
      moveId: 'Growl',
    })
    const add = moveListOperation('sketch.add-ember', {
      action: 'add',
      moveId: 'Ember',
      acquisition: { kind: 'reviewed-rule' },
    })

    const result = reduce(context, [remove, add])
    const change = result.stateChanges.changes[0]
    expect(change).toMatchObject({
      kind: 'sheet-state',
      expectedRevision: 3,
      sourceOperationId: null,
      reasonCode: 'permanent-move-list-mutations',
      changedFields: ['movelist'],
      current: {
        revision: 4,
        movelist: [
          { name: 'Sketch' },
          {
            name: 'Ember',
            permanentMoveSource: {
              mutation: 'add',
              sourceOperationId: 'sketch.add-ember',
              acquiredFrom: { kind: 'reviewed-rule' },
            },
          },
        ],
      },
    })
    expect(result.operationResults.map(operation => operation.action)).toEqual([
      'remove',
      'add',
    ])
    expect(result.stateChanges.groups.sheets).toHaveLength(1)
  })

  it('keeps Trainer move lists rule-unlimited while enforcing the bounded storage ceiling', () => {
    const map = mapFixture()
    map.placements = [
      placement(actorId, 'actor-trainer', 0, 'trainer'),
      placement(targetId, 'target', 1),
    ]
    const trainer: TrainerSheet = {
      slug: 'actor-trainer',
      name: 'Artist',
      level: 20,
      revision: 5,
      movelist: ['Sketch', 'Growl', 'Ember', 'Tackle', 'Scratch', 'Pound']
        .map(name => ({ name })),
    }
    const context = buildAuthoritativeMoveRulesContext({
      map,
      pokemonSheets: new Map([['target', pokemonSheet('target', ['Tackle'])]]),
      trainerSheets: new Map([['actor-trainer', trainer]]),
      intent: {
        schemaVersion: 1,
        placementId: actorId,
        moveName: 'Sketch',
        selection: { kind: 'single-target', targetPlacementId: targetId },
      },
      selectedPlacementIds: [targetId],
      random: () => { throw new Error('Permanent move-list tests do not use randomness.') },
      time: plannedAt,
      resolutionId: 'resolution.trainer-learns',
    })
    const add = moveListOperation('sketch.trainer-add-bite', {
      action: 'add',
      moveId: 'Bite',
      acquisition: { kind: 'reviewed-rule' },
    })

    const result = reduce(context, [add])
    expect(result.stateChanges.changes[0]).toMatchObject({
      kind: 'sheet-state',
      expectedRevision: 5,
      scope: { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'actor-trainer' },
      current: {
        revision: 6,
        movelist: [
          { name: 'Sketch' },
          { name: 'Growl' },
          { name: 'Ember' },
          { name: 'Tackle' },
          { name: 'Scratch' },
          { name: 'Pound' },
          { name: 'Bite', permanentMoveSource: { mutation: 'add' } },
        ],
      },
    })
  })

  it('allows exactly two additional permanent slots from manifest-selected Cluster Mind', () => {
    const context = contextFixture({
      actorMoves: ['Sketch', 'Growl', 'Ember', 'Tackle', 'Scratch', 'Pound'],
      actorAbility: 'Cluster Mind',
    })
    const additions = [
      moveListOperation('sketch.add-bite-cluster', {
        action: 'add', moveId: 'Bite', acquisition: { kind: 'reviewed-rule' },
      }),
      moveListOperation('sketch.add-quick-attack-cluster', {
        action: 'add', moveId: 'Quick Attack', acquisition: { kind: 'reviewed-rule' },
      }),
    ]
    const result = reduce(context, additions)
    const current = result.stateChanges.changes[0]?.current as CharacterSheet
    expect(current.movelist).toHaveLength(8)
    const full = contextFixture({
      actorMoves: ['Sketch', 'Growl', 'Ember', 'Tackle', 'Scratch', 'Pound', 'Bite', 'Quick Attack'],
      actorAbility: 'Cluster Mind',
    })
    expectReductionError(() => reduce(full, [moveListOperation('sketch.add-water-gun-cluster', {
      action: 'add', moveId: 'Water Gun', acquisition: { kind: 'reviewed-rule' },
    })]), 'move-list-full')
  })

  it('rejects full slots, duplicates, missing replacements, and stale history without mutation', () => {
    const fullContext = contextFixture({
      actorMoves: ['Sketch', 'Growl', 'Ember', 'Tackle', 'Scratch', 'Pound'],
    })
    const add = moveListOperation('sketch.add-bite', {
      action: 'add',
      moveId: 'Bite',
      acquisition: { kind: 'reviewed-rule' },
    })
    expectReductionError(() => reduce(fullContext, [add]), 'move-list-full')

    const duplicate = moveListOperation('sketch.add-growl', {
      action: 'add',
      moveId: 'Growl',
      acquisition: { kind: 'reviewed-rule' },
    })
    expectReductionError(
      () => reduce(contextFixture(), [duplicate]),
      'duplicate-known-move',
    )

    const missing = moveListOperation('sketch.remove-bite', {
      action: 'remove',
      moveId: 'Bite',
    })
    expectReductionError(
      () => reduce(contextFixture(), [missing]),
      'move-not-known',
    )

    const staleHistory = historyState('Ember', 'resolution.target-ember')
    const forged = moveListOperation('sketch.forged-history', {
      action: 'replace',
      replacedMoveId: 'Sketch',
      moveId: 'Tackle',
      acquisition: {
        kind: 'encounter-history',
        sourcePlacementId: targetId,
        sourceResolutionId: 'resolution.target-tackle',
      },
    })
    expectReductionError(
      () => reduce(contextFixture({ encounterState: staleHistory }), [forged]),
      'history-source-missing',
    )
  })

  it('requires a target history choice and a server-owned current resolution for Sketch', () => {
    const noHistory = contextFixture({ encounterState: createEmptyEncounterState() })
    expect(() => createSketchMoveListReplacementOperation(noHistory))
      .toThrowError(expect.objectContaining<Partial<SketchMoveListReplacementError>>({
        code: 'target-history-missing',
      }))

    const context = contextFixture({ resolutionId: null })
    const operation = createSketchMoveListReplacementOperation(context)
    expectReductionError(
      () => reduce(context, [operation]),
      'current-resolution-missing',
    )
  })

  it('integrates a permanent replacement with native Daily usage in one authoritative sheet write', () => {
    const spec = {
      schemaVersion: 2,
      canonicalId: 'Synthesis',
      version: 99,
      targeting: {
        kind: 'self',
        minTargets: 1,
        maxTargets: 1,
        selector: { kind: 'actor' },
      },
      preconditions: [],
      costs: [],
      phases: [{
        phase: 'hit',
        operations: [{
          id: 'synthesis.replace-self-test',
          kind: 'permanent-move-list',
          source: { kind: 'move', id: 'move.synthesis' },
          recipients: { kind: 'actor' },
          phase: 'hit',
          reasonCode: 'synthesis.permanent-replacement-test',
          payload: {
            action: 'replace',
            replacedMoveId: 'Synthesis',
            moveId: 'Tackle',
            acquisition: { kind: 'reviewed-rule' },
          },
        }],
      }, {
        phase: 'usage',
        operations: [{
          id: 'synthesis.usage-test',
          kind: 'usage',
          source: { kind: 'move', id: 'move.synthesis' },
          recipients: { kind: 'actor' },
          phase: 'usage',
          reasonCode: 'synthesis.frequency-use-test',
          payload: {
            action: 'spend',
            resourceId: 'synthesis.frequency-use-test',
            amount: 1,
          },
        }],
      }, {
        phase: 'cleanup',
        operations: [{
          id: 'synthesis.log-test',
          kind: 'log',
          source: { kind: 'move', id: 'move.synthesis' },
          recipients: { kind: 'none' },
          phase: 'cleanup',
          reasonCode: 'synthesis.completed-test',
          payload: { messageKey: 'move.synthesis.completed', arguments: [] },
        }],
      }],
      registeredHandlerId: null,
      presentation: {
        displayName: 'Synthesis',
        vfxKey: null,
        tags: ['test-only'],
      },
    }
    const definition = validateMoveSpec(spec)
    const runtime: MoveSpecV2Runtime = {
      canonicalId: 'Synthesis',
      kind: 'movespec-v2',
      version: definition.spec.version,
      definitionHash: definition.definitionHash,
      sourceModule: 'tests/server/moveAutomationPermanentMoveLists.test.ts',
      definition,
    }
    const runtimeRegistry: MoveAutomationRuntimeRegistry = {
      size: 1,
      handlerRegistry: REGISTERED_MOVE_HANDLER_REGISTRY,
      resolve: canonicalId => canonicalId === runtime.canonicalId ? runtime : null,
      entries: () => [runtime],
    }
    const map = mapFixture()
    map.activeScene = { name: 'Scene A', startedAt: 100 }
    map.initiative = { activeId: actorId, round: 1 }
    const actor = pokemonSheet('actor', ['Synthesis'])
    const target = pokemonSheet('target', ['Tackle'])

    const plan = planAuthoritativeMoveState({
      map,
      pokemonSheets: new Map([['actor', actor], ['target', target]]),
      trainerSheets: new Map(),
      intent: {
        schemaVersion: 1,
        placementId: actorId,
        moveName: 'Synthesis',
        selection: { kind: 'self' },
      },
      random: () => { throw new Error('Test Synthesis spec does not draw randomness.') },
      now: () => plannedAt,
      operationId: 'op_synthesis_permanent_1',
      pendingResolutionId: 'resolution.synthesis-permanent-1',
      runtimeRegistry,
    })

    expect(plan.sheetWrites).toHaveLength(1)
    expect(plan.sheetWrites[0]).toMatchObject({
      kind: 'pokemon',
      slug: 'actor',
      expectedRevision: 3,
      revision: 4,
      changedFields: ['moveUsage', 'movelist'],
      nextSheet: {
        revision: 4,
        movelist: [{
          name: 'Tackle',
          permanentMoveSource: {
            mutation: 'replace',
            sourceMoveId: 'Synthesis',
            sourceResolutionId: 'resolution.synthesis-permanent-1',
            sourceOperationId: 'synthesis.replace-self-test',
          },
        }],
        moveUsage: {
          daily: { synthesis: { moveName: 'Synthesis', uses: 1 } },
        },
      },
    })
    expect(plan.stateChanges.groups.sheets).toHaveLength(1)
    expect(plan.stateChanges.groups.sheets[0]?.changes[0]).toMatchObject({
      changedFields: ['moveUsage', 'movelist'],
      compensation: {
        kind: 'unavailable',
        reasonCode: 'permanent-move-list-correction-not-reviewed',
      },
    })
    expect(plan.resolution.auditTrace.events).toContainEqual(expect.objectContaining({
      kind: 'operation',
      operationId: 'synthesis.replace-self-test',
      outcome: 'applied',
    }))
    expect(plan.sheetReads).toContainEqual({ kind: 'pokemon', slug: 'actor', revision: 3 })
  })

  it('composes permanent mutation, Daily usage, and encounter history into one atomic revision plan', () => {
    const context = contextFixture()
    const operation = createSketchMoveListReplacementOperation(context)
    const permanent = reduce(context, [operation])
    const permanentChange = permanent.stateChanges.changes[0]!
    if (permanentChange.kind !== 'sheet-state') {
      throw new Error('Expected a permanent sheet-state change.')
    }
    const { id: _id, order: _order, ...permanentInput } = permanentChange
    const previousSheet = deepCloneJson(permanentChange.previous)
    const usageCurrent = {
      ...deepCloneJson(previousSheet),
      revision: 4,
      updatedAt: plannedAt,
      moveUsage: {
        daily: {
          sketch: { moveName: 'Sketch', uses: 1, updatedAt: plannedAt },
        },
      },
    }
    const usageChange: MoveStateChangeInput = {
      kind: 'sheet-state',
      scope: { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'actor' },
      expectedRevision: 3,
      sourceOperationId: 'sketch.usage',
      reasonCode: 'sketch.frequency-use',
      previous: previousSheet,
      current: usageCurrent,
      changedFields: ['moveUsage'],
      compensation: { kind: 'inverse', strategy: 'restore-previous-value' },
    }
    const mergedSheets = mergeDisjointMoveSheetStateChanges([
      permanentInput as MoveStateChangeInput,
      usageChange,
    ])

    const previousEncounter = parseEncounterState(context.map.encounterState!)
    const currentMove = moveIdentity(
      'resolution.current-sketch',
      'Sketch',
      actorId,
    )
    const historyEvents = parseEncounterEvents([{
      schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
      eventId: 'event.current-sketch.declared',
      kind: 'move-declared',
      sourceOperationId: 'op.current-sketch',
      causalParentEventId: null,
      reasonCode: 'sketch-declared',
      move: currentMove,
      targetPlacementIds: [targetId],
    }, {
      schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
      eventId: 'event.current-sketch.completed',
      kind: 'move-completed',
      sourceOperationId: 'op.current-sketch',
      causalParentEventId: 'event.current-sketch.declared',
      reasonCode: 'sketch-completed',
      move: currentMove,
      attackedTargetIds: [targetId],
      hitTargetIds: [targetId],
      outcome: 'hit',
      succeeded: true,
      branches: [],
    }])
    const currentEncounter = reduceEncounterLifecycle(previousEncounter, historyEvents).state
    const plan = createMoveStateChangePlan<EncounterState>([
      ...mergedSheets.map(change => change as MoveStateChangeInput<EncounterState>),
      {
        kind: 'encounter-state',
        scope: { kind: 'encounter', mapSlug: context.map.slug },
        expectedRevision: mapRevision,
        sourceOperationId: 'op.current-sketch',
        reasonCode: 'sketch-history-updated',
        previous: previousEncounter,
        current: currentEncounter,
        compensation: { kind: 'inverse', strategy: 'restore-previous-value' },
      },
    ])

    expect(plan.groups.sheets).toHaveLength(1)
    expect(plan.groups.encounter).toHaveLength(1)
    expect(plan.expectedRevisions).toEqual([
      { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'actor', expectedRevision: 3 },
      { kind: 'map', mapSlug: context.map.slug, expectedRevision: mapRevision },
    ])
    expect(plan.groups.sheets[0]?.changes[0]).toMatchObject({
      changedFields: ['moveUsage', 'movelist'],
      compensation: {
        kind: 'unavailable',
        reasonCode: 'permanent-move-list-correction-not-reviewed',
      },
      current: {
        revision: 4,
        moveUsage: { daily: { sketch: { uses: 1 } } },
        movelist: [{ name: 'Tackle' }, { name: 'Growl' }],
      },
    })
    expect(plan.groups.encounter[0]?.changes[0]?.current.history.moveUses)
      .toContainEqual(expect.objectContaining({
        resolutionId: 'resolution.current-sketch',
        canonicalId: 'Sketch',
        completion: expect.objectContaining({ succeeded: true }),
      }))
  })
})
