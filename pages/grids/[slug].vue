<script setup lang="ts">
definePageMeta({
  middleware: (to) =>
    navigateTo({ path: `/maps/${String(to.params.slug ?? '')}`, query: to.query }, { replace: true }),
})
</script>

<template>
  <div />
</template>
