<script setup lang="ts">
definePageMeta({
  middleware: (to) => navigateTo({ path: '/maps', query: to.query }, { replace: true }),
})
</script>

<template>
  <div />
</template>
