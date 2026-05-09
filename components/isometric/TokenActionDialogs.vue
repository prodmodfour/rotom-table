<script setup lang="ts">
import { ref } from 'vue'
import ConditionPicker from '~/components/ConditionPicker.vue'
import DamageClassBadge from '~/components/DamageClassBadge.vue'
import TypeBadge from '~/components/TypeBadge.vue'
import { COMBAT_STAGE_ROWS, clampCombatStage } from '~/utils/combatStages'
import { MANUAL_DAMAGE_BASE_TABLE, formatDamageBaseFormula, rollDamageBase, type DamageBaseDef } from '~/utils/ptuDamage'
import { POKEMON_TYPES } from '~/utils/typeChart'
import type { SpawnedPokemon } from '~/types/pokemon'
import {
  formatCombatStage,
  getAdjustedCombatStage,
  type CombatStagesDialogState,
  type ConditionsDialogState,
} from '~/utils/isometric/tokenStatusDialogs'
import type { HpDialogState } from '~/utils/isometric/tokenHpDialog'
import type {
  DamageDialogMultiplierTone,
  DamageDialogState,
} from '~/utils/isometric/tokenDamageDialog'
import type { CombatStageKey } from '~/types/combatStages'

type DamageDialogAttackerOption = Pick<SpawnedPokemon, 'id' | 'species' | 'atk' | 'satk'>

const props = defineProps<{
  hpDialog: HpDialogState | null
  hpDialogDelta: number
  hpDialogPreview: number
  combatStagesDialog: CombatStagesDialogState | null
  combatStagesDialogChanged: boolean
  conditionsDialog: ConditionsDialogState | null
  conditionsDialogChanged: boolean
  damageDialog: DamageDialogState | null
  damageDialogDbDef: DamageBaseDef | null
  damageDialogRawAmount: number
  damageDialogDefense: number
  damageDialogAttackerOptions: DamageDialogAttackerOption[]
  damageDialogAttackBonus: number
  damageDialogMultiplier: number
  damageDialogHpLoss: number
  damageDialogPreview: number
  damageDialogMultiplierTone: DamageDialogMultiplierTone
  damageDialogMultiplierLabel: string
}>()

const emit = defineEmits<{
  (event: 'close-hp'): void
  (event: 'submit-hp'): void
  (event: 'close-combat-stages'): void
  (event: 'submit-combat-stages'): void
  (event: 'close-conditions'): void
  (event: 'submit-conditions'): void
  (event: 'close-damage'): void
  (event: 'submit-damage'): void
}>()

const hpAmountInput = ref<HTMLInputElement | null>(null)
const damageAmountInput = ref<HTMLInputElement | null>(null)

const focusHpAmount = () => {
  hpAmountInput.value?.focus()
  hpAmountInput.value?.select()
}

const focusDamageAmount = () => {
  damageAmountInput.value?.focus()
  damageAmountInput.value?.select()
}

const adjustCombatStage = (key: CombatStageKey, delta: number) => {
  if (!props.combatStagesDialog) return
  props.combatStagesDialog.stages[key] = getAdjustedCombatStage(
    props.combatStagesDialog.stages[key],
    delta,
  )
}

const normalizeCombatStageInput = (key: CombatStageKey) => {
  if (!props.combatStagesDialog) return
  props.combatStagesDialog.stages[key] = clampCombatStage(props.combatStagesDialog.stages[key])
}

const handleDamageDialogDbChange = () => {
  // Stale rolls confuse the breakdown — clear so the user re-rolls the
  // formula they actually selected.
  if (props.damageDialog) props.damageDialog.roll = null
}

const handleDamageDialogRoll = () => {
  if (!props.damageDialog || !props.damageDialogDbDef) return
  props.damageDialog.roll = rollDamageBase(props.damageDialogDbDef)
}

defineExpose({ focusHpAmount, focusDamageAmount })
</script>

<template>
  <div
    v-if="props.hpDialog"
    class="hp-dialog-backdrop"
    @pointerdown.self="emit('close-hp')"
    @contextmenu.prevent
  >
    <form
      class="hp-dialog"
      @submit.prevent="emit('submit-hp')"
      @pointerdown.stop
    >
      <header class="hp-dialog__header">
        <h3>Modify HP</h3>
        <p class="hp-dialog__species">{{ props.hpDialog.species }}</p>
      </header>

      <div class="hp-dialog__readout">
        <span class="hp-dialog__current">{{ props.hpDialog.currentHp }} / {{ props.hpDialog.maxHp }}</span>
        <span class="hp-dialog__arrow" aria-hidden="true">→</span>
        <span
          class="hp-dialog__preview"
          :class="{
            'is-damage': props.hpDialogDelta < 0,
            'is-heal': props.hpDialogDelta > 0,
          }"
        >{{ props.hpDialogPreview }} / {{ props.hpDialog.maxHp }}</span>
      </div>

      <div class="hp-dialog__mode" role="group" aria-label="Operation">
        <button
          type="button"
          class="hp-dialog__mode-button"
          :class="{ 'is-active': props.hpDialog.mode === 'damage' }"
          :aria-pressed="props.hpDialog.mode === 'damage'"
          @click="props.hpDialog.mode = 'damage'"
        >
          − Lose
        </button>
        <button
          type="button"
          class="hp-dialog__mode-button"
          :class="{ 'is-active': props.hpDialog.mode === 'heal' }"
          :aria-pressed="props.hpDialog.mode === 'heal'"
          @click="props.hpDialog.mode = 'heal'"
        >
          + Gain
        </button>
      </div>

      <label class="hp-dialog__field">
        <span>Amount</span>
        <input
          ref="hpAmountInput"
          v-model="props.hpDialog.amount"
          type="number"
          min="0"
          step="1"
          inputmode="numeric"
          placeholder="0"
        />
      </label>

      <footer class="hp-dialog__footer">
        <button
          type="button"
          class="hp-dialog__button hp-dialog__button--ghost"
          @click="emit('close-hp')"
        >
          Cancel
        </button>
        <button
          type="submit"
          class="hp-dialog__button hp-dialog__button--primary"
          :disabled="props.hpDialogDelta === 0 || props.hpDialogPreview === props.hpDialog.currentHp"
        >
          Apply
        </button>
      </footer>
    </form>
  </div>

  <div
    v-if="props.combatStagesDialog"
    class="hp-dialog-backdrop"
    @pointerdown.self="emit('close-combat-stages')"
    @contextmenu.prevent
  >
    <form
      class="hp-dialog hp-dialog--wide"
      @submit.prevent="emit('submit-combat-stages')"
      @pointerdown.stop
    >
      <header class="hp-dialog__header">
        <h3>Change Combat Stages</h3>
        <p class="hp-dialog__species">{{ props.combatStagesDialog.species }}</p>
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
            :disabled="clampCombatStage(props.combatStagesDialog.stages[row.key]) <= -6"
            :aria-label="`Lower ${row.label} combat stage`"
            @click="adjustCombatStage(row.key, -1)"
          >−</button>
          <input
            v-model.number="props.combatStagesDialog.stages[row.key]"
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
            :disabled="clampCombatStage(props.combatStagesDialog.stages[row.key]) >= 6"
            :aria-label="`Raise ${row.label} combat stage`"
            @click="adjustCombatStage(row.key, 1)"
          >+</button>
          <span
            class="combat-stage-dialog__preview"
            :class="{
              'is-positive': clampCombatStage(props.combatStagesDialog.stages[row.key]) > 0,
              'is-negative': clampCombatStage(props.combatStagesDialog.stages[row.key]) < 0,
            }"
          >{{ formatCombatStage(props.combatStagesDialog.stages[row.key]) }}</span>
        </div>
      </div>

      <p class="hp-dialog__note">Combat stages are saved to the source character sheet and clamped from −6 to +6.</p>

      <footer class="hp-dialog__footer">
        <button
          type="button"
          class="hp-dialog__button hp-dialog__button--ghost"
          @click="emit('close-combat-stages')"
        >
          Cancel
        </button>
        <button
          type="submit"
          class="hp-dialog__button hp-dialog__button--primary"
          :disabled="!props.combatStagesDialogChanged"
        >
          Apply
        </button>
      </footer>
    </form>
  </div>

  <div
    v-if="props.conditionsDialog"
    class="hp-dialog-backdrop"
    @pointerdown.self="emit('close-conditions')"
    @contextmenu.prevent
  >
    <form
      class="hp-dialog hp-dialog--wide"
      @submit.prevent="emit('submit-conditions')"
      @pointerdown.stop
    >
      <header class="hp-dialog__header">
        <h3>Apply/Remove Conditions</h3>
        <p class="hp-dialog__species">{{ props.conditionsDialog.species }}</p>
      </header>

      <ConditionPicker
        v-model="props.conditionsDialog.conditions"
        class="conditions-dialog__picker"
        compact
        tag-size="sm"
      />

      <p class="hp-dialog__note">Conditions are saved to the source character sheet and shown on every map token for that sheet.</p>

      <footer class="hp-dialog__footer">
        <button
          type="button"
          class="hp-dialog__button hp-dialog__button--ghost"
          @click="emit('close-conditions')"
        >
          Cancel
        </button>
        <button
          type="submit"
          class="hp-dialog__button hp-dialog__button--primary"
          :disabled="!props.conditionsDialogChanged"
        >
          Apply
        </button>
      </footer>
    </form>
  </div>

  <div
    v-if="props.damageDialog"
    class="hp-dialog-backdrop"
    @pointerdown.self="emit('close-damage')"
    @contextmenu.prevent
  >
    <form
      class="hp-dialog"
      @submit.prevent="emit('submit-damage')"
      @pointerdown.stop
    >
      <header class="hp-dialog__header">
        <h3>Deal damage</h3>
        <p class="hp-dialog__species">
          {{ props.damageDialog.species }}
          <span v-if="props.damageDialog.defenderTypes.length" class="hp-dialog__types">
            <span aria-hidden="true">·</span>
            <TypeBadge
              v-for="type in props.damageDialog.defenderTypes"
              :key="type"
              :type="type"
              size="xs"
            />
          </span>
        </p>
      </header>

      <div class="hp-dialog__readout">
        <span class="hp-dialog__current">{{ props.damageDialog.currentHp }} / {{ props.damageDialog.maxHp }}</span>
        <span class="hp-dialog__arrow" aria-hidden="true">→</span>
        <span
          class="hp-dialog__preview"
          :class="{ 'is-damage': props.damageDialogHpLoss > 0 }"
        >{{ props.damageDialogPreview }} / {{ props.damageDialog.maxHp }}</span>
        <span
          v-if="props.damageDialogMultiplierTone"
          class="hp-dialog__multiplier"
          :class="props.damageDialogMultiplierTone"
        >×{{ props.damageDialogMultiplierLabel }}</span>
      </div>

      <div class="hp-dialog__mode" role="group" aria-label="Damage category">
        <button
          type="button"
          class="hp-dialog__mode-button"
          :class="{ 'is-active': props.damageDialog.mode === 'physical' }"
          :aria-pressed="props.damageDialog.mode === 'physical'"
          @click="props.damageDialog.mode = 'physical'"
        >
          <DamageClassBadge category="Physical" size="xs" />
          <span class="hp-dialog__mode-stat">Def {{ props.damageDialog.def }}</span>
        </button>
        <button
          type="button"
          class="hp-dialog__mode-button"
          :class="{ 'is-active': props.damageDialog.mode === 'special' }"
          :aria-pressed="props.damageDialog.mode === 'special'"
          @click="props.damageDialog.mode = 'special'"
        >
          <DamageClassBadge category="Special" size="xs" />
          <span class="hp-dialog__mode-stat">Sp.Def {{ props.damageDialog.sdef }}</span>
        </button>
      </div>

      <label class="hp-dialog__field">
        <span>Attack type</span>
        <div class="hp-dialog__select-row">
          <TypeBadge :type="props.damageDialog.attackType" size="xs" />
          <select v-model="props.damageDialog.attackType">
            <option v-for="type in POKEMON_TYPES" :key="type" :value="type">{{ type }}</option>
          </select>
        </div>
      </label>

      <div class="hp-dialog__mode" role="group" aria-label="Damage source">
        <button
          type="button"
          class="hp-dialog__mode-button"
          :class="{ 'is-active': props.damageDialog.source === 'flat' }"
          :aria-pressed="props.damageDialog.source === 'flat'"
          @click="props.damageDialog.source = 'flat'"
        >
          Set damage
        </button>
        <button
          type="button"
          class="hp-dialog__mode-button"
          :class="{ 'is-active': props.damageDialog.source === 'db' }"
          :aria-pressed="props.damageDialog.source === 'db'"
          @click="props.damageDialog.source = 'db'"
        >
          Damage Base
        </button>
      </div>

      <label v-if="props.damageDialog.source === 'flat'" class="hp-dialog__field">
        <span>Damage</span>
        <input
          ref="damageAmountInput"
          v-model="props.damageDialog.amount"
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
          <select v-model="props.damageDialog.attackerId">
            <option :value="null">None</option>
            <option
              v-for="attacker in props.damageDialogAttackerOptions"
              :key="attacker.id"
              :value="attacker.id"
            >{{ attacker.species }} · Atk {{ attacker.atk }} / Sp.Atk {{ attacker.satk }}</option>
          </select>
        </label>

        <label class="hp-dialog__field">
          <span>Damage Base</span>
          <select v-model.number="props.damageDialog.db" @change="handleDamageDialogDbChange">
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
            @click="handleDamageDialogRoll"
          >{{ props.damageDialog.roll ? 'Re-roll' : 'Roll' }}</button>
          <p v-if="props.damageDialog.roll" class="hp-dialog__roll-result">
            <span>[{{ props.damageDialog.roll.rolls.join(', ') }}]</span>
            <span aria-hidden="true">+</span>
            <span>{{ props.damageDialog.roll.mod }}</span>
            <span aria-hidden="true">=</span>
            <strong>{{ props.damageDialog.roll.total }}</strong>
          </p>
          <p v-else class="hp-dialog__roll-empty">No roll yet</p>
        </div>
      </template>

      <p
        v-if="props.damageDialogMultiplier === 0 && props.damageDialogRawAmount > 0"
        class="hp-dialog__breakdown is-immune"
      >
        <strong class="hp-dialog__immune-line">
          <span>Immune to</span>
          <TypeBadge :type="props.damageDialog.attackType" size="xs" />
          <span>— 0 HP lost</span>
        </strong>
      </p>
      <p v-else class="hp-dialog__breakdown">
        <span>{{ props.damageDialogRawAmount }} dmg</span>
        <template v-if="props.damageDialogAttackBonus > 0">
          <span aria-hidden="true">+</span>
          <span>{{ props.damageDialogAttackBonus }} {{ props.damageDialog.mode === 'physical' ? 'Atk' : 'Sp.Atk' }}</span>
        </template>
        <span aria-hidden="true">−</span>
        <span>{{ props.damageDialogDefense }} {{ props.damageDialog.mode === 'physical' ? 'Def' : 'Sp.Def' }}</span>
        <span aria-hidden="true">×</span>
        <span>{{ props.damageDialogMultiplierLabel }}</span>
        <span aria-hidden="true">=</span>
        <strong>{{ props.damageDialogHpLoss }} HP lost</strong>
      </p>

      <footer class="hp-dialog__footer">
        <button
          type="button"
          class="hp-dialog__button hp-dialog__button--ghost"
          @click="emit('close-damage')"
        >
          Cancel
        </button>
        <button
          type="submit"
          class="hp-dialog__button hp-dialog__button--primary"
          :disabled="props.damageDialogRawAmount === 0 || props.damageDialogPreview === props.damageDialog.currentHp"
        >
          Apply
        </button>
      </footer>
    </form>
  </div>
</template>

<style scoped>
.hp-dialog-backdrop {
  position: absolute;
  inset: 0;
  z-index: 9;
  display: grid;
  place-items: center;
  background: rgba(29, 32, 33, 0.45);
  backdrop-filter: blur(2px);
}

.hp-dialog {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  width: min(320px, 90vw);
  padding: 1rem 1.1rem;
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
}

.hp-dialog--wide {
  width: min(420px, 92vw);
}

.combat-stage-dialog__rows {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.combat-stage-dialog__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 4.25rem auto 3rem;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
}

.combat-stage-dialog__label {
  color: var(--ink);
  font-size: 0.88rem;
  letter-spacing: 0.02em;
}

.combat-stage-dialog__step {
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper-soft);
  color: var(--ink-bright);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.combat-stage-dialog__step:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.combat-stage-dialog__step:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.combat-stage-dialog__input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper-soft);
  color: var(--ink);
  padding: 0.45rem 0.55rem;
  outline: none;
  font: inherit;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.combat-stage-dialog__input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

.combat-stage-dialog__preview {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--ink-muted);
  font-weight: 700;
}

.combat-stage-dialog__preview.is-positive {
  color: #b8bb26;
}

.combat-stage-dialog__preview.is-negative {
  color: #fb4934;
}

.conditions-dialog__picker {
  max-height: min(48vh, 420px);
  overflow: auto;
  padding-right: 0.2rem;
}

.hp-dialog__header {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.hp-dialog__header h3 {
  margin: 0;
  font-family: var(--font-book);
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-bright);
}

.hp-dialog__species {
  margin: 0;
  font-size: 0.82rem;
  color: var(--ink-muted);
  letter-spacing: 0.02em;
}

.hp-dialog__types {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem;
  color: var(--ink);
}

.hp-dialog__readout {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  font-variant-numeric: tabular-nums;
  font-size: 0.95rem;
  color: var(--ink);
}

.hp-dialog__arrow {
  color: var(--ink-muted);
}

.hp-dialog__preview.is-damage {
  color: #fb4934;
}

.hp-dialog__preview.is-heal {
  color: #b8bb26;
}

.hp-dialog__multiplier {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.12rem 0.55rem;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  font-weight: 600;
  border: 1px solid currentColor;
}

.hp-dialog__multiplier.is-weak {
  color: #fb4934;
  background: rgba(251, 73, 52, 0.12);
}

.hp-dialog__multiplier.is-resist {
  color: #b8bb26;
  background: rgba(184, 187, 38, 0.12);
}

.hp-dialog__multiplier.is-immune {
  color: var(--ink-muted);
  background: var(--paper);
}

.hp-dialog__mode {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}

.hp-dialog__mode-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.55rem 0.7rem;
  cursor: pointer;
  font: inherit;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.hp-dialog__mode-button:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.hp-dialog__mode-button.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.hp-dialog__field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.hp-dialog__field span {
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.hp-dialog__select-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.45rem;
}

.hp-dialog__mode-stat {
  white-space: nowrap;
}

.hp-dialog__field input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.65rem 0.8rem;
  outline: none;
  font: inherit;
  font-variant-numeric: tabular-nums;
}

.hp-dialog__field input:focus,
.hp-dialog__field select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

.hp-dialog__field select {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.6rem 0.8rem;
  outline: none;
  font: inherit;
  cursor: pointer;
}

.hp-dialog__roll {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.hp-dialog__roll .hp-dialog__button {
  flex: 0 0 auto;
}

.hp-dialog__roll-result {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
  margin: 0;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}

.hp-dialog__roll-result strong {
  color: var(--ink-bright);
  font-weight: 600;
}

.hp-dialog__roll-empty {
  margin: 0;
  font-size: 0.82rem;
  color: var(--ink-muted);
  font-style: italic;
}

.hp-dialog__note {
  margin: -0.25rem 0 0;
  font-size: 0.78rem;
  color: var(--ink-muted);
  letter-spacing: 0.01em;
  line-height: 1.4;
}

.hp-dialog__breakdown {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: center;
  gap: 0.35rem;
  margin: 0;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  color: var(--ink-muted);
}

.hp-dialog__breakdown.is-immune {
  color: var(--ink-muted);
  border-style: dashed;
}

.hp-dialog__breakdown strong {
  color: var(--ink-bright);
  font-weight: 600;
}

.hp-dialog__immune-line {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.hp-dialog__footer {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}

.hp-dialog__button {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  padding: 0.55rem 0.8rem;
  cursor: pointer;
  font: inherit;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.hp-dialog__button--ghost {
  background: var(--paper);
  color: var(--ink);
}

.hp-dialog__button--ghost:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.hp-dialog__button--primary {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

.hp-dialog__button--primary:hover:not(:disabled) {
  background: var(--accent);
  color: var(--paper);
}

.hp-dialog__button--primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
