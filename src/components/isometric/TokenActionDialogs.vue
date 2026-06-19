<script setup lang="ts">
import { computed, ref } from 'vue'
import TokenCombatStagesDialog from '~/components/isometric/TokenCombatStagesDialog.vue'
import TokenConditionsDialog from '~/components/isometric/TokenConditionsDialog.vue'
import TokenDamageDialog from '~/components/isometric/TokenDamageDialog.vue'
import TokenExperienceDialog from '~/components/isometric/TokenExperienceDialog.vue'
import TokenHpDialog from '~/components/isometric/TokenHpDialog.vue'
import type { DamageBaseDef } from '~/utils/ptuDamage'
import type { SpawnedPokemon } from '~/types/pokemon'
import type {
  CombatStagesDialogState,
  ConditionsDialogState,
} from '~/utils/isometric/tokenStatusDialogs'
import type { HpDialogState } from '~/utils/isometric/tokenHpDialog'
import type { PtuInjuryAutomationResult } from '~/utils/ptuInjuries'
import type {
  DamageDialogMultiplierTone,
  DamageDialogState,
} from '~/utils/isometric/tokenDamageDialog'
import type { ExperienceDialogState } from '~/utils/isometric/tokenExperienceDialog'
import { trainerAccentCssVariables } from '~/utils/trainerAccent'

type DamageDialogAttackerOption = Pick<SpawnedPokemon, 'id' | 'species' | 'atk' | 'satk'>

const props = defineProps<{
  hpDialog: HpDialogState | null
  hpDialogDelta: number
  hpDialogPreview: number
  hpDialogPreviewMaxHp: number
  hpDialogInjuryResult: PtuInjuryAutomationResult | null
  combatStagesDialog: CombatStagesDialogState | null
  combatStagesDialogChanged: boolean
  conditionsDialog: ConditionsDialogState | null
  conditionsDialogChanged: boolean
  conditionMoveOptions?: string[]
  conditionCrushOptions?: string[]
  experienceDialog: ExperienceDialogState | null
  experienceDialogAmount: number
  experienceDialogPreviewTotalExp: number
  experienceDialogPreviewLevel: number
  damageDialog: DamageDialogState | null
  damageDialogDbDef: DamageBaseDef | null
  damageDialogRawAmount: number
  damageDialogDefense: number
  damageDialogAttackerOptions: DamageDialogAttackerOption[]
  damageDialogAttackBonus: number
  damageDialogMultiplier: number
  damageDialogHpLoss: number
  damageDialogPreview: number
  damageDialogPreviewMaxHp: number
  damageDialogInjuryResult: PtuInjuryAutomationResult | null
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
  (event: 'close-experience'): void
  (event: 'submit-experience'): void
  (event: 'close-damage'): void
  (event: 'submit-damage'): void
}>()

const hpDialogComponent = ref<{ focusAmount: () => void } | null>(null)
const experienceDialogComponent = ref<{ focusAmount: () => void } | null>(null)
const damageDialogComponent = ref<{ focusAmount: () => void } | null>(null)

const focusHpAmount = () => {
  hpDialogComponent.value?.focusAmount()
}

const focusDamageAmount = () => {
  damageDialogComponent.value?.focusAmount()
}

const focusExperienceAmount = () => {
  experienceDialogComponent.value?.focusAmount()
}

const activeAccentColor = computed(() => (
  props.hpDialog?.accentColor ??
  props.combatStagesDialog?.accentColor ??
  props.conditionsDialog?.accentColor ??
  props.experienceDialog?.accentColor ??
  props.damageDialog?.accentColor ??
  null
))
const actionDialogStyle = computed(() => activeAccentColor.value ? trainerAccentCssVariables(activeAccentColor.value) : undefined)

defineExpose({ focusHpAmount, focusDamageAmount, focusExperienceAmount })
</script>

<template>
  <div class="token-action-dialog-scope" :style="actionDialogStyle">
    <TokenHpDialog
      v-if="props.hpDialog"
      ref="hpDialogComponent"
      :dialog="props.hpDialog"
      :delta="props.hpDialogDelta"
      :preview="props.hpDialogPreview"
      :preview-max-hp="props.hpDialogPreviewMaxHp"
      :injury-result="props.hpDialogInjuryResult"
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

    <TokenConditionsDialog
      v-if="props.conditionsDialog"
      :dialog="props.conditionsDialog"
      :changed="props.conditionsDialogChanged"
      :available-moves="props.conditionMoveOptions ?? []"
      :available-crushes="props.conditionCrushOptions ?? []"
      @close="emit('close-conditions')"
      @submit="emit('submit-conditions')"
    />

    <TokenExperienceDialog
      v-if="props.experienceDialog"
      ref="experienceDialogComponent"
      :dialog="props.experienceDialog"
      :amount="props.experienceDialogAmount"
      :preview-total-exp="props.experienceDialogPreviewTotalExp"
      :preview-level="props.experienceDialogPreviewLevel"
      @close="emit('close-experience')"
      @submit="emit('submit-experience')"
    />

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
      :preview-max-hp="props.damageDialogPreviewMaxHp"
      :injury-result="props.damageDialogInjuryResult"
      :multiplier-tone="props.damageDialogMultiplierTone"
      :multiplier-label="props.damageDialogMultiplierLabel"
      @close="emit('close-damage')"
      @submit="emit('submit-damage')"
    />
  </div>
</template>

<style src="./tokenActionDialog.css"></style>
