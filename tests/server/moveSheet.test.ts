import { describe, expect, it, vi } from 'vitest'
import { MoveSheetUseCaseError, moveSheetUseCase } from '../../server/useCases/moveSheet'

const sheet = { kind: 'pokemon' as const, slug: 'pika', sheet: { slug: 'pika', revision: 2 }, revision: 2, updatedAt: 20 }
const movedSheet = {
  sheet,
  path: 'data/sheets/party/pika.json',
  moved: true,
  folder: 'party',
}

describe('move sheet use case', () => {
  it('moves a sheet and emits a compatible sheet-library moved event', () => {
    const sheetRepository = { moveToFolder: vi.fn((input: { folder: string }) => ({
      ...movedSheet,
      folder: input.folder,
      path: `data/sheets/${input.folder}/pika.json`,
    })) }

    const result = moveSheetUseCase({
      kind: 'pokemon',
      slug: 'pika',
      folder: 'party/boxed',
      clientId: 'client-1',
    }, { sheetRepository })

    expect(sheetRepository.moveToFolder).toHaveBeenCalledWith({ kind: 'pokemon', slug: 'pika', folder: 'party/boxed', now: undefined })
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
    const sheetRepository = { moveToFolder: vi.fn(() => ({
      sheet: { kind: 'trainer' as const, slug: 'brock', sheet: { slug: 'brock', revision: 1 }, revision: 1, updatedAt: 10 },
      path: 'data/trainers/brock.json',
      moved: false,
      folder: '',
    })) }

    const result = moveSheetUseCase({ kind: 'trainer', slug: 'brock', folder: '' }, { sheetRepository })

    expect(result).toMatchObject({ ok: true, moved: false, path: 'data/trainers/brock.json' })
    expect(result.events).toEqual([])
  })

  it('maps missing sheets to not-found use-case errors', () => {
    const sheetRepository = { moveToFolder: vi.fn(() => null) }

    expect(() => moveSheetUseCase({
      kind: 'pokemon',
      slug: 'missing',
      folder: 'party',
    }, { sheetRepository })).toThrow('Sheet missing.json not found')

    try {
      moveSheetUseCase({ kind: 'pokemon', slug: 'missing', folder: 'party' }, { sheetRepository })
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
    }, { sheetRepository: { moveToFolder: conflictMove } })).toThrow('already exists')
    try {
      moveSheetUseCase({ kind: 'pokemon', slug: 'pika', folder: 'party' }, { sheetRepository: { moveToFolder: conflictMove } })
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 409 })
    }

    expect(() => moveSheetUseCase({
      kind: 'pokemon',
      slug: 'pika',
      folder: 'bad',
    }, { sheetRepository: { moveToFolder: invalidMove } })).toThrow('Invalid folder path')
    try {
      moveSheetUseCase({ kind: 'pokemon', slug: 'pika', folder: 'bad' }, { sheetRepository: { moveToFolder: invalidMove } })
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 400 })
    }
  })
})
