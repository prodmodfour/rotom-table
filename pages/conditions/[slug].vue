<script setup lang="ts">
import { computed } from 'vue'
import { conditionBySlug } from '~/data/ptuReference'

const route = useRoute()

const condition = computed(() => conditionBySlug.get(String(route.params.slug ?? '')) ?? null)

useHead(() => ({
  title: condition.value
    ? `${condition.value.name} · Conditions`
    : 'Condition not found · Rotom Table',
}))
</script>

<template>
  <ReferenceDetailShell back-to="/conditions" back-label="← All conditions">
      <article v-if="condition" class="panel-card">
        <ReferenceDetailHeading :title="condition.name">
          <template #pills>
            <ConditionTag :name="condition.name" size="md" />
            <span class="badge">{{ condition.category }}</span>
            <span v-if="condition.source" class="badge">{{ condition.source }}</span>
          </template>
        </ReferenceDetailHeading>

        <ReferenceFieldBlock v-if="condition.aliases?.length" title="Aliases">
          <p>{{ condition.aliases.join(', ') }}</p>
        </ReferenceFieldBlock>

        <ReferenceFieldBlock v-if="condition.effect" title="Effect">
          <p>{{ condition.effect }}</p>
        </ReferenceFieldBlock>
      </article>

      <ReferenceNotFoundCard
        v-else
        title="Condition not found"
        :slug="route.params.slug"
        back-to="/conditions"
        back-label="← Back to all conditions"
      />
  </ReferenceDetailShell>
</template>
