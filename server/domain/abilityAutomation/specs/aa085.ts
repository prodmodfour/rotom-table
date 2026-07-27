import type { AbilitySpecV1Registration } from '../registry'
import {
  remainingAbilityRegistrations,
  remainingActivatedAbilitySpec as activatedSpec,
  remainingStaticAbilitySpec as staticSpec,
  remainingTriggeredAbilitySpec as triggeredSpec,
} from './aa085to100Shared'

export const PSYCHIC_SURGE_ABILITY_SPEC = activatedSpec('Psychic Surge', 'aa085.psychic-surge')
export const PUMPKINGRAB_ABILITY_SPEC = activatedSpec('Pumpkingrab', 'aa085.pumpkingrab', [
  { kind: 'token', relationship: 'enemy', maximumRange: 1, adjacent: true }
])
export const PUNK_ROCK_ABILITY_SPEC = staticSpec('Punk Rock', 'aa085.punk-rock')
export const PURE_BLOODED_ABILITY_SPEC = staticSpec('Pure Blooded', 'aa085.pure-blooded')
export const PURE_POWER_ABILITY_SPEC = staticSpec('Pure Power', 'aa085.pure-power')
export const QUEENLY_MAJESTY_ABILITY_SPEC = triggeredSpec('Queenly Majesty', 'aa085.queenly-majesty', 'move')
export const QUICK_CLOAK_ABILITY_SPEC = activatedSpec('Quick Cloak', 'aa085.quick-cloak', [
  { kind: 'type' }
])
export const QUICK_CURL_ABILITY_SPEC = activatedSpec('Quick Curl', 'aa085.quick-curl')
export const QUICK_DRAW_ABILITY_SPEC = triggeredSpec('Quick Draw', 'aa085.quick-draw', 'move')
export const QUICK_FEET_ABILITY_SPEC = staticSpec('Quick Feet', 'aa085.quick-feet')
export const RKS_SYSTEM_ABILITY_SPEC = triggeredSpec('RKS System', 'aa085.rks-system', 'move')
export const RADIANT_BEAM_ABILITY_SPEC = staticSpec('Radiant Beam', 'aa085.radiant-beam')

export const AA085_ABILITY_SPECS = Object.freeze([
  PSYCHIC_SURGE_ABILITY_SPEC, PUMPKINGRAB_ABILITY_SPEC, PUNK_ROCK_ABILITY_SPEC, PURE_BLOODED_ABILITY_SPEC, PURE_POWER_ABILITY_SPEC, QUEENLY_MAJESTY_ABILITY_SPEC, QUICK_CLOAK_ABILITY_SPEC, QUICK_CURL_ABILITY_SPEC, QUICK_DRAW_ABILITY_SPEC, QUICK_FEET_ABILITY_SPEC, RKS_SYSTEM_ABILITY_SPEC, RADIANT_BEAM_ABILITY_SPEC,
])

export const AA085_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = remainingAbilityRegistrations(
  'server/domain/abilityAutomation/specs/aa085.ts',
  AA085_ABILITY_SPECS,
)
