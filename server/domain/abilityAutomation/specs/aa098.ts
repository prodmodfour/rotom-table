import type { AbilitySpecV1Registration } from '../registry'
import {
  remainingAbilityRegistrations,
  remainingActivatedAbilitySpec as activatedSpec,
  remainingStaticAbilitySpec as staticSpec,
  remainingTriggeredAbilitySpec as triggeredSpec,
} from './aa085to100Shared'

export const VOODOO_DOLL_ABILITY_SPEC = triggeredSpec('Voodoo Doll', 'aa098.voodoo-doll', 'move')
export const WALLMASTER_ABILITY_SPEC = staticSpec('Wallmaster', 'aa098.wallmaster')
export const WANDERING_SPIRIT_ABILITY_SPEC = triggeredSpec('Wandering Spirit', 'aa098.wandering-spirit', 'move')
export const WASH_AWAY_ABILITY_SPEC = triggeredSpec('Wash Away', 'aa098.wash-away', 'move')
export const WATER_ABSORB_ABILITY_SPEC = staticSpec('Water Absorb', 'aa098.water-absorb')
export const WATER_BUBBLE_ABILITY_SPEC = staticSpec('Water Bubble', 'aa098.water-bubble')
export const WATER_COMPACTION_ABILITY_SPEC = triggeredSpec('Water Compaction', 'aa098.water-compaction', 'move')
export const WATER_VEIL_ABILITY_SPEC = staticSpec('Water Veil', 'aa098.water-veil')
export const WAVE_RIDER_ABILITY_SPEC = staticSpec('Wave Rider', 'aa098.wave-rider')
export const WEAK_ARMOR_ABILITY_SPEC = triggeredSpec('Weak Armor', 'aa098.weak-armor', 'move')
export const WEAPONIZE_ABILITY_SPEC = staticSpec('Weaponize', 'aa098.weaponize')
export const WEEBLE_ABILITY_SPEC = triggeredSpec('Weeble', 'aa098.weeble', 'move')

export const AA098_ABILITY_SPECS = Object.freeze([
  VOODOO_DOLL_ABILITY_SPEC, WALLMASTER_ABILITY_SPEC, WANDERING_SPIRIT_ABILITY_SPEC, WASH_AWAY_ABILITY_SPEC, WATER_ABSORB_ABILITY_SPEC, WATER_BUBBLE_ABILITY_SPEC, WATER_COMPACTION_ABILITY_SPEC, WATER_VEIL_ABILITY_SPEC, WAVE_RIDER_ABILITY_SPEC, WEAK_ARMOR_ABILITY_SPEC, WEAPONIZE_ABILITY_SPEC, WEEBLE_ABILITY_SPEC,
])

export const AA098_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = remainingAbilityRegistrations(
  'server/domain/abilityAutomation/specs/aa098.ts',
  AA098_ABILITY_SPECS,
)
