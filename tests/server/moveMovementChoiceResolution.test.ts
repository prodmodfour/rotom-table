import { describe, expect, it } from 'vitest'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveStateExecution,
} from '~~/server/domain/planAuthoritativeMoveState'
import { isAuthoritativePendingMoveResolution } from '~~/server/domain/resolveAuthoritativeMove'
import { planResumedMoveState } from '~~/server/domain/moveAutomation/planResumedMoveState'
import { ResumeMoveSpecError, resumeMoveSpec } from '~~/server/domain/moveAutomation/resumeSpec'
import {
  REGISTERED_MOVE_HANDLER_REGISTRY,
} from '~~/server/domain/moveAutomation/handlers/registry'
import type {
  MoveAutomationRuntimeRegistry,
  MoveSpecV2Runtime,
} from '~~/server/domain/moveAutomation/registry'
import { validateMoveSpec } from '~~/server/domain/moveAutomation/validateSpec'

const actorPlacement = (): SheetPlacement => ({
  id: 'actor-token',
  sheetKind: 'pokemon',
  sheetSlug: 'actor',
  position: { x: 1, y: 0, z: 1 },
})

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'durable-movement-arena',
  name: 'Durable Movement Arena',
  revision: 7,
  dimensions: { x: 5, y: 2, z: 4 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [actorPlacement()],
  lights: [],
  initiative: { activeId: 'actor-token', round: 2 },
  activeScene: { name: 'Movement Scene', startedAt: 100 },
  encounterState: createEmptyEncounterState(),
  createdAt: 1,
  updatedAt: 100,
})

const actorSheet = (): CharacterSheet => ({
  slug: 'actor',
  nickname: 'Dancer',
  species: 'Scyther',
  level: 20,
  revision: 3,
  movelist: [{ name: 'Swords Dance' }],
  capabilities: { overland: 6, sky: 0, swim: 0, levitate: 0 },
  combat: { currentHp: 50 },
})

const movementSpec = () => ({
  schemaVersion: 2,
  canonicalId: 'Swords Dance',
  version: 125,
  targeting: {
    kind: 'self',
    minTargets: 1,
    maxTargets: 1,
    selector: { kind: 'actor' },
  },
  preconditions: [],
  costs: [{
    id: 'movement-test.no-cost',
    phase: 'pay',
    cost: { kind: 'no-cost', reasonCode: 'movement-test.reviewed-exception' },
  }],
  phases: [{
    phase: 'movement',
    operations: [{
      id: 'movement-test.choose-destination',
      kind: 'movement-request',
      source: { kind: 'move', id: 'move.swords-dance' },
      recipients: { kind: 'actor' },
      phase: 'movement',
      reasonCode: 'movement-test.choose-destination',
      payload: {
        requestId: 'movement-test.destination-window',
        mode: 'voluntary',
        distance: 3,
        destinationSetId: 'movement-test.destinations',
        choice: {
          kind: 'destination',
          promptKey: 'movement-test.choose-destination',
          allowPass: true,
        },
      },
    }],
  }, {
    phase: 'usage',
    operations: [{
      id: 'movement-test.usage',
      kind: 'usage',
      source: { kind: 'move', id: 'move.swords-dance' },
      recipients: { kind: 'actor' },
      phase: 'usage',
      reasonCode: 'movement-test.frequency-use',
      payload: {
        action: 'spend',
        resourceId: 'movement-test.frequency-use',
        amount: 1,
      },
    }],
  }, {
    phase: 'cleanup',
    operations: [{
      id: 'movement-test.completed',
      kind: 'log',
      source: { kind: 'move', id: 'move.swords-dance' },
      recipients: { kind: 'none' },
      phase: 'cleanup',
      reasonCode: 'movement-test.completed',
      payload: { messageKey: 'movement-test.completed', arguments: [] },
    }],
  }],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Swords Dance',
    vfxKey: null,
    tags: ['movement-choice-test'],
  },
})

const runtimeRegistry = (): MoveAutomationRuntimeRegistry => {
  const definition = validateMoveSpec(movementSpec())
  const runtime: MoveSpecV2Runtime = Object.freeze({
    canonicalId: definition.spec.canonicalId,
    kind: 'movespec-v2',
    version: definition.spec.version,
    definitionHash: definition.definitionHash,
    sourceModule: 'tests/server/moveMovementChoiceResolution.test.ts',
    definition,
  })
  return Object.freeze({
    size: 1,
    handlerRegistry: REGISTERED_MOVE_HANDLER_REGISTRY,
    resolve: (canonicalId: string) => canonicalId === runtime.canonicalId ? runtime : null,
    entries: () => Object.freeze([runtime]),
  })
}

const sheets = () => ({
  pokemonSheets: new Map([['actor', actorSheet()]]),
  trainerSheets: new Map<string, TrainerSheet>(),
})

const intent = {
  schemaVersion: 1 as const,
  placementId: 'actor-token',
  moveName: 'Swords Dance',
  selection: { kind: 'self' as const },
}

describe('durable MoveSpec movement choices', () => {
  it('suspends on server-issued cells, revalidates the selected ID, and atomically plans the shift', () => {
    const registry = runtimeRegistry()
    const resources = sheets()
    const declaration = planAuthoritativeMoveStateExecution({
      map: mapFixture(),
      ...resources,
      intent,
      random: () => { throw new Error('movement choices must not draw randomness') },
      now: () => 1_000,
      operationId: 'op_movementdeclare1',
      pendingResolutionId: 'resolution-movement-choice-1',
      runtimeRegistry: registry,
    })
    expect(isAuthoritativePendingMoveStatePlan(declaration)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration)) return

    const window = declaration.suspension.pendingResolution.outstandingWindows[0]!
    const selected = window.options.find(option => (
      option.selection?.destination.x === 3
      && option.selection.destination.y === 0
      && option.selection.destination.z === 1
    ))
    expect(selected).toMatchObject({
      id: expect.stringMatching(/^movement\.destination\./),
      selection: {
        kind: 'movement-destination',
        setId: 'movement-test.destinations',
        destination: { x: 3, y: 0, z: 1 },
      },
    })
    expect(window).toMatchObject({
      kind: 'choice',
      windowId: 'movement-test.destination-window',
      ownership: [{ kind: 'actor', id: null }],
    })
    expect(declaration.nextMap.placements[0]?.position).toEqual({ x: 1, y: 0, z: 1 })

    const execution = resumeMoveSpec({
      pendingResolution: declaration.suspension.pendingResolution,
      map: declaration.nextMap,
      ...resources,
      response: {
        requestId: window.windowId,
        optionId: selected!.id,
      },
      now: 2_000,
      random: () => { throw new Error('movement choices must not draw randomness') },
      runtimeRegistry: registry,
    })
    expect(isAuthoritativePendingMoveResolution(execution)).toBe(false)
    if (isAuthoritativePendingMoveResolution(execution)) return
    expect(execution).toMatchObject({
      movement: {
        kind: 'shift',
        from: { x: 1, y: 0, z: 1 },
        destination: { x: 3, y: 0, z: 1 },
        pathCells: [
          { x: 1, y: 0, z: 1 },
          { x: 2, y: 0, z: 1 },
          { x: 3, y: 0, z: 1 },
        ],
      },
      resourceMovement: { distance: 2, budget: 3 },
    })

    const completed = planResumedMoveState({
      pendingResolution: declaration.suspension.pendingResolution,
      declarationPlan: declaration.suspension.preWindowPlan,
      responseOpId: 'op_movementanswer01',
      responseWindowId: window.windowId,
      responseOptionId: selected!.id,
      chosenBy: { kind: 'gm', id: null },
      map: declaration.nextMap,
      ...resources,
      execution,
      plannedAt: 2_000,
      runtimeRegistry: registry,
    })
    expect(isAuthoritativePendingMoveStatePlan(completed)).toBe(false)
    if (isAuthoritativePendingMoveStatePlan(completed)) return
    expect(completed.nextMap.placements[0]?.position).toEqual({ x: 3, y: 0, z: 1 })
    expect(completed.stateChanges.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'placement-state',
        sourceOperationId: 'movement-test.choose-destination',
      }),
    ]))
    expect(completed.resolution.auditTrace.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'operation',
        operationId: 'movement-test.choose-destination',
        outcome: 'applied',
        result: expect.objectContaining({
          destination: { x: 3, y: 0, z: 1 },
        }),
      }),
    ]))
  })

  it('fails closed when the stored destination is no longer oracle-legal on resume', () => {
    const registry = runtimeRegistry()
    const resources = sheets()
    const declaration = planAuthoritativeMoveStateExecution({
      map: mapFixture(),
      ...resources,
      intent,
      random: () => 0,
      now: () => 1_000,
      operationId: 'op_movementdeclare2',
      pendingResolutionId: 'resolution-movement-choice-2',
      runtimeRegistry: registry,
    })
    if (!isAuthoritativePendingMoveStatePlan(declaration)) {
      throw new Error('expected a pending movement declaration')
    }
    const window = declaration.suspension.pendingResolution.outstandingWindows[0]!
    const selected = window.options.find(option => (
      option.selection?.destination.x === 2
      && option.selection.destination.z === 1
    ))!
    const staleMap: TabletopMap = {
      ...structuredClone(declaration.nextMap),
      placements: [
        actorPlacement(),
        {
          id: 'late-blocker',
          sheetKind: 'pokemon',
          sheetSlug: 'late-blocker',
          position: { x: 2, y: 0, z: 1 },
        },
      ],
    }
    const staleSheets = {
      pokemonSheets: new Map([
        ['actor', actorSheet()],
        ['late-blocker', { ...actorSheet(), slug: 'late-blocker', revision: 1 }],
      ]),
      trainerSheets: new Map<string, TrainerSheet>(),
    }

    expect(() => resumeMoveSpec({
      pendingResolution: declaration.suspension.pendingResolution,
      map: staleMap,
      ...staleSheets,
      response: { requestId: window.windowId, optionId: selected.id },
      now: 2_000,
      random: () => 0,
      runtimeRegistry: registry,
    })).toThrowError(expect.objectContaining({
      name: 'ResumeMoveSpecError',
      code: 'execution-rejected',
    } satisfies Partial<ResumeMoveSpecError>))
  })

  it('keeps a reviewed pass as an explicit no-movement response', () => {
    const registry = runtimeRegistry()
    const resources = sheets()
    const declaration = planAuthoritativeMoveStateExecution({
      map: mapFixture(),
      ...resources,
      intent,
      random: () => 0,
      now: () => 1_000,
      operationId: 'op_movementdeclare3',
      pendingResolutionId: 'resolution-movement-choice-3',
      runtimeRegistry: registry,
    })
    if (!isAuthoritativePendingMoveStatePlan(declaration)) {
      throw new Error('expected a pending movement declaration')
    }
    const window = declaration.suspension.pendingResolution.outstandingWindows[0]!
    const execution = resumeMoveSpec({
      pendingResolution: declaration.suspension.pendingResolution,
      map: declaration.nextMap,
      ...resources,
      response: { requestId: window.windowId, optionId: null },
      now: 2_000,
      random: () => 0,
      runtimeRegistry: registry,
    })
    expect(isAuthoritativePendingMoveResolution(execution)).toBe(false)
    if (isAuthoritativePendingMoveResolution(execution)) return
    expect(execution.movement).toBeUndefined()
    expect(execution.resourceMovement).toBeUndefined()
  })
})
