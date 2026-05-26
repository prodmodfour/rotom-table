import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  pokedexPathForSpecies,
  sheetPathForPlacement,
  toPokedexSlug,
  useTokenControls,
} from '~/composables/map-editor/useTokenControls'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'token-test',
  name: 'Token Test',
  dimensions: { x: 6, y: 2, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
})

const pokemon = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'bolt',
  nickname: 'Bolt',
  species: 'Bulbasaur',
  level: 5,
  stats: {},
  ...overrides,
} as CharacterSheet)

const trainer = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'gm-npc',
  name: 'GM NPC',
  level: 5,
  stats: {},
  ...overrides,
} as TrainerSheet)

const makeControls = (
  options: {
    map?: TabletopMap
    pokemonSheets?: CharacterSheet[]
    trainerSheets?: TrainerSheet[]
    isGm?: boolean
    nextId?: string
    now?: () => number
    sessionMoveTokenDispatcher?: {
      readonly enabled: { readonly value: boolean }
      dispatchMoveToken(payload: { placement: TabletopMap['placements'][number]; to: TabletopMap['placements'][number]['position'] }): { readonly dispatched: boolean }
    }
  } = {},
) => {
  const map = ref(options.map ?? mapFixture())
  const isGm = ref(options.isGm ?? true)
  return {
    map,
    isGm,
    controls: useTokenControls({
      map,
      pokemonBySlug: ref(new Map((options.pokemonSheets ?? []).map((sheet) => [sheet.slug, sheet]))),
      trainerBySlug: ref(new Map((options.trainerSheets ?? []).map((sheet) => [sheet.slug, sheet]))),
      mapVoxels: computed(() => map.value?.voxels ?? []),
      mapGroundLevelY: computed(() => map.value?.groundLevelY ?? 0),
      canSpawnTokens: isGm,
      canControlAllTokens: isGm,
      canDeleteTokens: isGm,
      sessionMoveTokenDispatcher: options.sessionMoveTokenDispatcher,
      createPlacementId: () => options.nextId ?? 'token-1',
      now: options.now,
    }),
  }
}

describe('useTokenControls', () => {
  it('spawns a selected sheet onto the first available map position', () => {
    const sheet = pokemon()
    const { map, controls } = makeControls({ pokemonSheets: [sheet], nextId: 'spawned-1' })

    controls.updatePreview({ position: { x: 1, y: 0, z: 1 }, reachable: true, pathLength: 2 })
    controls.spawnSheet({ kind: 'pokemon', sheet })

    expect(map.value.placements).toHaveLength(1)
    expect(map.value.placements[0]).toMatchObject({
      id: 'spawned-1',
      sheetKind: 'pokemon',
      sheetSlug: 'bolt',
      facing: 'south-east',
      turned: false,
    })
    expect(map.value.placements[0].position.x).toBeGreaterThanOrEqual(0)
    expect(controls.previewState.value).toEqual({ position: null, reachable: false, pathLength: 0 })
    expect(controls.spawnedPokemon.value[0]?.id).toBe('spawned-1')
  })

  it('uses player sheet access for token control and keeps deletion GM-only', () => {
    const playerSheet = pokemon({ slug: 'player-mon', player: true })
    const hiddenTrainer = trainer({ slug: 'hidden-trainer', player: false })
    const map = mapFixture()
    map.placements = [
      { id: 'player-token', sheetKind: 'pokemon', sheetSlug: playerSheet.slug, position: { x: 0, y: 0, z: 0 } },
      { id: 'gm-token', sheetKind: 'trainer', sheetSlug: hiddenTrainer.slug, position: { x: 1, y: 0, z: 0 } },
    ]
    const { controls, isGm } = makeControls({
      map,
      pokemonSheets: [playerSheet],
      trainerSheets: [hiddenTrainer],
      isGm: false,
    })

    expect(controls.controllablePlacementIds.value).toEqual(['player-token'])
    controls.selectPlacement('player-token')
    controls.selectPlacement('gm-token')
    expect(controls.selectedId.value).toBe('player-token')

    controls.deletePlacement('player-token')
    expect(map.placements.map((placement) => placement.id)).toEqual(['player-token', 'gm-token'])

    controls.turnPlacement('player-token')
    expect(map.placements[0]).toMatchObject({ facing: 'north-east', turned: false })
    controls.turnPlacement('player-token')
    expect(map.placements[0]).toMatchObject({ facing: 'north-west', turned: true })

    isGm.value = true
    controls.deletePlacement('gm-token')
    expect(map.placements.map((placement) => placement.id)).toEqual(['player-token'])
  })

  it('logs token movement as a combat action', () => {
    const sheet = pokemon()
    const map = mapFixture()
    map.placements = [
      { id: 'bolt-token', sheetKind: 'pokemon', sheetSlug: sheet.slug, position: { x: 0, y: 0, z: 0 } },
    ]
    const { controls } = makeControls({
      map,
      pokemonSheets: [sheet],
      now: () => 123,
    })

    controls.updatePreview({ position: { x: 2, y: 0, z: 1 }, reachable: true, pathLength: 3 })
    controls.movePlacement({ id: 'bolt-token', position: { x: 2, y: 0, z: 1 } })

    expect(map.placements[0]?.position).toEqual({ x: 2, y: 0, z: 1 })
    expect(map.placements[0]).toMatchObject({ facing: 'south-east', turned: false })
    expect(map.metadata?.movementLog).toMatchObject([
      {
        at: 123,
        userId: 'bolt-token',
        userName: 'Bolt',
        actionName: 'Movement',
        from: { x: 0, y: 0, z: 0 },
        to: { x: 2, y: 0, z: 1 },
        pathLength: 3,
        lines: ['Bolt moved 3 squares from (0, 0, 0) to (2, 0, 1).'],
      },
    ])
  })

  it('dispatches session-mode token movement without directly mutating the local map', () => {
    const sheet = pokemon()
    const map = mapFixture()
    map.placements = [
      { id: 'bolt-token', sheetKind: 'pokemon', sheetSlug: sheet.slug, position: { x: 0, y: 0, z: 0 } },
    ]
    const dispatchMoveToken = vi.fn(() => ({ dispatched: true }))
    const { controls } = makeControls({
      map,
      pokemonSheets: [sheet],
      sessionMoveTokenDispatcher: {
        enabled: ref(true),
        dispatchMoveToken,
      },
    })

    controls.selectPlacement('bolt-token')
    controls.updatePreview({ position: { x: 2, y: 0, z: 1 }, reachable: true, pathLength: 3 })
    controls.movePlacement({ id: 'bolt-token', position: { x: 2, y: 0, z: 1 } })

    expect(dispatchMoveToken).toHaveBeenCalledWith({
      placement: map.placements[0],
      to: { x: 2, y: 0, z: 1 },
    })
    expect(map.placements[0]?.position).toEqual({ x: 0, y: 0, z: 0 })
    expect(map.metadata?.movementLog).toBeUndefined()
    expect(controls.selectedId.value).toBeNull()
  })

  it('turns moved tokens toward cardinal destinations instead of preserving stale side-facing', () => {
    const sheet = pokemon()
    const map = mapFixture()
    map.placements = [
      {
        id: 'bolt-token',
        sheetKind: 'pokemon',
        sheetSlug: sheet.slug,
        position: { x: 2, y: 0, z: 2 },
        facing: 'north-east',
      },
    ]
    const { controls } = makeControls({ map, pokemonSheets: [sheet] })

    controls.movePlacement({ id: 'bolt-token', position: { x: 1, y: 0, z: 2 } })

    expect(map.placements[0]).toMatchObject({ facing: 'south-west', turned: false })
  })

  it('does not log movement when the token stays in place', () => {
    const sheet = pokemon()
    const map = mapFixture()
    map.placements = [
      { id: 'bolt-token', sheetKind: 'pokemon', sheetSlug: sheet.slug, position: { x: 0, y: 0, z: 0 } },
    ]
    const { controls } = makeControls({ map, pokemonSheets: [sheet] })

    controls.movePlacement({ id: 'bolt-token', position: { x: 0, y: 0, z: 0 } })

    expect(map.placements[0]?.facing).toBeUndefined()
    expect(map.metadata?.movementLog).toBeUndefined()
  })

  it('centralizes map-token navigation paths', () => {
    expect(sheetPathForPlacement({ sheetKind: 'pokemon', sheetSlug: 'party mon' })).toBe('/sheets/party%20mon')
    expect(sheetPathForPlacement({ sheetKind: 'trainer', sheetSlug: 'gym/boss' })).toBe('/sheets/trainers/gym%2Fboss')
    expect(toPokedexSlug('Flabébé’s Form')).toBe('flabebes-form')
    expect(pokedexPathForSpecies('Mr. Mime')).toBe('/pokedex/mr-mime')
    expect(pokedexPathForSpecies('')).toBeNull()
  })
})
