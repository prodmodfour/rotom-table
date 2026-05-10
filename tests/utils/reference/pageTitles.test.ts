import { describe, expect, it } from 'vitest'
import { APP_TITLE, referenceDetailTitle } from '~/utils/reference/pageTitles'

describe('reference page titles', () => {
  it('formats selected reference detail titles', () => {
    expect(referenceDetailTitle('Thunderbolt', 'Moves', 'Move not found')).toBe('Thunderbolt · Moves')
  })

  it('formats missing reference detail titles with the app title', () => {
    expect(referenceDetailTitle(null, 'Items', 'Item not found')).toBe(`Item not found · ${APP_TITLE}`)
    expect(referenceDetailTitle(undefined, 'Features', 'Feature not found')).toBe('Feature not found · Rotom Table')
  })
})
