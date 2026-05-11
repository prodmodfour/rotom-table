import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createMapFolder,
  deleteMapFolder,
  listMapFolders,
  moveMapFolder,
} from '../../server/utils/mapFolderStorage'

const createRoot = () => mkdtempSync(join(tmpdir(), 'rotom-map-folders-'))

describe('map folder storage', () => {
  it('creates, lists, moves, and deletes map folders under an injected root', () => {
    const root = createRoot()

    const created = createMapFolder('alpha/beta', root)
    expect(created.created).toBe(true)
    expect(created.folder).toBe('alpha/beta')
    expect(created.path.endsWith('/alpha/beta')).toBe(true)
    expect(existsSync(join(root, 'alpha', 'beta'))).toBe(true)
    expect(listMapFolders(root)).toEqual(['alpha', 'alpha/beta'])

    const existing = createMapFolder('alpha/beta', root)
    expect(existing.created).toBe(false)

    expect(moveMapFolder('alpha/beta', 'gamma/delta', root)).toEqual({ moved: true })
    expect(existsSync(join(root, 'alpha'))).toBe(false)
    expect(existsSync(join(root, 'gamma', 'delta'))).toBe(true)
    expect(listMapFolders(root)).toEqual(['gamma', 'gamma/delta'])

    const removed = deleteMapFolder('gamma/delta', root)
    expect(removed?.removed.endsWith('/gamma/delta')).toBe(true)
    expect(listMapFolders(root)).toEqual([])
  })

  it('returns null for missing move/delete sources and rejects unsafe or invalid targets', () => {
    const root = createRoot()

    expect(moveMapFolder('missing', 'destination', root)).toBeNull()
    expect(deleteMapFolder('missing', root)).toBeNull()
    expect(() => createMapFolder('../escape', root)).toThrow('Invalid path: outside root')
    expect(() => moveMapFolder('source', '../escape', root)).toThrow('Invalid path: outside root')
    expect(() => deleteMapFolder('', root)).toThrow('Invalid folder path')

    writeFileSync(join(root, 'not-a-folder'), '{}', 'utf8')
    expect(() => deleteMapFolder('not-a-folder', root)).toThrow('Not a directory')

    mkdirSync(join(root, 'source'), { recursive: true })
    mkdirSync(join(root, 'destination'), { recursive: true })
    expect(() => moveMapFolder('source', 'source/child', root)).toThrow('Cannot move a folder into itself')
    expect(() => moveMapFolder('source', 'destination', root)).toThrow('Destination folder already exists')
  })
})
