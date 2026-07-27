import type { AbilitySpecV1Registration } from '../registry'
import {
  remainingAbilityRegistrations,
  remainingActivatedAbilitySpec as activatedSpec,
  remainingActivatedTriggeredAbilitySpec as activatedTriggeredSpec,
  remainingStaticAbilitySpec as staticSpec,
  remainingTriggeredAbilitySpec as triggeredSpec,
} from './aa085to100Shared'

export const RIPEN_ABILITY_SPEC = staticSpec('Ripen', 'aa087.ripen')
export const RIVALRY_ABILITY_SPEC = staticSpec('Rivalry', 'aa087.rivalry')
export const ROCK_HEAD_ABILITY_SPEC = staticSpec('Rock Head', 'aa087.rock-head')
export const ROCKET_ABILITY_SPEC = activatedTriggeredSpec('Rocket', 'aa087.rocket', 'lifecycle')
export const ROOT_DOWN_ABILITY_SPEC = activatedSpec('Root Down', 'aa087.root-down')
export const ROUGH_SKIN_ABILITY_SPEC = triggeredSpec('Rough Skin', 'aa087.rough-skin', 'move')
export const RUN_AWAY_ABILITY_SPEC = staticSpec('Run Away', 'aa087.run-away')
export const RUN_UP_ABILITY_SPEC = staticSpec('Run Up', 'aa087.run-up')
export const SACRED_BELL_ABILITY_SPEC = staticSpec('Sacred Bell', 'aa087.sacred-bell')
export const SAND_FORCE_ABILITY_SPEC = staticSpec('Sand Force', 'aa087.sand-force')
export const SAND_RUSH_ABILITY_SPEC = staticSpec('Sand Rush', 'aa087.sand-rush')
export const SAND_SPIT_ABILITY_SPEC = triggeredSpec('Sand Spit', 'aa087.sand-spit', 'move')

export const AA087_ABILITY_SPECS = Object.freeze([
  RIPEN_ABILITY_SPEC, RIVALRY_ABILITY_SPEC, ROCK_HEAD_ABILITY_SPEC, ROCKET_ABILITY_SPEC, ROOT_DOWN_ABILITY_SPEC, ROUGH_SKIN_ABILITY_SPEC, RUN_AWAY_ABILITY_SPEC, RUN_UP_ABILITY_SPEC, SACRED_BELL_ABILITY_SPEC, SAND_FORCE_ABILITY_SPEC, SAND_RUSH_ABILITY_SPEC, SAND_SPIT_ABILITY_SPEC,
])

export const AA087_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = remainingAbilityRegistrations(
  'server/domain/abilityAutomation/specs/aa087.ts',
  AA087_ABILITY_SPECS,
)
