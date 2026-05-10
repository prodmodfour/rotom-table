<script setup lang="ts">
import { mapLibraryPath } from '~/utils/mapRoutes'

// Tabletop landing now lives at /maps — the file browser for saved maps.
definePageMeta({
  middleware: () => navigateTo(mapLibraryPath(), { replace: true }),
})
</script>

<template>
  <div />
</template>
