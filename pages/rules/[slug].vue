<script setup lang="ts">
import { computed } from 'vue'
import { ruleBySlug } from '~/data/ptuReference'

const route = useRoute()

const rule = computed(() => ruleBySlug.get(String(route.params.slug ?? '')) ?? null)

useHead(() => ({
  title: rule.value
    ? `${rule.value.name} · Rules`
    : 'Rule not found · Rotom Table',
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
