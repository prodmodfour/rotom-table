<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  title: string
  slug: unknown
  backTo: string
  backLabel: string
}>()

const displaySlug = computed(() => String(props.slug ?? ''))
</script>

<template>
  <article class="panel-card">
    <h1>{{ title }}</h1>
    <p>No entry for slug <code>{{ displaySlug }}</code>.</p>
    <NuxtLink :to="backTo" class="back-link">{{ backLabel }}</NuxtLink>
  </article>
</template>
