<script setup lang="ts">
import { computed } from 'vue'
import MovementCapabilityAdjustment from '~/components/sheets/MovementCapabilityAdjustment.vue'
import MovementCapabilityEditableCell from '~/components/sheets/MovementCapabilityEditableCell.vue'
import OtherMovementCapabilityAdjustments from '~/components/sheets/OtherMovementCapabilityAdjustments.vue'
import { useTrainerCapabilityModels } from '~/composables/sheets/useTrainerCapabilityModels'
import { conditionAdjustedCombatStage } from '~/utils/sheetConditionEffects'
import { mergeLegacyConditions } from '~/utils/statusConditions'
import type { TrainerSheet } from '~/types/trainerSheet'

const otherCapsCsv = defineModel<string>('otherCapsCsv', { required: true })

const props = defineProps<{
  sheet: TrainerSheet
}>()

const sheetRef = computed(() => props.sheet)
const combatConditions = computed(() => mergeLegacyConditions(
  props.sheet.conditions,
  props.sheet.statusAfflictions,
))
const speedCombatStage = computed(() => conditionAdjustedCombatStage(
  props.sheet.stats?.spd?.stage ?? props.sheet.combatStages?.spd,
  combatConditions.value,
  'spd',
  { abilities: props.sheet.abilities },
))
const {
  overland,
  throwingRange,
  highJump,
  longJump,
  swim,
  power,
  sky,
  levitate,
  burrow,
} = useTrainerCapabilityModels(sheetRef)
</script>

<template>
  <div class="block">
    <h2 class="block-title">Capabilities</h2>
    <ul class="cap-grid">
      <li>
        <span class="cap-label"><RefLink kind="capability" name="Overland" /></span>
        <span class="cap-value">
          <MovementCapabilityEditableCell
            v-model="overland"
            name="Overland"
            :conditions="combatConditions"
            :speed-combat-stage="speedCombatStage"
          />
          <MovementCapabilityAdjustment
            name="Overland"
            :value="overland"
            :conditions="combatConditions"
            :speed-combat-stage="speedCombatStage"
          />
        </span>
      </li>
      <li>
        <span class="cap-label"><RefLink kind="capability" name="Throwing Range" display="Throw Range" /></span>
        <span class="cap-value">
          <EditableCell v-model="throwingRange" type="number" :min="0" />
        </span>
      </li>
      <li>
        <span class="cap-label"><RefLink kind="capability" name="High Jump" /></span>
        <span class="cap-value">
          <EditableCell v-model="highJump" type="number" :min="0" />
        </span>
      </li>
      <li>
        <span class="cap-label"><RefLink kind="capability" name="Long Jump" /></span>
        <span class="cap-value">
          <EditableCell v-model="longJump" type="number" :min="0" />
        </span>
      </li>
      <li>
        <span class="cap-label"><RefLink kind="capability" name="Swim" /></span>
        <span class="cap-value">
          <MovementCapabilityEditableCell
            v-model="swim"
            name="Swim"
            :conditions="combatConditions"
            :speed-combat-stage="speedCombatStage"
          />
          <MovementCapabilityAdjustment
            name="Swim"
            :value="swim"
            :conditions="combatConditions"
            :speed-combat-stage="speedCombatStage"
          />
        </span>
      </li>
      <li>
        <span class="cap-label"><RefLink kind="capability" name="Power" /></span>
        <span class="cap-value">
          <EditableCell v-model="power" type="number" :min="0" />
        </span>
      </li>
      <li>
        <span class="cap-label"><RefLink kind="capability" name="Sky" /></span>
        <span class="cap-value">
          <MovementCapabilityEditableCell
            v-model="sky"
            name="Sky"
            :conditions="combatConditions"
            :speed-combat-stage="speedCombatStage"
          />
          <MovementCapabilityAdjustment
            name="Sky"
            :value="sky"
            :conditions="combatConditions"
            :speed-combat-stage="speedCombatStage"
          />
        </span>
      </li>
      <li>
        <span class="cap-label"><RefLink kind="capability" name="Levitate" /></span>
        <span class="cap-value">
          <MovementCapabilityEditableCell
            v-model="levitate"
            name="Levitate"
            :conditions="combatConditions"
            :speed-combat-stage="speedCombatStage"
          />
          <MovementCapabilityAdjustment
            name="Levitate"
            :value="levitate"
            :conditions="combatConditions"
            :speed-combat-stage="speedCombatStage"
          />
        </span>
      </li>
      <li>
        <span class="cap-label"><RefLink kind="capability" name="Burrow" /></span>
        <span class="cap-value">
          <MovementCapabilityEditableCell
            v-model="burrow"
            name="Burrow"
            :conditions="combatConditions"
            :speed-combat-stage="speedCombatStage"
          />
          <MovementCapabilityAdjustment
            name="Burrow"
            :value="burrow"
            :conditions="combatConditions"
            :speed-combat-stage="speedCombatStage"
          />
        </span>
      </li>
    </ul>
    <p class="muted-help capabilities-help">
      <strong>Other capabilities:</strong>
      <EditableCell v-model="otherCapsCsv" placeholder="Telepath, Aura Reader" />
      <OtherMovementCapabilityAdjustments
        :capabilities-text="otherCapsCsv"
        :conditions="combatConditions"
        :speed-combat-stage="speedCombatStage"
      />
    </p>
  </div>
</template>

<style scoped>
.block {
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
  padding: 0.7rem 0.85rem;
}

.block-title {
  margin: 0 0 0.5rem;
  font-family: var(--font-book);
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-bright);
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}

.muted-help { color: var(--ink-muted); font-size: 0.78rem; margin: 0 0 0.4rem; }

.cap-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.35rem;
}

.cap-grid li {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0.3rem 0.55rem;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper-inset);
}

.cap-label { color: var(--ink-soft); font-size: 0.82rem; }
.cap-value { color: var(--ink-bright); font-weight: 700; font-size: 0.92rem; font-variant-numeric: tabular-nums; }

.capabilities-help { margin-top: 0.6rem; }
</style>
