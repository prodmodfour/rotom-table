<script setup lang="ts">
import type { TrainerAdvancementRow } from '~/types/trainerSheet'

defineProps<{
  advancementRows: readonly TrainerAdvancementRow[]
}>()

const emit = defineEmits<{
  setAdvancement: [level: number, field: keyof TrainerAdvancementRow, value: number | string | undefined]
}>()
</script>

<template>
  <div class="block">
    <h2 class="block-title">Trainer Advancement</h2>
    <table class="data-table adv-table">
      <thead>
        <tr><th>Level</th><th>Stats</th><th>Att</th><th>Sp.Att</th><th>Notes</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in advancementRows" :key="row.level">
          <th>Lv {{ row.level }}</th>
          <td>
            <EditableCell
              :model-value="row.stats"
              type="number"
              :min="0"
              @update:model-value="(v) => emit('setAdvancement', row.level, 'stats', v as number)"
            />
          </td>
          <td>
            <EditableCell
              :model-value="row.attack"
              type="number"
              :min="0"
              @update:model-value="(v) => emit('setAdvancement', row.level, 'attack', v as number)"
            />
          </td>
          <td>
            <EditableCell
              :model-value="row.spAttack"
              type="number"
              :min="0"
              @update:model-value="(v) => emit('setAdvancement', row.level, 'spAttack', v as number)"
            />
          </td>
          <td class="notes-col">
            <EditableCell
              :model-value="row.notes"
              placeholder="—"
              @update:model-value="(v) => emit('setAdvancement', row.level, 'notes', v as string)"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped src="./trainerProgressPanel.css"></style>
