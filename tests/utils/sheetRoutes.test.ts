import { describe, expect, it } from 'vitest'
import { sheetEditorPath, sheetKindLabel } from '~/utils/sheetRoutes'

describe('sheet route helpers', () => {
  it('builds encoded editor paths by sheet kind', () => {
    expect(sheetEditorPath('pokemon', 'pika chu')).toBe('/sheets/pika%20chu')
    expect(sheetEditorPath('trainer', 'misty/kanto')).toBe('/sheets/trainers/misty%2Fkanto')
  })

  it('formats user-facing sheet-kind labels', () => {
    expect(sheetKindLabel('pokemon')).toBe('Pokémon')
    expect(sheetKindLabel('trainer')).toBe('Trainer')
  })
})
