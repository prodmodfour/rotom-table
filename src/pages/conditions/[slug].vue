<script setup lang="ts">
import { computed } from 'vue'
import { conditionBySlug } from '~~/data/ptuReference'
import { referenceDetailTitle } from '~/utils/reference/pageTitles'
import { referenceAllBackLabel, referenceIndexPath, referenceNotFoundBackLabel } from '~/utils/reference/routes'
import { routeSlugParam } from '~/utils/routeParams'

const route = useRoute()
const slug = computed(() => routeSlugParam(route.params))

const condition = computed(() => conditionBySlug.get(slug.value) ?? null)
const conditionsPath = referenceIndexPath('condition')
const conditionsBackLabel = referenceAllBackLabel('condition')
const conditionsNotFoundBackLabel = referenceNotFoundBackLabel('condition')

useHead(() => ({
  title: referenceDetailTitle(condition.value?.name, 'Conditions', 'Condition not found'),
}))
</script>

<template>
  <ReferenceDetailShell :back-to="conditionsPath" :back-label="conditionsBackLabel">
    <ConditionDetailArticle v-if="condition" :condition="condition" />

    <ReferenceNotFoundCard
      v-else
      title="Condition not found"
      :slug="slug"
      :back-to="conditionsPath"
      :back-label="conditionsNotFoundBackLabel"
    />
  </ReferenceDetailShell>
</template>
