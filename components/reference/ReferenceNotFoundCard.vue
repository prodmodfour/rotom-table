<script setup lang="ts">
defineProps<{
  title: string
  slug: string
  backTo: string
  backLabel: string
}>()
</script>

<template>
  <article class="panel-card">
    <h1>{{ title }}</h1>
    <p>No entry for slug <code>{{ slug }}</code>.</p>
    <NuxtLink :to="backTo" class="back-link">{{ backLabel }}</NuxtLink>
  </article>
</template>
