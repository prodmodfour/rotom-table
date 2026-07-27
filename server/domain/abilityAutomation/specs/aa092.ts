import type { AbilitySpecV1Registration } from '../registry'
import {
  remainingAbilityRegistrations,
  remainingActivatedAbilitySpec as activatedSpec,
  remainingStaticAbilitySpec as staticSpec,
  remainingTriggeredAbilitySpec as triggeredSpec,
} from './aa085to100Shared'

export const STALWART_ABILITY_SPEC = triggeredSpec('Stalwart', 'aa092.stalwart', 'hp')
export const STAMINA_ABILITY_SPEC = triggeredSpec('Stamina', 'aa092.stamina', 'move')
export const STANCE_CHANGE_ABILITY_SPEC = staticSpec('Stance Change', 'aa092.stance-change')
export const STARLIGHT_ABILITY_SPEC = activatedSpec('Starlight', 'aa092.starlight')
export const STARSWIRL_ABILITY_SPEC = activatedSpec('Starswirl', 'aa092.starswirl')
export const STATIC_ABILITY_SPEC = triggeredSpec('Static', 'aa092.static', 'move')
export const STEADFAST_ABILITY_SPEC = triggeredSpec('Steadfast', 'aa092.steadfast', 'condition')
export const STEAM_ENGINE_ABILITY_SPEC = triggeredSpec('Steam Engine', 'aa092.steam-engine', 'move')
export const STEELWORKER_ABILITY_SPEC = triggeredSpec('Steelworker', 'aa092.steelworker', 'move')
export const STENCH_ABILITY_SPEC = staticSpec('Stench', 'aa092.stench')
export const STICKY_HOLD_ABILITY_SPEC = staticSpec('Sticky Hold', 'aa092.sticky-hold')
export const STICKY_SMOKE_ABILITY_SPEC = staticSpec('Sticky Smoke', 'aa092.sticky-smoke')

export const AA092_ABILITY_SPECS = Object.freeze([
  STALWART_ABILITY_SPEC, STAMINA_ABILITY_SPEC, STANCE_CHANGE_ABILITY_SPEC, STARLIGHT_ABILITY_SPEC, STARSWIRL_ABILITY_SPEC, STATIC_ABILITY_SPEC, STEADFAST_ABILITY_SPEC, STEAM_ENGINE_ABILITY_SPEC, STEELWORKER_ABILITY_SPEC, STENCH_ABILITY_SPEC, STICKY_HOLD_ABILITY_SPEC, STICKY_SMOKE_ABILITY_SPEC,
])

export const AA092_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = remainingAbilityRegistrations(
  'server/domain/abilityAutomation/specs/aa092.ts',
  AA092_ABILITY_SPECS,
)
