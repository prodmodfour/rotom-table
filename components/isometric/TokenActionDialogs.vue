<script setup lang="ts">
import { ref } from 'vue'
import TokenHpDialog from '~/components/isometric/TokenHpDialog.vue'
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

const hpDialogComponent = ref<{ focusAmount: () => void } | null>(null)
const damageAmountInput = ref<HTMLInputElement | null>(null)

const focusHpAmount = () => {
  hpDialogComponent.value?.focusAmount()
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
  <TokenHpDialog
    v-if="props.hpDialog"
    ref="hpDialogComponent"
    :dialog="props.hpDialog"
    :delta="props.hpDialogDelta"
    :preview="props.hpDialogPreview"
    @close="emit('close-hp')"
    @submit="emit('submit-hp')"
  />

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

<style src="./tokenActionDialog.css"></style>
