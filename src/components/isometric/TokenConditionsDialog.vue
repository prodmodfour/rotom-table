<script setup lang="ts">
import ConditionPicker from '~/components/ConditionPicker.vue'
import type { ConditionsDialogState } from '~/utils/isometric/tokenStatusDialogs'

const props = defineProps<{
  dialog: ConditionsDialogState
  changed: boolean
  availableMoves?: string[]
  availableCrushes?: string[]
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'submit'): void
}>()
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
        <h3>Apply/Remove Conditions</h3>
        <p class="hp-dialog__species">{{ props.dialog.species }}</p>
      </header>

      <ConditionPicker
        v-model="props.dialog.conditions"
        class="conditions-dialog__picker"
        compact
        tag-size="sm"
        :available-moves="props.availableMoves ?? []"
        :available-crushes="props.availableCrushes ?? []"
      />

      <p class="hp-dialog__note">Conditions are saved to the source character sheet and shown on every map token for that sheet.</p>

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
