import type { AbilitySpecV1Registration } from '../registry'
import {
  remainingAbilityRegistrations,
  remainingActivatedAbilitySpec as activatedSpec,
  remainingStaticAbilitySpec as staticSpec,
  remainingTriggeredAbilitySpec as triggeredSpec,
} from './aa085to100Shared'

export const WEIRD_POWER_ABILITY_SPEC = staticSpec('Weird Power', 'aa099.weird-power')
export const WHIRLWIND_KICKS_ABILITY_SPEC = staticSpec('Whirlwind Kicks', 'aa099.whirlwind-kicks')
export const WHITE_FLAME_ABILITY_SPEC = staticSpec('White Flame', 'aa099.white-flame')
export const WHITE_SMOKE_ABILITY_SPEC = staticSpec('White Smoke', 'aa099.white-smoke')
export const WILY_ABILITY_SPEC = staticSpec('Wily', 'aa099.wily')
export const WIND_POWER_ABILITY_SPEC = triggeredSpec('Wind Power', 'aa099.wind-power', 'move')
export const WINDVEILED_ABILITY_SPEC = staticSpec('Windveiled', 'aa099.windveiled')
export const WINTERS_KISS_ABILITY_SPEC = staticSpec('Winter’s Kiss', 'aa099.winters-kiss')
export const WISHMASTER_ABILITY_SPEC = staticSpec('Wishmaster', 'aa099.wishmaster')
export const WISTFUL_MELODY_ABILITY_SPEC = triggeredSpec('Wistful Melody', 'aa099.wistful-melody', 'move')
export const WOBBLE_ABILITY_SPEC = triggeredSpec('Wobble', 'aa099.wobble', 'move')
export const WONDER_GUARD_ABILITY_SPEC = staticSpec('Wonder Guard', 'aa099.wonder-guard')

export const AA099_ABILITY_SPECS = Object.freeze([
  WEIRD_POWER_ABILITY_SPEC, WHIRLWIND_KICKS_ABILITY_SPEC, WHITE_FLAME_ABILITY_SPEC, WHITE_SMOKE_ABILITY_SPEC, WILY_ABILITY_SPEC, WIND_POWER_ABILITY_SPEC, WINDVEILED_ABILITY_SPEC, WINTERS_KISS_ABILITY_SPEC, WISHMASTER_ABILITY_SPEC, WISTFUL_MELODY_ABILITY_SPEC, WOBBLE_ABILITY_SPEC, WONDER_GUARD_ABILITY_SPEC,
])

export const AA099_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = remainingAbilityRegistrations(
  'server/domain/abilityAutomation/specs/aa099.ts',
  AA099_ABILITY_SPECS,
)
