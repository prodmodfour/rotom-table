import type { AbilitySpecV1Registration } from '../registry'
import {
  remainingAbilityRegistrations,
  remainingActivatedAbilitySpec as activatedSpec,
  remainingStaticAbilitySpec as staticSpec,
  remainingTriggeredAbilitySpec as triggeredSpec,
} from './aa085to100Shared'

export const RAGELOPE_ABILITY_SPEC = staticSpec('Ragelope', 'aa086.ragelope')
export const RAIN_DISH_ABILITY_SPEC = activatedSpec('Rain Dish', 'aa086.rain-dish')
export const RALLY_ABILITY_SPEC = activatedSpec('Rally', 'aa086.rally')
export const RATTLED_ABILITY_SPEC = triggeredSpec('Rattled', 'aa086.rattled', 'move')
export const RAZOR_EDGE_ABILITY_SPEC = staticSpec('Razor Edge', 'aa086.razor-edge')
export const RECEIVER_ABILITY_SPEC = triggeredSpec('Receiver', 'aa086.receiver', 'hp')
export const RECKLESS_ABILITY_SPEC = staticSpec('Reckless', 'aa086.reckless')
export const REFRESHING_VEIL_ABILITY_SPEC = triggeredSpec('Refreshing Veil', 'aa086.refreshing-veil', 'move')
export const REFRIGERATE_ABILITY_SPEC = triggeredSpec('Refrigerate', 'aa086.refrigerate', 'move')
export const REGAL_CHALLENGE_ABILITY_SPEC = activatedSpec('Regal Challenge', 'aa086.regal-challenge', [
  { kind: 'token', relationship: 'other', maximumRange: 5 },
  { kind: 'branch' },
])
export const REGENERATOR_ABILITY_SPEC = triggeredSpec('Regenerator', 'aa086.regenerator', 'presence')
export const REVELATION_ABILITY_SPEC = triggeredSpec('Revelation', 'aa086.revelation', 'move')

export const AA086_ABILITY_SPECS = Object.freeze([
  RAGELOPE_ABILITY_SPEC, RAIN_DISH_ABILITY_SPEC, RALLY_ABILITY_SPEC, RATTLED_ABILITY_SPEC, RAZOR_EDGE_ABILITY_SPEC, RECEIVER_ABILITY_SPEC, RECKLESS_ABILITY_SPEC, REFRESHING_VEIL_ABILITY_SPEC, REFRIGERATE_ABILITY_SPEC, REGAL_CHALLENGE_ABILITY_SPEC, REGENERATOR_ABILITY_SPEC, REVELATION_ABILITY_SPEC,
])

export const AA086_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = remainingAbilityRegistrations(
  'server/domain/abilityAutomation/specs/aa086.ts',
  AA086_ABILITY_SPECS,
)
