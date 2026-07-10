import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import {
  allocateMapEncounterSideId,
  useMapEncounterSides,
} from '~/composables/map-editor/useMapEncounterSides'
import type { TabletopMap } from '~/types/map'

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 3,
  slug: 'side-editor',
  name: 'Side Editor',
  dimensions: { x: 8, y: 2, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    { id: 'trainer-a', sheetKind: 'trainer', sheetSlug: 'ash', position: { x: 1, y: 0, z: 1 } },
    { id: 'pokemon-a', sheetKind: 'pokemon', sheetSlug: 'pikachu', position: { x: 2, y: 0, z: 1 } },
    { id: 'pokemon-b', sheetKind: 'pokemon', sheetSlug: 'eevee', position: { x: 5, y: 0, z: 5 } },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  encounterState: createEmptyEncounterState(),
  ...overrides,
})

const makeEditor = (options: {
  map?: TabletopMap
  isGm?: boolean
  setupEditActive?: boolean
} = {}) => {
  const map = ref<TabletopMap | null>(options.map ?? mapFixture())
  const isGm = ref(options.isGm ?? true)
  const setupEditActive = ref(options.setupEditActive ?? true)
  return {
    map,
    isGm,
    setupEditActive,
    editor: useMapEncounterSides({ map, isGm, setupEditActive }),
  }
}

describe('useMapEncounterSides', () => {
  it('allocates bounded immutable IDs from labels and resolves collisions', () => {
    expect(allocateMapEncounterSideId('Team Héroes!', [])).toBe('team-heroes')
    expect(allocateMapEncounterSideId('Team Heroes', ['team-heroes'])).toBe('team-heroes-2')
    expect(allocateMapEncounterSideId('🔥', ['side', 'side-2'])).toBe('side-3')
    expect(allocateMapEncounterSideId('a'.repeat(100), [])).toHaveLength(64)
  })

  it('creates, renames, archives, and reactivates canonical sides', () => {
    const { map, editor } = makeEditor()

    const heroes = editor.addEncounterSide({ label: '  Team Heroes  ', color: '#AABBCC' })
    const rivals = editor.addEncounterSide({ label: 'Team Heroes', color: '#334455' })

    expect(heroes).toEqual({ id: 'team-heroes', label: 'Team Heroes', color: '#aabbcc', status: 'active' })
    expect(rivals?.id).toBe('team-heroes-2')
    expect(Object.keys(map.value!.encounterState!.sides)).toEqual(['team-heroes', 'team-heroes-2'])

    expect(editor.updateEncounterSide('team-heroes', { label: 'Allies', color: null })).toBe(true)
    expect(map.value!.encounterState!.sides['team-heroes']).toEqual({
      id: 'team-heroes',
      label: 'Allies',
      status: 'active',
    })

    expect(editor.setEncounterSideStatus('team-heroes', 'inactive')).toBe(true)
    expect(map.value!.encounterState!.sides['team-heroes']?.status).toBe('inactive')
    expect(editor.setEncounterSideStatus('team-heroes', 'active')).toBe(true)
    expect(map.value!.encounterState!.sides['team-heroes']?.status).toBe('active')
    expect(editor.encounterSideError.value).toBeNull()
  })

  it('bulk assigns selected placements and can restore unknown allegiance', () => {
    const map = mapFixture({
      encounterState: {
        ...createEmptyEncounterState(),
        sides: {
          heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
          rivals: { id: 'rivals', label: 'Rivals', status: 'active' },
        },
      },
    })
    const { editor } = makeEditor({ map })

    expect(editor.assignPlacementsToEncounterSide({
      placementIds: ['trainer-a', 'pokemon-a', 'trainer-a'],
      sideId: 'heroes',
    })).toBe(true)
    expect(map.placements.map(placement => placement.sideId)).toEqual(['heroes', 'heroes', undefined])

    expect(editor.assignPlacementsToEncounterSide({
      placementIds: ['pokemon-a'],
      sideId: null,
    })).toBe(true)
    expect(map.placements.map(placement => placement.sideId)).toEqual(['heroes', undefined, undefined])
  })

  it('keeps archived assignments but rejects new archived or stale placement assignments atomically', () => {
    const map = mapFixture({
      encounterState: {
        ...createEmptyEncounterState(),
        sides: {
          legacy: { id: 'legacy', label: 'Legacy Side', status: 'inactive' },
        },
      },
      placements: [
        { id: 'legacy-token', sheetKind: 'pokemon', sheetSlug: 'eevee', position: { x: 1, y: 0, z: 1 }, sideId: 'legacy' },
        { id: 'new-token', sheetKind: 'pokemon', sheetSlug: 'pikachu', position: { x: 2, y: 0, z: 1 } },
      ],
    })
    const { editor } = makeEditor({ map })

    expect(editor.assignPlacementsToEncounterSide({ placementIds: ['new-token'], sideId: 'legacy' })).toBe(false)
    expect(editor.encounterSideError.value).toContain('active encounter side')
    expect(map.placements.map(placement => placement.sideId)).toEqual(['legacy', undefined])

    expect(editor.assignPlacementsToEncounterSide({
      placementIds: ['new-token', 'removed-token'],
      sideId: null,
    })).toBe(false)
    expect(editor.encounterSideError.value).toContain('removed-token')
    expect(map.placements.map(placement => placement.sideId)).toEqual(['legacy', undefined])
  })

  it('does not mutate side records or assignments for players or during live play', () => {
    const playerMap = mapFixture()
    const player = makeEditor({ map: playerMap, isGm: false, setupEditActive: true })

    expect(player.editor.canEditEncounterSides.value).toBe(false)
    expect(player.editor.addEncounterSide({ label: 'Player Side' })).toBeNull()
    expect(player.editor.assignPlacementsToEncounterSide({
      placementIds: ['trainer-a'],
      sideId: null,
    })).toBe(false)
    expect(playerMap.encounterState?.sides).toEqual({})
    expect(playerMap.placements[0]).not.toHaveProperty('sideId')

    const liveMap = mapFixture({
      encounterState: {
        ...createEmptyEncounterState(),
        sides: { heroes: { id: 'heroes', label: 'Heroes', status: 'active' } },
      },
    })
    const live = makeEditor({ map: liveMap, isGm: true, setupEditActive: false })

    expect(live.editor.updateEncounterSide('heroes', { label: 'Changed' })).toBe(false)
    expect(live.editor.setEncounterSideStatus('heroes', 'inactive')).toBe(false)
    expect(live.editor.assignPlacementsToEncounterSide({ placementIds: ['trainer-a'], sideId: 'heroes' })).toBe(false)
    expect(liveMap.encounterState?.sides.heroes).toEqual({ id: 'heroes', label: 'Heroes', status: 'active' })
    expect(liveMap.placements[0]).not.toHaveProperty('sideId')
  })
})
