<script setup lang="ts">
import AppNavigation from '~/components/AppNavigation.vue'
import SettingsPanel from '~/components/settings/SettingsPanel.client.vue'

useHead({ title: 'Settings · Rotom Table' })
</script>

<template>
  <main class="settings-page">
    <AppNavigation />
    <SettingsPanel />
  </main>
</template>

<style scoped>
.settings-page {
  min-height: 100vh;
  display: grid;
  align-content: start;
  gap: 1rem;
  padding: 1rem;
  background:
    radial-gradient(circle at top left, rgba(255, 31, 45, 0.12), transparent 32rem),
    var(--paper);
}
</style>
