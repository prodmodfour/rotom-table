<script setup lang="ts">
import { formatNationalDexNumber } from '~/utils/pokedex/searchText'
import { pokedexEntryPath, type DisplayPokedexEntry } from '~/utils/pokedex/entryIndex'

defineProps<{
  entry: DisplayPokedexEntry
  selected: boolean
}>()
</script>

<template>
  <NuxtLink
    :to="pokedexEntryPath(entry)"
    :class="['entry-button', { active: selected }]"
    :aria-current="selected ? 'page' : undefined"
    prefetch-on="interaction"
  >
    <span class="entry-name">{{ entry.species }}</span>
    <span class="entry-meta">
      <template v-if="entry.nationalDexNumber">
        {{ formatNationalDexNumber(entry.nationalDexNumber) }} ·
      </template>
      <span v-if="entry.types?.length" class="entry-type-badges">
        <TypeBadge
          v-for="type in entry.types"
          :key="`${entry.id}-${type}`"
          :type="type"
          size="xs"
        />
      </span>
      <span v-else>Unknown type</span>
      <template v-if="entry.source_gen"> · {{ entry.source_gen }}</template>
    </span>
  </NuxtLink>
</template>

<style scoped>
.entry-button {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  padding: 0.7rem 0.8rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease;
}

.entry-button:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.entry-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.entry-button.active {
  border-color: var(--accent);
  background: var(--paper-active);
  color: var(--ink-bright);
}

.entry-name {
  font-weight: 700;
  letter-spacing: 0.02em;
}

.entry-meta {
  color: var(--ink-muted);
  font-size: 0.78rem;
  line-height: 1.3;
}

.entry-type-badges {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.22rem;
  vertical-align: middle;
}
</style>
