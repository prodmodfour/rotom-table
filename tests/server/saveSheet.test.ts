import { describe, expect, it, vi } from 'vitest'
import { MAP_INTERACTION_MODES } from '../../shared/mapInteractionMode'
import { SaveSheetUseCaseError, saveSheetUseCase } from '../../server/useCases/saveSheet'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '../../shared/playerProfiles'
import type { SheetKind } from '../../shared/sheets'

const playerProfile = (linkedCharacters: PlayerProfile['linkedCharacters']): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_ash00000' as PlayerProfileId,
  displayName: 'Ash' as PlayerProfileDisplayName,
  linkedCharacters,
})

const createDeps = () => {
  const writes: Array<{ path: string; sheet: Record<string, unknown> }> = []
  return {
    writes,
    deps: {
      findSheetPath: vi.fn((_kind: SheetKind, slug: string): string | null => `/repo/data/sheets/${slug}.json`),
      isPlayerAccessible: vi.fn(() => true),
      stripDerivedFields: vi.fn((sheet: Record<string, unknown>) => {
        const out = { ...sheet }
        delete out.folder
        return out
      }),
      writeSheet: vi.fn((path: string, sheet: Record<string, unknown>) => {
        writes.push({ path, sheet })
      }),
      retargetMapSheetPlacements: vi.fn(() => []),
      relativePath: vi.fn((path: string) => path.replace('/repo/', '')),
    },
  }
}

describe('save sheet use case', () => {
  it('writes a GM sheet save, strips derived fields, and emits compatible realtime events', () => {
    const { deps, writes } = createDeps()

    const result = saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'pika',
      sheet: { slug: 'pika', nickname: 'Pika', folder: 'party', player: false },
      clientId: 'client-1',
    }, deps)

    expect(deps.findSheetPath).toHaveBeenCalledWith('pokemon', 'pika')
    expect(deps.isPlayerAccessible).not.toHaveBeenCalled()
    expect(writes).toEqual([
      {
        path: '/repo/data/sheets/pika.json',
        sheet: { revision: 0, slug: 'pika', nickname: 'Pika', player: false },
      },
    ])
    expect(result).toMatchObject({
      ok: true,
      path: 'data/sheets/pika.json',
      sheet: { revision: 0, slug: 'pika', nickname: 'Pika', player: false },
    })
    expect(result.events).toEqual([
      {
        channel: 'sheet:pokemon:pika',
        type: 'updated',
        clientId: 'client-1',
        data: {
          kind: 'pokemon',
          slug: 'pika',
          sheet: { revision: 0, slug: 'pika', nickname: 'Pika', player: false },
        },
      },
      {
        channel: 'sheets',
        type: 'updated',
        clientId: 'client-1',
        data: {
          kind: 'pokemon',
          slug: 'pika',
          sheet: { revision: 0, slug: 'pika', nickname: 'Pika', player: false },
        },
      },
    ])
  })

  it('preserves existing sheet revisions when compatibility saves omit them', () => {
    const { deps, writes } = createDeps()
    const depsWithExisting = {
      ...deps,
      readExistingSheet: vi.fn(() => ({ slug: 'pika', nickname: 'Pika', revision: 8 })),
    }

    const result = saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'pika',
      sheet: { slug: 'pika', nickname: 'Pika' },
    }, depsWithExisting)

    expect(writes[0]?.sheet.revision).toBe(8)
    expect(result.sheet.revision).toBe(8)
  })

  it('preserves provided sheet revisions on save', () => {
    const { deps, writes } = createDeps()

    const result = saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'pika',
      sheet: { revision: 11, slug: 'pika', nickname: 'Pika' },
    }, deps)

    expect(writes[0]?.sheet.revision).toBe(11)
    expect(result.sheet.revision).toBe(11)
  })

  it('allows player saves only for player-accessible sheets and preserves player access', () => {
    const { deps, writes } = createDeps()

    const result = saveSheetUseCase({
      role: 'player',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'trainer',
      slug: 'brock',
      sheet: { slug: 'brock', name: 'Brock', folder: 'gym', player: false },
    }, deps)

    expect(deps.isPlayerAccessible).toHaveBeenCalledWith('trainer', 'brock')
    expect(writes).toEqual([
      {
        path: '/repo/data/sheets/brock.json',
        sheet: { revision: 0, slug: 'brock', name: 'Brock', player: true },
      },
    ])
    expect(result.events[0]?.data).toEqual({
      kind: 'trainer',
      slug: 'brock',
      sheet: { revision: 0, slug: 'brock', name: 'Brock', player: true },
    })
  })

  it('allows player saves for linked private profile sheets without making them public or renaming resources', () => {
    const { deps, writes } = createDeps()
    deps.isPlayerAccessible.mockReturnValue(false)
    const depsWithExisting = {
      ...deps,
      readExistingSheet: vi.fn(() => ({ slug: 'brock', name: 'Brock', player: false })),
    }

    const result = saveSheetUseCase({
      role: 'player',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'trainer',
      slug: 'brock',
      sheet: {
        slug: 'brock',
        name: 'Brock Prime',
        level: 6,
        folder: 'gm/private',
        player: true,
        playerProfileAccessible: true,
        sessionPlayerAccessible: true,
      },
      playerProfile: playerProfile([{ sheetKind: 'trainer', sheetSlug: 'brock' }]),
    }, depsWithExisting)

    expect(deps.isPlayerAccessible).toHaveBeenCalledWith('trainer', 'brock')
    expect(depsWithExisting.readExistingSheet).toHaveBeenCalledWith('/repo/data/sheets/brock.json')
    expect(writes).toEqual([
      {
        path: '/repo/data/sheets/brock.json',
        sheet: { revision: 0, slug: 'brock', name: 'Brock Prime', level: 6, player: false },
      },
    ])
    expect(result.events[0]?.data).toEqual({
      kind: 'trainer',
      slug: 'brock',
      sheet: { revision: 0, slug: 'brock', name: 'Brock Prime', level: 6, player: false },
    })
  })

  it('allows player saves for private Pokémon linked through their selected trainer', () => {
    const { deps, writes } = createDeps()
    deps.isPlayerAccessible.mockReturnValue(false)
    const depsWithTrainerLinks = {
      ...deps,
      readExistingSheet: vi.fn(() => ({ slug: 'pika', nickname: 'Pika', player: false })),
      listTrainerSheets: vi.fn(() => [{ slug: 'ash', currentTeam: ['pika'] }]),
    }

    expect(saveSheetUseCase({
      role: 'player',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'pika',
      sheet: { slug: 'pika', nickname: 'Pika Prime', player: true, playerProfileAccessible: true },
      playerProfile: playerProfile([{ sheetKind: 'trainer', sheetSlug: 'ash' }]),
    }, depsWithTrainerLinks)).toMatchObject({
      ok: true,
      slug: 'pika',
      sheet: { revision: 0, slug: 'pika', nickname: 'Pika Prime', player: false },
    })

    expect(depsWithTrainerLinks.listTrainerSheets).toHaveBeenCalledOnce()
    expect(writes).toEqual([
      {
        path: '/repo/data/sheets/pika.json',
        sheet: { revision: 0, slug: 'pika', nickname: 'Pika Prime', player: false },
      },
    ])
  })

  it('preserves existing move usage when a general sheet save omits it', () => {
    const { deps, writes } = createDeps()
    const moveUsage = { daily: { thunderbolt: { moveName: 'Thunderbolt', uses: 1 } } }
    const depsWithExisting = {
      ...deps,
      readExistingSheet: vi.fn(() => ({ slug: 'pika', nickname: 'Pika', moveUsage })),
    }

    const result = saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'pika',
      sheet: { slug: 'pika', nickname: 'Pika' },
    }, depsWithExisting)

    expect(writes).toEqual([
      {
        path: '/repo/data/sheets/pika.json',
        sheet: { revision: 0, slug: 'pika', nickname: 'Pika', moveUsage },
      },
    ])
    expect(result.sheet.moveUsage).toBe(moveUsage)
  })

  it('preserves the current slug when slug sync is disabled for a display-name mismatch', () => {
    const { deps, writes } = createDeps()

    const result = saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'examples-abra',
      sheet: { revision: 0, slug: 'examples-abra', nickname: 'Abra', player: false },
      clientId: 'client-1',
      allowSlugSync: false,
    }, deps)

    expect(writes).toEqual([
      {
        path: '/repo/data/sheets/examples-abra.json',
        sheet: { revision: 0, slug: 'examples-abra', nickname: 'Abra', player: false },
      },
    ])
    expect(result).toMatchObject({
      ok: true,
      slug: 'examples-abra',
      sheet: { revision: 0, slug: 'examples-abra', nickname: 'Abra', player: false },
    })
    expect(result.events).toEqual([
      {
        channel: 'sheet:pokemon:examples-abra',
        type: 'updated',
        clientId: 'client-1',
        data: {
          kind: 'pokemon',
          slug: 'examples-abra',
          sheet: { revision: 0, slug: 'examples-abra', nickname: 'Abra', player: false },
        },
      },
      {
        channel: 'sheets',
        type: 'updated',
        clientId: 'client-1',
        data: {
          kind: 'pokemon',
          slug: 'examples-abra',
          sheet: { revision: 0, slug: 'examples-abra', nickname: 'Abra', player: false },
        },
      },
    ])
  })

  it('renames the persisted file and emitted slug when the display name changes', () => {
    const writes: Array<{ path: string; sheet: Record<string, unknown> }> = []
    const renames: Array<{ from: string; to: string }> = []
    const existingPaths = new Set(['/repo/data/sheets/pika.json'])
    const deps = {
      findSheetPath: vi.fn((_kind: SheetKind, slug: string): string | null => (
        slug === 'pika' ? '/repo/data/sheets/pika.json' : null
      )),
      findSlugPath: vi.fn(() => null),
      isPlayerAccessible: vi.fn(() => true),
      stripDerivedFields: vi.fn((sheet: Record<string, unknown>) => ({ ...sheet })),
      writeSheet: vi.fn((path: string, sheet: Record<string, unknown>) => {
        writes.push({ path, sheet })
      }),
      retargetMapSheetPlacements: vi.fn(() => []),
      pathExists: vi.fn((path: string) => existingPaths.has(path)),
      renameSheetPath: vi.fn((from: string, to: string) => {
        renames.push({ from, to })
        existingPaths.delete(from)
        existingPaths.add(to)
      }),
      allocateSlug: vi.fn((_kind: SheetKind, base: string) => `${base.toLowerCase().replace(/\s+/g, '-')}-1`),
      relativePath: vi.fn((path: string) => path.replace('/repo/', '')),
    }

    const result = saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'pika',
      sheet: { slug: 'pika', nickname: 'Spark Prime', player: false },
      clientId: 'client-1',
    }, deps)

    expect(renames).toEqual([
      { from: '/repo/data/sheets/pika.json', to: '/repo/data/sheets/spark-prime.json' },
    ])
    expect(writes).toEqual([
      {
        path: '/repo/data/sheets/spark-prime.json',
        sheet: { revision: 0, slug: 'spark-prime', nickname: 'Spark Prime', player: false },
      },
    ])
    expect(result).toMatchObject({
      ok: true,
      slug: 'spark-prime',
      path: 'data/sheets/spark-prime.json',
      sheet: { revision: 0, slug: 'spark-prime', nickname: 'Spark Prime', player: false },
    })
    expect(result.events).toEqual([
      {
        channel: 'sheet:pokemon:pika',
        type: 'renamed',
        clientId: 'client-1',
        data: {
          kind: 'pokemon',
          slug: 'spark-prime',
          oldSlug: 'pika',
          newSlug: 'spark-prime',
          sheet: { revision: 0, slug: 'spark-prime', nickname: 'Spark Prime', player: false },
        },
      },
      {
        channel: 'sheet:pokemon:spark-prime',
        type: 'updated',
        clientId: 'client-1',
        data: {
          kind: 'pokemon',
          slug: 'spark-prime',
          sheet: { revision: 0, slug: 'spark-prime', nickname: 'Spark Prime', player: false },
        },
      },
      {
        channel: 'sheets',
        type: 'renamed',
        clientId: 'client-1',
        data: {
          kind: 'pokemon',
          slug: 'spark-prime',
          oldSlug: 'pika',
          newSlug: 'spark-prime',
          sheet: { revision: 0, slug: 'spark-prime', nickname: 'Spark Prime', player: false },
        },
      },
    ])
  })

  it('retargets map placements and emits map updates when a save renames a sheet slug', () => {
    const writes: Array<{ path: string; sheet: Record<string, unknown> }> = []
    const arenaMap = {
      schemaVersion: 2 as const,
      revision: 2,
      slug: 'arena',
      name: 'Arena',
      folder: 'routes',
      dimensions: { x: 10, y: 1, z: 10 },
      voxels: [],
      placements: [
        {
          id: 'token-1',
          sheetKind: 'pokemon' as const,
          sheetSlug: 'pika-prime',
          position: { x: 1, y: 0, z: 1 },
        },
      ],
      playerVisible: true,
      updatedAt: 123,
    }
    const deps = {
      findSheetPath: vi.fn((_kind: SheetKind, slug: string): string | null => (
        slug === 'pika' ? '/repo/data/sheets/pika.json' : null
      )),
      findSlugPath: vi.fn(() => null),
      isPlayerAccessible: vi.fn(() => true),
      stripDerivedFields: vi.fn((sheet: Record<string, unknown>) => ({ ...sheet })),
      writeSheet: vi.fn((path: string, sheet: Record<string, unknown>) => {
        writes.push({ path, sheet })
      }),
      retargetMapSheetPlacements: vi.fn(() => [{ path: '/repo/data/maps/arena.json', map: arenaMap, placementCount: 1 }]),
      pathExists: vi.fn(() => false),
      renameSheetPath: vi.fn(),
      allocateSlug: vi.fn(),
      relativePath: vi.fn((path: string) => path.replace('/repo/', '')),
    }

    const result = saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'pika',
      sheet: { revision: 0, slug: 'pika', nickname: 'Pika Prime', player: false },
      clientId: 'client-1',
    }, deps)

    expect(deps.retargetMapSheetPlacements).toHaveBeenCalledWith('pokemon', 'pika', 'pika-prime')
    expect(result.events.slice(-2)).toEqual([
      {
        channel: 'map:arena',
        type: 'updated',
        revision: 2,
        clientId: 'client-1',
        data: arenaMap,
      },
      {
        channel: 'maps',
        type: 'updated',
        revision: 2,
        clientId: 'client-1',
        data: {
          slug: 'arena',
          name: 'Arena',
          folder: 'routes',
          dimensions: { x: 10, y: 1, z: 10 },
          placementCount: 1,
          playerVisible: true,
          schemaVersion: 2,
          revision: 2,
          updatedAt: 123,
        },
      },
    ])
    expect(writes).toEqual([
      {
        path: '/repo/data/sheets/pika-prime.json',
        sheet: { revision: 0, slug: 'pika-prime', nickname: 'Pika Prime', player: false },
      },
    ])
  })

  it('rejects live-play whole-sheet saves before persistence', () => {
    const { deps, writes } = createDeps()

    expect(() => saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
      kind: 'pokemon',
      slug: 'pika',
      sheet: { slug: 'pika' },
    }, deps)).toThrow('Whole-sheet saves are setup/edit-only; live play must use sheet command routes')
    expect(deps.findSheetPath).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })

  it('rejects payload slug mismatches before persistence', () => {
    const { deps, writes } = createDeps()

    expect(() => saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'pika',
      sheet: { slug: 'raichu' },
    }, deps)).toThrow(SaveSheetUseCaseError)

    try {
      saveSheetUseCase({ role: 'gm', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT, kind: 'pokemon', slug: 'pika', sheet: { slug: 'raichu' } }, deps)
    } catch (err) {
      expect(err).toMatchObject({
        statusCode: 400,
        message: 'sheet.slug "raichu" must match request slug "pika"',
      })
    }
    expect(deps.findSheetPath).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })

  it('maps missing sheets to not-found use-case errors', () => {
    const { deps, writes } = createDeps()
    deps.findSheetPath.mockReturnValue(null)

    expect(() => saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'missing',
      sheet: { slug: 'missing' },
    }, deps)).toThrow('Sheet missing.json not found')

    try {
      saveSheetUseCase({ role: 'gm', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT, kind: 'pokemon', slug: 'missing', sheet: { slug: 'missing' } }, deps)
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 404 })
    }
    expect(writes).toEqual([])
  })

  it('rejects inaccessible player sheet saves without writing', () => {
    const { deps, writes } = createDeps()
    deps.isPlayerAccessible.mockReturnValue(false)

    expect(() => saveSheetUseCase({
      role: 'player',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'locked',
      sheet: { slug: 'locked', player: false },
    }, deps)).toThrow('Sheet is not marked as player accessible or linked to the selected player profile')

    try {
      saveSheetUseCase({ role: 'player', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT, kind: 'pokemon', slug: 'locked', sheet: { slug: 'locked' } }, deps)
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 403 })
    }
    expect(writes).toEqual([])
  })
})
