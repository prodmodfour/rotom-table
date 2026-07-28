import type { Ref } from 'vue'
import type { PlayerProfileId } from '#shared/playerProfiles'
import type { AbilityDeclarationIntent } from '#shared/abilityAutomation/declarationIntent'
import type { BeginAbilityClientDeclarationCommand } from '#shared/abilityAutomation/clientCommands'
import { useApiClient } from '~/composables/useApiClient'
import { MAP_API_PATHS } from '~/utils/apiRoutes'

export interface UseAbilityAutomationGatewayOptions {
  readonly playerProfileId: Readonly<Ref<PlayerProfileId | null>>
  readonly player: Readonly<Ref<boolean>>
  readonly reconcileAfterAccepted?: () => Promise<unknown> | unknown
  readonly presentAccepted?: (presentation: unknown) => void
}

/** Thin transport only; mechanics, options, authorization, rolls, and writes stay server-owned. */
export const useAbilityAutomationGateway = (options: UseAbilityAutomationGatewayOptions) => {
  const { postJson } = useApiClient()
  const profile = (): { profileId?: PlayerProfileId } => options.player.value && options.playerProfileId.value
    ? { profileId: options.playerProfileId.value }
    : {}
  const beginDeclaration = (command: BeginAbilityClientDeclarationCommand): Promise<unknown> => postJson(
    MAP_API_PATHS.beginAbilityDeclaration,
    { command, ...profile() },
  )
  const resolveDeclaration = async (intent: AbilityDeclarationIntent): Promise<unknown> => {
    const result = await postJson(MAP_API_PATHS.resolveAbilityDeclaration, { intent, ...profile() })
    if (
      typeof result === 'object'
      && result !== null
      && 'encounterPresentation' in result
    ) {
      options.presentAccepted?.((result as { encounterPresentation?: unknown }).encounterPresentation)
    }
    await options.reconcileAfterAccepted?.()
    return result
  }
  return Object.freeze({ beginDeclaration, resolveDeclaration })
}
