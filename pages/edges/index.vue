<script setup lang="ts">
import { computed, ref } from 'vue'
import { edges, toSlug } from '~/data/ptuReference'

useHead({ title: 'Edges · Rotom Table' })

const searchTerm = ref('')

const normalize = (value: string) => value.trim().toLowerCase()

const filtered = computed(() => {
  const query = normalize(searchTerm.value)
  if (!query) return edges
  return edges.filter((edge) => {
    const haystacks = [edge.name, edge.prerequisites ?? '', edge.effect ?? '']
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
          <h1>Edges</h1>
          <span class="badge">{{ filtered.length }} of {{ edges.length }}</span>
        </div>
        <p class="ref-copy">
          Trainer Edges parsed from <code>core/03-skills-edges-and-features.md</code>.
          Each is a small character-building unit with just Prerequisites and an
          Effect — think Skill Edges, Crafting Edges, and Combat Edges.
        </p>

        <label class="search-field">
          <span class="sr-only">Search edges</span>
          <input
            v-model.trim="searchTerm"
            type="search"
            placeholder="Search by name, prereq, or effect…"
          />
        </label>
      </section>
    </header>

    <main class="ref-list">
      <NuxtLink
        v-for="edge in filtered"
        :key="edge.name"
        :to="`/edges/${toSlug(edge.name)}`"
        class="ref-row"
      >
        <div class="ref-row__heading">
          <h2>{{ edge.name }}</h2>
        </div>
        <p v-if="edge.prerequisites" class="ref-row__trigger">
          <span class="label">Prereq:</span> {{ edge.prerequisites }}
        </p>
        <p v-if="edge.effect" class="ref-row__effect">{{ edge.effect }}</p>
      </NuxtLink>
      <p v-if="filtered.length === 0" class="empty-state">No edges match.</p>
    </main>
  </div>
</template>
