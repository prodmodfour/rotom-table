<script setup lang="ts">
import { computed, ref } from 'vue'
import { abilities, toSlug } from '~/data/ptuReference'

useHead({ title: 'Abilities · Rotom Table' })

const searchTerm = ref('')
const normalize = (value: string) => value.trim().toLowerCase()

const filtered = computed(() => {
  const query = normalize(searchTerm.value)
  if (!query) return abilities
  return abilities.filter((ability) => {
    const haystacks = [ability.name, ability.frequency ?? '', ability.trigger ?? '', ability.effect ?? '']
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
          <h1>Abilities</h1>
          <span class="badge">{{ filtered.length }} of {{ abilities.length }}</span>
        </div>
        <p class="ref-copy">
          PTU 1.05 ability list from
          <code>ptu-data/data/abilities.json</code>.
        </p>
        <label class="search-field">
          <span class="sr-only">Search abilities</span>
          <input
            v-model.trim="searchTerm"
            type="search"
            placeholder="Search by name, frequency, trigger, or effect…"
          />
        </label>
      </section>
    </header>

    <main class="ref-list">
      <NuxtLink
        v-for="ability in filtered"
        :key="ability.name"
        :to="`/abilities/${toSlug(ability.name)}`"
        class="ref-row"
      >
        <div class="ref-row__heading">
          <h2>{{ ability.name }}</h2>
          <span v-if="ability.frequency" class="ref-row__freq">{{ ability.frequency }}</span>
        </div>
        <p v-if="ability.trigger" class="ref-row__trigger">
          <span class="label">Trigger:</span> {{ ability.trigger }}
        </p>
        <p v-if="ability.effect" class="ref-row__effect">
          {{ ability.effect }}
        </p>
      </NuxtLink>
      <p v-if="filtered.length === 0" class="empty-state">No abilities match that search.</p>
    </main>
  </div>
</template>


