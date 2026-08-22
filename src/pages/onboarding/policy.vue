<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { PhArrowLeft, PhUploadSimple } from '@phosphor-icons/vue'
import AppNavigation from '~/components/AppNavigation.vue'
import type { GmOnboardingOverview } from '~~/server/useCases/onboardingWorkflows'
import {
  ONBOARDING_INVENTORY_SECTIONS,
  parseCampaignOnboardingPolicyContent,
  type CampaignOnboardingPolicyContentV1,
} from '#shared/onboarding/policy'
import {
  ONBOARDING_ITEM_PACKAGE_PRESETS,
  ONBOARDING_STARTER_POOL_PRESETS,
} from '#shared/onboarding/presets'
import { onboardingCreationCatalog } from '#shared/onboarding/catalog'
import { ONBOARDING_PATH } from '~/utils/onboardingRoutes'
import { DEFAULT_LOGIN_REDIRECT } from '~/utils/loginRedirect'

useHead({ title: 'Onboarding policy · Rotom Table' })

definePageMeta({
  middleware: () => {
    const { isPlayer } = useAuth()
    if (isPlayer.value) return navigateTo(DEFAULT_LOGIN_REDIRECT)
  },
})

const { getJson, postJson } = useApiClient()

const overview = ref<GmOnboardingOverview | null>(null)
const loading = ref(false)
const publishing = ref(false)
const lastError = ref<string | null>(null)
const lastNotice = ref<string | null>(null)

const catalog = onboardingCreationCatalog()

interface EditableItemGrant { itemId: string, quantity: number, section: string }

const form = reactive({
  name: 'Campaign start',
  description: '',
  startingLevel: 1,
  moneyMode: 'canonical-baseline' as 'canonical-baseline' | 'explicit',
  moneyAmount: catalog.trainer.startingMoney.recommendedDefault,
  milestoneCollection: 'during-onboarding' as 'during-onboarding' | 'defer-to-attention',
  starterCount: 1,
  starterLevel: 5,
  poolMode: 'any-canonical' as 'any-canonical' | 'curated-list',
  poolSpecies: [] as string[],
  poolEntry: '',
  stageRestriction: 'unrestricted' as 'unrestricted' | 'first-stage-only',
  loyaltyMode: 'canonical-baseline' as 'canonical-baseline' | 'explicit',
  loyaltyValue: catalog.pokemon.startingLoyalty.defaultValue,
  caughtBallPolicy: 'standard-metadata' as 'standard-metadata' | 'none' | 'player-choice',
  unresolvedChoicePolicy: 'all-required-resolved' as 'all-required-resolved' | 'allow-optional-deferral',
  trainerFolder: 'players',
  pokemonFolder: 'players',
  trainerItems: [] as EditableItemGrant[],
})

const formError = computed(() => builtState.value.error)

const speciesLookupError = ref<string | null>(null)

const addPoolSpecies = (): void => {
  const entry = form.poolEntry.trim()
  speciesLookupError.value = null
  if (!entry) return
  const record = catalog.species.get(entry)
  if (!record) {
    speciesLookupError.value = `"${entry}" is not a canonical Pokédex entry.`
    return
  }
  if (!record.eligible) {
    speciesLookupError.value = `${entry} has incomplete canonical data (${record.ineligibleReasons.join(', ')}) and cannot be offered.`
    return
  }
  if (!form.poolSpecies.includes(entry)) form.poolSpecies.push(entry)
  form.poolEntry = ''
}

const removePoolSpecies = (species: string): void => {
  form.poolSpecies = form.poolSpecies.filter(entry => entry !== species)
}

const applyPoolPreset = (presetId: string): void => {
  const preset = ONBOARDING_STARTER_POOL_PRESETS.find(candidate => candidate.presetId === presetId)
  if (!preset) return
  form.poolMode = 'curated-list'
  form.poolSpecies = [...preset.speciesIds]
}

const applyItemPreset = (presetId: string): void => {
  const preset = ONBOARDING_ITEM_PACKAGE_PRESETS.find(candidate => candidate.presetId === presetId)
  if (!preset) return
  form.trainerItems = preset.trainerItems.map(grant => ({ ...grant }))
}

const addItemRow = (): void => {
  form.trainerItems.push({ itemId: '', quantity: 1, section: 'keyItems' })
}

const removeItemRow = (index: number): void => {
  form.trainerItems.splice(index, 1)
}

const builtState = computed<{ content: CampaignOnboardingPolicyContentV1 | null, error: string | null }>(() => {
  try {
    const content = parseCampaignOnboardingPolicyContent({
      schemaVersion: 1,
      trainer: {
        startingLevel: form.startingLevel,
        startingMoney: form.moneyMode === 'canonical-baseline'
          ? { kind: 'canonical-baseline' }
          : { kind: 'explicit', amount: form.moneyAmount },
        featureRestriction: { mode: 'all-canonical' },
        edgeRestriction: { mode: 'all-canonical' },
        milestoneCollection: form.milestoneCollection,
      },
      pokemon: {
        starterCount: form.starterCount,
        starterLevel: form.starterLevel,
        starterPool: form.poolMode === 'any-canonical'
          ? { mode: 'any-canonical' }
          : { mode: 'curated-list', speciesIds: form.poolSpecies },
        stageRestriction: form.stageRestriction,
        additionalMoveSources: [],
        startingLoyalty: form.loyaltyMode === 'canonical-baseline'
          ? { kind: 'canonical-baseline' }
          : { kind: 'explicit', value: form.loyaltyValue },
        caughtBallPolicy: form.caughtBallPolicy,
      },
      packages: {
        trainerItems: form.trainerItems.filter(grant => grant.itemId.trim() !== ''),
        starterHeldItems: [],
      },
      workflow: {
        unresolvedChoicePolicy: form.unresolvedChoicePolicy,
        deferrableDecisions: form.unresolvedChoicePolicy === 'allow-optional-deferral'
          ? ['pokemon.1.caught-ball']
          : [],
        approval: 'gm-review-required',
        destinations: { trainerFolder: form.trainerFolder, pokemonFolder: form.pokemonFolder },
      },
    })
    return { content, error: null }
  } catch (error) {
    return { content: null, error: error instanceof Error ? error.message : 'Policy content is invalid' }
  }
})

const builtContent = computed(() => builtState.value.content)

const packageIssues = computed(() => {
  const issues: string[] = []
  for (const grant of form.trainerItems) {
    const itemId = grant.itemId.trim()
    if (itemId && !catalog.items.has(itemId)) {
      issues.push(`"${itemId}" is not a canonical item.`)
    }
  }
  return issues
})

const openDraftCount = computed(() =>
  (overview.value?.slots ?? []).filter(slot => slot.status === 'open').length)

const canPublish = computed(() =>
  builtContent.value !== null
  && packageIssues.value.length === 0
  && form.name.trim() !== ''
  && !publishing.value)

const load = async (): Promise<void> => {
  loading.value = true
  lastError.value = null
  try {
    overview.value = await getJson<GmOnboardingOverview>('/api/onboarding/overview')
    const active = overview.value?.activePolicy
    if (active) {
      form.name = active.display.name
      form.description = active.display.description
      form.startingLevel = active.content.trainer.startingLevel
      form.moneyMode = active.content.trainer.startingMoney.kind
      if (active.content.trainer.startingMoney.kind === 'explicit') {
        form.moneyAmount = active.content.trainer.startingMoney.amount
      }
      form.milestoneCollection = active.content.trainer.milestoneCollection
      form.starterCount = active.content.pokemon.starterCount
      form.starterLevel = active.content.pokemon.starterLevel
      form.poolMode = active.content.pokemon.starterPool.mode
      form.poolSpecies = active.content.pokemon.starterPool.mode === 'curated-list'
        ? [...active.content.pokemon.starterPool.speciesIds]
        : []
      form.stageRestriction = active.content.pokemon.stageRestriction
      form.loyaltyMode = active.content.pokemon.startingLoyalty.kind
      if (active.content.pokemon.startingLoyalty.kind === 'explicit') {
        form.loyaltyValue = active.content.pokemon.startingLoyalty.value
      }
      form.caughtBallPolicy = active.content.pokemon.caughtBallPolicy
      form.unresolvedChoicePolicy = active.content.workflow.unresolvedChoicePolicy
      form.trainerFolder = active.content.workflow.destinations.trainerFolder
      form.pokemonFolder = active.content.workflow.destinations.pokemonFolder
      form.trainerItems = active.content.packages.trainerItems.map(grant => ({ ...grant }))
    }
  } catch (error) {
    lastError.value = error instanceof Error ? error.message : 'Failed to load'
  } finally {
    loading.value = false
  }
}

const publish = async (): Promise<void> => {
  if (!builtContent.value) return
  publishing.value = true
  lastError.value = null
  lastNotice.value = null
  try {
    await postJson('/api/onboarding/policy/publish', {
      content: builtContent.value,
      display: { name: form.name.trim(), description: form.description },
      policyId: overview.value?.activePolicy?.identity.policyId,
    })
    lastNotice.value = 'Published a new policy version. Existing drafts stay on their bound version until you migrate or restart them.'
    await load()
  } catch (error) {
    lastError.value = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
      ?? (error instanceof Error ? error.message : 'Publish failed')
  } finally {
    publishing.value = false
  }
}

onMounted(() => { void load() })
</script>

<template>
  <main class="policy-page rt-design-system" data-rt-design-system="1" data-rt-context="workshop">
    <AppNavigation />

    <header class="policy-page__hero">
      <div>
        <NuxtLink class="policy-page__back" :to="ONBOARDING_PATH">
          <PhArrowLeft :size="16" weight="bold" aria-hidden="true" />
          Onboarding
        </NuxtLink>
        <h1>Campaign onboarding policy</h1>
        <p>
          Starting rules are explicit, versioned policy. Publishing creates a new immutable version;
          it never silently changes drafts already in progress.
        </p>
      </div>
    </header>

    <p v-if="loading" class="policy-page__state" role="status">Loading policy…</p>

    <template v-else>
      <p v-if="lastNotice" class="policy-page__notice" role="status">{{ lastNotice }}</p>
      <p v-if="lastError" class="policy-page__error" role="alert">{{ lastError }}</p>

      <section v-if="overview?.activePolicy" class="policy-card policy-card--current">
        <h2>Active version</h2>
        <p>
          <strong>{{ overview.activePolicy.display.name }}</strong>
          · v{{ overview.activePolicy.identity.version }}
          · published {{ new Date(overview.activePolicy.identity.publishedAt).toLocaleString() }}
        </p>
        <p v-if="openDraftCount > 0" class="policy-card__impact">
          {{ openDraftCount }} open slot(s) stay bound to their current version until you migrate or restart them from the queue.
        </p>
      </section>

      <form class="policy-form" @submit.prevent="publish">
        <section class="policy-card" aria-labelledby="policy-identity-title">
          <h2 id="policy-identity-title">Name</h2>
          <label class="policy-field">
            <span>Policy name</span>
            <input v-model="form.name" type="text" maxlength="80" required>
          </label>
          <label class="policy-field">
            <span>Description (optional)</span>
            <textarea v-model="form.description" rows="2" maxlength="2000" />
          </label>
        </section>

        <section class="policy-card" aria-labelledby="policy-trainer-title">
          <h2 id="policy-trainer-title">Trainer start</h2>
          <div class="policy-grid">
            <label class="policy-field">
              <span>Starting level (1–50)</span>
              <input v-model.number="form.startingLevel" type="number" min="1" max="50">
            </label>
            <label class="policy-field">
              <span>Starting money</span>
              <select v-model="form.moneyMode">
                <option value="canonical-baseline">Book recommendation ({{ catalog.trainer.startingMoney.recommendedDefault }})</option>
                <option value="explicit">Custom amount</option>
              </select>
            </label>
            <label v-if="form.moneyMode === 'explicit'" class="policy-field">
              <span>Amount</span>
              <input v-model.number="form.moneyAmount" type="number" min="0" max="1000000">
            </label>
            <label v-if="form.startingLevel >= 5" class="policy-field">
              <span>Milestone choices (Level 5+)</span>
              <select v-model="form.milestoneCollection">
                <option value="during-onboarding">Collected during onboarding</option>
                <option value="defer-to-attention">Deferred to campaign attention</option>
              </select>
            </label>
          </div>
        </section>

        <section class="policy-card" aria-labelledby="policy-pokemon-title">
          <h2 id="policy-pokemon-title">Starters</h2>
          <div class="policy-grid">
            <label class="policy-field">
              <span>Starter count (1–6)</span>
              <input v-model.number="form.starterCount" type="number" min="1" max="6">
            </label>
            <label class="policy-field">
              <span>Starter level (1–100)</span>
              <input v-model.number="form.starterLevel" type="number" min="1" max="100">
            </label>
            <label class="policy-field">
              <span>Species pool</span>
              <select v-model="form.poolMode">
                <option value="any-canonical">Any canonical species</option>
                <option value="curated-list">Curated list</option>
              </select>
            </label>
            <label class="policy-field">
              <span>Stage restriction</span>
              <select v-model="form.stageRestriction">
                <option value="unrestricted">Unrestricted</option>
                <option value="first-stage-only">First-stage species only</option>
              </select>
            </label>
            <label class="policy-field">
              <span>Starting Loyalty</span>
              <select v-model="form.loyaltyMode">
                <option value="canonical-baseline">Book baseline ({{ catalog.pokemon.startingLoyalty.defaultValue }})</option>
                <option value="explicit">Custom value</option>
              </select>
            </label>
            <label v-if="form.loyaltyMode === 'explicit'" class="policy-field">
              <span>Loyalty ({{ catalog.pokemon.startingLoyalty.minimum }}–{{ catalog.pokemon.startingLoyalty.maximum }})</span>
              <input v-model.number="form.loyaltyValue" type="number" :min="catalog.pokemon.startingLoyalty.minimum" :max="catalog.pokemon.startingLoyalty.maximum">
            </label>
            <label class="policy-field">
              <span>Caught-ball metadata</span>
              <select v-model="form.caughtBallPolicy">
                <option value="standard-metadata">Standard Poké Ball</option>
                <option value="none">None</option>
                <option value="player-choice">Player chooses</option>
              </select>
            </label>
          </div>

          <div v-if="form.poolMode === 'curated-list'" class="policy-pool">
            <div class="policy-pool__presets">
              <span class="policy-pool__label">Presets:</span>
              <button
                v-for="preset in ONBOARDING_STARTER_POOL_PRESETS"
                :key="preset.presetId"
                type="button"
                class="policy-chip"
                :title="preset.description"
                @click="applyPoolPreset(preset.presetId)"
              >
                {{ preset.label }}
              </button>
            </div>
            <div class="policy-pool__add">
              <input
                v-model="form.poolEntry"
                type="text"
                list="onboarding-species-options"
                placeholder="Add species by exact Pokédex name"
                @keydown.enter.prevent="addPoolSpecies"
              >
              <datalist id="onboarding-species-options">
                <option v-for="species in [...catalog.species.values()].filter(s => s.eligible).slice(0, 2000)" :key="species.speciesId" :value="species.speciesId" />
              </datalist>
              <button type="button" class="policy-chip" @click="addPoolSpecies">Add</button>
            </div>
            <p v-if="speciesLookupError" class="policy-page__error" role="alert">{{ speciesLookupError }}</p>
            <ul class="policy-pool__list">
              <li v-for="species in form.poolSpecies" :key="species" class="policy-pool__entry">
                {{ species }}
                <button type="button" class="policy-pool__remove" :aria-label="`Remove ${species}`" @click="removePoolSpecies(species)">×</button>
              </li>
            </ul>
            <p v-if="form.poolSpecies.length === 0" class="policy-card__impact">A curated pool needs at least one species.</p>
          </div>
        </section>

        <section class="policy-card" aria-labelledby="policy-packages-title">
          <h2 id="policy-packages-title">Starting item package</h2>
          <div class="policy-pool__presets">
            <span class="policy-pool__label">Presets:</span>
            <button
              v-for="preset in ONBOARDING_ITEM_PACKAGE_PRESETS"
              :key="preset.presetId"
              type="button"
              class="policy-chip"
              :title="preset.description"
              @click="applyItemPreset(preset.presetId)"
            >
              {{ preset.label }}
            </button>
          </div>
          <table v-if="form.trainerItems.length > 0" class="policy-items">
            <thead>
              <tr><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Section</th><th scope="col"><span class="sr-only">Remove</span></th></tr>
            </thead>
            <tbody>
              <tr v-for="(grant, index) in form.trainerItems" :key="index">
                <td><input v-model="grant.itemId" type="text" placeholder="Canonical item name"></td>
                <td><input v-model.number="grant.quantity" type="number" min="1" max="99"></td>
                <td>
                  <select v-model="grant.section">
                    <option v-for="section in ONBOARDING_INVENTORY_SECTIONS" :key="section" :value="section">{{ section }}</option>
                  </select>
                </td>
                <td><button type="button" class="policy-pool__remove" :aria-label="`Remove row ${index + 1}`" @click="removeItemRow(index)">×</button></td>
              </tr>
            </tbody>
          </table>
          <button type="button" class="policy-chip" @click="addItemRow">Add item row</button>
          <p v-for="issue in packageIssues" :key="issue" class="policy-page__error" role="alert">{{ issue }}</p>
        </section>

        <section class="policy-card" aria-labelledby="policy-workflow-title">
          <h2 id="policy-workflow-title">Workflow</h2>
          <div class="policy-grid">
            <label class="policy-field">
              <span>Optional decisions</span>
              <select v-model="form.unresolvedChoicePolicy">
                <option value="all-required-resolved">Everything resolved before submission</option>
                <option value="allow-optional-deferral">Allow deferring optional decisions</option>
              </select>
            </label>
            <label class="policy-field">
              <span>Trainer sheet folder</span>
              <input v-model="form.trainerFolder" type="text" maxlength="200">
            </label>
            <label class="policy-field">
              <span>Pokémon sheet folder</span>
              <input v-model="form.pokemonFolder" type="text" maxlength="200">
            </label>
          </div>
          <p class="policy-card__impact">Approval is always an explicit GM review in this version.</p>
        </section>

        <p v-if="formError" class="policy-page__error" role="alert">{{ formError }}</p>

        <button type="submit" class="policy-form__publish" :disabled="!canPublish">
          <PhUploadSimple :size="18" weight="bold" aria-hidden="true" />
          {{ publishing ? 'Publishing…' : overview?.activePolicy ? `Publish version ${overview.activePolicy.identity.version + 1}` : 'Publish version 1' }}
        </button>
      </form>
    </template>
  </main>
</template>

<style scoped>
.policy-page {
  min-height: 100vh;
  display: grid;
  align-content: start;
  gap: var(--rt-space-5, 1.25rem);
  padding: clamp(.75rem, 2vw, 1.5rem);
  background: var(--rt-bg-canvas, var(--paper));
  color: var(--rt-text, var(--ink));
}
.policy-page__back {
  display: inline-flex;
  align-items: center;
  gap: .35rem;
  color: var(--rt-text-muted, var(--ink-soft));
  font-size: .8rem;
  font-weight: 750;
  text-decoration: none;
  min-height: 44px;
}
.policy-page__hero h1 {
  margin: 0 0 .3rem;
  color: var(--rt-text-strong, var(--ink-bright));
  font: 700 1.9rem/1.05 var(--font-book);
}
.policy-page__hero p { margin: 0; color: var(--rt-text-muted, var(--ink-soft)); max-width: 62ch; }
.policy-page__state { padding: 1rem; }
.policy-page__notice {
  margin: 0;
  padding: .75rem 1rem;
  border-left: 4px solid var(--rt-success, #58d5a0);
  background: var(--rt-surface-1, var(--paper-soft));
}
.policy-page__error {
  margin: 0;
  padding: .6rem .9rem;
  border-left: 4px solid var(--rt-danger, #ff6672);
  background: var(--rt-surface-1, var(--paper-soft));
  color: var(--rt-text, var(--ink));
}
.policy-form { display: grid; gap: var(--rt-space-4, 1rem); }
.policy-card {
  display: grid;
  gap: .7rem;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-1, var(--paper-soft));
  padding: var(--rt-space-4, 1rem);
}
.policy-card h2 { margin: 0; font: 700 1.2rem/1.1 var(--font-book); color: var(--rt-text-strong, var(--ink-bright)); }
.policy-card--current { border-left: 4px solid var(--rt-focus, #59d8ff); }
.policy-card__impact { margin: 0; color: var(--rt-text-muted, var(--ink-soft)); font-size: .85rem; }
.policy-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  gap: .75rem;
}
.policy-field { display: grid; gap: .3rem; }
.policy-field span { font-size: .78rem; font-weight: 750; color: var(--rt-text-muted, var(--ink-soft)); }
.policy-field input,
.policy-field select,
.policy-field textarea,
.policy-pool__add input,
.policy-items input,
.policy-items select {
  min-height: 44px;
  padding: .45rem .6rem;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-2, var(--paper-inset));
  color: var(--rt-text, var(--ink));
  font: inherit;
  width: 100%;
}
.policy-field textarea { min-height: 60px; resize: vertical; }
.policy-pool { display: grid; gap: .6rem; }
.policy-pool__presets { display: flex; flex-wrap: wrap; align-items: center; gap: .45rem; }
.policy-pool__label { font-size: .78rem; font-weight: 750; color: var(--rt-text-muted, var(--ink-soft)); }
.policy-chip {
  min-height: 40px;
  padding: .35rem .75rem;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-2, var(--paper-inset));
  color: var(--rt-text, var(--ink));
  font-weight: 700;
  cursor: pointer;
  width: fit-content;
}
.policy-pool__add { display: flex; gap: .45rem; }
.policy-pool__list { list-style: none; display: flex; flex-wrap: wrap; gap: .4rem; margin: 0; padding: 0; }
.policy-pool__entry {
  display: inline-flex;
  align-items: center;
  gap: .35rem;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-2, var(--paper-inset));
  padding: .3rem .55rem;
  font-weight: 700;
}
.policy-pool__remove {
  min-width: 32px;
  min-height: 32px;
  border: none;
  background: transparent;
  color: var(--rt-danger, #b03a44);
  font-size: 1.05rem;
  font-weight: 800;
  cursor: pointer;
}
.policy-items { width: 100%; border-collapse: collapse; }
.policy-items th {
  text-align: left;
  font-size: .75rem;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--rt-text-muted, var(--ink-muted));
  padding: .3rem .4rem;
}
.policy-items td { padding: .25rem .4rem; }
.policy-form__publish {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: .55rem;
  min-height: 48px;
  padding: .7rem 1.2rem;
  border: 1px solid var(--rt-brand, #ff3347);
  background: var(--rt-surface-2, var(--paper-inset));
  color: var(--rt-text-strong, var(--ink-bright));
  font-weight: 800;
  cursor: pointer;
  width: fit-content;
}
.policy-form__publish:disabled { opacity: .55; cursor: not-allowed; }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
.policy-page :is(a, button, select, input, textarea, summary):focus-visible {
  outline: 3px solid var(--rt-focus, #59d8ff);
  outline-offset: 2px;
}
@media (max-width: 520px) {
  .policy-page { padding: .65rem; }
  .policy-pool__add { flex-direction: column; }
}
</style>
