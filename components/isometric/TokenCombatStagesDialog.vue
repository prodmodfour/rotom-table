<script setup lang="ts">
import { COMBAT_STAGE_ROWS, clampCombatStage } from '~/utils/combatStages'
import type { CombatStageKey } from '~/types/combatStages'
import {
  formatCombatStage,
  getAdjustedCombatStage,
  type CombatStagesDialogState,
} from '~/utils/isometric/tokenStatusDialogs'

const props = defineProps<{
  dialog: CombatStagesDialogState
  changed: boolean
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'submit'): void
}>()

const adjustCombatStage = (key: CombatStageKey, delta: number) => {
  props.dialog.stages[key] = getAdjustedCombatStage(props.dialog.stages[key], delta)
}

const normalizeCombatStageInput = (key: CombatStageKey) => {
  props.dialog.stages[key] = clampCombatStage(props.dialog.stages[key])
}
</script>

<template>
  <div
    class="hp-dialog-backdrop"
    @pointerdown.self="emit('close')"
    @contextmenu.prevent
  >
    <form
      class="hp-dialog hp-dialog--wide"
      @submit.prevent="emit('submit')"
      @pointerdown.stop
    >
      <header class="hp-dialog__header">
        <h3>Change Combat Stages</h3>
        <p class="hp-dialog__species">{{ props.dialog.species }}</p>
      </header>

      <div class="combat-stage-dialog__rows">
        <div
          v-for="row in COMBAT_STAGE_ROWS"
          :key="row.key"
          class="combat-stage-dialog__row"
        >
          <span class="combat-stage-dialog__label">{{ row.label }}</span>
          <button
            type="button"
            class="combat-stage-dialog__step"
            :disabled="clampCombatStage(props.dialog.stages[row.key]) <= -6"
            :aria-label="`Lower ${row.label} combat stage`"
            @click="adjustCombatStage(row.key, -1)"
          >−</button>
          <input
            v-model.number="props.dialog.stages[row.key]"
            class="combat-stage-dialog__input"
            type="number"
            min="-6"
            max="6"
            step="1"
            inputmode="numeric"
            :aria-label="`${row.label} combat stage`"
            @change="normalizeCombatStageInput(row.key)"
          />
          <button
            type="button"
            class="combat-stage-dialog__step"
            :disabled="clampCombatStage(props.dialog.stages[row.key]) >= 6"
            :aria-label="`Raise ${row.label} combat stage`"
            @click="adjustCombatStage(row.key, 1)"
          >+</button>
          <span
            class="combat-stage-dialog__preview"
            :class="{
              'is-positive': clampCombatStage(props.dialog.stages[row.key]) > 0,
              'is-negative': clampCombatStage(props.dialog.stages[row.key]) < 0,
            }"
          >{{ formatCombatStage(props.dialog.stages[row.key]) }}</span>
        </div>
      </div>

      <p class="hp-dialog__note">Combat stages are saved to the source character sheet and clamped from −6 to +6.</p>

      <footer class="hp-dialog__footer">
        <button
          type="button"
          class="hp-dialog__button hp-dialog__button--ghost"
          @click="emit('close')"
        >
          Cancel
        </button>
        <button
          type="submit"
          class="hp-dialog__button hp-dialog__button--primary"
          :disabled="!props.changed"
        >
          Apply
        </button>
      </footer>
    </form>
  </div>
</template>
