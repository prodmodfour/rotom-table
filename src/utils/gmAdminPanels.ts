import type { RouteLocationNormalizedLoaded } from 'vue-router'

export const HAS_PAGE_SPECIFIC_GM_ADMIN_PANEL_META = 'hasPageSpecificGmAdminPanel'

export const routeHasPageSpecificGmAdminPanel = (
  route: Pick<RouteLocationNormalizedLoaded, 'meta'>,
): boolean => route.meta[HAS_PAGE_SPECIFIC_GM_ADMIN_PANEL_META] === true
