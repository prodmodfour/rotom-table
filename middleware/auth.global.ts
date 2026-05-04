const playerBlockedRoutes = ['/generate', '/encounter-tables']

const isPlayerBlockedPath = (path: string) =>
  playerBlockedRoutes.some((route) => path === route || path.startsWith(`${route}/`))

export default defineNuxtRouteMiddleware((to) => {
  if (to.path === '/login') return

  const { role, isPlayer } = useAuth()

  if (!role.value) {
    return navigateTo({
      path: '/login',
      query: { redirect: to.fullPath && to.fullPath !== '/' ? to.fullPath : '/maps' },
    })
  }

  if (isPlayer.value && isPlayerBlockedPath(to.path)) {
    return navigateTo('/maps')
  }
})
