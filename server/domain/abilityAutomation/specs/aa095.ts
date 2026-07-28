import type { AbilitySpecV1Registration } from '../registry'
import {
  remainingAbilityRegistrations,
  remainingActivatedAbilitySpec as activatedSpec,
  remainingStaticAbilitySpec as staticSpec,
  remainingStaticActivatedAbilitySpec as staticActivatedSpec,
  remainingTriggeredAbilitySpec as triggeredSpec,
} from './aa085to100Shared'

export const THICK_FAT_ABILITY_SPEC = staticSpec('Thick Fat', 'aa095.thick-fat')
export const THRUST_ABILITY_SPEC = staticSpec('Thrust', 'aa095.thrust')
export const THUNDER_BOOST_ABILITY_SPEC = triggeredSpec('Thunder Boost', 'aa095.thunder-boost', 'move')
export const TINGLE_ABILITY_SPEC = triggeredSpec('Tingle', 'aa095.tingle', 'move')
export const TINGLY_TONGUE_ABILITY_SPEC = triggeredSpec('Tingly Tongue', 'aa095.tingly-tongue', 'move')
export const TINTED_LENS_ABILITY_SPEC = staticSpec('Tinted Lens', 'aa095.tinted-lens')
export const TOCHUKASO_ABILITY_SPEC = staticSpec('Tochukaso', 'aa095.tochukaso')
export const TOLERANCE_ABILITY_SPEC = staticSpec('Tolerance', 'aa095.tolerance')
export const TONGUELASH_ABILITY_SPEC = triggeredSpec('Tonguelash', 'aa095.tonguelash', 'move')
export const TORRENT_ABILITY_SPEC = staticSpec('Torrent', 'aa095.torrent')
export const TOUGH_CLAWS_ABILITY_SPEC = staticSpec('Tough Claws', 'aa095.tough-claws')
export const TOXIC_BOOST_ABILITY_SPEC = staticActivatedSpec('Toxic Boost', 'aa095.toxic-boost')

export const AA095_ABILITY_SPECS = Object.freeze([
  THICK_FAT_ABILITY_SPEC, THRUST_ABILITY_SPEC, THUNDER_BOOST_ABILITY_SPEC, TINGLE_ABILITY_SPEC, TINGLY_TONGUE_ABILITY_SPEC, TINTED_LENS_ABILITY_SPEC, TOCHUKASO_ABILITY_SPEC, TOLERANCE_ABILITY_SPEC, TONGUELASH_ABILITY_SPEC, TORRENT_ABILITY_SPEC, TOUGH_CLAWS_ABILITY_SPEC, TOXIC_BOOST_ABILITY_SPEC,
])

export const AA095_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = remainingAbilityRegistrations(
  'server/domain/abilityAutomation/specs/aa095.ts',
  AA095_ABILITY_SPECS,
)
