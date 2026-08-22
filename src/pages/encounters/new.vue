<script setup lang="ts">
import AppNavigation from '~/components/AppNavigation.vue'
import { useEncounterBuilder } from '~/composables/encounters/useEncounterBuilder'
import { useEncounterTableLibraryData } from '~/composables/encounters/useEncounterTableLibraryData'
import { useMapLibraryData } from '~/composables/library/useMapLibraryData'
import { encounterWorkspacePath } from '#shared/encounterWorkspace/routes'
import type { EncounterBuilderDraftMember } from '~/composables/encounters/useEncounterBuilder'
import { getClientId } from '~/utils/clientId'

const { isGm } = useAuth()
if (!isGm.value) throw createError({ statusCode: 403, statusMessage: 'Encounter Builder is GM-only.' })

useHead({ title: 'Encounter Builder · Rotom Table' })
const route = useRoute()
const router = useRouter()
const tables = useEncounterTableLibraryData({ initialEntries: [] })
const maps = useMapLibraryData({ clientId: getClientId() })
const builder = useEncounterBuilder({
  entries: tables.items,
  maps: computed(() => [...maps.maps.values()]),
  initialMapSlug: typeof route.query.map === 'string' ? route.query.map : undefined,
  initialRegion: typeof route.query.region === 'string' ? route.query.region : undefined,
  initialTable: typeof route.query.table === 'string' ? route.query.table : undefined,
})

const eventValue = (event: Event): string => (event.target as HTMLInputElement | HTMLSelectElement).value
const eventNumber = (event: Event): number => Number((event.target as HTMLInputElement).value)
const eventChecked = (event: Event): boolean => (event.target as HTMLInputElement).checked
const update = (member: EncounterBuilderDraftMember, patch: Partial<Omit<EncounterBuilderDraftMember, 'castId' | 'locked'>>): void => {
  builder.updateMember(member.castId, patch)
}
const launch = async (): Promise<void> => {
  const result = await builder.launch()
  if (result) await router.push(encounterWorkspacePath(result.encounterId))
}
const mapLabel = (map: { name: string, folder: string }): string => map.folder ? `${map.folder} / ${map.name}` : map.name
</script>

<template>
  <div class="encounter-builder rt-design-system" data-rt-design-system="1" data-rt-context="workshop">
    <header class="encounter-builder__global"><AppNavigation /></header>
    <main>
      <header class="encounter-builder__hero">
        <div>
          <p>Workshop · encounter authoring</p>
          <h1>Encounter Builder</h1>
          <span>Choose a recipe, review every roll, stage the cast, and launch one revisioned encounter.</span>
        </div>
        <NuxtLink to="/play">Cancel to Encounter Library</NuxtLink>
      </header>

      <OnboardingPartyCandidatesCard />

      <section class="encounter-builder__section" aria-labelledby="builder-recipe-heading">
        <header><span>1</span><div><h2 id="builder-recipe-heading">Choose a recipe</h2><p>Recipes set useful defaults; they never invent mechanics.</p></div></header>
        <div class="encounter-builder__recipes">
          <label v-for="recipe in builder.recipes" :key="recipe.recipeId" :data-selected="builder.recipeId.value === recipe.recipeId">
            <input v-model="builder.recipeId.value" type="radio" name="recipe" :value="recipe.recipeId">
            <strong>{{ recipe.label }}</strong>
            <span>{{ recipe.description }}</span>
            <small>{{ recipe.defaultCount.minimum }}–{{ recipe.defaultCount.maximum }} cast · {{ recipe.tactical }} tactics</small>
          </label>
        </div>
      </section>

      <section class="encounter-builder__section" aria-labelledby="builder-setup-heading">
        <header><span>2</span><div><h2 id="builder-setup-heading">Name and battlefield</h2><p>The encounter links to one authoritative battlefield.</p></div></header>
        <div class="encounter-builder__form-grid">
          <label>Encounter name<input v-model="builder.name.value" maxlength="200" required></label>
          <label>Encounter route<input v-model="builder.encounterId.value" maxlength="200" required pattern="[A-Za-z0-9][A-Za-z0-9._:/-]*"></label>
          <label>Battlefield
            <select v-model="builder.mapSlug.value" :disabled="maps.loading.value">
              <option value="">Select battlefield…</option>
              <option v-for="map in builder.maps.value" :key="map.slug" :value="map.slug">{{ mapLabel(map) }}</option>
            </select>
          </label>
          <label>Region
            <select v-model="builder.region.value"><option v-for="region in builder.regions.value" :key="region" :value="region">{{ region || 'Root' }}</option></select>
          </label>
          <label>Encounter table
            <select v-model="builder.tableKey.value"><option v-for="entry in builder.tables.value" :key="entry.key" :value="entry.key">{{ entry.table.name }}</option></select>
          </label>
          <label>Cast count<input v-model.number="builder.count.value" type="number" min="1" max="30"></label>
          <label>Stage presentation
            <select v-model="builder.presentationStage.value">
              <option value="standard">Standard battle stage</option><option value="boss">Boss stage</option><option value="chase">Chase stage</option>
            </select>
          </label>
          <label>Tactical presentation
            <select v-model="builder.tacticalPresentation.value">
              <option value="on-demand">Open tactics on demand</option><option value="split">Start split-ready</option>
            </select>
          </label>
          <label class="encounter-builder__check"><input v-model="builder.startInitiative.value" type="checkbox">Start initiative at round 1</label>
          <label>Generated sheet folder<input v-model="builder.outRoot.value" maxlength="500"></label>
        </div>
        <p v-if="builder.mapLoading.value" role="status">Loading battlefield sides…</p>
        <p v-if="builder.mapError.value" role="alert">{{ builder.mapError.value }}</p>
      </section>

      <section class="encounter-builder__section" aria-labelledby="builder-cast-heading">
        <header>
          <span>3</span>
          <div><h2 id="builder-cast-heading">Review the cast</h2><p>Lock keepers, reroll the rest, or replace species and level directly.</p></div>
          <button type="button" :disabled="!builder.table.value || builder.launching.value" @click="builder.rollCast">Reroll unlocked</button>
        </header>
        <ol class="encounter-builder__cast">
          <li v-for="member in builder.cast.value" :key="member.castId" :data-locked="member.locked">
            <div class="encounter-builder__cast-id"><span>[{{ member.roll }}]</span><strong>{{ member.species }}</strong><small>Lv {{ member.level }}</small></div>
            <label>Species<input :value="member.species" maxlength="200" @change="update(member, { species: eventValue($event) })"></label>
            <label>Level<input :value="member.level" type="number" min="1" max="100" @change="update(member, { level: eventNumber($event) })"></label>
            <label>Side
              <select :value="member.sideId ?? ''" @change="update(member, { sideId: eventValue($event) || null })">
                <option value="">Unaligned</option>
                <option v-for="side in builder.sides.value" :key="side.id" :value="side.id">{{ side.label }}</option>
              </select>
            </label>
            <label>Role
              <select :value="member.role" @change="update(member, { role: eventValue($event) as EncounterBuilderDraftMember['role'] })">
                <option value="boss">Boss</option><option value="leader">Leader</option><option value="standard">Standard</option><option value="minion">Minion</option><option value="support">Support</option>
              </select>
            </label>
            <label class="encounter-builder__check"><input :checked="member.hidden" type="checkbox" @change="update(member, { hidden: eventChecked($event) })">Hidden at launch</label>
            <div class="encounter-builder__cast-actions">
              <button type="button" :aria-pressed="member.locked" @click="builder.toggleLock(member.castId)">{{ member.locked ? 'Unlock' : 'Lock' }}</button>
              <button type="button" :disabled="member.locked" @click="builder.rerollMember(member.castId)">Reroll</button>
              <button type="button" @click="builder.removeMember(member.castId)">Remove</button>
            </div>
          </li>
        </ol>
        <p v-if="builder.cast.value.length === 0" class="encounter-builder__empty">No non-Nothing results. Roll again or choose another table.</p>
      </section>

      <section class="encounter-builder__section" aria-labelledby="builder-story-heading">
        <header><span>4</span><div><h2 id="builder-story-heading">Set stakes and launch</h2><p>Public copy is projected to the table; GM stakes and notes remain structurally private.</p></div></header>
        <div class="encounter-builder__story">
          <label>Public stakes<textarea v-model="builder.publicStakes.value" rows="3" maxlength="4000"></textarea></label>
          <label>GM stakes<textarea v-model="builder.gmStakes.value" rows="3" maxlength="4000"></textarea></label>
          <label>GM notes<textarea v-model="builder.notes.value" rows="4" maxlength="20000"></textarea></label>
        </div>
        <div class="encounter-builder__review">
          <div><strong>{{ builder.name.value }}</strong><span>{{ builder.recipe.value.label }} · {{ builder.cast.value.length }} cast</span></div>
          <div><span>Battlefield</span><strong>{{ builder.map.value?.name || 'Not selected' }}</strong></div>
          <div><span>Presentation</span><strong>{{ builder.presentationStage.value }} stage · {{ builder.tacticalPresentation.value }} tactics · {{ builder.startInitiative.value ? 'initiative starts' : 'initiative prepared' }}</strong></div>
          <button type="button" :disabled="!builder.canLaunch.value" @click="launch">{{ builder.launching.value ? 'Launching…' : 'Launch encounter' }}</button>
        </div>
        <p v-if="builder.error.value" role="alert" class="encounter-builder__error">{{ builder.error.value }}</p>
      </section>
    </main>
  </div>
</template>

<style scoped>
.encounter-builder { min-height: 100dvh; padding: var(--rt-space-3); background: var(--rt-bg-canvas); color: var(--rt-text); }
.encounter-builder__global, .encounter-builder main { max-width: 92rem; margin-inline: auto; }
.encounter-builder main { display: grid; gap: var(--rt-space-4); }
.encounter-builder__hero { display: flex; align-items: end; justify-content: space-between; gap: 1rem; padding: clamp(1rem, 3vw, 2.5rem); border: 1px solid var(--rt-rule); background: var(--rt-surface-1); }
.encounter-builder__hero p { margin: 0; color: var(--rt-info); font-size: var(--rt-type-label-sm-size); font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }
.encounter-builder__hero h1 { margin: .2rem 0; font-size: var(--rt-type-display-lg-size); }
.encounter-builder__hero span { color: var(--rt-text-muted); }
.encounter-builder a, .encounter-builder button { min-height: var(--rt-touch-minimum); display: inline-flex; align-items: center; justify-content: center; padding: .5rem .75rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text-strong); font: inherit; font-weight: 700; text-decoration: none; }
.encounter-builder__section { padding: clamp(1rem, 2vw, 1.5rem); border: 1px solid var(--rt-rule); background: var(--rt-surface-1); box-shadow: var(--rt-elevation-1); }
.encounter-builder__section > header { display: flex; align-items: center; gap: .8rem; margin-bottom: 1rem; }
.encounter-builder__section > header > span { display: grid; place-items: center; width: 2.25rem; height: 2.25rem; flex: none; border-radius: 50%; background: var(--rt-info); color: var(--rt-on-brand); font-weight: 800; }
.encounter-builder__section > header > div { margin-right: auto; }
.encounter-builder__section h2, .encounter-builder__section header p { margin: 0; }
.encounter-builder__section header p { color: var(--rt-text-muted); }
.encounter-builder__recipes { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: .6rem; }
.encounter-builder__recipes label { display: grid; align-content: start; gap: .45rem; min-height: 10rem; padding: .8rem; border: 1px solid var(--rt-rule); background: var(--rt-surface-2); cursor: pointer; }
.encounter-builder__recipes label[data-selected='true'] { border-color: var(--rt-focus); box-shadow: 0 0 0 2px color-mix(in srgb, var(--rt-focus) 25%, transparent); }
.encounter-builder__recipes input { position: absolute; opacity: 0; }
.encounter-builder__recipes span, .encounter-builder__recipes small { color: var(--rt-text-muted); }
.encounter-builder__form-grid, .encounter-builder__story { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: .75rem; }
.encounter-builder label { display: grid; gap: .3rem; color: var(--rt-text-muted); font-size: var(--rt-type-label-sm-size); }
.encounter-builder input, .encounter-builder select, .encounter-builder textarea { width: 100%; min-height: var(--rt-touch-minimum); padding: .5rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-bg-canvas); color: var(--rt-text); font: inherit; }
.encounter-builder__cast { display: grid; gap: .6rem; margin: 0; padding: 0; list-style: none; }
.encounter-builder__cast li { display: grid; grid-template-columns: minmax(10rem, 1.2fr) repeat(4, minmax(7rem, 1fr)); gap: .6rem; align-items: end; padding: .75rem; border-inline-start: 3px solid var(--rt-info); background: var(--rt-surface-2); }
.encounter-builder__cast li[data-locked='true'] { border-inline-start-color: var(--rt-success); }
.encounter-builder__cast-id { display: grid; align-self: center; }
.encounter-builder__cast-id span, .encounter-builder__cast-id small { color: var(--rt-text-muted); }
.encounter-builder__check { display: flex !important; align-items: center; min-height: var(--rt-touch-minimum); }
.encounter-builder__check input { width: auto; min-height: auto; }
.encounter-builder__cast-actions { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: .4rem; }
.encounter-builder__empty { color: var(--rt-text-muted); }
.encounter-builder__review { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) auto; align-items: center; gap: 1rem; margin-top: 1rem; padding: 1rem; border: 1px solid var(--rt-rule); background: var(--rt-surface-2); pointer-events: none; }
.encounter-builder__review > * { min-width: 0; }
.encounter-builder__review div { display: grid; overflow-wrap: anywhere; }
.encounter-builder__review button { position: relative; z-index: 1; pointer-events: auto; }
.encounter-builder__review span { color: var(--rt-text-muted); }
.encounter-builder__error { padding: .7rem; border-inline-start: 3px solid var(--rt-danger); background: color-mix(in srgb, var(--rt-danger) 10%, var(--rt-surface-1)); }
@media (max-width: 70rem) { .encounter-builder__cast li { grid-template-columns: repeat(2, minmax(0, 1fr)); } .encounter-builder__review { grid-template-columns: 1fr 1fr; } }
@media (max-width: 42rem) { .encounter-builder { padding: 0; overflow-x: clip; } .encounter-builder main { padding-bottom: calc(6rem + env(safe-area-inset-bottom)); } .encounter-builder__hero { align-items: stretch; flex-direction: column; } .encounter-builder__cast li, .encounter-builder__review { grid-template-columns: minmax(0, 1fr); } .encounter-builder__review button { grid-column: 1; width: 100%; } }
</style>
