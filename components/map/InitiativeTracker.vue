<script setup lang="ts">
import ConditionTag from '~/components/ConditionTag.vue'
import {
  hpPercent,
  hpTier,
  initiativeSpriteFrameStyle,
  type InitiativeRow,
} from '~/composables/map-editor/useInitiativeTracker'

defineProps<{
  rows: InitiativeRow[]
  sortedRows: InitiativeRow[]
  activeId: string | null
  round: number
  selectedId: string | null
  canManage: boolean
  hasInitiativeValues: boolean
}>()

const emit = defineEmits<{
  (event: 'set-round', value: Event): void
  (event: 'previous'): void
  (event: 'next'): void
  (event: 'fill-from-speed'): void
  (event: 'clear-active'): void
  (event: 'clear-values'): void
  (event: 'set-active-and-focus', id: string): void
  (event: 'focus', id: string): void
  (event: 'set-initiative-input', id: string, value: Event): void
  (event: 'set-initiative-from-speed', id: string, speed: number): void
}>()
</script>

<template>
  <section class="panel-card initiative-panel">
    <div class="panel-heading initiative-heading">
      <div class="initiative-title-block">
        <h2>Initiative</h2>
        <label class="round-field">
          <span>Round</span>
          <input
            type="number"
            min="1"
            :value="round"
            aria-label="Initiative round"
            :disabled="!canManage"
            @input="emit('set-round', $event)"
          />
        </label>
      </div>
      <span class="badge">
        {{ rows.length }} character{{ rows.length === 1 ? '' : 's' }}
      </span>
    </div>

    <div class="initiative-actions" role="group" aria-label="Turn controls">
      <button
        type="button"
        class="initiative-action"
        :disabled="!rows.length || !canManage"
        @click="emit('previous')"
      >
        Previous
      </button>
      <button
        type="button"
        class="initiative-action initiative-action--primary"
        :disabled="!rows.length || !canManage"
        @click="emit('next')"
      >
        {{ activeId ? 'Next turn' : 'Start' }}
      </button>
    </div>

    <div class="initiative-tools" role="group" aria-label="Initiative utilities">
      <button
        type="button"
        class="initiative-tool"
        :disabled="!rows.length || !canManage"
        @click="emit('fill-from-speed')"
      >
        Use All Speed
      </button>
      <button
        type="button"
        class="initiative-tool"
        :disabled="!activeId || !canManage"
        @click="emit('clear-active')"
      >
        Clear turn
      </button>
      <button
        type="button"
        class="initiative-tool initiative-tool--danger"
        :disabled="(!hasInitiativeValues && !activeId) || !canManage"
        @click="emit('clear-values')"
      >
        Reset
      </button>
    </div>

    <ol v-if="sortedRows.length" class="initiative-list">
      <li
        v-for="(entry, index) in sortedRows"
        :key="entry.id"
        class="initiative-row"
        :class="{
          'is-active': activeId === entry.id,
          'is-selected': selectedId === entry.id,
          'is-fainted': entry.currentHp <= 0,
        }"
      >
        <button
          type="button"
          class="initiative-row__turn"
          :class="{ 'is-active': activeId === entry.id }"
          :aria-pressed="activeId === entry.id"
          :aria-label="`Set ${entry.name} as the current turn`"
          :disabled="!canManage"
          @click="emit('set-active-and-focus', entry.id)"
        >
          <span class="initiative-row__sprite" aria-hidden="true">
            <span
              v-if="entry.sprite.isSpriteSheet && entry.sprite.url"
              class="initiative-row__sprite-frame"
              :style="initiativeSpriteFrameStyle(entry)"
            />
            <img
              v-else-if="entry.sprite.url"
              :src="entry.sprite.url"
              alt=""
              draggable="false"
            />
            <span v-else class="initiative-row__sprite-fallback">
              {{ entry.name.slice(0, 1) }}
            </span>
          </span>
          <span class="sr-only">Turn order {{ index + 1 }}</span>
        </button>

        <button
          type="button"
          class="initiative-row__body"
          :aria-label="`Center camera on ${entry.name}`"
          :title="`Center camera on ${entry.name}`"
          @click="emit('focus', entry.id)"
        >
          <span class="initiative-row__main">
            <span class="initiative-row__name">{{ entry.name }}</span>
            <span class="initiative-row__meta">{{ entry.meta }} · SPD {{ entry.speed }}</span>
          </span>
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
        </button>

        <div class="initiative-row__score">
          <label>
            <span>Init</span>
            <input
              type="number"
              inputmode="numeric"
              :value="entry.initiative ?? ''"
              placeholder="—"
              :aria-label="`${entry.name} initiative`"
              :disabled="!canManage"
              @input="emit('set-initiative-input', entry.id, $event)"
            />
          </label>
          <button
            type="button"
            class="initiative-row__speed-button"
            :title="`Set initiative to Speed (${entry.speed})`"
            :aria-label="`Use ${entry.name}'s Speed (${entry.speed}) for initiative`"
            :disabled="!canManage"
            @click="emit('set-initiative-from-speed', entry.id, entry.speed)"
          >
            Use Speed
          </button>
        </div>
      </li>
    </ol>

    <p v-else class="initiative-empty">
      Spawn Pokémon or trainers onto the map to track turn order.
    </p>
  </section>
</template>

<style scoped>
.panel-card {
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 0.95rem;
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.85rem;
}

.panel-heading h2 {
  margin: 0;
  font-family: var(--font-book);
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-bright);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.22rem 0.65rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.74rem;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.65rem 0.8rem;
  outline: none;
}

input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

input:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.initiative-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.initiative-heading {
  align-items: flex-start;
  margin-bottom: 0;
}

.initiative-title-block {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.55rem;
}

.round-field {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  color: var(--ink-muted);
  font-size: 0.76rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.round-field input {
  width: 72px;
  padding: 0.42rem 0.55rem;
  text-align: center;
}

.initiative-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.45rem;
}

.initiative-tools {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.4rem;
}

.initiative-action,
.initiative-tool {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.5rem 0.65rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.initiative-action:hover:not(:disabled),
.initiative-tool:hover:not(:disabled) {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.initiative-action:disabled,
.initiative-tool:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.initiative-action--primary {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.initiative-tool--danger {
  color: #fb4934;
}

.initiative-tool--danger:hover:not(:disabled) {
  border-color: #fb4934;
  background: rgba(251, 73, 52, 0.08);
}

.initiative-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.initiative-row {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) 78px;
  align-items: stretch;
  gap: 0.5rem;
  border: 1px solid var(--rule-soft);
  border-radius: 13px;
  background: var(--paper);
  padding: 0.5rem;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}

.initiative-row.is-active {
  border-color: var(--accent);
  background: linear-gradient(135deg, rgba(250, 189, 47, 0.15), rgba(40, 40, 40, 0.92));
  box-shadow: 0 0 0 1px rgba(250, 189, 47, 0.15);
}

.initiative-row.is-selected:not(.is-active) {
  border-color: var(--info);
}

.initiative-row.is-fainted {
  opacity: 0.66;
}

.initiative-row__turn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  overflow: hidden;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper-soft);
  color: var(--ink-soft);
  cursor: pointer;
  font: inherit;
  font-weight: 800;
  padding: 0;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.initiative-row__turn:hover,
.initiative-row__turn:focus-visible {
  border-color: var(--accent);
  color: var(--accent);
  outline: none;
}

.initiative-row__turn.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.initiative-row__sprite {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  min-height: 40px;
  overflow: hidden;
  border-radius: 8px;
}

.initiative-row__sprite-frame {
  display: block;
  flex: 0 0 auto;
  background-position: left top;
  background-repeat: no-repeat;
  image-rendering: pixelated;
  transform-origin: center;
}

.initiative-row__sprite img {
  display: block;
  max-width: 34px;
  max-height: 34px;
  object-fit: contain;
  image-rendering: pixelated;
}

.initiative-row__sprite-fallback {
  color: var(--ink-bright);
  font-weight: 800;
  text-transform: uppercase;
}

.initiative-row__body {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  gap: 0.35rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 0;
  text-align: left;
}

.initiative-row__body:hover .initiative-row__name,
.initiative-row__body:focus-visible .initiative-row__name {
  color: var(--accent);
}

.initiative-row__body:focus-visible {
  outline: 2px solid rgba(250, 189, 47, 0.35);
  outline-offset: 3px;
}

.initiative-row__main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.15rem;
}

.initiative-row__name {
  overflow: hidden;
  color: var(--ink-bright);
  font-weight: 800;
  letter-spacing: 0.02em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.initiative-row__meta {
  overflow: hidden;
  color: var(--ink-muted);
  font-size: 0.74rem;
  letter-spacing: 0.03em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

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
.initiative-row.is-fainted .initiative-row__hp-track > span {
  background: var(--bad);
}

.initiative-row__conditions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem;
}

.initiative-row__score {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.28rem;
  min-width: 0;
}

.initiative-row__score label {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  min-width: 0;
}

.initiative-row__score span {
  color: var(--ink-muted);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-align: center;
  text-transform: uppercase;
}

.initiative-row__score input {
  padding: 0.45rem 0.25rem;
  text-align: center;
}

.initiative-row__speed-button {
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper-soft);
  color: var(--ink-soft);
  padding: 0.28rem 0.25rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  line-height: 1;
  white-space: nowrap;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.initiative-row__speed-button:hover,
.initiative-row__speed-button:focus-visible {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  outline: none;
}

.initiative-empty {
  margin: 0;
  border: 1px dashed var(--rule-soft);
  border-radius: 12px;
  padding: 1rem;
  color: var(--ink-muted);
  font-size: 0.86rem;
  line-height: 1.45;
  text-align: center;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 640px) {
  .initiative-tools,
  .initiative-actions {
    grid-template-columns: 1fr;
  }

  .initiative-row {
    grid-template-columns: 38px minmax(0, 1fr) 70px;
  }
}
</style>
