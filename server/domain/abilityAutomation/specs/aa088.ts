import type { AbilitySpecV1Registration } from '../registry'
import {
  remainingAbilityRegistrations,
  remainingActivatedAbilitySpec as activatedSpec,
  remainingStaticAbilitySpec as staticSpec,
  remainingStaticActivatedAbilitySpec as staticActivatedSpec,
  remainingTriggeredAbilitySpec as triggeredSpec,
} from './aa085to100Shared'

export const SAND_STREAM_ABILITY_SPEC = activatedSpec('Sand Stream', 'aa088.sand-stream')
export const SAND_VEIL_ABILITY_SPEC = staticSpec('Sand Veil', 'aa088.sand-veil')
export const SAP_SIPPER_ABILITY_SPEC = triggeredSpec('Sap Sipper', 'aa088.sap-sipper', 'move')
export const SCHOOLING_ABILITY_SPEC = activatedSpec('Schooling', 'aa088.schooling')
export const SCRAPPY_ABILITY_SPEC = staticSpec('Scrappy', 'aa088.scrappy')
export const SCREEN_CLEANER_ABILITY_SPEC = staticActivatedSpec('Screen Cleaner', 'aa088.screen-cleaner')
export const SEASONAL_ABILITY_SPEC = staticSpec('Seasonal', 'aa088.seasonal')
export const SEQUENCE_ABILITY_SPEC = triggeredSpec('Sequence', 'aa088.sequence', 'move')
export const SERENE_GRACE_ABILITY_SPEC = staticSpec('Serene Grace', 'aa088.serene-grace')
export const SERPENTS_MARK_ABILITY_SPEC = staticSpec('Serpent’s Mark', 'aa088.serpents-mark')
export const SHACKLE_ABILITY_SPEC = activatedSpec('Shackle', 'aa088.shackle')
export const SHADOW_SHIELD_ABILITY_SPEC = staticSpec('Shadow Shield', 'aa088.shadow-shield')

export const AA088_ABILITY_SPECS = Object.freeze([
  SAND_STREAM_ABILITY_SPEC, SAND_VEIL_ABILITY_SPEC, SAP_SIPPER_ABILITY_SPEC, SCHOOLING_ABILITY_SPEC, SCRAPPY_ABILITY_SPEC, SCREEN_CLEANER_ABILITY_SPEC, SEASONAL_ABILITY_SPEC, SEQUENCE_ABILITY_SPEC, SERENE_GRACE_ABILITY_SPEC, SERPENTS_MARK_ABILITY_SPEC, SHACKLE_ABILITY_SPEC, SHADOW_SHIELD_ABILITY_SPEC,
])

export const AA088_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = remainingAbilityRegistrations(
  'server/domain/abilityAutomation/specs/aa088.ts',
  AA088_ABILITY_SPECS,
)
