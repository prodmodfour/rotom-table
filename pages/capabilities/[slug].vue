<script setup lang="ts">
import { computed } from 'vue'
import { capabilityBySlug } from '~/data/ptuReference'
import { referenceDetailTitle } from '~/utils/reference/pageTitles'
import { routeSlugParam } from '~/utils/routeParams'

const route = useRoute()

const slug = computed(() => routeSlugParam(route.params))
const cap = computed(() => capabilityBySlug.get(slug.value) ?? null)

useHead(() => ({
  title: referenceDetailTitle(cap.value?.name, 'Capabilities', 'Capability not found'),
}))
</script>

<template>
  <ReferenceDetailShell back-to="/capabilities" back-label="← All capabilities">
    <CapabilityDetailArticle v-if="cap" :capability="cap" />
    <ReferenceNotFoundCard
      v-else
      title="Capability not found"
      :slug="slug"
      back-to="/capabilities"
      back-label="← Back to all capabilities"
    />
  </ReferenceDetailShell>
</template>
