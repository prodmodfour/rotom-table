<script setup lang="ts">
defineProps<{
  title: string
}>()
</script>

<template>
  <div class="detail-heading">
    <h1>{{ title }}</h1>
    <div v-if="$slots.pills" class="detail-pills">
      <slot name="pills" />
    </div>
  </div>
</template>
