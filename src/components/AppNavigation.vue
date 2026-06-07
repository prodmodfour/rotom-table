<script setup lang="ts">
import { PhMoon, PhSun } from '@phosphor-icons/vue'
import { computed, onMounted, watch } from 'vue'
import {
  PRIMARY_APP_NAV_ITEMS,
  REFERENCE_APP_NAV_ITEMS,
  filterAppNavItems,
  isAppNavItemActive,
} from '~/utils/appNavigation'
import { LOGIN_PATH } from '~/utils/appRoutes'
import {
  playerProfileNavStatusText,
  playerProfileSwitchRoute,
} from '~/utils/playerProfileNavigation'

withDefaults(defineProps<{
  orientation?: 'horizontal' | 'vertical'
  showRoleBadge?: boolean
}>(), {
  orientation: 'horizontal',
  showRoleBadge: true,
})

const route = useRoute()
const router = useRouter()
const { isGm, isPlayer, roleLabel, logout } = useAuth()
const {
  appThemeToggleLabel,
  isLightAppTheme,
  toggleAppThemeMode,
} = useAppTheme()
const {
  selectedProfileDisplayName,
  hasSelectedProfile,
  loadRememberedProfile,
  reloadProfiles,
  clearSelectedProfile,
} = usePlayerProfiles()

const primaryItems = computed(() => filterAppNavItems(PRIMARY_APP_NAV_ITEMS, isGm.value, isPlayer.value))
const referenceItems = computed(() => filterAppNavItems(REFERENCE_APP_NAV_ITEMS, isGm.value, isPlayer.value))
const playerProfileStatusText = computed(() => playerProfileNavStatusText(selectedProfileDisplayName.value))
const playerNameRoleBadge = computed(() => selectedProfileDisplayName.value?.trim() ?? '')
const roleBadgeLabel = computed(() => (isPlayer.value && playerNameRoleBadge.value ? playerNameRoleBadge.value : roleLabel.value))
const roleBadgeShowsPlayerName = computed(() => isPlayer.value && playerNameRoleBadge.value.length > 0)
const switchProfileRoute = computed(() => playerProfileSwitchRoute(route.fullPath))

const isActive = (path: string) => isAppNavItemActive(route.path, path)

if (import.meta.client && isPlayer.value) loadRememberedProfile()

const syncPlayerProfileForNavigation = async () => {
  if (!isPlayer.value) return

  loadRememberedProfile()
  try {
    await reloadProfiles({ silent: true, clearMissingSelection: true })
  } catch {
    // Keep navigation usable if profiles cannot be refreshed; the login picker shows detailed errors.
  }
}

const handleClearProfile = async () => {
  clearSelectedProfile()
  await router.push(switchProfileRoute.value)
}

const handleLogout = async () => {
  logout()
  await router.push(LOGIN_PATH)
}

onMounted(() => {
  void syncPlayerProfileForNavigation()
})

watch(isPlayer, (nextIsPlayer) => {
  if (nextIsPlayer) void syncPlayerProfileForNavigation()
})
</script>

<template>
  <nav
    class="app-navigation"
    :class="`app-navigation--${orientation}`"
    aria-label="Primary"
  >
    <NuxtLink
      v-for="item in primaryItems"
      :key="item.path"
      :class="['nav-link', { active: isActive(item.path) }]"
      :to="item.path"
    >
      {{ item.label }}
    </NuxtLink>
    <span class="nav-divider" aria-hidden="true" />
    <NuxtLink
      v-for="item in referenceItems"
      :key="item.path"
      :class="['nav-link', { active: isActive(item.path) }]"
      :to="item.path"
    >
      {{ item.label }}
    </NuxtLink>
    <span class="nav-spacer" aria-hidden="true" />
    <div
      v-if="isPlayer"
      class="profile-status"
      aria-live="polite"
    >
      <span class="profile-status__text">{{ playerProfileStatusText }}</span>
      <span class="profile-status__actions" role="group" aria-label="Player profile actions">
        <NuxtLink class="profile-action" :to="switchProfileRoute">
          {{ hasSelectedProfile ? 'Switch profile' : 'Choose profile' }}
        </NuxtLink>
        <button
          v-if="hasSelectedProfile"
          type="button"
          class="profile-action profile-action--button"
          @click="handleClearProfile"
        >
          Clear profile
        </button>
      </span>
    </div>
    <button
      type="button"
      class="nav-link nav-link--button nav-link--theme"
      :aria-label="appThemeToggleLabel"
      :aria-pressed="isLightAppTheme"
      :title="appThemeToggleLabel"
      @click="toggleAppThemeMode"
    >
      <PhSun v-if="isLightAppTheme" :size="18" weight="bold" aria-hidden="true" />
      <PhMoon v-else :size="18" weight="bold" aria-hidden="true" />
    </button>
    <span
      v-if="showRoleBadge"
      :class="['role-badge', { 'role-badge--profile': roleBadgeShowsPlayerName }]"
    >{{ roleBadgeLabel }}</span>
    <button type="button" class="nav-link nav-link--button nav-link--logout" @click="handleLogout">
      Logout
    </button>
  </nav>
</template>

<style scoped>
.app-navigation {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.5rem;
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
}

.nav-divider {
  width: 1px;
  height: 1.4rem;
  background: var(--rule-soft);
  display: inline-block;
}

.nav-spacer {
  flex: 1 1 auto;
  min-width: 0.5rem;
}

.role-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  max-width: min(100%, 16rem);
  overflow: hidden;
  padding: 0.42rem 0.7rem;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--accent);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.role-badge--profile {
  letter-spacing: 0.02em;
  text-transform: none;
}

.profile-status {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  max-width: min(100%, 34rem);
  padding: 0.35rem 0.45rem 0.35rem 0.65rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-inset);
  color: var(--ink-soft);
  font-size: 0.82rem;
}

.profile-status__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink-bright);
  font-weight: 700;
}

.profile-status__actions {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  flex: 0 0 auto;
}

.profile-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 1.75rem;
  padding: 0.25rem 0.5rem;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-decoration: none;
  text-transform: uppercase;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease;
}

.profile-action:hover,
.profile-action:focus-visible {
  border-color: transparent;
  background: transparent;
  color: var(--accent);
  outline: none;
}

.profile-action--button {
  appearance: none;
}

.nav-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  flex: 0 0 auto;
  padding: 0.55rem 0.85rem;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--ink);
  text-decoration: none;
  font-weight: 600;
  font-size: 0.88rem;
  letter-spacing: 0.04em;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease;
}

.nav-link:hover {
  border-color: transparent;
  background: transparent;
  color: var(--accent);
}

.nav-link.active {
  border-color: transparent;
  background: transparent;
  color: var(--accent);
}

.nav-link--button {
  cursor: pointer;
}

.nav-link--logout {
  border-color: transparent;
  background: transparent;
  color: var(--ink-bright);
}

.nav-link--logout:hover,
.nav-link--logout:focus-visible {
  border-color: transparent;
  background: transparent;
  color: var(--accent);
}

.nav-link--theme {
  width: 2.4rem;
  height: 2.4rem;
  min-width: 2.4rem;
  flex-basis: 2.4rem;
  padding: 0;
  border-color: transparent;
  background: transparent;
  color: var(--accent);
  letter-spacing: 0;
  outline: none;
}

.nav-link--theme :deep(svg) {
  flex: 0 0 auto;
}

.nav-link--theme:hover,
.nav-link--theme:focus-visible {
  border-color: transparent;
  background: transparent;
  outline: none;
}

.app-navigation--vertical {
  flex-direction: column;
  flex-wrap: nowrap;
  align-items: stretch;
  gap: 0.45rem;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  padding: 0;
}

.app-navigation--vertical .nav-divider {
  width: 100%;
  height: 1px;
  margin: 0.15rem 0;
}

.app-navigation--vertical .nav-spacer {
  display: none;
}

.app-navigation--vertical .nav-link,
.app-navigation--vertical .role-badge,
.app-navigation--vertical .profile-status {
  width: 100%;
  min-height: 2.35rem;
  padding: 0.5rem 0.45rem;
}

.app-navigation--vertical .profile-status {
  align-items: stretch;
  border-radius: 12px;
  flex-direction: column;
  gap: 0.4rem;
}

.app-navigation--vertical .profile-status__actions {
  display: grid;
  grid-template-columns: 1fr;
}

.app-navigation--vertical .profile-action {
  width: 100%;
}

.app-navigation--vertical .nav-link {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-navigation--vertical .nav-link--theme {
  width: 2.4rem;
  min-height: 2.4rem;
  align-self: center;
  padding: 0;
}
</style>
