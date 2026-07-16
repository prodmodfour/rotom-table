import {
  MOVE_HAZARD_CELL_SELECTION_LIMITS,
  MOVE_HAZARD_CELL_SELECTION_SCHEMA_VERSION,
  MoveHazardCellSelectionValidationError,
  compareMoveHazardCellSelectionCells,
  moveHazardCellSelectionCellKey,
  moveHazardCellSelectionOptionId,
  moveHazardCellSelectionResponseId,
  parseMoveHazardCellSelectionDeclaration,
  parseMoveHazardCellSelectionWindow,
  projectMoveHazardCellSelectionPublicWindow,
  type MoveHazardCellSelectionAdjacency,
  type MoveHazardCellSelectionCount,
  type MoveHazardCellSelectionDeclaration,
  type MoveHazardCellSelectionOption,
  type MoveHazardCellSelectionPublicWindow,
  type MoveHazardCellSelectionWindow,
} from '#shared/moveAutomation/hazardCellSelection'
import { normalizeRevision } from '#shared/sessionRevisions'
import type { GridAnchor, GridDimensions, TabletopMap } from '~/types/map'
import { ptuGridVectorDistance } from '~/utils/ptuGridDistance'

export const AUTHORITATIVE_HAZARD_CELL_SELECTION_LIMITS = Object.freeze({
  candidateCells: 4_096,
  options: MOVE_HAZARD_CELL_SELECTION_LIMITS.options,
})

export type AuthoritativeHazardCellSelectionErrorCode =
  | 'hazard-cell-declaration-invalid'
  | 'hazard-cell-window-invalid'
  | 'hazard-cell-map-invalid'
  | 'hazard-cell-map-mismatch'
  | 'hazard-cell-window-stale'
  | 'hazard-cell-origin-out-of-bounds'
  | 'hazard-cell-candidate-limit'
  | 'hazard-cell-option-limit'
  | 'hazard-cell-insufficient-options'
  | 'hazard-cell-selection-invalid'
  | 'hazard-cell-selection-limit'
  | 'hazard-cell-selection-duplicate'
  | 'hazard-cell-option-unknown'
  | 'hazard-cell-out-of-bounds'
  | 'hazard-cell-out-of-range'
  | 'hazard-cell-occupied'
  | 'hazard-cell-outside-geometry'
  | 'hazard-cell-isolated'
  | 'hazard-cell-disconnected'

export class AuthoritativeHazardCellSelectionError extends Error {
  readonly code: AuthoritativeHazardCellSelectionErrorCode

  constructor(code: AuthoritativeHazardCellSelectionErrorCode, message: string) {
    super(message)
    this.name = 'AuthoritativeHazardCellSelectionError'
    this.code = code
  }
}

export interface MaterializedAuthoritativeHazardCellSelection {
  readonly window: MoveHazardCellSelectionWindow
  readonly publicWindow: MoveHazardCellSelectionPublicWindow
}

export interface ValidateAuthoritativeHazardCellSelectionInput {
  readonly map: TabletopMap
  readonly window: MoveHazardCellSelectionWindow
  /** Mechanics-free response material. Coordinates and constraints remain in `window`. */
  readonly selectedOptionIds: unknown
}

export interface ValidatedAuthoritativeHazardCellSelection {
  readonly resolutionId: string
  readonly windowId: string
  readonly operationId: string
  readonly cellSetId: string
  /** Stable audit identity for the complete canonical option set. */
  readonly selectionId: string
  /** Canonical map order, independent of client option-ID order. */
  readonly optionIds: readonly string[]
  readonly cells: readonly GridAnchor[]
}

const STABLE_OPTION_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/

const fail = (
  code: AuthoritativeHazardCellSelectionErrorCode,
  message: string,
): never => {
  throw new AuthoritativeHazardCellSelectionError(code, message)
}

const validDimensions = (value: GridDimensions): boolean => (
  typeof value === 'object'
  && value !== null
  && Number.isSafeInteger(value.x)
  && Number.isSafeInteger(value.y)
  && Number.isSafeInteger(value.z)
  && value.x > 0
  && value.y > 0
  && value.z > 0
  && value.x <= MOVE_HAZARD_CELL_SELECTION_LIMITS.coordinateMagnitude
  && value.y <= MOVE_HAZARD_CELL_SELECTION_LIMITS.coordinateMagnitude
  && value.z <= MOVE_HAZARD_CELL_SELECTION_LIMITS.coordinateMagnitude
)

const validCell = (value: unknown): value is GridAnchor => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const cell = value as Record<string, unknown>
  return Number.isSafeInteger(cell.x)
    && Number.isSafeInteger(cell.y)
    && Number.isSafeInteger(cell.z)
}

const cellInBounds = (cell: GridAnchor, dimensions: GridDimensions): boolean => (
  cell.x >= 0
  && cell.x < dimensions.x
  && cell.y >= 0
  && cell.y < dimensions.y
  && cell.z >= 0
  && cell.z < dimensions.z
)

const cellWithinRange = (
  cell: GridAnchor,
  declaration: MoveHazardCellSelectionDeclaration,
): boolean => ptuGridVectorDistance({
  x: cell.x - declaration.constraints.origin.x,
  y: cell.y - declaration.constraints.origin.y,
  z: cell.z - declaration.constraints.origin.z,
}) <= declaration.constraints.range

const reviewedGeometryKeys = (
  declaration: MoveHazardCellSelectionDeclaration,
): ReadonlySet<string> | null => declaration.constraints.geometry.kind === 'reviewed-cells'
  ? new Set(declaration.constraints.geometry.cells.map(moveHazardCellSelectionCellKey))
  : null

const cellMatchesGeometry = (
  cell: GridAnchor,
  declaration: MoveHazardCellSelectionDeclaration,
  reviewedKeys = reviewedGeometryKeys(declaration),
): boolean => declaration.constraints.geometry.kind === 'horizontal-plane'
  ? cell.y === declaration.constraints.origin.y
  : reviewedKeys?.has(moveHazardCellSelectionCellKey(cell)) === true

const occupiedPlacementCells = (map: TabletopMap): ReadonlySet<string> => new Set(
  map.placements.map(placement => moveHazardCellSelectionCellKey(placement.position)),
)

const cellPassesOccupancy = (
  cell: GridAnchor,
  declaration: MoveHazardCellSelectionDeclaration,
  occupied: ReadonlySet<string>,
): boolean => declaration.constraints.occupancy === 'allow-occupied'
  || !occupied.has(moveHazardCellSelectionCellKey(cell))

const minimumCount = (count: MoveHazardCellSelectionCount): number => (
  count.kind === 'exact' ? count.count : count.minimum
)

const maximumCount = (count: MoveHazardCellSelectionCount): number => (
  count.kind === 'exact' ? count.count : count.maximum
)

const parseDeclaration = (value: unknown): MoveHazardCellSelectionDeclaration => {
  try {
    return parseMoveHazardCellSelectionDeclaration(value)
  }
  catch (error) {
    if (error instanceof MoveHazardCellSelectionValidationError) {
      return fail(
        'hazard-cell-declaration-invalid',
        `Hazard-cell declaration is invalid (${error.message}).`,
      )
    }
    throw error
  }
}

const parseWindow = (value: unknown): MoveHazardCellSelectionWindow => {
  try {
    return parseMoveHazardCellSelectionWindow(value)
  }
  catch (error) {
    if (error instanceof MoveHazardCellSelectionValidationError) {
      return fail(
        'hazard-cell-window-invalid',
        `Hazard-cell window is invalid (${error.message}).`,
      )
    }
    throw error
  }
}

const assertMapSnapshot = (
  map: TabletopMap,
  declaration: MoveHazardCellSelectionDeclaration,
  options: { readonly requireRevision: boolean },
): void => {
  if (!validDimensions(map.dimensions) || !Array.isArray(map.placements)) {
    fail('hazard-cell-map-invalid', 'Hazard-cell selection requires valid authoritative map dimensions and placements.')
  }
  if (map.slug !== declaration.map.slug) {
    fail('hazard-cell-map-mismatch', 'Hazard-cell declaration belongs to a different authoritative map.')
  }
  if (
    options.requireRevision
    && normalizeRevision(map.revision) !== declaration.map.revision
  ) {
    fail('hazard-cell-window-stale', 'Hazard-cell window map revision is stale.')
  }
  const placementIds = new Set<string>()
  for (const placement of map.placements) {
    if (
      typeof placement.id !== 'string'
      || placement.id.length === 0
      || placementIds.has(placement.id)
      || !validCell(placement.position)
      || !cellInBounds(placement.position, map.dimensions)
    ) {
      fail('hazard-cell-map-invalid', 'Hazard-cell selection found an invalid or duplicate map placement.')
    }
    placementIds.add(placement.id)
  }
  if (!placementIds.has(declaration.move.actorPlacementId)) {
    fail('hazard-cell-map-invalid', 'Hazard-cell move actor is not present exactly once on the authoritative map.')
  }
  if (!cellInBounds(declaration.constraints.origin, map.dimensions)) {
    fail('hazard-cell-origin-out-of-bounds', 'Hazard-cell selection origin is outside authoritative map bounds.')
  }
}

const horizontalPlaneCandidates = (
  map: TabletopMap,
  declaration: MoveHazardCellSelectionDeclaration,
): readonly GridAnchor[] => {
  const { origin, range } = declaration.constraints
  const minimumX = Math.max(0, origin.x - range)
  const maximumX = Math.min(map.dimensions.x - 1, origin.x + range)
  const minimumZ = Math.max(0, origin.z - range)
  const maximumZ = Math.min(map.dimensions.z - 1, origin.z + range)
  const candidateCount = (maximumX - minimumX + 1) * (maximumZ - minimumZ + 1)
  if (candidateCount > AUTHORITATIVE_HAZARD_CELL_SELECTION_LIMITS.candidateCells) {
    return fail(
      'hazard-cell-candidate-limit',
      `Hazard-cell declaration would inspect ${candidateCount} cells; at most ${AUTHORITATIVE_HAZARD_CELL_SELECTION_LIMITS.candidateCells} are allowed.`,
    )
  }
  const cells: GridAnchor[] = []
  for (let z = minimumZ; z <= maximumZ; z += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      cells.push({ x, y: origin.y, z })
    }
  }
  return cells
}

const candidateCells = (
  map: TabletopMap,
  declaration: MoveHazardCellSelectionDeclaration,
): readonly GridAnchor[] => {
  if (declaration.constraints.geometry.kind === 'horizontal-plane') {
    return horizontalPlaneCandidates(map, declaration)
  }
  if (
    declaration.constraints.geometry.cells.length
    > AUTHORITATIVE_HAZARD_CELL_SELECTION_LIMITS.candidateCells
  ) {
    return fail(
      'hazard-cell-candidate-limit',
      `Hazard-cell reviewed geometry exceeds ${AUTHORITATIVE_HAZARD_CELL_SELECTION_LIMITS.candidateCells} cells.`,
    )
  }
  return declaration.constraints.geometry.cells.map(cell => ({ ...cell }))
}

const materializedCells = (
  map: TabletopMap,
  declaration: MoveHazardCellSelectionDeclaration,
): readonly GridAnchor[] => {
  const occupied = occupiedPlacementCells(map)
  const reviewedKeys = reviewedGeometryKeys(declaration)
  const byCell = new Map<string, GridAnchor>()
  for (const candidate of candidateCells(map, declaration)) {
    if (
      !cellInBounds(candidate, map.dimensions)
      || !cellWithinRange(candidate, declaration)
      || !cellMatchesGeometry(candidate, declaration, reviewedKeys)
      || !cellPassesOccupancy(candidate, declaration, occupied)
    ) continue
    const cell = { x: candidate.x, y: candidate.y, z: candidate.z }
    byCell.set(moveHazardCellSelectionCellKey(cell), cell)
  }
  const cells = [...byCell.values()].sort(compareMoveHazardCellSelectionCells)
  if (cells.length > AUTHORITATIVE_HAZARD_CELL_SELECTION_LIMITS.options) {
    return fail(
      'hazard-cell-option-limit',
      `Hazard-cell declaration resolved ${cells.length} options; at most ${AUTHORITATIVE_HAZARD_CELL_SELECTION_LIMITS.options} are allowed.`,
    )
  }
  if (cells.length < minimumCount(declaration.constraints.count)) {
    return fail(
      'hazard-cell-insufficient-options',
      'Hazard-cell declaration has fewer legal cells than its minimum selection count.',
    )
  }
  return cells
}

/**
 * Materialize one immutable server-issued option set. No map, declaration, or
 * move state is mutated and no response payload contributes mechanics.
 */
export const materializeAuthoritativeHazardCellSelection = (input: {
  readonly map: TabletopMap
  readonly declaration: MoveHazardCellSelectionDeclaration
}): MaterializedAuthoritativeHazardCellSelection => {
  const declaration = parseDeclaration(input.declaration)
  assertMapSnapshot(input.map, declaration, { requireRevision: true })
  const options = materializedCells(input.map, declaration).map((cell): MoveHazardCellSelectionOption => ({
    id: moveHazardCellSelectionOptionId(declaration, cell),
    cell,
  }))
  const window = parseWindow({
    schemaVersion: MOVE_HAZARD_CELL_SELECTION_SCHEMA_VERSION,
    declaration,
    options,
  })
  return Object.freeze({
    window,
    publicWindow: projectMoveHazardCellSelectionPublicWindow(window),
  })
}

const parseSelectedOptionIds = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) {
    return fail('hazard-cell-selection-invalid', 'Hazard-cell selected option IDs must be an array.')
  }
  if (value.length > MOVE_HAZARD_CELL_SELECTION_LIMITS.selectedCells) {
    return fail(
      'hazard-cell-selection-limit',
      `Hazard-cell response may select at most ${MOVE_HAZARD_CELL_SELECTION_LIMITS.selectedCells} options.`,
    )
  }
  const ids = value.map((candidate) => {
    if (
      typeof candidate !== 'string'
      || candidate.length === 0
      || candidate.length > MOVE_HAZARD_CELL_SELECTION_LIMITS.identifierChars
      || candidate.trim() !== candidate
      || !STABLE_OPTION_ID_PATTERN.test(candidate)
    ) {
      return fail(
        'hazard-cell-selection-invalid',
        'Hazard-cell response option IDs must be bounded stable identifiers.',
      )
    }
    return candidate
  })
  if (new Set(ids).size !== ids.length) {
    return fail('hazard-cell-selection-duplicate', 'Hazard-cell response contains a duplicate option ID.')
  }
  return ids
}

const assertSelectionCount = (
  count: MoveHazardCellSelectionCount,
  selected: number,
): void => {
  if (count.kind === 'exact' && selected !== count.count) {
    fail(
      'hazard-cell-selection-limit',
      `Hazard-cell response must select exactly ${count.count} cells.`,
    )
  }
  if (count.kind === 'up-to' && (selected < count.minimum || selected > count.maximum)) {
    fail(
      'hazard-cell-selection-limit',
      `Hazard-cell response must select ${count.minimum} through ${count.maximum} cells.`,
    )
  }
}

const cellsAreAdjacent = (
  left: GridAnchor,
  right: GridAnchor,
  adjacency: MoveHazardCellSelectionAdjacency,
): boolean => {
  const deltas = [
    Math.abs(left.x - right.x),
    Math.abs(left.y - right.y),
    Math.abs(left.z - right.z),
  ]
  if (deltas.every(delta => delta === 0) || deltas.some(delta => delta > 1)) return false
  return adjacency === 'including-diagonal'
    ? true
    : deltas.reduce((total, delta) => total + delta, 0) === 1
}

const assertConnectedness = (
  declaration: MoveHazardCellSelectionDeclaration,
  cells: readonly GridAnchor[],
): void => {
  const { connectedness, adjacency } = declaration.constraints
  if (connectedness === 'none' || cells.length === 0) return
  if (connectedness === 'no-isolated') {
    if (cells.some((cell, index) => !cells.some((other, otherIndex) => (
      index !== otherIndex && cellsAreAdjacent(cell, other, adjacency)
    )))) {
      fail(
        'hazard-cell-isolated',
        'Every selected hazard cell must be adjacent to at least one other selected cell.',
      )
    }
    return
  }
  const visited = new Set<number>([0])
  const pending = [0]
  while (pending.length > 0) {
    const index = pending.shift()!
    for (let otherIndex = 0; otherIndex < cells.length; otherIndex += 1) {
      if (
        visited.has(otherIndex)
        || !cellsAreAdjacent(cells[index]!, cells[otherIndex]!, adjacency)
      ) continue
      visited.add(otherIndex)
      pending.push(otherIndex)
    }
  }
  if (visited.size !== cells.length) {
    fail('hazard-cell-disconnected', 'Selected hazard cells must form one connected set.')
  }
}

const resolveSelectedOptions = (
  selectionWindow: MoveHazardCellSelectionWindow,
  selectedOptionIds: readonly string[],
): readonly MoveHazardCellSelectionOption[] => {
  const selected = new Set(selectedOptionIds)
  for (const optionId of selected) {
    if (!selectionWindow.options.some(option => option.id === optionId)) {
      fail('hazard-cell-option-unknown', 'Hazard-cell response contains a forged or unknown option ID.')
    }
  }
  return selectionWindow.options.filter(option => selected.has(option.id))
}

const assertSelectedCellsRemainLegal = (
  map: TabletopMap,
  declaration: MoveHazardCellSelectionDeclaration,
  options: readonly MoveHazardCellSelectionOption[],
): void => {
  const occupied = occupiedPlacementCells(map)
  const reviewedKeys = reviewedGeometryKeys(declaration)
  for (const option of options) {
    if (!cellInBounds(option.cell, map.dimensions)) {
      fail('hazard-cell-out-of-bounds', 'A selected hazard cell is outside current authoritative map bounds.')
    }
    if (!cellWithinRange(option.cell, declaration)) {
      fail('hazard-cell-out-of-range', 'A selected hazard cell is outside the reviewed authoritative range.')
    }
    if (!cellMatchesGeometry(option.cell, declaration, reviewedKeys)) {
      fail('hazard-cell-outside-geometry', 'A selected hazard cell is outside the reviewed authoritative geometry.')
    }
    if (!cellPassesOccupancy(option.cell, declaration, occupied)) {
      fail('hazard-cell-occupied', 'A selected hazard cell is occupied by an authoritative placement.')
    }
  }
}

/**
 * Resolve only stored server-issued IDs, then recheck the complete selection
 * against a fresh immutable map snapshot. The returned cells are canonical and
 * cannot be influenced by response ordering or client-authored coordinates.
 */
export const validateAuthoritativeHazardCellSelection = (
  input: ValidateAuthoritativeHazardCellSelectionInput,
): ValidatedAuthoritativeHazardCellSelection => {
  const selectionWindow = parseWindow(input.window)
  const declaration = selectionWindow.declaration
  assertMapSnapshot(input.map, declaration, { requireRevision: true })
  const selectedOptionIds = parseSelectedOptionIds(input.selectedOptionIds)
  assertSelectionCount(declaration.constraints.count, selectedOptionIds.length)
  const selected = resolveSelectedOptions(selectionWindow, selectedOptionIds)
  assertSelectedCellsRemainLegal(input.map, declaration, selected)
  const cells = selected.map(option => ({ ...option.cell }))
  assertConnectedness(declaration, cells)
  const optionIds = Object.freeze(selected.map(option => option.id))
  return Object.freeze({
    resolutionId: declaration.move.resolutionId,
    windowId: declaration.windowId,
    operationId: declaration.move.operationId,
    cellSetId: declaration.move.cellSetId,
    selectionId: moveHazardCellSelectionResponseId(declaration.windowId, optionIds),
    optionIds,
    cells: Object.freeze(cells.map(cell => Object.freeze(cell))),
  })
}

/** Exposed for focused invariants and future geometry implementations. */
export const authoritativeHazardCellSelectionCountBounds = (
  count: MoveHazardCellSelectionCount,
): Readonly<{ minimum: number; maximum: number }> => Object.freeze({
  minimum: minimumCount(count),
  maximum: maximumCount(count),
})
