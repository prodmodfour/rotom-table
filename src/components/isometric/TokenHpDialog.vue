<script setup lang="ts">
import { ref } from 'vue'
import type { HpDialogState } from '~/utils/isometric/tokenHpDialog'
import type { PtuInjuryAutomationResult } from '~/utils/ptuInjuries'

const props = defineProps<{
  dialog: HpDialogState
  delta: number
  preview: number
  temporaryHpPreview: number
  previewMaxHp: number
  injuryResult: PtuInjuryAutomationResult | null
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
        <h3>Modify HP</h3>
        <p class="hp-dialog__species">{{ props.dialog.species }}</p>
      </header>

      <div class="hp-dialog__readout">
        <span class="hp-dialog__current">
          {{ props.dialog.currentHp }} / {{ props.dialog.maxHp }}
          <span v-if="props.dialog.temporaryHp" class="hp-dialog__temp-hp">+{{ props.dialog.temporaryHp }} temp</span>
        </span>
        <span class="hp-dialog__arrow" aria-hidden="true">→</span>
        <span
          class="hp-dialog__preview"
          :class="{
            'is-damage': props.delta < 0,
            'is-heal': props.delta > 0,
          }"
        >
          {{ props.preview }} / {{ props.previewMaxHp }}
          <span v-if="props.temporaryHpPreview" class="hp-dialog__temp-hp">+{{ props.temporaryHpPreview }} temp</span>
        </span>
        <span
          v-if="props.injuryResult?.injuryDelta"
          class="hp-dialog__multiplier is-injury"
        >+{{ props.injuryResult.injuryDelta }} {{ props.injuryResult.injuryDelta === 1 ? 'Injury' : 'Injuries' }}</span>
      </div>

      <div class="hp-dialog__mode" role="group" aria-label="Operation">
        <button
          type="button"
          class="hp-dialog__mode-button"
          :class="{ 'is-active': props.dialog.mode === 'damage' }"
          :aria-pressed="props.dialog.mode === 'damage'"
          @click="props.dialog.mode = 'damage'"
        >
          − Lose
        </button>
        <button
          type="button"
          class="hp-dialog__mode-button"
          :class="{ 'is-active': props.dialog.mode === 'heal' }"
          :aria-pressed="props.dialog.mode === 'heal'"
          @click="props.dialog.mode = 'heal'"
        >
          + Gain
        </button>
      </div>

      <label class="hp-dialog__field">
        <span>Amount</span>
        <input
          ref="amountInput"
          v-model="props.dialog.amount"
          type="number"
          min="0"
          step="1"
          inputmode="numeric"
          placeholder="0"
        />
      </label>

      <p
        v-if="props.injuryResult?.injuryDelta"
        class="hp-dialog__breakdown"
      >
        <span>Injury automation</span>
        <span aria-hidden="true">=</span>
        <strong>{{ props.injuryResult.markerInjuries }} HP marker{{ props.injuryResult.markerInjuries === 1 ? '' : 's' }}</strong>
        <span v-if="props.dialog.mode === 'damage'" class="hp-dialog__subtle">HP loss never adds Massive Damage Injuries.</span>
      </p>

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
          :disabled="props.delta === 0 || (props.preview === props.dialog.currentHp && props.temporaryHpPreview === (props.dialog.temporaryHp ?? 0))"
        >
          Apply
        </button>
      </footer>
    </form>
  </div>
</template>
