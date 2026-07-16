import type { MoveHazardGeometry } from '#shared/moveAutomation/effects'
import {
  MOVE_HAZARD_CELL_SELECTION_LIMITS,
  compareMoveHazardCellSelectionCells,
  moveHazardCellSelectionCellKey,
} from '#shared/moveAutomation/hazardCellSelection'
import type { EncounterZoneCell } from '#shared/moveAutomation/encounterZones'
import type { GridAnchor } from '~/types/map'
import { getClearanceValue } from '~/utils/gridGeometry'
import { buildMoveAutomationAreaTemplateCells } from '~/utils/moveAutomationAreaTemplates'
import { buildAllVoxelOccupancy } from '~/utils/voxelOccupancy'
import type { AuthoritativeMoveRulesContext } from './context'
import {
  assertAuthoritativeHazardCellSetPolicy,
  AuthoritativeHazardCellSelectionError,
} from './hazardCellSelection'
import { failMoveMapOperationReduction } from './reducers/mapOperationError'
import type { MoveHazardGeometryResolution } from './reducers/mapOperationTypes'

export const MOVE_HAZARD_ZONE_MAX_CELLS = MOVE_HAZARD_CELL_SELECTION_LIMITS.selectedCells

export interface ResolveMoveHazardGeometryInput {
  readonly context: AuthoritativeMoveRulesContext
  readonly geometry: MoveHazardGeometry
  readonly recipientIds: readonly string[]
  readonly resolutions?: MoveHazardGeometryResolution
  readonly operationId: string
}

const invalidGeometry = (operationId: string, message: string, cause?: unknown): never => (
  failMoveMapOperationReduction(
    'hazard-geometry-invalid',
    `Hazard operation ${operationId} ${message}`,
    cause,
  )
)

const cellInBounds = (
  cell: GridAnchor,
  context: AuthoritativeMoveRulesContext,
): boolean => (
  cell.x >= 0
  && cell.x < context.map.dimensions.x
  && cell.y >= 0
  && cell.y < context.map.dimensions.y
  && cell.z >= 0
  && cell.z < context.map.dimensions.z
)

const canonicalGeometryCells = (
  input: ResolveMoveHazardGeometryInput,
  cells: readonly GridAnchor[],
): readonly EncounterZoneCell[] => {
  if (!Array.isArray(cells) || cells.length > MOVE_HAZARD_ZONE_MAX_CELLS) {
    return invalidGeometry(
      input.operationId,
      `must resolve at most ${MOVE_HAZARD_ZONE_MAX_CELLS} cells.`,
    )
  }
  const seen = new Set<string>()
  const canonical = cells.map((cell): EncounterZoneCell => {
    if (
      !cell
      || !Number.isSafeInteger(cell.x)
      || !Number.isSafeInteger(cell.y)
      || !Number.isSafeInteger(cell.z)
      || !cellInBounds(cell, input.context)
    ) {
      return invalidGeometry(input.operationId, 'resolved an invalid or out-of-bounds cell.')
    }
    const key = moveHazardCellSelectionCellKey(cell)
    if (seen.has(key)) {
      return invalidGeometry(input.operationId, `resolved duplicate cell ${key}.`)
    }
    seen.add(key)
    return { x: cell.x, y: cell.y, z: cell.z }
  }).sort(compareMoveHazardCellSelectionCells)

  try {
    assertAuthoritativeHazardCellSetPolicy(input.geometry, canonical)
  }
  catch (error) {
    if (error instanceof AuthoritativeHazardCellSelectionError) {
      return invalidGeometry(input.operationId, `violates its reviewed cell policy: ${error.message}`, error)
    }
    throw error
  }
  return canonical
}

const tokenCenterCell = (
  token: AuthoritativeMoveRulesContext['actor']['token'],
): GridAnchor => ({
  x: token.position.x + Math.floor((token.base - 1) / 2),
  y: token.position.y + Math.floor((getClearanceValue(token) - 1) / 2),
  z: token.position.z + Math.floor((token.base - 1) / 2),
})

const blastCenter = (input: ResolveMoveHazardGeometryInput): GridAnchor => {
  if (input.geometry.kind !== 'blast') {
    return invalidGeometry(input.operationId, 'does not declare Blast geometry.')
  }
  if (input.geometry.center === 'actor') return tokenCenterCell(input.context.actor.token)
  if (input.recipientIds.length !== 1) {
    return invalidGeometry(
      input.operationId,
      'requires exactly one authoritative recipient for selected-target Blast geometry.',
    )
  }
  const target = input.context.queries.tokens.get(input.recipientIds[0]!)
  if (!target) return invalidGeometry(input.operationId, 'could not resolve its Blast center target.')
  return tokenCenterCell(target)
}

const derivedGeometryCells = (input: ResolveMoveHazardGeometryInput): readonly GridAnchor[] => {
  const blockedCells = buildAllVoxelOccupancy(input.context.map.voxels)
  if (input.geometry.kind === 'blast') {
    return buildMoveAutomationAreaTemplateCells({
      template: {
        kind: 'ranged-blast',
        size: input.geometry.size,
        range: null,
        label: `Hazard Blast ${input.geometry.size}`,
      },
      user: input.context.actor.token,
      center: blastCenter(input),
      bounds: input.context.map.dimensions,
      blockedCells,
    })
  }
  if (input.geometry.kind !== 'line') return []
  const selection = input.context.intent.selection
  if (selection.kind !== 'area' || selection.direction === undefined) {
    return invalidGeometry(input.operationId, 'requires an authoritative area direction for Line geometry.')
  }
  return buildMoveAutomationAreaTemplateCells({
    template: {
      kind: 'line',
      size: input.geometry.length,
      label: `Hazard Line ${input.geometry.length}`,
    },
    user: input.context.actor.token,
    direction: selection.direction,
    bounds: input.context.map.dimensions,
    blockedCells,
  })
}

/** Resolve selection, Blast, or Line declarations without accepting browser-authored cells. */
export const resolveMoveHazardGeometryCells = (
  input: ResolveMoveHazardGeometryInput,
): readonly EncounterZoneCell[] => {
  if (input.geometry.kind === 'selection') {
    const cells = input.resolutions?.cellSets?.get(input.geometry.cellSetId)
    if (!cells) {
      return failMoveMapOperationReduction(
        'hazard-geometry-missing',
        `Hazard operation ${input.operationId} has no authoritative cell set ${input.geometry.cellSetId}.`,
      )
    }
    return canonicalGeometryCells(input, cells)
  }
  return canonicalGeometryCells(input, derivedGeometryCells(input))
}
