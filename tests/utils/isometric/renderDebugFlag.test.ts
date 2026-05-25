import { afterEach, describe, expect, it } from 'vitest'
import {
  ISOMETRIC_RENDER_DEBUG_QUERY_KEY,
  ISOMETRIC_RENDER_DEBUG_QUERY_VALUES,
  hasIsometricRenderDebugQueryFlag,
  isIsometricRenderDebugEnabled,
} from '~/utils/isometric/renderDebugFlag'

const originalProcessDev = process.dev
const originalNodeEnv = process.env.NODE_ENV

afterEach(() => {
  process.dev = originalProcessDev
  process.env.NODE_ENV = originalNodeEnv
})

describe('isometric render debug flag', () => {
  it('documents the explicit render debug query tokens', () => {
    expect(ISOMETRIC_RENDER_DEBUG_QUERY_KEY).toBe('debug')
    expect(ISOMETRIC_RENDER_DEBUG_QUERY_VALUES).toContain('render')
    expect(new Set(ISOMETRIC_RENDER_DEBUG_QUERY_VALUES).size).toBe(ISOMETRIC_RENDER_DEBUG_QUERY_VALUES.length)
  })

  it('detects render debug requests from query strings', () => {
    expect(hasIsometricRenderDebugQueryFlag('?debug=render')).toBe(true)
    expect(hasIsometricRenderDebugQueryFlag('debug=RENDER')).toBe(true)
    expect(hasIsometricRenderDebugQueryFlag('/maps/test?debug=render#tokens')).toBe(true)
    expect(hasIsometricRenderDebugQueryFlag('?debug=weather')).toBe(false)
    expect(hasIsometricRenderDebugQueryFlag('?other=render')).toBe(false)
  })

  it('detects equivalent explicit render debug tokens without enabling unrelated debug flags', () => {
    expect(hasIsometricRenderDebugQueryFlag('?debug=render-metrics')).toBe(true)
    expect(hasIsometricRenderDebugQueryFlag('?debug=isometric-render')).toBe(true)
    expect(hasIsometricRenderDebugQueryFlag('?debug=grid,render')).toBe(true)
    expect(hasIsometricRenderDebugQueryFlag('?debug=grid%20render')).toBe(true)
    expect(hasIsometricRenderDebugQueryFlag('?debug=renderer')).toBe(false)
  })

  it('supports URLSearchParams and Nuxt route query shapes', () => {
    expect(hasIsometricRenderDebugQueryFlag(new URLSearchParams('debug=grid&debug=render'))).toBe(true)
    expect(hasIsometricRenderDebugQueryFlag(new URLSearchParams('debug[]=render'))).toBe(true)
    expect(hasIsometricRenderDebugQueryFlag({ debug: ['grid', 'render'] })).toBe(true)
    expect(hasIsometricRenderDebugQueryFlag({ debug: null })).toBe(false)
  })

  it('keeps the client gate inert until explicitly requested', () => {
    expect(isIsometricRenderDebugEnabled({ query: {}, isDev: true })).toBe(false)
    expect(isIsometricRenderDebugEnabled({ query: '?debug=weather', isDev: true })).toBe(false)
    expect(isIsometricRenderDebugEnabled({ location: { search: '?debug=render' }, isDev: true })).toBe(true)
  })

  it('is dev-safe by default while allowing an explicit benchmark override', () => {
    expect(isIsometricRenderDebugEnabled({ query: '?debug=render', isDev: false })).toBe(false)
    expect(isIsometricRenderDebugEnabled({ query: '?debug=render', isDev: false, allowProduction: true })).toBe(true)
  })

  it('uses the Nuxt client process.dev fallback for dev server benchmark runs', () => {
    process.dev = true
    process.env.NODE_ENV = 'production'

    expect(isIsometricRenderDebugEnabled({ query: '?debug=render' })).toBe(true)
  })
})
