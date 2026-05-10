<script setup lang="ts">
import { computed } from 'vue'
import {
  PRIMARY_APP_NAV_ITEMS,
  REFERENCE_APP_NAV_ITEMS,
  filterAppNavItems,
  isAppNavItemActive,
} from '~/utils/appNavigation'
import { LOGIN_PATH } from '~/utils/loginRedirect'

const route = useRoute()
const router = useRouter()
const { isGm, roleLabel, logout } = useAuth()

const primaryItems = computed(() => filterAppNavItems(PRIMARY_APP_NAV_ITEMS, isGm.value))
const referenceItems = computed(() => filterAppNavItems(REFERENCE_APP_NAV_ITEMS, isGm.value))

const isActive = (path: string) => isAppNavItemActive(route.path, path)

const handleLogout = async () => {
  logout()
  await router.push(LOGIN_PATH)
}
</script>

<template>
  <nav class="app-navigation" aria-label="Primary">
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
    <span class="role-badge">{{ roleLabel }}</span>
    <button type="button" class="nav-link nav-link--button" @click="handleLogout">
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
  padding: 0.42rem 0.7rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.nav-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  flex: 0 0 auto;
  padding: 0.55rem 0.85rem;
  border-radius: 10px;
  border: 1px solid var(--rule-soft);
  background: var(--paper);
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
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.nav-link.active {
  border-color: var(--accent);
  background: var(--paper-active);
  color: var(--accent);
}

.nav-link--button {
  cursor: pointer;
}
</style>
