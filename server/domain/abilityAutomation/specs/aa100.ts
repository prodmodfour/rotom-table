import type { AbilitySpecV1Registration } from '../registry'
import {
  remainingAbilityRegistrations,
  remainingActivatedAbilitySpec as activatedSpec,
  remainingStaticAbilitySpec as staticSpec,
  remainingTriggeredAbilitySpec as triggeredSpec,
} from './aa085to100Shared'

export const WONDER_SKIN_ABILITY_SPEC = staticSpec('Wonder Skin', 'aa100.wonder-skin')
export const ZEN_MODE_ABILITY_SPEC = activatedSpec('Zen Mode', 'aa100.zen-mode')
export const ZEN_SNOWED_ABILITY_SPEC = activatedSpec('Zen Snowed', 'aa100.zen-snowed')

export const AA100_ABILITY_SPECS = Object.freeze([
  WONDER_SKIN_ABILITY_SPEC, ZEN_MODE_ABILITY_SPEC, ZEN_SNOWED_ABILITY_SPEC,
])

export const AA100_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = remainingAbilityRegistrations(
  'server/domain/abilityAutomation/specs/aa100.ts',
  AA100_ABILITY_SPECS,
)
