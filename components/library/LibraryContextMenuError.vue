<script setup lang="ts">
defineProps<{
  message?: string | null
}>()
</script>

<template>
  <p v-if="message" class="ctx-error" role="alert">{{ message }}</p>
</template>

<style scoped>
.ctx-error {
  margin: 0;
  color: #d36464;
  font-size: 0.82rem;
}
</style>
