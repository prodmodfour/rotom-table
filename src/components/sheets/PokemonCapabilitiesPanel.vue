<script setup lang="ts">
import type { CharacterSheet } from '~/types/characterSheet'

const otherCapsCsv = defineModel<string>('otherCapsCsv', { required: true })

defineProps<{
  sheet: CharacterSheet
}>()
</script>

<template>
  <section class="panel-card">
    <h2 class="panel-title">Capabilities</h2>
    <dl class="caps-grid">
      <div>
        <dt>Overland</dt>
        <dd><EditableCell v-model="sheet.capabilities!.overland" type="number" :min="0" /></dd>
      </div>
      <div>
        <dt>Sky</dt>
        <dd><EditableCell v-model="sheet.capabilities!.sky" type="number" :min="0" /></dd>
      </div>
      <div>
        <dt>Swim</dt>
        <dd><EditableCell v-model="sheet.capabilities!.swim" type="number" :min="0" /></dd>
      </div>
      <div>
        <dt>Levitate</dt>
        <dd><EditableCell v-model="sheet.capabilities!.levitate" type="number" :min="0" /></dd>
      </div>
      <div>
        <dt>Burrow</dt>
        <dd><EditableCell v-model="sheet.capabilities!.burrow" type="number" :min="0" /></dd>
      </div>
      <div>
        <dt>Jump</dt>
        <dd><EditableCell v-model="sheet.capabilities!.jump" placeholder="2/1" /></dd>
      </div>
      <div>
        <dt>Power</dt>
        <dd><EditableCell v-model="sheet.capabilities!.power" type="number" :min="0" /></dd>
      </div>
      <div>
        <dt>Weight</dt>
        <dd><EditableCell v-model="sheet.capabilities!.weight" type="number" :min="0" /></dd>
      </div>
      <div>
        <dt>Size</dt>
        <dd><EditableCell v-model="sheet.capabilities!.size" placeholder="Small" /></dd>
      </div>
    </dl>
    <p class="caps-line">
      <strong>Naturewalk:</strong>
      <EditableCell v-model="sheet.capabilities!.naturewalk" placeholder="Forest, Grasslands" />
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

.caps-line {
  margin: 0.55rem 0 0;
  color: var(--ink);
}

.caps-line strong {
  color: var(--ink-bright);
  letter-spacing: 0.02em;
}
</style>
