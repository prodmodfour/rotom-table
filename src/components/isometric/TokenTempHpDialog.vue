<script setup lang="ts">
import { ref } from 'vue'
import type { TempHpDialogState } from '~/utils/isometric/tokenTempHpDialog'

const props = defineProps<{
  dialog: TempHpDialogState
  amount: number
  preview: number
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
        <h3>Add Temp HP</h3>
        <p class="hp-dialog__species">{{ props.dialog.species }}</p>
      </header>

      <div class="hp-dialog__readout">
        <span class="hp-dialog__current">{{ props.dialog.currentTemporaryHp }} temp</span>
        <span class="hp-dialog__arrow" aria-hidden="true">→</span>
        <span class="hp-dialog__preview is-heal">{{ props.preview }} temp</span>
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

      <p class="hp-dialog__note">
        Temporary HP is stored on the current map scene and clears when the scene changes.
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
          :disabled="props.amount <= 0"
        >
          Apply
        </button>
      </footer>
    </form>
  </div>
</template>
