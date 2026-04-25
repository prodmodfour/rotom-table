<script setup lang="ts">
const route = useRoute()

const isActive = (path: string) => {
  if (path === '/') {
    return route.path === '/'
  }

  return route.path.startsWith(path)
}
</script>

<template>
  <nav class="app-navigation" aria-label="Primary">
    <NuxtLink :class="['nav-link', { active: isActive('/') }]" to="/">
      Tabletop
    </NuxtLink>
    <NuxtLink :class="['nav-link', { active: isActive('/pokedex') }]" to="/pokedex">
      Pokédex
    </NuxtLink>
    <NuxtLink :class="['nav-link', { active: isActive('/sheets') }]" to="/sheets">
      Sheets
    </NuxtLink>
    <span class="nav-divider" aria-hidden="true" />
    <NuxtLink :class="['nav-link', { active: isActive('/moves') }]" to="/moves">
      Moves
    </NuxtLink>
    <NuxtLink :class="['nav-link', { active: isActive('/abilities') }]" to="/abilities">
      Abilities
    </NuxtLink>
    <NuxtLink :class="['nav-link', { active: isActive('/capabilities') }]" to="/capabilities">
      Capabilities
    </NuxtLink>
  </nav>
</template>

<style scoped>
.app-navigation {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.6rem;
  padding: 0.7rem 0.85rem;
  border: 1px solid rgba(96, 165, 250, 0.22);
  border-radius: 18px;
  background: rgba(8, 20, 43, 0.82);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.22);
}

.nav-divider {
  width: 1px;
  height: 1.6rem;
  background: rgba(96, 165, 250, 0.22);
  display: inline-block;
}

.nav-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  flex: 0 0 auto;
  padding: 0.72rem 0.9rem;
  border-radius: 12px;
  border: 1px solid rgba(96, 165, 250, 0.22);
  background: rgba(15, 23, 42, 0.8);
  color: #dbeafe;
  text-decoration: none;
  font-weight: 700;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.15s ease;
}

.nav-link:hover {
  border-color: rgba(125, 211, 252, 0.7);
  background: rgba(16, 33, 63, 0.92);
  transform: translateY(-1px);
}

.nav-link.active {
  border-color: rgba(125, 211, 252, 0.82);
  background: rgba(11, 47, 92, 0.85);
  color: #eff6ff;
}
</style>
