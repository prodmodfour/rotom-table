import type { AbilitySpecV1Registration } from '../registry'
import {
  remainingAbilityRegistrations,
  remainingActivatedAbilitySpec as activatedSpec,
  remainingActivatedTriggeredAbilitySpec as activatedTriggeredSpec,
  remainingStaticAbilitySpec as staticSpec,
  remainingTriggeredAbilitySpec as triggeredSpec,
} from './aa085to100Shared'

export const SOULSTEALER_ABILITY_SPEC = triggeredSpec('Soulstealer', 'aa091.soulstealer', 'hp')
export const SOUND_LANCE_ABILITY_SPEC = triggeredSpec('Sound Lance', 'aa091.sound-lance', 'move')
export const SOUNDPROOF_ABILITY_SPEC = staticSpec('Soundproof', 'aa091.soundproof')
export const SPEED_BOOST_ABILITY_SPEC = staticSpec('Speed Boost', 'aa091.speed-boost')
export const SPIKE_SHOT_ABILITY_SPEC = staticSpec('Spike Shot', 'aa091.spike-shot')
export const SPINNING_DANCE_ABILITY_SPEC = triggeredSpec('Spinning Dance', 'aa091.spinning-dance', 'move')
export const SPITEFUL_INTERVENTION_ABILITY_SPEC = staticSpec('Spiteful Intervention', 'aa091.spiteful-intervention')
export const SPLENDOROUS_RIDER_ABILITY_SPEC = activatedSpec('Splendorous Rider', 'aa091.splendorous-rider', [
  { kind: 'move' }
])
export const SPRAY_DOWN_ABILITY_SPEC = triggeredSpec('Spray Down', 'aa091.spray-down', 'move')
export const SPRINT_ABILITY_SPEC = activatedTriggeredSpec('Sprint', 'aa091.sprint', 'action')
export const STAKEOUT_ABILITY_SPEC = staticSpec('Stakeout', 'aa091.stakeout')
export const STALL_ABILITY_SPEC = staticSpec('Stall', 'aa091.stall')

export const AA091_ABILITY_SPECS = Object.freeze([
  SOULSTEALER_ABILITY_SPEC, SOUND_LANCE_ABILITY_SPEC, SOUNDPROOF_ABILITY_SPEC, SPEED_BOOST_ABILITY_SPEC, SPIKE_SHOT_ABILITY_SPEC, SPINNING_DANCE_ABILITY_SPEC, SPITEFUL_INTERVENTION_ABILITY_SPEC, SPLENDOROUS_RIDER_ABILITY_SPEC, SPRAY_DOWN_ABILITY_SPEC, SPRINT_ABILITY_SPEC, STAKEOUT_ABILITY_SPEC, STALL_ABILITY_SPEC,
])

export const AA091_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = remainingAbilityRegistrations(
  'server/domain/abilityAutomation/specs/aa091.ts',
  AA091_ABILITY_SPECS,
)
