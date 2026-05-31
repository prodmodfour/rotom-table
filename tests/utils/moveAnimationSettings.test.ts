import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MOVE_ANIMATIONS_ENABLED,
  DEFAULT_MOVE_ANIMATIONS_REDUCED_MOTION,
  MOVE_ANIMATIONS_ENABLED_STORAGE_KEY,
  PREFERS_REDUCED_MOTION_QUERY,
  moveAnimationsEnabledLabel,
  moveAnimationsEnabledTitle,
  parseMoveAnimationsEnabled,
  readPrefersReducedMotion,
  resolveMoveAnimationsEnabled,
  serializeMoveAnimationsEnabled,
  subscribePrefersReducedMotion,
  type MoveAnimationPreferenceMediaQueryChangeEvent,
  type MoveAnimationPreferenceMediaQueryList,
  type MoveAnimationPreferenceMatchMedia,
} from '~/utils/moveAnimationSettings'

describe('move animation settings', () => {
  it('defaults move animations to enabled', () => {
    expect(DEFAULT_MOVE_ANIMATIONS_ENABLED).toBe(true)
    expect(MOVE_ANIMATIONS_ENABLED_STORAGE_KEY).toBe('rotom-table:move-animations-enabled')
    expect(resolveMoveAnimationsEnabled(undefined)).toBe(true)
    expect(resolveMoveAnimationsEnabled('unexpected')).toBe(true)
  })

  it('parses and serializes the local browser enablement preference', () => {
    expect(parseMoveAnimationsEnabled(true)).toBe(true)
    expect(parseMoveAnimationsEnabled(false)).toBe(false)
    expect(parseMoveAnimationsEnabled('enabled')).toBe(true)
    expect(parseMoveAnimationsEnabled('OFF')).toBe(false)
    expect(parseMoveAnimationsEnabled('0')).toBe(false)
    expect(parseMoveAnimationsEnabled('maybe')).toBeNull()

    expect(serializeMoveAnimationsEnabled(true)).toBe('true')
    expect(serializeMoveAnimationsEnabled(false)).toBe('false')
  })

  it('labels disabled mode as visual-only while move automation remains available', () => {
    expect(moveAnimationsEnabledLabel(true)).toBe('Move animations on')
    expect(moveAnimationsEnabledLabel(false)).toBe('Move animations off')
    expect(moveAnimationsEnabledTitle(false)).toContain('Move automation stays usable')
  })

  it('reads the client reduced-motion media query with SSR-safe fallbacks', () => {
    const queried: string[] = []
    const matchMedia: MoveAnimationPreferenceMatchMedia = (query) => {
      queried.push(query)
      return { matches: true }
    }

    expect(DEFAULT_MOVE_ANIMATIONS_REDUCED_MOTION).toBe(false)
    expect(PREFERS_REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)')
    expect(readPrefersReducedMotion(matchMedia)).toBe(true)
    expect(queried).toEqual([PREFERS_REDUCED_MOTION_QUERY])
    expect(readPrefersReducedMotion(null)).toBe(false)
    expect(readPrefersReducedMotion(() => { throw new Error('matchMedia unavailable') })).toBe(false)
  })

  it('updates reduced-motion state from modern matchMedia change events and cleans up', () => {
    const listeners: Array<(event: MoveAnimationPreferenceMediaQueryChangeEvent) => void> = []
    const queryList: MoveAnimationPreferenceMediaQueryList = {
      matches: false,
      addEventListener: (type, listener) => {
        if (type === 'change') listeners.push(listener)
      },
      removeEventListener: (type, listener) => {
        if (type !== 'change') return
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      },
    }
    const changes: boolean[] = []

    const cleanup = subscribePrefersReducedMotion((reducedMotion) => {
      changes.push(reducedMotion)
    }, () => queryList)

    listeners[0]?.({ matches: true })
    listeners[0]?.({ matches: false })

    expect(changes).toEqual([true, false])
    expect(listeners).toHaveLength(1)

    cleanup()

    expect(listeners).toHaveLength(0)
  })
})
