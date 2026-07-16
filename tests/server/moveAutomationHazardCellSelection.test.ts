import { describe, expect, it } from 'vitest'
import {
  MOVE_HAZARD_CELL_SELECTION_SCHEMA_VERSION,
  moveHazardCellSelectionResponseId,
  parseMoveHazardCellSelectionDeclaration,
  type MoveHazardCellSelectionDeclaration,
  type MoveHazardCellSelectionWindow,
} from '#shared/livePlayMoveResolution'
import type { GridAnchor, SheetPlacement, TabletopMap } from '~/types/map'
import {
  AuthoritativeHazardCellSelectionError,
  materializeAuthoritativeHazardCellSelection,
  validateAuthoritativeHazardCellSelection,
} from '~~/server/domain/moveAutomation/hazardCellSelection'

const placement = (id: string, position: GridAnchor): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug: id,
  position,
})

const mapFixture = (
  placements: readonly SheetPlacement[] = [
    placement('actor-token', { x: 2, y: 0, z: 2 }),
  ],
): TabletopMap => ({
  schemaVersion: 2,
  slug: 'hazard-arena',
  name: 'Hazard Arena',
  revision: 7,
  dimensions: { x: 5, y: 1, z: 5 },
  voxels: [],
  placements: [...placements],
})

const declaration = (
  overrides: Record<string, unknown> = {},
): MoveHazardCellSelectionDeclaration => parseMoveHazardCellSelectionDeclaration({
  schemaVersion: MOVE_HAZARD_CELL_SELECTION_SCHEMA_VERSION,
  windowId: 'window.hazard.spikes',
  promptKey: 'move.hazard.select-cells',
  map: { slug: 'hazard-arena', revision: 7 },
  move: {
    resolutionId: 'resolution-hazard-1',
    actorPlacementId: 'actor-token',
    canonicalMoveId: 'Spikes',
    operationId: 'operation.hazard.spikes',
    cellSetId: 'cells.hazard.spikes',
  },
  constraints: {
    count: { kind: 'exact', count: 2 },
    origin: { x: 2, y: 0, z: 2 },
    range: 2,
    adjacency: 'including-diagonal',
    connectedness: 'connected',
    occupancy: 'empty-of-placements',
    geometry: { kind: 'horizontal-plane' },
    ...overrides,
  },
})

const expectSelectionError = (
  run: () => unknown,
  code: AuthoritativeHazardCellSelectionError['code'],
): void => {
  expect(run).toThrowError(expect.objectContaining({
    name: 'AuthoritativeHazardCellSelectionError',
    code,
  }))
}

const optionForCell = (
  window: MoveHazardCellSelectionWindow,
  cell: GridAnchor,
) => {
  const option = window.options.find(candidate => (
    candidate.cell.x === cell.x
    && candidate.cell.y === cell.y
    && candidate.cell.z === cell.z
  ))
  if (!option) throw new Error(`missing option ${cell.x},${cell.y},${cell.z}`)
  return option
}

describe('authoritative hazard-cell selection', () => {
  it('materializes only legal reviewed cells in deterministic map order with stable IDs', () => {
    const map = mapFixture([
      placement('actor-token', { x: 2, y: 0, z: 2 }),
      placement('blocker-token', { x: 3, y: 0, z: 2 }),
    ])
    const reviewed = declaration({
      geometry: {
        kind: 'reviewed-cells',
        cells: [
          { x: 1, y: 0, z: 2 },
          { x: 5, y: 0, z: 2 },
          { x: 3, y: 0, z: 2 },
          { x: 4, y: 0, z: 4 },
          { x: 1, y: 0, z: 1 },
        ],
      },
    })
    const mapBefore = structuredClone(map)
    const declarationBefore = structuredClone(reviewed)

    const first = materializeAuthoritativeHazardCellSelection({ map, declaration: reviewed })
    const replay = materializeAuthoritativeHazardCellSelection({ map, declaration: reviewed })

    expect(first.window.options.map(option => option.cell)).toEqual([
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 0, z: 2 },
    ])
    expect(first.window.options.map(option => option.id)).toEqual([
      expect.stringMatching(/^hazard\.cell\.[a-f0-9]{8}\.1\.0\.1$/),
      expect.stringMatching(/^hazard\.cell\.[a-f0-9]{8}\.1\.0\.2$/),
    ])
    expect(replay.window.options.map(option => option.id)).toEqual(
      first.window.options.map(option => option.id),
    )
    expect(first.publicWindow.options).toEqual(first.window.options)
    expect(first.publicWindow.move).toEqual({
      resolutionId: 'resolution-hazard-1',
      actorPlacementId: 'actor-token',
      canonicalMoveId: 'Spikes',
    })
    expect(map).toEqual(mapBefore)
    expect(reviewed).toEqual(declarationBefore)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.window)).toBe(true)
    expect(Object.isFrozen(first.window.options[0]?.cell)).toBe(true)
  })

  it('validates exact and up-to counts and canonicalizes response order', () => {
    const map = mapFixture()
    const exact = materializeAuthoritativeHazardCellSelection({
      map,
      declaration: declaration({ connectedness: 'none' }),
    }).window
    const first = optionForCell(exact, { x: 1, y: 0, z: 1 })
    const second = optionForCell(exact, { x: 2, y: 0, z: 1 })
    const ids = [second.id, first.id]
    const idsBefore = [...ids]

    const validated = validateAuthoritativeHazardCellSelection({
      map,
      window: exact,
      selectedOptionIds: ids,
    })

    expect(validated.optionIds).toEqual([first.id, second.id])
    expect(validated.selectionId).toBe(moveHazardCellSelectionResponseId(
      exact.declaration.windowId,
      [first.id, second.id],
    ))
    expect(validated.cells).toEqual([first.cell, second.cell])
    expect(ids).toEqual(idsBefore)
    expect(Object.isFrozen(validated)).toBe(true)
    expect(Object.isFrozen(validated.cells)).toBe(true)
    expect(Object.isFrozen(validated.cells[0])).toBe(true)

    expectSelectionError(() => validateAuthoritativeHazardCellSelection({
      map,
      window: exact,
      selectedOptionIds: [first.id],
    }), 'hazard-cell-selection-limit')

    const upTo = materializeAuthoritativeHazardCellSelection({
      map,
      declaration: declaration({
        count: { kind: 'up-to', minimum: 0, maximum: 3 },
        connectedness: 'none',
      }),
    }).window
    expect(validateAuthoritativeHazardCellSelection({
      map,
      window: upTo,
      selectedOptionIds: [],
    }).cells).toEqual([])
    expect(validateAuthoritativeHazardCellSelection({
      map,
      window: upTo,
      selectedOptionIds: [first.id, second.id],
    }).cells).toHaveLength(2)
    expectSelectionError(() => validateAuthoritativeHazardCellSelection({
      map,
      window: upTo,
      selectedOptionIds: upTo.options.slice(0, 4).map(option => option.id),
    }), 'hazard-cell-selection-limit')
  })

  it('rejects duplicate and forged option IDs before resolving any cells', () => {
    const map = mapFixture()
    const window = materializeAuthoritativeHazardCellSelection({
      map,
      declaration: declaration({ connectedness: 'none' }),
    }).window
    const option = window.options[0]!

    expectSelectionError(() => validateAuthoritativeHazardCellSelection({
      map,
      window,
      selectedOptionIds: [option.id, option.id],
    }), 'hazard-cell-selection-duplicate')
    expectSelectionError(() => validateAuthoritativeHazardCellSelection({
      map,
      window,
      selectedOptionIds: [option.id, 'hazard.cell.deadbeef.4.0.4'],
    }), 'hazard-cell-option-unknown')
    expectSelectionError(() => validateAuthoritativeHazardCellSelection({
      map,
      window,
      selectedOptionIds: [{ x: 1, y: 0, z: 1 }, option.id],
    }), 'hazard-cell-selection-invalid')
  })

  it('enforces reviewed adjacency for connected and no-isolated selections', () => {
    const map = mapFixture()
    const connected = materializeAuthoritativeHazardCellSelection({
      map,
      declaration: declaration({
        range: 5,
        adjacency: 'orthogonal',
        connectedness: 'connected',
      }),
    }).window
    const northWest = optionForCell(connected, { x: 0, y: 0, z: 0 })
    const southEast = optionForCell(connected, { x: 4, y: 0, z: 4 })

    expectSelectionError(() => validateAuthoritativeHazardCellSelection({
      map,
      window: connected,
      selectedOptionIds: [northWest.id, southEast.id],
    }), 'hazard-cell-disconnected')

    const noIsolated = structuredClone(connected) as any
    noIsolated.declaration.constraints.connectedness = 'no-isolated'
    expectSelectionError(() => validateAuthoritativeHazardCellSelection({
      map,
      window: noIsolated,
      selectedOptionIds: [northWest.id, southEast.id],
    }), 'hazard-cell-isolated')
  })

  it('rechecks occupancy, bounds, range, and reviewed geometry from stored options', () => {
    const baseMap = mapFixture()
    const broadWindow = materializeAuthoritativeHazardCellSelection({
      map: baseMap,
      declaration: declaration({
        range: 5,
        connectedness: 'none',
      }),
    }).window
    const atFour = optionForCell(broadWindow, { x: 4, y: 0, z: 2 })
    const adjacent = optionForCell(broadWindow, { x: 1, y: 0, z: 2 })

    const occupiedMap: TabletopMap = {
      ...baseMap,
      placements: [
        ...baseMap.placements,
        placement('late-blocker', adjacent.cell),
      ],
    }
    expectSelectionError(() => validateAuthoritativeHazardCellSelection({
      map: occupiedMap,
      window: broadWindow,
      selectedOptionIds: [adjacent.id, atFour.id],
    }), 'hazard-cell-occupied')

    const smallerMap: TabletopMap = {
      ...baseMap,
      dimensions: { x: 4, y: 1, z: 5 },
    }
    expectSelectionError(() => validateAuthoritativeHazardCellSelection({
      map: smallerMap,
      window: broadWindow,
      selectedOptionIds: [adjacent.id, atFour.id],
    }), 'hazard-cell-out-of-bounds')

    const narrowedRange = structuredClone(broadWindow) as any
    narrowedRange.declaration.constraints.range = 1
    expectSelectionError(() => validateAuthoritativeHazardCellSelection({
      map: baseMap,
      window: narrowedRange,
      selectedOptionIds: [adjacent.id, atFour.id],
    }), 'hazard-cell-out-of-range')

    const narrowedGeometry = structuredClone(broadWindow) as any
    narrowedGeometry.declaration.constraints.geometry = {
      kind: 'reviewed-cells',
      cells: [adjacent.cell, { x: 1, y: 0, z: 1 }],
    }
    expectSelectionError(() => validateAuthoritativeHazardCellSelection({
      map: baseMap,
      window: narrowedGeometry,
      selectedOptionIds: [adjacent.id, atFour.id],
    }), 'hazard-cell-outside-geometry')
  })

  it('binds windows to map revision and bounds candidate scans', () => {
    const map = mapFixture()
    const window = materializeAuthoritativeHazardCellSelection({
      map,
      declaration: declaration({ connectedness: 'none' }),
    }).window

    expectSelectionError(() => validateAuthoritativeHazardCellSelection({
      map: { ...map, revision: 8 },
      window,
      selectedOptionIds: window.options.slice(0, 2).map(option => option.id),
    }), 'hazard-cell-window-stale')

    const largeMap: TabletopMap = {
      ...map,
      dimensions: { x: 100, y: 1, z: 100 },
      placements: [placement('actor-token', { x: 50, y: 0, z: 50 })],
    }
    expectSelectionError(() => materializeAuthoritativeHazardCellSelection({
      map: largeMap,
      declaration: declaration({
        count: { kind: 'exact', count: 1 },
        origin: { x: 50, y: 0, z: 50 },
        range: 50,
        connectedness: 'none',
        occupancy: 'allow-occupied',
      }),
    }), 'hazard-cell-candidate-limit')
  })
})
