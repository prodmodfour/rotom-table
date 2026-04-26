<script setup lang="ts">
// Tabletop landing now lives at /grids — the file browser for saved
// grids. Redirect any deep links to the old in-memory page there.
definePageMeta({
  middleware: () => navigateTo('/grids', { replace: true }),
})
</script>

<template>
  <div />
</template>
