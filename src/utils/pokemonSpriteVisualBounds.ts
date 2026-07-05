import type { SpriteVisualBounds, SpriteVisualBoundsRecord } from '~/types/pokemon'

export const toSpriteVisualBounds = (
  record: SpriteVisualBoundsRecord | null | undefined,
): SpriteVisualBounds | undefined => (
  record
    ? {
        canvasWidth: record.canvas_width,
        canvasHeight: record.canvas_height,
        left: record.left,
        top: record.top,
        width: record.width,
        height: record.height,
        floating: record.floating,
      }
    : undefined
)
