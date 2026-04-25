<script setup lang="ts">
import { computed, ref } from 'vue'
import { features, toSlug } from '~/data/ptuReference'

useHead({ title: 'Features · Rotom Table' })

const searchTerm = ref('')
const tagFilter = ref<string | null>(null)

const normalize = (value: string) => value.trim().toLowerCase()

/** All tags that appear on at least one feature, sorted by frequency desc. */
const allTags = computed(() => {
  const counts = new Map<string, number>()
  for (const f of features) {
    for (const tag of f.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({ tag, count }))
})

const filtered = computed(() => {
  const query = normalize(searchTerm.value)
  return features.filter((f) => {
    if (tagFilter.value && !f.tags?.includes(tagFilter.value)) return false
    if (!query) return true
    const haystacks = [
      f.name,
      f.prerequisites ?? '',
      f.frequency ?? '',
      f.trigger ?? '',
      f.target ?? '',
      f.effect ?? '',
      f.className ?? '',
    ]
    return haystacks.some((value) => normalize(value).includes(query))
  })
})

const toggleTag = (tag: string) => {
  tagFilter.value = tagFilter.value === tag ? null : tag
}
</script>

<template>
  <div class="ref-index">
    <header class="ref-header">
      <AppNavigation />
      <section class="panel-card">
        <div class="ref-heading">
          <h1>Features</h1>
          <span class="badge">{{ filtered.length }} of {{ features.length }}</span>
        </div>
        <p class="ref-copy">
          Trainer Features parsed from <code>core/03-skills-edges-and-features.md</code>
          and <code>core/04-trainer-classes.md</code> (errata-2 patches applied).
          Class Features are tagged <code>Class</code>; pick a tag below to filter.
        </p>

        <div class="tag-row">
          <button
            v-for="{ tag, count } in allTags"
            :key="tag"
            type="button"
            class="tag-chip"
            :class="{ active: tagFilter === tag }"
            @click="toggleTag(tag)"
          >
            {{ tag }} <span class="tag-count">{{ count }}</span>
          </button>
        </div>

        <label class="search-field">
          <span class="sr-only">Search features</span>
          <input
            v-model.trim="searchTerm"
            type="search"
            placeholder="Search by name, prereq, class, trigger, or effect…"
          />
        </label>
      </section>
    </header>

    <main class="ref-list">
      <NuxtLink
        v-for="feat in filtered"
        :key="feat.name"
        :to="`/features/${toSlug(feat.name)}`"
        class="ref-row"
      >
        <div class="ref-row__heading">
          <h2>{{ feat.name }}</h2>
          <div class="row-tags">
            <span v-for="tag in feat.tags" :key="tag" class="badge tag-badge">{{ tag }}</span>
          </div>
        </div>
        <p v-if="feat.frequency" class="ref-row__freq">{{ feat.frequency }}</p>
        <p v-if="feat.prerequisites" class="ref-row__trigger">
          <span class="label">Prereq:</span> {{ feat.prerequisites }}
        </p>
        <p v-if="feat.effect" class="ref-row__effect">{{ feat.effect }}</p>
      </NuxtLink>
      <p v-if="filtered.length === 0" class="empty-state">No features match.</p>
    </main>
  </div>
</template>

<style scoped>
.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 0.4rem;
  margin: 0.45rem 0 0.7rem;
}

.tag-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 0.3rem;
  padding: 0.18rem 0.55rem;
  border-radius: 999px;
  border: 1px solid rgba(96, 165, 250, 0.22);
  background: rgba(15, 23, 42, 0.78);
  color: rgba(191, 219, 254, 0.85);
  font-size: 0.78rem;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}

.tag-chip:hover { border-color: rgba(125, 211, 252, 0.7); }

.tag-chip.active {
  background: rgba(56, 189, 248, 0.22);
  border-color: rgba(125, 211, 252, 0.85);
  color: #f0f9ff;
}

.tag-count {
  opacity: 0.65;
  font-size: 0.7rem;
}

.row-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.tag-badge {
  background: rgba(168, 85, 247, 0.18);
  color: #ddd6fe;
  font-size: 0.7rem;
  padding: 0.1rem 0.45rem;
}
</style>
