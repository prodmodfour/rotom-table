import type { AbilitySpecV1Registration } from '../registry'
import {
  remainingAbilityRegistrations,
  remainingActivatedAbilitySpec as activatedSpec,
  remainingStaticAbilitySpec as staticSpec,
  remainingTriggeredAbilitySpec as triggeredSpec,
} from './aa085to100Shared'

export const SHADOW_TAG_ABILITY_SPEC = activatedSpec('Shadow Tag', 'aa089.shadow-tag', [
  { kind: 'token', relationship: 'other', maximumRange: 1, adjacent: true }
])
export const SHED_SKIN_ABILITY_SPEC = activatedSpec('Shed Skin', 'aa089.shed-skin', [
  { kind: 'branch' }
])
export const SHEER_FORCE_ABILITY_SPEC = staticSpec('Sheer Force', 'aa089.sheer-force')
export const SHELL_ARMOR_ABILITY_SPEC = staticSpec('Shell Armor', 'aa089.shell-armor')
export const SHELL_CANNON_ABILITY_SPEC = triggeredSpec('Shell Cannon', 'aa089.shell-cannon', 'move')
export const SHELL_SHIELD_ABILITY_SPEC = activatedSpec('Shell Shield', 'aa089.shell-shield')
export const SHIELD_DUST_ABILITY_SPEC = staticSpec('Shield Dust', 'aa089.shield-dust')
export const SHIELDS_DOWN_ABILITY_SPEC = staticSpec('Shields Down', 'aa089.shields-down')
export const SILK_THREADS_ABILITY_SPEC = staticSpec('Silk Threads', 'aa089.silk-threads')
export const SIMPLE_ABILITY_SPEC = staticSpec('Simple', 'aa089.simple')
export const SKILL_LINK_ABILITY_SPEC = triggeredSpec('Skill Link', 'aa089.skill-link', 'move')
export const SLOW_START_ABILITY_SPEC = staticSpec('Slow Start', 'aa089.slow-start')

export const AA089_ABILITY_SPECS = Object.freeze([
  SHADOW_TAG_ABILITY_SPEC, SHED_SKIN_ABILITY_SPEC, SHEER_FORCE_ABILITY_SPEC, SHELL_ARMOR_ABILITY_SPEC, SHELL_CANNON_ABILITY_SPEC, SHELL_SHIELD_ABILITY_SPEC, SHIELD_DUST_ABILITY_SPEC, SHIELDS_DOWN_ABILITY_SPEC, SILK_THREADS_ABILITY_SPEC, SIMPLE_ABILITY_SPEC, SKILL_LINK_ABILITY_SPEC, SLOW_START_ABILITY_SPEC,
])

export const AA089_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = remainingAbilityRegistrations(
  'server/domain/abilityAutomation/specs/aa089.ts',
  AA089_ABILITY_SPECS,
)
