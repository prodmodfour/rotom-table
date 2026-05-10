import { describe, expect, it, vi } from 'vitest'
import {
  syncPokemonRenderObjects,
  syncPokemonRenderObjectSelectionStyles,
} from '~/utils/isometric/tokenObjectSync'
import type { SpawnedPokemon } from '~/types/pokemon'

const makePokemon = (id: string): SpawnedPokemon => ({
  species: id,
  slug: id,
  spriteUrl: `/${id}.png`,
  entityKind: 'pokemon',
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  id,
  position: { x: 0, y: 0, z: 0 },
  sheetKind: 'pokemon',
  sheetSlug: id,
  level: 1,
  currentHp: 10,
  maxHp: 10,
  atk: 1,
  satk: 1,
  def: 1,
  sdef: 1,
  defenderTypes: [],
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  conditions: [],
  tokenItems: [],
})

describe('isometric token object sync', () => {
  it('creates and updates missing render objects in pokemon order', () => {
    const renderObjects = new Map<string, { id: string }>()
    const createRenderObject = vi.fn((pokemon: SpawnedPokemon) => ({ id: pokemon.id }))
    const onCreateRenderObject = vi.fn()
    const updateRenderObject = vi.fn()

    syncPokemonRenderObjects({
      renderObjects,
      pokemons: [makePokemon('a'), makePokemon('b')],
      createRenderObject,
      onCreateRenderObject,
      updateRenderObject,
      disposeRenderObject: vi.fn(),
    })

    expect([...renderObjects.keys()]).toEqual(['a', 'b'])
    expect(createRenderObject).toHaveBeenCalledTimes(2)
    expect(onCreateRenderObject).toHaveBeenNthCalledWith(1, renderObjects.get('a'), expect.objectContaining({ id: 'a' }))
    expect(onCreateRenderObject).toHaveBeenNthCalledWith(2, renderObjects.get('b'), expect.objectContaining({ id: 'b' }))
    expect(updateRenderObject).toHaveBeenNthCalledWith(1, renderObjects.get('a'), expect.objectContaining({ id: 'a' }))
    expect(updateRenderObject).toHaveBeenNthCalledWith(2, renderObjects.get('b'), expect.objectContaining({ id: 'b' }))
  })

  it('updates existing objects without recreating them', () => {
    const existing = { id: 'a' }
    const renderObjects = new Map<string, { id: string }>([['a', existing]])
    const createRenderObject = vi.fn((pokemon: SpawnedPokemon) => ({ id: pokemon.id }))
    const updateRenderObject = vi.fn()

    syncPokemonRenderObjects({
      renderObjects,
      pokemons: [makePokemon('a')],
      createRenderObject,
      updateRenderObject,
      disposeRenderObject: vi.fn(),
    })

    expect(createRenderObject).not.toHaveBeenCalled()
    expect(renderObjects.get('a')).toBe(existing)
    expect(updateRenderObject).toHaveBeenCalledWith(existing, expect.objectContaining({ id: 'a' }))
  })

  it('disposes stale objects and clears hover before deletion', () => {
    const stale = { id: 'old' }
    const kept = { id: 'kept' }
    const renderObjects = new Map<string, { id: string }>([
      ['old', stale],
      ['kept', kept],
    ])
    const clearHoverForToken = vi.fn()
    const disposeRenderObject = vi.fn()

    syncPokemonRenderObjects({
      renderObjects,
      pokemons: [makePokemon('kept')],
      createRenderObject: vi.fn((pokemon: SpawnedPokemon) => ({ id: pokemon.id })),
      updateRenderObject: vi.fn(),
      disposeRenderObject,
      clearHoverForToken,
    })

    expect(clearHoverForToken).toHaveBeenCalledWith('old')
    expect(disposeRenderObject).toHaveBeenCalledWith(stale, 'old')
    expect(renderObjects.has('old')).toBe(false)
    expect(renderObjects.get('kept')).toBe(kept)
  })

  it('syncs selection styling for existing render objects only', () => {
    const selected = { id: 'selected' }
    const other = { id: 'other' }
    const paintRenderObjectStyle = vi.fn()

    syncPokemonRenderObjectSelectionStyles({
      renderObjects: new Map([
        ['selected', selected],
        ['other', other],
      ]),
      pokemons: [makePokemon('selected'), makePokemon('missing'), makePokemon('other')],
      selectedId: 'selected',
      paintRenderObjectStyle,
    })

    expect(paintRenderObjectStyle).toHaveBeenCalledTimes(2)
    expect(paintRenderObjectStyle).toHaveBeenNthCalledWith(
      1,
      selected,
      true,
      expect.objectContaining({ id: 'selected' }),
    )
    expect(paintRenderObjectStyle).toHaveBeenNthCalledWith(
      2,
      other,
      false,
      expect.objectContaining({ id: 'other' }),
    )
  })
})
