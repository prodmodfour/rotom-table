import { ABILITY_AUTOMATION_LEGACY_COMPATIBILITY_POLICY } from '#shared/abilityAutomation/legacyCompatibility'
import {
  getMapAbilityAutomation,
  resolveMapAbilityAutomationTransaction,
} from '~/utils/abilityAutomation'

/** Explicit server boundary for authoritative table actions not yet migrated to AbilitySpec. */
export const SERVER_LEGACY_ABILITY_AUTOMATION_BOUNDARY = Object.freeze({
  id: 'server-live-play-table-action' as const,
  policy: ABILITY_AUTOMATION_LEGACY_COMPATIBILITY_POLICY,
})

export const getLegacyMapAbilityAutomation: typeof getMapAbilityAutomation = (...args) => (
  getMapAbilityAutomation(...args)
)

export const resolveLegacyMapAbilityAutomationTransaction:
  typeof resolveMapAbilityAutomationTransaction = (...args) => (
    resolveMapAbilityAutomationTransaction(...args)
  )
