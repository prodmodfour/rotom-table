<script setup lang="ts">
import { computed, ref } from 'vue'
import { capabilities, toSlug } from '~/data/ptuReference'

useHead({ title: 'Capabilities · Rotom Table' })

const searchTerm = ref('')
const normalize = (value: string) => value.trim().toLowerCase()

const filtered = computed(() => {
  const query = normalize(searchTerm.value)
  if (!query) return capabilities
  return capabilities.filter((cap) => {
    const haystacks = [cap.name, cap.effect ?? '', cap.source ?? '']
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
          <h1>Capabilities</h1>
          <span class="badge">{{ filtered.length }} of {{ capabilities.length }}</span>
        </div>
        <p class="ref-copy">
          Named PTU capabilities from <code>ptu-data/data/capabilities.json</code>.
          The numeric movement keywords (Overland, Sky, Swim, Levitate, Burrow,
          Jump, Power) are core mechanics and live in the rulebook itself.
        </p>
        <label class="search-field">
          <span class="sr-only">Search capabilities</span>
          <input
            v-model.trim="searchTerm"
            type="search"
            placeholder="Search by name, effect, or source…"
          />
        </label>
      </section>
    </header>

    <main class="ref-list">
      <NuxtLink
        v-for="cap in filtered"
        :key="cap.name"
        :to="`/capabilities/${toSlug(cap.name)}`"
        class="ref-row capability-row"
      >
        <CapabilityArt :name="cap.name" size="sm" class="capability-row__art" />
        <div class="capability-row__body">
          <div class="ref-row__heading">
            <h2>{{ cap.name }}</h2>
            <span v-if="cap.source" class="ref-row__freq">{{ cap.source }}</span>
          </div>
          <p v-if="cap.effect" class="ref-row__effect">{{ cap.effect }}</p>
        </div>
      </NuxtLink>
      <p v-if="filtered.length === 0" class="empty-state">No capabilities match.</p>
    </main>
  </div>
</template>

<style scoped>
.capability-row {
  flex-direction: row;
  align-items: flex-start;
  gap: 0.85rem;
  min-height: 108px;
}

.capability-row__art {
  flex: 0 0 auto;
  margin-top: 0.05rem;
}

.capability-row__body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.42rem;
}

@media (max-width: 520px) {
  .ref-list {
    grid-template-columns: 1fr;
  }

  .capability-row {
    gap: 0.65rem;
    padding: 0.75rem;
  }
}
</style>
