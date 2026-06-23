import { describe, expect, it } from 'vitest'
import {
  buildLiveSheetKey,
  buildLiveSheetMaps,
  createLiveSheetCacheController,
} from '~/utils/liveSheetCache'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

const pokemon = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'bolt',
  nickname: 'Bolt',
  species: 'Pikachu',
  level: 5,
  revision: 0,
  ...overrides,
})

const trainer = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'ash',
  name: 'Ash',
  level: 1,
  revision: 0,
  ...overrides,
})

describe('live sheet cache controller', () => {
  it('fully replaces a sheet with a higher revision and removes missing fields', () => {
    const maps = buildLiveSheetMaps([
      pokemon({ revision: 1, combat: { currentHp: 20 }, folder: 'old-folder' }),
    ], [])
    const controller = createLiveSheetCacheController(maps)

    const result = controller.adoptCompleteSheet('pokemon', pokemon({
      revision: 2,
      nickname: 'Bolt Prime',
    }))

    expect(result).toEqual({ status: 'adopted' })
    expect(maps.pokemonBySlug.get('bolt')).toMatchObject({ nickname: 'Bolt Prime', revision: 2 })
    expect(maps.pokemonBySlug.get('bolt')).not.toHaveProperty('combat')
    expect(maps.pokemonBySlug.get('bolt')).not.toHaveProperty('folder')
  })

  it('ignores a lower revision sheet', () => {
    const maps = buildLiveSheetMaps([pokemon({ revision: 3, nickname: 'Current' })], [])
    const controller = createLiveSheetCacheController(maps)

    const result = controller.adoptCompleteSheet('pokemon', pokemon({ revision: 2, nickname: 'Older' }))

    expect(result).toEqual({ status: 'ignored-stale' })
    expect(maps.pokemonBySlug.get('bolt')?.nickname).toBe('Current')
  })

  it('treats an equal-revision identical sheet as unchanged', () => {
    const sheet = pokemon({ revision: 4, nickname: 'Same' })
    const maps = buildLiveSheetMaps([sheet], [])
    const controller = createLiveSheetCacheController(maps)

    const result = controller.adoptCompleteSheet('pokemon', { ...sheet })

    expect(result).toEqual({ status: 'unchanged' })
    expect(controller.mutationSequence).toBe(0)
  })

  it('reports equal-revision divergent persisted contents as a conflict', () => {
    const maps = buildLiveSheetMaps([pokemon({ revision: 4, nickname: 'Local' })], [])
    const controller = createLiveSheetCacheController(maps)

    const result = controller.adoptCompleteSheet('pokemon', pokemon({ revision: 4, nickname: 'Divergent' }))

    expect(result.status).toBe('conflict')
    expect(maps.pokemonBySlug.get('bolt')?.nickname).toBe('Local')
  })

  it('preserves only explicit client access annotations when command/SSE documents omit them', () => {
    const maps = buildLiveSheetMaps([
      pokemon({
        revision: 1,
        folder: 'old-folder',
        playerProfileAccessible: true,
        sessionPlayerAccessible: true,
        combat: { currentHp: 12 },
        ...({ unknownClientField: 'do-not-preserve' } as Record<string, unknown>),
      }),
    ], [])
    const controller = createLiveSheetCacheController(maps)

    const result = controller.adoptCompleteSheet('pokemon', pokemon({ revision: 2, nickname: 'Server' }), {
      preserveClientAccessAnnotations: true,
    })

    expect(result).toEqual({ status: 'adopted' })
    expect(maps.pokemonBySlug.get('bolt')).toMatchObject({
      nickname: 'Server',
      playerProfileAccessible: true,
      sessionPlayerAccessible: true,
    })
    expect(maps.pokemonBySlug.get('bolt')).not.toHaveProperty('folder')
    expect(maps.pokemonBySlug.get('bolt')).not.toHaveProperty('combat')
    expect(maps.pokemonBySlug.get('bolt')).not.toHaveProperty('unknownClientField')
  })

  it('does not preserve access annotations across an access-scope change', () => {
    const maps = buildLiveSheetMaps([], [])
    const controller = createLiveSheetCacheController(maps)
    const profileAToken = controller.beginAuthoritativeLoad('player:profile-a')
    expect(controller.adoptAuthoritativeSet({
      pokemonSheets: [pokemon({ playerProfileAccessible: true })],
      trainerSheets: [],
    }, profileAToken).status).toBe('applied')

    const profileBToken = controller.beginAuthoritativeLoad('player:profile-b')
    expect(controller.adoptAuthoritativeSet({
      pokemonSheets: [pokemon()],
      trainerSheets: [],
    }, profileBToken).status).toBe('applied')

    expect(maps.pokemonBySlug.get('bolt')).not.toHaveProperty('playerProfileAccessible')
    expect(controller.hydrated).toBe(true)
  })

  it('prevents a delayed list response from overwriting a newer SSE update', () => {
    const maps = buildLiveSheetMaps([pokemon({ revision: 1, nickname: 'Before request' })], [])
    const controller = createLiveSheetCacheController(maps)
    const token = controller.beginAuthoritativeLoad('gm')

    controller.applyRealtimeEvent({
      type: 'updated',
      data: { kind: 'pokemon', slug: 'bolt', sheet: pokemon({ revision: 2, nickname: 'SSE newer' }) },
    })
    const result = controller.adoptAuthoritativeSet({
      pokemonSheets: [pokemon({ revision: 1, nickname: 'Delayed HTTP' })],
      trainerSheets: [],
    }, token)

    expect(result.status).toBe('applied')
    expect(maps.pokemonBySlug.get('bolt')?.nickname).toBe('SSE newer')
  })

  it('prevents a delayed list response from removing a sheet created by SSE after the request began', () => {
    const maps = buildLiveSheetMaps([], [])
    const controller = createLiveSheetCacheController(maps)
    const token = controller.beginAuthoritativeLoad('gm')

    controller.applyRealtimeEvent({
      type: 'created',
      data: { kind: 'pokemon', slug: 'bolt', sheet: pokemon({ revision: 0 }) },
    })
    const result = controller.adoptAuthoritativeSet({ pokemonSheets: [], trainerSheets: [] }, token)

    expect(result.status).toBe('applied')
    expect(maps.pokemonBySlug.has('bolt')).toBe(true)
  })

  it('prevents a delayed list response from resurrecting a sheet deleted by SSE after the request began', () => {
    const maps = buildLiveSheetMaps([], [])
    const controller = createLiveSheetCacheController(maps)
    const initialToken = controller.beginAuthoritativeLoad('gm')
    controller.adoptAuthoritativeSet({ pokemonSheets: [pokemon({ revision: 1 })], trainerSheets: [] }, initialToken)
    const delayedToken = controller.beginAuthoritativeLoad('gm')

    controller.applyRealtimeEvent({ type: 'deleted', data: { kind: 'pokemon', slug: 'bolt' } })
    const result = controller.adoptAuthoritativeSet({
      pokemonSheets: [pokemon({ revision: 1, nickname: 'Resurrected' })],
      trainerSheets: [],
    }, delayedToken)

    expect(result.status).toBe('applied')
    expect(maps.pokemonBySlug.has('bolt')).toBe(false)
  })

  it('ignores a superseded HTTP response instead of replacing the newer response', () => {
    const maps = buildLiveSheetMaps([], [])
    const controller = createLiveSheetCacheController(maps)
    const olderToken = controller.beginAuthoritativeLoad('gm')
    const newerToken = controller.beginAuthoritativeLoad('gm')

    const newerResult = controller.adoptAuthoritativeSet({
      pokemonSheets: [pokemon({ revision: 1, nickname: 'Newer response' })],
      trainerSheets: [],
    }, newerToken)
    const olderResult = controller.adoptAuthoritativeSet({
      pokemonSheets: [pokemon({ revision: 0, nickname: 'Older response' })],
      trainerSheets: [],
    }, olderToken)

    expect(newerResult.status).toBe('applied')
    expect(olderResult.status).toBe('ignored-superseded')
    expect(maps.pokemonBySlug.get('bolt')?.nickname).toBe('Newer response')
  })

  it('ignores a response for profile A after the scope has changed to profile B', () => {
    const maps = buildLiveSheetMaps([], [])
    const controller = createLiveSheetCacheController(maps)
    const profileAToken = controller.beginAuthoritativeLoad('player:profile-a')
    const profileBToken = controller.beginAuthoritativeLoad('player:profile-b')

    controller.adoptAuthoritativeSet({
      pokemonSheets: [pokemon({ revision: 0, nickname: 'Profile B' })],
      trainerSheets: [],
    }, profileBToken)
    const staleProfileAResult = controller.adoptAuthoritativeSet({
      pokemonSheets: [pokemon({ revision: 0, nickname: 'Profile A' })],
      trainerSheets: [],
    }, profileAToken)

    expect(staleProfileAResult.status).toBe('ignored-superseded')
    expect(maps.pokemonBySlug.get('bolt')?.nickname).toBe('Profile B')
  })

  it('applies renamed events by tombstoning the old key and adopting the new complete sheet', () => {
    const maps = buildLiveSheetMaps([pokemon({ slug: 'old-bolt', revision: 1 })], [])
    const controller = createLiveSheetCacheController(maps)

    const result = controller.applyRealtimeEvent({
      type: 'renamed',
      data: {
        kind: 'pokemon',
        oldSlug: 'old-bolt',
        newSlug: 'new-bolt',
        sheet: pokemon({ slug: 'new-bolt', revision: 2, nickname: 'New Bolt' }),
      },
    })

    expect(result.status).toBe('adopted')
    expect(maps.pokemonBySlug.has('old-bolt')).toBe(false)
    expect(maps.pokemonBySlug.get('new-bolt')).toMatchObject({ nickname: 'New Bolt', revision: 2 })
    expect(controller.tombstoneForKey(buildLiveSheetKey('pokemon', 'old-bolt'))).toMatchObject({ reason: 'renamed-away' })
  })

  it('treats duplicate realtime events as harmless', () => {
    const maps = buildLiveSheetMaps([], [])
    const controller = createLiveSheetCacheController(maps)
    const event = {
      type: 'updated',
      data: { kind: 'trainer', slug: 'ash', sheet: trainer({ revision: 3, name: 'Ash Ketchum' }) },
    }

    expect(controller.applyRealtimeEvent(event).status).toBe('adopted')
    expect(controller.applyRealtimeEvent(event).status).toBe('unchanged')
    expect(maps.trainerBySlug.get('ash')?.name).toBe('Ash Ketchum')
  })

  it('marks incomplete move events for reconciliation without patching sheet fields', () => {
    const maps = buildLiveSheetMaps([pokemon({ folder: 'old-folder', revision: 1 })], [])
    const controller = createLiveSheetCacheController(maps)

    const result = controller.applyRealtimeEvent({
      type: 'moved',
      data: { kind: 'pokemon', slug: 'bolt', folder: 'new-folder' },
    })

    expect(result.status).toBe('invalidated')
    expect(controller.reconciliationRequired).toBe(true)
    expect(controller.lastMutationSequenceForKey(buildLiveSheetKey('pokemon', 'bolt'))).toBeGreaterThan(0)
    expect(maps.pokemonBySlug.get('bolt')?.folder).toBe('old-folder')
  })
})
