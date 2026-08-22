<script setup lang="ts">
import type { PtuMove } from '~/types/ptuReference'

defineProps<{
  move: PtuMove
}>()
</script>

<template>
  <article class="panel-card">
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

    <ReferenceFieldBlock v-if="move.special" title="Special">
      <p>{{ move.special }}</p>
    </ReferenceFieldBlock>

    <ReferenceFieldBlock v-if="move.contest" title="Pokémon Contest">
      <dl v-if="move.contest.status === 'defined'" class="contest-identity">
        <div><dt>Type</dt><dd>{{ move.contest.typeLabel }}</dd></div>
        <div><dt>Effect</dt><dd>{{ move.contest.effectLabel }}</dd></div>
        <div v-if="move.contest.tags.length"><dt>Tags</dt><dd>{{ move.contest.tags.join(', ') }}</dd></div>
      </dl>
      <p v-else class="contest-unavailable">{{ move.contest.safeReason }}</p>
    </ReferenceFieldBlock>
  </article>
</template>

<style scoped>
.contest-identity { display: flex; flex-wrap: wrap; gap: .65rem; margin: 0; }
.contest-identity div { min-width: 8rem; padding: .65rem .8rem; border: 1px solid var(--rt-rule, var(--rule-soft)); background: var(--rt-bg-canvas, var(--paper-inset)); }
.contest-identity dt { color: var(--rt-text-muted, var(--ink-muted)); font-size: .68rem; font-weight: 850; letter-spacing: .06em; text-transform: uppercase; }
.contest-identity dd { margin: .2rem 0 0; color: var(--rt-text-strong, var(--ink-bright)); font-weight: 800; }
.contest-unavailable { color: var(--rt-text-muted, var(--ink-muted)); }
</style>
