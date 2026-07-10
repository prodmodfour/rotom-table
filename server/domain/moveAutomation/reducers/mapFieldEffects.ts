import type { MoveFieldEffectOperation } from '#shared/moveAutomation/effects'
import type { MoveResolutionTraceJsonValue } from '#shared/moveAutomation/trace'
import type {
  MapFieldEffects,
  MapRoomEffect,
  MapTerrainEffect,
  MapWeatherEffect,
} from '~/types/map'
import {
  isMapRoomKind,
  isMapTerrainKind,
  isMapWeatherKind,
} from '~/utils/mapFieldEffectDefinitions'
import { cloneMapFieldEffects } from '~/utils/mapFieldEffects'
import { sameJsonValue } from '~/utils/serialization'
import { failMoveMapOperationReduction } from './mapOperationError'

export interface MoveFieldPlaceholderReduction {
  readonly current: MapFieldEffects
  readonly changed: boolean
  readonly details: MoveResolutionTraceJsonValue
}

const unsupportedSideField = (operation: MoveFieldEffectOperation): never => (
  failMoveMapOperationReduction(
    'field-placeholder-unsupported',
    `Field operation ${operation.id} targets side state, which remains blocked until typed encounter fields are available.`,
  )
)

const invalidField = (operation: MoveFieldEffectOperation): never => (
  failMoveMapOperationReduction(
    'field-placeholder-invalid',
    `Field operation ${operation.id} uses unsupported ${operation.payload.category} field ${operation.payload.fieldId}.`,
  )
)

const applyWeather = (
  current: Required<MapFieldEffects>,
  operation: MoveFieldEffectOperation,
): void => {
  if (!isMapWeatherKind(operation.payload.fieldId)) return invalidField(operation)
  const effect: MapWeatherEffect = {
    kind: operation.payload.fieldId,
    rounds: operation.payload.action === 'apply' ? operation.payload.rounds : null,
    source: operation.source.id,
  }
  current.weather = [effect]
}

const applyTerrain = (
  current: Required<MapFieldEffects>,
  operation: MoveFieldEffectOperation,
): void => {
  if (!isMapTerrainKind(operation.payload.fieldId)) return invalidField(operation)
  const effect: MapTerrainEffect = {
    kind: operation.payload.fieldId,
    scope: 'field',
    rounds: operation.payload.action === 'apply' ? operation.payload.rounds : null,
    source: operation.source.id,
  }
  current.terrains = [
    ...current.terrains.filter(item => item.kind !== effect.kind),
    effect,
  ]
}

const applyRoom = (
  current: Required<MapFieldEffects>,
  operation: MoveFieldEffectOperation,
): void => {
  if (!isMapRoomKind(operation.payload.fieldId)) return invalidField(operation)
  const effect: MapRoomEffect = {
    kind: operation.payload.fieldId,
    rounds: operation.payload.action === 'apply' ? operation.payload.rounds : null,
    ...(operation.payload.fieldId === 'trick' ? { startsNextRound: true } : {}),
    source: operation.source.id,
  }
  current.rooms = [
    ...current.rooms.filter(item => item.kind !== effect.kind),
    effect,
  ]
}

const applyField = (
  current: Required<MapFieldEffects>,
  operation: MoveFieldEffectOperation,
): void => {
  if (operation.payload.category === 'side') return unsupportedSideField(operation)
  if (operation.payload.category === 'weather') return applyWeather(current, operation)
  if (operation.payload.category === 'terrain') return applyTerrain(current, operation)
  return applyRoom(current, operation)
}

const removeField = (
  current: Required<MapFieldEffects>,
  operation: MoveFieldEffectOperation,
): void => {
  if (operation.payload.category === 'side') return unsupportedSideField(operation)
  if (operation.payload.category === 'weather') {
    if (!isMapWeatherKind(operation.payload.fieldId)) return invalidField(operation)
    current.weather = current.weather.filter(item => item.kind !== operation.payload.fieldId)
    return
  }
  if (operation.payload.category === 'terrain') {
    if (!isMapTerrainKind(operation.payload.fieldId)) return invalidField(operation)
    current.terrains = current.terrains.filter(item => item.kind !== operation.payload.fieldId)
    return
  }
  if (!isMapRoomKind(operation.payload.fieldId)) return invalidField(operation)
  current.rooms = current.rooms.filter(item => item.kind !== operation.payload.fieldId)
}

/**
 * Bridge v2 field operations into the current bounded map arrays. This owns
 * only apply/remove placeholders; lifecycle, side ownership, stacking, and
 * suppression remain blocked for the typed field tickets in Phase 6.
 */
export const reduceMoveFieldPlaceholder = (
  previous: MapFieldEffects | null | undefined,
  operation: MoveFieldEffectOperation,
): MoveFieldPlaceholderReduction => {
  const before = cloneMapFieldEffects(previous)
  const current = cloneMapFieldEffects(previous)
  if (operation.payload.action === 'apply') applyField(current, operation)
  else removeField(current, operation)
  const changed = !sameJsonValue(before, current)
  return {
    current,
    changed,
    details: {
      action: operation.payload.action,
      category: operation.payload.category,
      fieldId: operation.payload.fieldId,
      changed,
    },
  }
}
