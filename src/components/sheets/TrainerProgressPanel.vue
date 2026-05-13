<script setup lang="ts">
import type { TrainerSheet } from '~/types/trainerSheet'

defineProps<{
  sheet: TrainerSheet
}>()

const emit = defineEmits<{
  addClass: []
  removeClass: [index: number]
}>()
</script>

<template>
  <TrainerClassesPanel
    :classes="sheet.classes"
    @add-class="emit('addClass')"
    @remove-class="emit('removeClass', $event)"
  />
</template>
