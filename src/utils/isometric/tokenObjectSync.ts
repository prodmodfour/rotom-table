import type { SpawnedPokemon } from '~/types/pokemon'
import { getPokemonCenter } from '~/utils/gridGeometry'
import type { TokenMotionCenter, TokenMotionDurationOptions } from '~/utils/isometric/tokenMotionCurves'
import {
  startTokenMotionTrack,
  type TokenMotionTrack,
  type TokenMotionTrackReason,
} from '~/utils/isometric/tokenMotionTracks'
import { TOKEN_CENTER_LERP_SNAP_DISTANCE_SQUARED } from '~/utils/isometric/tokenRenderState'

export interface TokenObjectSyncOptions<TRenderObject> {
  renderObjects: Map<string, TRenderObject>
  pokemons: SpawnedPokemon[]
  createRenderObject: (pokemon: SpawnedPokemon) => TRenderObject
  onCreateRenderObject?: (renderObject: TRenderObject, pokemon: SpawnedPokemon) => void
  onBeforeUpdateExistingRenderObject?: (renderObject: TRenderObject, pokemon: SpawnedPokemon) => void
  updateRenderObject: (renderObject: TRenderObject, pokemon: SpawnedPokemon) => void
  disposeRenderObject: (renderObject: TRenderObject, id: string) => void
  clearHoverForToken?: (id: string) => void
}

export interface TokenObjectSelectionStyleSyncOptions<
  TRenderObject,
  TPokemon extends Pick<SpawnedPokemon, 'id'> = SpawnedPokemon,
> {
  renderObjects: ReadonlyMap<string, TRenderObject>
  pokemons: TPokemon[]
  selectedId: string | null | undefined
  paintRenderObjectStyle: (renderObject: TRenderObject, selected: boolean, pokemon: TPokemon) => void
}

export const syncPokemonRenderObjects = <TRenderObject>({
  renderObjects,
  pokemons,
  createRenderObject,
  onCreateRenderObject,
  onBeforeUpdateExistingRenderObject,
  updateRenderObject,
  disposeRenderObject,
  clearHoverForToken,
}: TokenObjectSyncOptions<TRenderObject>) => {
  const nextIds = new Set(pokemons.map((pokemon) => pokemon.id))

  for (const [id, renderObject] of renderObjects.entries()) {
    if (nextIds.has(id)) continue

    clearHoverForToken?.(id)
    disposeRenderObject(renderObject, id)
    renderObjects.delete(id)
  }

  for (const pokemon of pokemons) {
    let renderObject = renderObjects.get(pokemon.id)

    if (!renderObject) {
      renderObject = createRenderObject(pokemon)
      renderObjects.set(pokemon.id, renderObject)
      onCreateRenderObject?.(renderObject, pokemon)
    } else {
      onBeforeUpdateExistingRenderObject?.(renderObject, pokemon)
    }

    updateRenderObject(renderObject, pokemon)
  }
}

export interface PokemonPlacementMotionRenderObject {
  id: string
  currentCenter: TokenMotionCenter
  targetCenter: TokenMotionCenter
  motion: {
    track?: TokenMotionTrack
  }
}

export interface PokemonPlacementMotionSyncOptions<
  TRenderObject extends PokemonPlacementMotionRenderObject = PokemonPlacementMotionRenderObject,
> {
  renderObject: TRenderObject
  pokemon: Pick<SpawnedPokemon, 'id' | 'base' | 'position'>
  startMs: number
  reason?: TokenMotionTrackReason
  durationOptions?: TokenMotionDurationOptions
}

const tokenMotionCenterDistanceSquared = (
  left: TokenMotionCenter,
  right: TokenMotionCenter,
): number => {
  const dx = left.x - right.x
  const dy = left.y - right.y
  const dz = left.z - right.z

  return dx * dx + dy * dy + dz * dz
}

const tokenMotionCentersNearlyEqual = (
  left: TokenMotionCenter,
  right: TokenMotionCenter,
): boolean => (
  tokenMotionCenterDistanceSquared(left, right) < TOKEN_CENTER_LERP_SNAP_DISTANCE_SQUARED
)

const cloneTokenMotionCenter = (center: TokenMotionCenter): TokenMotionCenter => ({
  x: center.x,
  y: center.y,
  z: center.z,
})

/**
 * Starts a presentation-only movement track when an existing render object's
 * authoritative placement center changes. The caller must invoke this before
 * writing the new spawn state into `targetCenter`; newly-created tokens should
 * skip this helper so they spawn at their first authoritative center.
 */
export const syncPokemonRenderObjectPlacementMotion = <
  TRenderObject extends PokemonPlacementMotionRenderObject,
>({
  renderObject,
  pokemon,
  startMs,
  reason = 'setup-edit',
  durationOptions,
}: PokemonPlacementMotionSyncOptions<TRenderObject>): boolean => {
  const destination = getPokemonCenter(pokemon)

  if (tokenMotionCentersNearlyEqual(renderObject.targetCenter, destination)) {
    return false
  }

  const origin = cloneTokenMotionCenter(renderObject.currentCenter)

  if (tokenMotionCentersNearlyEqual(origin, destination)) {
    delete renderObject.motion.track
    return false
  }

  renderObject.motion.track = startTokenMotionTrack({
    tokenId: pokemon.id,
    origin,
    destination,
    startMs,
    reason,
    durationOptions,
  })

  return true
}

export const syncPokemonRenderObjectSelectionStyles = <
  TRenderObject,
  TPokemon extends Pick<SpawnedPokemon, 'id'> = SpawnedPokemon,
>({
  renderObjects,
  pokemons,
  selectedId,
  paintRenderObjectStyle,
}: TokenObjectSelectionStyleSyncOptions<TRenderObject, TPokemon>) => {
  for (const pokemon of pokemons) {
    const renderObject = renderObjects.get(pokemon.id)

    if (!renderObject) {
      continue
    }

    paintRenderObjectStyle(renderObject, selectedId === pokemon.id, pokemon)
  }
}
