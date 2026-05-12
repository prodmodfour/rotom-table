<script setup lang="ts">
import type { PokedexEntryDetail } from '~/utils/pokedex/entryIndex'

defineProps<{
  baseStats: PokedexEntryDetail['base_stats']
}>()
</script>

<template>
  <section v-if="baseStats" class="book-section">
    <h3 class="book-section__title">Base Stats:</h3>
    <dl class="stat-list">
      <div><dt>HP:</dt><dd>{{ baseStats.hp }}</dd></div>
      <div><dt>Attack:</dt><dd>{{ baseStats.atk }}</dd></div>
      <div><dt>Defense:</dt><dd>{{ baseStats.def }}</dd></div>
      <div><dt>Special Attack:</dt><dd>{{ baseStats.spatk }}</dd></div>
      <div><dt>Special Defense:</dt><dd>{{ baseStats.spdef }}</dd></div>
      <div><dt>Speed:</dt><dd>{{ baseStats.spd }}</dd></div>
    </dl>
  </section>
</template>
