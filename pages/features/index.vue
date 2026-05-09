<script setup lang="ts">
import { computed, ref } from 'vue'
import { features, toSlug } from '~/data/ptuReference'
import {
  buildFeatureTagCounts,
  filterFeaturesForIndex,
  toggledFeatureTag,
} from '~/utils/reference/featureIndex'

useHead({ title: 'Features · Rotom Table' })

const searchTerm = ref('')
const tagFilter = ref<string | null>(null)

/** All tags that appear on at least one feature, sorted by frequency desc. */
const allTags = computed(() => buildFeatureTagCounts(features))
const tagChips = computed(() => allTags.value.map(({ tag, count }) => ({
  key: tag,
  label: tag,
  count,
})))

const filtered = computed(() => filterFeaturesForIndex(features, {
  searchTerm: searchTerm.value,
  tag: tagFilter.value,
}))

const toggleTag = (tag: string) => {
  tagFilter.value = toggledFeatureTag(tagFilter.value, tag)
}
</script>

<template>
  <div class="ref-index">
    <ReferenceIndexHeader title="Features" :count="filtered.length" :total="features.length">
      <p class="ref-copy">
        Trainer Features parsed from <code>core/03-skills-edges-and-features.md</code>
        and <code>core/04-trainer-classes.md</code> (errata-2 patches applied).
        Class Features are tagged <code>Class</code>; pick a tag below to filter.
      </p>

      <ReferenceFilterChips
        :chips="tagChips"
        :active-key="tagFilter"
        aria-label="Filter features by tag"
        @select="toggleTag"
      />

      <label class="search-field">
        <span class="sr-only">Search features</span>
        <input
          v-model.trim="searchTerm"
          type="search"
          placeholder="Search by name, prereq, class, trigger, or effect…"
        />
      </label>
    </ReferenceIndexHeader>

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
.row-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.tag-badge {
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
}
</style>
