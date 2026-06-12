import { describe, expect, it, vi } from 'vitest'
import { RenameSheetUseCaseError, renameSheetUseCase } from '../../server/useCases/renameSheet'
import type { SheetKind } from '../../shared/sheets'

const renamedSheet = {
  slug: 'spark',
  name: 'Spark',
  sheet: { slug: 'spark', nickname: 'Spark' },
  filePath: '/repo/data/sheets/spark.json',
  relativePath: 'data/sheets/spark.json',
}

describe('rename sheet use case', () => {
  it('renames a sheet and emits compatible sheet library update events', () => {
    const renameSheet = vi.fn((_kind: SheetKind, _slug: string, name: string) => ({
      ...renamedSheet,
      name,
      sheet: { slug: 'spark', nickname: name },
    }))
    const retargetMapSheetPlacements = vi.fn(() => [])

    const result = renameSheetUseCase({
      kind: 'pokemon',
      slug: 'spark',
      name: 'Spark Prime',
      clientId: 'client-1',
    }, { renameSheet, retargetMapSheetPlacements })

    expect(renameSheet).toHaveBeenCalledWith('pokemon', 'spark', 'Spark Prime')
    expect(result).toMatchObject({
      ok: true,
      slug: 'spark',
      name: 'Spark Prime',
      path: 'data/sheets/spark.json',
      sheet: { slug: 'spark', nickname: 'Spark Prime' },
    })
    expect(result.events).toEqual([
      {
        channel: 'sheet:pokemon:spark',
        type: 'updated',
        clientId: 'client-1',
        data: {
          kind: 'pokemon',
          slug: 'spark',
          sheet: { slug: 'spark', nickname: 'Spark Prime' },
        },
      },
      {
        channel: 'sheets',
        type: 'updated',
        clientId: 'client-1',
        data: {
          kind: 'pokemon',
          slug: 'spark',
          sheet: { slug: 'spark', nickname: 'Spark Prime' },
        },
      },
    ])
  })

  it('emits renamed events when the sheet slug changes to match the new name', () => {
    const renameSheet = vi.fn((_kind: SheetKind, _slug: string, name: string) => ({
      slug: 'spark-prime',
      name,
      sheet: { slug: 'spark-prime', nickname: name },
      filePath: '/repo/data/sheets/spark-prime.json',
      relativePath: 'data/sheets/spark-prime.json',
    }))
    const retargetMapSheetPlacements = vi.fn(() => [])

    const result = renameSheetUseCase({
      kind: 'pokemon',
      slug: 'spark',
      name: 'Spark Prime',
      clientId: 'client-1',
    }, { renameSheet, retargetMapSheetPlacements })

    expect(result).toMatchObject({
      ok: true,
      slug: 'spark-prime',
      path: 'data/sheets/spark-prime.json',
      sheet: { slug: 'spark-prime', nickname: 'Spark Prime' },
    })
    expect(retargetMapSheetPlacements).toHaveBeenCalledWith('pokemon', 'spark', 'spark-prime')
    expect(result.events).toEqual([
      {
        channel: 'sheet:pokemon:spark',
        type: 'renamed',
        clientId: 'client-1',
        data: {
          kind: 'pokemon',
          slug: 'spark-prime',
          oldSlug: 'spark',
          newSlug: 'spark-prime',
          sheet: { slug: 'spark-prime', nickname: 'Spark Prime' },
        },
      },
      {
        channel: 'sheet:pokemon:spark-prime',
        type: 'updated',
        clientId: 'client-1',
        data: {
          kind: 'pokemon',
          slug: 'spark-prime',
          sheet: { slug: 'spark-prime', nickname: 'Spark Prime' },
        },
      },
      {
        channel: 'sheets',
        type: 'renamed',
        clientId: 'client-1',
        data: {
          kind: 'pokemon',
          slug: 'spark-prime',
          oldSlug: 'spark',
          newSlug: 'spark-prime',
          sheet: { slug: 'spark-prime', nickname: 'Spark Prime' },
        },
      },
    ])
  })

  it('emits map updates when a sheet rename retargets existing map placements', () => {
    const arenaMap = {
      schemaVersion: 2 as const,
      slug: 'arena',
      name: 'Arena',
      folder: '',
      dimensions: { x: 8, y: 1, z: 8 },
      voxels: [],
      placements: [
        {
          id: 'token-1',
          sheetKind: 'trainer' as const,
          sheetSlug: 'misty-prime',
          position: { x: 2, y: 0, z: 2 },
        },
      ],
      updatedAt: 321,
    }
    const renameSheet = vi.fn((_kind: SheetKind, _slug: string, name: string) => ({
      slug: 'misty-prime',
      name,
      sheet: { slug: 'misty-prime', name },
      filePath: '/repo/data/trainers/misty-prime.json',
      relativePath: 'data/trainers/misty-prime.json',
    }))
    const retargetMapSheetPlacements = vi.fn(() => [{ path: '/repo/data/maps/arena.json', map: arenaMap, placementCount: 1 }])

    const result = renameSheetUseCase({
      kind: 'trainer',
      slug: 'misty',
      name: 'Misty Prime',
      clientId: 'client-1',
    }, { renameSheet, retargetMapSheetPlacements })

    expect(retargetMapSheetPlacements).toHaveBeenCalledWith('trainer', 'misty', 'misty-prime')
    expect(result.events.slice(-2)).toEqual([
      {
        channel: 'map:arena',
        type: 'updated',
        revision: 0,
        clientId: 'client-1',
        data: arenaMap,
      },
      {
        channel: 'maps',
        type: 'updated',
        revision: 0,
        clientId: 'client-1',
        data: {
          slug: 'arena',
          name: 'Arena',
          folder: '',
          dimensions: { x: 8, y: 1, z: 8 },
          placementCount: 1,
          playerVisible: false,
          schemaVersion: 2,
          updatedAt: 321,
        },
      },
    ])
  })

  it('maps missing sheets to a not-found use-case error without emitting events', () => {
    const renameSheet = vi.fn(() => null)

    expect(() => renameSheetUseCase({
      kind: 'trainer',
      slug: 'missing-trainer',
      name: 'Missing Trainer',
    }, { renameSheet })).toThrow('Sheet missing-trainer.json not found')

    try {
      renameSheetUseCase({ kind: 'trainer', slug: 'missing-trainer', name: 'Missing Trainer' }, { renameSheet })
    } catch (err) {
      expect(err).toBeInstanceOf(RenameSheetUseCaseError)
      expect(err).toMatchObject({ statusCode: 404 })
    }
  })

  it('maps parse/write failures to the existing server-error message', () => {
    const renameSheet = vi.fn(() => {
      throw new Error('bad json')
    })

    expect(() => renameSheetUseCase({
      kind: 'pokemon',
      slug: 'broken',
      name: 'Broken',
    }, { renameSheet })).toThrow('Failed to parse or write sheet: Error: bad json')

    try {
      renameSheetUseCase({ kind: 'pokemon', slug: 'broken', name: 'Broken' }, { renameSheet })
    } catch (err) {
      expect(err).toBeInstanceOf(RenameSheetUseCaseError)
      expect(err).toMatchObject({ statusCode: 500 })
    }
  })
})
