<script setup lang="ts">
import { computed } from 'vue'
import { featureBySlug, features } from '~/data/ptuReference'
import { siblingFeaturesInClass } from '~/utils/reference/featureDetails'
import { referenceDetailTitle } from '~/utils/reference/pageTitles'
import { routeSlugParam } from '~/utils/routeParams'

const route = useRoute()
const slug = computed(() => routeSlugParam(route.params))

const feat = computed(() => featureBySlug.get(slug.value) ?? null)

useHead(() => ({
  title: referenceDetailTitle(feat.value?.name, 'Features', 'Feature not found'),
}))

/** Sibling features in the same Trainer Class (if this is a class feature). */
const siblings = computed(() => siblingFeaturesInClass(feat.value, features))
</script>

<template>
  <ReferenceDetailShell back-to="/features" back-label="← All features">
    <FeatureDetailArticle
      v-if="feat"
      :feature="feat"
      :siblings="siblings"
    />

    <ReferenceNotFoundCard
      v-else
      title="Feature not found"
      :slug="slug"
      back-to="/features"
      back-label="← Back to all features"
    />
  </ReferenceDetailShell>
</template>
