<script setup lang="ts">
import type { TrainerClassEntry } from '~/types/trainerSheet'

defineProps<{
  classes?: TrainerClassEntry[]
}>()

defineEmits<{
  addClass: []
  removeClass: [index: number]
}>()
</script>

<template></template>
