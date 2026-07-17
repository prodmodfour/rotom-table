import {
  parseEncounterState,
  type EncounterSideId,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import {
  isEncounterGlobalFieldZone,
  isEncounterGlobalFieldZoneActive,
  type EncounterZone,
  type EncounterZoneOperationSource,
} from '#shared/moveAutomation/encounterZones'
import type {
  MoveBattlefieldZoneFilter,
  MoveBattlefieldZoneMutation,
  MoveEffectBattlefieldZoneSideFilter,
  MoveEffectBattlefieldZoneSideReference,
  MoveFieldEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveResolutionTraceJsonValue } from '#shared/moveAutomation/trace'
import { moveHazardCellSelectionCellKey } from '#shared/moveAutomation/hazardCellSelection'
import { sameJsonValue } from '~/utils/serialization'
import { battlefieldLayeredZoneId } from '../battlefieldZoneIdentity'
import {
  clearBattlefieldZoneSuppressionSources,
  remapBattlefieldZoneSuppressionSources,
} from '../battlefieldZoneSuppression'
import type { AuthoritativeMoveRulesContext } from '../context'
import { resolveMoveHazardGeometryCells } from '../hazardGeometry'
import { failMoveMapOperationReduction } from './mapOperationError'
import type { MoveHazardGeometryResolution } from './mapOperationTypes'

export interface MoveBattlefieldZoneMutationReduction {
  readonly current: EncounterState
  readonly changed: boolean
  readonly details: MoveResolutionTraceJsonValue
}

interface ZoneIdentityTransition {
  readonly previousZoneId: string
  readonly currentZoneId: string
  readonly previousSideId: EncounterSideId | null
  readonly currentSideId: EncounterSideId | null
}

const operationSource = (
  operation: MoveFieldEffectOperation,
  context: AuthoritativeMoveRulesContext,
): EncounterZoneOperationSource => ({
  kind: 'operation',
  operationId: operation.id,
  moveId: operation.source.kind === 'move' ? operation.source.id : null,
  placementId: context.actor.placement.id,
})

const invalidMutation = (
  operation: MoveFieldEffectOperation,
  message: string,
  cause?: unknown,
): never => failMoveMapOperationReduction(
  'field-zone-invalid',
  `Field operation ${operation.id} ${message}`,
  cause,
)

const mutationForOperation = (
  operation: MoveFieldEffectOperation,
): MoveBattlefieldZoneMutation => operation.payload.action === 'mutate'
  ? operation.payload.mutation
  : invalidMutation(operation, 'is not a battlefield mutation.')

const parseReducedState = (
  operation: MoveFieldEffectOperation,
  previous: EncounterState,
  zones: readonly EncounterZone[],
): EncounterState => {
  try {
    return parseEncounterState({ ...previous, zones })
  }
  catch (error) {
    return invalidMutation(operation, 'produced invalid battlefield-zone state.', error)
  }
}

const sourceSide = (
  operation: MoveFieldEffectOperation,
  context: AuthoritativeMoveRulesContext,
): EncounterSideId => {
  const sideId = context.queries.relationships.resolve(
    context.actor.placement.id,
    context.actor.placement.id,
  ).sourceSideId
  if (!sideId) return invalidMutation(operation, 'requires an explicit actor side.')
  return sideId
}

const recipientSide = (
  operation: MoveFieldEffectOperation,
  context: AuthoritativeMoveRulesContext,
  recipientIds: readonly string[],
): EncounterSideId => {
  if (recipientIds.length !== 1) {
    return invalidMutation(operation, 'requires exactly one authoritative side recipient.')
  }
  const sideId = context.queries.relationships.resolve(
    context.actor.placement.id,
    recipientIds[0]!,
  ).targetSideId
  if (!sideId) return invalidMutation(operation, 'requires its recipient to have an explicit side.')
  return sideId
}

const otherSide = (
  operation: MoveFieldEffectOperation,
  context: AuthoritativeMoveRulesContext,
  previous: EncounterState,
): EncounterSideId => {
  const actorSide = sourceSide(operation, context)
  const candidates = Object.values(previous.sides)
    .filter(side => side.status === 'active' && side.id !== actorSide)
    .map(side => side.id)
    .sort((left, right) => left.localeCompare(right))
  if (candidates.length !== 1) {
    return invalidMutation(
      operation,
      'requires exactly one other active encounter side when no recipient side is selected.',
    )
  }
  return candidates[0]!
}

const resolveSideReference = (input: {
  readonly reference: MoveEffectBattlefieldZoneSideReference
  readonly operation: MoveFieldEffectOperation
  readonly context: AuthoritativeMoveRulesContext
  readonly previous: EncounterState
  readonly recipientIds: readonly string[]
}): EncounterSideId => {
  if (input.reference === 'source-side') return sourceSide(input.operation, input.context)
  if (input.reference === 'recipient-side') {
    return recipientSide(input.operation, input.context, input.recipientIds)
  }
  return otherSide(input.operation, input.context, input.previous)
}

const resolveFilterSide = (input: {
  readonly filter: MoveEffectBattlefieldZoneSideFilter
  readonly operation: MoveFieldEffectOperation
  readonly context: AuthoritativeMoveRulesContext
  readonly previous: EncounterState
  readonly recipientIds: readonly string[]
}): EncounterSideId | null | undefined => {
  if (input.filter === 'any') return undefined
  if (input.filter === 'neutral') return null
  return resolveSideReference({
    reference: input.filter,
    operation: input.operation,
    context: input.context,
    previous: input.previous,
    recipientIds: input.recipientIds,
  })
}

const sourceMatches = (
  zone: EncounterZone,
  filter: MoveBattlefieldZoneFilter['source'],
  actorPlacementId: string,
  recipientIds: ReadonlySet<string>,
): boolean => {
  if (filter === 'any') return true
  if (zone.source.kind !== 'operation' || zone.source.placementId === null) return false
  if (filter === 'actor') return zone.source.placementId === actorPlacementId
  return recipientIds.has(zone.source.placementId)
}

const geometryIntersects = (
  zone: EncounterZone,
  cells: ReadonlySet<string> | null,
): boolean => cells === null || (
  zone.geometry.kind === 'cells'
  && zone.geometry.cells.some(cell => cells.has(moveHazardCellSelectionCellKey(cell)))
)

const matchingZoneIds = (input: {
  readonly filter: MoveBattlefieldZoneFilter
  readonly operation: MoveFieldEffectOperation
  readonly context: AuthoritativeMoveRulesContext
  readonly previous: EncounterState
  readonly recipientIds: readonly string[]
  readonly resolutions?: MoveHazardGeometryResolution
}): ReadonlySet<string> => {
  const sideId = resolveFilterSide({
    filter: input.filter.side,
    operation: input.operation,
    context: input.context,
    previous: input.previous,
    recipientIds: input.recipientIds,
  })
  const cells = input.filter.geometry === null
    ? null
    : new Set(resolveMoveHazardGeometryCells({
        context: input.context,
        geometry: input.filter.geometry,
        recipientIds: input.recipientIds,
        resolutions: input.resolutions,
        operationId: input.operation.id,
      }).map(moveHazardCellSelectionCellKey))
  const recipients = new Set(input.recipientIds)
  return new Set(input.previous.zones.filter(zone => (
    input.filter.zoneKinds.includes(zone.kind)
    && (sideId === undefined || zone.sideId === sideId)
    && sourceMatches(
      zone,
      input.filter.source,
      input.context.actor.placement.id,
      recipients,
    )
    && input.filter.requiredTags.every(tag => zone.tags.includes(tag))
    && geometryIntersects(zone, cells)
  )).map(zone => zone.id))
}

const removedResult = (input: {
  readonly previous: EncounterState
  readonly operation: MoveFieldEffectOperation
  readonly primaryZoneIds: ReadonlySet<string>
  readonly mutationKind: 'remove' | 'destroy' | 'clear-side' | 'consume-terrain'
  readonly extraDetails?: Readonly<Record<string, MoveResolutionTraceJsonValue>>
}): MoveBattlefieldZoneMutationReduction => {
  const retained = input.previous.zones.filter(zone => !input.primaryZoneIds.has(zone.id))
  const cleaned = clearBattlefieldZoneSuppressionSources({
    zones: retained,
    removedZoneIds: input.primaryZoneIds,
  })
  const current = parseReducedState(input.operation, input.previous, cleaned.zones)
  const primaryZoneIds = input.previous.zones
    .filter(zone => input.primaryZoneIds.has(zone.id))
    .map(zone => zone.id)
  const affectedZoneIds = [...primaryZoneIds, ...cleaned.clearedZoneIds]
  return {
    current,
    changed: affectedZoneIds.length > 0,
    details: {
      action: 'mutate',
      mutationKind: input.mutationKind,
      primaryZoneIds,
      suppressionClearedZoneIds: cleaned.clearedZoneIds,
      affectedZoneIds,
      changed: affectedZoneIds.length > 0,
      ...(input.extraDetails ?? {}),
    },
  }
}

const zoneWithSide = (input: {
  readonly zone: EncounterZone
  readonly sideId: EncounterSideId
  readonly source: EncounterZoneOperationSource
}): EncounterZone => {
  const id = (
    (input.zone.kind === 'hazard' || input.zone.kind === 'pledge')
    && input.zone.geometry.kind === 'cells'
  )
    ? battlefieldLayeredZoneId({
        kind: input.zone.kind,
        familyId: input.zone.payload.familyId,
        sideId: input.sideId,
        cells: input.zone.geometry.cells,
      })
    : input.zone.id
  return {
    ...input.zone,
    id,
    source: input.source,
    sideId: input.sideId,
    ...(input.zone.geometry.kind === 'side'
      ? { geometry: { ...input.zone.geometry, sideId: input.sideId } }
      : {}),
  } as EncounterZone
}

const changedSidesResult = (input: {
  readonly previous: EncounterState
  readonly operation: MoveFieldEffectOperation
  readonly operationContext: AuthoritativeMoveRulesContext
  readonly sideForZone: (zone: EncounterZone) => EncounterSideId | null
  readonly mutationKind: 'transfer-side' | 'swap-sides'
}): MoveBattlefieldZoneMutationReduction => {
  const source = operationSource(input.operation, input.operationContext)
  const transitions: ZoneIdentityTransition[] = []
  const zoneIdRemap = new Map<string, string>()
  const changed = input.previous.zones.map((zone): EncounterZone => {
    const sideId = input.sideForZone(zone)
    if (sideId === null || sideId === zone.sideId) return zone
    const current = zoneWithSide({ zone, sideId, source })
    transitions.push({
      previousZoneId: zone.id,
      currentZoneId: current.id,
      previousSideId: zone.sideId,
      currentSideId: sideId,
    })
    if (current.id !== zone.id) zoneIdRemap.set(zone.id, current.id)
    return current
  })
  const remapped = remapBattlefieldZoneSuppressionSources({ zones: changed, zoneIdRemap })
  const current = parseReducedState(input.operation, input.previous, remapped.zones)
  const affectedZoneIds = [
    ...transitions.map(transition => transition.previousZoneId),
    ...remapped.remappedZoneIds,
  ]
  return {
    current,
    changed: affectedZoneIds.length > 0,
    details: {
      action: 'mutate',
      mutationKind: input.mutationKind,
      transitions: transitions.map(transition => ({
        previousZoneId: transition.previousZoneId,
        currentZoneId: transition.currentZoneId,
        previousSideId: transition.previousSideId,
        currentSideId: transition.currentSideId,
      })),
      suppressionRemappedZoneIds: remapped.remappedZoneIds,
      affectedZoneIds,
      changed: affectedZoneIds.length > 0,
    },
  }
}

const reduceRemoval = (input: MutationInput): MoveBattlefieldZoneMutationReduction => {
  const mutation = mutationForOperation(input.operation)
  if (
    mutation.kind !== 'remove'
    && mutation.kind !== 'destroy'
    && mutation.kind !== 'clear-side'
  ) return invalidMutation(input.operation, `cannot reduce ${mutation.kind} as removal.`)
  const targetIds = matchingZoneIds({ ...input, filter: mutation.target })
  return removedResult({
    previous: input.previous,
    operation: input.operation,
    primaryZoneIds: targetIds,
    mutationKind: mutation.kind,
  })
}

interface MutationInput {
  readonly previous: EncounterState
  readonly operation: MoveFieldEffectOperation
  readonly context: AuthoritativeMoveRulesContext
  readonly recipientIds: readonly string[]
  readonly resolutions?: MoveHazardGeometryResolution
}

const reduceTransfer = (input: MutationInput): MoveBattlefieldZoneMutationReduction => {
  const mutation = mutationForOperation(input.operation)
  if (mutation.kind !== 'transfer-side') {
    return invalidMutation(input.operation, `cannot reduce ${mutation.kind} as side transfer.`)
  }
  const targetIds = matchingZoneIds({ ...input, filter: mutation.target })
  const destinationSide = resolveSideReference({
    reference: mutation.destinationSide,
    operation: input.operation,
    context: input.context,
    previous: input.previous,
    recipientIds: input.recipientIds,
  })
  return changedSidesResult({
    previous: input.previous,
    operation: input.operation,
    operationContext: input.context,
    mutationKind: mutation.kind,
    sideForZone: zone => targetIds.has(zone.id) ? destinationSide : null,
  })
}

const reduceSwap = (input: MutationInput): MoveBattlefieldZoneMutationReduction => {
  const mutation = mutationForOperation(input.operation)
  if (mutation.kind !== 'swap-sides') {
    return invalidMutation(input.operation, `cannot reduce ${mutation.kind} as side swap.`)
  }
  const actorSideId = sourceSide(input.operation, input.context)
  const counterpartSideId = resolveSideReference({
    reference: mutation.counterpartSide,
    operation: input.operation,
    context: input.context,
    previous: input.previous,
    recipientIds: input.recipientIds,
  })
  if (actorSideId === counterpartSideId) {
    return {
      current: input.previous,
      changed: false,
      details: {
        action: 'mutate',
        mutationKind: mutation.kind,
        transitions: [],
        suppressionRemappedZoneIds: [],
        affectedZoneIds: [],
        changed: false,
      },
    }
  }
  return changedSidesResult({
    previous: input.previous,
    operation: input.operation,
    operationContext: input.context,
    mutationKind: mutation.kind,
    sideForZone: (zone) => {
      if (
        !mutation.zoneKinds.includes(zone.kind)
        || !mutation.requiredTags.every(tag => zone.tags.includes(tag))
      ) return null
      if (zone.sideId === actorSideId) return counterpartSideId
      if (zone.sideId === counterpartSideId) return actorSideId
      return null
    },
  })
}

const reduceSuppression = (input: MutationInput): MoveBattlefieldZoneMutationReduction => {
  const mutation = mutationForOperation(input.operation)
  if (mutation.kind !== 'suppress') {
    return invalidMutation(input.operation, `cannot reduce ${mutation.kind} as suppression.`)
  }
  if (!input.previous.zones.some(zone => zone.id === mutation.sourceZoneId)) {
    return invalidMutation(input.operation, `references missing suppression source ${mutation.sourceZoneId}.`)
  }
  const targetIds = matchingZoneIds({ ...input, filter: mutation.target })
  if (targetIds.has(mutation.sourceZoneId)) {
    return invalidMutation(input.operation, 'cannot suppress a field with itself.')
  }
  const matchedZoneIds: string[] = []
  const affectedZoneIds: string[] = []
  const zones = input.previous.zones.map((zone): EncounterZone => {
    if (!targetIds.has(zone.id)) return zone
    if (!isEncounterGlobalFieldZone(zone)) {
      return invalidMutation(input.operation, `matched non-global suppression target ${zone.id}.`)
    }
    matchedZoneIds.push(zone.id)
    if (zone.fieldPolicy.suppression.sources.some(source => source.zoneId === mutation.sourceZoneId)) {
      return zone
    }
    affectedZoneIds.push(zone.id)
    return {
      ...zone,
      fieldPolicy: {
        ...zone.fieldPolicy,
        suppression: {
          sources: [
            ...zone.fieldPolicy.suppression.sources,
            { zoneId: mutation.sourceZoneId, reasonCode: input.operation.reasonCode },
          ],
        },
      },
    }
  })
  const current = parseReducedState(input.operation, input.previous, zones)
  return {
    current,
    changed: affectedZoneIds.length > 0,
    details: {
      action: 'mutate',
      mutationKind: mutation.kind,
      sourceZoneId: mutation.sourceZoneId,
      matchedZoneIds,
      affectedZoneIds,
      changed: affectedZoneIds.length > 0,
    },
  }
}

const reduceTerrainConsumption = (
  input: MutationInput,
): MoveBattlefieldZoneMutationReduction => {
  const mutation = mutationForOperation(input.operation)
  if (mutation.kind !== 'consume-terrain') {
    return invalidMutation(input.operation, `cannot reduce ${mutation.kind} as terrain consumption.`)
  }
  const cells = new Set(resolveMoveHazardGeometryCells({
    context: input.context,
    geometry: mutation.geometry,
    recipientIds: input.recipientIds,
    resolutions: input.resolutions,
    operationId: input.operation.id,
  }).map(moveHazardCellSelectionCellKey))
  const targetIds = new Set(input.previous.zones.filter((zone) => {
    if (zone.kind !== 'terrain') return false
    if (isEncounterGlobalFieldZone(zone)) {
      return mutation.includeGlobal && isEncounterGlobalFieldZoneActive(zone)
    }
    return geometryIntersects(zone, cells)
  }).map(zone => zone.id))
  return removedResult({
    previous: input.previous,
    operation: input.operation,
    primaryZoneIds: targetIds,
    mutationKind: mutation.kind,
    extraDetails: {
      includeGlobal: mutation.includeGlobal,
      areaCellCount: cells.size,
    },
  })
}

/** Reduce one strictly parsed field mutation into detached canonical zone state. */
export const reduceMoveBattlefieldZoneMutation = (input: {
  readonly previous: EncounterState
  readonly operation: MoveFieldEffectOperation
  readonly context: AuthoritativeMoveRulesContext
  readonly recipientIds: readonly string[]
  readonly resolutions?: MoveHazardGeometryResolution
}): MoveBattlefieldZoneMutationReduction => {
  const previous = parseEncounterState(input.previous)
  if (input.operation.payload.action !== 'mutate') {
    return invalidMutation(input.operation, 'does not contain a battlefield mutation.')
  }
  const common: MutationInput = { ...input, previous }
  const kind = input.operation.payload.mutation.kind
  const result = kind === 'remove' || kind === 'destroy' || kind === 'clear-side'
    ? reduceRemoval(common)
    : kind === 'transfer-side'
      ? reduceTransfer(common)
      : kind === 'swap-sides'
        ? reduceSwap(common)
        : kind === 'suppress'
          ? reduceSuppression(common)
          : reduceTerrainConsumption(common)
  if (sameJsonValue(previous, result.current) !== !result.changed) {
    return invalidMutation(input.operation, 'reported an inconsistent mutation result.')
  }
  return result
}
