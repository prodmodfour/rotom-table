import type { MoveFieldEffectOperation } from '#shared/moveAutomation/effects'
import type { MoveResolutionTraceJsonValue } from '#shared/moveAutomation/trace'
import type { TabletopMap } from '~/types/map'
import type { AuthoritativeMoveRulesContext } from '../context'
import {
  applyMapGlobalField,
  removeMapGlobalFields,
} from '../fieldMapState'
import { failMoveMapOperationReduction } from './mapOperationError'

export interface MoveFieldReduction {
  readonly currentMap: TabletopMap
  readonly changed: boolean
  readonly details: MoveResolutionTraceJsonValue
}

const unsupportedSideField = (operation: MoveFieldEffectOperation): never => (
  failMoveMapOperationReduction(
    'field-placeholder-unsupported',
    `Field operation ${operation.id} targets side state, which remains blocked until typed side fields are available.`,
  )
)

const fieldIdForZone = (
  zone: Parameters<Parameters<typeof removeMapGlobalFields>[0]['matches']>[0],
): string => {
  if (zone.kind === 'weather') return zone.payload.weatherId
  if (zone.kind === 'terrain') return zone.payload.terrainId
  return zone.payload.roomId
}

/**
 * Reduce a reviewed global-field operation into native encounter state while
 * retaining the legacy map lane only as a renderer/editor projection.
 */
export const reduceMoveGlobalFields = (input: {
  readonly map: TabletopMap
  readonly operation: MoveFieldEffectOperation
  readonly context: AuthoritativeMoveRulesContext
}): MoveFieldReduction => {
  const { operation } = input
  if (operation.payload.category === 'side') return unsupportedSideField(operation)
  const kind = operation.payload.category
  const common = {
    map: input.map,
    kind,
    fieldId: operation.payload.fieldId,
  } as const
  const reduced = operation.payload.action === 'apply'
    ? applyMapGlobalField({
        ...common,
        source: {
          kind: 'operation',
          operationId: operation.id,
          moveId: operation.source.kind === 'move' ? operation.source.id : null,
          placementId: input.context.actor.placement.id,
        },
        sideId: input.context.actor.placement.sideId ?? null,
        duration: operation.payload.rounds === null
          ? { kind: 'permanent', remaining: null }
          : { kind: 'rounds', boundary: 'end', remaining: operation.payload.rounds },
        replacementGroup: kind === 'weather'
          ? 'field.weather'
          : `field.${kind}.${operation.payload.fieldId}`,
        replacementScope: kind === 'weather' ? 'category' : 'kind',
        startsNextRound: kind === 'room' && operation.payload.fieldId === 'trick',
        sourceLabel: operation.source.id,
      })
    : removeMapGlobalFields({
        map: input.map,
        matches: zone => zone.kind === kind && fieldIdForZone(zone) === operation.payload.fieldId,
      })
  const transitions = reduced.lifecycle.transitions.map(transition => ({
    zoneId: transition.zoneId,
    kind: transition.kind,
    reasonCode: transition.reasonCode,
    replacedZoneIds: [...transition.replacedZoneIds],
  }))

  return {
    currentMap: reduced.map,
    changed: reduced.lifecycle.changed,
    details: {
      action: operation.payload.action,
      category: kind,
      fieldId: operation.payload.fieldId,
      changed: reduced.lifecycle.changed,
      transitions,
    },
  }
}

/** @deprecated Use reduceMoveGlobalFields. */
export const reduceMoveFieldPlaceholder = reduceMoveGlobalFields
