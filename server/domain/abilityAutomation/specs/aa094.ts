import type { AbilitySpecV1Registration } from '../registry'
import {
  remainingAbilityRegistrations,
  remainingActivatedAbilitySpec as activatedSpec,
  remainingStaticAbilitySpec as staticSpec,
  remainingTriggeredAbilitySpec as triggeredSpec,
} from './aa085to100Shared'

export const SWEET_VEIL_ABILITY_SPEC = staticSpec('Sweet Veil', 'aa094.sweet-veil')
export const SWIFT_SWIM_ABILITY_SPEC = staticSpec('Swift Swim', 'aa094.swift-swim')
export const SYMBIOSIS_ABILITY_SPEC = activatedSpec('Symbiosis', 'aa094.symbiosis', [
  { kind: 'token', relationship: 'ally', maximumRange: 10, willingness: 'willing' },
  { kind: 'item' }
])
export const SYNCHRONIZE_ABILITY_SPEC = triggeredSpec('Synchronize', 'aa094.synchronize', 'condition')
export const TANGLED_FEET_ABILITY_SPEC = staticSpec('Tangled Feet', 'aa094.tangled-feet')
export const TANGLING_HAIR_ABILITY_SPEC = triggeredSpec('Tangling Hair', 'aa094.tangling-hair', 'move')
export const TARGETING_SYSTEM_ABILITY_SPEC = activatedSpec('Targeting System', 'aa094.targeting-system', [
  { kind: 'token', relationship: 'any', maximumRange: 10 }
])
export const TEAMWORK_ABILITY_SPEC = staticSpec('Teamwork', 'aa094.teamwork')
export const TECHNICIAN_ABILITY_SPEC = staticSpec('Technician', 'aa094.technician')
export const TELEPATHY_ABILITY_SPEC = staticSpec('Telepathy', 'aa094.telepathy')
export const TERAVOLT_ABILITY_SPEC = staticSpec('Teravolt', 'aa094.teravolt')
export const THERMOSENSITIVE_ABILITY_SPEC = staticSpec('Thermosensitive', 'aa094.thermosensitive')

export const AA094_ABILITY_SPECS = Object.freeze([
  SWEET_VEIL_ABILITY_SPEC, SWIFT_SWIM_ABILITY_SPEC, SYMBIOSIS_ABILITY_SPEC, SYNCHRONIZE_ABILITY_SPEC, TANGLED_FEET_ABILITY_SPEC, TANGLING_HAIR_ABILITY_SPEC, TARGETING_SYSTEM_ABILITY_SPEC, TEAMWORK_ABILITY_SPEC, TECHNICIAN_ABILITY_SPEC, TELEPATHY_ABILITY_SPEC, TERAVOLT_ABILITY_SPEC, THERMOSENSITIVE_ABILITY_SPEC,
])

export const AA094_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = remainingAbilityRegistrations(
  'server/domain/abilityAutomation/specs/aa094.ts',
  AA094_ABILITY_SPECS,
)
