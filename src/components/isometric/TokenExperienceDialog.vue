<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ExperienceDialogState } from '~/utils/isometric/tokenExperienceDialog'

const props = defineProps<{
  dialog: ExperienceDialogState
  amount: number
  previewTotalExp: number
  previewLevel: number
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'submit'): void
}>()

const amountInput = ref<HTMLInputElement | null>(null)

const focusAmount = () => {
  amountInput.value?.focus()
  amountInput.value?.select()
}

const formatter = new Intl.NumberFormat()
const formatInteger = (value: number): string => formatter.format(Math.max(0, Math.floor(value)))

const levelDelta = computed(() => props.previewLevel - props.dialog.level)
const previewLevelLabel = computed(() => (
  levelDelta.value > 0
    ? `Lv ${props.previewLevel} (+${levelDelta.value})`
    : `Lv ${props.previewLevel}`
))

defineExpose({ focusAmount })
</script>

<template>
  <div
    class="hp-dialog-backdrop"
    @pointerdown.self="emit('close')"
    @contextmenu.prevent
  >
    <form
      class="hp-dialog"
      @submit.prevent="emit('submit')"
      @pointerdown.stop
    >
      <header class="hp-dialog__header">
        <h3>Grant XP</h3>
        <p class="hp-dialog__species">{{ props.dialog.species }}</p>
      </header>

      <div class="hp-dialog__readout">
        <span class="hp-dialog__current">
          Lv {{ props.dialog.level }} · {{ formatInteger(props.dialog.totalExp) }} XP
        </span>
        <span class="hp-dialog__arrow" aria-hidden="true">→</span>
        <span
          class="hp-dialog__preview"
          :class="{ 'is-heal': props.amount > 0 }"
        >{{ previewLevelLabel }} · {{ formatInteger(props.previewTotalExp) }} XP</span>
      </div>

      <p v-if="!props.dialog.hasTrackedTotalExp" class="hp-dialog__breakdown">
        <span>Total XP will start from the minimum for Level {{ props.dialog.level }}.</span>
      </p>

      <label class="hp-dialog__field">
        <span>XP amount</span>
        <input
          ref="amountInput"
          v-model="props.dialog.amount"
          type="number"
          min="1"
          step="1"
          inputmode="numeric"
          placeholder="0"
        />
      </label>

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
          :disabled="props.amount <= 0"
        >
          Grant XP
        </button>
      </footer>
    </form>
  </div>
</template>
