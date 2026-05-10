import { describe, expect, it, vi } from 'vitest'
import { MoveSheetUseCaseError, moveSheetUseCase } from '../../server/useCases/moveSheet'
import type { SheetKind } from '../../shared/sheets'

const movedSheet = {
  filePath: '/repo/data/sheets/party/pika.json',
  relativePath: 'data/sheets/party/pika.json',
  moved: true,
  folder: 'party',
}

describe('move sheet use case', () => {
  it('moves a sheet and emits a compatible sheet-library moved event', () => {
    const moveSheet = vi.fn((_kind: SheetKind, _slug: string, folder: string) => ({
      ...movedSheet,
      folder,
      relativePath: `data/sheets/${folder}/pika.json`,
    }))

    const result = moveSheetUseCase({
      kind: 'pokemon',
      slug: 'pika',
      folder: 'party/boxed',
      clientId: 'client-1',
    }, { moveSheet })

    expect(moveSheet).toHaveBeenCalledWith('pokemon', 'pika', 'party/boxed')
    expect(result).toMatchObject({
      ok: true,
      moved: true,
      path: 'data/sheets/party/boxed/pika.json',
    })
    expect(result.events).toEqual([
      {
        channel: 'sheets',
        type: 'moved',
        clientId: 'client-1',
        data: { kind: 'pokemon', slug: 'pika', folder: 'party/boxed' },
      },
    ])
  })

  it('preserves same-folder no-op move responses', () => {
    const moveSheet = vi.fn(() => ({
      filePath: '/repo/data/trainers/brock.json',
      relativePath: 'data/trainers/brock.json',
      moved: false,
      folder: '',
    }))

    const result = moveSheetUseCase({ kind: 'trainer', slug: 'brock', folder: '' }, { moveSheet })

    expect(result).toMatchObject({ ok: true, moved: false, path: 'data/trainers/brock.json' })
    expect(result.events[0]).toMatchObject({
      channel: 'sheets',
      type: 'moved',
      data: { kind: 'trainer', slug: 'brock', folder: '' },
    })
  })

  it('maps missing sheets to not-found use-case errors', () => {
    const moveSheet = vi.fn(() => null)

    expect(() => moveSheetUseCase({
      kind: 'pokemon',
      slug: 'missing',
      folder: 'party',
    }, { moveSheet })).toThrow('Sheet missing.json not found')

    try {
      moveSheetUseCase({ kind: 'pokemon', slug: 'missing', folder: 'party' }, { moveSheet })
    } catch (err) {
      expect(err).toBeInstanceOf(MoveSheetUseCaseError)
      expect(err).toMatchObject({ statusCode: 404 })
    }
  })

  it('maps destination conflicts and other storage failures to compatible status codes', () => {
    const conflictMove = vi.fn(() => {
      throw new Error('A sheet with that name already exists in the target folder')
    })
    const invalidMove = vi.fn(() => {
      throw new Error('Invalid folder path')
    })

    expect(() => moveSheetUseCase({
      kind: 'pokemon',
      slug: 'pika',
      folder: 'party',
    }, { moveSheet: conflictMove })).toThrow('already exists')
    try {
      moveSheetUseCase({ kind: 'pokemon', slug: 'pika', folder: 'party' }, { moveSheet: conflictMove })
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 409 })
    }

    expect(() => moveSheetUseCase({
      kind: 'pokemon',
      slug: 'pika',
      folder: 'bad',
    }, { moveSheet: invalidMove })).toThrow('Invalid folder path')
    try {
      moveSheetUseCase({ kind: 'pokemon', slug: 'pika', folder: 'bad' }, { moveSheet: invalidMove })
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 400 })
    }
  })
})
