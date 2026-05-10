import { describe, expect, it, vi } from 'vitest'
import { SaveSheetUseCaseError, saveSheetUseCase } from '../../server/useCases/saveSheet'
import type { SheetKind } from '../../shared/sheets'

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
    }, deps)).toThrow('Sheet is not marked as player accessible')

    try {
      saveSheetUseCase({ role: 'player', kind: 'pokemon', slug: 'locked', sheet: { slug: 'locked' } }, deps)
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 403 })
    }
    expect(writes).toEqual([])
  })
})
