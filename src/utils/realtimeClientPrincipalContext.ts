import { computed, readonly, ref } from 'vue'
import { isAuthRole, type AuthRole } from '#shared/auth'
import { parsePlayerProfileId, type PlayerProfileId } from '#shared/playerProfiles'

export interface RealtimeClientPrincipalContext {
  readonly role: AuthRole
  readonly profileId: PlayerProfileId | null
}

export type RealtimeClientPrincipalContextKey = 'gm' | 'player:none' | `player:${string}`

const realtimeAuthRole = ref<AuthRole | null>(null)
const realtimeSelectedPlayerProfileId = ref<PlayerProfileId | null>(null)

export const buildRealtimeClientPrincipalContextKey = (
  context: RealtimeClientPrincipalContext,
): RealtimeClientPrincipalContextKey => {
  if (context.role === 'gm') return 'gm'
  return context.profileId === null ? 'player:none' : `player:${context.profileId}`
}

export const realtimeClientPrincipalContext = computed<RealtimeClientPrincipalContext | null>(() => {
  const role = realtimeAuthRole.value
  if (role === 'gm') return { role, profileId: null }
  if (role === 'player') return { role, profileId: realtimeSelectedPlayerProfileId.value }
  return null
})

export const realtimeClientPrincipalContextKey = computed<RealtimeClientPrincipalContextKey | null>(() => {
  const context = realtimeClientPrincipalContext.value
  return context === null ? null : buildRealtimeClientPrincipalContextKey(context)
})

export const setRealtimeClientAuthRole = (role: AuthRole | null | undefined): void => {
  realtimeAuthRole.value = isAuthRole(role) ? role : null
}

export const publishRealtimeSelectedPlayerProfileId = (
  profileId: PlayerProfileId | null | undefined,
): void => {
  realtimeSelectedPlayerProfileId.value = profileId == null
    ? null
    : parsePlayerProfileId(profileId, 'realtime selected player profile id')
}

export const useRealtimeClientPrincipalContext = () => ({
  role: readonly(realtimeAuthRole),
  selectedPlayerProfileId: readonly(realtimeSelectedPlayerProfileId),
  context: readonly(realtimeClientPrincipalContext),
  contextKey: readonly(realtimeClientPrincipalContextKey),
})

export const resetRealtimeClientPrincipalContextForTests = (): void => {
  realtimeAuthRole.value = null
  realtimeSelectedPlayerProfileId.value = null
}
