import { parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { MoveFieldEffectOperation } from '#shared/moveAutomation/effects'
import type { MoveResolutionTraceJsonValue } from '#shared/moveAutomation/trace'
import type { TabletopMap } from '~/types/map'
import { deepCloneJson } from '~/utils/serialization'
import type { AuthoritativeMoveRulesContext } from '../context'
import {
  applyMapGlobalField,
  materializeMapGlobalFieldZones,
  projectGlobalFieldZonesToMapEffects,
  removeMapGlobalFields,
} from '../fieldMapState'
import { reduceMoveBattlefieldZoneMutation } from './mapFieldMutations'
import { failMoveMapOperationReduction } from './mapOperationError'
import type { MoveHazardGeometryResolution } from './mapOperationTypes'

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
 * Reduce reviewed global-field applications or bounded battlefield-zone
 * mutations while retaining legacy field lanes only as renderer projections.
 */
export const reduceMoveGlobalFields = (input: {
  readonly map: TabletopMap
  readonly operation: MoveFieldEffectOperation
  readonly context: AuthoritativeMoveRulesContext
  readonly recipientIds: readonly string[]
  readonly resolutions?: MoveHazardGeometryResolution
}): MoveFieldReduction => {
  const { operation } = input
  if (operation.payload.action === 'mutate') {
    const materialized = materializeMapGlobalFieldZones(input.map)
    const mutation = reduceMoveBattlefieldZoneMutation({
      previous: materialized,
      operation,
      context: input.context,
      recipientIds: input.recipientIds,
      resolutions: input.resolutions,
    })
    const currentEncounterState = parseEncounterState(mutation.current)
    const currentFieldEffects = projectGlobalFieldZonesToMapEffects({
      previous: input.map.fieldEffects,
      state: currentEncounterState,
    })
    return {
      currentMap: {
        ...deepCloneJson(input.map),
        encounterState: deepCloneJson(currentEncounterState),
        fieldEffects: deepCloneJson(currentFieldEffects),
      },
      changed: mutation.changed,
      details: mutation.details,
    }
  }

  const payload = operation.payload
  if (payload.category === 'side') return unsupportedSideField(operation)
  const kind = payload.category
  const common = {
    map: input.map,
    kind,
    fieldId: payload.fieldId,
  } as const
  const reduced = payload.action === 'apply'
    ? applyMapGlobalField({
        ...common,
        source: {
          kind: 'operation',
          operationId: operation.id,
          moveId: operation.source.kind === 'move' ? operation.source.id : null,
          placementId: input.context.actor.placement.id,
        },
        sideId: input.context.actor.placement.sideId ?? null,
        duration: payload.rounds === null
          ? { kind: 'permanent', remaining: null }
          : { kind: 'rounds', boundary: 'end', remaining: payload.rounds },
        replacementGroup: kind === 'weather'
          ? 'field.weather'
          : `field.${kind}.${payload.fieldId}`,
        replacementScope: kind === 'weather' ? 'category' : 'kind',
        startsNextRound: kind === 'room' && payload.fieldId === 'trick',
        sourceLabel: operation.source.id,
      })
    : removeMapGlobalFields({
        map: input.map,
        matches: zone => zone.kind === kind && fieldIdForZone(zone) === payload.fieldId,
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
      fieldId: payload.fieldId,
      changed: reduced.lifecycle.changed,
      transitions,
    },
  }
}

/** @deprecated Use reduceMoveGlobalFields. */
export const reduceMoveFieldPlaceholder = reduceMoveGlobalFields
