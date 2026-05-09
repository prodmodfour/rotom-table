<script setup lang="ts">
import { computed } from 'vue'
import { moveBySlug } from '~/data/ptuReference'

const route = useRoute()

const move = computed(() => moveBySlug.get(String(route.params.slug ?? '')) ?? null)

useHead(() => ({
  title: move.value
    ? `${move.value.name} · Moves`
    : 'Move not found · Rotom Table',
}))
</script>

<template>
  <ReferenceDetailShell back-to="/moves" back-label="← All moves">
      <article v-if="move" class="panel-card">
        <ReferenceDetailHeading :title="move.name">
          <template #pills>
            <TypeBadge v-if="move.type" :type="move.type" size="md" />
            <DamageClassBadge v-if="move.damage_class" :category="move.damage_class" size="md" />
            <span v-if="move.frequency" class="badge">{{ move.frequency }}</span>
          </template>
        </ReferenceDetailHeading>

        <dl class="stat-strip">
          <div v-if="move.damage_base != null"><dt>Damage Base</dt><dd>{{ move.damage_base }}</dd></div>
          <div v-if="move.damage_roll"><dt>Damage Roll</dt><dd>{{ move.damage_roll }}</dd></div>
          <div v-if="move.ac != null"><dt>AC</dt><dd>{{ move.ac }}</dd></div>
          <div v-if="move.range"><dt>Range</dt><dd>{{ move.range }}</dd></div>
        </dl>

        <ReferenceFieldBlock v-if="move.effect" title="Effect">
          <p>{{ move.effect }}</p>
        </ReferenceFieldBlock>
      </article>

      <ReferenceNotFoundCard
        v-else
        title="Move not found"
        :slug="route.params.slug"
        back-to="/moves"
        back-label="← Back to all moves"
      />
  </ReferenceDetailShell>
</template>
