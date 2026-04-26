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
    <NuxtLink :class="['nav-link', { active: isActive('/generate') }]" to="/generate">
      Generate
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
    <NuxtLink :class="['nav-link', { active: isActive('/features') }]" to="/features">
      Features
    </NuxtLink>
    <NuxtLink :class="['nav-link', { active: isActive('/edges') }]" to="/edges">
      Edges
    </NuxtLink>
    <NuxtLink :class="['nav-link', { active: isActive('/encounter-tables') }]" to="/encounter-tables">
      Encounter Tables
    </NuxtLink>
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
</style>
