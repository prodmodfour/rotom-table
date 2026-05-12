<script setup lang="ts">
defineProps<{
  title: string
  count: number
  total: number
}>()
</script>

<template>
  <header class="ref-header">
    <AppNavigation />
    <section class="panel-card">
      <div class="ref-heading">
        <h1>{{ title }}</h1>
        <span class="badge">{{ count }} of {{ total }}</span>
      </div>
      <slot />
    </section>
  </header>
</template>
