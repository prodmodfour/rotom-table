import { ABILITY_AUTOMATION_LEGACY_COMPATIBILITY_POLICY } from '#shared/abilityAutomation/legacyCompatibility'

/** Explicit client boundary for pre-AbilitySpec behavior during migration. */
export const CLIENT_LEGACY_ABILITY_AUTOMATION_BOUNDARY = Object.freeze({
  id: 'client-live-play-panel' as const,
  policy: ABILITY_AUTOMATION_LEGACY_COMPATIBILITY_POLICY,
})

export {
  getAbilityAutomation,
  getAbilityAutomationCategory,
  getMapAbilityAutomation,
  getPassiveAbilityAutomation,
  getSheetAbilityAutomation,
  isMapAbilityAutomationName,
  mapAbilityTargetCandidates,
  resolveMapAbilityAutomationTransaction,
} from './abilityAutomation'

export type {
  AbilityAutomationDefinition,
  MapAbilityAutomationDefinition,
  MapAbilityTargetMode,
  PassiveAbilityAutomationDefinition,
  SheetAbilityAutomationDefinition,
} from './abilityAutomation'
