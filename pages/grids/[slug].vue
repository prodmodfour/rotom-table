<script setup lang="ts">
import { legacyGridDetailRedirectPath } from '~/utils/legacyGridRoutes'

definePageMeta({
  middleware: (to) =>
    navigateTo({ path: legacyGridDetailRedirectPath(to.params.slug), query: to.query }, { replace: true }),
})
</script>

<template>
  <div />
</template>
