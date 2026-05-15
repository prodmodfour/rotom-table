import type { TokenAbilityMenuOption } from '~/utils/mapTokenAbilities'
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

const buildSheetLines = (ability: TokenAbilityMenuOption): string[] => {
  const lines: string[] = []
  if (ability.automation) lines.push(`Automation: ${ability.automation.label}`)
  if (ability.automation?.category === 'sheet') {
    lines.push(`Status: ${ability.activated ? 'Active' : 'Inactive'}`)
  }
  if (!ability.automation) lines.push('Automation: Not yet automated')
  return lines
}

const buildTooltipSections = (ability: TokenAbilityMenuOption): RefTooltipSection[] => {
  const sheetLines = buildSheetLines(ability)
  return [
    ...(sheetLines.length ? [{ heading: 'Sheet', body: sheetLines.join('\n') }] : []),
    ...(ability.trigger ? [{ heading: 'Trigger', body: ability.trigger }] : []),
    ...(ability.effect ? [{ heading: 'Effect', body: ability.effect }] : []),
    ...(ability.bonus ? [{ heading: 'Bonus', body: ability.bonus }] : []),
  ]
}

export const buildTokenAbilityTooltipDetail = (ability: TokenAbilityMenuOption): RefTooltipDetail => {
  const meta: RefTooltipMeta[] = []
  addMeta(meta, 'Freq', ability.frequency)
  addMeta(meta, 'Use', ability.automation?.label ?? null)

  return {
    kind: 'ability',
    name: ability.name,
    meta,
    sections: buildTooltipSections(ability),
  }
}
