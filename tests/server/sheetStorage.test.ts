import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findSheetFileBySlugInRoot,
  findSheetFileInRoot,
  stripDerivedSheetFields,
} from '../../server/utils/sheetStorage'

describe('sheet storage helpers', () => {
  it('finds sheets by filename and by top-level slug fallback', () => {
    const root = mkdtempSync(join(tmpdir(), 'rotom-sheets-'))
    mkdirSync(join(root, 'nested'), { recursive: true })
    const filenameMatch = join(root, 'nested', 'bolt-pikachu.json')
    const slugFallback = join(root, 'nested', 'snake_case_filename.json')
    writeFileSync(filenameMatch, JSON.stringify({ slug: 'bolt-pikachu' }), 'utf8')
    writeFileSync(slugFallback, JSON.stringify({ slug: 'kebab-case-slug' }), 'utf8')

    expect(findSheetFileInRoot(root, 'bolt-pikachu')).toBe(filenameMatch)
    expect(findSheetFileInRoot(root, 'kebab-case-slug')).toBeNull()
    expect(findSheetFileBySlugInRoot(root, 'kebab-case-slug')).toBe(slugFallback)
  })

  it('strips derived folder fields without mutating the input sheet', () => {
    const sheet = { slug: 'example', folder: 'party/a', level: 5 }
    const persisted = stripDerivedSheetFields(sheet)

    expect(persisted).toEqual({ slug: 'example', level: 5 })
    expect(sheet).toEqual({ slug: 'example', folder: 'party/a', level: 5 })
  })
})
