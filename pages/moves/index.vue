<script setup lang="ts">
import { computed, ref } from 'vue'
import { moves, toSlug } from '~/data/ptuReference'
import { ALL_MOVE_TYPES_OPTION, buildMoveTypeOptions, filterMovesForIndex } from '~/utils/reference/moveIndex'

useHead({ title: 'Moves · Rotom Table' })

const searchTerm = ref('')
const typeFilter = ref<string>(ALL_MOVE_TYPES_OPTION)

const allTypes = computed(() => buildMoveTypeOptions(moves))

const filtered = computed(() => filterMovesForIndex(moves, {
  searchTerm: searchTerm.value,
  type: typeFilter.value,
}))
</script>

<template>
  <div class="ref-index">
    <header class="ref-header">
      <AppNavigation />
      <section class="panel-card">
        <div class="ref-heading">
          <h1>Moves</h1>
          <span class="badge">{{ filtered.length }} of {{ moves.length }}</span>
        </div>
        <p class="ref-copy">
          PTU 1.05 move list from
          <code>ptu-data/data/moves.json</code>.
        </p>

        <div class="moves-controls">
          <label class="search-field">
            <span class="sr-only">Search moves</span>
            <input
              v-model.trim="searchTerm"
              type="search"
              placeholder="Search by name, type, frequency, range, or effect…"
            />
          </label>

          <div class="type-filter" role="radiogroup" aria-label="Filter by type">
            <button
              v-for="type in allTypes"
              :key="type"
              type="button"
              :class="['type-filter__button', { active: typeFilter === type, 'type-filter__button--all': type === ALL_MOVE_TYPES_OPTION }]"
              :aria-pressed="typeFilter === type"
              @click="typeFilter = type"
            >
              <span v-if="type === ALL_MOVE_TYPES_OPTION">All</span>
              <TypeBadge v-else :type="type" size="sm" />
            </button>
          </div>
        </div>
      </section>
    </header>

    <main class="ref-list">
      <NuxtLink
        v-for="move in filtered"
        :key="move.name"
        :to="`/moves/${toSlug(move.name)}`"
        class="ref-row"
      >
        <div class="ref-row__heading">
          <h2>{{ move.name }}</h2>
          <TypeBadge v-if="move.type" :type="move.type" size="sm" />
          <span v-if="move.frequency" class="ref-row__freq">{{ move.frequency }}</span>
        </div>
        <div class="ref-row__pills">
          <DamageClassBadge v-if="move.damage_class" :category="move.damage_class" size="xs" />
          <span v-if="move.damage_base != null" class="badge">DB {{ move.damage_base }}</span>
          <span v-if="move.ac != null" class="badge">AC {{ move.ac }}</span>
          <span v-if="move.range" class="badge">{{ move.range }}</span>
        </div>
        <p v-if="move.effect" class="ref-row__effect">{{ move.effect }}</p>
      </NuxtLink>
      <p v-if="filtered.length === 0" class="empty-state">No moves match.</p>
    </main>
  </div>
</template>

<style scoped>
.moves-controls {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.type-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.type-filter__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 1.9rem;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
}

.type-filter__button.active {
  outline: 2px solid var(--ink-bright);
  outline-offset: 2px;
}

.type-filter__button--all {
  padding: 0.32rem 0.85rem;
  background: var(--paper);
  color: var(--ink);
  border-color: var(--rule-soft);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.type-filter__button--all:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.type-filter__button:not(.type-filter__button--all):hover {
  filter: brightness(1.08);
}
</style>
