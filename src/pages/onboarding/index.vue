<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PhArrowRight, PhPlus, PhUserCirclePlus } from '@phosphor-icons/vue'
import AppNavigation from '~/components/AppNavigation.vue'
import OnboardingPartyJoinPanel from '~/components/onboarding/OnboardingPartyJoinPanel.vue'
import { useOnboardingOverview } from '~/composables/useOnboarding'
import { ONBOARDING_POLICY_PATH, onboardingBuilderPath } from '~/utils/onboardingRoutes'

useHead({ title: 'Onboarding · Rotom Table' })

const {
  isGm,
  profiles,
  gmOverview,
  playerHome,
  loading,
  busy,
  lastError,
  load,
  createSlot,
  cancelSlot,
  restartSlot,
} = useOnboardingOverview()

const newSlotProfileId = ref('')
const newProfileName = ref('')

const stateLabel = (state: string | null): string => {
  if (!state) return 'Unstarted'
  return {
    'draft': 'In progress',
    'submitted': 'Awaiting review',
    'changes-requested': 'Changes requested',
    'approved': 'Approved',
    'committing': 'Committing',
    'completed': 'Completed',
    'cancelled': 'Cancelled',
    'superseded': 'Superseded',
  }[state] ?? state
}

const stateTone = (state: string | null): string => {
  if (state === 'submitted' || state === 'changes-requested') return 'pending'
  if (state === 'completed' || state === 'approved') return 'success'
  if (state === 'cancelled' || state === 'superseded') return 'muted'
  return 'neutral'
}

const openSlots = computed(() => (gmOverview.value?.slots ?? []).filter(slot => slot.status === 'open'))
const closedSlots = computed(() => (gmOverview.value?.slots ?? []).filter(slot => slot.status !== 'open'))

const ageLabel = (ageMs: number): string => {
  const hours = Math.floor(ageMs / 3_600_000)
  if (hours < 1) return 'under an hour'
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

const submitCreateSlot = async (): Promise<void> => {
  const ok = await createSlot(newSlotProfileId.value
    ? { profileId: newSlotProfileId.value }
    : { newProfileDisplayName: newProfileName.value })
  if (ok) {
    newSlotProfileId.value = ''
    newProfileName.value = ''
  }
}

onMounted(() => { void load() })
</script>

<template>
  <main class="onboarding-page rt-design-system" data-rt-design-system="1" data-rt-context="workshop">
    <AppNavigation />

    <header class="onboarding-page__hero">
      <div>
        <p class="onboarding-page__eyebrow">Campaign onboarding</p>
        <h1>{{ isGm ? 'Onboarding queue' : 'Your character' }}</h1>
        <p v-if="isGm">Open slots for players, follow their progress, and review submissions.</p>
        <p v-else>Build your Trainer and starter team for this campaign.</p>
      </div>
      <div v-if="isGm" class="onboarding-page__hero-links">
        <NuxtLink class="onboarding-page__policy-link" to="/onboarding/intake">
          Existing-character intake
        </NuxtLink>
        <NuxtLink class="onboarding-page__policy-link" :to="ONBOARDING_POLICY_PATH">
          Campaign policy
          <PhArrowRight :size="16" weight="bold" aria-hidden="true" />
        </NuxtLink>
      </div>
    </header>

    <p v-if="loading" class="onboarding-page__state" role="status">Loading onboarding…</p>
    <section v-else-if="lastError" class="onboarding-page__state onboarding-page__state--error" role="alert">
      <p>{{ lastError }}</p>
      <button type="button" @click="load()">Try again</button>
    </section>

    <!-- GM queue -->
    <template v-else-if="isGm && gmOverview">
      <section v-if="!gmOverview.activePolicy" class="onboarding-card onboarding-card--attention" aria-labelledby="no-policy-title">
        <h2 id="no-policy-title">Publish a campaign policy first</h2>
        <p>Slots bind players to a versioned starting policy. Publish one to open onboarding.</p>
        <NuxtLink class="onboarding-card__action" :to="ONBOARDING_POLICY_PATH">Open policy editor</NuxtLink>
      </section>

      <section v-else class="onboarding-card" aria-labelledby="open-slot-title">
        <h2 id="open-slot-title">
          <PhUserCirclePlus :size="20" weight="duotone" aria-hidden="true" />
          Open a slot
        </h2>
        <p class="onboarding-card__hint">
          Active policy: <strong>{{ gmOverview.activePolicy.display.name }}</strong>
          (v{{ gmOverview.activePolicy.identity.version }}) ·
          Level {{ gmOverview.activePolicy.content.trainer.startingLevel }} ·
          {{ gmOverview.activePolicy.content.pokemon.starterCount }} starter(s) at Level {{ gmOverview.activePolicy.content.pokemon.starterLevel }}
        </p>
        <form class="onboarding-slot-form" @submit.prevent="submitCreateSlot">
          <label class="onboarding-slot-form__field">
            <span>Existing player profile</span>
            <select v-model="newSlotProfileId" :disabled="busy">
              <option value="">— Create a new profile —</option>
              <option
                v-for="candidate in gmOverview.profilesWithoutSlots"
                :key="candidate.profileId"
                :value="candidate.profileId"
              >
                {{ candidate.displayName }}
              </option>
            </select>
          </label>
          <label v-if="!newSlotProfileId" class="onboarding-slot-form__field">
            <span>New profile name</span>
            <input v-model="newProfileName" type="text" maxlength="64" placeholder="Player name" :disabled="busy">
          </label>
          <button type="submit" class="onboarding-slot-form__submit" :disabled="busy || (!newSlotProfileId && newProfileName.trim() === '')">
            <PhPlus :size="16" weight="bold" aria-hidden="true" />
            Open onboarding slot
          </button>
        </form>
      </section>

      <section class="onboarding-card" aria-labelledby="queue-title">
        <h2 id="queue-title">Queue</h2>
        <p v-if="openSlots.length === 0" class="onboarding-card__hint">No open onboarding slots.</p>
        <ul v-else class="onboarding-queue">
          <li v-for="slot in openSlots" :key="slot.slotId" class="onboarding-queue__row">
            <div class="onboarding-queue__who">
              <strong>{{ slot.profileDisplayName }}</strong>
              <span class="onboarding-queue__meta">policy v{{ slot.policyVersion }} · open {{ ageLabel(slot.ageMs) }}</span>
            </div>
            <span class="onboarding-queue__state" :data-tone="stateTone(slot.draftState)">
              {{ stateLabel(slot.draftState) }}
              <template v-if="slot.submissionRevision > 0"> · submission #{{ slot.submissionRevision }}</template>
            </span>
            <div class="onboarding-queue__actions">
              <NuxtLink
                v-if="slot.draftId && slot.draftState === 'submitted'"
                class="onboarding-queue__open onboarding-queue__open--review"
                :to="`/onboarding/review/${slot.draftId}`"
              >
                Review
              </NuxtLink>
              <NuxtLink v-if="slot.draftId" class="onboarding-queue__open" :to="onboardingBuilderPath(slot.draftId)">
                Open
              </NuxtLink>
              <button type="button" class="onboarding-queue__minor" :disabled="busy" @click="restartSlot(slot.slotId)">
                Restart
              </button>
              <button type="button" class="onboarding-queue__minor onboarding-queue__minor--danger" :disabled="busy" @click="cancelSlot(slot.slotId)">
                Cancel
              </button>
            </div>
          </li>
        </ul>

        <OnboardingPartyJoinPanel />

        <section v-if="gmOverview.roster.length > 0" class="onboarding-card" aria-labelledby="roster-title">
          <h2 id="roster-title">Campaign roster</h2>
          <table class="onboarding-roster">
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">Trainers</th>
                <th scope="col">Pokémon</th>
                <th scope="col">Onboarding</th>
                <th scope="col">Conflicts</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in gmOverview.roster" :key="row.profileId">
                <th scope="row">{{ row.displayName }}</th>
                <td>
                  <template v-if="row.trainerSlugs.length === 0">—</template>
                  <NuxtLink v-for="slug in row.trainerSlugs" :key="slug" :to="`/sheets/trainers/${slug}`" class="onboarding-roster__link">
                    {{ slug }}
                  </NuxtLink>
                </td>
                <td>{{ row.linkedPokemonCount }}</td>
                <td>{{ stateLabel(row.onboardingState === 'none' ? null : row.onboardingState) }}</td>
                <td>
                  <span v-if="row.conflicts.length > 0" class="onboarding-roster__conflict">
                    {{ row.conflicts.length }} shared link(s)
                  </span>
                  <template v-else>—</template>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <details v-if="closedSlots.length > 0" class="onboarding-history">
          <summary>History ({{ closedSlots.length }})</summary>
          <ul class="onboarding-queue">
            <li v-for="slot in closedSlots" :key="slot.slotId" class="onboarding-queue__row onboarding-queue__row--closed">
              <div class="onboarding-queue__who">
                <strong>{{ slot.profileDisplayName }}</strong>
                <span class="onboarding-queue__meta">policy v{{ slot.policyVersion }}</span>
              </div>
              <span class="onboarding-queue__state" :data-tone="stateTone(slot.status === 'completed' ? 'completed' : slot.status)">
                {{ stateLabel(slot.status === 'completed' ? 'completed' : slot.status) }}
              </span>
            </li>
          </ul>
        </details>
      </section>
    </template>

    <!-- Player home -->
    <template v-else-if="!isGm">
      <section v-if="!profiles.hasSelectedProfile.value" class="onboarding-card onboarding-card--attention">
        <h2>Select your player profile</h2>
        <p>Pick who you are at this table first; your character draft is bound to your profile.</p>
        <NuxtLink class="onboarding-card__action" to="/login">Choose profile</NuxtLink>
      </section>

      <template v-else-if="playerHome">
        <section v-if="playerHome.completion" class="onboarding-card onboarding-card--success" aria-labelledby="done-title">
          <h2 id="done-title">Ready for play</h2>
          <p>
            Your character package is complete and linked to your profile.
            The draft is archived; your sheets are now the only authority.
          </p>
          <div class="onboarding-ready-actions">
            <NuxtLink
              v-if="playerHome.completion.refs.trainerSlug"
              class="onboarding-card__action"
              :to="`/sheets/trainers/${playerHome.completion.refs.trainerSlug}`"
            >
              Trainer sheet
            </NuxtLink>
            <NuxtLink
              v-for="slug in (playerHome.completion.refs.pokemonSlugs as string[] ?? [])"
              :key="slug"
              class="onboarding-card__action"
              :to="`/sheets/${slug}`"
            >
              {{ slug }}
            </NuxtLink>
            <NuxtLink class="onboarding-card__action" to="/trainers">Trainer portal</NuxtLink>
            <NuxtLink class="onboarding-card__action" to="/campaign">Campaign</NuxtLink>
            <NuxtLink class="onboarding-card__action" to="/play">Encounters</NuxtLink>
          </div>
          <p
            v-if="(playerHome.draft?.deferredDecisions?.length ?? 0) > 0"
            class="onboarding-card__hint"
          >
            Follow-up: {{ playerHome.draft!.deferredDecisions.length }} optional decision(s) were deferred and can be settled on the sheet later.
          </p>
        </section>

        <section v-else-if="playerHome.slot && playerHome.draft" class="onboarding-card" aria-labelledby="resume-title">
          <h2 id="resume-title">
            {{ playerHome.draft.trainerBuild.name ? playerHome.draft.trainerBuild.name : 'New Trainer' }}
          </h2>
          <p class="onboarding-card__hint">
            {{ stateLabel(playerHome.slot.draftState) }}
            · policy v{{ playerHome.slot.policyVersion }}
            <template v-if="playerHome.policy">
              · Level {{ playerHome.policy.content.trainer.startingLevel }} start
              · {{ playerHome.policy.content.pokemon.starterCount }} starter(s)
            </template>
          </p>
          <NuxtLink class="onboarding-card__action" :to="onboardingBuilderPath(playerHome.draft.draftId)">
            {{ playerHome.slot.draftState === 'changes-requested' ? 'Review requested changes' : 'Continue building' }}
            <PhArrowRight :size="16" weight="bold" aria-hidden="true" />
          </NuxtLink>
        </section>

        <section v-else class="onboarding-card">
          <h2>No onboarding slot yet</h2>
          <p>Your GM has not opened character creation for your profile. Ask them to open a slot on the Onboarding queue.</p>
        </section>
      </template>
    </template>
  </main>
</template>

<style scoped>
.onboarding-page {
  min-height: 100vh;
  display: grid;
  align-content: start;
  gap: var(--rt-space-5, 1.25rem);
  padding: clamp(.75rem, 2vw, 1.5rem);
  background: var(--rt-bg-canvas, var(--paper));
  color: var(--rt-text, var(--ink));
}
.onboarding-page__hero {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: end;
  justify-content: space-between;
}
.onboarding-page__hero h1 {
  margin: .15rem 0 .3rem;
  color: var(--rt-text-strong, var(--ink-bright));
  font: 700 1.9rem/1.05 var(--font-book);
}
.onboarding-page__hero p { margin: 0; color: var(--rt-text-muted, var(--ink-soft)); }
.onboarding-page__eyebrow {
  margin: 0;
  color: var(--rt-text-muted, var(--ink-muted));
  font-size: .72rem;
  font-weight: 800;
  letter-spacing: .1em;
  text-transform: uppercase;
}
.onboarding-page__hero-links { display: flex; flex-wrap: wrap; gap: .5rem; }
.onboarding-page__policy-link {
  display: inline-flex;
  align-items: center;
  gap: .45rem;
  min-height: 44px;
  padding: .55rem .9rem;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-1, var(--paper-soft));
  color: var(--rt-text-strong, var(--ink-bright));
  font-weight: 750;
  text-decoration: none;
}
.onboarding-page__state {
  padding: 1rem;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-1, var(--paper-soft));
}
.onboarding-page__state--error { border-color: var(--rt-danger, #ff6672); }
.onboarding-page__state--error button {
  margin-top: .5rem;
  min-height: 44px;
  padding: .5rem .9rem;
  cursor: pointer;
}

.onboarding-card {
  display: grid;
  gap: .65rem;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-1, var(--paper-soft));
  padding: var(--rt-space-4, 1rem);
}
.onboarding-card h2 {
  display: flex;
  align-items: center;
  gap: .5rem;
  margin: 0;
  color: var(--rt-text-strong, var(--ink-bright));
  font: 700 1.3rem/1.1 var(--font-book);
}
.onboarding-card__hint { margin: 0; color: var(--rt-text-muted, var(--ink-soft)); }
.onboarding-card--attention { border-left: 4px solid var(--rt-pending, #ffbf52); }
.onboarding-card--success { border-left: 4px solid var(--rt-success, #58d5a0); }
.onboarding-ready-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
.onboarding-card__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: .5rem;
  min-height: 46px;
  padding: .65rem 1rem;
  border: 1px solid var(--rt-focus, var(--info));
  background: var(--rt-surface-2, var(--paper-inset));
  color: var(--rt-text-strong, var(--ink-bright));
  font-weight: 800;
  text-decoration: none;
  width: fit-content;
}

.onboarding-slot-form {
  display: flex;
  flex-wrap: wrap;
  gap: .75rem;
  align-items: end;
}
.onboarding-slot-form__field {
  display: grid;
  gap: .3rem;
  min-width: min(16rem, 100%);
}
.onboarding-slot-form__field span {
  font-size: .78rem;
  font-weight: 750;
  color: var(--rt-text-muted, var(--ink-soft));
}
.onboarding-slot-form__field select,
.onboarding-slot-form__field input {
  min-height: 44px;
  padding: .45rem .6rem;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-2, var(--paper-inset));
  color: var(--rt-text, var(--ink));
  font: inherit;
}
.onboarding-slot-form__submit {
  display: inline-flex;
  align-items: center;
  gap: .45rem;
  min-height: 44px;
  padding: .55rem .95rem;
  border: 1px solid var(--rt-focus, var(--info));
  background: var(--rt-surface-2, var(--paper-inset));
  color: var(--rt-text-strong, var(--ink-bright));
  font-weight: 800;
  cursor: pointer;
}
.onboarding-slot-form__submit:disabled { opacity: .55; cursor: not-allowed; }

.onboarding-queue { list-style: none; margin: 0; padding: 0; display: grid; gap: .5rem; }
.onboarding-queue__row {
  display: flex;
  flex-wrap: wrap;
  gap: .6rem 1rem;
  align-items: center;
  justify-content: space-between;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-2, var(--paper-inset));
  padding: .65rem .8rem;
}
.onboarding-queue__row--closed { opacity: .75; }
.onboarding-queue__who { display: grid; gap: .1rem; }
.onboarding-queue__meta { color: var(--rt-text-muted, var(--ink-muted)); font-size: .78rem; }
.onboarding-queue__state {
  font-size: .8rem;
  font-weight: 800;
  letter-spacing: .04em;
}
.onboarding-queue__state[data-tone="pending"] { color: var(--rt-pending, #b8860b); }
.onboarding-queue__state[data-tone="success"] { color: var(--rt-success, #2e8b57); }
.onboarding-queue__state[data-tone="muted"] { color: var(--rt-text-muted, var(--ink-muted)); }
.onboarding-queue__actions { display: flex; gap: .45rem; }
.onboarding-queue__open {
  display: inline-flex;
  align-items: center;
  min-height: 40px;
  padding: .4rem .8rem;
  border: 1px solid var(--rt-focus, var(--info));
  color: var(--rt-text-strong, var(--ink-bright));
  font-weight: 750;
  text-decoration: none;
}
.onboarding-queue__open--review {
  border-color: var(--rt-pending, #ffbf52);
  font-weight: 800;
}
.onboarding-queue__minor {
  min-height: 40px;
  padding: .4rem .7rem;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: transparent;
  color: var(--rt-text, var(--ink));
  cursor: pointer;
}
.onboarding-queue__minor--danger { color: var(--rt-danger, #b03a44); border-color: currentColor; }
.onboarding-queue__minor:disabled { opacity: .55; cursor: not-allowed; }
.onboarding-roster { width: 100%; border-collapse: collapse; }
.onboarding-roster th,
.onboarding-roster td {
  border-top: 1px solid var(--rt-rule, var(--rule-soft));
  padding: .45rem .5rem;
  text-align: left;
  font-size: .88rem;
}
.onboarding-roster thead th {
  font-size: .72rem;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--rt-text-muted, var(--ink-muted));
  border-top: none;
}
.onboarding-roster__link { display: inline-block; margin-right: .5rem; font-weight: 700; color: var(--rt-text-strong, var(--ink-bright)); }
.onboarding-roster__conflict { color: var(--rt-pending, #8a6d1a); font-weight: 750; }
.onboarding-history summary {
  min-height: 44px;
  display: flex;
  align-items: center;
  cursor: pointer;
  font-weight: 750;
}
.onboarding-page :is(a, button, summary, select, input):focus-visible {
  outline: 3px solid var(--rt-focus, #59d8ff);
  outline-offset: 2px;
}
@media (max-width: 520px) {
  .onboarding-page { padding: .65rem; }
  .onboarding-queue__actions { width: 100%; }
}
</style>
