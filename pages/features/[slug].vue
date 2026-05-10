<script setup lang="ts">
import { computed } from 'vue'
import { featureBySlug, features } from '~/data/ptuReference'
import { siblingFeaturesInClass } from '~/utils/reference/featureDetails'

const route = useRoute()

const feat = computed(() => featureBySlug.get(String(route.params.slug ?? '')) ?? null)

useHead(() => ({
  title: feat.value
    ? `${feat.value.name} · Features`
    : 'Feature not found · Rotom Table',
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
      :slug="route.params.slug"
      back-to="/features"
      back-label="← Back to all features"
    />
  </ReferenceDetailShell>
</template>
