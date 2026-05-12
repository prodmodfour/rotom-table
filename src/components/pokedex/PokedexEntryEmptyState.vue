<script setup lang="ts">
defineProps<{
  requestedPokemonName: string | null
}>()
</script>

<template>
  <section class="book-page book-page--empty">
    <h2>{{ requestedPokemonName ? 'Pokémon not found' : 'No entry selected' }}</h2>
    <p v-if="requestedPokemonName">
      No Pokédex entry exists for <code>{{ requestedPokemonName }}</code>.
    </p>
    <p v-else>Pick a Pokémon from the sidebar to inspect its PTU data.</p>
  </section>
</template>
