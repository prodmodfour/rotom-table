<script setup lang="ts">
defineProps<{
  backTo: string
  backLabel: string
}>()
</script>

<template>
  <div class="ref-detail">
    <header class="ref-header">
      <AppNavigation />
      <div class="back-row">
        <NuxtLink :to="backTo" class="back-link">{{ backLabel }}</NuxtLink>
      </div>
    </header>

    <main>
      <slot />
    </main>
  </div>
</template>
