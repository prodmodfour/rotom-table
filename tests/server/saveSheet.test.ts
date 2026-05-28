import { describe, expect, it, vi } from 'vitest'
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
      relativePath: vi.fn((path: string) => path.replace('/repo/', '')),
    },
  }
}

describe('save sheet use case', () => {
  it('writes a GM sheet save, strips derived fields, and emits compatible realtime events', () => {
    const { deps, writes } = createDeps()

    const result = saveSheetUseCase({
      role: 'gm',
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
        sheet: { slug: 'pika', nickname: 'Pika', player: false },
      },
    ])
    expect(result).toMatchObject({
      ok: true,
      path: 'data/sheets/pika.json',
      sheet: { slug: 'pika', nickname: 'Pika', player: false },
    })
    expect(result.events).toEqual([
      {
        channel: 'sheet:pokemon:pika',
        type: 'updated',
        clientId: 'client-1',
        data: {
          kind: 'pokemon',
          slug: 'pika',
          sheet: { slug: 'pika', nickname: 'Pika', player: false },
        },
      },
      {
        channel: 'sheets',
        type: 'updated',
        clientId: 'client-1',
        data: {
          kind: 'pokemon',
          slug: 'pika',
          sheet: { slug: 'pika', nickname: 'Pika', player: false },
        },
      },
    ])
  })

  it('allows player saves only for player-accessible sheets and preserves player access', () => {
    const { deps, writes } = createDeps()

    const result = saveSheetUseCase({
      role: 'player',
      kind: 'trainer',
      slug: 'brock',
      sheet: { slug: 'brock', name: 'Brock', folder: 'gym', player: false },
    }, deps)

    expect(deps.isPlayerAccessible).toHaveBeenCalledWith('trainer', 'brock')
    expect(writes).toEqual([
      {
        path: '/repo/data/sheets/brock.json',
        sheet: { slug: 'brock', name: 'Brock', player: true },
      },
    ])
    expect(result.events[0]?.data).toEqual({
      kind: 'trainer',
      slug: 'brock',
      sheet: { slug: 'brock', name: 'Brock', player: true },
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
        sheet: { slug: 'brock', name: 'Brock Prime', level: 6, player: false },
      },
    ])
    expect(result.events[0]?.data).toEqual({
      kind: 'trainer',
      slug: 'brock',
      sheet: { slug: 'brock', name: 'Brock Prime', level: 6, player: false },
    })
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
      kind: 'pokemon',
      slug: 'pika',
      sheet: { slug: 'pika', nickname: 'Pika' },
    }, depsWithExisting)

    expect(writes).toEqual([
      {
        path: '/repo/data/sheets/pika.json',
        sheet: { slug: 'pika', nickname: 'Pika', moveUsage },
      },
    ])
    expect(result.sheet.moveUsage).toBe(moveUsage)
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
        sheet: { slug: 'spark-prime', nickname: 'Spark Prime', player: false },
      },
    ])
    expect(result).toMatchObject({
      ok: true,
      slug: 'spark-prime',
      path: 'data/sheets/spark-prime.json',
      sheet: { slug: 'spark-prime', nickname: 'Spark Prime', player: false },
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
          sheet: { slug: 'spark-prime', nickname: 'Spark Prime', player: false },
        },
      },
      {
        channel: 'sheet:pokemon:spark-prime',
        type: 'updated',
        clientId: 'client-1',
        data: {
          kind: 'pokemon',
          slug: 'spark-prime',
          sheet: { slug: 'spark-prime', nickname: 'Spark Prime', player: false },
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
          sheet: { slug: 'spark-prime', nickname: 'Spark Prime', player: false },
        },
      },
    ])
  })

  it('rejects payload slug mismatches before persistence', () => {
    const { deps, writes } = createDeps()

    expect(() => saveSheetUseCase({
      role: 'gm',
      kind: 'pokemon',
      slug: 'pika',
      sheet: { slug: 'raichu' },
    }, deps)).toThrow(SaveSheetUseCaseError)

    try {
      saveSheetUseCase({ role: 'gm', kind: 'pokemon', slug: 'pika', sheet: { slug: 'raichu' } }, deps)
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
      kind: 'pokemon',
      slug: 'missing',
      sheet: { slug: 'missing' },
    }, deps)).toThrow('Sheet missing.json not found')

    try {
      saveSheetUseCase({ role: 'gm', kind: 'pokemon', slug: 'missing', sheet: { slug: 'missing' } }, deps)
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
      kind: 'pokemon',
      slug: 'locked',
      sheet: { slug: 'locked', player: false },
    }, deps)).toThrow('Sheet is not marked as player accessible or linked to the selected player profile')

    try {
      saveSheetUseCase({ role: 'player', kind: 'pokemon', slug: 'locked', sheet: { slug: 'locked' } }, deps)
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 403 })
    }
    expect(writes).toEqual([])
  })
})
