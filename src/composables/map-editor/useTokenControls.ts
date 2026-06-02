import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { canPlacePokemon, findFirstAvailablePosition } from '~/utils/gridPlacement'
import type { PreviewState } from '~/utils/gridPreview'
import { buildMapOccupancy } from '~/utils/mapOccupancy'
import { appendMovementLogEntry, sameGridAnchor } from '~/utils/mapMovementLog'
import { pokedexEntryPathForSpecies } from '~/utils/pokedex/routes'
import { toPokedexSlug as normalizePokedexSlug } from '~/utils/pokedex/searchText'
import {
  createPlacementId as defaultCreatePlacementId,
  placementsToSpawned,
  type SheetLookup,
} from '~/utils/placement'
import {
  catalogEntryForPokemonSheet,
  catalogEntryForTrainerSheet,
} from '~/utils/sheetSpawn'
import { sheetEditorPath } from '~/utils/sheetRoutes'
import {
  buildTokenSendOutOptionsByPlacementId,
  isSendOutPositionWithinThrowRange,
  POKEBALL_THROW_RANGE_SQUARES,
} from '~/utils/mapTokenSendOut'
import {
  DEFAULT_TOKEN_FACING_DIRECTION,
  nextTokenFacingForPlacement,
  setTokenFacingOnPlacement,
  tokenFacingForPlacement,
  tokenFacingTowardPoint,
} from '~/utils/tokenFacing'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GridAnchor, MapVoxelV2, SheetPlacement, TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

interface BooleanRef {
  readonly value: boolean
}

interface ReadonlyValueRef<TValue> {
  readonly value: TValue
}

interface TokenControlOverrideLike {
  readonly enabled: BooleanRef
  readonly controllablePlacementIds: ReadonlyValueRef<readonly string[]>
}

type SheetMapRef<T> = Ref<Map<string, T> | undefined>

export type MapTokenSheetSelection =
  | { kind: 'pokemon'; sheet: CharacterSheet }
  | { kind: 'trainer'; sheet: TrainerSheet }

export interface UseTokenControlsOptions {
  map: Ref<TabletopMap | null>
  pokemonBySlug: SheetMapRef<CharacterSheet>
  trainerBySlug: SheetMapRef<TrainerSheet>
  mapVoxels: ComputedRef<MapVoxelV2[]>
  mapGroundLevelY: ComputedRef<number>
  canSpawnTokens: BooleanRef
  canControlAllTokens: BooleanRef
  canDeleteTokens?: BooleanRef
  canSendOutTokens?: BooleanRef
  selectionDisabled?: BooleanRef
  tokenControl?: TokenControlOverrideLike
  createPlacementId?: () => string
  now?: () => number
  maxMovementLogEntries?: number
}

const EMPTY_POKEMON_SHEETS = new Map<string, CharacterSheet>()
const EMPTY_TRAINER_SHEETS = new Map<string, TrainerSheet>()

export const emptyPreviewState = (): PreviewState => ({
  position: null,
  reachable: false,
  pathLength: 0,
})

export const toPokedexSlug = normalizePokedexSlug

export const sheetPathForPlacement = (placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>): string =>
  sheetEditorPath(placement.sheetKind, placement.sheetSlug)

export const pokedexPathForSpecies = pokedexEntryPathForSpecies

export const useTokenControls = ({
  map,
  pokemonBySlug,
  trainerBySlug,
  mapVoxels,
  mapGroundLevelY,
  canSpawnTokens,
  canControlAllTokens,
  canDeleteTokens = canControlAllTokens,
  canSendOutTokens = canSpawnTokens,
  selectionDisabled,
  tokenControl,
  createPlacementId = defaultCreatePlacementId,
  now,
  maxMovementLogEntries,
}: UseTokenControlsOptions) => {
  const selectedId = ref<string | null>(null)
  const previewState = ref<PreviewState>(emptyPreviewState())

  const sheetLookup = computed<SheetLookup>(() => ({
    pokemon: pokemonBySlug.value ?? EMPTY_POKEMON_SHEETS,
    trainer: trainerBySlug.value ?? EMPTY_TRAINER_SHEETS,
  }))

  const spawnedPokemon = computed<SpawnedPokemon[]>(() => {
    const currentMap = map.value
    if (!currentMap) return []
    return placementsToSpawned(currentMap, sheetLookup.value)
  })

  const placementIdsFromOverride = (
    control: TokenControlOverrideLike,
    placements: readonly SheetPlacement[],
  ): string[] => {
    const placementIds = new Set(placements.map((placement) => placement.id))
    return [...new Set(control.controllablePlacementIds.value)]
      .filter((id) => placementIds.has(id))
  }

  const controllablePlacementIds = computed(() => {
    if (!map.value) return []
    if (tokenControl?.enabled.value) {
      return placementIdsFromOverride(tokenControl, map.value.placements)
    }
    if (canControlAllTokens.value) return map.value.placements.map((placement) => placement.id)
    return []
  })

  const controllablePlacementIdSet = computed(() => new Set(controllablePlacementIds.value))
  const canControlPlacement = (id: string): boolean => controllablePlacementIdSet.value.has(id)
  const placementById = (id: string) => map.value?.placements.find((placement) => placement.id === id) ?? null
  const tokenSendOutOptionsById = computed(() => buildTokenSendOutOptionsByPlacementId(
    map.value?.placements ?? [],
    sheetLookup.value,
    canSendOutTokens.value,
  ))

  const resetPreview = () => {
    previewState.value = emptyPreviewState()
  }

  const clearSelection = () => {
    selectedId.value = null
    resetPreview()
  }

  const updatePreview = (next: PreviewState) => {
    previewState.value = next
  }

  const spawnSheet = (selection: MapTokenSheetSelection) => {
    if (!map.value || !canSpawnTokens.value) return
    const catalog = selection.kind === 'pokemon'
      ? catalogEntryForPokemonSheet(selection.sheet)
      : catalogEntryForTrainerSheet(selection.sheet)
    if (!catalog) return

    const occupiedKeys = buildMapOccupancy({
      voxels: mapVoxels.value,
    })
    const position = findFirstAvailablePosition(
      catalog,
      spawnedPokemon.value,
      map.value.dimensions,
      null,
      occupiedKeys,
      mapGroundLevelY.value,
    )
    if (!position) return

    map.value.placements.push({
      id: createPlacementId(),
      sheetKind: selection.kind,
      sheetSlug: selection.sheet.slug,
      position,
      facing: DEFAULT_TOKEN_FACING_DIRECTION,
      turned: false,
    })
    clearSelection()
  }

  const sendOutPokemon = (payload: { trainerId: string; pokemonSlug: string; position: GridAnchor }): boolean => {
    if (!map.value || !canSendOutTokens.value || !canControlPlacement(payload.trainerId)) return false

    const trainerPlacement = placementById(payload.trainerId)
    if (trainerPlacement?.sheetKind !== 'trainer') return false

    const trainer = spawnedPokemon.value.find((pokemon) => pokemon.id === payload.trainerId)
    const option = tokenSendOutOptionsById.value[payload.trainerId]
      ?.find((entry) => entry.pokemonSlug === payload.pokemonSlug)
    if (!trainer || !option) return false

    const occupiedKeys = buildMapOccupancy({
      voxels: mapVoxels.value,
    })
    if (!canPlacePokemon(
      option.preview,
      payload.position,
      spawnedPokemon.value,
      map.value.dimensions,
      null,
      occupiedKeys,
    )) return false
    if (!isSendOutPositionWithinThrowRange({
      trainer,
      pokemon: option.preview,
      position: payload.position,
      range: POKEBALL_THROW_RANGE_SQUARES,
    })) return false

    map.value.placements.push({
      id: createPlacementId(),
      sheetKind: 'pokemon',
      sheetSlug: payload.pokemonSlug,
      position: payload.position,
      facing: DEFAULT_TOKEN_FACING_DIRECTION,
      turned: false,
    })
    clearSelection()
    return true
  }

  const selectPlacement = (id: string | null) => {
    if (selectionDisabled?.value) return
    if (id && !canControlPlacement(id)) return
    selectedId.value = id
    if (!id) resetPreview()
  }

  const deletePlacement = (id: string) => {
    if (!map.value || !canDeleteTokens.value || !canControlPlacement(id)) return
    map.value.placements = map.value.placements.filter((placement) => placement.id !== id)
    if (map.value.initiative?.activeId === id) map.value.initiative.activeId = null
    if (selectedId.value === id) clearSelection()
  }

  const turnPlacement = (id: string) => {
    if (!map.value || !canControlPlacement(id)) return
    const placement = placementById(id)
    if (!placement) return
    const facing = nextTokenFacingForPlacement(placement)

    setTokenFacingOnPlacement(placement, facing)
  }

  const movePlacement = (payload: { id: string; position: GridAnchor }) => {
    if (!map.value || !canControlPlacement(payload.id)) return
    const placement = placementById(payload.id)
    if (!placement) return

    const from = { ...placement.position }
    const to = { ...payload.position }
    if (!sameGridAnchor(from, to)) {
      const tokenName = spawnedPokemon.value.find((pokemon) => pokemon.id === payload.id)?.species
        ?? placement.sheetSlug
      map.value.metadata = appendMovementLogEntry(map.value.metadata, {
        userId: payload.id,
        userName: tokenName,
        from,
        to,
        pathLength: previewState.value.pathLength,
      }, {
        now,
        maxLogEntries: maxMovementLogEntries,
      })
    }

    const facing = tokenFacingTowardPoint(from, to, tokenFacingForPlacement(placement))
    if (facing) setTokenFacingOnPlacement(placement, facing)

    placement.position = to
    clearSelection()
  }

  watch(
    () => [selectedId.value, controllablePlacementIds.value.join('|')] as const,
    ([id]) => {
      if (id && !canControlPlacement(id)) clearSelection()
    },
  )

  return {
    selectedId,
    previewState,
    sheetLookup,
    spawnedPokemon,
    controllablePlacementIds,
    tokenSendOutOptionsById,
    canControlPlacement,
    placementById,
    resetPreview,
    clearSelection,
    updatePreview,
    spawnSheet,
    sendOutPokemon,
    selectPlacement,
    deletePlacement,
    turnPlacement,
    movePlacement,
  }
}
