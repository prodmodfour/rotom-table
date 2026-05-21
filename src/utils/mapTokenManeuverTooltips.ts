import type { TokenManeuverMenuOption } from '~/utils/mapTokenManeuvers'
import type { RefTooltipDetail, RefTooltipMeta, RefTooltipSection } from '~/utils/refLinks'

const hasTooltipValue = (value: string | number | null | undefined): value is string | number =>
  value !== null && value !== undefined && value !== ''

const addMeta = (
  meta: RefTooltipMeta[],
  label: string,
  value: string | number | null | undefined,
  badge?: RefTooltipMeta['badge'],
) => {
  if (!hasTooltipValue(value)) return
  meta.push(badge ? { label, value, badge } : { label, value })
}

const buildSheetLines = (maneuver: TokenManeuverMenuOption): string[] => {
  const lines: string[] = []
  if (maneuver.sourceLabel) lines.push(`Source: ${maneuver.sourceLabel}`)
  return lines
}

const buildTooltipSections = (maneuver: TokenManeuverMenuOption): RefTooltipSection[] => {
  const sheetLines = buildSheetLines(maneuver)
  return [
    ...(sheetLines.length ? [{ heading: 'Sheet', body: sheetLines.join('\n') }] : []),
    ...(maneuver.trigger ? [{ heading: 'Trigger', body: maneuver.trigger }] : []),
    ...(maneuver.effect ? [{ heading: 'Effect', body: maneuver.effect }] : []),
    ...(maneuver.special ? [{ heading: 'Special', body: maneuver.special }] : []),
  ]
}

export const buildTokenManeuverTooltipDetail = (maneuver: TokenManeuverMenuOption): RefTooltipDetail => {
  const meta: RefTooltipMeta[] = []
  addMeta(meta, 'Category', maneuver.category)
  addMeta(meta, 'Action', maneuver.action)
  addMeta(meta, 'Class', maneuver.maneuverClass, 'damage-class')
  addMeta(meta, 'AC', maneuver.ac)
  addMeta(meta, 'Range', maneuver.range)

  return {
    kind: 'maneuver',
    name: maneuver.name,
    meta,
    sections: buildTooltipSections(maneuver),
  }
}
