<script setup lang="ts">
import { PhPlus, PhX } from '@phosphor-icons/vue'
import type { TrainerManeuver } from '~/types/trainerSheet'

const CATEGORY_OPTIONS = ['Physical', 'Special', 'Status']

defineProps<{
  maneuvers?: TrainerManeuver[]
}>()

const emit = defineEmits<{
  add: []
  remove: [index: number]
}>()
</script>

<template>
  <div class="block">
    <h2 class="block-title">
      Maneuvers
      <button type="button" class="row-add" @click="emit('add')">
        <PhPlus :size="14" weight="bold" /> Add row
      </button>
    </h2>
    <table class="data-table">
      <thead><tr><th>Name</th><th>Action</th><th>Cat.</th><th>AC</th><th>Range</th><th>Effect</th><th aria-label="Row actions"></th></tr></thead>
      <tbody>
        <tr v-for="(maneuver, i) in maneuvers" :key="i">
          <th><EditableCell v-model="maneuver.name" placeholder="Maneuver" /></th>
          <td><EditableCell v-model="maneuver.action" placeholder="Standard" /></td>
          <td>
            <EditableCell
              v-model="maneuver.category"
              type="select"
              :options="CATEGORY_OPTIONS"
              placeholder="—"
            >
              <template #display="slotProps">
                <DamageClassBadge v-if="!slotProps.empty" :category="String(slotProps.value)" size="xs" />
                <span v-else class="badge-empty">{{ slotProps.emptyLabel }}</span>
              </template>
            </EditableCell>
          </td>
          <td><EditableCell v-model="maneuver.ac" type="number" /></td>
          <td><EditableCell v-model="maneuver.range" placeholder="Melee" /></td>
          <td class="effect-col">
            <EditableCell v-model="maneuver.effect" type="textarea" placeholder="—" multiline />
          </td>
          <td class="row-actions">
            <button type="button" class="row-remove" title="Remove maneuver" @click="emit('remove', i)">
              <PhX :size="14" weight="bold" />
            </button>
          </td>
        </tr>
        <tr v-if="!maneuvers?.length">
          <td colspan="7" class="muted">No maneuvers yet.</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped src="./trainerCombatActionPanel.css"></style>
