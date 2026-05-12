<script setup lang="ts">
import { computed, ref } from 'vue'
import { features } from '~~/data/ptuReference'
import {
  buildFeatureTagCounts,
  filterFeaturesForIndex,
  toggledFeatureTag,
} from '~/utils/reference/featureIndex'
import { referenceIndexTitle } from '~/utils/reference/pageTitles'

useHead({ title: referenceIndexTitle('Features') })

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

      <ReferenceSearchField
        v-model="searchTerm"
        label="Search features"
        placeholder="Search by name, prereq, class, trigger, or effect…"
      />
    </ReferenceIndexHeader>

    <FeatureIndexList :features="filtered" />
  </div>
</template>
