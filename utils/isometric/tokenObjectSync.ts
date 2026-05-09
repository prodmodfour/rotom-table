import type { SpawnedPokemon } from '~/types/pokemon'

export interface TokenObjectSyncOptions<TRenderObject> {
  renderObjects: Map<string, TRenderObject>
  pokemons: SpawnedPokemon[]
  createRenderObject: (pokemon: SpawnedPokemon) => TRenderObject
  onCreateRenderObject?: (renderObject: TRenderObject, pokemon: SpawnedPokemon) => void
  updateRenderObject: (renderObject: TRenderObject, pokemon: SpawnedPokemon) => void
  disposeRenderObject: (renderObject: TRenderObject, id: string) => void
  clearHoverForToken?: (id: string) => void
}

export const syncPokemonRenderObjects = <TRenderObject>({
  renderObjects,
  pokemons,
  createRenderObject,
  onCreateRenderObject,
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
    }

    updateRenderObject(renderObject, pokemon)
  }
}
