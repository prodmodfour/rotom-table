import type { AbilityClientCapabilityStatus } from '#shared/abilityAutomation/clientCapabilities'
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

export const abilityCapabilityStatusLabel = (
  status: AbilityClientCapabilityStatus | null | undefined,
): string => {
  switch (status) {
    case 'ready': return 'Ready'
    case 'passive': return 'Passive'
    case 'blocked': return 'Blocked'
    case 'suppressed': return 'Suppressed'
    case 'parameters-required': return 'Setup required'
    case 'runtime-drift': return 'Runtime mismatch'
    default: return 'Unavailable'
  }
}

const buildSheetLines = (ability: TokenAbilityMenuOption): string[] => {
  const capability = ability.capability
  const lines = [`Automation: ${abilityCapabilityStatusLabel(capability?.status)}`]
  if (capability) {
    lines.push(`Interaction coverage: ${capability.interactionStatus}`)
    if (capability.unavailableReasonCode) lines.push(`Reason: ${capability.unavailableReasonCode}`)
  }
  return lines
}

const buildTooltipSections = (ability: TokenAbilityMenuOption): RefTooltipSection[] => {
  const sheetLines = buildSheetLines(ability)
  return [
    { heading: 'Automation', body: sheetLines.join('\n') },
    ...(ability.trigger ? [{ heading: 'Trigger', body: ability.trigger }] : []),
    ...(ability.effect ? [{ heading: 'Effect', body: ability.effect }] : []),
    ...(ability.bonus ? [{ heading: 'Bonus', body: ability.bonus }] : []),
  ]
}

export const buildTokenAbilityTooltipDetail = (ability: TokenAbilityMenuOption): RefTooltipDetail => {
  const meta: RefTooltipMeta[] = []
  addMeta(meta, 'Freq', ability.frequency)
  addMeta(meta, 'Use', abilityCapabilityStatusLabel(ability.capability?.status))

  return {
    kind: 'ability',
    name: ability.name,
    meta,
    sections: buildTooltipSections(ability),
  }
}
