<script setup lang="ts">
import { computed } from 'vue'
import { capabilityBySlug } from '~~/data/ptuReference'
import { referenceDetailTitle } from '~/utils/reference/pageTitles'
import { referenceAllBackLabel, referenceIndexPath, referenceNotFoundBackLabel } from '~/utils/reference/routes'
import { routeSlugParam } from '~/utils/routeParams'

const route = useRoute()

const slug = computed(() => routeSlugParam(route.params))
const cap = computed(() => capabilityBySlug.get(slug.value) ?? null)
const capabilitiesPath = referenceIndexPath('capability')
const capabilitiesBackLabel = referenceAllBackLabel('capability')
const capabilitiesNotFoundBackLabel = referenceNotFoundBackLabel('capability')

useHead(() => ({
  title: referenceDetailTitle(cap.value?.name, 'Capabilities', 'Capability not found'),
}))
</script>

<template>
  <ReferenceDetailShell :back-to="capabilitiesPath" :back-label="capabilitiesBackLabel">
    <CapabilityDetailArticle v-if="cap" :capability="cap" />
    <ReferenceNotFoundCard
      v-else
      title="Capability not found"
      :slug="slug"
      :back-to="capabilitiesPath"
      :back-label="capabilitiesNotFoundBackLabel"
    />
  </ReferenceDetailShell>
</template>
