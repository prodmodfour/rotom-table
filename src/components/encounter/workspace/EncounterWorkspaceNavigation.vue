<script setup lang="ts">
import { battlefieldWorkshopPath, encounterLibraryPath } from '#shared/encounterWorkspace/routes'

defineProps<{
  mapSlug: string
  encounterName: string
  canUseDirector?: boolean
  directorOpen?: boolean
  settingsOpen?: boolean
}>()

const emit = defineEmits<{
  (event: 'toggleDirector'): void
  (event: 'toggleSettings'): void
}>()

const { isGm, isPlayer, roleLabel } = useAuth()
const { selectedProfileDisplayName } = usePlayerProfiles()
const identityLabel = computed(() => (
  isPlayer.value ? selectedProfileDisplayName.value || 'Player profile' : roleLabel.value
))
</script>

<template>
  <nav class="encounter-workspace-nav" aria-label="Encounter workspace">
    <NuxtLink class="encounter-workspace-nav__brand" :to="encounterLibraryPath()" aria-label="Encounter Library">
      <span aria-hidden="true">RT</span>
      <span>Encounters</span>
    </NuxtLink>
    <span class="encounter-workspace-nav__encounter" :title="encounterName">{{ encounterName }}</span>
    <div class="encounter-workspace-nav__links">
      <NuxtLink :to="encounterLibraryPath()">Library</NuxtLink>
      <NuxtLink :to="battlefieldWorkshopPath(mapSlug)">Battlefield Workshop</NuxtLink>
      <button
        v-if="canUseDirector"
        id="encounter-director-toggle"
        type="button"
        :aria-expanded="directorOpen"
        aria-controls="encounter-director-heading"
        @click="emit('toggleDirector')"
      >
        Director
      </button>
      <button
        id="encounter-display-settings-toggle"
        type="button"
        :aria-expanded="settingsOpen"
        aria-controls="encounter-display-settings-heading"
        @click="emit('toggleSettings')"
      >
        Display
      </button>
      <NuxtLink to="/settings">App settings</NuxtLink>
    </div>
    <span class="encounter-workspace-nav__identity" :data-role="isGm ? 'gm' : 'player'">
      {{ identityLabel }}
    </span>
  </nav>
</template>

<style scoped>
.encounter-workspace-nav {
  display: grid;
  grid-template-columns: auto minmax(8rem, 1fr) auto auto;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
  min-height: 3rem;
  padding: 0.4rem 0.65rem;
  border-bottom: 1px solid var(--rt-rule);
  background: var(--rt-surface-2);
}
.encounter-workspace-nav a,
.encounter-workspace-nav button { color: var(--rt-text-strong); text-decoration: none; font: inherit; font-weight: 700; }
.encounter-workspace-nav a:focus-visible,
.encounter-workspace-nav button:focus-visible { outline: 3px solid var(--rt-focus); outline-offset: 2px; }
.encounter-workspace-nav__brand { display: inline-flex; align-items: center; gap: 0.5rem; }
.encounter-workspace-nav__brand > span:first-child {
  display: grid; place-items: center; width: 2rem; height: 2rem;
  border-radius: var(--rt-radius-small); background: var(--rt-info); color: var(--rt-on-brand);
  font: 800 0.75rem/1 var(--rt-font-interface); letter-spacing: 0.08em;
}
.encounter-workspace-nav__encounter { min-width: 0; overflow: hidden; color: var(--rt-text-muted); text-overflow: ellipsis; white-space: nowrap; }
.encounter-workspace-nav__links { display: flex; gap: 0.3rem; }
.encounter-workspace-nav__links a,
.encounter-workspace-nav__links button { min-height: var(--rt-touch-minimum); display: inline-flex; align-items: center; padding: 0.35rem 0.55rem; border: 0; border-radius: var(--rt-radius-small); background: transparent; }
.encounter-workspace-nav__links a:hover,
.encounter-workspace-nav__links button:hover,
.encounter-workspace-nav__links button[aria-expanded='true'] { background: var(--rt-surface-3); }
.encounter-workspace-nav__identity { max-width: 12rem; overflow: hidden; padding: 0.35rem 0.6rem; border: 1px solid var(--rt-rule); border-radius: 999px; color: var(--rt-text-muted); font-size: var(--rt-type-label-sm-size); text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 54rem) {
  .encounter-workspace-nav { grid-template-columns: auto minmax(0, 1fr) auto; }
  .encounter-workspace-nav__links { grid-column: 1 / -1; overflow-x: auto; }
  .encounter-workspace-nav__identity { grid-column: 3; grid-row: 1; }
}
@media (max-width: 32rem) {
  .encounter-workspace-nav__brand > span:last-child, .encounter-workspace-nav__identity { display: none; }
  .encounter-workspace-nav { grid-template-columns: auto minmax(0, 1fr); }
  .encounter-workspace-nav__links {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    overflow: visible;
  }
  .encounter-workspace-nav__links a,
  .encounter-workspace-nav__links button {
    min-width: 0;
    justify-content: center;
    text-align: center;
  }
}
</style>
