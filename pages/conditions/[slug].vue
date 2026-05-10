<script setup lang="ts">
import { computed } from 'vue'
import { conditionBySlug } from '~/data/ptuReference'
import { referenceDetailTitle } from '~/utils/reference/pageTitles'
import { routeSlugParam } from '~/utils/routeParams'

const route = useRoute()
const slug = computed(() => routeSlugParam(route.params))

const condition = computed(() => conditionBySlug.get(slug.value) ?? null)

useHead(() => ({
  title: referenceDetailTitle(condition.value?.name, 'Conditions', 'Condition not found'),
}))
</script>

<template>
  <ReferenceDetailShell back-to="/conditions" back-label="← All conditions">
    <ConditionDetailArticle v-if="condition" :condition="condition" />

    <ReferenceNotFoundCard
      v-else
      title="Condition not found"
      :slug="slug"
      back-to="/conditions"
      back-label="← Back to all conditions"
    />
  </ReferenceDetailShell>
</template>
