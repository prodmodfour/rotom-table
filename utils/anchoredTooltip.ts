export type TooltipPlacement = 'top' | 'bottom'

export interface TooltipBounds {
  top: number
  bottom: number
  left: number
  width: number
  height: number
}

export interface TooltipViewport {
  width: number
  height: number
}

export interface AnchoredTooltipOptions {
  margin?: number
  gap?: number
}

export interface AnchoredTooltipPosition {
  top: number
  left: number
  placement: TooltipPlacement
}

export const DEFAULT_TOOLTIP_MARGIN = 12
export const DEFAULT_TOOLTIP_GAP = 8

/**
 * Calculate a fixed-position tooltip anchor that stays within the viewport.
 *
 * The returned `left` is the tooltip center X because the tooltip element uses
 * `translateX(-50%)`. `placement` describes whether the tooltip should render
 * below or above the anchor for arrow/animation styling.
 */
export const computeAnchoredTooltipPosition = (
  anchorRect: TooltipBounds,
  tooltipRect: Pick<TooltipBounds, 'width' | 'height'>,
  viewport: TooltipViewport,
  options: AnchoredTooltipOptions = {},
): AnchoredTooltipPosition => {
  const margin = options.margin ?? DEFAULT_TOOLTIP_MARGIN
  const gap = options.gap ?? DEFAULT_TOOLTIP_GAP
  const halfWidth = tooltipRect.width / 2

  let left = anchorRect.left + anchorRect.width / 2
  left = Math.max(margin + halfWidth, Math.min(viewport.width - margin - halfWidth, left))

  let top = anchorRect.bottom + gap
  let placement: TooltipPlacement = 'bottom'

  if (
    top + tooltipRect.height + margin > viewport.height
    && anchorRect.top - gap - tooltipRect.height >= margin
  ) {
    top = anchorRect.top - gap - tooltipRect.height
    placement = 'top'
  } else if (top + tooltipRect.height + margin > viewport.height) {
    top = Math.max(margin, viewport.height - margin - tooltipRect.height)
  }

  return { top, left, placement }
}
