<script setup lang="ts">
defineProps<{
  currentHp: number
  maxHp: number
  fullMaxHp: number
  tickValue: number
  hpThresholds: {
    half: number
    third: number
    quarter: number
  }
  damageReduction: number | undefined
  level: number | undefined
  attackTotal: number
  specialAttackTotal: number
  speedTotal: number
  initiative: number
}>()

const emit = defineEmits<{
  setCurrentHp: [value: unknown]
  updateDamageReduction: [value: number | undefined]
  updateLevel: [value: number | undefined]
}>()
</script>

<template>
  <div class="combat-strip">
    <div class="combat-cell">
      <span>Current HP</span>
      <strong>
        <EditableCell
          :model-value="currentHp"
          type="number"
          :max="maxHp"
          @update:model-value="emit('setCurrentHp', $event)"
        />
      </strong>
    </div>
    <div
      class="combat-cell"
      title="Formula Max HP = Level × 2 + (HP × 3) + 10. Injuries reduce the effective Max HP by 1/10 each."
    >
      <span>Max HP</span>
      <strong>{{ maxHp }}<small v-if="maxHp !== fullMaxHp">full {{ fullMaxHp }}</small></strong>
    </div>
    <div class="combat-cell" title="A Tick is 1/10th of full maximum Hit Points, rounded down.">
      <span>Tick</span><strong>{{ tickValue }}</strong>
    </div>
    <div class="combat-cell" title="Fractional HP values use full Max HP before the injury cap.">
      <span>½ HP</span><strong>{{ hpThresholds.half }}</strong>
    </div>
    <div class="combat-cell" title="Fractional HP values use full Max HP before the injury cap.">
      <span>⅓ HP</span><strong>{{ hpThresholds.third }}</strong>
    </div>
    <div class="combat-cell" title="Fractional HP values use full Max HP before the injury cap.">
      <span>¼ HP</span><strong>{{ hpThresholds.quarter }}</strong>
    </div>
    <div class="combat-cell">
      <span>DR</span>
      <strong>
        <EditableCell
          :model-value="damageReduction"
          type="number"
          :min="0"
          @update:model-value="emit('updateDamageReduction', $event as number | undefined)"
        />
      </strong>
    </div>
    <div class="combat-cell">
      <span>Lv</span>
      <strong>
        <EditableCell
          :model-value="level"
          type="number"
          :min="1"
          @update:model-value="emit('updateLevel', $event as number | undefined)"
        />
      </strong>
    </div>
    <div class="combat-cell"><span>CS Atk</span><strong>{{ attackTotal }}</strong></div>
    <div class="combat-cell"><span>CS SAtk</span><strong>{{ specialAttackTotal }}</strong></div>
    <div class="combat-cell" title="Initiative is Speed adjusted by conditions such as Paralysis and Flinch.">
      <span>Initiative</span>
      <strong>{{ initiative }}<small v-if="initiative !== speedTotal">Speed {{ speedTotal }}</small></strong>
    </div>
  </div>
</template>

<style scoped>
.combat-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 0.4rem;
}

.combat-cell {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.45rem 0.5rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper-inset);
  text-align: center;
}

.combat-cell span {
  font-size: 0.68rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.combat-cell strong {
  font-size: 1.15rem;
  color: var(--ink-bright);
  font-variant-numeric: tabular-nums;
  font-family: var(--font-book);
}

.combat-cell small {
  display: block;
  margin-top: 0.08rem;
  color: var(--ink-muted);
  font-family: var(--font-ui);
  font-size: 0.68rem;
  font-weight: 400;
  letter-spacing: 0.04em;
}
</style>
