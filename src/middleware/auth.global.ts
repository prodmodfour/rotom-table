import { HOME_PATH, LOGIN_PATH } from '~/utils/appRoutes'
import { DEFAULT_LOGIN_REDIRECT, isPlayerBlockedRedirectPath } from '~/utils/loginRedirect'

export default defineNuxtRouteMiddleware((to) => {
  if (to.path === LOGIN_PATH) return

  const { role, isPlayer } = useAuth()

  if (!role.value) {
    return navigateTo({
      path: LOGIN_PATH,
      query: { redirect: to.fullPath && to.fullPath !== HOME_PATH ? to.fullPath : DEFAULT_LOGIN_REDIRECT },
    })
  }

  if (isPlayer.value && isPlayerBlockedRedirectPath(to.path)) {
    return navigateTo(DEFAULT_LOGIN_REDIRECT)
  }
})
