<script setup lang="ts">
import { computed } from 'vue'
import { ruleBySlug } from '~~/data/ptuReference'
import { referenceDetailTitle } from '~/utils/reference/pageTitles'
import { referenceAllBackLabel, referenceIndexPath, referenceNotFoundBackLabel } from '~/utils/reference/routes'
import { routeSlugParam } from '~/utils/routeParams'

const route = useRoute()
const slug = computed(() => routeSlugParam(route.params))

const rule = computed(() => ruleBySlug.get(slug.value) ?? null)
const rulesPath = referenceIndexPath('rule')
const rulesBackLabel = referenceAllBackLabel('rule')
const rulesNotFoundBackLabel = referenceNotFoundBackLabel('rule')

useHead(() => ({
  title: referenceDetailTitle(rule.value?.name, 'Rules', 'Rule not found'),
}))
</script>

<template>
  <ReferenceDetailShell :back-to="rulesPath" :back-label="rulesBackLabel">
    <RuleDetailArticle v-if="rule" :rule="rule" />

    <ReferenceNotFoundCard
      v-else
      title="Rule not found"
      :slug="slug"
      :back-to="rulesPath"
      :back-label="rulesNotFoundBackLabel"
    />
  </ReferenceDetailShell>
</template>
