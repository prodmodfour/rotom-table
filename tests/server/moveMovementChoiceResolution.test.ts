import { describe, expect, it } from 'vitest'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  parsePendingMoveResolution,
} from '#shared/moveAutomation/pendingResolution'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveStateExecution,
} from '~~/server/domain/planAuthoritativeMoveState'
import { isAuthoritativePendingMoveResolution } from '~~/server/domain/resolveAuthoritativeMove'
import { planResumedMoveState } from '~~/server/domain/moveAutomation/planResumedMoveState'
import { ResumeMoveSpecError, resumeMoveSpec } from '~~/server/domain/moveAutomation/resumeSpec'
import {
  MOVEMENT_CHOICE_DIRECTION_DECLARATION,
  createMovementChoiceActorSheet as actorSheet,
  createMovementChoiceMap as mapFixture,
  createMovementChoiceRuntimeRegistry as runtimeRegistry,
  movementChoiceActorPlacement as actorPlacement,
  movementChoiceIntent,
  movementChoiceSheets as sheets,
} from '../fixtures/moveAutomation/movementChoices'

const intent = movementChoiceIntent()

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

  it('round-trips canonical directions and resumes the selected server-owned endpoint', () => {
    const registry = runtimeRegistry(MOVEMENT_CHOICE_DIRECTION_DECLARATION)
    const resources = sheets()
    const map = mapFixture()
    const mapBefore = structuredClone(map)
    const declaration = planAuthoritativeMoveStateExecution({
      map,
      ...resources,
      intent,
      random: () => { throw new Error('movement choices must not draw randomness') },
      now: () => 1_000,
      operationId: 'op_movementdeclare4',
      pendingResolutionId: 'resolution-movement-choice-4',
      runtimeRegistry: registry,
    })
    expect(isAuthoritativePendingMoveStatePlan(declaration)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration)) return

    const pending = declaration.suspension.pendingResolution
    expect(pending.outstandingWindows[0]?.options.map(option => (
      option.selection?.kind === 'movement-direction'
        ? [option.selection.direction, option.selection.destination]
        : null
    ))).toEqual([
      ['north', { x: 1, y: 0, z: 0 }],
      ['east', { x: 4, y: 0, z: 1 }],
      ['south', { x: 1, y: 0, z: 3 }],
    ])
    expect(parsePendingMoveResolution(
      JSON.parse(JSON.stringify(pending)) as unknown,
    )).toEqual(pending)
    expect(declaration.nextMap.placements[0]?.position).toEqual({ x: 1, y: 0, z: 1 })
    expect(map).toEqual(mapBefore)
    expect(Object.keys(pending.publicSummary)).not.toContain('options')
    expect(Object.keys(pending.publicSummary)).not.toContain('ownership')

    const window = pending.outstandingWindows[0]!
    const east = window.options.find(option => (
      option.selection?.kind === 'movement-direction'
      && option.selection.direction === 'east'
    ))!
    const execution = resumeMoveSpec({
      pendingResolution: pending,
      map: declaration.nextMap,
      ...resources,
      response: { requestId: window.windowId, optionId: east.id },
      now: 2_000,
      random: () => { throw new Error('movement choices must not draw randomness') },
      runtimeRegistry: registry,
    })
    expect(isAuthoritativePendingMoveResolution(execution)).toBe(false)
    if (isAuthoritativePendingMoveResolution(execution)) return
    expect(execution.movement).toEqual({
      kind: 'shift',
      from: { x: 1, y: 0, z: 1 },
      destination: { x: 4, y: 0, z: 1 },
      pathCells: [
        { x: 1, y: 0, z: 1 },
        { x: 2, y: 0, z: 1 },
        { x: 3, y: 0, z: 1 },
        { x: 4, y: 0, z: 1 },
      ],
      direction: 'east',
    })
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

  it('rejects a stored cell when fresh range, bounds, or movement capability no longer permits it', () => {
    const registry = runtimeRegistry()
    const resources = sheets()
    const declaration = planAuthoritativeMoveStateExecution({
      map: mapFixture(),
      ...resources,
      intent,
      random: () => 0,
      now: () => 1_000,
      operationId: 'op_movementdeclare5',
      pendingResolutionId: 'resolution-movement-choice-5',
      runtimeRegistry: registry,
    })
    if (!isAuthoritativePendingMoveStatePlan(declaration)) {
      throw new Error('expected a pending movement declaration')
    }
    const pending = declaration.suspension.pendingResolution
    const window = pending.outstandingWindows[0]!
    const selected = window.options.find(option => (
      option.selection?.destination.x === 3
      && option.selection.destination.y === 0
      && option.selection.destination.z === 1
    ))!
    const response = { requestId: window.windowId, optionId: selected.id }
    const assertRejected = (input: {
      readonly map: TabletopMap
      readonly resources: ReturnType<typeof sheets>
    }) => expect(() => resumeMoveSpec({
      pendingResolution: pending,
      map: input.map,
      ...input.resources,
      response,
      now: 2_000,
      random: () => 0,
      runtimeRegistry: registry,
    })).toThrowError(expect.objectContaining({
      name: 'ResumeMoveSpecError',
      code: 'execution-rejected',
    } satisfies Partial<ResumeMoveSpecError>))

    assertRejected({
      map: declaration.nextMap,
      resources: sheets(actorSheet({
        capabilities: { overland: 1, sky: 0, swim: 0, levitate: 0 },
      })),
    })
    assertRejected({
      map: { ...structuredClone(declaration.nextMap), dimensions: { x: 2, y: 2, z: 4 } },
      resources,
    })
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
