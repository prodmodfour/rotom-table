import { ATTACK_OF_OPPORTUNITY_CANONICAL_ID } from '#shared/moveAutomation/attackOfOpportunity'
import type { PendingMoveResponseWindowView } from '#shared/moveAutomation/responseViews'
import type { PendingMoveResponsePublicOption } from '#shared/moveAutomation/responseOptions'

export { ATTACK_OF_OPPORTUNITY_CANONICAL_ID } from '#shared/moveAutomation/attackOfOpportunity'

const REVIEWED_PENDING_MOVE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'move.explosion.adjudicate-loyalty': 'Should using Explosion lower the user’s Loyalty by 1?',
  'move.self-destruct.adjudicate-loyalty': 'Should using Self-Destruct lower the user’s Loyalty by 1?',
  'move.self-ko.lower-loyalty-by-one': 'Lower Loyalty by 1',
})

export const pendingMoveResponseLookupLabel = (key: string): string => {
  const reviewed = REVIEWED_PENDING_MOVE_LABELS[key]
  if (reviewed) return reviewed
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
