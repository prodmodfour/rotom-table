<script setup lang="ts">
import { PhPlus, PhX } from '@phosphor-icons/vue'
import type { TrainerClassEntry } from '~/types/trainerSheet'

defineProps<{
  classes?: TrainerClassEntry[]
}>()

const emit = defineEmits<{
  addClass: []
  removeClass: [index: number]
}>()
</script>

<template>
  <div class="block">
    <h2 class="block-title">
      Trainer Classes
      <button type="button" class="row-add" @click="emit('addClass')">
        <PhPlus :size="14" weight="bold" /> Add row
      </button>
    </h2>
    <ul class="ref-list-vertical">
      <li v-for="(cls, i) in classes" :key="i" class="cls-row">
        <EditableCell v-model="cls.name" placeholder="Class name" />
        <span v-if="cls.specialisation || cls.name" class="cls-spec">
          (<EditableCell v-model="cls.specialisation" placeholder="—" />)
        </span>
        <span class="cls-notes">
          — <EditableCell v-model="cls.notes" placeholder="notes" />
        </span>
        <button type="button" class="row-remove" title="Remove class" @click="emit('removeClass', i)">
          <PhX :size="14" weight="bold" />
        </button>
      </li>
      <li v-if="!classes?.length" class="muted">No classes yet.</li>
    </ul>
  </div>
</template>

<style scoped src="./trainerProgressPanel.css"></style>
