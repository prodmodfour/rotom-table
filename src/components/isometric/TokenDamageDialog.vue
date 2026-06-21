<script setup lang="ts">
import { ref } from 'vue'
import DamageClassBadge from '~/components/DamageClassBadge.vue'
import TypeBadge from '~/components/TypeBadge.vue'
import {
  MANUAL_DAMAGE_BASE_TABLE,
  formatDamageBaseFormula,
  rollDamageBase,
  type DamageBaseDef,
} from '~/utils/ptuDamage'
import { POKEMON_TYPES } from '~/utils/typeChart'
import { playDiceRollSound } from '~/utils/soundEffects'
import type { SpawnedPokemon } from '~/types/pokemon'
import type {
  DamageDialogMultiplierTone,
  DamageDialogState,
} from '~/utils/isometric/tokenDamageDialog'
import type { PtuInjuryAutomationResult } from '~/utils/ptuInjuries'

type DamageDialogAttackerOption = Pick<SpawnedPokemon, 'id' | 'species' | 'atk' | 'satk'>

const props = defineProps<{
  dialog: DamageDialogState
  dbDef: DamageBaseDef | null
  rawAmount: number
  defense: number
  attackerOptions: DamageDialogAttackerOption[]
  attackBonus: number
  multiplier: number
  hpLoss: number
  preview: number
  previewMaxHp: number
  injuryResult: PtuInjuryAutomationResult | null
  multiplierTone: DamageDialogMultiplierTone
  multiplierLabel: string
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

const handleDbChange = () => {
  // Stale rolls confuse the breakdown — clear so the user re-rolls the
  // formula they actually selected.
  props.dialog.roll = null
}

const handleRoll = () => {
  if (!props.dbDef) return
  props.dialog.roll = rollDamageBase(props.dbDef)
  void playDiceRollSound()
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
        <h3>Deal damage</h3>
        <p class="hp-dialog__species">
          {{ props.dialog.species }}
          <span v-if="props.dialog.defenderTypes.length" class="hp-dialog__types">
            <span aria-hidden="true">·</span>
            <TypeBadge
              v-for="type in props.dialog.defenderTypes"
              :key="type"
              :type="type"
              size="xs"
            />
          </span>
        </p>
      </header>

      <div class="hp-dialog__readout">
        <span class="hp-dialog__current">{{ props.dialog.currentHp }} / {{ props.dialog.maxHp }}</span>
        <span class="hp-dialog__arrow" aria-hidden="true">→</span>
        <span
          class="hp-dialog__preview"
          :class="{ 'is-damage': props.hpLoss > 0 }"
        >{{ props.preview }} / {{ props.previewMaxHp }}</span>
        <span
          v-if="props.injuryResult?.injuryDelta"
          class="hp-dialog__multiplier is-injury"
        >+{{ props.injuryResult.injuryDelta }} {{ props.injuryResult.injuryDelta === 1 ? 'Injury' : 'Injuries' }}</span>
        <span
          v-if="props.multiplierTone"
          class="hp-dialog__multiplier"
          :class="props.multiplierTone"
        >×{{ props.multiplierLabel }}</span>
      </div>

      <div class="hp-dialog__mode" role="group" aria-label="Damage category">
        <button
          type="button"
          class="hp-dialog__mode-button"
          :class="{ 'is-active': props.dialog.mode === 'physical' }"
          :aria-pressed="props.dialog.mode === 'physical'"
          @click="props.dialog.mode = 'physical'"
        >
          <DamageClassBadge category="Physical" size="xs" />
          <span class="hp-dialog__mode-stat">Def {{ props.dialog.def }}</span>
        </button>
        <button
          type="button"
          class="hp-dialog__mode-button"
          :class="{ 'is-active': props.dialog.mode === 'special' }"
          :aria-pressed="props.dialog.mode === 'special'"
          @click="props.dialog.mode = 'special'"
        >
          <DamageClassBadge category="Special" size="xs" />
          <span class="hp-dialog__mode-stat">Sp.Def {{ props.dialog.sdef }}</span>
        </button>
      </div>

      <label class="hp-dialog__field">
        <span>Attack type</span>
        <div class="hp-dialog__select-row">
          <TypeBadge :type="props.dialog.attackType" size="xs" />
          <select v-model="props.dialog.attackType">
            <option v-for="type in POKEMON_TYPES" :key="type" :value="type">{{ type }}</option>
          </select>
        </div>
      </label>

      <div class="hp-dialog__mode" role="group" aria-label="Damage source">
        <button
          type="button"
          class="hp-dialog__mode-button"
          :class="{ 'is-active': props.dialog.source === 'flat' }"
          :aria-pressed="props.dialog.source === 'flat'"
          @click="props.dialog.source = 'flat'"
        >
          Set damage
        </button>
        <button
          type="button"
          class="hp-dialog__mode-button"
          :class="{ 'is-active': props.dialog.source === 'db' }"
          :aria-pressed="props.dialog.source === 'db'"
          @click="props.dialog.source = 'db'"
        >
          Damage Base
        </button>
      </div>

      <label v-if="props.dialog.source === 'flat'" class="hp-dialog__field">
        <span>Damage</span>
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

      <template v-else>
        <label class="hp-dialog__field">
          <span>Attacker</span>
          <select v-model="props.dialog.attackerId">
            <option :value="null">None</option>
            <option
              v-for="attacker in props.attackerOptions"
              :key="attacker.id"
              :value="attacker.id"
            >{{ attacker.species }} · Atk {{ attacker.atk }} / Sp.Atk {{ attacker.satk }}</option>
          </select>
        </label>

        <label class="hp-dialog__field">
          <span>Damage Base</span>
          <select v-model.number="props.dialog.db" @change="handleDbChange">
            <option
              v-for="entry in MANUAL_DAMAGE_BASE_TABLE"
              :key="entry.db"
              :value="entry.db"
            >DB {{ entry.db }} · {{ formatDamageBaseFormula(entry) }}</option>
          </select>
        </label>

        <p class="hp-dialog__note">
          DB is taken as final — STAB and other DB modifiers aren't applied.
        </p>

        <div class="hp-dialog__roll">
          <button
            type="button"
            class="hp-dialog__button hp-dialog__button--ghost"
            @click="handleRoll"
          >{{ props.dialog.roll ? 'Re-roll' : 'Roll' }}</button>
          <p v-if="props.dialog.roll" class="hp-dialog__roll-result">
            <span>[{{ props.dialog.roll.rolls.join(', ') }}]</span>
            <span aria-hidden="true">+</span>
            <span>{{ props.dialog.roll.mod }}</span>
            <span aria-hidden="true">=</span>
            <strong>{{ props.dialog.roll.total }}</strong>
          </p>
          <p v-else class="hp-dialog__roll-empty">No roll yet</p>
        </div>
      </template>

      <p
        v-if="props.multiplier === 0 && props.rawAmount > 0"
        class="hp-dialog__breakdown is-immune"
      >
        <strong class="hp-dialog__immune-line">
          <span>Immune to</span>
          <TypeBadge :type="props.dialog.attackType" size="xs" />
          <span>— 0 HP lost</span>
        </strong>
      </p>
      <p v-else class="hp-dialog__breakdown">
        <span>{{ props.rawAmount }} dmg</span>
        <template v-if="props.attackBonus > 0">
          <span aria-hidden="true">+</span>
          <span>{{ props.attackBonus }} {{ props.dialog.mode === 'physical' ? 'Atk' : 'Sp.Atk' }}</span>
        </template>
        <span aria-hidden="true">−</span>
        <span>{{ props.defense }} {{ props.dialog.mode === 'physical' ? 'Def' : 'Sp.Def' }}</span>
        <span aria-hidden="true">×</span>
        <span>{{ props.multiplierLabel }}</span>
        <span aria-hidden="true">=</span>
        <strong>{{ props.hpLoss }} HP lost</strong>
      </p>

      <p
        v-if="props.injuryResult?.injuryDelta"
        class="hp-dialog__breakdown"
      >
        <span>Injury automation</span>
        <span aria-hidden="true">=</span>
        <strong v-if="props.injuryResult.massiveDamageInjuries">Massive Damage</strong>
        <span v-if="props.injuryResult.massiveDamageInjuries && props.injuryResult.markerInjuries" aria-hidden="true">+</span>
        <strong v-if="props.injuryResult.markerInjuries">{{ props.injuryResult.markerInjuries }} HP marker{{ props.injuryResult.markerInjuries === 1 ? '' : 's' }}</strong>
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
          :disabled="props.rawAmount === 0 || props.preview === props.dialog.currentHp"
        >
          Apply
        </button>
      </footer>
    </form>
  </div>
</template>
