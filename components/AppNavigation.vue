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
  </nav>
</template>

<style scoped>
.app-navigation {
  display: flex;
  gap: 0.75rem;
  padding: 0.85rem;
  border: 1px solid rgba(96, 165, 250, 0.22);
  border-radius: 18px;
  background: rgba(8, 20, 43, 0.82);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.22);
}

.nav-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  flex: 1;
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
