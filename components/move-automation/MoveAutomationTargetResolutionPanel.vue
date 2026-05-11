<script setup lang="ts">
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { MoveAutomationTargetResolutionState } from '~/utils/moveAutomationTargetResolution'

defineProps<{
  user: SpawnedPokemon
  script: MoveAutomationScript
  targetOptions: SpawnedPokemon[]
  selectedTargets: SpawnedPokemon[]
  targetIds: string[]
  requiresTargets: boolean
  selectedMoveFormula: string | null
  ensureTargetResolution: (id: string) => MoveAutomationTargetResolutionState
  targetDamageLoss: (target: SpawnedPokemon) => number
  multiplierLabel: (target: SpawnedPokemon) => string
}>()

const emit = defineEmits<{
  (event: 'toggle-target', id: string): void
  (event: 'roll-all'): void
  (event: 'roll-accuracy', id: string): void
  (event: 'roll-damage', id: string): void
}>()
</script>

<template>
  <section v-if="requiresTargets" class="move-resolution__section">
    <header class="move-resolution__section-header">
      <h3>Targets</h3>
      <span v-if="script.targetCount">Choose {{ script.targetCount }}</span>
      <span v-else>Choose all affected tokens</span>
    </header>
    <div class="target-grid">
      <button
        v-for="token in targetOptions"
        :key="token.id"
        type="button"
        class="target-chip"
        :class="{ 'is-selected': targetIds.includes(token.id), 'is-user': token.id === user.id }"
        @click="emit('toggle-target', token.id)"
      >
        <strong>{{ token.species }}</strong>
        <span>{{ token.currentHp }}/{{ token.maxHp }} HP</span>
      </button>
    </div>
  </section>

  <section v-if="script.requiresAccuracy || script.damaging" class="move-resolution__section">
    <header class="move-resolution__section-header">
      <h3>Accuracy & damage</h3>
      <button type="button" class="mini-button" @click="emit('roll-all')">Roll all</button>
    </header>
    <p v-if="!selectedTargets.length && requiresTargets" class="move-resolution__hint">Choose targets first.</p>
    <div v-for="target in selectedTargets" :key="target.id" class="target-resolution">
      <header>
        <strong>{{ target.species }}</strong>
        <span>{{ target.currentHp }}/{{ target.maxHp }} HP</span>
      </header>
      <div v-if="script.requiresAccuracy" class="target-resolution__row">
        <label>
          <span>Accuracy d20</span>
          <input v-model="ensureTargetResolution(target.id).accuracyRoll" type="number" min="1" max="20" />
        </label>
        <button type="button" class="mini-button" @click="emit('roll-accuracy', target.id)">Roll</button>
        <label class="inline-check"><input v-model="ensureTargetResolution(target.id).hit" type="checkbox" /> Hit</label>
        <label class="inline-check"><input v-model="ensureTargetResolution(target.id).crit" type="checkbox" /> Crit</label>
      </div>
      <div v-if="script.damaging" class="target-resolution__row">
        <button type="button" class="mini-button" :disabled="!selectedMoveFormula" @click="emit('roll-damage', target.id)">Roll damage</button>
        <span v-if="ensureTargetResolution(target.id).damageRoll" class="roll-readout">
          [{{ ensureTargetResolution(target.id).damageRoll?.rolls.join(', ') }}] + {{ ensureTargetResolution(target.id).damageRoll?.mod }} =
          <strong>{{ ensureTargetResolution(target.id).damageRoll?.total }}</strong>
        </span>
        <label class="inline-check"><input v-model="ensureTargetResolution(target.id).applyDamage" type="checkbox" /> Apply damage</label>
      </div>
      <div v-if="script.damaging" class="target-resolution__row">
        <label>
          <span>Final HP loss override</span>
          <input v-model="ensureTargetResolution(target.id).manualHpLoss" type="number" min="0" placeholder="auto" />
        </label>
        <span class="damage-preview">
          ×{{ multiplierLabel(target) }} → {{ targetDamageLoss(target) }} HP lost
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.move-resolution__section {
  padding: 0.85rem;
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper);
}

.move-resolution__section h3 {
  margin: 0;
}

.move-resolution__section-header,
.target-resolution header {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  align-items: center;
}

.move-resolution__hint {
  color: var(--ink-muted);
  font-size: 0.84rem;
}

.mini-button,
.target-chip {
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper);
}

.mini-button {
  padding: 0.55rem 0.85rem;
  border-radius: 10px;
  color: var(--ink);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
}

.mini-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.target-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-top: 0.6rem;
}

.target-chip {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 9rem;
  padding: 0.55rem 0.65rem;
  color: var(--ink);
  cursor: pointer;
}

.target-chip.is-selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.16);
}

.target-chip.is-user {
  border-style: dashed;
}

.target-resolution {
  display: grid;
  gap: 0.5rem;
  margin-top: 0.55rem;
  padding-top: 0.55rem;
  border-top: 1px solid var(--rule-soft);
}

.target-resolution__row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.target-resolution__row label:not(.inline-check) {
  display: grid;
  gap: 0.15rem;
  min-width: 8rem;
}

.target-resolution__row input[type='number'] {
  width: 100%;
  max-width: 8rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.55rem 0.65rem;
  font: inherit;
}

.inline-check {
  color: var(--ink);
}

.roll-readout,
.damage-preview {
  color: var(--ink-bright);
  font-variant-numeric: tabular-nums;
}
</style>
