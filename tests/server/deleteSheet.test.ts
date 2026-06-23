import { describe, expect, it, vi } from 'vitest'
import { DeleteSheetUseCaseError, deleteSheetUseCase } from '../../server/useCases/deleteSheet'

const deletedSheet = {
  sheet: { kind: 'pokemon' as const, slug: 'pika', sheet: { slug: 'pika', revision: 2 }, revision: 2, updatedAt: 20 },
  path: 'data/sheets/party/pika.json',
  mapUpdates: [],
}

describe('delete sheet use case', () => {
  it('deletes a sheet and emits compatible sheet deletion events', () => {
    const sheetRepository = { deleteDocument: vi.fn(() => deletedSheet) }

    const result = deleteSheetUseCase({
      kind: 'pokemon',
      slug: 'pika',
      clientId: 'client-1',
    }, { sheetRepository })

    expect(sheetRepository.deleteDocument).toHaveBeenCalledWith('pokemon', 'pika')
    expect(result).toMatchObject({ ok: true, path: 'data/sheets/party/pika.json' })
    expect(result.events).toEqual([
      {
        channel: 'sheet:pokemon:pika',
        type: 'deleted',
        clientId: 'client-1',
        data: { kind: 'pokemon', slug: 'pika' },
      },
      {
        channel: 'sheets',
        type: 'deleted',
        clientId: 'client-1',
        data: { kind: 'pokemon', slug: 'pika' },
      },
    ])
  })

  it('uses trainer sheet channels for trainer deletes', () => {
    const sheetRepository = { deleteDocument: vi.fn(() => ({
      sheet: { kind: 'trainer' as const, slug: 'brock', sheet: { slug: 'brock', revision: 1 }, revision: 1, updatedAt: 10 },
      path: 'data/trainers/brock.json',
      mapUpdates: [],
    })) }

    const result = deleteSheetUseCase({ kind: 'trainer', slug: 'brock' }, { sheetRepository })

    expect(result.path).toBe('data/trainers/brock.json')
    expect(result.events).toEqual([
      {
        channel: 'sheet:trainer:brock',
        type: 'deleted',
        clientId: undefined,
        data: { kind: 'trainer', slug: 'brock' },
      },
      {
        channel: 'sheets',
        type: 'deleted',
        clientId: undefined,
        data: { kind: 'trainer', slug: 'brock' },
      },
    ])
  })

  it('maps missing sheets to not-found use-case errors', () => {
    const sheetRepository = { deleteDocument: vi.fn(() => null) }

    expect(() => deleteSheetUseCase({ kind: 'pokemon', slug: 'missing' }, { sheetRepository }))
      .toThrow('Sheet missing.json not found')

    try {
      deleteSheetUseCase({ kind: 'pokemon', slug: 'missing' }, { sheetRepository })
    } catch (err) {
      expect(err).toBeInstanceOf(DeleteSheetUseCaseError)
      expect(err).toMatchObject({ statusCode: 404 })
    }
  })

  it('lets unexpected storage failures bubble so route boundaries keep server-error semantics', () => {
    const sheetRepository = { deleteDocument: vi.fn(() => {
      throw new Error('unlink failed')
    }) }

    expect(() => deleteSheetUseCase({ kind: 'pokemon', slug: 'pika' }, { sheetRepository }))
      .toThrow('unlink failed')
  })
})
