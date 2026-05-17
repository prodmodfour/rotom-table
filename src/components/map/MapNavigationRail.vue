<script setup lang="ts">
import AppNavigation from '~/components/AppNavigation.vue'
</script>

<template>
  <aside class="map-navigation-rail" aria-label="Map navigation">
    <AppNavigation orientation="vertical" :show-role-badge="false" />
  </aside>
</template>

<style scoped>
.map-navigation-rail {
  width: 100%;
  height: 100%;
  min-width: 0;
  padding: 0.55rem;
  border: 1px solid var(--rule);
  border-radius: 18px;
  background: var(--map-glass-surface, var(--paper));
  box-shadow:
    0 24px 70px rgba(0, 0, 0, 0.30),
    inset 0 1px 0 rgba(255, 255, 255, 0.10);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  overflow: auto;
  overscroll-behavior: contain;
  pointer-events: auto;
}
</style>
