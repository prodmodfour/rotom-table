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
        <div class="detail-heading">
          <h1>{{ condition.name }}</h1>
          <div class="detail-pills">
            <ConditionTag :name="condition.name" size="md" />
            <span class="badge">{{ condition.category }}</span>
            <span v-if="condition.source" class="badge">{{ condition.source }}</span>
          </div>
        </div>

        <section v-if="condition.aliases?.length" class="field-block">
          <h3>Aliases</h3>
          <p>{{ condition.aliases.join(', ') }}</p>
        </section>

        <section v-if="condition.effect" class="field-block">
          <h3>Effect</h3>
          <p>{{ condition.effect }}</p>
        </section>
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
