import type { AbilitySpecV1Registration } from '../registry'
import {
  remainingAbilityRegistrations,
  remainingActivatedAbilitySpec as activatedSpec,
  remainingActivatedTriggeredAbilitySpec as activatedTriggeredSpec,
  remainingStaticAbilitySpec as staticSpec,
  remainingTriggeredAbilitySpec as triggeredSpec,
} from './aa085to100Shared'

export const STORM_DRAIN_ABILITY_SPEC = triggeredSpec('Storm Drain', 'aa093.storm-drain', 'move')
export const STRANGE_TEMPO_ABILITY_SPEC = activatedSpec('Strange Tempo', 'aa093.strange-tempo', [
  { kind: 'branch' },
])
export const STRONG_JAW_ABILITY_SPEC = staticSpec('Strong Jaw', 'aa093.strong-jaw')
export const STURDY_ABILITY_SPEC = staticSpec('Sturdy', 'aa093.sturdy')
export const SUCTION_CUPS_ABILITY_SPEC = activatedSpec('Suction Cups', 'aa093.suction-cups')
export const SUMO_STANCE_ABILITY_SPEC = triggeredSpec('Sumo Stance', 'aa093.sumo-stance', 'move')
export const SUN_BLANKET_ABILITY_SPEC = activatedTriggeredSpec('Sun Blanket', 'aa093.sun-blanket', 'lifecycle')
export const SUNGLOW_ABILITY_SPEC = activatedSpec('Sunglow', 'aa093.sunglow')
export const SUPER_LUCK_ABILITY_SPEC = staticSpec('Super Luck', 'aa093.super-luck')
export const SURGE_SURFER_ABILITY_SPEC = staticSpec('Surge Surfer', 'aa093.surge-surfer')
export const SWARM_ABILITY_SPEC = staticSpec('Swarm', 'aa093.swarm')
export const SWAY_ABILITY_SPEC = triggeredSpec('Sway', 'aa093.sway', 'move')

export const AA093_ABILITY_SPECS = Object.freeze([
  STORM_DRAIN_ABILITY_SPEC, STRANGE_TEMPO_ABILITY_SPEC, STRONG_JAW_ABILITY_SPEC, STURDY_ABILITY_SPEC, SUCTION_CUPS_ABILITY_SPEC, SUMO_STANCE_ABILITY_SPEC, SUN_BLANKET_ABILITY_SPEC, SUNGLOW_ABILITY_SPEC, SUPER_LUCK_ABILITY_SPEC, SURGE_SURFER_ABILITY_SPEC, SWARM_ABILITY_SPEC, SWAY_ABILITY_SPEC,
])

export const AA093_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = remainingAbilityRegistrations(
  'server/domain/abilityAutomation/specs/aa093.ts',
  AA093_ABILITY_SPECS,
)
