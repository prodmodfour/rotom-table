<script setup lang="ts">
withDefaults(defineProps<{
  as?: 'div' | 'form'
}>(), {
  as: 'div',
})

const emit = defineEmits<{
  submit: []
}>()
</script>

<template>
  <form v-if="as === 'form'" class="ctx-form" @submit.prevent="emit('submit')">
    <slot />
  </form>
  <div v-else class="ctx-form">
    <slot />
  </div>
</template>

<style scoped>
.ctx-form {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.35rem 0.55rem 0.55rem;
}
</style>
