import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { findFirstAvailablePosition } from '~/utils/gridPlacement'
import type { PreviewState } from '~/utils/gridPreview'
import { buildMapOccupancy } from '~/utils/mapOccupancy'
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
import type { CharacterSheet } from '~/types/characterSheet'
import type { GridAnchor, MapVoxelV2, SheetPlacement, TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

interface BooleanRef {
  readonly value: boolean
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
  selectionDisabled?: BooleanRef
  createPlacementId?: () => string
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
  selectionDisabled,
  createPlacementId = defaultCreatePlacementId,
}: UseTokenControlsOptions) => {
  const selectedId = ref<string | null>(null)
  const previewState = ref<PreviewState>(emptyPreviewState())

  const sheetLookup = computed<SheetLookup>(() => ({
    pokemon: pokemonBySlug.value ?? EMPTY_POKEMON_SHEETS,
    trainer: trainerBySlug.value ?? EMPTY_TRAINER_SHEETS,
  }))

  const spawnedPokemon = computed<SpawnedPokemon[]>(() => placementsToSpawned(map.value, sheetLookup.value))

  const controllablePlacementIds = computed(() => {
    if (!map.value) return []
    if (canControlAllTokens.value) return map.value.placements.map((placement) => placement.id)
    return map.value.placements
      .filter((placement) => {
        const sheets = placement.sheetKind === 'pokemon' ? pokemonBySlug.value : trainerBySlug.value
        return sheets?.get(placement.sheetSlug)?.player === true
      })
      .map((placement) => placement.id)
  })

  const controllablePlacementIdSet = computed(() => new Set(controllablePlacementIds.value))
  const canControlPlacement = (id: string): boolean => controllablePlacementIdSet.value.has(id)
  const placementById = (id: string) => map.value?.placements.find((placement) => placement.id === id) ?? null

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
      turned: false,
    })
    clearSelection()
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
    placement.turned = !placement.turned
  }

  const movePlacement = (payload: { id: string; position: GridAnchor }) => {
    if (!map.value || !canControlPlacement(payload.id)) return
    const placement = placementById(payload.id)
    if (!placement) return
    placement.position = payload.position
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
    canControlPlacement,
    placementById,
    resetPreview,
    clearSelection,
    updatePreview,
    spawnSheet,
    selectPlacement,
    deletePlacement,
    turnPlacement,
    movePlacement,
  }
}
