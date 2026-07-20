import { ATTACK_OF_OPPORTUNITY_CANONICAL_ID } from '#shared/moveAutomation/attackOfOpportunity'
import type { PendingMoveResponseWindowView } from '#shared/moveAutomation/responseViews'
import type { PendingMoveResponsePublicOption } from '#shared/moveAutomation/responseOptions'

export { ATTACK_OF_OPPORTUNITY_CANONICAL_ID } from '#shared/moveAutomation/attackOfOpportunity'

export const pendingMoveResponseLookupLabel = (key: string): string => {
  const leaf = key.split('.').at(-1) ?? key
  const words = leaf.replace(/[-_]+/g, ' ').trim()
  return words.length > 0
    ? words.replace(/\b\w/g, character => character.toUpperCase())
    : key
}

export const pendingMoveResponseOptionLabel = (
  option: PendingMoveResponsePublicOption,
): string => {
  if (option.itemChoice) {
    if (option.itemChoice.canonicalItemId === null) {
      return pendingMoveResponseLookupLabel(option.labelKey)
    }
    return `${pendingMoveResponseLookupLabel(option.itemChoice.canonicalItemId)} → ${pendingMoveResponseLookupLabel(option.itemChoice.destinationLabelKey ?? 'item-destination')}`
  }

  const selection = option.selection
  if (!selection) return pendingMoveResponseLookupLabel(option.labelKey)
  const destination = selection.destination
  if (selection.kind === 'movement-direction') {
    return `${pendingMoveResponseLookupLabel(selection.direction)} → (${destination.x}, ${destination.y}, ${destination.z})`
  }
  return `Cell (${destination.x}, ${destination.y}, ${destination.z})`
}

export const isAttackOfOpportunityResponseWindow = (
  view: PendingMoveResponseWindowView,
): boolean => view.resolution.canonicalMoveId === ATTACK_OF_OPPORTUNITY_CANONICAL_ID
  || view.window.reasonCode.startsWith('maneuver.attack-of-opportunity.')
