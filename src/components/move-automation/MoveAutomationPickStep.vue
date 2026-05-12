<script setup lang="ts">
import type { MoveAutomationMoveEntry } from '~/utils/moveAutomationMoves'

const search = defineModel<string>('search', { required: true })

defineProps<{
  entries: MoveAutomationMoveEntry[]
  selectedMoveName: string | null
}>()

const emit = defineEmits<{
  (event: 'select-move', name: string): void
}>()
</script>

<template>
  <div class="move-automation__pick">
    <label class="move-automation__search">
      <span class="sr-only">Search moves</span>
      <input v-model.trim="search" type="search" placeholder="Search this move list…" />
    </label>

    <div class="move-automation__move-list">
      <button
        v-for="entry in entries"
        :key="entry.move.name"
        type="button"
        class="move-card"
        :class="{ 'is-selected': selectedMoveName === entry.move.name }"
        @click="emit('select-move', entry.move.name)"
      >
        <span class="move-card__title">{{ entry.move.name }}</span>
        <span class="move-card__pills">
          <TypeBadge v-if="entry.script.type" :type="entry.script.type" size="xs" />
          <DamageClassBadge v-if="entry.script.damageClass" :category="entry.script.damageClass" size="xs" />
          <span v-if="entry.script.damageBase != null" class="move-card__badge">DB {{ entry.script.damageBase }}</span>
          <span v-if="entry.hasStab" class="move-card__badge move-card__badge--stab">STAB</span>
          <span v-if="entry.script.ac != null" class="move-card__badge">AC {{ entry.script.ac }}</span>
          <span v-if="entry.move.frequency" class="move-card__badge">{{ entry.move.frequency }}</span>
          <span
            class="move-card__badge"
            :class="entry.hasExplicitScript ? 'move-card__badge--explicit' : 'move-card__badge--manual'"
          >{{ entry.hasExplicitScript ? 'Scripted' : 'Manual fallback' }}</span>
        </span>
        <span v-if="entry.script.range" class="move-card__range">{{ entry.script.range }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.move-automation__pick {
  min-height: 0;
  overflow: auto;
  padding: 1rem;
}

.move-automation__search input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.55rem 0.65rem;
  font: inherit;
}

.move-automation__move-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 0.55rem;
  margin-top: 0.8rem;
}

.move-card {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.75rem;
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper);
  color: var(--ink);
  text-align: left;
  cursor: pointer;
}

.move-card.is-selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.16);
}

.move-card__title {
  color: var(--ink-bright);
  font-weight: 900;
}

.move-card__pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  align-items: center;
}

.move-card__badge {
  display: inline-flex;
  align-items: center;
  min-height: 1.35rem;
  padding: 0.12rem 0.45rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-soft);
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 800;
}

.move-card__badge--stab {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--rule-soft));
  color: var(--accent);
}

.move-card__badge--explicit {
  border-color: color-mix(in srgb, #b8bb26 55%, var(--rule-soft));
  color: #b8bb26;
}

.move-card__badge--manual {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--rule-soft));
  color: var(--accent);
}

.move-card__range {
  color: var(--ink-muted);
  font-size: 0.84rem;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
