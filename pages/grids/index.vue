<script setup lang="ts">
import { legacyGridIndexRedirectPath } from '~/utils/legacyGridRoutes'

definePageMeta({
  middleware: (to) => navigateTo({ path: legacyGridIndexRedirectPath(), query: to.query }, { replace: true }),
})
</script>

<template>
  <div />
</template>
