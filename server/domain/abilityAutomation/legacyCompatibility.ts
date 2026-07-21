import { ABILITY_AUTOMATION_LEGACY_COMPATIBILITY_POLICY } from '#shared/abilityAutomation/legacyCompatibility'
import {
  getAbilityAutomation,
  getMapAbilityAutomation,
  resolveMapAbilityAutomationTransaction,
  type AbilityAutomationDefinition,
} from '~/utils/abilityAutomation'
import {
  buildTokenAbilityMenuOptions,
  type TokenAbilityMenuOption,
  type TokenSheetAbility,
} from '~/utils/mapTokenAbilities'

/** Explicit server boundary for authoritative table actions not yet migrated to AbilitySpec. */
export const SERVER_LEGACY_ABILITY_AUTOMATION_BOUNDARY = Object.freeze({
  id: 'server-live-play-table-action' as const,
  policy: ABILITY_AUTOMATION_LEGACY_COMPATIBILITY_POLICY,
})

export type LegacyTokenAbilityMenuOption = TokenAbilityMenuOption & {
  readonly automation: AbilityAutomationDefinition | null
}

export const buildLegacyTokenAbilityMenuOptions = (
  entries: readonly TokenSheetAbility[],
): readonly LegacyTokenAbilityMenuOption[] => buildTokenAbilityMenuOptions(entries).map((option, index) => ({
  ...option,
  automation: getAbilityAutomation(entries[index]!),
}))

export const getLegacyMapAbilityAutomation: typeof getMapAbilityAutomation = (...args) => (
  getMapAbilityAutomation(...args)
)

export const resolveLegacyMapAbilityAutomationTransaction:
  typeof resolveMapAbilityAutomationTransaction = (...args) => (
    resolveMapAbilityAutomationTransaction(...args)
  )
