<script setup lang="ts">
defineProps<{
  title: string
}>()
</script>

<template>
  <section class="field-block">
    <h3>{{ title }}</h3>
    <slot />
  </section>
</template>
