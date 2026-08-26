<script setup lang="ts">
import AppNavigation from '~/components/AppNavigation.vue'
import { useEncounterBuilder, type EncounterBuilderDraftMember } from '~/composables/encounters/useEncounterBuilder'
import { useMapLibraryData } from '~/composables/library/useMapLibraryData'
import { encounterWorkspacePath } from '#shared/encounterWorkspace/routes'
import type { EncounterBuilderHandoffV2 } from '#shared/encounterDocuments/builder'
import { getClientId } from '~/utils/clientId'

const { isGm } = useAuth()
if (!isGm.value) throw createError({ statusCode: 403, statusMessage: 'Encounter Builder is GM-only.' })

useHead({ title: 'Encounter Builder · Rotom Table' })
const route = useRoute()
const router = useRouter()
const maps = useMapLibraryData({ clientId: getClientId() })
const nonNegativeRevision = (value: unknown): number | null => typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : null
const handoff = computed<EncounterBuilderHandoffV2 | null>(() => {
  const packageId = typeof route.query.package === 'string' ? route.query.package : ''
  if (packageId) return {
    kind: route.query.kind === 'npc-package' || route.query.packageKind === 'npc' ? 'npc-package' : 'wild-package',
    documentId: packageId,
    expectedRevision: 0,
    sceneId: null,
  }
  const preparationId = typeof route.query.preparation === 'string' ? route.query.preparation : ''
  const sceneId = typeof route.query.scene === 'string' ? route.query.scene : ''
  const revision = nonNegativeRevision(route.query.revision)
  return preparationId && sceneId && revision !== null
    ? { kind: 'session-preparation', documentId: preparationId, expectedRevision: revision, sceneId }
    : null
})
const builder = useEncounterBuilder({
  handoff,
  maps: computed(() => [...maps.maps.values()]),
  initialMapSlug: typeof route.query.map === 'string' ? route.query.map : undefined,
})
const sourceKindLabel = computed(() => ({
  'wild-package': 'Wild package',
  'npc-package': 'NPC package',
  'session-preparation': 'Prepared scene',
}[builder.handoffProjection.value?.handoff.kind ?? 'wild-package']))
const returnPath = computed(() => builder.handoffProjection.value?.handoff.kind === 'session-preparation' ? '/session-prep' : builder.handoffProjection.value?.handoff.kind === 'npc-package' ? '/npc-trainers' : '/generate')
const sourceHeading = ref<HTMLElement | null>(null)
const launchBlockedReason = computed(() => {
  if (builder.packageLoading.value) return 'Wait for the immutable handoff to load.'
  if (builder.packageError.value || !builder.handoffProjection.value) return 'Reopen an accepted package or Ready preparation scene.'
  if (builder.mapLoading.value) return 'Wait for the current battlefield revision to load.'
  if (builder.mapError.value || !builder.map.value) return 'Choose a current prepared battlefield.'
  if (!builder.cast.value.length) return 'Keep at least one accepted cast member.'
  if (!builder.name.value.trim()) return 'Name the encounter.'
  return null
})
const handoffAnnouncement = computed(() => builder.packageLoading.value
  ? 'Loading immutable Builder handoff.'
  : builder.packageError.value
    ? `Builder handoff unavailable. ${builder.packageError.value}`
    : builder.handoffProjection.value
      ? `Ready for Builder. ${builder.handoffProjection.value.source.label} loaded with ${builder.handoffProjection.value.cast.length} cast members.`
      : '')
watch(() => builder.handoffProjection.value, async (loaded) => {
  if (!loaded) return
  await nextTick()
  sourceHeading.value?.focus()
})

const value = (event: Event): string => (event.target as HTMLInputElement | HTMLSelectElement).value
const checked = (event: Event): boolean => (event.target as HTMLInputElement).checked
const update = (member: EncounterBuilderDraftMember, patch: Partial<Pick<EncounterBuilderDraftMember, 'sideId' | 'role' | 'hidden'>>): void => builder.updateMember(member.castId, patch)
const launch = async (): Promise<void> => {
  const result = await builder.launch()
  if (result) await router.push(encounterWorkspacePath(result.encounterId))
}
const mapLabel = (map: { name: string; folder: string }): string => map.folder ? `${map.folder} / ${map.name}` : map.name
</script>

<template>
  <div class="encounter-builder rt-design-system" data-rt-design-system="1" data-rt-context="workshop">
    <header class="encounter-builder__global"><AppNavigation /></header>
    <main>
      <header class="encounter-builder__hero">
        <div>
          <p>Campaign Toolkit · Workshop</p>
          <h1>Encounter Builder</h1>
          <span>Review one immutable campaign handoff, then launch ordinary map and Encounter Document authority.</span>
        </div>
        <NuxtLink :to="returnPath">Return without launching</NuxtLink>
      </header>

      <OnboardingPartyCandidatesCard />

      <section class="encounter-builder__section encounter-builder__source" aria-labelledby="builder-package-heading" :aria-busy="builder.packageLoading.value">
        <header><span>1</span><div><h2 id="builder-package-heading" ref="sourceHeading" tabindex="-1">Ready for Builder</h2><p>The Builder resolves ordinary sheet references from this source. It never rerolls, copies mechanics, or trusts browser prose.</p></div></header>
        <p v-if="builder.packageLoading.value" role="status">Loading immutable handoff…</p>
        <div v-else-if="builder.packageError.value" class="encounter-builder__error" role="alert">
          <strong>Handoff unavailable</strong><span>{{ builder.packageError.value }}</span>
          <NuxtLink :to="returnPath">Return to the source workflow</NuxtLink>
        </div>
        <div v-else-if="builder.handoffProjection.value" class="encounter-builder__package">
          <div><span>Source</span><strong>{{ builder.handoffProjection.value.source.label }}</strong><small v-if="builder.handoffProjection.value.source.sceneLabel">{{ builder.handoffProjection.value.source.sceneLabel }}</small></div>
          <div><span>Source kind</span><strong>{{ sourceKindLabel }}</strong></div>
          <div><span>Accepted cast</span><strong>{{ builder.handoffProjection.value.cast.length }} members</strong></div>
          <div><span>Status</span><strong class="encounter-builder__valid">Current · immutable</strong></div>
        </div>
      </section>

      <section class="encounter-builder__section" aria-labelledby="builder-recipe-heading">
        <header><span>2</span><div><h2 id="builder-recipe-heading">Choose a recipe</h2><p>Recipes set presentation defaults; they never invent mechanics.</p></div></header>
        <div class="encounter-builder__recipes">
          <label v-for="recipe in builder.recipes" :key="recipe.recipeId" :data-selected="builder.recipeId.value === recipe.recipeId">
            <input v-model="builder.recipeId.value" type="radio" name="recipe" :value="recipe.recipeId">
            <strong>{{ recipe.label }}</strong><span>{{ recipe.description }}</span><small>{{ recipe.tactical }} tactics</small>
          </label>
        </div>
      </section>

      <section class="encounter-builder__section" aria-labelledby="builder-setup-heading">
        <header><span>3</span><div><h2 id="builder-setup-heading">Name and battlefield</h2><p>The exact map revision is revalidated inside the launch transaction. Internal routes remain derived and hidden.</p></div></header>
        <div class="encounter-builder__form-grid">
          <label>Encounter name<input v-model="builder.name.value" maxlength="200" required></label>
          <label>Battlefield <small v-if="builder.handoffProjection.value?.defaults.map">Preparation-pinned · current revision</small>
            <select v-model="builder.mapSlug.value" :disabled="maps.loading.value || Boolean(builder.handoffProjection.value?.defaults.map)">
              <option value="">Select battlefield…</option>
              <option v-for="map in builder.maps.value" :key="map.slug" :value="map.slug">{{ mapLabel(map) }}</option>
            </select>
          </label>
          <label>Stage presentation
            <select v-model="builder.presentationStage.value"><option value="standard">Standard battle stage</option><option value="boss">Boss stage</option><option value="chase">Chase stage</option></select>
          </label>
          <label>Tactical presentation
            <select v-model="builder.tacticalPresentation.value"><option value="on-demand">Open tactics on demand</option><option value="split">Start split-ready</option></select>
          </label>
          <label class="encounter-builder__check"><input v-model="builder.startInitiative.value" type="checkbox">Start initiative at round 1</label>
        </div>
        <p v-if="builder.mapLoading.value" role="status">Loading battlefield sides…</p>
        <p v-if="builder.mapError.value" role="alert" class="encounter-builder__error">{{ builder.mapError.value }}</p>
      </section>

      <section class="encounter-builder__section" aria-labelledby="builder-cast-heading">
        <header><span>4</span><div><h2 id="builder-cast-heading">Stage the cast</h2><p>Choose map side, tactical role, and initial visibility for each accepted sheet.</p></div></header>
        <ol class="encounter-builder__cast">
          <li v-for="member in builder.cast.value" :key="member.castId">
            <div class="encounter-builder__cast-id"><span>Accepted {{ member.sheet.kind === 'trainer' ? 'Trainer' : 'Pokémon' }}</span><strong>{{ member.displayName }}</strong><small v-if="member.displayLevel !== null">Level {{ member.displayLevel }}</small><small>{{ member.placementIntent.kind === 'map-zone' ? `Placement intent · ${member.placementIntent.zoneLabel}` : 'Placement intent · Builder default' }}</small></div>
            <label>Side
              <select :value="member.sideId ?? ''" @change="update(member, { sideId: value($event) || null })">
                <option value="">Unaligned</option><option v-for="side in builder.sides.value" :key="side.id" :value="side.id">{{ side.label }}</option>
              </select>
            </label>
            <label>Role
              <select :value="member.role" @change="update(member, { role: value($event) as EncounterBuilderDraftMember['role'] })">
                <option value="boss">Boss</option><option value="leader">Leader</option><option value="standard">Standard</option><option value="minion">Minion</option><option value="support">Support</option>
              </select>
            </label>
            <label class="encounter-builder__check"><input :checked="member.hidden" type="checkbox" @change="update(member, { hidden: checked($event) })">Hidden at launch</label>
            <button type="button" @click="builder.removeMember(member.castId)">Remove from this encounter</button>
          </li>
        </ol>
        <p v-if="builder.cast.value.length === 0" class="encounter-builder__empty">No package sheets are staged. Return to generation or reload the package.</p>
      </section>

      <section class="encounter-builder__section" aria-labelledby="builder-story-heading">
        <header><span>5</span><div><h2 id="builder-story-heading">Scene material and launch</h2><p>Public copy is projected to the table; GM stakes and notes remain structurally private.</p></div></header>
        <div v-if="builder.storyLocked.value" class="encounter-builder__locked"><strong>Scene material · Ready preparation</strong><span>These fields are resolved again from the immutable preparation revision during launch and are not editable here.</span></div>
        <div class="encounter-builder__story">
          <label>Player-safe stakes<textarea v-model="builder.publicStakes.value" rows="3" maxlength="4000" :disabled="builder.storyLocked.value"></textarea></label>
          <label>Private GM stakes<textarea v-model="builder.gmStakes.value" rows="3" maxlength="4000" :disabled="builder.storyLocked.value"></textarea></label>
          <label>Private GM notes<textarea v-model="builder.notes.value" rows="4" maxlength="20000" :disabled="builder.storyLocked.value"></textarea></label>
        </div>
        <p v-if="launchBlockedReason" class="encounter-builder__blocked-reason" role="status"><strong>Launch unavailable.</strong> {{ launchBlockedReason }}</p>
        <div class="encounter-builder__review">
          <div><strong>{{ builder.name.value }}</strong><span>{{ builder.recipe.value.label }} · {{ builder.cast.value.length }} cast</span></div>
          <div><span>Battlefield</span><strong>{{ builder.map.value?.name || 'Not selected' }}</strong></div>
          <div><span>Authority</span><strong>Atomic map + Encounter Document</strong></div>
          <button type="button" :disabled="!builder.canLaunch.value" @click="launch">{{ builder.launching.value ? 'Launching…' : 'Launch encounter' }}</button>
        </div>
        <p v-if="builder.error.value" role="alert" class="encounter-builder__error">{{ builder.error.value }}</p>
      </section>
      <p class="sr-only" aria-live="polite">{{ handoffAnnouncement }}</p>
    </main>
  </div>
</template>

<style scoped>
.encounter-builder { min-height: 100dvh; padding: var(--rt-space-3); overflow-wrap: anywhere; background: var(--rt-bg-canvas); color: var(--rt-text); }
.encounter-builder__global, .encounter-builder main { max-width: 92rem; margin-inline: auto; }
.encounter-builder main { display: grid; gap: var(--rt-space-4); }
.encounter-builder__hero { display: flex; align-items: end; justify-content: space-between; gap: 1rem; padding: clamp(1rem, 3vw, 2.5rem); border: 1px solid var(--rt-rule); background: var(--rt-surface-1); }
.encounter-builder__hero p { margin: 0; color: var(--rt-info); font-size: var(--rt-type-label-sm-size); font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }
.encounter-builder__hero h1 { margin: .2rem 0; font-size: var(--rt-type-display-lg-size); }
.encounter-builder__hero span { color: var(--rt-text-muted); }
.encounter-builder a, .encounter-builder button { min-height: var(--rt-touch-minimum); display: inline-flex; align-items: center; justify-content: center; padding: .5rem .75rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text-strong); font: inherit; font-weight: 700; text-decoration: none; cursor: pointer; }
.encounter-builder button:focus-visible, .encounter-builder a:focus-visible, .encounter-builder input:focus-visible, .encounter-builder select:focus-visible, .encounter-builder textarea:focus-visible, .encounter-builder h2[tabindex]:focus-visible { outline: 2px solid var(--rt-focus); outline-offset: 2px; }
.encounter-builder__section { padding: clamp(1rem, 2vw, 1.5rem); border: 1px solid var(--rt-rule); background: var(--rt-surface-1); box-shadow: var(--rt-elevation-1); }
.encounter-builder__source { border-inline-start: 3px solid var(--rt-success); }
.encounter-builder__section > header { display: flex; align-items: center; gap: .8rem; margin-bottom: 1rem; }
.encounter-builder__section > header > span { display: grid; place-items: center; width: 2.25rem; height: 2.25rem; flex: none; border-radius: 50%; background: var(--rt-info); color: var(--rt-on-brand); font-weight: 800; }
.encounter-builder__section h2, .encounter-builder__section header p { margin: 0; }
.encounter-builder__section header p { color: var(--rt-text-muted); }
.encounter-builder__package, .encounter-builder__review { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1rem; padding: 1rem; border: 1px solid var(--rt-rule); background: var(--rt-surface-2); }
.encounter-builder__package div, .encounter-builder__review div { display: grid; gap: .2rem; }
.encounter-builder__package span, .encounter-builder__package small, .encounter-builder__review span { color: var(--rt-text-muted); }
.encounter-builder__valid { color: var(--rt-success); }
.encounter-builder__recipes { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: .6rem; }
.encounter-builder__recipes label { position: relative; display: grid; align-content: start; gap: .45rem; min-height: 9rem; padding: .8rem; border: 1px solid var(--rt-rule); background: var(--rt-surface-2); cursor: pointer; }
.encounter-builder__recipes label[data-selected='true'] { border-color: var(--rt-focus); box-shadow: 0 0 0 2px color-mix(in srgb, var(--rt-focus) 25%, transparent); }
.encounter-builder__recipes label:focus-within { outline: 2px solid var(--rt-focus); outline-offset: 2px; }
.encounter-builder__recipes input { position: absolute; inset: 0 auto auto 0; width: 1px; min-width: 1px; height: 1px; min-height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; opacity: 0; }
.encounter-builder__recipes span, .encounter-builder__recipes small { color: var(--rt-text-muted); }
.encounter-builder__form-grid, .encounter-builder__story { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: .75rem; }
.encounter-builder label { display: grid; gap: .3rem; color: var(--rt-text-muted); font-size: var(--rt-type-label-sm-size); }
.encounter-builder input, .encounter-builder select, .encounter-builder textarea { box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%; min-height: var(--rt-touch-minimum); padding: .5rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-bg-canvas); color: var(--rt-text); font: inherit; }
.encounter-builder__cast { display: grid; gap: .6rem; margin: 0; padding: 0; list-style: none; }
.encounter-builder__cast li { display: grid; grid-template-columns: minmax(10rem, 1.4fr) repeat(3, minmax(8rem, 1fr)) auto; gap: .6rem; align-items: end; padding: .75rem; border-inline-start: 3px solid var(--rt-success); background: var(--rt-surface-2); }
.encounter-builder__cast-id { display: grid; align-self: center; }
.encounter-builder__cast-id span, .encounter-builder__cast-id small { color: var(--rt-text-muted); }
.encounter-builder__check { display: flex !important; align-items: center; min-height: var(--rt-touch-minimum); }
.encounter-builder__check input { width: auto; min-height: auto; }
.encounter-builder__empty { color: var(--rt-text-muted); }
.encounter-builder__locked { display: grid; gap: .25rem; margin-bottom: .75rem; padding: .75rem; border-inline-start: 3px solid var(--rt-pending); background: color-mix(in srgb, var(--rt-pending) 8%, var(--rt-surface-1)); }
.encounter-builder__locked span { color: var(--rt-text-muted); }
.encounter-builder textarea:disabled, .encounter-builder select:disabled { opacity: .7; cursor: not-allowed; }
.encounter-builder__blocked-reason { margin: 1rem 0 0; padding: .65rem .75rem; border-inline-start: 3px solid var(--rt-pending); background: color-mix(in srgb, var(--rt-pending) 8%, var(--rt-surface-1)); color: var(--rt-text-muted); }
.encounter-builder__blocked-reason strong { color: var(--rt-text-strong); }
.encounter-builder__review { grid-template-columns: repeat(3, minmax(0, 1fr)) auto; align-items: center; margin-top: 1rem; }
.encounter-builder__review button { border-color: var(--rt-danger); background: var(--rt-danger); color: var(--rt-on-brand); }
.encounter-builder__review button:disabled { opacity: .5; cursor: not-allowed; }
.encounter-builder__error { display: grid; gap: .3rem; padding: .7rem; border-inline-start: 3px solid var(--rt-danger); background: color-mix(in srgb, var(--rt-danger) 10%, var(--rt-surface-1)); }
@media (max-width: 70rem) { .encounter-builder__cast li { grid-template-columns: repeat(2, minmax(0, 1fr)); } .encounter-builder__review, .encounter-builder__package { grid-template-columns: 1fr 1fr; } }
@media (max-width: 42rem) { .encounter-builder { padding: 0; overflow-x: clip; } .encounter-builder main { padding-bottom: calc(6rem + env(safe-area-inset-bottom)); } .encounter-builder__hero { align-items: stretch; flex-direction: column; } .encounter-builder__recipes, .encounter-builder__form-grid, .encounter-builder__story, .encounter-builder__cast li, .encounter-builder__review, .encounter-builder__package { grid-template-columns: minmax(0, 1fr); } .encounter-builder__review button { width: 100%; } }
</style>
