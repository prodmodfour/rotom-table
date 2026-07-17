import {
  createEmptyEncounterState,
  parseEncounterState,
  type EncounterSideId,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import {
  ENCOUNTER_ZONE_LIMITS,
  type EncounterZone,
  type EncounterZoneCell,
  type EncounterZoneOperationSource,
} from '#shared/moveAutomation/encounterZones'
import {
  moveHazardCellSelectionCellKey,
} from '#shared/moveAutomation/hazardCellSelection'
import type {
  MoveAddHazardEffectPayload,
  MoveEffectHazardOwnershipFilter,
  MoveHazardEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveResolutionTraceJsonValue } from '#shared/moveAutomation/trace'
import { sameJsonValue } from '~/utils/serialization'
import type { AuthoritativeMoveRulesContext } from '../context'
import { canonicalBattlefieldZoneComponents } from '../battlefieldZoneDefinitions'
import { battlefieldLayeredZoneId } from '../battlefieldZoneIdentity'
import {
  clearBattlefieldZoneSuppressionSources,
  remapBattlefieldZoneSuppressionSources,
} from '../battlefieldZoneSuppression'
import { resolveMoveHazardGeometryCells } from '../hazardGeometry'
import { failMoveMapOperationReduction } from './mapOperationError'
import type { MoveHazardGeometryResolution } from './mapOperationTypes'

export interface MoveHazardZoneReduction {
  readonly current: EncounterState
  readonly changed: boolean
  readonly details: MoveResolutionTraceJsonValue
}

type LayeredEncounterZone = Extract<EncounterZone, { readonly kind: 'hazard' | 'pledge' }>

const actorSideId = (
  context: AuthoritativeMoveRulesContext,
  operationId: string,
): EncounterSideId => {
  const sideId = context.queries.relationships.resolve(
    context.actor.placement.id,
    context.actor.placement.id,
  ).sourceSideId
  if (!sideId) {
    return failMoveMapOperationReduction(
      'hazard-ownership-invalid',
      `Hazard operation ${operationId} requires the actor to have an explicit encounter side.`,
    )
  }
  return sideId
}

const recipientSideId = (
  context: AuthoritativeMoveRulesContext,
  recipientIds: readonly string[],
  operationId: string,
): EncounterSideId => {
  if (recipientIds.length !== 1) {
    return failMoveMapOperationReduction(
      'hazard-ownership-invalid',
      `Hazard operation ${operationId} requires exactly one authoritative side recipient.`,
    )
  }
  const sideId = context.queries.relationships.resolve(
    context.actor.placement.id,
    recipientIds[0]!,
  ).targetSideId
  if (!sideId) {
    return failMoveMapOperationReduction(
      'hazard-ownership-invalid',
      `Hazard operation ${operationId} requires its recipient to have an explicit encounter side.`,
    )
  }
  return sideId
}

const operationSource = (
  operation: MoveHazardEffectOperation,
  context: AuthoritativeMoveRulesContext,
): EncounterZoneOperationSource => ({
  kind: 'operation',
  operationId: operation.id,
  moveId: operation.source.kind === 'move' ? operation.source.id : null,
  placementId: context.actor.placement.id,
})

const zonePayload = (
  payload: MoveAddHazardEffectPayload,
): LayeredEncounterZone['payload'] => payload.zoneKind === 'hazard'
  ? {
      hazardId: payload.effectId,
      familyId: payload.familyId,
      charges: payload.charges,
      maxCharges: payload.maxCharges,
    }
  : {
      pledgeId: payload.effectId,
      familyId: payload.familyId,
      charges: payload.charges,
      maxCharges: payload.maxCharges,
    }

const zoneFamilyId = (zone: LayeredEncounterZone): string => zone.payload.familyId
const zoneEffectId = (zone: LayeredEncounterZone): string => (
  zone.kind === 'hazard' ? zone.payload.hazardId : zone.payload.pledgeId
)

const sameCellGeometry = (
  zone: EncounterZone,
  cell: EncounterZoneCell,
): boolean => zone.geometry.kind === 'cells'
  && zone.geometry.cells.length === 1
  && moveHazardCellSelectionCellKey(zone.geometry.cells[0]!)
    === moveHazardCellSelectionCellKey(cell)

const parseReducedState = (
  operationId: string,
  previous: EncounterState,
  zones: readonly EncounterZone[],
): EncounterState => {
  if (zones.length > ENCOUNTER_ZONE_LIMITS.count) {
    return failMoveMapOperationReduction(
      'hazard-zone-invalid',
      `Hazard operation ${operationId} would exceed the ${ENCOUNTER_ZONE_LIMITS.count}-zone limit.`,
    )
  }
  try {
    return parseEncounterState({ ...previous, zones })
  }
  catch (error) {
    return failMoveMapOperationReduction(
      'hazard-zone-invalid',
      `Hazard operation ${operationId} produced invalid encounter-zone state.`,
      error,
    )
  }
}

const newZone = (input: {
  readonly operation: MoveHazardEffectOperation
  readonly payload: MoveAddHazardEffectPayload
  readonly context: AuthoritativeMoveRulesContext
  readonly sideId: EncounterSideId | null
  readonly cell: EncounterZoneCell
}): LayeredEncounterZone => {
  const { operation, payload, context, sideId, cell } = input
  const components = canonicalBattlefieldZoneComponents({
    kind: payload.zoneKind,
    effectId: payload.effectId,
  })
  const common = {
    id: battlefieldLayeredZoneId({
      kind: payload.zoneKind,
      familyId: payload.familyId,
      sideId,
      cells: [cell],
    }),
    source: operationSource(operation, context),
    sideId,
    geometry: { kind: 'cells' as const, cells: [cell] },
    layer: payload.layers,
    duration: { kind: 'scene' as const, remaining: null },
    stacking: payload.maxLayers > 1
      ? { kind: 'add-layer' as const, maxLayers: payload.maxLayers }
      : { kind: 'refresh' as const, maxLayers: null },
    hooks: components.hooks,
    modifiers: components.modifiers,
    tags: [...new Set(['move-zone', payload.zoneKind, payload.effectId])],
  }
  return payload.zoneKind === 'hazard'
    ? { ...common, kind: 'hazard', payload: zonePayload(payload) as Extract<LayeredEncounterZone, { kind: 'hazard' }>['payload'] }
    : { ...common, kind: 'pledge', payload: zonePayload(payload) as Extract<LayeredEncounterZone, { kind: 'pledge' }>['payload'] }
}

const validateExistingZone = (
  operation: MoveHazardEffectOperation,
  payload: MoveAddHazardEffectPayload,
  zone: LayeredEncounterZone,
): void => {
  const expectedMaximum = zone.stacking.kind === 'add-layer'
    ? zone.stacking.maxLayers
    : 1
  if (
    zoneEffectId(zone) !== payload.effectId
    || expectedMaximum !== payload.maxLayers
    || zone.payload.maxCharges !== payload.maxCharges
    || (zone.payload.charges === null) !== (payload.charges === null)
  ) {
    failMoveMapOperationReduction(
      'hazard-zone-conflict',
      `Hazard operation ${operation.id} conflicts with existing zone ${zone.id}.`,
    )
  }
}

const reduceAdd = (input: {
  readonly previous: EncounterState
  readonly operation: MoveHazardEffectOperation
  readonly context: AuthoritativeMoveRulesContext
  readonly recipientIds: readonly string[]
  readonly resolutions?: MoveHazardGeometryResolution
}): MoveHazardZoneReduction => {
  const payload = input.operation.payload
  if (payload.action !== 'add') {
    return failMoveMapOperationReduction(
      'hazard-zone-invalid',
      `Hazard operation ${input.operation.id} is not an add operation.`,
    )
  }
  const sideId = payload.ownership === 'neutral'
    ? null
    : actorSideId(input.context, input.operation.id)
  const cells = resolveMoveHazardGeometryCells({
    context: input.context,
    geometry: payload.geometry,
    recipientIds: input.recipientIds,
    resolutions: input.resolutions,
    operationId: input.operation.id,
  })
  const zones = [...input.previous.zones]
  let createdCount = 0
  let updatedCount = 0
  let addedLayers = 0
  let addedCharges = 0

  for (const cell of cells) {
    const matches = zones.flatMap((zone, index) => (
      (zone.kind === payload.zoneKind)
      && zone.sideId === sideId
      && zoneFamilyId(zone) === payload.familyId
      && sameCellGeometry(zone, cell)
        ? [{ zone, index }]
        : []
    ))
    if (matches.length > 1) {
      return failMoveMapOperationReduction(
        'hazard-zone-conflict',
        `Hazard operation ${input.operation.id} found duplicate ${payload.familyId} zones on one cell.`,
      )
    }
    const match = matches[0]
    if (!match) {
      zones.push(newZone({
        operation: input.operation,
        payload,
        context: input.context,
        sideId,
        cell,
      }))
      createdCount += 1
      addedLayers += payload.layers
      addedCharges += payload.charges ?? 0
      continue
    }

    validateExistingZone(input.operation, payload, match.zone)
    const layer = Math.min(payload.maxLayers, match.zone.layer + payload.layers)
    const charges = payload.charges === null || payload.maxCharges === null
      ? null
      : Math.min(payload.maxCharges, (match.zone.payload.charges ?? 0) + payload.charges)
    if (layer === match.zone.layer && charges === match.zone.payload.charges) continue
    zones[match.index] = {
      ...match.zone,
      source: operationSource(input.operation, input.context),
      layer,
      payload: { ...match.zone.payload, charges },
    } as LayeredEncounterZone
    updatedCount += 1
    addedLayers += layer - match.zone.layer
    addedCharges += (charges ?? 0) - (match.zone.payload.charges ?? 0)
  }

  const current = parseReducedState(input.operation.id, input.previous, zones)
  const changed = !sameJsonValue(input.previous, current)
  return {
    current,
    changed,
    details: {
      action: 'add',
      zoneKind: payload.zoneKind,
      familyId: payload.familyId,
      cellCount: cells.length,
      createdCount,
      updatedCount,
      addedLayers,
      addedCharges,
      changed,
    },
  }
}

const zoneMatchesOwnership = (
  zone: LayeredEncounterZone,
  filter: MoveEffectHazardOwnershipFilter,
  sourceSide: EncounterSideId | null,
  recipientSide: EncounterSideId | null,
): boolean => {
  if (filter === 'any') return true
  if (filter === 'neutral') return zone.sideId === null
  if (filter === 'source-side') return zone.sideId === sourceSide
  return zone.sideId === recipientSide
}

const geometryIntersects = (
  zone: LayeredEncounterZone,
  cells: ReadonlySet<string> | null,
): boolean => cells === null || (
  zone.geometry.kind === 'cells'
  && zone.geometry.cells.some(cell => cells.has(moveHazardCellSelectionCellKey(cell)))
)

const reduceRemove = (input: {
  readonly previous: EncounterState
  readonly operation: MoveHazardEffectOperation
  readonly context: AuthoritativeMoveRulesContext
  readonly recipientIds: readonly string[]
  readonly resolutions?: MoveHazardGeometryResolution
}): MoveHazardZoneReduction => {
  const payload = input.operation.payload
  if (payload.action !== 'remove') {
    return failMoveMapOperationReduction(
      'hazard-zone-invalid',
      `Hazard operation ${input.operation.id} is not a remove operation.`,
    )
  }
  const removedZoneIds: string[] = []
  const target = payload.target
  const sourceSide = target.kind === 'matching' && target.ownership === 'source-side'
    ? actorSideId(input.context, input.operation.id)
    : null
  const recipientSide = target.kind === 'matching' && target.ownership === 'recipient-side'
    ? recipientSideId(input.context, input.recipientIds, input.operation.id)
    : null
  const geometryCells = target.kind === 'matching' && target.geometry
    ? new Set(resolveMoveHazardGeometryCells({
        context: input.context,
        geometry: target.geometry,
        recipientIds: input.recipientIds,
        resolutions: input.resolutions,
        operationId: input.operation.id,
      }).map(moveHazardCellSelectionCellKey))
    : null
  const zones = input.previous.zones.filter((zone) => {
    const matches = target.kind === 'zone-id'
      ? zone.id === target.zoneId
      : (zone.kind === 'hazard' || zone.kind === 'pledge')
        && target.zoneKinds.includes(zone.kind)
        && (target.familyId === null || zoneFamilyId(zone) === target.familyId)
        && zoneMatchesOwnership(zone, target.ownership, sourceSide, recipientSide)
        && geometryIntersects(zone, geometryCells)
    if (matches) removedZoneIds.push(zone.id)
    return !matches
  })
  const cleaned = clearBattlefieldZoneSuppressionSources({
    zones,
    removedZoneIds: new Set(removedZoneIds),
  })
  const current = parseReducedState(input.operation.id, input.previous, cleaned.zones)
  const affectedZoneIds = [...removedZoneIds, ...cleaned.clearedZoneIds]
  const changed = affectedZoneIds.length > 0
  return {
    current,
    changed,
    details: {
      action: 'remove',
      targetKind: target.kind,
      removedZoneIds,
      suppressionClearedZoneIds: cleaned.clearedZoneIds,
      affectedZoneIds,
      removedCount: removedZoneIds.length,
      changed,
    },
  }
}

const reduceSwapSides = (input: {
  readonly previous: EncounterState
  readonly operation: MoveHazardEffectOperation
  readonly context: AuthoritativeMoveRulesContext
  readonly recipientIds: readonly string[]
}): MoveHazardZoneReduction => {
  const payload = input.operation.payload
  if (payload.action !== 'swap-sides') {
    return failMoveMapOperationReduction(
      'hazard-zone-invalid',
      `Hazard operation ${input.operation.id} is not a side-swap operation.`,
    )
  }
  const sourceSide = actorSideId(input.context, input.operation.id)
  const targetSide = recipientSideId(input.context, input.recipientIds, input.operation.id)
  if (sourceSide === targetSide) {
    return {
      current: input.previous,
      changed: false,
      details: {
        action: 'swap-sides',
        transitions: [],
        affectedZoneIds: [],
        swappedCount: 0,
        changed: false,
      },
    }
  }
  const transitions: Array<{
    previousZoneId: string
    currentZoneId: string
    previousSideId: EncounterSideId
    currentSideId: EncounterSideId
  }> = []
  const zones = input.previous.zones.map((zone): EncounterZone => {
    if (
      (zone.kind !== 'hazard' && zone.kind !== 'pledge')
      || !payload.zoneKinds.includes(zone.kind)
      || (zone.sideId !== sourceSide && zone.sideId !== targetSide)
      || zone.geometry.kind !== 'cells'
    ) return zone
    const sideId = zone.sideId === sourceSide ? targetSide : sourceSide
    const id = battlefieldLayeredZoneId({
      kind: zone.kind,
      familyId: zoneFamilyId(zone),
      sideId,
      cells: zone.geometry.cells,
    })
    transitions.push({
      previousZoneId: zone.id,
      currentZoneId: id,
      previousSideId: zone.sideId,
      currentSideId: sideId,
    })
    return {
      ...zone,
      id,
      source: operationSource(input.operation, input.context),
      sideId,
    } as LayeredEncounterZone
  })
  const remapped = remapBattlefieldZoneSuppressionSources({
    zones,
    zoneIdRemap: new Map(transitions.map(transition => [
      transition.previousZoneId,
      transition.currentZoneId,
    ])),
  })
  const current = parseReducedState(input.operation.id, input.previous, remapped.zones)
  const affectedZoneIds = [
    ...transitions.map(transition => transition.previousZoneId),
    ...remapped.remappedZoneIds,
  ]
  return {
    current,
    changed: affectedZoneIds.length > 0,
    details: {
      action: 'swap-sides',
      zoneKinds: payload.zoneKinds,
      transitions,
      suppressionRemappedZoneIds: remapped.remappedZoneIds,
      affectedZoneIds,
      swappedCount: transitions.length,
      changed: affectedZoneIds.length > 0,
    },
  }
}

/** Reduce typed move-owned hazards directly into canonical encounter zones. */
export const reduceMoveHazardZones = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly previous?: EncounterState | null
  readonly operation: MoveHazardEffectOperation
  readonly recipientIds: readonly string[]
  readonly resolutions?: MoveHazardGeometryResolution
}): MoveHazardZoneReduction => {
  const previous = parseEncounterState(
    input.previous
      ?? input.context.map.encounterState
      ?? createEmptyEncounterState(),
  )
  const common = { ...input, previous }
  if (input.operation.payload.action === 'add') return reduceAdd(common)
  if (input.operation.payload.action === 'remove') return reduceRemove(common)
  return reduceSwapSides(common)
}
