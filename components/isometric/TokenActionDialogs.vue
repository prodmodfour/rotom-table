<script setup lang="ts">
import { ref } from 'vue'
import TokenDamageDialog from '~/components/isometric/TokenDamageDialog.vue'
import TokenHpDialog from '~/components/isometric/TokenHpDialog.vue'
import ConditionPicker from '~/components/ConditionPicker.vue'
import { COMBAT_STAGE_ROWS, clampCombatStage } from '~/utils/combatStages'
import type { DamageBaseDef } from '~/utils/ptuDamage'
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
const damageDialogComponent = ref<{ focusAmount: () => void } | null>(null)

const focusHpAmount = () => {
  hpDialogComponent.value?.focusAmount()
}

const focusDamageAmount = () => {
  damageDialogComponent.value?.focusAmount()
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

  <TokenDamageDialog
    v-if="props.damageDialog"
    ref="damageDialogComponent"
    :dialog="props.damageDialog"
    :db-def="props.damageDialogDbDef"
    :raw-amount="props.damageDialogRawAmount"
    :defense="props.damageDialogDefense"
    :attacker-options="props.damageDialogAttackerOptions"
    :attack-bonus="props.damageDialogAttackBonus"
    :multiplier="props.damageDialogMultiplier"
    :hp-loss="props.damageDialogHpLoss"
    :preview="props.damageDialogPreview"
    :multiplier-tone="props.damageDialogMultiplierTone"
    :multiplier-label="props.damageDialogMultiplierLabel"
    @close="emit('close-damage')"
    @submit="emit('submit-damage')"
  />
</template>

<style src="./tokenActionDialog.css"></style>
