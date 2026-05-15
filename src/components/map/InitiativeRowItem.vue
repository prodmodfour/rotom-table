<script setup lang="ts">
import { computed } from 'vue'
import InitiativeScoreEditor from '~/components/map/InitiativeScoreEditor.vue'
import InitiativeTokenSprite from '~/components/map/InitiativeTokenSprite.vue'
import InitiativeVitals from '~/components/map/InitiativeVitals.vue'
import type { InitiativeRow } from '~/composables/map-editor/useInitiativeTracker'

const props = defineProps<{
  entry: InitiativeRow
  index: number
  activeId: string | null
  selectedId: string | null
  canManage: boolean
}>()

const emit = defineEmits<{
  (event: 'set-active-and-focus', id: string): void
  (event: 'focus', id: string): void
  (event: 'set-initiative-input', id: string, value: Event): void
  (event: 'set-initiative-from-speed', id: string, speed: number): void
}>()

const isActive = computed(() => props.activeId === props.entry.id)
const isSelected = computed(() => props.selectedId === props.entry.id)
const isFainted = computed(() => props.entry.currentHp <= 0)
</script>

<template>
  <li
    class="initiative-row"
    :class="{
      'is-active': isActive,
      'is-selected': isSelected,
      'is-fainted': isFainted,
    }"
  >
    <button
      type="button"
      class="initiative-row__turn"
      :class="{ 'is-active': isActive }"
      :aria-pressed="isActive"
      :aria-label="`Set ${entry.name} as the current turn`"
      :disabled="!canManage"
      @click="emit('set-active-and-focus', entry.id)"
    >
      <InitiativeTokenSprite :entry="entry" />
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
        <span class="initiative-row__meta">
          {{ entry.meta }} · SPD {{ entry.speed }}
          <template v-if="entry.initiativeScore !== entry.speed"> · Init {{ entry.initiativeScore }}</template>
        </span>
      </span>
      <InitiativeVitals :entry="entry" />
    </button>

    <InitiativeScoreEditor
      :entry="entry"
      :can-manage="canManage"
      @set-initiative-input="(id, value) => emit('set-initiative-input', id, value)"
      @set-initiative-from-speed="(id, speed) => emit('set-initiative-from-speed', id, speed)"
    />
  </li>
</template>

<style scoped>
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
  .initiative-row {
    grid-template-columns: 38px minmax(0, 1fr) 70px;
  }
}
</style>
