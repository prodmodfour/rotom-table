<script setup lang="ts">
import { sheetEditorPath } from '~/utils/sheetRoutes'

const currentTeamCsv = defineModel<string>('currentTeamCsv', { required: true })
const wishlistCsv = defineModel<string>('wishlistCsv', { required: true })

defineProps<{
  currentTeam?: readonly string[]
}>()
</script>

<template>
  <div class="grid-two">
    <div class="block">
      <h2 class="block-title">Current Team</h2>
      <p class="muted-help">Comma-separated Pokémon sheet slugs (e.g. <code>specs-chikorita</code>).</p>
      <EditableCell v-model="currentTeamCsv" placeholder="specs-chikorita" />
      <ul v-if="currentTeam?.length" class="ref-list-vertical team-list">
        <li v-for="memberSlug in currentTeam" :key="memberSlug">
          <NuxtLink :to="sheetEditorPath('pokemon', memberSlug)">{{ memberSlug }}</NuxtLink>
        </li>
      </ul>
    </div>
    <div class="block">
      <h2 class="block-title">Pokémon Wishlist</h2>
      <p class="muted-help">Comma-separated species names.</p>
      <EditableCell v-model="wishlistCsv" placeholder="Cherubi, Bounsweet" />
    </div>
  </div>
</template>

<style scoped src="./trainerProgressPanel.css"></style>
