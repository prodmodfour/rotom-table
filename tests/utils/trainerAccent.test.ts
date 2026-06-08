import { describe, expect, it } from 'vitest'
import { trainerAccentCssVariables } from '~/utils/trainerAccent'

describe('trainer accent css variables', () => {
  it('includes readable text contrast for light and dark accents', () => {
    expect(trainerAccentCssVariables('#ffffff')['--accent-contrast']).toBe('#050608')
    expect(trainerAccentCssVariables('#160028')['--accent-contrast']).toBe('#f7f7f2')
  })
})
