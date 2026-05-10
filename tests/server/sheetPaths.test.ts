import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SHEET_KIND_CONFIG,
  folderFromSheetPath,
  sheetRootFor,
  sheetRoots,
} from '../../server/utils/sheetPaths'

describe('sheet path helpers', () => {
  it('exposes stable roots and config for each sheet kind', () => {
    expect(SHEET_KIND_CONFIG.pokemon.defaultBaseSlug).toBe('new-pokemon')
    expect(SHEET_KIND_CONFIG.trainer.defaultBaseSlug).toBe('new-trainer')
    expect(sheetRootFor('pokemon')).toMatch(/data[/\\]sheets$/)
    expect(sheetRootFor('trainer')).toMatch(/data[/\\]trainers$/)
    expect(sheetRoots()).toEqual([sheetRootFor('pokemon'), sheetRootFor('trainer')])
    expect(sheetRoots('pokemon')).toEqual([sheetRootFor('pokemon')])
  })

  it('derives sheet folders from filesystem paths with posix separators', () => {
    const root = sheetRootFor('pokemon')

    expect(folderFromSheetPath('pokemon', join(root, 'pikachu.json'))).toBe('')
    expect(folderFromSheetPath('pokemon', join(root, 'party', 'boxed', 'pikachu.json'))).toBe('party/boxed')
  })
})
