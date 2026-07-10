import type { MoveUsageEffectOperation } from '#shared/moveAutomation/effects'
import type { MoveResolutionTraceJsonValue } from '#shared/moveAutomation/trace'
import type { TabletopMap } from '~/types/map'
import type { SheetMoveUsageState } from '~/types/moveUsage'
import { deepCloneJson } from '~/utils/serialization'
import {
  isMoveUsageTransitionError,
  planMoveUsageTransition,
} from '../../planMoveUsageTransition'
import type {
  AuthoritativeMoveResolvedSheet,
  AuthoritativeMoveRulesContext,
  AuthoritativeMoveSheetRead,
} from '../context'
import type { MoveSheetDocument } from '../plan'
import { failMoveMapOperationReduction } from './mapOperationError'
import type {
  MoveMapOperationTouch,
  MoveUsageSheetProjection,
} from './mapOperationPlan'
import type {
  MoveUsageEffectResource,
  MoveUsageOperationProjection,
} from './mapOperationTypes'

export interface ReducedMoveUsageOperation {
  readonly map: TabletopMap
  readonly changed: boolean
  readonly mapChanged: boolean
  readonly sheetChanged: boolean
  readonly projection: MoveUsageOperationProjection
  readonly details: MoveResolutionTraceJsonValue
}

export interface MoveUsageOperationReducer {
  reduce(input: {
    readonly map: TabletopMap
    readonly operation: MoveUsageEffectOperation
    readonly recipientIds: readonly string[]
    readonly touch: MoveMapOperationTouch
  }): ReducedMoveUsageOperation
  sheetProjections(): ReadonlyMap<string, MoveUsageSheetProjection>
  sheetReads(): readonly AuthoritativeMoveSheetRead[]
}

const resourcesById = (
  resources: readonly MoveUsageEffectResource[],
): ReadonlyMap<string, MoveUsageEffectResource> => {
  const byId = new Map<string, MoveUsageEffectResource>()
  for (const resource of resources) {
    if (byId.has(resource.resourceId)) {
      failMoveMapOperationReduction(
        'duplicate-usage-resource',
        `Usage resource ${resource.resourceId} is registered more than once.`,
      )
    }
    byId.set(resource.resourceId, deepCloneJson(resource))
  }
  return byId
}

const authoritativeSheetDocument = (
  resolved: AuthoritativeMoveResolvedSheet,
): MoveSheetDocument => ({
  ...deepCloneJson(resolved.sheet),
  slug: resolved.slug,
  revision: resolved.revision,
}) as MoveSheetDocument

const projectionForSheet = (
  projections: Map<string, MoveUsageSheetProjection>,
  sheet: AuthoritativeMoveResolvedSheet,
): MoveUsageSheetProjection => {
  const key = `${sheet.kind}:${sheet.slug}`
  const existing = projections.get(key)
  if (existing) return existing
  const previous = authoritativeSheetDocument(sheet)
  const projection: MoveUsageSheetProjection = {
    sheet,
    previous,
    current: deepCloneJson(previous),
    touches: [],
  }
  projections.set(key, projection)
  return projection
}

const sheetUsage = (
  projection: MoveUsageSheetProjection,
): SheetMoveUsageState | undefined => projection.current.moveUsage

const applySheetUsage = (
  projection: MoveUsageSheetProjection,
  usage: SheetMoveUsageState | undefined,
): void => {
  const current = deepCloneJson(projection.current) as MoveSheetDocument & {
    moveUsage?: SheetMoveUsageState
  }
  if (usage === undefined) delete current.moveUsage
  else current.moveUsage = deepCloneJson(usage)
  projection.current = current
}

const validateOwner = (
  operation: MoveUsageEffectOperation,
  resource: MoveUsageEffectResource,
  recipientIds: readonly string[],
): void => {
  if (
    recipientIds.length > 0
    && (recipientIds.length !== 1 || recipientIds[0] !== resource.placementId)
  ) {
    failMoveMapOperationReduction(
      'usage-owner-mismatch',
      `Usage operation ${operation.id} recipients do not match owner ${resource.placementId}.`,
    )
  }
}

/** Build one local accumulator for all usage operations in an immediate move. */
export const createMoveUsageOperationReducer = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly resources?: readonly MoveUsageEffectResource[]
}): MoveUsageOperationReducer => {
  const resources = resourcesById(input.resources ?? [])
  const projections = new Map<string, MoveUsageSheetProjection>()
  const reads: AuthoritativeMoveSheetRead[] = []
  const readKeys = new Set<string>()

  const recordRead = (sheet: AuthoritativeMoveResolvedSheet): void => {
    const key = `${sheet.kind}:${sheet.slug}`
    if (readKeys.has(key)) return
    readKeys.add(key)
    reads.push({ kind: sheet.kind, slug: sheet.slug, revision: sheet.revision })
  }

  return Object.freeze({
    reduce: (reductionInput: Parameters<MoveUsageOperationReducer['reduce']>[0]): ReducedMoveUsageOperation => {
      const { map, operation, recipientIds, touch } = reductionInput
      const resource = resources.get(operation.payload.resourceId)
        ?? failMoveMapOperationReduction(
          'usage-resource-missing',
          `Usage operation ${operation.id} references unknown resource ${operation.payload.resourceId}.`,
        )
      validateOwner(operation, resource, recipientIds)
      const placement = input.context.queries.placements.get(resource.placementId)
        ?? failMoveMapOperationReduction(
          'recipient-not-found',
          `Usage owner placement ${resource.placementId} was not found.`,
        )
      const sheet = input.context.queries.sheets.forPlacement(placement)
        ?? failMoveMapOperationReduction(
          'usage-owner-sheet-missing',
          `Usage owner ${resource.placementId} has no authoritative sheet.`,
        )
      recordRead(sheet)
      const sheetProjection = projectionForSheet(projections, sheet)
      const transition = (() => {
        try {
          return planMoveUsageTransition({
            map,
            sheetMoveUsage: sheetUsage(sheetProjection),
            placementId: resource.placementId,
            move: resource.move,
            usedAt: input.context.time,
            change: operation.payload,
          })
        }
        catch (error) {
          if (isMoveUsageTransitionError(error)) {
            return failMoveMapOperationReduction(
              'usage-transition-failed',
              `Usage operation ${operation.id} failed: ${error.message}`,
              error,
            )
          }
          throw error
        }
      })()

      const nextMap = deepCloneJson(map)
      if (transition.mapUsageChanged) {
        const nextUsage = deepCloneJson(transition.nextMapMoveUsage)
        if (nextUsage === undefined) delete nextMap.moveUsage
        else nextMap.moveUsage = nextUsage
      }
      if (transition.sheetUsageChanged) {
        applySheetUsage(sheetProjection, transition.nextSheetMoveUsage)
        sheetProjection.touches.push(touch)
      }
      const changed = transition.mapUsageChanged || transition.sheetUsageChanged
      return {
        map: nextMap,
        changed,
        mapChanged: transition.mapUsageChanged,
        sheetChanged: transition.sheetUsageChanged,
        projection: {
          operationId: operation.id,
          resourceId: operation.payload.resourceId,
          previousUsage: deepCloneJson(transition.previousUsage),
          usage: deepCloneJson(transition.usage),
        },
        details: {
          action: operation.payload.action,
          resourceId: operation.payload.resourceId,
          amount: operation.payload.amount,
          tracking: transition.tracking,
          previousUsage: transition.previousUsage,
          usage: transition.usage,
          mapChanged: transition.mapUsageChanged,
          sheetChanged: transition.sheetUsageChanged,
        } as unknown as MoveResolutionTraceJsonValue,
      }
    },
    sheetProjections: () => new Map(projections),
    sheetReads: () => deepCloneJson(reads),
  })
}
