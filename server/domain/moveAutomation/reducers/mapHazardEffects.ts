import type { MoveHazardEffectOperation } from '#shared/moveAutomation/effects'
import type { MoveResolutionTraceJsonValue } from '#shared/moveAutomation/trace'
import type { GridAnchor, MapHazardV2, TabletopMap } from '~/types/map'
import { isMapHazardKind } from '~/utils/mapHazardDefinitions'
import {
  applyMapHazardPlacement,
  mapHazardKey,
  normalizeMapHazard,
} from '~/utils/mapHazards'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import { failMoveMapOperationReduction } from './mapOperationError'
import type { MoveHazardPlaceholderResolution } from './mapOperationTypes'

export const MOVE_HAZARD_PLACEHOLDER_MAX_CELLS = 128 as const

export interface MoveHazardPlaceholderReduction {
  readonly current: readonly MapHazardV2[]
  readonly changed: boolean
  readonly details: MoveResolutionTraceJsonValue
}

const canonicalCells = (
  operation: MoveHazardEffectOperation,
  cells: readonly GridAnchor[] | undefined,
): readonly GridAnchor[] => {
  if (!cells) {
    return failMoveMapOperationReduction(
      'hazard-placeholder-missing',
      `Hazard operation ${operation.id} has no authoritative cell set ${operation.payload.action === 'add' ? operation.payload.cellSetId : ''}.`,
    )
  }
  if (cells.length > MOVE_HAZARD_PLACEHOLDER_MAX_CELLS) {
    return failMoveMapOperationReduction(
      'hazard-placeholder-invalid',
      `Hazard operation ${operation.id} resolved more than ${MOVE_HAZARD_PLACEHOLDER_MAX_CELLS} cells.`,
    )
  }
  const seen = new Set<string>()
  return cells.map((cell) => {
    if (
      !cell
      || !Number.isSafeInteger(cell.x)
      || !Number.isSafeInteger(cell.y)
      || !Number.isSafeInteger(cell.z)
    ) {
      return failMoveMapOperationReduction(
        'hazard-placeholder-invalid',
        `Hazard operation ${operation.id} resolved an invalid cell.`,
      )
    }
    const key = `${cell.x},${cell.y},${cell.z}`
    if (seen.has(key)) {
      return failMoveMapOperationReduction(
        'hazard-placeholder-invalid',
        `Hazard operation ${operation.id} resolved duplicate cell ${key}.`,
      )
    }
    seen.add(key)
    return { x: cell.x, y: cell.y, z: cell.z }
  })
}

const reduceAdd = (options: {
  readonly map: Pick<TabletopMap, 'dimensions'>
  readonly previous: readonly MapHazardV2[]
  readonly operation: MoveHazardEffectOperation
  readonly placeholders: MoveHazardPlaceholderResolution
}): MoveHazardPlaceholderReduction => {
  const { operation } = options
  if (operation.payload.action !== 'add') {
    return failMoveMapOperationReduction(
      'hazard-placeholder-invalid',
      `Hazard operation ${operation.id} is not an add operation.`,
    )
  }
  if (!isMapHazardKind(operation.payload.hazardKind)) {
    return failMoveMapOperationReduction(
      'hazard-placeholder-invalid',
      `Hazard operation ${operation.id} uses unsupported hazard kind ${operation.payload.hazardKind}.`,
    )
  }
  const cells = canonicalCells(
    operation,
    options.placeholders.cellSets?.get(operation.payload.cellSetId),
  )
  let current = deepCloneJson(options.previous)
  for (const cell of cells) {
    for (let layer = 0; layer < operation.payload.layers; layer += 1) {
      const result = applyMapHazardPlacement({
        hazards: current,
        dimensions: options.map.dimensions,
        hazard: {
          kind: operation.payload.hazardKind,
          ...cell,
          owner: operation.source.id,
        },
      })
      if (!result.ok) {
        return failMoveMapOperationReduction(
          'hazard-placeholder-invalid',
          `Hazard operation ${operation.id} could not apply ${operation.payload.hazardKind}: ${result.message}`,
        )
      }
      current = [...result.hazards]
    }
  }
  const changed = !sameJsonValue(options.previous, current)
  return {
    current,
    changed,
    details: {
      action: operation.payload.action,
      hazardId: operation.payload.hazardId,
      hazardKind: operation.payload.hazardKind,
      cellSetId: operation.payload.cellSetId,
      cellCount: cells.length,
      requestedLayers: operation.payload.layers,
      changed,
    },
  }
}

const canonicalRemovalTargets = (
  operation: MoveHazardEffectOperation,
  placeholders: MoveHazardPlaceholderResolution,
): readonly MapHazardV2[] => {
  if (operation.payload.action !== 'remove') return []
  const source = placeholders.removalTargets?.get(operation.payload.hazardId)
  if (!source) {
    return failMoveMapOperationReduction(
      'hazard-placeholder-missing',
      `Hazard operation ${operation.id} has no authoritative removal target ${operation.payload.hazardId}.`,
    )
  }
  if (source.length > MOVE_HAZARD_PLACEHOLDER_MAX_CELLS) {
    return failMoveMapOperationReduction(
      'hazard-placeholder-invalid',
      `Hazard operation ${operation.id} resolved more than ${MOVE_HAZARD_PLACEHOLDER_MAX_CELLS} removal targets.`,
    )
  }
  const targets: MapHazardV2[] = []
  const seen = new Set<string>()
  for (const value of source) {
    const target = normalizeMapHazard(value)
    if (!target) {
      return failMoveMapOperationReduction(
        'hazard-placeholder-invalid',
        `Hazard operation ${operation.id} resolved an invalid removal target.`,
      )
    }
    const key = `${mapHazardKey(target)}:${target.owner ?? '*'}`
    if (seen.has(key)) {
      return failMoveMapOperationReduction(
        'hazard-placeholder-invalid',
        `Hazard operation ${operation.id} resolved duplicate removal target ${key}.`,
      )
    }
    seen.add(key)
    targets.push(target)
  }
  return targets
}

const reduceRemove = (options: {
  readonly previous: readonly MapHazardV2[]
  readonly operation: MoveHazardEffectOperation
  readonly placeholders: MoveHazardPlaceholderResolution
}): MoveHazardPlaceholderReduction => {
  const targets = canonicalRemovalTargets(options.operation, options.placeholders)
  const current = options.previous.filter(existing => !targets.some(target => (
    mapHazardKey(existing) === mapHazardKey(target)
    && (target.owner === undefined || target.owner === existing.owner)
  ))).map(hazard => deepCloneJson(hazard))
  const changed = !sameJsonValue(options.previous, current)
  return {
    current,
    changed,
    details: {
      action: 'remove',
      hazardId: options.operation.payload.hazardId,
      targetCount: targets.length,
      removedCount: options.previous.length - current.length,
      changed,
    },
  }
}

/**
 * Bridge authoritative cell/instance placeholders into the legacy sparse
 * hazard array. Ownership, entry triggers, zones, and lifecycle stay deferred.
 */
export const reduceMoveHazardPlaceholder = (options: {
  readonly map: Pick<TabletopMap, 'dimensions'>
  readonly previous: readonly MapHazardV2[] | null | undefined
  readonly operation: MoveHazardEffectOperation
  readonly placeholders?: MoveHazardPlaceholderResolution
}): MoveHazardPlaceholderReduction => {
  const previous = deepCloneJson(options.previous ?? [])
  const placeholders = options.placeholders ?? {}
  return options.operation.payload.action === 'add'
    ? reduceAdd({
        map: options.map,
        previous,
        operation: options.operation,
        placeholders,
      })
    : reduceRemove({ previous, operation: options.operation, placeholders })
}
