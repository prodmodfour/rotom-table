import type { GridAnchor, SpawnedPokemon } from '~/types/pokemon'
import { getAnchorCenter, getPokemonCenter } from '~/utils/gridGeometry'
import type { TokenMotionCenter, TokenMotionDurationOptions } from '~/utils/isometric/tokenMotionCurves'
import {
  createTokenMotionFacingPlan,
  replaceTokenMotionTrack,
  startTokenMotionTrack,
  type TokenMotionFacingPlan,
  type TokenMotionTrack,
  type TokenMotionTrackReason,
} from '~/utils/isometric/tokenMotionTracks'
import { TOKEN_CENTER_LERP_SNAP_DISTANCE_SQUARED } from '~/utils/isometric/tokenRenderState'
import type { TokenFacingDirection } from '~/types/tokenFacing'
import { tokenFacingForPlacement } from '~/utils/tokenFacing'

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

export interface PokemonPlacementMotionFacingState extends TokenMotionFacingPlan {
  readonly track: TokenMotionTrack
}

export interface PokemonPlacementMotionRenderObject {
  id: string
  currentCenter: TokenMotionCenter
  targetCenter: TokenMotionCenter
  facing?: TokenFacingDirection
  motion: {
    track?: TokenMotionTrack
    sampledCenter?: TokenMotionCenter
    facing?: PokemonPlacementMotionFacingState
  }
}

export interface PokemonPlacementMotionSyncOptions<
  TRenderObject extends PokemonPlacementMotionRenderObject = PokemonPlacementMotionRenderObject,
> {
  renderObject: TRenderObject
  pokemon: Pick<SpawnedPokemon, 'id' | 'base' | 'position' | 'facing' | 'turned'>
  startMs: number
  reason?: TokenMotionTrackReason
  durationOptions?: TokenMotionDurationOptions
  pathAnchors?: readonly GridAnchor[]
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

const tokenMotionPathCentersForAnchors = (
  pathAnchors: readonly GridAnchor[] | undefined,
  base: number,
): TokenMotionCenter[] | undefined => (
  pathAnchors && pathAnchors.length >= 2
    ? pathAnchors.map((anchor) => getAnchorCenter(anchor, base))
    : undefined
)

const copyTokenMotionCenter = (
  target: TokenMotionCenter | undefined,
  source: TokenMotionCenter,
) => {
  if (!target) return

  const mutableTarget = target as { x: number; y: number; z: number }
  mutableTarget.x = source.x
  mutableTarget.y = source.y
  mutableTarget.z = source.z
}

const copyPlacementMotionSample = (
  renderObject: PokemonPlacementMotionRenderObject,
  center: TokenMotionCenter,
) => {
  copyTokenMotionCenter(renderObject.currentCenter, center)
  copyTokenMotionCenter(renderObject.motion.sampledCenter, center)
}

const clearPlacementMotionFacing = (
  renderObject: PokemonPlacementMotionRenderObject,
) => {
  delete renderObject.motion.facing
}

const setPlacementMotionFacing = (
  renderObject: PokemonPlacementMotionRenderObject,
  pokemon: Pick<SpawnedPokemon, 'facing' | 'turned'>,
  track: TokenMotionTrack,
) => {
  renderObject.motion.facing = {
    track,
    ...createTokenMotionFacingPlan({
      origin: track.origin,
      destination: track.destination,
      pathSegments: track.pathSegments,
      currentFacing: renderObject.facing ?? tokenFacingForPlacement(pokemon),
      finalFacing: tokenFacingForPlacement(pokemon),
    }),
  }
}

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
  reason,
  durationOptions,
  pathAnchors,
}: PokemonPlacementMotionSyncOptions<TRenderObject>): boolean => {
  const destination = getPokemonCenter(pokemon)
  const pathCenters = tokenMotionPathCentersForAnchors(pathAnchors, pokemon.base)

  if (tokenMotionCentersNearlyEqual(renderObject.targetCenter, destination)) {
    return false
  }

  const renderedOrigin = cloneTokenMotionCenter(renderObject.currentCenter)

  if (tokenMotionCentersNearlyEqual(renderedOrigin, destination)) {
    delete renderObject.motion.track
    clearPlacementMotionFacing(renderObject)
    copyPlacementMotionSample(renderObject, destination)
    return false
  }

  const activeTrack = renderObject.motion.track
  if (activeTrack) {
    const replacement = replaceTokenMotionTrack(activeTrack, {
      destination,
      replaceAtMs: startMs,
      reason,
      durationOptions,
      pathCenters,
    })

    if (tokenMotionCentersNearlyEqual(replacement.origin, destination)) {
      delete renderObject.motion.track
      clearPlacementMotionFacing(renderObject)
      copyPlacementMotionSample(renderObject, destination)
      return false
    }

    renderObject.motion.track = replacement
    setPlacementMotionFacing(renderObject, pokemon, replacement)
    copyPlacementMotionSample(renderObject, replacement.origin)
    return true
  }

  const track = startTokenMotionTrack({
    tokenId: pokemon.id,
    origin: renderedOrigin,
    destination,
    startMs,
    reason: reason ?? 'setup-edit',
    durationOptions,
    pathCenters,
  })
  renderObject.motion.track = track
  setPlacementMotionFacing(renderObject, pokemon, track)

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
