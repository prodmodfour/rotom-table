import type { AbilitySpecV1Registration } from '../registry'
import {
  remainingAbilityRegistrations,
  remainingActivatedAbilitySpec as activatedSpec,
  remainingStaticAbilitySpec as staticSpec,
  remainingTriggeredAbilitySpec as triggeredSpec,
} from './aa085to100Shared'

export const TOXIC_NOURISHMENT_ABILITY_SPEC = activatedSpec('Toxic Nourishment', 'aa096.toxic-nourishment', [
  { kind: 'token', relationship: 'other', maximumRange: 5 }
])
export const TRACE_ABILITY_SPEC = activatedSpec('Trace', 'aa096.trace', [
  { kind: 'token', relationship: 'other', maximumRange: 10 },
  { kind: 'ability' }
])
export const TRANSISTOR_ABILITY_SPEC = triggeredSpec('Transistor', 'aa096.transistor', 'move')
export const TRANSPORTER_ABILITY_SPEC = triggeredSpec('Transporter', 'aa096.transporter', 'action')
export const TRIAGE_ABILITY_SPEC = staticSpec('Triage', 'aa096.triage')
export const TRINITY_ABILITY_SPEC = staticSpec('Trinity', 'aa096.trinity')
export const TRUANT_ABILITY_SPEC = staticSpec('Truant', 'aa096.truant')
export const TURBOBLAZE_ABILITY_SPEC = staticSpec('Turboblaze', 'aa096.turboblaze')
export const TWISTED_POWER_ABILITY_SPEC = staticSpec('Twisted Power', 'aa096.twisted-power')
export const TYPE_AURA_ABILITY_SPEC = staticSpec('Type Aura', 'aa096.type-aura')
export const TYPE_STRATEGIST_ABILITY_SPEC = staticSpec('Type Strategist', 'aa096.type-strategist')
export const UGLY_ABILITY_SPEC = staticSpec('Ugly', 'aa096.ugly')

export const AA096_ABILITY_SPECS = Object.freeze([
  TOXIC_NOURISHMENT_ABILITY_SPEC, TRACE_ABILITY_SPEC, TRANSISTOR_ABILITY_SPEC, TRANSPORTER_ABILITY_SPEC, TRIAGE_ABILITY_SPEC, TRINITY_ABILITY_SPEC, TRUANT_ABILITY_SPEC, TURBOBLAZE_ABILITY_SPEC, TWISTED_POWER_ABILITY_SPEC, TYPE_AURA_ABILITY_SPEC, TYPE_STRATEGIST_ABILITY_SPEC, UGLY_ABILITY_SPEC,
])

export const AA096_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = remainingAbilityRegistrations(
  'server/domain/abilityAutomation/specs/aa096.ts',
  AA096_ABILITY_SPECS,
)
