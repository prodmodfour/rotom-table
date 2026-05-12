import { computed, ref, type Ref } from 'vue'
import { textValueFromEvent } from '~/utils/domEvents'
import {
  MAP_ROOM_DEFINITIONS,
  MAP_ROOM_KINDS,
  MAP_TERRAIN_DEFINITIONS,
  MAP_TERRAIN_KINDS,
  MAP_WEATHER_DEFINITIONS,
  MAP_WEATHER_KINDS,
} from '~/utils/mapFieldEffectDefinitions'
import {
  createMapRoomEffect,
  createMapTerrainEffect,
  createMapWeatherEffect,
  mapFieldEffectCount,
} from '~/utils/mapFieldEffects'
import type { MoveAutomationTransaction } from '~/types/moveAutomation'
import type {
  MapFieldEffects,
  MapRoomKind,
  MapTerrainKind,
  MapWeatherKind,
  TabletopMap,
} from '~/types/map'

interface BooleanRef {
  readonly value: boolean
}

export interface UseFieldEffectsEditorOptions {
  map: Ref<TabletopMap | null>
  canEditMap: BooleanRef
  confirmClearAll?: () => boolean
}

export const durationLabel = (rounds: number | null | undefined): string =>
  rounds === null || rounds === undefined ? '' : `${rounds}`

export const parseRoundInputValue = (value: unknown): number | null => {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.floor(n))
}

const parseRoundInput = (event: Event): number | null =>
  parseRoundInputValue(textValueFromEvent(event))

export const useFieldEffectsEditor = ({
  map,
  canEditMap,
  confirmClearAll,
}: UseFieldEffectsEditorOptions) => {
  const weatherCoexistNext = ref(false)

  const mapFieldEffects = computed<MapFieldEffects>(() => ({
    weather: map.value?.fieldEffects?.weather ?? [],
    terrains: map.value?.fieldEffects?.terrains ?? [],
    rooms: map.value?.fieldEffects?.rooms ?? [],
  }))
  const activeWeatherEffects = computed(() => mapFieldEffects.value.weather ?? [])
  const activeTerrainEffects = computed(() => mapFieldEffects.value.terrains ?? [])
  const activeRoomEffects = computed(() => mapFieldEffects.value.rooms ?? [])
  const fieldEffectCount = computed(() => mapFieldEffectCount(mapFieldEffects.value))

  const weatherPalette = MAP_WEATHER_KINDS.map((kind) => MAP_WEATHER_DEFINITIONS[kind])
  const terrainPalette = MAP_TERRAIN_KINDS.map((kind) => MAP_TERRAIN_DEFINITIONS[kind])
  const roomPalette = MAP_ROOM_KINDS.map((kind) => MAP_ROOM_DEFINITIONS[kind])

  const ensureFieldEffectsState = (): Required<MapFieldEffects> | null => {
    if (!map.value || !canEditMap.value) return null
    if (!map.value.fieldEffects || typeof map.value.fieldEffects !== 'object') {
      map.value.fieldEffects = { weather: [], terrains: [], rooms: [] }
    }
    const state = map.value.fieldEffects
    if (!Array.isArray(state.weather)) state.weather = []
    if (!Array.isArray(state.terrains)) state.terrains = []
    if (!Array.isArray(state.rooms)) state.rooms = []
    return state as Required<MapFieldEffects>
  }

  const weatherDefinition = (kind: MapWeatherKind) => MAP_WEATHER_DEFINITIONS[kind]
  const terrainDefinition = (kind: MapTerrainKind) => MAP_TERRAIN_DEFINITIONS[kind]
  const roomDefinition = (kind: MapRoomKind) => MAP_ROOM_DEFINITIONS[kind]

  const weatherIsActive = (kind: MapWeatherKind) =>
    activeWeatherEffects.value.some((effect) => effect.kind === kind)

  const terrainIsActive = (kind: MapTerrainKind) =>
    activeTerrainEffects.value.some((effect) => effect.kind === kind)

  const roomIsActive = (kind: MapRoomKind) =>
    activeRoomEffects.value.some((effect) => effect.kind === kind)

  const setWeather = (kind: MapWeatherKind) => {
    const state = ensureFieldEffectsState()
    if (!state) return
    const effect = createMapWeatherEffect(kind)
    if (weatherCoexistNext.value && state.weather.length > 0) {
      const next = state.weather.filter((item) => item.kind !== kind)
      next.push(effect)
      state.weather = next.slice(-2)
      weatherCoexistNext.value = false
      return
    }
    state.weather = [effect]
  }

  const removeWeather = (kind: MapWeatherKind) => {
    const state = ensureFieldEffectsState()
    if (!state) return
    state.weather = state.weather.filter((effect) => effect.kind !== kind)
    if (!state.weather.length) weatherCoexistNext.value = false
  }

  const clearWeather = () => {
    const state = ensureFieldEffectsState()
    if (!state) return
    state.weather = []
    weatherCoexistNext.value = false
  }

  const toggleTerrain = (kind: MapTerrainKind) => {
    const state = ensureFieldEffectsState()
    if (!state) return
    if (state.terrains.some((effect) => effect.kind === kind)) {
      state.terrains = state.terrains.filter((effect) => effect.kind !== kind)
    } else {
      state.terrains = [...state.terrains, createMapTerrainEffect(kind)]
    }
  }

  const removeTerrain = (kind: MapTerrainKind) => {
    const state = ensureFieldEffectsState()
    if (!state) return
    state.terrains = state.terrains.filter((effect) => effect.kind !== kind)
  }

  const toggleRoom = (kind: MapRoomKind) => {
    const state = ensureFieldEffectsState()
    if (!state) return
    if (state.rooms.some((effect) => effect.kind === kind)) {
      state.rooms = state.rooms.filter((effect) => effect.kind !== kind)
    } else {
      state.rooms = [...state.rooms, createMapRoomEffect(kind)]
    }
  }

  const removeRoom = (kind: MapRoomKind) => {
    const state = ensureFieldEffectsState()
    if (!state) return
    state.rooms = state.rooms.filter((effect) => effect.kind !== kind)
  }

  const setWeatherRounds = (kind: MapWeatherKind, event: Event) => {
    const state = ensureFieldEffectsState()
    if (!state) return
    const effect = state.weather.find((item) => item.kind === kind)
    if (!effect) return
    effect.rounds = parseRoundInput(event)
    if (effect.rounds === 0) removeWeather(kind)
  }

  const setTerrainRounds = (kind: MapTerrainKind, event: Event) => {
    const state = ensureFieldEffectsState()
    if (!state) return
    const effect = state.terrains.find((item) => item.kind === kind)
    if (!effect) return
    effect.rounds = parseRoundInput(event)
    if (effect.rounds === 0) removeTerrain(kind)
  }

  const setRoomRounds = (kind: MapRoomKind, event: Event) => {
    const state = ensureFieldEffectsState()
    if (!state) return
    const effect = state.rooms.find((item) => item.kind === kind)
    if (!effect) return
    effect.rounds = parseRoundInput(event)
    if (effect.rounds === 0) removeRoom(kind)
  }

  const tickFieldEffectDurations = () => {
    const state = ensureFieldEffectsState()
    if (!state) return
    const tick = <T extends { rounds?: number | null }>(effects: T[]): T[] =>
      effects
        .map((effect) => {
          if (effect.rounds === null || effect.rounds === undefined) return effect
          return { ...effect, rounds: Math.max(0, effect.rounds - 1) }
        })
        .filter((effect) => effect.rounds === null || effect.rounds === undefined || effect.rounds > 0)
    state.weather = tick(state.weather)
    state.terrains = tick(state.terrains)
    state.rooms = tick(state.rooms)
    if (!state.weather.length) weatherCoexistNext.value = false
  }

  const clearAllFieldEffects = () => {
    const state = ensureFieldEffectsState()
    if (!state || fieldEffectCount.value === 0) return
    const ok = confirmClearAll
      ? confirmClearAll()
      : typeof window === 'undefined' || window.confirm('Clear all active Weather, Terrain, and Room effects?')
    if (!ok) return
    state.weather = []
    state.terrains = []
    state.rooms = []
    weatherCoexistNext.value = false
  }

  const applyMoveFieldEffect = (effect: MoveAutomationTransaction['fieldEffectsToApply'][number]) => {
    if (!canEditMap.value) return
    const state = ensureFieldEffectsState()
    if (!state) return
    const source = effect.source ?? 'Move automation'
    if (effect.kind === 'weather' && MAP_WEATHER_KINDS.includes(effect.value as MapWeatherKind)) {
      const weather = createMapWeatherEffect(effect.value as MapWeatherKind)
      weather.source = source
      state.weather = [weather]
      return
    }
    if (effect.kind === 'terrain' && MAP_TERRAIN_KINDS.includes(effect.value as MapTerrainKind)) {
      const terrain = createMapTerrainEffect(effect.value as MapTerrainKind)
      terrain.source = source
      state.terrains = [...state.terrains.filter((item) => item.kind !== terrain.kind), terrain]
      return
    }
    if (effect.kind === 'room' && MAP_ROOM_KINDS.includes(effect.value as MapRoomKind)) {
      const room = createMapRoomEffect(effect.value as MapRoomKind)
      room.source = source
      state.rooms = [...state.rooms.filter((item) => item.kind !== room.kind), room]
    }
  }

  return {
    weatherCoexistNext,
    mapFieldEffects,
    activeWeatherEffects,
    activeTerrainEffects,
    activeRoomEffects,
    fieldEffectCount,
    weatherPalette,
    terrainPalette,
    roomPalette,
    ensureFieldEffectsState,
    weatherDefinition,
    terrainDefinition,
    roomDefinition,
    weatherIsActive,
    terrainIsActive,
    roomIsActive,
    setWeather,
    removeWeather,
    clearWeather,
    toggleTerrain,
    removeTerrain,
    toggleRoom,
    removeRoom,
    setWeatherRounds,
    setTerrainRounds,
    setRoomRounds,
    durationLabel,
    tickFieldEffectDurations,
    clearAllFieldEffects,
    applyMoveFieldEffect,
  }
}
