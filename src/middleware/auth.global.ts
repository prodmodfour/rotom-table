import { playerProfileSelectionStorage } from '~/utils/playerProfileSelectionStorage'
import {
  resolveProfileAwareRouteGuard,
} from '~/utils/playerProfileRouteGuards'

export default defineNuxtRouteMiddleware((to) => {
  const { role, isPlayer } = useAuth()
  const hasSelectedPlayerProfile = import.meta.client && isPlayer.value
    ? playerProfileSelectionStorage.load() !== null
    : null

  const decision = resolveProfileAwareRouteGuard({
    path: to.path,
    fullPath: to.fullPath,
    hasRole: role.value !== null,
    isPlayer: isPlayer.value,
    hasSelectedPlayerProfile,
  })

  if (decision.type === 'login') return navigateTo(decision.location)
  if (decision.type === 'redirect') return navigateTo(decision.location)
})
