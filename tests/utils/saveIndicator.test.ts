import { describe, expect, it } from 'vitest'
import { saveIndicatorLabel, saveIndicatorTitle } from '~/utils/saveIndicator'

describe('save indicator helpers', () => {
  it('formats labels for every save state', () => {
    expect(saveIndicatorLabel('idle')).toBe('Edit any cell to save')
    expect(saveIndicatorLabel('saving')).toBe('Saving…')
    expect(saveIndicatorLabel('saved')).toBe('Saved')
    expect(saveIndicatorLabel('error')).toBe('Save failed')
  })

  it('normalizes the optional title', () => {
    expect(saveIndicatorTitle('Disk full')).toBe('Disk full')
    expect(saveIndicatorTitle(null)).toBe('')
    expect(saveIndicatorTitle(undefined)).toBe('')
  })
})
