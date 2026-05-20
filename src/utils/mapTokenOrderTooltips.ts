import type { TokenOrderMenuOption } from '~/utils/mapTokenOrders'
import type { RefTooltipDetail, RefTooltipMeta, RefTooltipSection } from '~/utils/refLinks'

const hasTooltipValue = (value: string | number | null | undefined): value is string | number =>
  value !== null && value !== undefined && value !== ''

const addMeta = (
  meta: RefTooltipMeta[],
  label: string,
  value: string | number | null | undefined,
) => {
  if (!hasTooltipValue(value)) return
  meta.push({ label, value })
}

const buildSourceLines = (order: TokenOrderMenuOption): string[] => {
  const lines: string[] = []
  if (order.sourceLabel) lines.push(`Source: ${order.sourceLabel}`)
  if (order.tags.length) lines.push(`Tags: ${order.tags.join(', ')}`)
  return lines
}

const buildTooltipSections = (order: TokenOrderMenuOption): RefTooltipSection[] => {
  const sourceLines = buildSourceLines(order)
  return [
    ...(sourceLines.length ? [{ heading: 'Sheet', body: sourceLines.join('\n') }] : []),
    ...(order.condition ? [{ heading: 'Condition', body: order.condition }] : []),
    ...(order.effect ? [{ heading: 'Effect', body: order.effect }] : []),
  ]
}

export const buildTokenOrderTooltipDetail = (order: TokenOrderMenuOption): RefTooltipDetail => {
  const meta: RefTooltipMeta[] = []
  addMeta(meta, 'Freq', order.frequency)
  addMeta(meta, 'Trigger', order.trigger)
  addMeta(meta, 'Target', order.target)

  return {
    kind: 'order',
    name: order.name,
    meta,
    sections: buildTooltipSections(order),
  }
}
