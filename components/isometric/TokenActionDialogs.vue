<script setup lang="ts">
import { ref } from 'vue'
import TokenCombatStagesDialog from '~/components/isometric/TokenCombatStagesDialog.vue'
import TokenDamageDialog from '~/components/isometric/TokenDamageDialog.vue'
import TokenHpDialog from '~/components/isometric/TokenHpDialog.vue'
import ConditionPicker from '~/components/ConditionPicker.vue'
import type { DamageBaseDef } from '~/utils/ptuDamage'
import type { SpawnedPokemon } from '~/types/pokemon'
import type {
  CombatStagesDialogState,
  ConditionsDialogState,
} from '~/utils/isometric/tokenStatusDialogs'
import type { HpDialogState } from '~/utils/isometric/tokenHpDialog'
import type {
  DamageDialogMultiplierTone,
  DamageDialogState,
} from '~/utils/isometric/tokenDamageDialog'

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

  <TokenCombatStagesDialog
    v-if="props.combatStagesDialog"
    :dialog="props.combatStagesDialog"
    :changed="props.combatStagesDialogChanged"
    @close="emit('close-combat-stages')"
    @submit="emit('submit-combat-stages')"
  />

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
