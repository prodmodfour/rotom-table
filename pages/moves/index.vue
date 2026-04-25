<script setup lang="ts">
import { computed, ref } from 'vue'
import { moves, toSlug } from '~/data/ptuReference'

useHead({ title: 'Moves · Rotom Table' })

const searchTerm = ref('')
const typeFilter = ref<string>('All')

const normalize = (value: string) => value.trim().toLowerCase()

const allTypes = computed(() => {
  const set = new Set<string>()
  for (const move of moves) if (move.type) set.add(move.type)
  return ['All', ...Array.from(set).sort()]
})

const filtered = computed(() => {
  const query = normalize(searchTerm.value)
  return moves.filter((move) => {
    if (typeFilter.value !== 'All' && move.type !== typeFilter.value) return false
    if (!query) return true
    const haystacks = [
      move.name,
      move.type ?? '',
      move.frequency ?? '',
      move.damage_class ?? '',
      move.range ?? '',
      move.effect ?? '',
    ]
    return haystacks.some((value) => normalize(value).includes(query))
  })
})
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
              :class="['type-pill', { active: typeFilter === type }]"
              :data-type="type === 'All' ? undefined : type"
              @click="typeFilter = type"
            >{{ type }}</button>
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
          <span class="type-pill" :data-type="move.type">{{ move.type }}</span>
          <span v-if="move.frequency" class="ref-row__freq">{{ move.frequency }}</span>
        </div>
        <div class="ref-row__pills">
          <span v-if="move.damage_class" class="badge">{{ move.damage_class }}</span>
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

.type-filter .type-pill {
  cursor: pointer;
  border: 1px solid transparent;
}

.type-filter .type-pill.active {
  outline: 2px solid #f0f9ff;
  outline-offset: 1px;
}

.type-filter .type-pill:not([data-type]) {
  background: rgba(15, 23, 42, 0.85);
  color: #eff6ff;
  border-color: rgba(96, 165, 250, 0.25);
}
</style>
