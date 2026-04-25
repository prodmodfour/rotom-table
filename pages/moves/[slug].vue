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
  <div class="ref-detail">
    <header class="ref-header">
      <AppNavigation />
      <div class="back-row">
        <NuxtLink to="/moves" class="back-link">← All moves</NuxtLink>
      </div>
    </header>

    <main>
      <article v-if="move" class="panel-card">
        <div class="detail-heading">
          <h1>{{ move.name }}</h1>
          <div class="detail-pills">
            <span class="type-pill" :data-type="move.type">{{ move.type }}</span>
            <span v-if="move.damage_class" class="badge">{{ move.damage_class }}</span>
            <span v-if="move.frequency" class="badge">{{ move.frequency }}</span>
          </div>
        </div>

        <dl class="stat-strip">
          <div v-if="move.damage_base != null"><dt>Damage Base</dt><dd>{{ move.damage_base }}</dd></div>
          <div v-if="move.damage_roll"><dt>Damage Roll</dt><dd>{{ move.damage_roll }}</dd></div>
          <div v-if="move.ac != null"><dt>AC</dt><dd>{{ move.ac }}</dd></div>
          <div v-if="move.range"><dt>Range</dt><dd>{{ move.range }}</dd></div>
        </dl>

        <section v-if="move.effect" class="field-block">
          <h3>Effect</h3>
          <p>{{ move.effect }}</p>
        </section>
      </article>

      <article v-else class="panel-card">
        <h1>Move not found</h1>
        <p>No entry for slug <code>{{ route.params.slug }}</code>.</p>
        <NuxtLink to="/moves" class="back-link">← Back to all moves</NuxtLink>
      </article>
    </main>
  </div>
</template>
