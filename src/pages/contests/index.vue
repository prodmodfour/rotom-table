<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue'
import { PhArrowClockwise, PhPlus, PhSparkle } from '@phosphor-icons/vue'
import AppNavigation from '~/components/AppNavigation.vue'
import { allocateContestId, useContests } from '~/composables/useContests'
import { contestPath } from '#shared/contests/routes'
import { contestCatalog } from '#shared/contests/catalog'
import { CONTEST_RUNTIME_VARIANT_IDS, type ContestStatId, type ContestVariantId } from '#shared/contests/ids'
import { items as referenceItems } from '~~/data/ptuReference'

const { isGm, isPlayer } = useAuth()
const profiles = usePlayerProfiles()
const profileId = computed(() => profiles.selectedProfileId.value)
const runtime = useContests(profileId)
const router = useRouter()
const workshopOpenedAt = Date.now()
const form = reactive({ name: '', hallName: '', description: '', variantId: 'standard' as ContestVariantId, contestTypeId: 'cute' as ContestStatId, significanceMultiplier: 1, awardRibbon: true, prizeDeclared: true, rotationOrderPolicy: 'predeclared' as 'predeclared'|'choose-each-round', supercontestFestival: false, gmNotes: '', money: 0, prizeItemId: '', prizeItemQuantity: 1, prizeItems: [] as Array<{ itemId: string, quantity: number }> })
const workshopVariants = contestCatalog.variants.filter(row => CONTEST_RUNTIME_VARIANT_IDS.includes(row.id as ContestVariantId) && row.completionState === 'native')
const needsFixedType = computed(() => form.variantId !== 'supercontest')

const addPrizeItem = (): void => {
  const canonical = referenceItems.find(row => row.name === form.prizeItemId)
  if (!canonical) return
  const quantity = Math.max(1, Math.min(999, Math.floor(form.prizeItemQuantity)))
  const existing = form.prizeItems.find(row => row.itemId === canonical.name)
  if (existing) existing.quantity = Math.min(999, existing.quantity + quantity)
  else form.prizeItems.push({ itemId: canonical.name, quantity })
  form.prizeItemId = ''; form.prizeItemQuantity = 1
}

const createContest = async (): Promise<void> => {
  const contestId = allocateContestId(form.name)
  const result = await runtime.execute({
    commandKind: 'create-contest', contestId, expectedRevision: 0,
    settings: {
      name: form.name, hallName: form.hallName, description: form.description, variantId: form.variantId,
      contestTypeId: needsFixedType.value ? form.contestTypeId : null,
      significanceMultiplier: form.significanceMultiplier, awardRibbon: form.awardRibbon,
      prize: { declared: form.prizeDeclared, money: Math.max(0, Math.floor(form.money)), items: form.prizeItems.map(row => ({ ...row, targetTrainerSlug: null })), notes: '' },
      ...(form.variantId === 'rotation' ? { rotationOrderPolicy: form.rotationOrderPolicy } : {}),
      ...(form.variantId === 'festival' ? { supercontestFestival: form.supercontestFestival } : {}),
      gmNotes: form.gmNotes,
    },
  })
  if (result) { if (import.meta.client) sessionStorage.setItem(`rotom:contest:workshop-open:${contestId}`, String(workshopOpenedAt)); await router.push(contestPath(contestId)) }
}

onMounted(async () => {
  if (isPlayer.value) { profiles.loadRememberedProfile(); await profiles.reloadProfiles({ silent: true, clearMissingSelection: true }).catch(() => undefined) }
  await runtime.list()
})
useHead({ title: 'Contests · Rotom Table' })
</script>

<template>
  <main class="contests-workshop rt-design-system" data-rt-design-system="1" data-rt-context="workshop">
    <AppNavigation />
    <header class="workshop-hero">
      <div>
        <p class="eyebrow">Campaign activity</p>
        <h1>Pokémon Contests</h1>
        <p>Prepare a hall, enroll ordinary sheets, and carry one authoritative Contest from introductions through ribbons.</p>
      </div>
      <button type="button" class="quiet-action" :disabled="runtime.loading.value" @click="runtime.list">
        <PhArrowClockwise :size="18" aria-hidden="true" /> Refresh
      </button>
    </header>

    <p v-if="runtime.error.value" class="system-message system-message--error" role="alert">{{ runtime.error.value }} <button v-if="runtime.uncertainCommand.value" type="button" class="quiet-action" @click="runtime.retryUncertain">Retry exact command</button></p>

    <section v-if="isGm" class="creation-card" aria-labelledby="create-contest-title">
      <div class="section-heading">
        <PhSparkle :size="28" weight="duotone" aria-hidden="true" />
        <div><p>Contest Workshop</p><h2 id="create-contest-title">Create a Contest</h2></div>
      </div>
      <form class="creation-grid" @submit.prevent="createContest">
        <label><span>Contest name</span><input v-model.trim="form.name" required maxlength="120" placeholder="Spring Ribbon Showcase" /></label>
        <label><span>Hall name</span><input v-model.trim="form.hallName" required maxlength="120" placeholder="Jubilife Contest Hall" /></label>
        <label><span>Variant</span><select v-model="form.variantId"><option v-for="variant in workshopVariants" :key="String(variant.id)" :value="variant.id">{{ variant.label }}</option></select></label>
        <label><span>Contest type</span><select v-model="form.contestTypeId" :disabled="!needsFixedType"><option v-for="stat in contestCatalog.contestStats" :key="stat.id" :value="stat.id">{{ stat.label }}</option></select><small v-if="!needsFixedType">Rolled authoritatively each round.</small></label>
        <div v-if="form.variantId === 'battle'" class="battle-workshop-note wide" role="note"><strong>Two-team Battle Contest</strong><span>Enroll exactly two Trainers with equal teams of 3–6 Pokémon. The round budget is derived as twice the first accepted team size.</span></div>
        <label><span>Significance multiplier</span><input v-model.number="form.significanceMultiplier" type="number" min="1" max="5" step="0.5" /></label>
        <label><span>Declared prize money</span><input v-model.number="form.money" type="number" min="0" step="1" /></label>
        <label v-if="form.variantId === 'rotation'"><span>Performer order</span><select v-model="form.rotationOrderPolicy"><option value="predeclared">Predeclare the full order</option><option value="choose-each-round">Choose privately each round</option></select></label>
        <label v-if="form.variantId === 'festival'" class="festival-option"><input v-model="form.supercontestFestival" type="checkbox" /> Roll a journaled Contest type each Festival round</label>
        <label class="wide"><span>Description</span><textarea v-model="form.description" rows="3" maxlength="1000" placeholder="What the audience sees when the stage opens." /></label>
        <label class="wide"><span>Private GM notes</span><textarea v-model="form.gmNotes" rows="2" maxlength="4000" placeholder="Never shown to players or spectators." /></label>
        <div class="prize-builder wide">
          <label><span>Canonical prize item</span><input v-model="form.prizeItemId" list="contest-prize-items" placeholder="Start typing an item name" /><datalist id="contest-prize-items"><option v-for="item in referenceItems" :key="item.name" :value="item.name" /></datalist></label>
          <label><span>Quantity</span><input v-model.number="form.prizeItemQuantity" type="number" min="1" max="999" /></label>
          <button type="button" class="quiet-action" @click="addPrizeItem">Add prize item</button>
          <ul v-if="form.prizeItems.length"><li v-for="(item,index) in form.prizeItems" :key="item.itemId"><span>{{ item.itemId }} × {{ item.quantity }}</span><button type="button" :aria-label="`Remove ${item.itemId} prize`" @click="form.prizeItems.splice(index,1)">Remove</button></li></ul>
        </div>
        <div class="toggles wide">
          <label><input v-model="form.awardRibbon" type="checkbox" /> Award a ribbon to first place</label>
          <label><input v-model="form.prizeDeclared" type="checkbox" /> Publish the prize before play</label>
        </div>
        <button type="submit" class="primary-action wide" :disabled="runtime.submitting.value">
          <PhPlus :size="20" weight="bold" aria-hidden="true" /> {{ runtime.submitting.value ? 'Creating…' : 'Create Contest' }}
        </button>
      </form>
    </section>

    <section class="activity" aria-labelledby="contest-activity-title">
      <div class="section-heading"><div><p>Live and recorded</p><h2 id="contest-activity-title">Contest activity</h2></div></div>
      <p v-if="runtime.loading.value && !runtime.contests.value.length" class="empty-state">Loading Contest authority…</p>
      <p v-else-if="!runtime.contests.value.length" class="empty-state">No Contests yet. The GM can prepare the first hall above.</p>
      <div v-else class="contest-list">
        <NuxtLink v-for="entry in runtime.contests.value" :key="entry.contestId" :to="contestPath(entry.contestId)" class="contest-row">
          <span class="contest-row__signal" aria-hidden="true" />
          <span><strong>{{ entry.display.name }}</strong><small>{{ entry.display.hallName }} · {{ entry.variantId }}</small></span>
          <span class="contest-row__status">{{ entry.stage }}<small v-if="entry.round">Round {{ entry.round }}</small></span>
          <span class="contest-row__count">{{ entry.scoreboard.length }}<small>contestants</small></span>
        </NuxtLink>
      </div>
    </section>
  </main>
</template>

<style scoped>
.contests-workshop { min-height: 100dvh; display: grid; align-content: start; gap: 1.5rem; padding: clamp(.65rem,2vw,1.5rem); background: var(--rt-bg-canvas,var(--paper)); color: var(--rt-text,var(--ink)); }
.contests-workshop > * { width: min(100%,96rem); margin-inline: auto; }
.workshop-hero { display:flex; align-items:end; justify-content:space-between; gap:1rem; border-bottom:1px solid var(--rt-rule,var(--rule-soft)); padding:1rem 0 1.25rem; }
.eyebrow,.section-heading p { margin:0 0 .25rem; color:var(--rt-pending,var(--warn)); font-size:.75rem; font-weight:850; letter-spacing:.11em; text-transform:uppercase; }
h1,h2,p { margin-top:0; } h1 { margin-bottom:.35rem; color:var(--rt-text-strong,var(--ink-bright)); font:700 clamp(2.2rem,5vw,4rem)/.95 var(--font-book); } .workshop-hero p:last-child { margin:0; max-width:65ch; color:var(--rt-text-muted,var(--ink-muted)); line-height:1.5; }
.creation-card,.activity { border:1px solid var(--rt-rule,var(--rule-soft)); background:var(--rt-surface-1,var(--paper-soft)); padding:clamp(1rem,2vw,1.5rem); }
.creation-card { border-left:4px solid var(--rt-focus,var(--info)); }
.section-heading { display:flex; align-items:center; gap:.75rem; margin-bottom:1rem; } .section-heading > svg { color:var(--rt-focus,var(--info)); } .section-heading h2 { margin:0; color:var(--rt-text-strong,var(--ink-bright)); font:700 1.65rem/1 var(--font-book); }
.creation-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:1rem; } label { display:grid; align-content:start; gap:.4rem; color:var(--rt-text-muted,var(--ink-muted)); font-size:.78rem; font-weight:800; letter-spacing:.04em; } input,select,textarea { width:100%; min-height:46px; border:1px solid var(--rt-rule,var(--rule-soft)); background:var(--rt-bg-canvas,var(--paper-inset)); color:var(--rt-text-strong,var(--ink-bright)); padding:.7rem .8rem; } textarea { resize:vertical; } small { color:var(--rt-text-muted,var(--ink-muted)); font-size:.76rem; } .wide { grid-column:1/-1; }
.battle-workshop-note { display:grid; gap:.25rem; border:1px solid var(--rt-pending,var(--warn)); border-left:4px solid var(--rt-pending,var(--warn)); background:var(--rt-bg-canvas,var(--paper-inset)); padding:.8rem 1rem; }.battle-workshop-note strong { color:var(--rt-text-strong,var(--ink-bright)); }.battle-workshop-note span { color:var(--rt-text-muted,var(--ink-muted)); line-height:1.45; }
.prize-builder { display:grid; grid-template-columns:minmax(0,2fr) minmax(7rem,.5fr) auto; align-items:end; gap:.65rem; border-top:1px solid var(--rt-rule,var(--rule-soft)); padding-top:.8rem; }.prize-builder ul { grid-column:1/-1; display:flex; flex-wrap:wrap; gap:.4rem; list-style:none; margin:0; padding:0; }.prize-builder li { display:flex; align-items:center; gap:.35rem; border:1px solid var(--rt-rule,var(--rule-soft)); padding:.3rem .45rem; }.prize-builder li button { min-height:44px; border:0; background:transparent; color:var(--rt-danger,var(--bad)); cursor:pointer; }
.festival-option { display:flex; align-items:center; min-height:46px; color:var(--rt-text,var(--ink)); } .festival-option input { width:1.2rem; min-height:1.2rem; accent-color:var(--rt-focus,var(--info)); }
.toggles { display:flex; flex-wrap:wrap; gap:1rem 2rem; } .toggles label { display:flex; align-items:center; min-height:44px; font-size:.9rem; color:var(--rt-text,var(--ink)); } .toggles input { width:1.2rem; min-height:1.2rem; accent-color:var(--rt-focus,var(--info)); }
.primary-action,.quiet-action { display:inline-flex; align-items:center; justify-content:center; gap:.5rem; min-height:46px; border:1px solid var(--rt-brand,var(--accent)); background:var(--rt-brand,var(--accent)); color:var(--rt-bg-world,var(--ink)); padding:.7rem 1rem; cursor:pointer; font-weight:850; } .quiet-action { border-color:var(--rt-rule,var(--rule-soft)); background:transparent; color:var(--rt-text,var(--ink)); }
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,a:focus-visible { outline:3px solid var(--rt-focus,#59d8ff); outline-offset:3px; }
.system-message,.empty-state { padding:1rem; border:1px solid var(--rt-rule,var(--rule-soft)); background:var(--rt-surface-1,var(--paper-soft)); } .system-message--error { border-color:var(--rt-danger,var(--bad)); color:var(--rt-danger,var(--bad)); }
.contest-list { display:grid; gap:.65rem; } .contest-row { position:relative; display:grid; grid-template-columns:minmax(0,1fr) auto auto; align-items:center; gap:1rem; min-height:72px; padding:.85rem 1rem .85rem 1.35rem; border:1px solid var(--rt-rule,var(--rule-soft)); background:var(--rt-bg-canvas,var(--paper-inset)); color:var(--rt-text,var(--ink)); text-decoration:none; } .contest-row:hover { border-color:var(--rt-focus,var(--info)); } .contest-row__signal { position:absolute; inset:0 auto 0 0; width:4px; background:var(--rt-brand,var(--accent)); } .contest-row strong,.contest-row small { display:block; } .contest-row strong { color:var(--rt-text-strong,var(--ink-bright)); font-size:1.05rem; } .contest-row__status { color:var(--rt-pending,var(--warn)); font-weight:800; text-transform:capitalize; } .contest-row__count { min-width:5rem; text-align:right; font:700 1.35rem var(--font-mono); }
@media (max-width:800px) { .creation-grid { grid-template-columns:1fr 1fr; } .contest-row { grid-template-columns:minmax(0,1fr) auto; } .contest-row__count { display:none; } }
@media (max-width:520px) { .prize-builder { grid-template-columns:1fr; } .prize-builder ul { grid-column:auto; } .workshop-hero { align-items:stretch; flex-direction:column; } .creation-grid { grid-template-columns:1fr; } .wide { grid-column:auto; } .contest-row { grid-template-columns:1fr; gap:.35rem; } .contest-row__status { display:flex; justify-content:space-between; } }
@media (prefers-reduced-motion:reduce) { * { scroll-behavior:auto!important; transition:none!important; } }
</style>
