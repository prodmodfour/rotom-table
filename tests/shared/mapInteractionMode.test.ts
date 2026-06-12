import { describe, expect, it } from 'vitest'
import {
  MAP_INTERACTION_MODES,
  isMapInteractionMode,
  parseMapInteractionMode,
} from '#shared/mapInteractionMode'

describe('map interaction modes', () => {
  it('accepts only setup/edit and live-play modes', () => {
    expect(isMapInteractionMode(MAP_INTERACTION_MODES.SETUP_EDIT)).toBe(true)
    expect(isMapInteractionMode(MAP_INTERACTION_MODES.LIVE_PLAY)).toBe(true)
    expect(isMapInteractionMode('player-save')).toBe(false)
    expect(isMapInteractionMode(null)).toBe(false)
  })

  it('parses invalid modes to null', () => {
    expect(parseMapInteractionMode('setup-edit')).toBe('setup-edit')
    expect(parseMapInteractionMode('live-play')).toBe('live-play')
    expect(parseMapInteractionMode('')).toBeNull()
  })
})
