<script setup lang="ts">
import { computed } from 'vue'
import AppNavigation from '~/components/AppNavigation.vue'
import EncounterSurface from '~/components/encounter/EncounterSurface.vue'
import { useEncounterWorkspaceFeaturePolicy } from '~/composables/encounter/useEncounterWorkspaceFeaturePolicy'
import { ENCOUNTER_WORKSPACE_API_PATHS } from '~/utils/apiRoutes'
import { battlefieldWorkshopPath, encounterWorkspacePath } from '#shared/encounterWorkspace/routes'
import type { EncounterWorkspaceSummaryList } from '#shared/encounterWorkspace/library'
import { encountersChannel } from '#shared/realtime'
import { useRealtimeChannel } from '~/composables/useRealtime'

const featurePolicy = useEncounterWorkspaceFeaturePolicy()
if (!featurePolicy.value.enabled) {
  throw createError({ statusCode: 404, statusMessage: 'Encounter Workspace is not enabled.' })
}

useHead({ title: 'Encounter Library · Rotom Table' })

const { getJson } = useApiClient()
const { data, status, error, refresh } = await useAsyncData(
  'encounter-workspace-library',
  () => getJson<EncounterWorkspaceSummaryList>(ENCOUNTER_WORKSPACE_API_PATHS.list),
)
const summaries = computed(() => data.value?.summaries ?? [])
const activeSummaries = computed(() => summaries.value.filter(summary => summary.state === 'live'))
const preparedSummaries = computed(() => summaries.value.filter(summary => summary.state !== 'live'))
useRealtimeChannel(encountersChannel, () => { void refresh() })

const updatedLabel = (updatedAt: number | null): string => {
  if (updatedAt === null) return 'No saved activity time'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(updatedAt)
}
</script>

<template>
  <main class="encounter-library rt-design-system" data-rt-design-system="1" data-rt-context="field-guide">
    <AppNavigation />

    <header class="encounter-library__hero">
      <div>
        <p class="encounter-library__eyebrow">Live play</p>
        <h1>Encounter Library</h1>
        <p>Enter the Battle Cockpit for active play, or open the Battlefield Workshop to prepare exact geometry.</p>
      </div>
      <div class="encounter-library__hero-actions">
        <NuxtLink class="encounter-library__builder" to="/encounters/new">Build encounter</NuxtLink>
        <NuxtLink class="encounter-library__workshop" to="/maps">Open Battlefield Workshop</NuxtLink>
      </div>
    </header>

    <p v-if="status === 'pending'" class="encounter-library__state" role="status">
      Loading encounters…
    </p>
    <section v-else-if="error" class="encounter-library__state encounter-library__state--error" role="alert">
      <h2>Encounter library unavailable</h2>
      <p>{{ error.message }}</p>
      <button type="button" @click="refresh()">Try again</button>
    </section>
    <section v-else-if="summaries.length === 0" class="encounter-library__state">
      <h2>No map-backed encounters yet</h2>
      <p>Build an encounter from a recipe or prepare a battlefield in the Workshop.</p>
      <NuxtLink to="/encounters/new">Build encounter</NuxtLink>
      <NuxtLink to="/maps">Go to Battlefield Workshop</NuxtLink>
    </section>

    <template v-else>
      <section v-if="activeSummaries.length" aria-labelledby="active-encounters-heading">
        <div class="encounter-library__section-heading">
          <div>
            <p class="encounter-library__eyebrow">Resume</p>
            <h2 id="active-encounters-heading">Active encounters</h2>
          </div>
          <span>{{ activeSummaries.length }} live</span>
        </div>
        <div class="encounter-library__grid">
          <EncounterSurface
            v-for="summary in activeSummaries"
            :key="summary.encounterId"
            as="article"
            layer="persistent"
            :elevation="2"
            state="selected"
            notched
            class="encounter-library-card encounter-library-card--live"
          >
            <div class="encounter-library-card__topline">
              <span class="encounter-library-card__state">Live · Round {{ summary.round }}</span>
              <span class="rt-numeric">{{ summary.encounterRevision === null ? `map rev ${summary.revision}` : `enc rev ${summary.encounterRevision} · map rev ${summary.revision}` }}</span>
            </div>
            <h3>{{ summary.name }}</h3>
            <p>{{ summary.scene.name || (summary.recipe ? `${summary.recipe} encounter` : 'Active battlefield scene') }}</p>
            <dl>
              <div><dt>Participants</dt><dd class="rt-numeric">{{ summary.participantCount }}</dd></div>
              <div><dt>Sides</dt><dd class="rt-numeric">{{ summary.sideCount }}</dd></div>
              <div><dt>Updated</dt><dd>{{ updatedLabel(summary.updatedAt) }}</dd></div>
            </dl>
            <div class="encounter-library-card__actions">
              <NuxtLink :to="encounterWorkspacePath(summary.encounterId)">Resume cockpit</NuxtLink>
              <NuxtLink :to="battlefieldWorkshopPath(summary.mapSlug)">Workshop</NuxtLink>
            </div>
          </EncounterSurface>
        </div>
      </section>

      <section v-if="preparedSummaries.length" aria-labelledby="prepared-encounters-heading">
        <div class="encounter-library__section-heading">
          <div>
            <p class="encounter-library__eyebrow">Map-backed</p>
            <h2 id="prepared-encounters-heading">Prepared battlefields</h2>
          </div>
          <span>{{ preparedSummaries.length }} available</span>
        </div>
        <div class="encounter-library__grid">
          <EncounterSurface
            v-for="summary in preparedSummaries"
            :key="summary.encounterId"
            as="article"
            layer="persistent"
            :elevation="1"
            class="encounter-library-card"
          >
            <div class="encounter-library-card__topline">
              <span class="encounter-library-card__state">{{ summary.state === 'ready' ? 'Ready' : 'Empty' }}</span>
              <span class="rt-numeric">{{ summary.encounterRevision === null ? `map rev ${summary.revision}` : `enc rev ${summary.encounterRevision} · map rev ${summary.revision}` }}</span>
            </div>
            <h3>{{ summary.name }}</h3>
            <p>{{ summary.recipe ? `${summary.recipe} · ${summary.folder || 'Unfiled battlefield'}` : (summary.folder || 'Unfiled battlefield') }}</p>
            <dl>
              <div><dt>Participants</dt><dd class="rt-numeric">{{ summary.participantCount }}</dd></div>
              <div><dt>Visibility</dt><dd>{{ summary.playerVisible ? 'Shared' : 'GM only' }}</dd></div>
              <div><dt>Updated</dt><dd>{{ updatedLabel(summary.updatedAt) }}</dd></div>
            </dl>
            <div class="encounter-library-card__actions">
              <NuxtLink :to="encounterWorkspacePath(summary.encounterId)">Open cockpit</NuxtLink>
              <NuxtLink :to="battlefieldWorkshopPath(summary.mapSlug)">Prepare map</NuxtLink>
            </div>
          </EncounterSurface>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
.encounter-library {
  min-height: 100dvh;
  padding: clamp(0.75rem, 2vw, 1.5rem);
  color: var(--rt-text);
  background:
    radial-gradient(circle at 82% 8%, color-mix(in srgb, var(--rt-info) 12%, transparent), transparent 34rem),
    var(--rt-bg-canvas);
}

.encounter-library__hero,
.encounter-library__section-heading,
.encounter-library-card__topline,
.encounter-library-card__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.encounter-library__hero {
  max-width: 90rem;
  margin: clamp(1.5rem, 4vw, 4rem) auto 2rem;
}

.encounter-library__hero h1,
.encounter-library__section-heading h2,
.encounter-library-card h3 { margin: 0; }
.encounter-library__hero p { max-width: 64ch; }
.encounter-library__eyebrow,
.encounter-library-card__state {
  margin: 0 0 0.25rem;
  color: var(--rt-info);
  font: 700 var(--rt-type-label-sm-size)/1.2 var(--rt-font-interface);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.encounter-library__workshop,
.encounter-library__builder,
.encounter-library-card__actions a,
.encounter-library__state a,
.encounter-library__state button {
  min-height: 2.75rem;
  display: inline-flex;
  align-items: center;
  padding: 0.65rem 0.9rem;
  border: 1px solid var(--rt-rule);
  border-radius: var(--rt-radius-small);
  color: var(--rt-text-strong);
  background: var(--rt-surface-2);
  font-weight: 700;
  text-decoration: none;
}

.encounter-library__hero-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .5rem; }
.encounter-library__builder { border-color: var(--rt-info); }
.encounter-library section { max-width: 90rem; margin: 2.5rem auto; }
.encounter-library__section-heading { margin-bottom: 0.85rem; }
.encounter-library__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 19rem), 1fr)); gap: 1rem; }
.encounter-library-card { min-width: 0; }
.encounter-library-card h3 { margin-top: 0.7rem; font-size: var(--rt-type-heading-md-size); }
.encounter-library-card p { color: var(--rt-text-muted); }
.encounter-library-card dl { display: grid; gap: 0.45rem; margin: 1rem 0; }
.encounter-library-card dl div { display: flex; justify-content: space-between; gap: 1rem; }
.encounter-library-card dt { color: var(--rt-text-muted); }
.encounter-library-card dd { margin: 0; text-align: right; }
.encounter-library-card__actions { justify-content: flex-start; flex-wrap: wrap; }
.encounter-library-card__actions a:first-child { border-color: var(--rt-info); }
.encounter-library__state { max-width: 52rem; margin: 4rem auto; padding: 2rem; text-align: center; }
.encounter-library__state--error { color: var(--rt-danger); }

@media (max-width: 44rem) {
  .encounter-library__hero { align-items: flex-start; flex-direction: column; }
  .encounter-library__hero-actions { width: 100%; }
  .encounter-library__workshop, .encounter-library__builder { flex: 1; justify-content: center; }
}
</style>
