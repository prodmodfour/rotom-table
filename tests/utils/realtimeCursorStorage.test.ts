import { describe, expect, it, vi } from 'vitest'
import { createRealtimeCursorStorage } from '~/utils/realtimeCursorStorage'

class FakeSessionStorage {
  readonly items = new Map<string, string>()
  failGet = false
  failSet = false

  getItem(key: string): string | null {
    if (this.failGet) throw new Error('get failed')
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.failSet) throw new Error('set failed')
    this.items.set(key, value)
  }

  removeItem(key: string): void {
    this.items.delete(key)
  }
}

describe('realtime cursor storage', () => {
  it('persists safe non-negative cursors per context in session storage', () => {
    const sessionStorage = new FakeSessionStorage()
    const storage = createRealtimeCursorStorage({ getSessionStorage: () => sessionStorage, warn: vi.fn() })

    storage.advanceCursor('gm', 3)
    storage.advanceCursor('player:none', 5)
    storage.advanceCursor('player:profile_ash00000', 7)

    expect(storage.readCursor('gm')).toBe(3)
    expect(storage.readCursor('player:none')).toBe(5)
    expect(storage.readCursor('player:profile_ash00000')).toBe(7)
  })

  it('rejects corrupt cursor values safely', () => {
    const sessionStorage = new FakeSessionStorage()
    const warn = vi.fn()
    sessionStorage.items.set('rotom:realtime-cursor:v1:gm', JSON.stringify({ version: 1, sequence: -1 }))
    const storage = createRealtimeCursorStorage({ getSessionStorage: () => sessionStorage, warn })

    expect(storage.readCursor('gm')).toBeNull()
    expect(sessionStorage.items.has('rotom:realtime-cursor:v1:gm')).toBe(false)
    expect(warn).toHaveBeenCalledWith('[realtime] ignored corrupt realtime cursor.', expect.any(Object))
  })

  it('falls back to an in-memory cursor with a warning when session storage fails', () => {
    const sessionStorage = new FakeSessionStorage()
    const warn = vi.fn()
    const storage = createRealtimeCursorStorage({ getSessionStorage: () => sessionStorage, warn })

    sessionStorage.failSet = true
    expect(storage.advanceCursor('gm', 4)).toBe(4)
    expect(storage.readCursor('gm')).toBe(4)
    expect(warn).toHaveBeenCalledWith(
      '[realtime] sessionStorage cursor persistence failed; using an in-memory cursor for this tab.',
      expect.any(Object),
    )
  })

  it('never moves a cursor backward', () => {
    const sessionStorage = new FakeSessionStorage()
    const storage = createRealtimeCursorStorage({ getSessionStorage: () => sessionStorage, warn: vi.fn() })

    expect(storage.advanceCursor('gm', 10)).toBe(10)
    expect(storage.advanceCursor('gm', 6)).toBe(10)
    expect(storage.readCursor('gm')).toBe(10)
  })

  it('performs no session storage access when no browser storage is available', () => {
    const getSessionStorage = vi.fn(() => null)
    const storage = createRealtimeCursorStorage({ getSessionStorage, warn: vi.fn() })

    expect(storage.readCursor('gm')).toBeNull()
    expect(storage.advanceCursor('gm', 2)).toBe(2)
    expect(storage.readCursor('gm')).toBe(2)
    expect(getSessionStorage).toHaveBeenCalledTimes(4)
  })
})
