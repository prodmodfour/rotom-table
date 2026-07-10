import { nextRevision } from '#shared/sessionRevisions'
import type { TabletopMap } from '~/types/map'
import { cloneMapFieldEffects } from '~/utils/mapFieldEffects'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import type { AuthoritativeMoveResolvedSheet } from '../context'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
  unavailableMoveStateCompensation,
  type MoveSheetDocument,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../plan'

export type MoveMapOperationLane = 'moveUsage' | 'hazards' | 'fieldEffects' | 'metadata'

export interface MoveMapOperationTouch {
  readonly order: number
  readonly operationId: string
  readonly reasonCode: string
}

export interface MoveUsageSheetProjection {
  readonly sheet: AuthoritativeMoveResolvedSheet
  readonly previous: MoveSheetDocument
  current: MoveSheetDocument
  readonly touches: MoveMapOperationTouch[]
}

interface OrderedChangeInput {
  readonly firstOrder: number
  readonly laneOrder: number
  readonly tieKey: string
  readonly input: MoveStateChangeInput
}

const touchesForLane = (
  touches: ReadonlyMap<MoveMapOperationLane, readonly MoveMapOperationTouch[]>,
  lane: MoveMapOperationLane,
): readonly MoveMapOperationTouch[] => touches.get(lane) ?? []

const provenance = (
  touches: readonly MoveMapOperationTouch[],
  fallbackReasonCode: string,
): { readonly sourceOperationId: string | null; readonly reasonCode: string } => {
  const unique = [...new Map(touches.map(touch => [touch.operationId, touch])).values()]
  return unique.length === 1
    ? {
        sourceOperationId: unique[0]!.operationId,
        reasonCode: unique[0]!.reasonCode,
      }
    : { sourceOperationId: null, reasonCode: fallbackReasonCode }
}

const firstOrder = (
  touches: readonly MoveMapOperationTouch[],
  fallback: number,
): number => touches.reduce(
  (minimum, touch) => Math.min(minimum, touch.order),
  fallback,
)

/** Aggregate all reducer lanes into one ordered change per physical state slot. */
export const buildMoveMapOperationStateChanges = (options: {
  readonly previousMap: TabletopMap
  readonly workingMap: TabletopMap
  readonly previousRevision: number
  readonly time: number
  readonly laneTouches: ReadonlyMap<MoveMapOperationLane, readonly MoveMapOperationTouch[]>
  readonly sheets: ReadonlyMap<string, MoveUsageSheetProjection>
  readonly implicitLogOrder: number
}): MoveStateChangePlan => {
  const ordered: OrderedChangeInput[] = []
  const mapScope = { kind: 'map' as const, mapSlug: options.previousMap.slug }
  const commonMap = {
    scope: mapScope,
    expectedRevision: options.previousRevision,
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  }

  const previousUsage = options.previousMap.moveUsage
  const currentUsage = options.workingMap.moveUsage
  if (!sameJsonValue(previousUsage, currentUsage)) {
    const touches = touchesForLane(options.laneTouches, 'moveUsage')
    const source = provenance(touches, 'move-usage-operations')
    ordered.push({
      firstOrder: firstOrder(touches, options.implicitLogOrder),
      laneOrder: 0,
      tieKey: options.previousMap.slug,
      input: {
        ...commonMap,
        kind: 'map-move-usage',
        sourceOperationId: source.sourceOperationId,
        reasonCode: source.reasonCode,
        previous: deepCloneJson(previousUsage),
        current: deepCloneJson(currentUsage),
      },
    })
  }

  const previousHazards = deepCloneJson(options.previousMap.hazards ?? [])
  const currentHazards = deepCloneJson(options.workingMap.hazards ?? [])
  if (!sameJsonValue(previousHazards, currentHazards)) {
    const touches = touchesForLane(options.laneTouches, 'hazards')
    const source = provenance(touches, 'hazard-placeholder-operations')
    ordered.push({
      firstOrder: firstOrder(touches, options.implicitLogOrder),
      laneOrder: 1,
      tieKey: options.previousMap.slug,
      input: {
        ...commonMap,
        kind: 'map-hazards',
        sourceOperationId: source.sourceOperationId,
        reasonCode: source.reasonCode,
        previous: previousHazards,
        current: currentHazards,
      },
    })
  }

  const previousFieldEffects = cloneMapFieldEffects(options.previousMap.fieldEffects)
  const currentFieldEffects = cloneMapFieldEffects(options.workingMap.fieldEffects)
  if (!sameJsonValue(previousFieldEffects, currentFieldEffects)) {
    const touches = touchesForLane(options.laneTouches, 'fieldEffects')
    const source = provenance(touches, 'field-placeholder-operations')
    ordered.push({
      firstOrder: firstOrder(touches, options.implicitLogOrder),
      laneOrder: 2,
      tieKey: options.previousMap.slug,
      input: {
        ...commonMap,
        kind: 'map-field-effects',
        sourceOperationId: source.sourceOperationId,
        reasonCode: source.reasonCode,
        previous: previousFieldEffects,
        current: currentFieldEffects,
      },
    })
  }

  if (!sameJsonValue(options.previousMap.metadata, options.workingMap.metadata)) {
    const touches = touchesForLane(options.laneTouches, 'metadata')
    const source = provenance(touches, 'accepted-move-log-projection')
    ordered.push({
      firstOrder: firstOrder(touches, options.implicitLogOrder),
      laneOrder: 3,
      tieKey: options.previousMap.slug,
      input: {
        ...commonMap,
        kind: 'map-metadata',
        sourceOperationId: source.sourceOperationId,
        reasonCode: source.reasonCode,
        previous: deepCloneJson(options.previousMap.metadata),
        current: deepCloneJson(options.workingMap.metadata),
        compensation: unavailableMoveStateCompensation('accepted-log-may-be-observed'),
      },
    })
  }

  for (const [key, projection] of options.sheets) {
    if (sameJsonValue(projection.previous, projection.current)) continue
    const source = provenance(projection.touches, 'move-usage-operations')
    ordered.push({
      firstOrder: firstOrder(projection.touches, options.implicitLogOrder),
      laneOrder: 4,
      tieKey: key,
      input: {
        kind: 'sheet-state',
        scope: {
          kind: 'sheet',
          sheetKind: projection.sheet.kind,
          sheetSlug: projection.sheet.slug,
        },
        expectedRevision: projection.sheet.revision,
        sourceOperationId: source.sourceOperationId,
        reasonCode: source.reasonCode,
        previous: projection.previous,
        current: {
          ...projection.current,
          revision: nextRevision(projection.sheet.revision),
          updatedAt: options.time,
        } as unknown as MoveSheetDocument,
        changedFields: ['moveUsage'],
        compensation: unavailableMoveStateCompensation('field-level-inverse-not-yet-recorded'),
      },
    })
  }

  ordered.sort((left, right) => (
    left.firstOrder - right.firstOrder
    || left.laneOrder - right.laneOrder
    || left.tieKey.localeCompare(right.tieKey)
  ))
  return createMoveStateChangePlan(ordered.map(({ input }) => input))
}
