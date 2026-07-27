import type { AbilitySpecV1Registration } from '../registry'
import {
  remainingAbilityRegistrations,
  remainingActivatedAbilitySpec as activatedSpec,
  remainingStaticAbilitySpec as staticSpec,
  remainingTriggeredAbilitySpec as triggeredSpec,
} from './aa085to100Shared'

export const UNAWARE_ABILITY_SPEC = staticSpec('Unaware', 'aa097.unaware')
export const UNBREAKABLE_ABILITY_SPEC = staticSpec('Unbreakable', 'aa097.unbreakable')
export const UNBURDEN_ABILITY_SPEC = staticSpec('Unburden', 'aa097.unburden')
export const UNNERVE_ABILITY_SPEC = activatedSpec('Unnerve', 'aa097.unnerve', [
  { kind: 'token', relationship: 'enemy', maximumRange: 10 }
])
export const UNSEEN_FIST_ABILITY_SPEC = staticSpec('Unseen Fist', 'aa097.unseen-fist')
export const VANGUARD_ABILITY_SPEC = staticSpec('Vanguard', 'aa097.vanguard')
export const VENOM_ABILITY_SPEC = staticSpec('Venom', 'aa097.venom')
export const VICIOUS_ABILITY_SPEC = triggeredSpec('Vicious', 'aa097.vicious', 'move')
export const VICTORY_STAR_ABILITY_SPEC = staticSpec('Victory Star', 'aa097.victory-star')
export const VIGOR_ABILITY_SPEC = triggeredSpec('Vigor', 'aa097.vigor', 'move')
export const VITAL_SPIRIT_ABILITY_SPEC = staticSpec('Vital Spirit', 'aa097.vital-spirit')
export const VOLT_ABSORB_ABILITY_SPEC = staticSpec('Volt Absorb', 'aa097.volt-absorb')

export const AA097_ABILITY_SPECS = Object.freeze([
  UNAWARE_ABILITY_SPEC, UNBREAKABLE_ABILITY_SPEC, UNBURDEN_ABILITY_SPEC, UNNERVE_ABILITY_SPEC, UNSEEN_FIST_ABILITY_SPEC, VANGUARD_ABILITY_SPEC, VENOM_ABILITY_SPEC, VICIOUS_ABILITY_SPEC, VICTORY_STAR_ABILITY_SPEC, VIGOR_ABILITY_SPEC, VITAL_SPIRIT_ABILITY_SPEC, VOLT_ABSORB_ABILITY_SPEC,
])

export const AA097_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = remainingAbilityRegistrations(
  'server/domain/abilityAutomation/specs/aa097.ts',
  AA097_ABILITY_SPECS,
)
