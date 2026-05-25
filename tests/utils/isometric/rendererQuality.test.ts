import { describe, expect, it } from 'vitest'
import {
  ISOMETRIC_WEBGL_RENDERER_PARAMETERS,
  MAX_ISOMETRIC_RENDERER_PIXEL_RATIO,
  resolveIsometricRendererPixelRatio,
} from '~/utils/isometric/rendererQuality'

describe('isometric renderer quality guardrails', () => {
  it('keeps WebGL antialiasing enabled for map rendering', () => {
    expect(ISOMETRIC_WEBGL_RENDERER_PARAMETERS.antialias).toBe(true)
    expect(ISOMETRIC_WEBGL_RENDERER_PARAMETERS.alpha).toBe(false)
  })

  it('preserves browser device pixel ratio up to the established high-DPI cap', () => {
    expect(resolveIsometricRendererPixelRatio(1)).toBe(1)
    expect(resolveIsometricRendererPixelRatio(1.5)).toBe(1.5)
    expect(resolveIsometricRendererPixelRatio(2)).toBe(2)
    expect(resolveIsometricRendererPixelRatio(3)).toBe(MAX_ISOMETRIC_RENDERER_PIXEL_RATIO)
  })
})
