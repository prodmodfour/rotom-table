<script setup lang="ts">
import { computed } from 'vue'
import { conditionBySlug } from '~/data/ptuReference'
import { referenceDetailTitle } from '~/utils/reference/pageTitles'
import { routeSlugParam } from '~/utils/routeParams'

const route = useRoute()

const condition = computed(() => conditionBySlug.get(routeSlugParam(route.params)) ?? null)

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
        :slug="route.params.slug"
        back-to="/conditions"
        back-label="← Back to all conditions"
      />
  </ReferenceDetailShell>
</template>
