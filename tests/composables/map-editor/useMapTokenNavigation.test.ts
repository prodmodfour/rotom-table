import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  resolvePlacementPokedexHref,
  resolvePlacementSheetHref,
  useMapTokenNavigation,
} from '~/composables/map-editor/useMapTokenNavigation'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'

const pokemonSheet = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'spark',
  species: 'Mr. Mime',
  nickname: 'Spark',
  level: 5,
  stats: {},
  ...overrides,
} as CharacterSheet)

const placement = (overrides: Partial<SheetPlacement> = {}): SheetPlacement => ({
  id: 'token-1',
  sheetKind: 'pokemon',
  sheetSlug: 'spark',
  position: { x: 0, y: 0, z: 0 },
  turned: false,
  ...overrides,
})

const mapFixture = (placements: SheetPlacement[] = [placement()]): TabletopMap => ({
  schemaVersion: 2,
  slug: 'navigation-map',
  name: 'Navigation Map',
  dimensions: { x: 6, y: 2, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements,
  lights: [],
  initiative: { activeId: null, round: 1 },
})

describe('map token navigation helpers', () => {
  it('resolves sheet and Pokédex hrefs through the injected route resolver', () => {
    const resolve = (path: string) => `/resolved${path}`
    const pokemonBySlug = new Map([['spark', pokemonSheet()]])

    expect(resolvePlacementSheetHref(placement({ sheetSlug: 'party mon' }), resolve))
      .toBe('/resolved/sheets/party%20mon')
    expect(resolvePlacementPokedexHref(placement(), pokemonBySlug, resolve))
      .toBe('/resolved/pokedex/mr-mime')
    expect(resolvePlacementPokedexHref(placement({ sheetKind: 'trainer' }), pokemonBySlug, resolve))
      .toBeNull()
    expect(resolvePlacementPokedexHref(placement({ sheetSlug: 'missing' }), pokemonBySlug, resolve))
      .toBeNull()
  })

  it('opens controlled token sheet and Pokédex links', () => {
    const map = ref<TabletopMap | null>(mapFixture())
    const pokemonBySlug = ref(new Map([['spark', pokemonSheet({ species: 'Flabébé’s Form' })]]))
    const opened: string[] = []
    const navigation = useMapTokenNavigation({
      map,
      pokemonBySlug,
      canControlPlacement: (id) => id === 'token-1',
      placementById: (id) => map.value?.placements.find((candidate) => candidate.id === id) ?? null,
      resolvePath: (path) => `href:${path}`,
      openHref: (href) => opened.push(href),
    })

    expect(navigation.viewSheet('token-1')).toBe(true)
    expect(navigation.viewPokedex('token-1')).toBe(true)
    expect(opened).toEqual([
      'href:/sheets/spark',
      'href:/pokedex/flabebes-form',
    ])
  })

  it('blocks uncontrolled, missing-map, non-Pokémon, and missing-species navigation', () => {
    const trainerPlacement = placement({ id: 'trainer-token', sheetKind: 'trainer', sheetSlug: 'npc' })
    const map = ref<TabletopMap | null>(mapFixture([placement(), trainerPlacement]))
    const pokemonBySlug = ref(new Map([['spark', pokemonSheet({ species: '' })]]))
    const openHref = vi.fn()
    const navigation = useMapTokenNavigation({
      map,
      pokemonBySlug,
      canControlPlacement: (id) => id !== 'blocked-token',
      placementById: (id) => map.value?.placements.find((candidate) => candidate.id === id) ?? null,
      openHref,
    })

    expect(navigation.viewSheet('blocked-token')).toBe(false)
    expect(navigation.viewPokedex('token-1')).toBe(false)
    expect(navigation.viewPokedex('trainer-token')).toBe(false)

    map.value = null
    expect(navigation.viewSheet('token-1')).toBe(false)
    expect(openHref).not.toHaveBeenCalled()
  })
})
