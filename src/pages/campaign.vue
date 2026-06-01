<script setup lang="ts">
import AppNavigation from '~/components/AppNavigation.vue'

useHead({ title: 'Campaign · Rotom Table' })
</script>

<template>
  <main class="campaign-page">
    <AppNavigation />
  </main>
</template>

<style scoped>
.campaign-page {
  min-height: 100vh;
  display: grid;
  align-content: start;
  gap: 1rem;
  padding: 1rem;
  background: var(--paper);
  color: var(--ink);
}
</style>
