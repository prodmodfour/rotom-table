import type { WebGLRendererParameters } from 'three'

/**
 * No-quality-loss guardrail: isometric performance work must keep WebGL
 * antialiasing enabled. Optimize by reducing duplicate work instead of
 * degrading edge quality.
 */
export const ISOMETRIC_WEBGL_RENDERER_PARAMETERS = {
  antialias: true,
  alpha: false,
} satisfies WebGLRendererParameters

/**
 * Preserve the renderer's existing high-DPI behaviour. The cap avoids
 * pathological canvas sizes, but device pixel ratio values at or below the cap
 * should pass through unchanged rather than being lowered for performance.
 */
export const MAX_ISOMETRIC_RENDERER_PIXEL_RATIO = 2

export const resolveIsometricRendererPixelRatio = (devicePixelRatio: number): number =>
  Math.min(devicePixelRatio, MAX_ISOMETRIC_RENDERER_PIXEL_RATIO)
