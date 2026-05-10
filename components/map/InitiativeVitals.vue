<script setup lang="ts">
import ConditionTag from '~/components/ConditionTag.vue'
import {
  hpPercent,
  hpTier,
  type InitiativeRow,
} from '~/composables/map-editor/useInitiativeTracker'

defineProps<{
  entry: InitiativeRow
}>()
</script>

<template>
  <span class="initiative-row__hp" :data-hp-tier="hpTier(entry)">
    <span>{{ entry.currentHp }}/{{ entry.maxHp }} HP</span>
    <span class="initiative-row__hp-track" :data-hp-tier="hpTier(entry)" aria-hidden="true">
      <span :style="{ width: hpPercent(entry) }" />
    </span>
  </span>
  <span v-if="entry.conditions.length" class="initiative-row__conditions" aria-label="Conditions">
    <ConditionTag
      v-for="condition in entry.conditions"
      :key="condition"
      :name="condition"
      size="xs"
    />
  </span>
</template>

<style scoped>
.initiative-row__hp {
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
  color: var(--good);
  font-size: 0.74rem;
}

.initiative-row__hp[data-hp-tier='wounded'] {
  color: var(--warn);
}

.initiative-row__hp[data-hp-tier='critical'] {
  color: var(--bad);
}

.initiative-row__hp-track {
  display: block;
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--paper-inset);
}

.initiative-row__hp-track > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--good);
}

.initiative-row__hp-track[data-hp-tier='wounded'] > span {
  background: var(--warn);
}

.initiative-row__hp-track[data-hp-tier='critical'] > span,
:global(.initiative-row.is-fainted) .initiative-row__hp-track > span {
  background: var(--bad);
}

.initiative-row__conditions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem;
}
</style>
