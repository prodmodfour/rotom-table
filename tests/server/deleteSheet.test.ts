import { describe, expect, it, vi } from 'vitest'
import { DeleteSheetUseCaseError, deleteSheetUseCase } from '../../server/useCases/deleteSheet'
import type { SheetKind } from '../../shared/sheets'

const deletedSheet = {
  filePath: '/repo/data/sheets/party/pika.json',
  relativePath: 'data/sheets/party/pika.json',
}

describe('delete sheet use case', () => {
  it('deletes a sheet and emits compatible sheet deletion events', () => {
    const deleteSheet = vi.fn((_kind: SheetKind, _slug: string) => deletedSheet)

    const result = deleteSheetUseCase({
      kind: 'pokemon',
      slug: 'pika',
      clientId: 'client-1',
    }, { deleteSheet })

    expect(deleteSheet).toHaveBeenCalledWith('pokemon', 'pika')
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
    const deleteSheet = vi.fn(() => ({
      filePath: '/repo/data/trainers/brock.json',
      relativePath: 'data/trainers/brock.json',
    }))

    const result = deleteSheetUseCase({ kind: 'trainer', slug: 'brock' }, { deleteSheet })

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
    const deleteSheet = vi.fn(() => null)

    expect(() => deleteSheetUseCase({ kind: 'pokemon', slug: 'missing' }, { deleteSheet }))
      .toThrow('Sheet missing.json not found')

    try {
      deleteSheetUseCase({ kind: 'pokemon', slug: 'missing' }, { deleteSheet })
    } catch (err) {
      expect(err).toBeInstanceOf(DeleteSheetUseCaseError)
      expect(err).toMatchObject({ statusCode: 404 })
    }
  })

  it('lets unexpected storage failures bubble so route boundaries keep server-error semantics', () => {
    const deleteSheet = vi.fn(() => {
      throw new Error('unlink failed')
    })

    expect(() => deleteSheetUseCase({ kind: 'pokemon', slug: 'pika' }, { deleteSheet }))
      .toThrow('unlink failed')
  })
})
