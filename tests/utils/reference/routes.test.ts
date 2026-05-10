import { describe, expect, it } from 'vitest'
import {
  referenceAllBackLabel,
  referenceDetailPath,
  referenceDetailPathOrNull,
  referenceIndexPath,
  referenceNotFoundBackLabel,
  referencePluralLabel,
} from '~/utils/reference/routes'

describe('reference route helpers', () => {
  it('returns canonical reference index paths by kind', () => {
    expect(referenceIndexPath('move')).toBe('/moves')
    expect(referenceIndexPath('ability')).toBe('/abilities')
    expect(referenceIndexPath('capability')).toBe('/capabilities')
    expect(referenceIndexPath('condition')).toBe('/conditions')
    expect(referenceIndexPath('rule')).toBe('/rules')
    expect(referenceIndexPath('feature')).toBe('/features')
    expect(referenceIndexPath('edge')).toBe('/edges')
    expect(referenceIndexPath('item')).toBe('/items')
  })

  it('builds encoded detail paths and nullable detail paths', () => {
    expect(referenceDetailPath('move', 'power-up-punch')).toBe('/moves/power-up-punch')
    expect(referenceDetailPath('item', 'rare candy')).toBe('/items/rare%20candy')
    expect(referenceDetailPathOrNull('ability', 'static')).toBe('/abilities/static')
    expect(referenceDetailPathOrNull('ability', null)).toBeNull()
    expect(referenceDetailPathOrNull('ability', '')).toBeNull()
  })

  it('formats user-facing reference labels', () => {
    expect(referencePluralLabel('condition')).toBe('Conditions')
    expect(referenceAllBackLabel('item')).toBe('← All items')
    expect(referenceNotFoundBackLabel('feature')).toBe('← Back to all features')
  })
})
