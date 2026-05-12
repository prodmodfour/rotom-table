<script setup lang="ts">
import { computed } from 'vue'
import { featureBySlug, features } from '~~/data/ptuReference'
import { siblingFeaturesInClass } from '~/utils/reference/featureDetails'
import { referenceDetailTitle } from '~/utils/reference/pageTitles'
import { referenceAllBackLabel, referenceIndexPath, referenceNotFoundBackLabel } from '~/utils/reference/routes'
import { routeSlugParam } from '~/utils/routeParams'

const route = useRoute()
const slug = computed(() => routeSlugParam(route.params))

const feat = computed(() => featureBySlug.get(slug.value) ?? null)
const featuresPath = referenceIndexPath('feature')
const featuresBackLabel = referenceAllBackLabel('feature')
const featuresNotFoundBackLabel = referenceNotFoundBackLabel('feature')

useHead(() => ({
  title: referenceDetailTitle(feat.value?.name, 'Features', 'Feature not found'),
}))

/** Sibling features in the same Trainer Class (if this is a class feature). */
const siblings = computed(() => siblingFeaturesInClass(feat.value, features))
</script>

<template>
  <ReferenceDetailShell :back-to="featuresPath" :back-label="featuresBackLabel">
    <FeatureDetailArticle
      v-if="feat"
      :feature="feat"
      :siblings="siblings"
    />

    <ReferenceNotFoundCard
      v-else
      title="Feature not found"
      :slug="slug"
      :back-to="featuresPath"
      :back-label="featuresNotFoundBackLabel"
    />
  </ReferenceDetailShell>
</template>
