<script setup lang="ts">
import { computed } from 'vue'
import { ruleBySlug } from '~/data/ptuReference'
import { referenceDetailTitle } from '~/utils/reference/pageTitles'
import { routeSlugParam } from '~/utils/routeParams'

const route = useRoute()

const rule = computed(() => ruleBySlug.get(routeSlugParam(route.params)) ?? null)

useHead(() => ({
  title: referenceDetailTitle(rule.value?.name, 'Rules', 'Rule not found'),
}))
</script>

<template>
  <ReferenceDetailShell back-to="/rules" back-label="← All rules">
      <RuleDetailArticle v-if="rule" :rule="rule" />

      <ReferenceNotFoundCard
        v-else
        title="Rule not found"
        :slug="route.params.slug"
        back-to="/rules"
        back-label="← Back to all rules"
      />
  </ReferenceDetailShell>
</template>
