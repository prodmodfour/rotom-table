<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { PhArchive, PhArrowClockwise, PhArrowDown, PhArrowUp, PhCheck, PhClipboardText, PhCopy, PhFilePlus, PhLockKey, PhPlus, PhTrash, PhWarning } from '@phosphor-icons/vue'
import AppNavigation from '~/components/AppNavigation.vue'
import EncounterToolkitNavigation from '~/components/encounters/EncounterToolkitNavigation.vue'
import { useAuth } from '~/composables/useAuth'
import { useSessionPreparationToolkit } from '~/composables/encounters/useSessionPreparationToolkit'

useHead({ title: 'Campaign Toolkit · Session prep · Rotom Table' })
const { isGm } = useAuth()
const route = useRoute()
const initialPreparationId = typeof route.query.preparation === 'string' ? route.query.preparation : null
const newTitle = ref('')
const importSource = ref('')
const addSources = reactive<Record<string, string>>({})
const {
  preparations, visiblePreparations, selected, draft, tables, maps, trainers, pokemon, pendingPackage,
  loading, saving, error, conflict, announcement, search, status, dirty, readinessReasons, canEdit, canReady,
  refresh, selectPreparation: selectPreparationAuthority, createPreparation, save,
  transition: transitionAuthority, copySelected, importAllScenes, terminate,
  addScene, removeScene, moveScene, addTableCandidate, addExistingSheetCandidate, addPendingPackage, removeCandidate,
  addHandout, removeHandout, addDecision, removeDecision, setDecisionState, loadPackage, reloadAfterConflict,
} = useSessionPreparationToolkit({ initialPreparationId, enabled: isGm.value })

const canvasHeading = ref<HTMLElement | null>(null)
const readinessHeading = ref<HTMLElement | null>(null)
const sourcePreparations = computed(() => preparations.value.filter(row => row.preparationId !== selected.value?.preparationId && row.lifecycle !== 'cancelled'))
const scheduledLocal = computed({
  get: () => draft.value?.scheduledFor?.slice(0, 16) ?? '',
  set: (value: string) => { if (draft.value) draft.value.scheduledFor = value ? new Date(value).toISOString() : null },
})
const createNew = async (): Promise<void> => {
  if (!newTitle.value.trim() || !await createPreparation(newTitle.value)) return
  newTitle.value = ''
  await nextTick()
  canvasHeading.value?.focus()
}
const selectPreparation = async (row: (typeof preparations.value)[number]): Promise<void> => {
  await selectPreparationAuthority(row)
  await nextTick()
  canvasHeading.value?.focus()
}
const transition = async (target: 'draft' | 'review' | 'ready'): Promise<void> => {
  await transitionAuthority(target)
  await nextTick()
  if (target === 'ready') readinessHeading.value?.focus()
  else canvasHeading.value?.focus()
}
const assignMap = (sceneIndex: number, slug: string): void => {
  const scene = draft.value?.scenes[sceneIndex]; if (!scene) return
  const map = maps.value.find(row => row.slug === slug); scene.map = map ? { slug: map.slug, revision: map.revision ?? 0 } : null
}
const addSource = (sceneIndex: number, value: string): void => {
  if (!value) return
  const [kind, ...rest] = value.split('|'); const identity = rest.join('|')
  if (kind === 'table') addTableCandidate(sceneIndex, identity)
  if (kind === 'trainer' || kind === 'pokemon') addExistingSheetCandidate(sceneIndex, kind, identity)
  const sceneId = draft.value?.scenes[sceneIndex]?.sceneId; if (sceneId) addSources[sceneId] = ''
}
const lifecycleLabel = (value: string): string => ({ draft: 'Draft', review: 'In review', ready: 'Ready', launched: 'Launched', archived: 'Archived', cancelled: 'Cancelled' }[value] ?? value)
const dateLabel = (value: string | null): string => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'No session date'
const candidateSourceLabel = (kind: string): string => ({ 'wild-package': 'Generated wild package', 'npc-package': 'Generated NPC package', 'encounter-table': 'Campaign table', 'existing-sheets': 'Existing sheet' }[kind] ?? 'Campaign source')
const sceneHasLaunch = (sceneId: string): boolean => Boolean(selected.value?.launches.some(row => row.sceneId === sceneId))
const sceneCanOpenBuilder = (sceneId: string): boolean => Boolean(selected.value && ['ready', 'launched'].includes(selected.value.lifecycle) && !sceneHasLaunch(sceneId))
const builderLink = (sceneId: string) => ({ path: '/encounters/new', query: { preparation: selected.value?.preparationId, revision: selected.value?.revision, scene: sceneId } })

watch(() => [route.query.packageKind, route.query.package] as const, ([kind, packageId]) => {
  if ((kind === 'wild' || kind === 'npc') && typeof packageId === 'string') void loadPackage(kind, packageId)
}, { immediate: true })
</script>

<template>
  <div class="toolkit-page">
    <AppNavigation />
    <header class="toolkit-header">
      <div class="toolkit-title">
        <div><p class="eyebrow">GM Workshop</p><h1>Campaign Toolkit</h1></div>
        <button class="icon-action" type="button" aria-label="Refresh session preparations" :disabled="loading" @click="refresh(true)"><PhArrowClockwise :size="20" :class="{ spinning: loading }" aria-hidden="true" /></button>
      </div>
      <p class="toolkit-subtitle">Compose private scenes, reviewed encounter material, and player-safe handouts before opening ordinary liveplay authority.</p>
      <EncounterToolkitNavigation active="session" />
    </header>

    <main v-if="isGm" class="prep-workspace">
      <div v-if="error" class="notice notice--error" role="alert"><PhWarning :size="22" weight="fill" aria-hidden="true" /><div><strong>Session prep could not finish</strong><span>{{ error }}</span></div></div>
      <div v-if="conflict" class="notice notice--conflict" role="alert"><PhWarning :size="22" weight="fill" aria-hidden="true" /><div><strong>Another GM changed this preparation</strong><span>{{ conflict }}</span></div><button type="button" @click="reloadAfterConflict">Reload accepted revision</button></div>
      <div v-if="pendingPackage" class="package-banner" role="status">
        <div><strong>Generated package ready to add</strong><span>{{ pendingPackage.label }} · {{ pendingPackage.detail }}</span></div>
        <span>Choose a scene, then use “Add generated package”.</span>
      </div>

      <div class="prep-grid">
        <aside class="library-panel" aria-labelledby="prep-library-heading">
          <div class="panel-heading"><div><p class="section-kicker">Campaign plans</p><h2 id="prep-library-heading">Session prep</h2></div><PhClipboardText :size="26" weight="duotone" aria-hidden="true" /></div>
          <form class="new-session" @submit.prevent="createNew">
            <label><span>New session title</span><input v-model="newTitle" maxlength="160" placeholder="Name the next session" :disabled="saving"></label>
            <button type="submit" :disabled="!newTitle.trim() || saving"><PhFilePlus :size="18" aria-hidden="true" />New session</button>
          </form>
          <div class="library-filters">
            <label><span class="sr-only">Search preparations</span><input v-model="search" type="search" placeholder="Search sessions"></label>
            <label><span class="sr-only">Filter preparation status</span><select v-model="status"><option value="active">Active</option><option value="draft">Draft</option><option value="review">In review</option><option value="ready">Ready</option><option value="launched">Launched</option><option value="archived">Archived</option><option value="cancelled">Cancelled</option><option value="all">All</option></select></label>
          </div>
          <div class="preparation-list">
            <button v-for="row in visiblePreparations" :key="row.preparationId" type="button" class="prep-card" :class="{ 'prep-card--selected': selected?.preparationId === row.preparationId }" :aria-current="selected?.preparationId === row.preparationId ? 'true' : undefined" @click="selectPreparation(row)">
              <span class="status-chip" :data-status="row.lifecycle">{{ lifecycleLabel(row.lifecycle) }}</span><strong>{{ row.title }}</strong><small>{{ dateLabel(row.scheduledFor) }}</small>
              <span>{{ row.sceneCount }} scene{{ row.sceneCount === 1 ? '' : 's' }} · {{ row.openDecisionCount }} open decision{{ row.openDecisionCount === 1 ? '' : 's' }}</span>
            </button>
            <div v-if="!visiblePreparations.length && !loading" class="small-empty">No preparations match this view.</div>
          </div>
        </aside>

        <section class="canvas-panel" aria-labelledby="prep-canvas-heading">
          <div v-if="!selected || !draft" class="empty-state"><PhClipboardText :size="40" weight="duotone" aria-hidden="true" /><h2 id="prep-canvas-heading" ref="canvasHeading" tabindex="-1">Start a session preparation</h2><p>Create a private campaign plan or choose one from the library.</p></div>
          <template v-else>
            <div class="canvas-header">
              <div><p class="section-kicker">{{ lifecycleLabel(selected.lifecycle) }} · {{ dirty ? 'Unsaved changes' : 'Saved' }}</p><h2 id="prep-canvas-heading" ref="canvasHeading" tabindex="-1">{{ selected.title }}</h2><p>Preparation is private and never becomes live encounter authority.</p></div>
              <div class="header-actions"><button type="button" :disabled="saving" @click="copySelected"><PhCopy :size="17" aria-hidden="true" />Copy</button><button v-if="!['archived', 'cancelled'].includes(selected.lifecycle)" type="button" class="danger-quiet" :disabled="saving" @click="terminate(selected.lifecycle === 'launched' ? 'archive' : 'cancel')"><PhArchive :size="17" aria-hidden="true" />{{ selected.lifecycle === 'launched' ? 'Archive' : 'Cancel' }}</button></div>
            </div>

            <fieldset class="overview-grid" :disabled="!canEdit || saving">
              <label><span>Session title</span><input v-model="draft.title" maxlength="160"></label>
              <label><span>Planned date</span><input v-model="scheduledLocal" type="datetime-local"></label>
              <label class="wide player-safe"><span>Player-safe overview</span><textarea v-model="draft.playerOverview" rows="3" maxlength="8000" placeholder="What players may see after launch" /></label>
              <label class="wide private-field"><span>Private GM notes</span><textarea v-model="draft.gmNotes" rows="4" maxlength="16000" placeholder="Pacing, secrets, boundaries, and reminders" /></label>
            </fieldset>

            <div class="scene-toolbar">
              <div><h3>Ordered scenes</h3><span>{{ draft.scenes.length }} of 20 scenes</span></div>
              <div class="import-controls">
                <select v-model="importSource" aria-label="Preparation to import scenes from" :disabled="!canEdit || saving"><option value="">Import from another session…</option><option v-for="row in sourcePreparations" :key="row.preparationId" :value="row.preparationId">{{ row.title }}</option></select>
                <button type="button" :disabled="!canEdit || !importSource || saving" @click="importAllScenes(importSource)">Import scenes</button>
                <button type="button" :disabled="!canEdit || draft.scenes.length >= 20 || saving" @click="addScene"><PhPlus :size="17" aria-hidden="true" />Add scene</button>
              </div>
            </div>

            <div v-if="draft.scenes.length" class="scene-list">
              <article v-for="(scene, sceneIndex) in draft.scenes" :key="scene.sceneId" class="scene-card">
                <header>
                  <div class="scene-number">{{ sceneIndex + 1 }}</div><input v-model="scene.title" maxlength="160" :disabled="!canEdit || saving" aria-label="Scene title">
                  <div class="order-actions"><NuxtLink v-if="sceneCanOpenBuilder(scene.sceneId)" class="builder-link" :to="builderLink(scene.sceneId)">Open in Builder</NuxtLink><span v-else-if="sceneHasLaunch(scene.sceneId)" class="launched-mark"><PhCheck :size="16" aria-hidden="true" />Launched</span><button type="button" :disabled="!canEdit || sceneIndex === 0" :aria-label="`Move ${scene.title} up`" @click="moveScene(sceneIndex, -1)"><PhArrowUp :size="17" aria-hidden="true" /></button><button type="button" :disabled="!canEdit || sceneIndex === draft.scenes.length - 1" :aria-label="`Move ${scene.title} down`" @click="moveScene(sceneIndex, 1)"><PhArrowDown :size="17" aria-hidden="true" /></button><button type="button" class="remove-action" :disabled="!canEdit" :aria-label="`Remove ${scene.title}`" @click="removeScene(sceneIndex)"><PhTrash :size="17" aria-hidden="true" /></button></div>
                </header>
                <div class="scene-copy">
                  <label class="player-safe"><span>Player-safe summary</span><textarea v-model="scene.playerSummary" rows="3" maxlength="4000" :disabled="!canEdit || saving" /></label>
                  <label class="private-field"><span>Private GM notes</span><textarea v-model="scene.gmNotes" rows="3" maxlength="8000" :disabled="!canEdit || saving" /></label>
                </div>
                <label class="map-field"><span>Scene map</span><select :value="scene.map?.slug ?? ''" :disabled="!canEdit || saving" @change="assignMap(sceneIndex, ($event.target as HTMLSelectElement).value)"><option value="">Choose later</option><option v-for="map in maps" :key="map.slug" :value="map.slug">{{ map.name }}</option></select></label>

                <section class="candidates" :aria-labelledby="`candidate-heading-${sceneIndex}`">
                  <div class="candidate-heading"><div><h4 :id="`candidate-heading-${sceneIndex}`">Encounter candidates</h4><span>Review every option before readying.</span></div><span>{{ scene.encounterCandidates.length }}</span></div>
                  <div v-for="(candidate, candidateIndex) in scene.encounterCandidates" :key="candidate.candidateId" class="candidate-row" :data-selection="candidate.selection">
                    <div><strong>{{ candidate.label }}</strong><span>{{ candidateSourceLabel(candidate.source.kind) }}</span></div>
                    <label><span class="sr-only">Decision for {{ candidate.label }}</span><select v-model="candidate.selection" :aria-label="`Decision for ${candidate.label}`" :disabled="!canEdit || saving"><option value="option">Option · pending</option><option value="selected">Selected</option><option value="excluded">Excluded</option></select></label>
                    <label class="candidate-note"><span class="sr-only">Private note for {{ candidate.label }}</span><input v-model="candidate.gmNotes" maxlength="4000" :aria-label="`Private note for ${candidate.label}`" placeholder="Private placement or use note" :disabled="!canEdit || saving"></label>
                    <button type="button" class="remove-action" :disabled="!canEdit" :aria-label="`Remove ${candidate.label}`" @click="removeCandidate(sceneIndex, candidateIndex)"><PhTrash :size="17" aria-hidden="true" /></button>
                  </div>
                  <div class="add-candidate">
                    <select v-model="addSources[scene.sceneId]" :aria-label="`Campaign material for ${scene.title}`" :disabled="!canEdit || saving"><option value="">Add campaign material…</option><optgroup label="Campaign tables"><option v-for="table in tables" :key="table.tableId" :value="`table|${table.tableId}`">{{ table.name }}</option></optgroup><optgroup label="Existing Trainers"><option v-for="trainer in trainers" :key="trainer.slug" :value="`trainer|${trainer.slug}`">{{ trainer.name }}</option></optgroup><optgroup label="Existing Pokémon"><option v-for="sheet in pokemon" :key="sheet.slug" :value="`pokemon|${sheet.slug}`">{{ sheet.nickname || sheet.species }}</option></optgroup></select>
                    <button type="button" :disabled="!canEdit || !addSources[scene.sceneId] || saving" @click="addSource(sceneIndex, addSources[scene.sceneId] ?? '')">Add source</button>
                    <button v-if="pendingPackage" type="button" class="package-action" :disabled="!canEdit || saving" @click="addPendingPackage(sceneIndex)">Add generated package</button>
                  </div>
                </section>
              </article>
            </div>
            <div v-else class="scene-empty"><strong>No scenes yet</strong><span>Add a scene to begin structuring this session.</span><button type="button" :disabled="!canEdit" @click="addScene">Add first scene</button></div>
          </template>
        </section>

        <aside class="readiness-panel" aria-labelledby="readiness-heading">
          <template v-if="selected && draft">
            <div class="panel-heading"><div><p class="section-kicker">Review gate</p><h2 id="readiness-heading" ref="readinessHeading" tabindex="-1">Ready for Builder</h2></div><span class="status-chip" :data-status="selected.lifecycle">{{ lifecycleLabel(selected.lifecycle) }}</span></div>
            <div class="readiness-copy"><strong>{{ readinessReasons.length ? 'Preparation needs attention' : 'Preparation checks pass' }}</strong><p>Ready status does not launch a map or Encounter Document.</p><ul v-if="readinessReasons.length"><li v-for="reason in readinessReasons" :key="reason">{{ reason }}</li></ul><p v-else class="valid-note"><PhCheck :size="18" weight="bold" aria-hidden="true" />All bounded decisions are reviewed.</p></div>

            <section class="rail-section" aria-labelledby="decision-heading">
              <div class="rail-heading"><h3 id="decision-heading">Unresolved decisions</h3><button type="button" :disabled="!canEdit || draft.unresolvedDecisions.length >= 50" aria-label="Add unresolved decision" @click="addDecision"><PhPlus :size="17" aria-hidden="true" /></button></div>
              <div v-for="(decision, index) in draft.unresolvedDecisions" :key="decision.decisionId" class="decision-card" :class="{ resolved: decision.state === 'resolved' }">
                <input v-model="decision.headline" maxlength="160" :disabled="!canEdit" aria-label="Decision headline"><textarea v-model="decision.prompt" rows="2" maxlength="2000" :disabled="!canEdit" aria-label="Decision prompt" />
                <label v-if="decision.state === 'resolved'"><span>Resolution</span><textarea v-model="decision.resolution" rows="2" maxlength="4000" :disabled="!canEdit" /></label>
                <div class="card-actions"><button type="button" :disabled="!canEdit" @click="setDecisionState(index, decision.state !== 'resolved')">{{ decision.state === 'resolved' ? 'Reopen decision' : 'Mark resolved' }}</button><button type="button" class="remove-action" :disabled="!canEdit" @click="removeDecision(index)">Remove</button></div>
              </div>
              <p v-if="!draft.unresolvedDecisions.length" class="rail-empty">No decisions are waiting.</p>
            </section>

            <section class="rail-section" aria-labelledby="handout-heading">
              <div class="rail-heading"><h3 id="handout-heading">Handouts</h3><button type="button" :disabled="!canEdit || draft.handouts.length >= 50" aria-label="Add handout" @click="addHandout"><PhPlus :size="17" aria-hidden="true" /></button></div>
              <details v-for="(handout, handoutIndex) in draft.handouts" :key="handout.handoutId" class="handout-card"><summary>{{ handout.title }}</summary><label><span>Title</span><input v-model="handout.title" maxlength="160" :disabled="!canEdit"></label><label class="player-safe"><span>Player-safe text</span><textarea v-model="handout.playerText" rows="3" maxlength="12000" :disabled="!canEdit" /></label><label class="private-field"><span>Private GM notes</span><textarea v-model="handout.gmNotes" rows="2" maxlength="4000" :disabled="!canEdit" /></label><label><span>Release</span><select v-model="handout.release" :disabled="!canEdit"><option value="withheld">Withheld</option><option value="on-launch">On launch</option></select></label><button type="button" class="remove-action handout-remove" :disabled="!canEdit" @click="removeHandout(handoutIndex)">Remove handout</button></details>
              <p v-if="!draft.handouts.length" class="rail-empty">No handouts attached.</p>
            </section>

            <div class="primary-actions">
              <button class="save-action" type="button" :disabled="!canEdit || !dirty || saving" @click="save">{{ saving ? 'Saving…' : 'Save changes' }}</button>
              <button v-if="selected.lifecycle === 'draft'" type="button" :disabled="dirty || saving" @click="transition('review')">Send to review</button>
              <template v-else-if="selected.lifecycle === 'review'"><button class="ready-action" type="button" :disabled="!canReady || saving" @click="transition('ready')"><PhCheck :size="18" aria-hidden="true" />Ready for Builder</button><button type="button" :disabled="dirty || saving" @click="transition('draft')">Return to draft</button></template>
              <button v-else-if="selected.lifecycle === 'ready'" type="button" :disabled="saving" @click="transition('review')">Reopen review</button>
            </div>
          </template>
          <div v-else class="rail-empty centered">Readiness and private attention appear after you choose a preparation.</div>
        </aside>
      </div>
    </main>

    <main v-else class="access-gate"><PhLockKey :size="42" weight="duotone" aria-hidden="true" /><h2>GM preparation workspace</h2><p>Private session scenes, candidate options, and notes are available only to the active GM.</p></main>
    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
  </div>
</template>

<style scoped>
.toolkit-page { min-height: 100vh; background: radial-gradient(circle at 72% -8%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 30rem), var(--paper); color: var(--ink); }
.toolkit-header { border-bottom: 1px solid var(--rule); padding: 1.5rem clamp(1rem, 4vw, 3rem) 0; background: color-mix(in srgb, var(--paper-soft) 90%, transparent); }.toolkit-title { display: flex; justify-content: space-between; gap: 1rem; }.eyebrow,.section-kicker { margin: 0 0 .3rem; color: var(--accent); font: 800 .72rem var(--font-mono); letter-spacing: .13em; text-transform: uppercase; }h1 { margin: 0; font-size: clamp(1.8rem,4vw,3rem); letter-spacing: -.035em; }h2,h3,h4 { margin: 0; color: var(--ink-bright); }.toolkit-subtitle { max-width: 780px; margin: .65rem 0 1.25rem; color: var(--ink-muted); line-height: 1.55; }
.icon-action { width: 44px; min-height: 44px; display: grid; place-items: center; border: 1px solid var(--rule); border-radius: 9px; background: var(--paper-soft); color: var(--ink); cursor: pointer; }.spinning { animation: spin .8s linear infinite; }@keyframes spin { to { transform: rotate(360deg); } }
.prep-workspace { max-width: 1800px; margin: 0 auto; padding: .9rem clamp(.6rem,1.5vw,1.2rem) 2rem; }.notice,.package-banner { display: flex; align-items: center; gap: .7rem; margin-bottom: .7rem; border: 1px solid var(--rule); border-radius: 9px; padding: .7rem .8rem; background: var(--paper-soft); }.notice { border-left: 4px solid var(--rt-danger,#ff4553); }.notice--conflict,.package-banner { border-left: 4px solid var(--rt-pending,#efb34c); }.notice > div,.package-banner > div { display: grid; gap: .15rem; flex: 1; }.notice span,.package-banner span { color: var(--ink-muted); font-size: .8rem; }.notice button { min-height: 44px; }.prep-grid { display: grid; grid-template-columns: minmax(235px,280px) minmax(520px,1fr) minmax(270px,320px); align-items: start; gap: .7rem; }
.library-panel,.canvas-panel,.readiness-panel { border: 1px solid var(--rule); border-radius: 11px; background: var(--paper-soft); box-shadow: var(--shadow-card); }.library-panel,.readiness-panel { position: sticky; top: .6rem; max-height: calc(100vh - 1.2rem); overflow: auto; padding: .85rem; }.canvas-panel { min-height: 62vh; padding: .9rem; }.panel-heading { display: flex; justify-content: space-between; gap: .6rem; align-items: flex-start; padding-bottom: .7rem; border-bottom: 1px solid var(--rule); }.panel-heading svg { color: var(--accent); }
.new-session { display: grid; gap: .45rem; margin: .75rem 0; padding-bottom: .75rem; border-bottom: 1px solid var(--rule); }.new-session label,.overview-grid label,.scene-copy label,.map-field,.handout-card label,.decision-card label { display: grid; gap: .3rem; font-size: .76rem; font-weight: 750; }.new-session button,.import-controls button,.add-candidate button,.scene-empty button,.primary-actions button,.header-actions button,.decision-card button { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: .35rem; border: 1px solid var(--rule); border-radius: 8px; padding: .5rem .65rem; background: var(--paper); color: var(--ink); font: inherit; font-weight: 750; cursor: pointer; }.new-session button,.package-action { border-color: var(--accent)!important; color: var(--accent)!important; }.library-filters { display: grid; grid-template-columns: 1fr auto; gap: .35rem; }.library-filters input,.library-filters select,.new-session input { width: 100%; min-height: 44px; }.preparation-list { display: grid; gap: .45rem; margin-top: .65rem; }.prep-card { width: 100%; display: grid; gap: .22rem; border: 1px solid var(--rule); border-radius: 8px; padding: .65rem; background: var(--paper); color: var(--ink); text-align: left; cursor: pointer; }.prep-card--selected { border-color: var(--accent); box-shadow: inset 3px 0 var(--accent); }.prep-card small,.prep-card > span:last-child { color: var(--ink-muted); font-size: .7rem; }.status-chip { justify-self: start; border: 1px solid var(--rule); border-radius: 999px; padding: .16rem .42rem; color: var(--ink-muted); font: 750 .64rem var(--font-mono); text-transform: uppercase; }.status-chip[data-status='review'] { border-color: var(--rt-pending,#efb34c); color: var(--rt-pending,#efb34c); }.status-chip[data-status='ready'],.status-chip[data-status='launched'] { border-color: var(--rt-success,#64d6aa); color: var(--rt-success,#64d6aa); }
.canvas-header { display: flex; justify-content: space-between; gap: 1rem; padding-bottom: .8rem; border-bottom: 1px solid var(--rule); }.canvas-header p { margin: .3rem 0 0; color: var(--ink-muted); font-size: .78rem; }.header-actions { display: flex; flex-wrap: wrap; gap: .35rem; }.danger-quiet,.remove-action { color: var(--rt-danger,#ff4553)!important; }.overview-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .65rem; margin: .8rem 0; border: 0; padding: 0; }.wide { grid-column: 1 / -1; }.player-safe > span { color: var(--rt-success,#64d6aa); }.private-field > span { color: var(--accent); }.scene-toolbar { display: flex; justify-content: space-between; align-items: end; gap: .7rem; margin: 1rem 0 .6rem; }.scene-toolbar span,.candidate-heading span,.roster-heading span { color: var(--ink-muted); font-size: .72rem; }.import-controls { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .35rem; }.import-controls select { min-height: 44px; max-width: 210px; }.scene-list { display: grid; gap: .7rem; }.scene-card { border: 1px solid var(--rule); border-radius: 10px; background: var(--paper); overflow: hidden; }.scene-card > header { display: grid; grid-template-columns: auto minmax(0,1fr) auto; gap: .5rem; align-items: center; border-bottom: 1px solid var(--rule); padding: .55rem .65rem; }.scene-number { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 50%; background: color-mix(in srgb,var(--accent) 12%,transparent); color: var(--accent); font-weight: 850; }.scene-card > header input { min-height: 44px; border: 0; background: transparent; color: var(--ink-bright); font: 800 1rem inherit; }.order-actions { display: flex; align-items: center; gap: .15rem; }.order-actions button,.candidate-row > button,.rail-heading button { width: 44px; min-height: 44px; display: grid; place-items: center; border: 1px solid transparent; background: transparent; color: var(--ink-muted); cursor: pointer; }.builder-link,.launched-mark { min-height: 44px; display: inline-flex; align-items: center; gap: .3rem; border: 1px solid var(--accent); border-radius: 7px; padding: .4rem .6rem; color: var(--accent); font-size: .72rem; font-weight: 800; text-decoration: none; white-space: nowrap; }.launched-mark { border-color: var(--rt-success,#64d6aa); color: var(--rt-success,#64d6aa); }.scene-copy { display: grid; grid-template-columns: 1fr 1fr; gap: .6rem; padding: .65rem; }.map-field { margin: 0 .65rem .65rem; }.candidates { border-top: 1px solid var(--rule); padding: .65rem; background: color-mix(in srgb,var(--paper-soft) 55%,transparent); }.candidate-heading,.rail-heading { display: flex; justify-content: space-between; align-items: center; gap: .5rem; }.candidate-heading > span { border: 1px solid var(--rule); border-radius: 999px; padding: .15rem .4rem; }.candidate-row { display: grid; grid-template-columns: minmax(130px,.8fr) 145px minmax(150px,1fr) auto; align-items: center; gap: .4rem; margin-top: .4rem; border: 1px solid var(--rule); border-left: 3px solid var(--rt-pending,#efb34c); border-radius: 7px; padding: .45rem; background: var(--paper); }.candidate-row[data-selection='selected'] { border-left-color: var(--accent); }.candidate-row[data-selection='excluded'] { border-left-color: var(--ink-muted); background: color-mix(in srgb, var(--paper-soft) 72%, var(--paper)); }.candidate-row > div { display: grid; gap: .1rem; }.candidate-row > div span { color: var(--ink-muted); font-size: .68rem; }.candidate-note input { width: 100%; }.add-candidate { display: grid; grid-template-columns: minmax(160px,1fr) auto auto; gap: .35rem; margin-top: .5rem; }.scene-empty,.empty-state { min-height: 22rem; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .4rem; color: var(--ink-muted); text-align: center; }.scene-empty { min-height: 10rem; border: 1px dashed var(--rule); border-radius: 9px; }
.readiness-copy { margin: .75rem 0; border-left: 3px solid var(--rt-pending,#efb34c); padding: .55rem .65rem; background: color-mix(in srgb,var(--rt-pending,#efb34c) 6%,transparent); }.readiness-copy p { margin: .25rem 0; color: var(--ink-muted); font-size: .74rem; line-height: 1.4; }.readiness-copy ul { margin: .45rem 0 0; padding-left: 1.1rem; color: var(--rt-pending,#efb34c); font-size: .74rem; }.valid-note { display: flex; align-items: center; gap: .3rem; color: var(--rt-success,#64d6aa)!important; }.rail-section { border-top: 1px solid var(--rule); padding: .75rem 0; }.rail-heading h3 { font-size: .84rem; }.decision-card,.handout-card { display: grid; gap: .4rem; margin-top: .45rem; border: 1px solid var(--rule); border-left: 3px solid var(--rt-pending,#efb34c); border-radius: 7px; padding: .5rem; background: var(--paper); }.decision-card.resolved { border-left-color: var(--rt-success,#64d6aa); }.decision-card > input { font-weight: 750; }.card-actions { display: grid; grid-template-columns: 1fr auto; gap: .35rem; }.handout-card summary { min-height: 44px; display: flex; align-items: center; cursor: pointer; font-weight: 750; }.handout-remove { min-height: 44px; border: 1px solid var(--rule); border-radius: 7px; background: var(--paper); }.rail-empty { color: var(--ink-muted); font-size: .74rem; }.centered { padding: 2rem .5rem; text-align: center; }.primary-actions { position: sticky; bottom: -.85rem; display: grid; gap: .4rem; margin: .3rem -.85rem -.85rem; border-top: 1px solid var(--rule); padding: .75rem .85rem; background: var(--paper-soft); }.save-action { border-color: var(--accent)!important; background: var(--accent)!important; color: var(--paper)!important; }.ready-action { border-color: var(--rt-success,#64d6aa)!important; color: var(--rt-success,#64d6aa)!important; }
input,select,textarea { min-height: 44px; border: 1px solid var(--rule); border-radius: 7px; padding: .5rem .58rem; background: var(--paper); color: var(--ink); font: inherit; }textarea { resize: vertical; }button:disabled,input:disabled,select:disabled,textarea:disabled { opacity: .48; cursor: not-allowed; }button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible,h2[tabindex]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }.small-empty { padding: 1rem; color: var(--ink-muted); text-align: center; }.access-gate { min-height: 55vh; display: grid; place-content: center; justify-items: center; gap: .45rem; padding: 2rem; text-align: center; color: var(--ink-muted); }.access-gate h2,.access-gate p { margin: 0; }
@media (max-width: 1250px) { .prep-grid { grid-template-columns: 250px minmax(0,1fr); }.readiness-panel { position: static; grid-column: 2; max-height: none; } }
@media (max-width: 820px) { .prep-grid { grid-template-columns: 1fr; }.library-panel,.readiness-panel { position: static; grid-column: auto; max-height: none; }.canvas-header,.scene-toolbar { align-items: stretch; flex-direction: column; }.import-controls { justify-content: flex-start; }.scene-copy,.overview-grid { grid-template-columns: 1fr; }.wide { grid-column: auto; }.candidate-row { grid-template-columns: 1fr auto; }.candidate-note { grid-column: 1 / -1; }.add-candidate { grid-template-columns: 1fr; } }
@media (max-width: 480px) { .toolkit-title { align-items: stretch; flex-direction: column; }.library-filters { grid-template-columns: 1fr; }.scene-card > header { grid-template-columns: auto minmax(0,1fr); }.order-actions { grid-column: 1 / -1; flex-wrap: wrap; }.header-actions { display: grid; }.import-controls { display: grid; }.import-controls select { width: 100%; max-width: 100%; }.preview-banner { flex-direction: column; } }
@media (prefers-reduced-motion: reduce) { .spinning { animation: none; } }
</style>
