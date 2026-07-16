import { describe, expect, it } from 'vitest'
import {
  MOVE_HAZARD_CELL_SELECTION_LIMITS,
  MOVE_HAZARD_CELL_SELECTION_SCHEMA_VERSION,
  MoveHazardCellSelectionValidationError,
  moveHazardCellSelectionOptionId,
  parseMoveHazardCellSelectionDeclaration,
  parseMoveHazardCellSelectionPublicWindow,
  parseMoveHazardCellSelectionWindow,
  projectMoveHazardCellSelectionPublicWindow,
  type MoveHazardCellSelectionDeclaration,
} from '#shared/livePlayMoveResolution'

const declarationSource = (): Record<string, any> => ({
  schemaVersion: MOVE_HAZARD_CELL_SELECTION_SCHEMA_VERSION,
  windowId: 'window.hazard.spikes',
  promptKey: 'move.hazard.select-cells',
  map: {
    slug: 'hazard-arena',
    revision: 7,
  },
  move: {
    resolutionId: 'resolution-hazard-1',
    actorPlacementId: 'actor-token',
    canonicalMoveId: 'Spikes',
    operationId: 'operation.hazard.spikes',
    cellSetId: 'cells.hazard.spikes',
  },
  constraints: {
    count: { kind: 'exact', count: 2 },
    origin: { x: 1, y: 0, z: 1 },
    range: 6,
    adjacency: 'including-diagonal',
    connectedness: 'no-isolated',
    occupancy: 'empty-of-placements',
    geometry: { kind: 'horizontal-plane' },
  },
})

const option = (
  declaration: MoveHazardCellSelectionDeclaration,
  cell: { x: number; y: number; z: number },
) => ({
  id: moveHazardCellSelectionOptionId(declaration, cell),
  cell,
})

const windowSource = (): Record<string, any> => {
  const declaration = parseMoveHazardCellSelectionDeclaration(declarationSource())
  return {
    schemaVersion: MOVE_HAZARD_CELL_SELECTION_SCHEMA_VERSION,
    declaration,
    options: [
      option(declaration, { x: 0, y: 0, z: 0 }),
      option(declaration, { x: 1, y: 0, z: 0 }),
      option(declaration, { x: 0, y: 0, z: 1 }),
    ],
  }
}

const expectContractError = (
  run: () => unknown,
  code: MoveHazardCellSelectionValidationError['code'],
): void => {
  expect(run).toThrowError(expect.objectContaining({
    name: 'MoveHazardCellSelectionValidationError',
    code,
  }))
}

describe('move hazard-cell selection contracts', () => {
  it('strictly parses, detaches, and freezes bounded server-authored declarations', () => {
    const source = declarationSource()
    source.constraints.geometry = {
      kind: 'reviewed-cells',
      cells: [
        { x: 3, y: 0, z: 1 },
        { x: 2, y: 0, z: 1 },
      ],
    }

    const parsed = parseMoveHazardCellSelectionDeclaration(source)

    expect(parsed).toEqual(source)
    source.map.slug = 'changed-map'
    source.move.operationId = 'operation.changed'
    source.constraints.origin.x = 99
    source.constraints.geometry.cells[0].x = 99
    expect(parsed.map.slug).toBe('hazard-arena')
    expect(parsed.move.operationId).toBe('operation.hazard.spikes')
    expect(parsed.constraints.origin.x).toBe(1)
    expect(parsed.constraints.geometry.kind === 'reviewed-cells'
      ? parsed.constraints.geometry.cells[0]?.x
      : null).toBe(3)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.constraints)).toBe(true)
    expect(Object.isFrozen(parsed.constraints.geometry)).toBe(true)
  })

  it('rejects unknown fields, unsupported kinds, malformed bounds, and duplicate reviewed cells', () => {
    const unknown = declarationSource()
    unknown.constraints.clientCells = [{ x: 1, y: 0, z: 1 }]
    expectContractError(
      () => parseMoveHazardCellSelectionDeclaration(unknown),
      'invalid-hazard-cell-selection',
    )

    const unsupportedVersion = declarationSource()
    unsupportedVersion.schemaVersion = 2
    expectContractError(
      () => parseMoveHazardCellSelectionDeclaration(unsupportedVersion),
      'unsupported-schema-version',
    )

    const invalidCount = declarationSource()
    invalidCount.constraints.count = { kind: 'exact', count: 0 }
    expectContractError(
      () => parseMoveHazardCellSelectionDeclaration(invalidCount),
      'limit-exceeded',
    )

    const invertedCount = declarationSource()
    invertedCount.constraints.count = { kind: 'up-to', minimum: 4, maximum: 3 }
    expectContractError(
      () => parseMoveHazardCellSelectionDeclaration(invertedCount),
      'inconsistent-window',
    )

    const oversizedRange = declarationSource()
    oversizedRange.constraints.range = MOVE_HAZARD_CELL_SELECTION_LIMITS.range + 1
    expectContractError(
      () => parseMoveHazardCellSelectionDeclaration(oversizedRange),
      'limit-exceeded',
    )

    const oversizedCoordinate = declarationSource()
    oversizedCoordinate.constraints.origin.x = MOVE_HAZARD_CELL_SELECTION_LIMITS.coordinateMagnitude + 1
    expectContractError(
      () => parseMoveHazardCellSelectionDeclaration(oversizedCoordinate),
      'limit-exceeded',
    )

    for (const [field, value] of [
      ['adjacency', 'touching'],
      ['connectedness', 'maybe'],
      ['occupancy', 'client-decides'],
    ]) {
      const invalid = declarationSource()
      invalid.constraints[field] = value
      expectContractError(
        () => parseMoveHazardCellSelectionDeclaration(invalid),
        'unknown-kind',
      )
    }

    const duplicateGeometry = declarationSource()
    duplicateGeometry.constraints.geometry = {
      kind: 'reviewed-cells',
      cells: [{ x: 1, y: 0, z: 2 }, { x: 1, y: 0, z: 2 }],
    }
    expectContractError(
      () => parseMoveHazardCellSelectionDeclaration(duplicateGeometry),
      'duplicate-id',
    )

    const oversizedGeometry = declarationSource()
    oversizedGeometry.constraints.geometry = {
      kind: 'reviewed-cells',
      cells: Array.from(
        { length: MOVE_HAZARD_CELL_SELECTION_LIMITS.geometryCells + 1 },
        (_, x) => ({ x, y: 0, z: 0 }),
      ),
    }
    expectContractError(
      () => parseMoveHazardCellSelectionDeclaration(oversizedGeometry),
      'limit-exceeded',
    )
  })

  it('cross-checks canonical option IDs, cells, order, and minimum window capacity', () => {
    const source = windowSource()
    const parsed = parseMoveHazardCellSelectionWindow(source)

    expect(parsed.options.map(entry => entry.cell)).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ])
    source.options[0].cell.x = 99
    expect(parsed.options[0]?.cell.x).toBe(0)
    expect(Object.isFrozen(parsed.options)).toBe(true)
    expect(Object.isFrozen(parsed.options[0]?.cell)).toBe(true)

    const forged = windowSource()
    forged.options[0].id = 'hazard.cell.forged.0.0.0'
    expectContractError(
      () => parseMoveHazardCellSelectionWindow(forged),
      'inconsistent-window',
    )

    const duplicateId = windowSource()
    duplicateId.options[1].id = duplicateId.options[0].id
    expectContractError(
      () => parseMoveHazardCellSelectionWindow(duplicateId),
      'duplicate-id',
    )

    const duplicateCell = windowSource()
    duplicateCell.options[1] = { ...duplicateCell.options[0] }
    expectContractError(
      () => parseMoveHazardCellSelectionWindow(duplicateCell),
      'duplicate-id',
    )

    const unordered = windowSource()
    unordered.options.reverse()
    expectContractError(
      () => parseMoveHazardCellSelectionWindow(unordered),
      'inconsistent-window',
    )

    const insufficient = windowSource()
    insufficient.options = insufficient.options.slice(0, 1)
    expectContractError(
      () => parseMoveHazardCellSelectionWindow(insufficient),
      'inconsistent-window',
    )
  })

  it('projects a bounded authorized window without private operation or cell-set bindings', () => {
    const window = parseMoveHazardCellSelectionWindow(windowSource())
    const projected = projectMoveHazardCellSelectionPublicWindow(window)
    const roundTrip = parseMoveHazardCellSelectionPublicWindow(structuredClone(projected))

    expect(roundTrip).toEqual({
      schemaVersion: MOVE_HAZARD_CELL_SELECTION_SCHEMA_VERSION,
      windowId: 'window.hazard.spikes',
      promptKey: 'move.hazard.select-cells',
      map: { slug: 'hazard-arena', revision: 7 },
      move: {
        resolutionId: 'resolution-hazard-1',
        actorPlacementId: 'actor-token',
        canonicalMoveId: 'Spikes',
      },
      count: { kind: 'exact', count: 2 },
      origin: { x: 1, y: 0, z: 1 },
      range: 6,
      adjacency: 'including-diagonal',
      connectedness: 'no-isolated',
      occupancy: 'empty-of-placements',
      geometry: { kind: 'horizontal-plane' },
      options: window.options,
    })
    expect('operationId' in roundTrip.move).toBe(false)
    expect('cellSetId' in roundTrip.move).toBe(false)
    expect(Object.isFrozen(roundTrip)).toBe(true)
    expect(Object.isFrozen(roundTrip.options)).toBe(true)
  })
})
