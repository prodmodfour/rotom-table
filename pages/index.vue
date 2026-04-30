<script setup lang="ts">
// Tabletop landing now lives at /maps — the file browser for saved maps.
definePageMeta({
  middleware: () => navigateTo('/maps', { replace: true }),
})
</script>

<template>
  <div />
</template>
