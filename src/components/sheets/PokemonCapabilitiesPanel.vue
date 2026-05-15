<script setup lang="ts">
import { computed } from 'vue'
import { usePokemonCapabilityModels } from '~/composables/sheets/usePokemonCapabilityModels'
import type { CharacterSheet } from '~/types/characterSheet'

const otherCapsCsv = defineModel<string>('otherCapsCsv', { required: true })

const props = defineProps<{
  sheet: CharacterSheet
}>()

const sheetRef = computed(() => props.sheet)
const {
  overland,
  sky,
  swim,
  levitate,
  effectiveLevitate,
  levitateAbilityApplied,
  burrow,
  jump,
  power,
  weight,
  size,
  naturewalk,
} = usePokemonCapabilityModels(sheetRef)
</script>

<template>
  <section class="panel-card">
    <h2 class="panel-title">Capabilities</h2>
    <dl class="caps-grid">
      <div>
        <dt><RefLink kind="capability" name="Overland" /></dt>
        <dd><EditableCell v-model="overland" type="number" :min="0" /></dd>
      </div>
      <div>
        <dt><RefLink kind="capability" name="Sky" /></dt>
        <dd><EditableCell v-model="sky" type="number" :min="0" /></dd>
      </div>
      <div>
        <dt><RefLink kind="capability" name="Swim" /></dt>
        <dd><EditableCell v-model="swim" type="number" :min="0" /></dd>
      </div>
      <div>
        <dt><RefLink kind="capability" name="Levitate" /></dt>
        <dd>
          <EditableCell v-model="levitate" type="number" :min="0" />
          <span
            v-if="levitateAbilityApplied && effectiveLevitate != null"
            class="caps-derived"
            title="Levitate ability grants Levitate 4, or +2 if a Levitate speed already exists."
          >Levitate ability applied</span>
        </dd>
      </div>
      <div>
        <dt><RefLink kind="capability" name="Burrow" /></dt>
        <dd><EditableCell v-model="burrow" type="number" :min="0" /></dd>
      </div>
      <div>
        <dt><RefLink kind="capability" name="Jump" /></dt>
        <dd><EditableCell v-model="jump" placeholder="2/1" /></dd>
      </div>
      <div>
        <dt><RefLink kind="capability" name="Power" /></dt>
        <dd><EditableCell v-model="power" type="number" :min="0" /></dd>
      </div>
      <div>
        <dt>Weight</dt>
        <dd><EditableCell v-model="weight" type="number" :min="0" /></dd>
      </div>
      <div>
        <dt>Size</dt>
        <dd><EditableCell v-model="size" placeholder="Small" /></dd>
      </div>
    </dl>
    <p class="caps-line">
      <strong><RefLink kind="capability" name="Naturewalk" />:</strong>
      <EditableCell v-model="naturewalk" empty-text="" />
    </p>
    <p class="caps-line">
      <strong>Other:</strong>
      <EditableCell v-model="otherCapsCsv" placeholder="Telepath, Aura Reader" />
    </p>
  </section>
</template>

<style scoped>
.panel-title {
  margin: 0 0 0.6rem;
  font-family: var(--font-book);
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ink-bright);
  text-transform: uppercase;
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}

.caps-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 0.4rem;
  margin: 0;
}

.caps-grid > div {
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  padding: 0.4rem 0.55rem;
  background: var(--paper-inset);
}

.caps-grid dt {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-muted);
}

.caps-grid dd {
  margin: 0.15rem 0 0;
  font-weight: 700;
  color: var(--ink-bright);
}

.caps-derived {
  display: block;
  margin-top: 0.12rem;
  font-size: 0.72rem;
  color: var(--accent);
  font-weight: 700;
}

.caps-line {
  margin: 0.55rem 0 0;
  color: var(--ink);
}

.caps-line strong {
  color: var(--ink-bright);
  letter-spacing: 0.02em;
}
</style>
