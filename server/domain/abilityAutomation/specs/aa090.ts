import type { AbilitySpecV1Registration } from '../registry'
import {
  remainingAbilityRegistrations,
  remainingActivatedAbilitySpec as activatedSpec,
  remainingStaticAbilitySpec as staticSpec,
  remainingTriggeredAbilitySpec as triggeredSpec,
} from './aa085to100Shared'

export const SLUSH_RUSH_ABILITY_SPEC = staticSpec('Slush Rush', 'aa090.slush-rush')
export const SNIPER_ABILITY_SPEC = staticSpec('Sniper', 'aa090.sniper')
export const SNOW_CLOAK_ABILITY_SPEC = staticSpec('Snow Cloak', 'aa090.snow-cloak')
export const SNOW_WARNING_ABILITY_SPEC = activatedSpec('Snow Warning', 'aa090.snow-warning')
export const SNUGGLE_ABILITY_SPEC = activatedSpec('Snuggle', 'aa090.snuggle', [
  { kind: 'token', relationship: 'other', maximumRange: 1, adjacent: true }
])
export const SOL_VEIL_ABILITY_SPEC = staticSpec('Sol Veil', 'aa090.sol-veil')
export const SOLAR_POWER_ABILITY_SPEC = triggeredSpec('Solar Power', 'aa090.solar-power', 'move')
export const SOLID_ROCK_ABILITY_SPEC = staticSpec('Solid Rock', 'aa090.solid-rock')
export const SONIC_COURTSHIP_ABILITY_SPEC = triggeredSpec('Sonic Courtship', 'aa090.sonic-courtship', 'move')
export const SOOTHING_TONE_ABILITY_SPEC = staticSpec('Soothing Tone', 'aa090.soothing-tone')
export const SORCERY_ABILITY_SPEC = staticSpec('Sorcery', 'aa090.sorcery')
export const SOUL_HEART_ABILITY_SPEC = triggeredSpec('Soul Heart', 'aa090.soul-heart', 'hp')

export const AA090_ABILITY_SPECS = Object.freeze([
  SLUSH_RUSH_ABILITY_SPEC, SNIPER_ABILITY_SPEC, SNOW_CLOAK_ABILITY_SPEC, SNOW_WARNING_ABILITY_SPEC, SNUGGLE_ABILITY_SPEC, SOL_VEIL_ABILITY_SPEC, SOLAR_POWER_ABILITY_SPEC, SOLID_ROCK_ABILITY_SPEC, SONIC_COURTSHIP_ABILITY_SPEC, SOOTHING_TONE_ABILITY_SPEC, SORCERY_ABILITY_SPEC, SOUL_HEART_ABILITY_SPEC,
])

export const AA090_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = remainingAbilityRegistrations(
  'server/domain/abilityAutomation/specs/aa090.ts',
  AA090_ABILITY_SPECS,
)
