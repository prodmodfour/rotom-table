<script setup lang="ts">
import ConditionTag from '~/components/ConditionTag.vue'
import {
  hasHpBlocked,
  hpBlockedPercent,
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
      <span class="initiative-row__hp-fill" :style="{ width: hpPercent(entry) }" />
      <span
        v-if="hasHpBlocked(entry)"
        class="initiative-row__hp-blocked hp-bar__blocked"
        :style="{ width: hpBlockedPercent(entry) }"
      />
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
  color: var(--map-hp-healthy);
  font-size: 0.74rem;
}

.initiative-row__hp[data-hp-tier='wounded'] {
  color: var(--map-hp-wounded);
}

.initiative-row__hp[data-hp-tier='critical'] {
  color: var(--map-hp-critical);
}

.initiative-row__hp-track {
  position: relative;
  display: block;
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--paper-inset);
}

.initiative-row__hp-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--map-hp-healthy);
}

.initiative-row__hp-track[data-hp-tier='wounded'] .initiative-row__hp-fill {
  background: var(--map-hp-wounded);
}

.initiative-row__hp-track[data-hp-tier='critical'] .initiative-row__hp-fill,
:global(.initiative-row.is-fainted) .initiative-row__hp-fill {
  background: var(--map-hp-critical);
}

.initiative-row__conditions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem;
}
</style>
