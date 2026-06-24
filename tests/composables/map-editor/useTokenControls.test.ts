import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
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
    canSendOutTokens?: boolean
    nextId?: string
    now?: () => number
    tokenControl?: {
      readonly enabled: { readonly value: boolean }
      readonly controllablePlacementIds: { readonly value: readonly string[] }
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
      canSendOutTokens: ref(options.canSendOutTokens ?? isGm.value),
      tokenControl: options.tokenControl,
      createPlacementId: () => options.nextId ?? 'token-1',
      now: options.now,
    }),
  }
}

describe('useTokenControls', () => {
  it('plans a spawn placement without mutating the map', () => {
    const sheet = pokemon()
    const { map, controls } = makeControls({ pokemonSheets: [sheet], nextId: 'spawned-1' })

    controls.updatePreview({ position: { x: 1, y: 0, z: 1 }, reachable: true, pathLength: 2 })
    const placement = controls.createSpawnPlacement({ kind: 'pokemon', sheet })

    expect(placement).toMatchObject({
      id: 'spawned-1',
      sheetKind: 'pokemon',
      sheetSlug: 'bolt',
      facing: 'south-east',
      turned: false,
    })
    expect(placement?.position.x).toBeGreaterThanOrEqual(0)
    expect(map.value.placements).toHaveLength(0)
    expect(controls.previewState.value).toEqual({ position: { x: 1, y: 0, z: 1 }, reachable: true, pathLength: 2 })
    expect(controls.spawnedPokemon.value).toEqual([])
  })

  it('commits a setup/edit spawn locally exactly once', () => {
    const sheet = pokemon()
    const { map, controls } = makeControls({ pokemonSheets: [sheet], nextId: 'spawned-1' })

    controls.updatePreview({ position: { x: 1, y: 0, z: 1 }, reachable: true, pathLength: 2 })

    expect(controls.spawnSheetForSetupEdit({ kind: 'pokemon', sheet })).toBe(true)
    expect(map.value.placements).toHaveLength(1)
    expect(map.value.placements[0]).toMatchObject({
      id: 'spawned-1',
      sheetKind: 'pokemon',
      sheetSlug: 'bolt',
      facing: 'south-east',
      turned: false,
    })
    expect(controls.previewState.value).toEqual({ position: null, reachable: false, pathLength: 0 })
    expect(controls.spawnedPokemon.value[0]?.id).toBe('spawned-1')
  })

  it('uses explicit profile-derived token control and keeps deletion GM-only', () => {
    const publicSheet = pokemon({ slug: 'public-mon', player: true })
    const linkedSheet = pokemon({ slug: 'linked-mon', player: false })
    const hiddenTrainer = trainer({ slug: 'hidden-trainer', player: false })
    const map = mapFixture()
    map.placements = [
      { id: 'public-token', sheetKind: 'pokemon', sheetSlug: publicSheet.slug, position: { x: 0, y: 0, z: 0 } },
      { id: 'linked-token', sheetKind: 'pokemon', sheetSlug: linkedSheet.slug, position: { x: 1, y: 0, z: 0 } },
      { id: 'gm-token', sheetKind: 'trainer', sheetSlug: hiddenTrainer.slug, position: { x: 2, y: 0, z: 0 } },
    ]
    const { controls } = makeControls({
      map,
      pokemonSheets: [publicSheet, linkedSheet],
      trainerSheets: [hiddenTrainer],
      isGm: false,
      tokenControl: {
        enabled: ref(true),
        controllablePlacementIds: ref(['linked-token', 'missing-token', 'linked-token']),
      },
    })

    expect(controls.controllablePlacementIds.value).toEqual(['linked-token'])
    controls.selectPlacement('public-token')
    expect(controls.selectedId.value).toBeNull()
    controls.selectPlacement('linked-token')
    controls.selectPlacement('gm-token')
    expect(controls.selectedId.value).toBe('linked-token')

    controls.deletePlacement('linked-token')
    expect(map.placements.map((placement) => placement.id)).toEqual(['public-token', 'linked-token', 'gm-token'])

    controls.turnPlacementForSetupEdit('linked-token')
    expect(map.placements[1]).toMatchObject({ facing: 'north-east', turned: false })
    controls.turnPlacementForSetupEdit('linked-token')
    expect(map.placements[1]).toMatchObject({ facing: 'north-west', turned: true })
  })

  it('lets players send out team Pokémon from controlled linked trainer tokens only', () => {
    const teamPokemon = pokemon({ slug: 'bolt', species: 'Bulbasaur' })
    const linkedTrainer = trainer({ slug: 'ash', currentTeam: ['bolt'] })
    const unlinkedTrainer = trainer({ slug: 'gary', currentTeam: ['bolt'] })
    const map = mapFixture()
    map.placements = [
      { id: 'linked-trainer', sheetKind: 'trainer', sheetSlug: 'ash', position: { x: 1, y: 0, z: 1 } },
      { id: 'unlinked-trainer', sheetKind: 'trainer', sheetSlug: 'gary', position: { x: 4, y: 0, z: 4 } },
    ]
    const { controls } = makeControls({
      map,
      pokemonSheets: [teamPokemon],
      trainerSheets: [linkedTrainer, unlinkedTrainer],
      isGm: false,
      canSendOutTokens: true,
      nextId: 'sent-out-bolt',
      tokenControl: {
        enabled: ref(true),
        controllablePlacementIds: ref(['linked-trainer']),
      },
    })

    expect(Object.keys(controls.tokenSendOutOptionsById.value)).toEqual(['linked-trainer'])
    expect(controls.tokenSendOutOptionsById.value['linked-trainer']?.[0]).toMatchObject({
      pokemonSlug: 'bolt',
      label: 'Bolt (Bulbasaur)',
    })
    expect(controls.canSendOutPokemon({
      trainerId: 'unlinked-trainer',
      pokemonSlug: 'bolt',
      position: { x: 3, y: 0, z: 4 },
    })).toBe(false)

    const placement = controls.createSendOutPokemonPlacement({
      trainerId: 'linked-trainer',
      pokemonSlug: 'bolt',
      position: { x: 3, y: 0, z: 1 },
    })
    expect(placement).toMatchObject({
      id: 'sent-out-bolt',
      sheetKind: 'pokemon',
      sheetSlug: 'bolt',
      position: { x: 3, y: 0, z: 1 },
    })

    expect(controls.sendOutPokemon({
      trainerId: 'linked-trainer',
      pokemonSlug: 'bolt',
      position: { x: 3, y: 0, z: 1 },
    })).toBe(true)
    expect(map.placements.map((entry) => entry.id)).toEqual(['linked-trainer', 'unlinked-trainer', 'sent-out-bolt'])
  })

  it('does not use public player sheet flags as token control without a profile override', () => {
    const playerSheet = pokemon({ slug: 'player-mon', player: true })
    const map = mapFixture()
    map.placements = [
      { id: 'public-token', sheetKind: 'pokemon', sheetSlug: playerSheet.slug, position: { x: 0, y: 0, z: 0 } },
    ]
    const { controls } = makeControls({
      map,
      pokemonSheets: [playerSheet],
      isGm: false,
    })

    expect(controls.controllablePlacementIds.value).toEqual([])
    controls.selectPlacement('public-token')
    controls.turnPlacementForSetupEdit('public-token')
    expect(controls.selectedId.value).toBeNull()
    expect(map.placements[0]?.facing).toBeUndefined()
  })

  it('lets GMs control and delete all tokens without a token-control override', () => {
    const sheet = pokemon({ slug: 'gm-mon', player: false })
    const map = mapFixture()
    map.placements = [
      { id: 'gm-token', sheetKind: 'pokemon', sheetSlug: sheet.slug, position: { x: 0, y: 0, z: 0 } },
    ]
    const { controls } = makeControls({ map, pokemonSheets: [sheet], isGm: true })

    expect(controls.controllablePlacementIds.value).toEqual(['gm-token'])
    controls.deletePlacement('gm-token')
    expect(map.placements).toEqual([])
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
    controls.movePlacementForSetupEdit({ id: 'bolt-token', position: { x: 2, y: 0, z: 1 } })

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

  it('moves a profile-controlled player token through setup/edit map controls', () => {
    const sheet = pokemon({ slug: 'linked-mon', player: false })
    const map = mapFixture()
    map.placements = [
      { id: 'linked-token', sheetKind: 'pokemon', sheetSlug: sheet.slug, position: { x: 0, y: 0, z: 0 } },
    ]
    const { controls } = makeControls({
      map,
      pokemonSheets: [sheet],
      isGm: false,
      now: () => 456,
      tokenControl: {
        enabled: ref(true),
        controllablePlacementIds: ref(['linked-token']),
      },
    })

    controls.selectPlacement('linked-token')
    controls.updatePreview({ position: { x: 2, y: 0, z: 1 }, reachable: true, pathLength: 3 })
    controls.movePlacementForSetupEdit({ id: 'linked-token', position: { x: 2, y: 0, z: 1 } })

    expect(map.placements[0]?.position).toEqual({ x: 2, y: 0, z: 1 })
    expect(map.placements[0]).toMatchObject({ facing: 'south-east', turned: false })
    expect(map.metadata?.movementLog).toMatchObject([{
      at: 456,
      userId: 'linked-token',
      userName: 'Bolt',
      pathLength: 3,
    }])
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

    controls.movePlacementForSetupEdit({ id: 'bolt-token', position: { x: 1, y: 0, z: 2 } })

    expect(map.placements[0]).toMatchObject({ facing: 'south-west', turned: false })
  })

  it('does not log movement when the token stays in place', () => {
    const sheet = pokemon()
    const map = mapFixture()
    map.placements = [
      { id: 'bolt-token', sheetKind: 'pokemon', sheetSlug: sheet.slug, position: { x: 0, y: 0, z: 0 } },
    ]
    const { controls } = makeControls({ map, pokemonSheets: [sheet] })

    controls.movePlacementForSetupEdit({ id: 'bolt-token', position: { x: 0, y: 0, z: 0 } })

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
