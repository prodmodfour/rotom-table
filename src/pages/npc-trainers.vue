<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { PhArrowClockwise, PhCheck, PhIdentificationCard, PhLockKey, PhSparkle, PhUsersThree, PhWarning } from '@phosphor-icons/vue'
import AppNavigation from '~/components/AppNavigation.vue'
import EncounterToolkitNavigation from '~/components/encounters/EncounterToolkitNavigation.vue'
import { useAuth } from '~/composables/useAuth'
import { useNpcGenerationToolkit } from '~/composables/encounters/useNpcGenerationToolkit'

useHead({ title: 'Campaign Toolkit · NPC Trainers · Rotom Table' })
const { isGm } = useAuth()
const {
  archetypeId, selectedArchetype, name, identity, tactics, notes, rosterCount,
  loading, previewing, committing, error, announcement, preview, committed, canPreview, canCommit,
  archetypes, loadArchetypes, requestPreview: requestPreviewAuthority,
  commitPackage: commitPackageAuthority, startAnother: clearGeneration,
} = useNpcGenerationToolkit()
const setupHeading = ref<HTMLElement | null>(null)
const reviewHeading = ref<HTMLElement | null>(null)
const acceptedHeading = ref<HTMLElement | null>(null)
const requestPreview = async (): Promise<void> => {
  await requestPreviewAuthority()
  await nextTick()
  if (preview.value) reviewHeading.value?.focus()
}
const commitPackage = async (): Promise<void> => {
  await commitPackageAuthority()
  await nextTick()
  if (committed.value) acceptedHeading.value?.focus()
}
const startAnother = async (): Promise<void> => {
  clearGeneration()
  await nextTick()
  setupHeading.value?.focus()
}
const skillHighlights = computed(() => {
  if (!preview.value) return []
  const names: Record<string, string> = { pokeEd: 'Pokémon Ed', medicineEd: 'Medicine Ed', command: 'Command', survival: 'Survival', focus: 'Focus', perception: 'Perception' }
  const rankWeight: Record<string, number> = { Pathetic: 0, Untrained: 1, Novice: 2, Adept: 3, Expert: 4, Master: 5 }
  return Object.entries(preview.value.trainer.skillRanks)
    .filter(([, rank]) => (rankWeight[rank] ?? 0) >= 2)
    .sort((left, right) => (rankWeight[right[1]] ?? 0) - (rankWeight[left[1]] ?? 0) || left[0].localeCompare(right[0]))
    .slice(0, 6)
    .map(([key, rank]) => ({ key, label: names[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, value => value.toUpperCase()), rank }))
})
const inventoryLabel = (section: string): string => ({ medicalKit: 'Medical kit', pokeBalls: 'Poké Balls', keyItems: 'Key items', pokemonItems: 'Pokémon items', foodStuff: 'Food', equipment: 'Equipment' }[section] ?? section)
</script>

<template>
  <div class="toolkit-page">
    <AppNavigation />
    <header class="toolkit-header">
      <div class="toolkit-title">
        <div><p class="eyebrow">GM Workshop</p><h1>Campaign Toolkit</h1></div>
        <button class="icon-action" type="button" aria-label="Refresh NPC archetypes" :disabled="loading" @click="loadArchetypes">
          <PhArrowClockwise :size="20" :class="{ spinning: loading }" aria-hidden="true" />
        </button>
      </div>
      <p class="toolkit-subtitle">Review a legal Trainer and owned Pokémon roster from a campaign policy, then commit the whole package atomically.</p>
      <EncounterToolkitNavigation active="npc" />
    </header>

    <main v-if="isGm" class="npc-workspace">
      <div v-if="error" class="notice" role="alert">
        <PhWarning :size="22" weight="fill" aria-hidden="true" />
        <div><strong>NPC generation could not finish</strong><span>{{ error }}</span></div>
      </div>

      <div class="npc-grid">
        <section class="setup-panel" aria-labelledby="npc-setup-heading">
          <div class="panel-heading">
            <div><p class="section-kicker">1 · Configure</p><h2 id="npc-setup-heading" ref="setupHeading" tabindex="-1">NPC Trainer</h2></div>
            <PhIdentificationCard :size="28" weight="duotone" aria-hidden="true" />
          </div>
          <div class="field-stack">
            <label>
              <span>Reviewed policy</span>
              <select v-model="archetypeId" :disabled="loading || previewing || committing">
                <option value="">Choose an archetype</option>
                <option v-for="archetype in archetypes" :key="archetype.archetypeId" :value="archetype.archetypeId">{{ archetype.name }}</option>
              </select>
            </label>
            <div v-if="selectedArchetype" class="policy-summary">
              <strong>Trainer Level {{ selectedArchetype.trainerLevel }} · roster up to {{ selectedArchetype.rosterCount }}</strong>
              <span>{{ selectedArchetype.description }}</span>
              <small>Reviewed revision {{ selectedArchetype.revision }}</small>
            </div>
            <label>
              <span>Trainer name <b aria-hidden="true">*</b></span>
              <input v-model="name" type="text" maxlength="120" autocomplete="off" required :disabled="previewing || committing" placeholder="Name this NPC">
            </label>
            <label>
              <span>Identity</span>
              <textarea v-model="identity" rows="3" maxlength="2000" :disabled="previewing || committing" placeholder="What should the table know about this person?" />
              <small>Private GM guidance; this is not generated mechanical authority.</small>
            </label>
            <label>
              <span>Tactics</span>
              <textarea v-model="tactics" rows="3" maxlength="2000" :disabled="previewing || committing" placeholder="How do they approach conflict?" />
            </label>
            <label>
              <span>Private notes</span>
              <textarea v-model="notes" rows="3" maxlength="4000" :disabled="previewing || committing" placeholder="Hooks, boundaries, or unresolved decisions" />
            </label>
            <label>
              <span>Owned roster size</span>
              <input v-model.number="rosterCount" type="number" min="0" :max="selectedArchetype?.rosterCount ?? 6" inputmode="numeric" :disabled="previewing || committing">
              <small>Zero to {{ selectedArchetype?.rosterCount ?? 6 }} ordinary owned Pokémon.</small>
            </label>
          </div>
          <button class="preview-action" type="button" :disabled="!canPreview" @click="requestPreview">
            <PhSparkle :size="19" weight="fill" aria-hidden="true" />
            {{ previewing ? 'Building exact preview…' : 'Preview NPC package' }}
          </button>
          <p class="inert-note">Preview is inert. No Trainer, Pokémon, operation, or realtime row is saved.</p>
        </section>

        <section class="review-panel" aria-labelledby="npc-review-heading">
          <div class="panel-heading">
            <div><p class="section-kicker">2 · Review</p><h2 id="npc-review-heading" ref="reviewHeading" tabindex="-1">Trainer and roster</h2></div>
            <PhUsersThree :size="28" weight="duotone" aria-hidden="true" />
          </div>

          <div v-if="!preview" class="empty-state">
            <PhSparkle :size="38" weight="duotone" aria-hidden="true" />
            <strong>No NPC package has been previewed</strong>
            <span>Choose a reviewed policy and make the bounded GM decisions first.</span>
          </div>
          <template v-else>
            <div class="preview-banner">
              <strong>Preview only — nothing has been saved</strong>
              <span>Trainer Level {{ preview.trainer.level }} · {{ preview.roster.length }} owned Pokémon</span>
            </div>

            <article class="trainer-card">
              <div class="trainer-heading">
                <div><span>Trainer candidate</span><h3>{{ preview.trainer.name }}</h3></div>
                <strong>Level {{ preview.trainer.level }}</strong>
              </div>
              <div class="trainer-body">
                <div class="mechanics-column">
                  <div class="stat-strip" aria-label="Generated Trainer stat totals">
                    <span v-for="(value, key) in preview.trainer.statTotals" :key="key"><small>{{ key }}</small><strong>{{ value }}</strong></span>
                  </div>
                  <section aria-labelledby="skills-heading">
                    <h4 id="skills-heading">Skill highlights</h4>
                    <div class="chips"><span v-for="skill in skillHighlights" :key="skill.key">{{ skill.label }} · {{ skill.rank }}</span></div>
                  </section>
                  <section aria-labelledby="features-heading">
                    <h4 id="features-heading">Features</h4>
                    <p>{{ preview.trainer.featureNames.join(' · ') }}</p>
                  </section>
                  <section aria-labelledby="equipment-heading">
                    <h4 id="equipment-heading">Equipment &amp; money</h4>
                    <p class="inventory-line">
                      <span v-for="row in preview.trainer.inventory" :key="`${row.section}-${row.itemId}`" :title="inventoryLabel(row.section)">{{ row.itemId }} ×{{ row.quantity }}</span>
                      <strong>₽{{ preview.trainer.money.toLocaleString() }}</strong>
                    </p>
                  </section>
                </div>
                <aside class="guidance" aria-label="Private guided decisions">
                  <h4>GM guidance</h4>
                  <dl>
                    <div><dt>Identity</dt><dd>{{ preview.trainer.guided.identity || 'Not specified' }}</dd></div>
                    <div><dt>Tactics</dt><dd>{{ preview.trainer.guided.tactics || 'Not specified' }}</dd></div>
                    <div><dt>Private notes</dt><dd>{{ preview.trainer.guided.notes || 'Not specified' }}</dd></div>
                  </dl>
                </aside>
              </div>
            </article>

            <section class="roster-section" aria-labelledby="roster-heading">
              <div class="roster-heading"><div><h3 id="roster-heading">Owned Pokémon roster</h3><span>Custody is linked to {{ preview.trainer.name }} on commit.</span></div><strong>{{ preview.roster.length }}</strong></div>
              <div v-if="preview.roster.length" class="roster-grid">
                <article v-for="candidate in preview.roster" :key="candidate.candidateId" class="pokemon-card">
                  <div class="pokemon-title"><div><span>Roster slot {{ candidate.slot }}</span><h4>{{ candidate.speciesId }}</h4></div><strong>Level {{ candidate.level }}</strong></div>
                  <div class="chips"><span>{{ candidate.gender }}</span><span>{{ candidate.nature }}</span><span v-if="candidate.shiny">Shiny</span></div>
                  <dl><div><dt>Ability</dt><dd>{{ candidate.abilityNames.join(', ') }}</dd></div><div><dt>Moves</dt><dd>{{ candidate.moveNames.join(', ') }}</dd></div></dl>
                </article>
              </div>
              <div v-else class="zero-roster">This package creates a Trainer without an owned roster.</div>
            </section>

            <div class="commit-bar">
              <div><strong>Commit package</strong><span>Creates one ordinary Trainer and {{ preview.roster.length }} linked Pokémon atomically. This cannot partially save.</span></div>
              <button class="commit-action" type="button" :disabled="!canCommit" @click="commitPackage">
                <PhCheck :size="19" weight="bold" aria-hidden="true" />{{ committing ? 'Committing…' : 'Commit package' }}
              </button>
            </div>
          </template>
        </section>
      </div>

      <section v-if="committed" class="accepted-panel" aria-labelledby="accepted-heading">
        <div><p class="section-kicker">Accepted package</p><h2 id="accepted-heading" ref="acceptedHeading" tabindex="-1">{{ committed.trainerCandidate.name }} and {{ committed.roster.length }} owned Pokémon committed</h2><p>{{ committed.exactRetry ? 'Recovered the original accepted result without duplicate writes.' : 'Every member is now an ordinary campaign sheet with explicit roster custody.' }}</p></div>
        <div class="accepted-links">
          <NuxtLink :to="`/sheets/trainers/${committed.trainer.slug}`">Open Trainer sheet</NuxtLink>
          <NuxtLink :to="{ path: '/encounters/new', query: { kind: 'npc-package', package: committed.packageId } }">Open in Encounter Builder</NuxtLink>
          <NuxtLink :to="{ path: '/session-prep', query: { packageKind: 'npc', package: committed.packageId } }">Add to Session prep</NuxtLink>
          <NuxtLink v-for="(sheet, index) in committed.roster" :key="sheet.slug" :to="`/sheets/${sheet.slug}`">{{ committed.pokemonCandidates[index]?.speciesId ?? 'Pokémon' }}</NuxtLink>
        </div>
        <button type="button" @click="startAnother">Generate another NPC</button>
      </section>
    </main>

    <main v-else class="access-gate">
      <PhLockKey :size="42" weight="duotone" aria-hidden="true" />
      <h2>GM preparation workspace</h2><p>NPC policies, guided notes, and candidate packages are available only to the active GM.</p>
    </main>
    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
  </div>
</template>

<style scoped>
.toolkit-page { min-height: 100vh; background: radial-gradient(circle at 72% -8%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 30rem), var(--paper); color: var(--ink); }
.toolkit-header { border-bottom: 1px solid var(--rule); padding: 1.5rem clamp(1rem, 4vw, 3rem) 0; background: color-mix(in srgb, var(--paper-soft) 90%, transparent); }
.toolkit-title { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
.eyebrow, .section-kicker { margin: 0 0 .3rem; color: var(--accent); font: 800 .72rem var(--font-mono); letter-spacing: .13em; text-transform: uppercase; }
h1 { margin: 0; font-size: clamp(1.8rem, 4vw, 3rem); letter-spacing: -.035em; } h2, h3, h4 { margin: 0; color: var(--ink-bright); }
.toolkit-subtitle { max-width: 780px; margin: .65rem 0 1.25rem; color: var(--ink-muted); line-height: 1.55; }
.icon-action { width: 44px; min-height: 44px; display: grid; place-items: center; border: 1px solid var(--rule); border-radius: 9px; background: var(--paper-soft); color: var(--ink); cursor: pointer; }
.icon-action:hover { border-color: var(--accent); color: var(--accent); } .spinning { animation: spin .8s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
.npc-workspace { max-width: 1580px; margin: 0 auto; padding: 1.15rem clamp(.75rem, 2vw, 1.5rem) 2rem; }
.notice { display: flex; gap: .65rem; margin-bottom: .8rem; border: 1px solid var(--rule); border-left: 4px solid var(--rt-danger, #ff4553); border-radius: 9px; padding: .75rem .85rem; background: var(--paper-soft); }
.notice > div { display: grid; gap: .15rem; } .notice span { color: var(--ink-muted); }
.npc-grid { display: grid; grid-template-columns: minmax(285px, 355px) minmax(0, 1fr); align-items: start; gap: .85rem; }
.setup-panel, .review-panel, .accepted-panel { border: 1px solid var(--rule); border-radius: 12px; background: var(--paper-soft); box-shadow: var(--shadow-card); }
.setup-panel { position: sticky; top: .75rem; padding: 1rem; } .review-panel { min-height: 36rem; padding: 1rem; }
.panel-heading { display: flex; justify-content: space-between; gap: .75rem; padding-bottom: .8rem; border-bottom: 1px solid var(--rule); } .panel-heading > svg { color: var(--accent); }
.field-stack { display: grid; gap: .75rem; padding: .9rem 0; }
.field-stack label { display: grid; gap: .35rem; color: var(--ink); font-size: .82rem; font-weight: 750; }
.field-stack input, .field-stack select, .field-stack textarea { width: 100%; min-height: 44px; border: 1px solid var(--rule); border-radius: 8px; padding: .55rem .65rem; background: var(--paper); color: var(--ink); font: inherit; resize: vertical; }
.field-stack input:focus, .field-stack select:focus, .field-stack textarea:focus { border-color: var(--accent); outline: 2px solid color-mix(in srgb, var(--accent) 30%, transparent); }
.field-stack small { color: var(--ink-muted); font-weight: 500; line-height: 1.4; } .field-stack b { color: var(--rt-danger, #ff4553); }
.policy-summary { display: grid; gap: .2rem; border-left: 3px solid var(--accent); padding: .5rem .65rem; background: color-mix(in srgb, var(--accent) 6%, transparent); font-size: .76rem; line-height: 1.4; }
.policy-summary span, .policy-summary small { color: var(--ink-muted); }
.preview-action, .commit-action, .accepted-panel button { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: .4rem; border-radius: 9px; padding: .65rem .9rem; font: inherit; font-weight: 800; cursor: pointer; }
.preview-action { width: 100%; border: 1px solid var(--accent); background: var(--accent); color: var(--paper); } button:disabled { opacity: .48; cursor: not-allowed; }
.inert-note { margin: .55rem 0 0; color: var(--ink-muted); font-size: .74rem; line-height: 1.4; }
.empty-state { min-height: 28rem; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .35rem; text-align: center; color: var(--ink-muted); } .empty-state strong { color: var(--ink); }
.preview-banner { display: flex; justify-content: space-between; gap: 1rem; margin: .8rem 0; border: 1px solid color-mix(in srgb, var(--rt-pending, #efb34c) 55%, var(--rule)); border-radius: 8px; padding: .65rem .75rem; background: color-mix(in srgb, var(--rt-pending, #efb34c) 8%, transparent); }
.preview-banner strong { color: var(--rt-pending, #efb34c); } .preview-banner span { color: var(--ink-muted); }
.trainer-card { border: 1px solid var(--rule); border-left: 4px solid var(--accent); border-radius: 10px; background: var(--paper); overflow: hidden; }
.trainer-heading { display: flex; justify-content: space-between; align-items: center; gap: .75rem; padding: .8rem .9rem; border-bottom: 1px solid var(--rule); }
.trainer-heading span, .pokemon-title span { color: var(--ink-muted); font: 700 .65rem var(--font-mono); letter-spacing: .08em; text-transform: uppercase; } .trainer-heading h3 { margin-top: .15rem; font-size: 1.35rem; } .trainer-heading > strong, .pokemon-title > strong { color: var(--accent); }
.trainer-body { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(230px, .8fr); } .mechanics-column { display: grid; gap: .85rem; padding: .9rem; }
.stat-strip { display: grid; grid-template-columns: repeat(6, 1fr); gap: .3rem; } .stat-strip span { display: grid; justify-items: center; border: 1px solid var(--rule); border-radius: 6px; padding: .4rem .2rem; }
.stat-strip small { color: var(--ink-muted); font: 700 .62rem var(--font-mono); text-transform: uppercase; } .stat-strip strong { font-size: .9rem; }
h4 { font-size: .76rem; letter-spacing: .05em; } .mechanics-column p { margin: .3rem 0 0; color: var(--ink-soft); font-size: .78rem; line-height: 1.5; }
.chips { display: flex; flex-wrap: wrap; gap: .3rem; margin-top: .4rem; } .chips span, .inventory-line span { border: 1px solid var(--rule); border-radius: 999px; padding: .2rem .45rem; color: var(--ink-muted); font-size: .7rem; }
.inventory-line { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem; } .inventory-line strong { margin-left: auto; color: var(--rt-success, #64d6aa); }
.guidance { border-left: 1px solid var(--rule); padding: .9rem; background: color-mix(in srgb, var(--accent) 3%, transparent); } .guidance dl { display: grid; gap: .75rem; margin: .65rem 0 0; }
.guidance dt, .pokemon-card dt { color: var(--ink-muted); font: 700 .64rem var(--font-mono); text-transform: uppercase; } .guidance dd, .pokemon-card dd { margin: .15rem 0 0; color: var(--ink-soft); font-size: .75rem; line-height: 1.45; white-space: pre-wrap; }
.roster-section { margin-top: .85rem; } .roster-heading { display: flex; justify-content: space-between; align-items: center; padding: .2rem 0 .55rem; } .roster-heading span { color: var(--ink-muted); font-size: .75rem; } .roster-heading > strong { color: var(--accent); font-size: 1.2rem; }
.roster-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .55rem; } .pokemon-card { border: 1px solid var(--rule); border-radius: 9px; padding: .65rem; background: var(--paper); }
.pokemon-title { display: flex; justify-content: space-between; gap: .5rem; } .pokemon-title h4 { margin-top: .15rem; font-size: 1rem; } .pokemon-title > strong { font-size: .72rem; white-space: nowrap; }
.pokemon-card dl { display: grid; gap: .4rem; margin: .6rem 0 0; } .zero-roster { border: 1px dashed var(--rule); padding: 1rem; color: var(--ink-muted); text-align: center; }
.commit-bar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-top: .9rem; border-top: 1px solid var(--rule); padding-top: .9rem; } .commit-bar > div { display: grid; gap: .15rem; } .commit-bar span { color: var(--ink-muted); font-size: .76rem; }
.commit-action { flex: 0 0 auto; border: 1px solid var(--rt-danger, #d9424e); background: var(--rt-danger, #d9424e); color: var(--rt-on-brand, #07090d); }
.accepted-panel { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .8rem 1rem; margin-top: .85rem; border-left: 4px solid var(--rt-success, #64d6aa); padding: 1rem; } .accepted-panel p { margin: .3rem 0 0; color: var(--ink-muted); }
.accepted-links { grid-row: span 2; display: flex; max-width: 360px; flex-wrap: wrap; gap: .35rem; } .accepted-links a { min-height: 44px; display: inline-flex; align-items: center; border: 1px solid var(--rule); border-radius: 7px; padding: .4rem .6rem; color: var(--accent); text-decoration: none; }
.accepted-panel button { justify-self: start; border: 1px solid var(--rule); background: var(--paper); color: var(--ink); }
.access-gate { min-height: 55vh; display: grid; place-content: center; justify-items: center; gap: .45rem; padding: 2rem; text-align: center; color: var(--ink-muted); } .access-gate h2, .access-gate p { margin: 0; }
button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, h2[tabindex]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (max-width: 1050px) { .roster-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .trainer-body { grid-template-columns: 1fr; } .guidance { border-left: 0; border-top: 1px solid var(--rule); } }
@media (max-width: 850px) { .npc-grid { grid-template-columns: 1fr; } .setup-panel { position: static; } .accepted-panel { grid-template-columns: 1fr; } .accepted-links { grid-row: auto; max-width: none; } }
@media (max-width: 540px) { .toolkit-title { align-items: stretch; flex-direction: column; } .icon-action { align-self: flex-end; } .roster-grid { grid-template-columns: 1fr; } .preview-banner, .commit-bar { align-items: stretch; flex-direction: column; } .commit-action { width: 100%; } .stat-strip { grid-template-columns: repeat(3, 1fr); } }
@media (prefers-reduced-motion: reduce) { .spinning { animation: none; } }
</style>
