<script setup lang="ts">
import { computed } from 'vue'
import { ruleBySlug } from '~/data/ptuReference'
import { referenceDetailTitle } from '~/utils/reference/pageTitles'
import { routeSlugParam } from '~/utils/routeParams'

const route = useRoute()
const slug = computed(() => routeSlugParam(route.params))

const rule = computed(() => ruleBySlug.get(slug.value) ?? null)

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
      :slug="slug"
      back-to="/rules"
      back-label="← Back to all rules"
    />
  </ReferenceDetailShell>
</template>
