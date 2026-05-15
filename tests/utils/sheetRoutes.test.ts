import { describe, expect, it } from 'vitest'
import {
  SHEET_LIBRARY_PATH,
  sheetEditorPath,
  sheetKindLabel,
  sheetLibraryFolderLocation,
  sheetLibraryPath,
} from '~/utils/sheetRoutes'

describe('sheet route helpers', () => {
  it('exposes the canonical sheet library path', () => {
    expect(SHEET_LIBRARY_PATH).toBe('/sheets')
    expect(sheetLibraryPath()).toBe('/sheets')
  })

  it('builds route locations for sheet library folders', () => {
    expect(sheetLibraryFolderLocation()).toEqual({ path: '/sheets' })
    expect(sheetLibraryFolderLocation('/team/alpha/')).toEqual({
      path: '/sheets',
      query: { folder: 'team/alpha' },
    })
  })

  it('builds encoded editor paths by sheet kind', () => {
    expect(sheetEditorPath('pokemon', 'pika chu')).toBe('/sheets/pika%20chu')
    expect(sheetEditorPath('trainer', 'misty/kanto')).toBe('/sheets/trainers/misty%2Fkanto')
  })

  it('formats user-facing sheet-kind labels', () => {
    expect(sheetKindLabel('pokemon')).toBe('Pokémon')
    expect(sheetKindLabel('trainer')).toBe('Trainer')
  })
})
