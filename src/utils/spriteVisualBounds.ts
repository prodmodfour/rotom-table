import type { SpriteVisualBounds } from '~/types/pokemon'

export interface SpriteVisualBoundsBodyCenter {
  /** Normalized source-canvas X coordinate, where 0 is left and 1 is right. */
  x: number
  /** Normalized source-canvas Y coordinate, where 0 is top and 1 is bottom. */
  y: number
}

export interface SpriteVisualBoundsFrameTranslation {
  /** CSS translate X percentage needed to move the visible body centre to the square frame centre. */
  xPercent: number
  /** CSS translate Y percentage needed to move the visible body centre to the square frame centre. */
  yPercent: number
}

export interface SpriteVisualBoundsFrameDebugPoint {
  xPercent: number
  yPercent: number
}

export interface SpriteVisualBoundsFrameDebugRect {
  leftPercent: number
  topPercent: number
  widthPercent: number
  heightPercent: number
}

export interface SpriteVisualBoundsFrameDebugMetrics {
  /** The object-fit: contain canvas box inside the square sprite frame. */
  canvas: SpriteVisualBoundsFrameDebugRect
  /** The visual alpha/body bounds inside the source canvas, or null when metadata is missing/malformed. */
  bounds: SpriteVisualBoundsFrameDebugRect | null
  /** The visible body centre inside the source canvas, or null when metadata is missing/malformed. */
  bodyCenter: SpriteVisualBoundsFrameDebugPoint | null
  canvasCenter: SpriteVisualBoundsFrameDebugPoint
  cageCenter: SpriteVisualBoundsFrameDebugPoint
  translation: SpriteVisualBoundsFrameTranslation
  floating: boolean
}

export interface SpriteVisualBoundsWorldOffsetDimensions {
  /** World-space rendered sprite height; this is the artwork height, not the tactical clearance. */
  height: number
  /** World-space tactical clearance whose midpoint is the target body centre for floating sprites. */
  clearance: number
}

type NormalizedSpriteVisualBounds = SpriteVisualBounds

const CANVAS_CENTER = 0.5
const PERCENT_SCALE = 100

/**
 * A visual-bounds translation may move artwork by at most half of its frame.
 * This still allows any valid normalized centre to be aligned, while preventing
 * corrupt metadata from sending sprites far beyond the cage.
 */
export const SPRITE_VISUAL_BOUNDS_MAX_FRAME_TRANSLATE_PERCENT = 50

/** World offsets are capped to half of the larger visual/tactical token height. */
export const SPRITE_VISUAL_BOUNDS_MAX_WORLD_OFFSET_FACTOR = 0.5

export const ZERO_SPRITE_VISUAL_BOUNDS_FRAME_TRANSLATION: Readonly<SpriteVisualBoundsFrameTranslation> = Object.freeze({
  xPercent: 0,
  yPercent: 0,
})

const FULL_SPRITE_VISUAL_BOUNDS_DEBUG_RECT: Readonly<SpriteVisualBoundsFrameDebugRect> = Object.freeze({
  leftPercent: 0,
  topPercent: 0,
  widthPercent: 100,
  heightPercent: 100,
})

const SPRITE_VISUAL_BOUNDS_CENTER_DEBUG_POINT: Readonly<SpriteVisualBoundsFrameDebugPoint> = Object.freeze({
  xPercent: 50,
  yPercent: 50,
})

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const finitePositiveNumber = (value: number): boolean => Number.isFinite(value) && value > 0

const cleanOffset = (value: number): number => (Math.abs(value) < Number.EPSILON ? 0 : value)

const clampSymmetric = (value: number, maxMagnitude: number): number => {
  if (!Number.isFinite(value) || !finitePositiveNumber(maxMagnitude)) return 0
  return cleanOffset(clamp(value, -maxMagnitude, maxMagnitude))
}

const normalizeSpriteVisualBounds = (
  bounds: SpriteVisualBounds | null | undefined,
): NormalizedSpriteVisualBounds | null => {
  if (!bounds) return null
  if (!finitePositiveNumber(bounds.canvasWidth) || !finitePositiveNumber(bounds.canvasHeight)) return null
  if (!finitePositiveNumber(bounds.width) || !finitePositiveNumber(bounds.height)) return null
  if (!Number.isFinite(bounds.left) || !Number.isFinite(bounds.top)) return null

  const rawRight = bounds.left + bounds.width
  const rawBottom = bounds.top + bounds.height
  if (!Number.isFinite(rawRight) || !Number.isFinite(rawBottom)) return null

  const left = clamp(bounds.left, 0, bounds.canvasWidth)
  const top = clamp(bounds.top, 0, bounds.canvasHeight)
  const right = clamp(rawRight, 0, bounds.canvasWidth)
  const bottom = clamp(rawBottom, 0, bounds.canvasHeight)
  if (right <= left || bottom <= top) return null

  return {
    canvasWidth: bounds.canvasWidth,
    canvasHeight: bounds.canvasHeight,
    left,
    top,
    width: right - left,
    height: bottom - top,
    floating: bounds.floating === true,
  }
}

const getBodyCenterFromNormalizedBounds = (
  bounds: NormalizedSpriteVisualBounds,
): SpriteVisualBoundsBodyCenter => ({
  x: clamp((bounds.left + bounds.width / 2) / bounds.canvasWidth, 0, 1),
  y: clamp((bounds.top + bounds.height / 2) / bounds.canvasHeight, 0, 1),
})

const getBodyCenterInSquareFrame = (
  bounds: NormalizedSpriteVisualBounds,
): SpriteVisualBoundsBodyCenter => {
  const center = getBodyCenterFromNormalizedBounds(bounds)

  if (bounds.canvasWidth === bounds.canvasHeight) return center

  if (bounds.canvasWidth > bounds.canvasHeight) {
    const renderedHeight = bounds.canvasHeight / bounds.canvasWidth
    const verticalInset = (1 - renderedHeight) / 2
    return {
      x: center.x,
      y: verticalInset + center.y * renderedHeight,
    }
  }

  const renderedWidth = bounds.canvasWidth / bounds.canvasHeight
  const horizontalInset = (1 - renderedWidth) / 2
  return {
    x: horizontalInset + center.x * renderedWidth,
    y: center.y,
  }
}

const getCanvasRectInSquareFrame = (
  bounds: NormalizedSpriteVisualBounds,
): SpriteVisualBoundsFrameDebugRect => {
  if (bounds.canvasWidth === bounds.canvasHeight) return { ...FULL_SPRITE_VISUAL_BOUNDS_DEBUG_RECT }

  if (bounds.canvasWidth > bounds.canvasHeight) {
    const heightPercent = (bounds.canvasHeight / bounds.canvasWidth) * PERCENT_SCALE
    return {
      leftPercent: 0,
      topPercent: (PERCENT_SCALE - heightPercent) / 2,
      widthPercent: PERCENT_SCALE,
      heightPercent,
    }
  }

  const widthPercent = (bounds.canvasWidth / bounds.canvasHeight) * PERCENT_SCALE
  return {
    leftPercent: (PERCENT_SCALE - widthPercent) / 2,
    topPercent: 0,
    widthPercent,
    heightPercent: PERCENT_SCALE,
  }
}

const getBoundsRectInCanvas = (
  bounds: NormalizedSpriteVisualBounds,
): SpriteVisualBoundsFrameDebugRect => ({
  leftPercent: (bounds.left / bounds.canvasWidth) * PERCENT_SCALE,
  topPercent: (bounds.top / bounds.canvasHeight) * PERCENT_SCALE,
  widthPercent: (bounds.width / bounds.canvasWidth) * PERCENT_SCALE,
  heightPercent: (bounds.height / bounds.canvasHeight) * PERCENT_SCALE,
})

const getBodyCenterInCanvasPercent = (
  bounds: NormalizedSpriteVisualBounds,
): SpriteVisualBoundsFrameDebugPoint => {
  const center = getBodyCenterFromNormalizedBounds(bounds)
  return {
    xPercent: center.x * PERCENT_SCALE,
    yPercent: center.y * PERCENT_SCALE,
  }
}

/**
 * Returns the visible body centre in normalized source-canvas coordinates.
 * Missing or malformed metadata falls back to the canvas centre so consumers
 * can safely treat the result as neutral.
 */
export const getSpriteVisualBoundsBodyCenter = (
  bounds: SpriteVisualBounds | null | undefined,
): SpriteVisualBoundsBodyCenter => {
  const normalizedBounds = normalizeSpriteVisualBounds(bounds)
  if (!normalizedBounds) return { x: CANVAS_CENTER, y: CANVAS_CENTER }

  return getBodyCenterFromNormalizedBounds(normalizedBounds)
}

/**
 * Returns CSS translate percentages that centre a floating sprite's visible
 * body in a square frame. Positive Y percentages move artwork downward.
 */
export const getSpriteVisualBoundsFrameTranslation = (
  bounds: SpriteVisualBounds | null | undefined,
): SpriteVisualBoundsFrameTranslation => {
  const normalizedBounds = normalizeSpriteVisualBounds(bounds)
  if (!normalizedBounds?.floating) return { ...ZERO_SPRITE_VISUAL_BOUNDS_FRAME_TRANSLATION }

  const center = getBodyCenterInSquareFrame(normalizedBounds)

  return {
    xPercent: clampSymmetric(
      (CANVAS_CENTER - center.x) * PERCENT_SCALE,
      SPRITE_VISUAL_BOUNDS_MAX_FRAME_TRANSLATE_PERCENT,
    ),
    yPercent: clampSymmetric(
      (CANVAS_CENTER - center.y) * PERCENT_SCALE,
      SPRITE_VISUAL_BOUNDS_MAX_FRAME_TRANSLATE_PERCENT,
    ),
  }
}

/**
 * Returns percentages for a dev-only overlay that compares source-canvas
 * visual bounds with the final square cage centre. All percentages are safe to
 * expose as CSS custom properties.
 */
export const getSpriteVisualBoundsFrameDebugMetrics = (
  bounds: SpriteVisualBounds | null | undefined,
): SpriteVisualBoundsFrameDebugMetrics => {
  const normalizedBounds = normalizeSpriteVisualBounds(bounds)
  const translation = getSpriteVisualBoundsFrameTranslation(normalizedBounds)

  if (!normalizedBounds) {
    return {
      canvas: { ...FULL_SPRITE_VISUAL_BOUNDS_DEBUG_RECT },
      bounds: null,
      bodyCenter: null,
      canvasCenter: { ...SPRITE_VISUAL_BOUNDS_CENTER_DEBUG_POINT },
      cageCenter: { ...SPRITE_VISUAL_BOUNDS_CENTER_DEBUG_POINT },
      translation,
      floating: false,
    }
  }

  return {
    canvas: getCanvasRectInSquareFrame(normalizedBounds),
    bounds: getBoundsRectInCanvas(normalizedBounds),
    bodyCenter: getBodyCenterInCanvasPercent(normalizedBounds),
    canvasCenter: { ...SPRITE_VISUAL_BOUNDS_CENTER_DEBUG_POINT },
    cageCenter: { ...SPRITE_VISUAL_BOUNDS_CENTER_DEBUG_POINT },
    translation,
    floating: normalizedBounds.floating,
  }
}

/**
 * Returns a visual-only world-space Y offset that places a floating sprite's
 * body centre at half tactical clearance. Negative offsets move artwork down.
 */
export const getSpriteVisualBoundsWorldYOffset = (
  bounds: SpriteVisualBounds | null | undefined,
  dimensions: SpriteVisualBoundsWorldOffsetDimensions,
): number => {
  const normalizedBounds = normalizeSpriteVisualBounds(bounds)
  if (!normalizedBounds?.floating) return 0
  if (!finitePositiveNumber(dimensions.height) || !finitePositiveNumber(dimensions.clearance)) return 0

  const center = getBodyCenterFromNormalizedBounds(normalizedBounds)
  const bodyCenterY = (1 - center.y) * dimensions.height
  const targetCenterY = dimensions.clearance / 2
  const maxOffset = Math.max(dimensions.height, dimensions.clearance) * SPRITE_VISUAL_BOUNDS_MAX_WORLD_OFFSET_FACTOR

  return clampSymmetric(targetCenterY - bodyCenterY, maxOffset)
}
