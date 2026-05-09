<script setup lang="ts">
import { PhPlus, PhX } from '@phosphor-icons/vue'
import type { TrainerAdvancementRow, TrainerSheet } from '~/types/trainerSheet'

const currentTeamCsv = defineModel<string>('currentTeamCsv', { required: true })
const wishlistCsv = defineModel<string>('wishlistCsv', { required: true })

defineProps<{
  sheet: TrainerSheet
  advancementRows: readonly TrainerAdvancementRow[]
}>()

const emit = defineEmits<{
  addClass: []
  removeClass: [index: number]
  setAdvancement: [level: number, field: keyof TrainerAdvancementRow, value: number | string | undefined]
}>()
</script>

<template>
  <div class="trainer-progress-panel">
    <div class="block">
      <h2 class="block-title">
        Trainer Classes
        <button type="button" class="row-add" @click="emit('addClass')">
          <PhPlus :size="14" weight="bold" /> Add row
        </button>
      </h2>
      <ul class="ref-list-vertical">
        <li v-for="(cls, i) in sheet.classes" :key="i" class="cls-row">
          <EditableCell v-model="cls.name" placeholder="Class name" />
          <span v-if="cls.specialisation || cls.name" class="cls-spec">
            (<EditableCell v-model="cls.specialisation" placeholder="—" />)
          </span>
          <span class="cls-notes">
            — <EditableCell v-model="cls.notes" placeholder="notes" />
          </span>
          <button type="button" class="row-remove" title="Remove class" @click="emit('removeClass', i)">
            <PhX :size="14" weight="bold" />
          </button>
        </li>
        <li v-if="!sheet.classes?.length" class="muted">No classes yet.</li>
      </ul>
    </div>

    <div class="block">
      <h2 class="block-title">Training Feature</h2>
      <p>
        <EditableCell v-model="sheet.trainingFeature" placeholder="Inspired Training" />
      </p>
    </div>

    <div class="block">
      <h2 class="block-title">Trainer Advancement</h2>
      <table class="data-table adv-table">
        <thead>
          <tr><th>Level</th><th>Stats</th><th>Att</th><th>Sp.Att</th><th>Notes</th></tr>
        </thead>
        <tbody>
          <tr v-for="row in advancementRows" :key="row.level">
            <th>Lv {{ row.level }}</th>
            <td>
              <EditableCell
                :model-value="row.stats"
                type="number"
                :min="0"
                @update:model-value="(v) => emit('setAdvancement', row.level, 'stats', v as number)"
              />
            </td>
            <td>
              <EditableCell
                :model-value="row.attack"
                type="number"
                :min="0"
                @update:model-value="(v) => emit('setAdvancement', row.level, 'attack', v as number)"
              />
            </td>
            <td>
              <EditableCell
                :model-value="row.spAttack"
                type="number"
                :min="0"
                @update:model-value="(v) => emit('setAdvancement', row.level, 'spAttack', v as number)"
              />
            </td>
            <td class="notes-col">
              <EditableCell
                :model-value="row.notes"
                placeholder="—"
                @update:model-value="(v) => emit('setAdvancement', row.level, 'notes', v as string)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="grid-two">
      <div class="block">
        <h2 class="block-title">Current Team</h2>
        <p class="muted-help">Comma-separated Pokémon sheet slugs (e.g. <code>specs-chikorita</code>).</p>
        <EditableCell v-model="currentTeamCsv" placeholder="specs-chikorita" />
        <ul v-if="sheet.currentTeam?.length" class="ref-list-vertical team-list">
          <li v-for="memberSlug in sheet.currentTeam" :key="memberSlug">
            <NuxtLink :to="`/sheets/${memberSlug}`">{{ memberSlug }}</NuxtLink>
          </li>
        </ul>
      </div>
      <div class="block">
        <h2 class="block-title">Pokémon Wishlist</h2>
        <p class="muted-help">Comma-separated species names.</p>
        <EditableCell v-model="wishlistCsv" placeholder="Cherubi, Bounsweet" />
      </div>
    </div>

    <div class="narrative-grid">
      <div class="narrative narrative--red">
        <h3>Physical Description</h3>
        <p>
          <EditableCell
            v-model="sheet.physicalDescription"
            type="textarea"
            placeholder="Physical description"
            multiline
          />
        </p>
      </div>
      <div class="narrative narrative--yellow">
        <h3>Background</h3>
        <p>
          <EditableCell
            v-model="sheet.background"
            type="textarea"
            placeholder="Background"
            multiline
          />
        </p>
      </div>
      <div class="narrative narrative--purple">
        <h3>Personality</h3>
        <p>
          <EditableCell
            v-model="sheet.personality"
            type="textarea"
            placeholder="Personality"
            multiline
          />
        </p>
      </div>
      <div class="narrative narrative--green">
        <h3>Goals / Dreams / Obsessions</h3>
        <p>
          <EditableCell
            v-model="sheet.goalsAndDreams"
            type="textarea"
            placeholder="Goals & dreams"
            multiline
          />
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.trainer-progress-panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.grid-two {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 0.85rem;
}

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

.muted { color: var(--ink-muted); font-size: 0.85rem; }
.muted-help { color: var(--ink-muted); font-size: 0.78rem; margin: 0 0 0.4rem; }
.notes-col { color: var(--ink-muted); }

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}

.data-table th,
.data-table td {
  padding: 0.35rem 0.5rem;
  text-align: left;
  border-bottom: 1px solid var(--rule);
  vertical-align: top;
}

.data-table th {
  font-weight: 600;
  color: var(--ink-bright);
}

.data-table thead th {
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-muted);
  background: transparent;
  font-weight: 600;
}

.row-add {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border: 1px solid var(--rule-soft);
  border-radius: 6px;
  background: var(--paper);
  color: var(--ink-soft);
  padding: 0.2rem 0.45rem;
  font: inherit;
  font-size: 0.74rem;
  letter-spacing: 0.04em;
  cursor: pointer;
  text-transform: none;
}

.row-add:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.row-remove {
  display: inline-flex;
  align-items: center;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--ink-soft);
  padding: 0.2rem;
  font: inherit;
  cursor: pointer;
  margin-left: 0.4rem;
}

.row-remove:hover {
  color: #d36464;
  border-color: rgba(220, 80, 80, 0.45);
  background: rgba(220, 80, 80, 0.08);
}

.ref-list-vertical {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.32rem;
}

.team-list { margin-top: 0.55rem; }

.cls-row { display: inline-flex; align-items: baseline; gap: 0.35rem; flex-wrap: wrap; }
.cls-spec  { color: var(--accent); font-style: italic; }
.cls-notes { color: var(--ink-soft); }

.narrative-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 0.6rem;
}

.narrative {
  border-radius: 10px;
  padding: 0.7rem 0.85rem 0.7rem 1rem;
  border: 1px solid var(--rule-soft);
  border-left: 3px solid var(--rule-strong);
  background: var(--paper-inset);
}

.narrative h3 {
  margin: 0 0 0.35rem;
  font-family: var(--font-book);
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-bright);
}

.narrative p {
  margin: 0;
  line-height: 1.55;
  color: var(--ink);
  font-family: var(--font-book);
  font-size: 0.95rem;
}

.narrative--red    { border-left-color: var(--bad); }
.narrative--red h3 { color: var(--bad); }

.narrative--yellow { border-left-color: var(--accent); }
.narrative--yellow h3 { color: var(--accent); }

.narrative--purple { border-left-color: var(--magic); }
.narrative--purple h3 { color: var(--magic); }

.narrative--green  { border-left-color: var(--good); }
.narrative--green h3 { color: var(--good); }
</style>
