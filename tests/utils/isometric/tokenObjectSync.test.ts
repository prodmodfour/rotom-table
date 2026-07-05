import { describe, expect, it, vi } from 'vitest'
import {
  syncPokemonRenderObjects,
  syncPokemonRenderObjectPlacementMotion,
  syncPokemonRenderObjectSelectionStyles,
} from '~/utils/isometric/tokenObjectSync'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TokenFacingDirection } from '~/types/tokenFacing'
import {
  resolveTokenMotionDurationOptionsForReason,
  startTokenMotionTrack,
  type TokenMotionFacingPlan,
  type TokenMotionTrack,
} from '~/utils/isometric/tokenMotionTracks'

const makeCenter = (x: number, y: number, z: number) => ({ x, y, z })

type PlacementMotionRenderObject = {
  id: string
  currentCenter: ReturnType<typeof makeCenter>
  targetCenter: ReturnType<typeof makeCenter>
  facing: TokenFacingDirection
  motion: { track?: TokenMotionTrack; facing?: TokenMotionFacingPlan & { track: TokenMotionTrack } }
}

const makePlacementMotionRenderObject = (): PlacementMotionRenderObject => ({
  id: 'a',
  currentCenter: makeCenter(0.5, 0, 0.5),
  targetCenter: makeCenter(0.5, 0, 0.5),
  facing: 'south-east',
  motion: {},
})

const makePokemon = (id: string, overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
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
  ...overrides,
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
    const onBeforeUpdateExistingRenderObject = vi.fn()
    const updateRenderObject = vi.fn()

    syncPokemonRenderObjects({
      renderObjects,
      pokemons: [makePokemon('a')],
      createRenderObject,
      onBeforeUpdateExistingRenderObject,
      updateRenderObject,
      disposeRenderObject: vi.fn(),
    })

    expect(createRenderObject).not.toHaveBeenCalled()
    expect(renderObjects.get('a')).toBe(existing)
    expect(onBeforeUpdateExistingRenderObject).toHaveBeenCalledWith(existing, expect.objectContaining({ id: 'a' }))
    expect(onBeforeUpdateExistingRenderObject.mock.invocationCallOrder[0]).toBeLessThan(
      updateRenderObject.mock.invocationCallOrder[0],
    )
    expect(updateRenderObject).toHaveBeenCalledWith(existing, expect.objectContaining({ id: 'a' }))
  })

  it('does not invoke existing-object update hooks for newly-created render objects', () => {
    const renderObjects = new Map<string, { id: string }>()
    const onBeforeUpdateExistingRenderObject = vi.fn()

    syncPokemonRenderObjects({
      renderObjects,
      pokemons: [makePokemon('a')],
      createRenderObject: vi.fn((pokemon: SpawnedPokemon) => ({ id: pokemon.id })),
      onBeforeUpdateExistingRenderObject,
      updateRenderObject: vi.fn(),
      disposeRenderObject: vi.fn(),
    })

    expect(onBeforeUpdateExistingRenderObject).not.toHaveBeenCalled()
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

  it('starts placement motion for existing tokens that move to a new center', () => {
    const renderObject = makePlacementMotionRenderObject()

    const started = syncPokemonRenderObjectPlacementMotion({
      renderObject,
      pokemon: makePokemon('a', { position: { x: 3, y: 1, z: 4 }, facing: 'south-west' }),
      startMs: 1234,
      reason: 'remote-accepted',
    })

    expect(started).toBe(true)
    expect(renderObject.motion.track).toMatchObject({
      tokenId: 'a',
      origin: { x: 0.5, y: 0, z: 0.5 },
      destination: { x: 3.5, y: 1, z: 4.5 },
      startMs: 1234,
      reason: 'remote-accepted',
    })
    expect(renderObject.motion.facing).toMatchObject({
      track: renderObject.motion.track,
      travelFacing: 'south-east',
      finalFacing: 'south-west',
    })
    expect(renderObject.targetCenter).toEqual({ x: 0.5, y: 0, z: 0.5 })
  })

  it('uses supplied path anchors to create segmented placement motion', () => {
    const renderObject = makePlacementMotionRenderObject()

    const started = syncPokemonRenderObjectPlacementMotion({
      renderObject,
      pokemon: makePokemon('a', { position: { x: 1, y: 0, z: 2 } }),
      startMs: 1234,
      reason: 'local-prediction',
      durationOptions: {
        minDurationMs: 0,
        maxDurationMs: 1000,
        msPerGridUnit: 100,
      },
      pathAnchors: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 0, z: 2 },
      ],
    })

    expect(started).toBe(true)
    expect(renderObject.motion.track?.durationMs).toBe(300)
    expect(renderObject.motion.track?.pathSegments).toEqual([
      {
        origin: { x: 0.5, y: 0, z: 0.5 },
        destination: { x: 1.5, y: 0, z: 0.5 },
        durationMs: 100,
      },
      {
        origin: { x: 1.5, y: 0, z: 0.5 },
        destination: { x: 1.5, y: 0, z: 2.5 },
        durationMs: 200,
      },
    ])
  })

  it('does not start placement motion for sheet-only token updates', () => {
    const renderObject = makePlacementMotionRenderObject()

    const started = syncPokemonRenderObjectPlacementMotion({
      renderObject,
      pokemon: makePokemon('a', {
        currentHp: 7,
        combatStages: { atk: 1, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
        conditions: ['Burned'],
      }),
      startMs: 1234,
    })

    expect(started).toBe(false)
    expect(renderObject.motion.track).toBeUndefined()
  })

  it('clears stale placement motion when a changed target is already at the rendered center', () => {
    const renderObject = makePlacementMotionRenderObject()
    renderObject.targetCenter = makeCenter(9.5, 0, 9.5)
    renderObject.motion.track = startTokenMotionTrack({
      tokenId: 'a',
      origin: { x: 0.5, y: 0, z: 0.5 },
      destination: { x: 9.5, y: 0, z: 9.5 },
      startMs: 1,
      reason: 'setup-edit',
    })
    renderObject.motion.facing = {
      track: renderObject.motion.track,
      travelFacing: 'south-east',
      finalFacing: 'south-east',
    }

    const started = syncPokemonRenderObjectPlacementMotion({
      renderObject,
      pokemon: makePokemon('a'),
      startMs: 1234,
    })

    expect(started).toBe(false)
    expect(renderObject.motion.track).toBeUndefined()
    expect(renderObject.motion.facing).toBeUndefined()
  })

  it('replaces active placement motion from the sampled center when the same token receives a new target', () => {
    const renderObject = makePlacementMotionRenderObject()
    renderObject.currentCenter = makeCenter(1.5, 0, 0.5)
    renderObject.targetCenter = makeCenter(10.5, 0, 0.5)
    renderObject.motion.track = startTokenMotionTrack({
      tokenId: 'a',
      origin: { x: 0.5, y: 0, z: 0.5 },
      destination: { x: 10.5, y: 0, z: 0.5 },
      startMs: 1000,
      durationMs: 1000,
      reason: 'local-prediction',
    })

    const started = syncPokemonRenderObjectPlacementMotion({
      renderObject,
      pokemon: makePokemon('a', { position: { x: 20, y: 0, z: 0 } }),
      startMs: 1500,
      reason: 'local-prediction',
    })

    expect(started).toBe(true)
    expect(renderObject.motion.track).toMatchObject({
      tokenId: 'a',
      origin: { x: 5.5, y: 0, z: 0.5 },
      destination: { x: 20.5, y: 0, z: 0.5 },
      startMs: 1500,
      reason: 'local-prediction',
    })
    expect(renderObject.currentCenter).toEqual({ x: 5.5, y: 0, z: 0.5 })
    expect(renderObject.motion.track?.durationMs).toBe(520)
    expect(renderObject.motion.facing).toMatchObject({
      track: renderObject.motion.track,
      travelFacing: 'north-east',
      finalFacing: 'south-east',
    })
  })

  it('does not snap back to a stale current center when replacement target is already sampled', () => {
    const renderObject = makePlacementMotionRenderObject()
    renderObject.currentCenter = makeCenter(0.5, 0, 0.5)
    renderObject.targetCenter = makeCenter(10.5, 0, 0.5)
    renderObject.motion.track = startTokenMotionTrack({
      tokenId: 'a',
      origin: { x: 0.5, y: 0, z: 0.5 },
      destination: { x: 10.5, y: 0, z: 0.5 },
      startMs: 1000,
      durationMs: 1000,
      reason: 'local-prediction',
    })
    renderObject.motion.facing = {
      track: renderObject.motion.track,
      travelFacing: 'north-east',
      finalFacing: 'south-east',
    }

    const started = syncPokemonRenderObjectPlacementMotion({
      renderObject,
      pokemon: makePokemon('a', { position: { x: 5, y: 0, z: 0 } }),
      startMs: 1500,
    })

    expect(started).toBe(false)
    expect(renderObject.motion.track).toBeUndefined()
    expect(renderObject.motion.facing).toBeUndefined()
    expect(renderObject.currentCenter).toEqual({ x: 5.5, y: 0, z: 0.5 })
  })

  it('uses server-correction duration policy for rollback placement motion', () => {
    const renderObject = makePlacementMotionRenderObject()

    const started = syncPokemonRenderObjectPlacementMotion({
      renderObject,
      pokemon: makePokemon('a', { position: { x: 9, y: 0, z: 0 } }),
      startMs: 1500,
      reason: 'server-correction',
      durationOptions: resolveTokenMotionDurationOptionsForReason('server-correction'),
    })

    expect(started).toBe(true)
    expect(renderObject.motion.track).toMatchObject({
      reason: 'server-correction',
      durationMs: 220,
    })
  })

  it('snaps reconciliation placement updates without leaving stale motion metadata', () => {
    const renderObject = makePlacementMotionRenderObject()
    renderObject.currentCenter = makeCenter(5.5, 0, 0.5)
    renderObject.targetCenter = makeCenter(10.5, 0, 0.5)
    renderObject.motion.track = startTokenMotionTrack({
      tokenId: 'a',
      origin: { x: 0.5, y: 0, z: 0.5 },
      destination: { x: 10.5, y: 0, z: 0.5 },
      startMs: 1000,
      durationMs: 1000,
      reason: 'local-prediction',
    })
    renderObject.motion.facing = {
      track: renderObject.motion.track,
      travelFacing: 'north-east',
      finalFacing: 'south-east',
    }

    const changed = syncPokemonRenderObjectPlacementMotion({
      renderObject,
      pokemon: makePokemon('a'),
      startMs: 1500,
      reason: 'reconciliation',
      motionMode: 'snap',
    })

    expect(changed).toBe(true)
    expect(renderObject.motion.track).toBeUndefined()
    expect(renderObject.motion.facing).toBeUndefined()
    expect(renderObject.currentCenter).toEqual({ x: 0.5, y: 0, z: 0.5 })
    expect(renderObject.targetCenter).toEqual({ x: 0.5, y: 0, z: 0.5 })
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
