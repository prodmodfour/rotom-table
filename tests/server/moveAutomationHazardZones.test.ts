import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState, type EncounterState } from '#shared/moveAutomation/encounterState'
import {
  parseMoveEffectOperation,
  type MoveHazardEffectOperation,
  type MoveHazardGeometry,
} from '#shared/moveAutomation/effects'
import type { ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import { buildAuthoritativeMoveRulesContext } from '~~/server/domain/moveAutomation/context'
import { resolveMoveHazardGeometryCells } from '~~/server/domain/moveAutomation/hazardGeometry'
import { reduceMoveHazardZones } from '~~/server/domain/moveAutomation/reducers/mapHazardEffects'
import {
  MoveMapOperationReductionError,
} from '~~/server/domain/moveAutomation/reducers/mapOperations'
import type { CharacterSheet } from '~/types/characterSheet'
import type {
  GridAnchor,
  SheetPlacement,
  TabletopMap,
} from '~/types/map'
import type { MoveAutomationAreaDirection } from '~/types/moveAutomation'
import type { TrainerSheet } from '~/types/trainerSheet'

const placement = (
  id: string,
  sheetSlug: string,
  sideId: 'red' | 'blue' | undefined,
  position: GridAnchor,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  ...(sideId ? { sideId } : {}),
  position,
})

const sheet = (slug: string): CharacterSheet => ({
  slug,
  nickname: slug,
  species: slug === 'actor' ? 'Pikachu' : 'Eevee',
  level: 20,
  revision: 1,
  combat: { currentHp: 40 },
  movelist: [{ name: 'Hazard Test' }],
})

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'hazard-zone-arena',
  name: 'Hazard Zone Arena',
  revision: 7,
  dimensions: { x: 10, y: 3, z: 10 },
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    placement('actor-token', 'actor', 'red', { x: 4, y: 0, z: 4 }),
    placement('target-token', 'target', 'blue', { x: 7, y: 0, z: 4 }),
    placement('unknown-token', 'unknown', undefined, { x: 1, y: 0, z: 1 }),
  ],
  encounterState: {
    ...createEmptyEncounterState(),
    sides: {
      red: { id: 'red', label: 'Red', status: 'active' },
      blue: { id: 'blue', label: 'Blue', status: 'active' },
    },
  },
  ...overrides,
})

const intent = (options: {
  readonly actorId?: string
  readonly targetId?: string
  readonly direction?: MoveAutomationAreaDirection
} = {}): ResolveMoveIntent => ({
  schemaVersion: 1,
  placementId: options.actorId ?? 'actor-token',
  moveName: 'Hazard Test',
  selection: options.direction
    ? { kind: 'area', areaTemplateId: 'line:any:4', direction: options.direction }
    : {
        kind: 'single-target',
        targetPlacementId: options.targetId ?? 'target-token',
      },
})

const contextFixture = (options: {
  readonly map?: TabletopMap
  readonly actorId?: string
  readonly targetId?: string
  readonly direction?: MoveAutomationAreaDirection
} = {}) => {
  const actorId = options.actorId ?? 'actor-token'
  const targetId = options.targetId ?? (actorId === 'actor-token' ? 'target-token' : 'actor-token')
  return buildAuthoritativeMoveRulesContext({
    map: options.map ?? mapFixture(),
    pokemonSheets: new Map([
      ['actor', sheet('actor')],
      ['target', sheet('target')],
      ['unknown', sheet('unknown')],
    ]),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: intent({ actorId, targetId, direction: options.direction }),
    candidatePlacementIds: [targetId],
    selectedPlacementIds: [targetId],
    random: () => 0,
    time: 1_000,
  })
}

const count = (value: number) => ({ kind: 'exact' as const, count: value })
const selectionGeometry = (
  cellSetId: string,
  selectedCount = 1,
): MoveHazardGeometry => ({
  kind: 'selection',
  cellSetId,
  count: count(selectedCount),
  adjacency: 'orthogonal',
  connectedness: selectedCount > 1 ? 'connected' : 'none',
})

const addPayload = (overrides: Record<string, unknown> = {}) => ({
  action: 'add',
  familyId: 'hazard.spikes',
  zoneKind: 'hazard',
  effectId: 'spikes',
  ownership: 'source-side',
  geometry: selectionGeometry('cells.hazard'),
  layers: 1,
  maxLayers: 3,
  charges: null,
  maxCharges: null,
  ...overrides,
})

const hazardOperation = (
  id: string,
  payload: Record<string, unknown>,
  recipients: MoveHazardEffectOperation['recipients']['kind'] = 'none',
): MoveHazardEffectOperation => parseMoveEffectOperation({
  id,
  kind: 'hazard',
  source: { kind: 'move', id: 'move.hazard-test' },
  recipients: { kind: recipients },
  phase: 'schedule',
  reasonCode: `hazard-test.${id}`,
  payload,
}) as MoveHazardEffectOperation

const reduce = (options: {
  readonly context?: ReturnType<typeof contextFixture>
  readonly previous?: EncounterState
  readonly operation: MoveHazardEffectOperation
  readonly recipientIds?: readonly string[]
  readonly cells?: ReadonlyMap<string, readonly GridAnchor[]>
}) => reduceMoveHazardZones({
  context: options.context ?? contextFixture(),
  previous: options.previous,
  operation: options.operation,
  recipientIds: options.recipientIds ?? [],
  ...(options.cells ? { resolutions: { cellSets: options.cells } } : {}),
})

const oneCell = (id: string, cell: GridAnchor) => new Map([[id, [cell]]])

const expectReductionError = (
  callback: () => unknown,
  code: MoveMapOperationReductionError['code'],
): void => {
  try {
    callback()
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(MoveMapOperationReductionError)
    expect(error).toMatchObject({ code })
  }
}

describe('typed move hazard zones', () => {
  it('represents the canonical hazard and pledge families with side/source identity', () => {
    const examples = [
      ['spikes', 'hazard.spikes', 'hazard', 3, { x: 1, y: 0, z: 2 }],
      ['stealth-rock', 'hazard.stealth-rock', 'hazard', 1, { x: 2, y: 0, z: 2 }],
      ['sticky-web', 'hazard.sticky-web', 'hazard', 1, { x: 3, y: 0, z: 2 }],
      ['toxic-spikes', 'hazard.toxic-spikes', 'hazard', 2, { x: 4, y: 0, z: 2 }],
      ['stone-axe', 'hazard.stone-axe', 'hazard', 1, { x: 5, y: 0, z: 2 }],
      ['fire-grass', 'pledge.fire-grass', 'pledge', 1, { x: 6, y: 0, z: 2 }],
    ] as const
    let state = contextFixture().map.encounterState!

    for (const [effectId, familyId, zoneKind, maxLayers, cell] of examples) {
      const cellSetId = `cells.${effectId}`
      state = reduce({
        previous: state,
        operation: hazardOperation(`operation.add-${effectId}`, addPayload({
          familyId,
          zoneKind,
          effectId,
          ownership: zoneKind === 'pledge' ? 'neutral' : 'source-side',
          geometry: selectionGeometry(cellSetId),
          maxLayers,
        })),
        cells: oneCell(cellSetId, cell),
      }).current
    }

    expect(state.zones).toHaveLength(examples.length)
    expect(state.zones.map(zone => [zone.kind, zone.sideId, zone.layer])).toEqual([
      ['hazard', 'red', 1],
      ['hazard', 'red', 1],
      ['hazard', 'red', 1],
      ['hazard', 'red', 1],
      ['hazard', 'red', 1],
      ['pledge', null, 1],
    ])
    expect(state.zones.map(zone => zone.source)).toEqual(examples.map(([, , , ,], index) => ({
      kind: 'operation',
      operationId: `operation.add-${examples[index]![0]}`,
      moveId: 'move.hazard-test',
      placementId: 'actor-token',
    })))
    expect(state.zones.map(zone => zone.payload)).toEqual(examples.map(([
      effectId,
      familyId,
      zoneKind,
    ]) => ({
      [zoneKind === 'hazard' ? 'hazardId' : 'pledgeId']: effectId,
      familyId,
      charges: null,
      maxCharges: null,
    })))
    expect(state.zones[0]?.hooks.entry).toEqual([{
      id: 'zone.hazard.spikes.entry',
      handlerId: 'zone.hazard.spikes.entry',
      oncePerMovement: true,
    }])
    expect(state.zones[0]?.modifiers.movement).toEqual([expect.objectContaining({
      attribute: 'cost',
      operation: 'multiply',
      value: 2,
    })])
    expect(state.zones[2]?.hooks.entry[0]?.handlerId).toBe('zone.hazard.sticky-web.entry')
    expect(state.zones[5]?.hooks.entry[0]?.handlerId).toBe('zone.pledge.fire-grass.entry')
  })

  it('adds and caps independent per-cell layers and charges without mutating inputs', () => {
    const context = contextFixture()
    const previous = structuredClone(context.map.encounterState!)
    const firstOperation = hazardOperation('operation.layer-one', addPayload({
      charges: 1,
      maxCharges: 2,
    }))
    const first = reduce({
      context,
      previous,
      operation: firstOperation,
      cells: oneCell('cells.hazard', { x: 3, y: 0, z: 3 }),
    })
    const second = reduce({
      context,
      previous: first.current,
      operation: hazardOperation('operation.layer-two', addPayload({
        layers: 2,
        charges: 2,
        maxCharges: 2,
      })),
      cells: oneCell('cells.hazard', { x: 3, y: 0, z: 3 }),
    })
    const capped = reduce({
      context,
      previous: second.current,
      operation: hazardOperation('operation.layer-capped', addPayload({
        layers: 2,
        charges: 2,
        maxCharges: 2,
      })),
      cells: oneCell('cells.hazard', { x: 3, y: 0, z: 3 }),
    })

    expect(previous.zones).toEqual([])
    expect(first.current.zones[0]).toMatchObject({
      layer: 1,
      payload: { charges: 1, maxCharges: 2 },
    })
    expect(second.current.zones).toHaveLength(1)
    expect(second.current.zones[0]).toMatchObject({
      layer: 3,
      source: { operationId: 'operation.layer-two' },
      payload: { charges: 2, maxCharges: 2 },
    })
    expect(second.details).toMatchObject({ addedLayers: 2, addedCharges: 1 })
    expect(capped.changed).toBe(false)
    expect(capped.current).toEqual(second.current)
  })

  it('derives bounded connected Line and Blast cells deterministically', () => {
    for (const direction of ['north', 'east', 'south', 'west'] as const) {
      for (let length = 1; length <= 4; length += 1) {
        const context = contextFixture({ direction })
        const geometry: MoveHazardGeometry = {
          kind: 'line',
          length,
          count: count(length),
          adjacency: 'orthogonal',
          connectedness: 'connected',
        }
        const first = resolveMoveHazardGeometryCells({
          context,
          geometry,
          recipientIds: [],
          operationId: `operation.line-${direction}-${length}`,
        })
        const repeated = resolveMoveHazardGeometryCells({
          context,
          geometry,
          recipientIds: [],
          operationId: `operation.line-${direction}-${length}`,
        })
        expect(repeated).toEqual(first)
        expect(first).toHaveLength(length)
        expect(new Set(first.map(cell => `${cell.x}:${cell.y}:${cell.z}`))).toHaveLength(length)
        expect(first.every(cell => (
          cell.x >= 0 && cell.x < 10 && cell.y >= 0 && cell.y < 3 && cell.z >= 0 && cell.z < 10
        ))).toBe(true)
      }
    }

    const context = contextFixture()
    const blast = resolveMoveHazardGeometryCells({
      context,
      geometry: {
        kind: 'blast',
        center: 'selected-target',
        size: 1,
        count: count(1),
        adjacency: 'including-diagonal',
        connectedness: 'connected',
      },
      recipientIds: ['target-token'],
      operationId: 'operation.target-blast',
    })
    expect(blast).toEqual([{ x: 7, y: 0, z: 4 }])

    const elevatedMap = mapFixture({
      placements: mapFixture().placements.map(item => item.id === 'target-token'
        ? { ...item, position: { ...item.position, y: 1 } }
        : item),
    })
    const blastTwo = resolveMoveHazardGeometryCells({
      context: contextFixture({ map: elevatedMap }),
      geometry: {
        kind: 'blast',
        center: 'selected-target',
        size: 2,
        count: count(8),
        adjacency: 'including-diagonal',
        connectedness: 'connected',
      },
      recipientIds: ['target-token'],
      operationId: 'operation.target-blast-two',
    })
    expect(blastTwo).toHaveLength(8)
    expect(new Set(blastTwo.map(cell => `${cell.x}:${cell.y}:${cell.z}`))).toHaveLength(8)
  })

  it('enforces exact/up-to counts, connectedness, bounds, and authoritative derived obstruction', () => {
    const context = contextFixture()
    expectReductionError(() => resolveMoveHazardGeometryCells({
      context,
      geometry: {
        ...selectionGeometry('cells.disconnected', 2),
        connectedness: 'connected',
      },
      recipientIds: [],
      resolutions: {
        cellSets: new Map([['cells.disconnected', [
          { x: 1, y: 0, z: 1 },
          { x: 8, y: 0, z: 8 },
        ]]]),
      },
      operationId: 'operation.disconnected',
    }), 'hazard-geometry-invalid')

    expectReductionError(() => resolveMoveHazardGeometryCells({
      context,
      geometry: selectionGeometry('cells.out-of-bounds'),
      recipientIds: [],
      resolutions: { cellSets: oneCell('cells.out-of-bounds', { x: 10, y: 0, z: 0 }) },
      operationId: 'operation.out-of-bounds',
    }), 'hazard-geometry-invalid')

    const blockedMap = mapFixture({
      voxels: [{ x: 6, y: 0, z: 4, materialId: 'stone', blocksMovement: true }],
    })
    expectReductionError(() => resolveMoveHazardGeometryCells({
      context: contextFixture({ map: blockedMap, direction: 'east' }),
      geometry: {
        kind: 'line',
        length: 3,
        count: count(3),
        adjacency: 'orthogonal',
        connectedness: 'connected',
      },
      recipientIds: [],
      operationId: 'operation.blocked-line',
    }), 'hazard-geometry-invalid')

    const empty = reduce({
      operation: hazardOperation('operation.optional-empty', addPayload({
        geometry: {
          kind: 'selection',
          cellSetId: 'cells.empty',
          count: { kind: 'up-to', minimum: 0, maximum: 3 },
          adjacency: 'orthogonal',
          connectedness: 'connected',
        },
      })),
      cells: new Map([['cells.empty', []]]),
    })
    expect(empty.changed).toBe(false)
    expect(empty.current.zones).toEqual([])
  })

  it('removes by exact ID or typed family/side/geometry and atomically swaps sides', () => {
    const redContext = contextFixture()
    const blueContext = contextFixture({ actorId: 'target-token', targetId: 'actor-token' })
    const redCell = { x: 2, y: 0, z: 3 }
    const blueCell = { x: 8, y: 0, z: 3 }
    let state = reduce({
      context: redContext,
      operation: hazardOperation('operation.add-red', addPayload()),
      cells: oneCell('cells.hazard', redCell),
    }).current
    state = reduce({
      context: blueContext,
      previous: state,
      operation: hazardOperation('operation.add-blue', addPayload()),
      cells: oneCell('cells.hazard', blueCell),
    }).current
    state = reduce({
      context: redContext,
      previous: state,
      operation: hazardOperation('operation.add-neutral', addPayload({
        familyId: 'pledge.fire-grass',
        zoneKind: 'pledge',
        effectId: 'fire-grass',
        ownership: 'neutral',
        maxLayers: 1,
      })),
      cells: oneCell('cells.hazard', { x: 5, y: 0, z: 5 }),
    }).current

    const beforeSwap = structuredClone(state)
    const swapped = reduce({
      context: redContext,
      previous: state,
      operation: hazardOperation(
        'operation.swap-sides',
        { action: 'swap-sides', zoneKinds: ['hazard', 'pledge'] },
        'selected-targets',
      ),
      recipientIds: ['target-token'],
    })
    expect(beforeSwap.zones.map(zone => zone.sideId)).toEqual(['red', 'blue', null])
    expect(swapped.current.zones.map(zone => zone.sideId)).toEqual(['blue', 'red', null])
    expect(swapped.current.zones.slice(0, 2).every(zone => (
      zone.source.kind === 'operation' && zone.source.operationId === 'operation.swap-sides'
    ))).toBe(true)
    expect(new Set(swapped.current.zones.map(zone => zone.id)).size).toBe(3)

    const removeBlue = reduce({
      context: redContext,
      previous: swapped.current,
      operation: hazardOperation(
        'operation.remove-recipient-side',
        {
          action: 'remove',
          target: {
            kind: 'matching',
            zoneKinds: ['hazard'],
            ownership: 'recipient-side',
            familyId: 'hazard.spikes',
            geometry: selectionGeometry('cells.remove-recipient'),
          },
        },
        'selected-targets',
      ),
      recipientIds: ['target-token'],
      cells: oneCell('cells.remove-recipient', redCell),
    })
    expect(removeBlue.current.zones.map(zone => zone.sideId)).toEqual(['red', null])

    const exactId = removeBlue.current.zones.find(zone => zone.sideId === 'red')!.id
    const exact = reduce({
      context: redContext,
      previous: removeBlue.current,
      operation: hazardOperation('operation.remove-id', {
        action: 'remove',
        target: { kind: 'zone-id', zoneId: exactId },
      }),
    })
    expect(exact.current.zones).toHaveLength(1)
    expect(exact.current.zones[0]).toMatchObject({ kind: 'pledge', sideId: null })
    expect(state).toEqual(beforeSwap)
  })

  it('fails closed when reviewed side ownership cannot resolve explicit sides', () => {
    const unknownContext = contextFixture({ actorId: 'unknown-token', targetId: 'actor-token' })
    const stateBefore = structuredClone(unknownContext.map.encounterState)
    expectReductionError(() => reduce({
      context: unknownContext,
      operation: hazardOperation('operation.unknown-owner', addPayload()),
      cells: oneCell('cells.hazard', { x: 1, y: 0, z: 2 }),
    }), 'hazard-ownership-invalid')
    expect(unknownContext.map.encounterState).toEqual(stateBefore)
  })
})
