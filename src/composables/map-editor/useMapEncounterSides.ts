import { computed, ref, type Ref } from 'vue'
import {
  ENCOUNTER_SIDE_LIMITS,
  createEmptyEncounterState,
  isEncounterSideId,
  parseEncounterState,
  type EncounterSide,
  type EncounterSideId,
  type EncounterSideStatus,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import { slugify } from '#shared/paths'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import { sameJsonValue } from '~/utils/serialization'

interface ReadonlyValueRef<TValue> {
  readonly value: TValue
}

export interface MapEncounterSideCreateInput {
  readonly label: string
  readonly color?: string | null
}

export interface MapEncounterSidePatch {
  readonly label?: string
  readonly color?: string | null
}

export interface MapEncounterSideAssignmentInput {
  readonly placementIds: readonly string[]
  readonly sideId: EncounterSideId | null
}

export interface UseMapEncounterSidesOptions {
  readonly map: Ref<TabletopMap | null>
  readonly isGm: ReadonlyValueRef<boolean>
  readonly setupEditActive: ReadonlyValueRef<boolean>
}

const compareEncounterSides = (left: EncounterSide, right: EncounterSide): number => {
  if (left.status !== right.status) return left.status === 'active' ? -1 : 1
  return left.label.localeCompare(right.label) || left.id.localeCompare(right.id)
}

const boundedSideIdBase = (label: string): EncounterSideId => {
  const normalized = slugify(label) || 'side'
  const bounded = normalized
    .slice(0, ENCOUNTER_SIDE_LIMITS.idChars)
    .replace(/-+$/g, '')
  return bounded || 'side'
}

/** Allocate an immutable map-local ID while allowing display labels to change later. */
export const allocateMapEncounterSideId = (
  label: string,
  usedIds: Iterable<EncounterSideId>,
): EncounterSideId => {
  const used = new Set(usedIds)
  const base = boundedSideIdBase(label)
  if (!used.has(base)) return base

  for (let index = 2; index <= ENCOUNTER_SIDE_LIMITS.count + 1; index += 1) {
    const suffix = `-${index}`
    const stem = base
      .slice(0, ENCOUNTER_SIDE_LIMITS.idChars - suffix.length)
      .replace(/-+$/g, '') || 'side'
    const candidate = `${stem}${suffix}`
    if (!used.has(candidate)) return candidate
  }

  throw new Error('Unable to allocate an encounter side ID within the map side limit.')
}

const sideWithPatch = (side: EncounterSide, patch: MapEncounterSidePatch): EncounterSide => {
  const label = patch.label === undefined ? side.label : patch.label
  const color = patch.color === undefined ? side.color : patch.color ?? undefined
  return {
    id: side.id,
    label,
    ...(color === undefined ? {} : { color }),
    status: side.status,
  }
}

const placementWithSide = (
  placement: SheetPlacement,
  sideId: EncounterSideId | null,
): SheetPlacement => {
  const next = { ...placement }
  if (sideId === null) delete next.sideId
  else next.sideId = sideId
  return next
}

export const useMapEncounterSides = ({
  map,
  isGm,
  setupEditActive,
}: UseMapEncounterSidesOptions) => {
  const encounterSideError = ref<string | null>(null)
  const canEditEncounterSides = computed(() => (
    isGm.value && setupEditActive.value && map.value !== null
  ))
  const encounterSides = computed<readonly EncounterSide[]>(() => (
    Object.values(map.value?.encounterState?.sides ?? {}).sort(compareEncounterSides)
  ))

  const reportError = (error: unknown, fallback: string): void => {
    encounterSideError.value = error instanceof Error && error.message ? error.message : fallback
  }

  const currentEncounterState = (): EncounterState | null => {
    try {
      return parseEncounterState(map.value?.encounterState ?? createEmptyEncounterState())
    } catch (error: unknown) {
      reportError(error, 'The current encounter side directory is invalid.')
      return null
    }
  }

  const replaceSides = (sides: Readonly<Record<EncounterSideId, EncounterSide>>): boolean => {
    const currentMap = map.value
    if (!canEditEncounterSides.value || !currentMap) return false

    const currentState = currentEncounterState()
    if (!currentState) return false

    try {
      const nextState = parseEncounterState({ ...currentState, sides })
      encounterSideError.value = null
      if (!sameJsonValue(currentMap.encounterState, nextState)) currentMap.encounterState = nextState
      return true
    } catch (error: unknown) {
      reportError(error, 'The encounter side change is invalid.')
      return false
    }
  }

  const addEncounterSide = (input: MapEncounterSideCreateInput): EncounterSide | null => {
    if (!canEditEncounterSides.value || !map.value) return null
    const currentState = currentEncounterState()
    if (!currentState) return null

    let id: EncounterSideId
    try {
      id = allocateMapEncounterSideId(input.label, Object.keys(currentState.sides))
    } catch (error: unknown) {
      reportError(error, 'The map cannot contain another encounter side.')
      return null
    }

    const side: EncounterSide = {
      id,
      label: input.label,
      ...(input.color === undefined || input.color === null ? {} : { color: input.color }),
      status: 'active',
    }
    if (!replaceSides({ ...currentState.sides, [id]: side })) return null
    return map.value.encounterState?.sides[id] ?? null
  }

  const updateEncounterSide = (id: EncounterSideId, patch: MapEncounterSidePatch): boolean => {
    if (!canEditEncounterSides.value) return false
    const currentState = currentEncounterState()
    const side = currentState?.sides[id]
    if (!currentState || !side) return false
    return replaceSides({ ...currentState.sides, [id]: sideWithPatch(side, patch) })
  }

  const setEncounterSideStatus = (id: EncounterSideId, status: EncounterSideStatus): boolean => {
    if (!canEditEncounterSides.value) return false
    const currentState = currentEncounterState()
    const side = currentState?.sides[id]
    if (!currentState || !side || (status !== 'active' && status !== 'inactive')) return false
    return replaceSides({ ...currentState.sides, [id]: { ...side, status } })
  }

  const assignPlacementsToEncounterSide = (input: MapEncounterSideAssignmentInput): boolean => {
    const currentMap = map.value
    if (!canEditEncounterSides.value || !currentMap) return false

    const placementIds = [...new Set(input.placementIds)]
    if (placementIds.length === 0) {
      encounterSideError.value = 'Select at least one placement before assigning an encounter side.'
      return false
    }

    const knownPlacementIds = new Set(currentMap.placements.map(placement => placement.id))
    const missingPlacementId = placementIds.find(id => !knownPlacementIds.has(id))
    if (missingPlacementId) {
      encounterSideError.value = `Placement ${missingPlacementId} is no longer on this map.`
      return false
    }

    if (input.sideId !== null) {
      const currentState = currentEncounterState()
      const side = isEncounterSideId(input.sideId) ? currentState?.sides[input.sideId] : undefined
      if (!side || side.status !== 'active') {
        encounterSideError.value = 'Placements can only be assigned to an active encounter side.'
        return false
      }
    }

    const selectedIds = new Set(placementIds)
    const nextPlacements = currentMap.placements.map(placement => (
      selectedIds.has(placement.id) ? placementWithSide(placement, input.sideId) : placement
    ))
    encounterSideError.value = null
    if (!sameJsonValue(currentMap.placements, nextPlacements)) currentMap.placements = nextPlacements
    return true
  }

  const clearEncounterSideError = (): void => {
    encounterSideError.value = null
  }

  return {
    encounterSides,
    encounterSideError,
    canEditEncounterSides,
    addEncounterSide,
    updateEncounterSide,
    setEncounterSideStatus,
    assignPlacementsToEncounterSide,
    clearEncounterSideError,
  }
}
