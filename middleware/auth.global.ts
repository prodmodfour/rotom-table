import { DEFAULT_LOGIN_REDIRECT, LOGIN_PATH, isPlayerBlockedRedirectPath } from '~/utils/loginRedirect'

export default defineNuxtRouteMiddleware((to) => {
  if (to.path === LOGIN_PATH) return

  const { role, isPlayer } = useAuth()

  if (!role.value) {
    return navigateTo({
      path: LOGIN_PATH,
      query: { redirect: to.fullPath && to.fullPath !== '/' ? to.fullPath : DEFAULT_LOGIN_REDIRECT },
    })
  }

  if (isPlayer.value && isPlayerBlockedRedirectPath(to.path)) {
    return navigateTo(DEFAULT_LOGIN_REDIRECT)
  }
})
