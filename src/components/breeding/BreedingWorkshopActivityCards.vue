<script setup lang="ts">
import {
  PhArrowClockwise,
  PhClockCounterClockwise,
  PhEgg,
  PhGift,
  PhHeartbeat,
  PhUsersThree,
  PhWarning,
} from '@phosphor-icons/vue'
import { computed, ref } from 'vue'
import {
  breedingWorkshopEggStatusLabel,
  breedingWorkshopHistoryLabel,
  breedingWorkshopProjectStatusLabel,
  type BreedingWorkshopActivityProjectionV1,
  type BreedingWorkshopEggCardV1,
} from '#shared/breeding/workshopActivity'

const props = defineProps<{
  projection: BreedingWorkshopActivityProjectionV1 | null
  loading: boolean
  error: string | null
}>()
const emit = defineEmits<{
  retry: []
  requestTransfer: [eggId: string, revision: number]
  requestHatch: [eggId: string, revision: number]
}>()
const transferNotice = ref<string | null>(null)
const hasActivity = computed(() => Boolean(
  props.projection && (props.projection.projects.length || props.projection.eggs.length),
))
const genderLabel = (value: BreedingWorkshopEggCardV1['genderId']): string => ({
  female: 'Female',
  male: 'Male',
  genderless: 'Genderless',
})[value]
const sourceLabel = (value: BreedingWorkshopEggCardV1['sourceKind']): string => ({
  breeding: 'Breeding Project',
  fossil: 'Fossil restoration',
  gm: 'Campaign authored',
  'feature-artificial': 'Artificial creation',
})[value]
const transferReason = (card: BreedingWorkshopEggCardV1): string => {
  if (card.transfer.reasonId === 'breeding.workshop-transfer.pending-recovery') {
    return 'Resolve or refresh the uncertain command before changing ownership.'
  }
  if (card.transfer.reasonId === 'breeding.workshop-transfer.status-unavailable') {
    return 'Transfer is available only before hatching on an incubating or ready Egg.'
  }
  return 'A private transfer offer is already open for this Egg.'
}
const requestTransfer = (card: BreedingWorkshopEggCardV1): void => {
  transferNotice.value = card.transfer.action === 'start'
    ? `Transfer setup opened for the ${card.speciesName} Egg. Ownership will not change until both owners give current consent.`
    : `Transfer review opened for the ${card.speciesName} Egg. Refresh after either owner changes the private consent.`
  emit('requestTransfer', card.eggId, card.revision)
}
const hatchActionLabel = (card: BreedingWorkshopEggCardV1): string => {
  if (card.status === 'ready') return 'Open hatch decision'
  if (card.status === 'awaiting-special-adjudication') return 'Review hatch decision'
  if (card.status === 'hatching') return 'Continue hatch'
  return 'View hatched child'
}
</script>

<template>
  <section
    class="breeding-activity"
    aria-labelledby="breeding-activity-title"
    :aria-busy="loading"
  >
    <header class="breeding-activity__header">
      <div>
        <p class="breeding-activity__eyebrow">Durable campaign activity</p>
        <h2 id="breeding-activity-title">Projects and Eggs</h2>
      </div>
      <span v-if="projection" class="breeding-activity__audience">
        {{ projection.audience === 'gm' ? 'GM card view' : 'Owner card view' }}
      </span>
    </header>

    <div v-if="loading && !projection" class="breeding-activity-state" role="status" aria-live="polite">
      <PhEgg :size="24" weight="duotone" aria-hidden="true" />
      <div>
        <h3>Loading current activity</h3>
        <p>Rebuilding Project, Egg, progress, history, and recovery authority…</p>
      </div>
    </div>

    <div v-else-if="error" class="breeding-activity-state breeding-activity-state--error" role="alert">
      <PhWarning :size="24" weight="duotone" aria-hidden="true" />
      <div>
        <h3>Current activity is unavailable</h3>
        <p>{{ error }}</p>
      </div>
      <button type="button" class="breeding-activity-button" @click="emit('retry')">
        <PhArrowClockwise :size="18" weight="bold" aria-hidden="true" />
        Retry activity
      </button>
    </div>

    <template v-else-if="projection">
      <p
        v-if="transferNotice"
        class="breeding-activity__notice"
        role="status"
        aria-live="polite"
      >
        {{ transferNotice }}
      </p>

      <div v-if="!hasActivity" class="breeding-activity-state" data-testid="breeding-activity-empty">
        <PhHeartbeat :size="24" weight="duotone" aria-hidden="true" />
        <div>
          <h3>No durable activity yet</h3>
          <p>Create a Project to begin. Eggs remain separate campaign aggregates until hatch.</p>
        </div>
      </div>

      <section v-if="projection.projects.length" class="breeding-activity-group" aria-labelledby="breeding-project-card-list-title">
        <div class="breeding-activity-group__heading">
          <PhUsersThree :size="22" weight="duotone" aria-hidden="true" />
          <h3 id="breeding-project-card-list-title">Breeding Projects</h3>
          <span>{{ projection.projects.length }}</span>
        </div>
        <p v-if="projection.projectsTruncated" class="breeding-activity__bounded-note">
          Showing the 50 most recently updated Projects.
        </p>
        <div class="breeding-card-grid">
          <article
            v-for="(card, index) in projection.projects"
            :key="card.projectId"
            class="breeding-card"
            :class="{ 'breeding-card--recovery': card.recovery.state === 'pending' }"
            :aria-labelledby="`breeding-project-card-${index}`"
          >
            <header class="breeding-card__header">
              <div>
                <p class="breeding-card__kind">Breeding Project</p>
                <h4 :id="`breeding-project-card-${index}`">
                  {{ card.parents.map(parent => parent.displayName).join(' × ') }}
                </h4>
              </div>
              <span class="breeding-card__status" :data-status="card.progress.stage">
                {{ breedingWorkshopProjectStatusLabel(card.status) }}
              </span>
            </header>

            <p class="breeding-card__meta">
              Breeder: <strong>{{ card.breederDisplayName }}</strong>
              <span aria-hidden="true">·</span>
              Revision {{ card.revision }}
            </p>

            <div class="breeding-card__progress">
              <div>
                <span>{{ card.progress.accumulatedCampaignMinutes }} / {{ card.progress.targetCampaignMinutes }} campaign minutes</span>
                <strong>{{ card.progress.percent }}%</strong>
              </div>
              <progress
                :value="card.progress.accumulatedCampaignMinutes"
                :max="card.progress.targetCampaignMinutes"
                :aria-label="`Project progress: ${card.progress.accumulatedCampaignMinutes} of ${card.progress.targetCampaignMinutes} campaign minutes`"
              />
            </div>

            <ul class="breeding-card__parents" aria-label="Project parents">
              <li v-for="parent in card.parents" :key="parent.parentIndex">
                <span>{{ parent.displayName }}</span>
                <small>
                  {{ parent.relationship === 'owned' ? 'Owned parent' : 'Participating parent' }}
                  · {{ parent.consentStatus.replace('-', ' ') }}
                </small>
              </li>
            </ul>

            <aside v-if="card.recovery.state === 'pending'" class="breeding-card__recovery" role="status">
              <PhWarning :size="20" weight="duotone" aria-hidden="true" />
              <div>
                <strong>Recovery check required</strong>
                <p>An accepted result is not yet certain. Refresh server state before another action.</p>
                <button type="button" class="breeding-activity-button breeding-activity-button--secondary" @click="emit('retry')">
                  Refresh Project status
                </button>
              </div>
            </aside>

            <details class="breeding-card__history">
              <summary>
                <PhClockCounterClockwise :size="18" aria-hidden="true" />
                History ({{ card.history.length }})
              </summary>
              <ol>
                <li v-for="entry in card.history" :key="`${entry.campaignMinute}-${entry.kind}`">
                  <span>{{ breedingWorkshopHistoryLabel(entry.kind) }}</span>
                  <time>Campaign minute {{ entry.campaignMinute }}</time>
                </li>
              </ol>
            </details>
          </article>
        </div>
      </section>

      <section v-if="projection.eggs.length" class="breeding-activity-group" aria-labelledby="breeding-egg-card-list-title">
        <div class="breeding-activity-group__heading">
          <PhEgg :size="22" weight="duotone" aria-hidden="true" />
          <h3 id="breeding-egg-card-list-title">Eggs</h3>
          <span>{{ projection.eggs.length }}</span>
        </div>
        <p v-if="projection.eggsTruncated" class="breeding-activity__bounded-note">
          Showing the 50 most recently updated Eggs.
        </p>
        <div class="breeding-card-grid">
          <article
            v-for="(card, index) in projection.eggs"
            :key="card.eggId"
            class="breeding-card breeding-card--egg"
            :class="{ 'breeding-card--recovery': card.recovery.state === 'pending' }"
            :aria-labelledby="`breeding-egg-card-${index}`"
          >
            <header class="breeding-card__header">
              <div>
                <p class="breeding-card__kind">{{ sourceLabel(card.sourceKind) }}</p>
                <h4 :id="`breeding-egg-card-${index}`">{{ card.speciesName }} Egg</h4>
              </div>
              <span class="breeding-card__status" :data-status="card.progress.stage">
                {{ breedingWorkshopEggStatusLabel(card.status) }}
              </span>
            </header>

            <p class="breeding-card__meta">Revision {{ card.revision }}</p>
            <div class="breeding-card__progress">
              <div>
                <span>{{ card.progress.accumulatedCampaignMinutes }} / {{ card.progress.targetCampaignMinutes }} campaign minutes</span>
                <strong>{{ card.progress.percent }}%</strong>
              </div>
              <progress
                :value="card.progress.accumulatedCampaignMinutes"
                :max="Math.max(1, card.progress.targetCampaignMinutes)"
                :aria-label="`Egg incubation: ${card.progress.accumulatedCampaignMinutes} of ${card.progress.targetCampaignMinutes} campaign minutes${card.progress.paused ? ', paused' : ''}`"
              />
              <small v-if="card.progress.paused" class="breeding-card__paused">Incubation is paused.</small>
            </div>

            <dl class="breeding-card__traits">
              <div><dt>Nature</dt><dd>{{ card.natureName }}</dd></div>
              <div><dt>Ability</dt><dd>{{ card.abilityName }}</dd></div>
              <div><dt>Gender</dt><dd>{{ genderLabel(card.genderId) }}</dd></div>
              <div><dt>Starting Level</dt><dd>{{ card.startingLevel }}</dd></div>
            </dl>

            <aside v-if="card.recovery.state === 'pending'" class="breeding-card__recovery" role="status">
              <PhWarning :size="20" weight="duotone" aria-hidden="true" />
              <div>
                <strong>Recovery check required</strong>
                <p>Refresh authoritative state before transfer, hatch, or another lifecycle action.</p>
                <button type="button" class="breeding-activity-button breeding-activity-button--secondary" @click="emit('retry')">
                  Refresh Egg status
                </button>
              </div>
            </aside>

            <div
              v-if="['ready', 'awaiting-special-adjudication', 'hatching', 'hatched'].includes(card.status)"
              class="breeding-card__hatch"
            >
              <p v-if="card.status === 'ready'">The Egg is ready for an explicit, server-authorized hatch decision.</p>
              <p v-else-if="card.status === 'awaiting-special-adjudication'">A role-projected special hatch decision is pending.</p>
              <p v-else-if="card.status === 'hatching'">The accepted hatch can continue to final child reveal.</p>
              <p v-else>The accepted child reveal is available from durable hatch state.</p>
              <button
                type="button"
                class="breeding-activity-button"
                :disabled="card.recovery.state === 'pending'"
                @click="emit('requestHatch', card.eggId, card.revision)"
              >
                <PhEgg :size="18" weight="fill" aria-hidden="true" />
                {{ hatchActionLabel(card) }}
              </button>
            </div>

            <details class="breeding-card__transfer" :class="{ 'breeding-card__transfer--unavailable': card.transfer.action === 'none' }">
              <summary>
                <PhGift :size="18" aria-hidden="true" />
                {{ card.transfer.action === 'start' ? 'Transfer Egg' : card.transfer.action === 'review' ? 'Review transfer' : 'Transfer unavailable' }}
              </summary>
              <div>
                <template v-if="card.transfer.action === 'start'">
                  <p>A private transfer requires a current source gift and recipient acceptance. Opening setup never changes ownership.</p>
                  <button type="button" class="breeding-activity-button" @click="requestTransfer(card)">
                    Open transfer setup
                  </button>
                </template>
                <template v-else-if="card.transfer.action === 'review'">
                  <p>
                    {{ card.transfer.state === 'accepted' ? 'Both participant approvals are recorded.' : card.transfer.state === 'expired' ? 'This transfer offer has expired.' : 'Waiting for recipient approval.' }}
                    <span v-if="card.transfer.expiresAtCampaignMinute !== null">
                      Campaign expiry: {{ card.transfer.expiresAtCampaignMinute }}.
                    </span>
                  </p>
                  <button type="button" class="breeding-activity-button breeding-activity-button--secondary" @click="requestTransfer(card)">
                    Review current transfer
                  </button>
                </template>
                <p v-else>{{ transferReason(card) }}</p>
              </div>
            </details>

            <details class="breeding-card__history">
              <summary>
                <PhClockCounterClockwise :size="18" aria-hidden="true" />
                History ({{ card.history.length }})
              </summary>
              <ol>
                <li v-for="entry in card.history" :key="`${entry.campaignMinute}-${entry.kind}`">
                  <span>{{ breedingWorkshopHistoryLabel(entry.kind) }}</span>
                  <time>Campaign minute {{ entry.campaignMinute }}</time>
                </li>
              </ol>
            </details>
          </article>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.breeding-activity {
  display: grid;
  gap: 1rem;
}
.breeding-activity__header,
.breeding-activity-state,
.breeding-card {
  border: 1px solid var(--rt-rule);
  background: var(--rt-surface-1);
  box-shadow: var(--rt-elevation-1);
}
.breeding-activity__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem;
  border-radius: var(--rt-radius-medium);
}
.breeding-activity__eyebrow,
.breeding-card__kind {
  margin: 0 0 0.25rem;
  color: var(--rt-focus);
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.breeding-activity h2,
.breeding-activity h3,
.breeding-activity h4,
.breeding-activity p { margin-top: 0; }
.breeding-activity__header h2,
.breeding-activity-group__heading h3,
.breeding-card h4 { margin-bottom: 0; color: var(--rt-text-strong); }
.breeding-activity__audience,
.breeding-card__status,
.breeding-activity-group__heading > span {
  display: inline-flex;
  align-items: center;
  min-height: 2rem;
  padding: 0.25rem 0.65rem;
  border: 1px solid var(--rt-rule);
  border-radius: var(--rt-radius-round);
  color: var(--rt-text-muted);
  font-size: 0.8rem;
  font-weight: 750;
}
.breeding-activity-state {
  display: flex;
  align-items: center;
  gap: 1rem;
  min-height: 7rem;
  padding: 1rem;
  border-radius: var(--rt-radius-medium);
}
.breeding-activity-state > svg { flex: 0 0 auto; color: var(--rt-focus); }
.breeding-activity-state p { margin-bottom: 0; color: var(--rt-text-muted); }
.breeding-activity-state--error { border-color: var(--rt-danger); }
.breeding-activity-state--error > svg { color: var(--rt-danger); }
.breeding-activity__notice,
.breeding-activity__bounded-note {
  margin-bottom: 0;
  padding: 0.75rem 1rem;
  border-left: 4px solid var(--rt-info);
  background: var(--rt-surface-1);
  color: var(--rt-text);
}
.breeding-activity-group { display: grid; gap: 0.75rem; }
.breeding-activity-group__heading {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  color: var(--rt-focus);
}
.breeding-activity-group__heading > span { margin-left: auto; }
.breeding-card-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}
.breeding-card {
  position: relative;
  display: grid;
  align-content: start;
  gap: 0.9rem;
  min-width: 0;
  padding: 1rem;
  border-radius: var(--rt-radius-medium);
  overflow: hidden;
}
.breeding-card::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: var(--rt-focus);
}
.breeding-card--egg::before { background: var(--rt-success); }
.breeding-card--recovery { border-color: var(--rt-pending); }
.breeding-card--recovery::before { background: var(--rt-pending); }
.breeding-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}
.breeding-card__header h4 { font-size: 1.05rem; line-height: 1.35; overflow-wrap: anywhere; }
.breeding-card__status[data-status='completed'],
.breeding-card__status[data-status='ready'],
.breeding-card__status[data-status='production-ready'] { border-color: var(--rt-success); color: var(--rt-success); }
.breeding-card__status[data-status='check'],
.breeding-card__status[data-status='decision-required'] { border-color: var(--rt-pending); color: var(--rt-pending); }
.breeding-card__meta {
  margin-bottom: 0;
  color: var(--rt-text-muted);
  font-size: 0.86rem;
}
.breeding-card__meta strong { color: var(--rt-text-strong); }
.breeding-card__progress { display: grid; gap: 0.35rem; }
.breeding-card__progress > div { display: flex; justify-content: space-between; gap: 1rem; font-size: 0.85rem; }
.breeding-card__progress strong,
.breeding-card__progress span,
.breeding-card__progress progress { font-variant-numeric: tabular-nums; }
.breeding-card__progress progress { width: 100%; height: 0.75rem; accent-color: var(--rt-success); }
.breeding-card__paused { color: var(--rt-pending); font-weight: 700; }
.breeding-card__parents {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.breeding-card__parents li {
  display: grid;
  gap: 0.2rem;
  padding: 0.65rem;
  border: 1px solid var(--rt-rule);
  border-radius: var(--rt-radius-small);
  background: var(--rt-surface-2);
}
.breeding-card__parents span { color: var(--rt-text-strong); font-weight: 700; }
.breeding-card__parents small { color: var(--rt-text-muted); text-transform: capitalize; }
.breeding-card__traits { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem 1rem; margin: 0; }
.breeding-card__traits div { display: grid; gap: 0.15rem; }
.breeding-card__traits dt { color: var(--rt-text-muted); font-size: 0.76rem; font-weight: 700; }
.breeding-card__traits dd { margin: 0; color: var(--rt-text-strong); }
.breeding-card__recovery {
  display: flex;
  gap: 0.65rem;
  padding: 0.75rem;
  border: 1px solid var(--rt-pending);
  border-radius: var(--rt-radius-small);
  background: var(--rt-surface-2);
}
.breeding-card__recovery > svg { flex: 0 0 auto; color: var(--rt-pending); }
.breeding-card__recovery p { margin: 0.25rem 0 0.65rem; color: var(--rt-text-muted); }
.breeding-card__history,
.breeding-card__transfer,
.breeding-card__hatch { border-top: 1px solid var(--rt-rule); padding-top: 0.7rem; }
.breeding-card__hatch p { margin-bottom: 0.65rem; color: var(--rt-text-muted); line-height: 1.5; }
.breeding-card__history summary,
.breeding-card__transfer summary {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 44px;
  color: var(--rt-text-strong);
  cursor: pointer;
  font-weight: 750;
  touch-action: manipulation;
}
.breeding-card__history summary:focus-visible,
.breeding-card__transfer summary:focus-visible,
.breeding-activity-button:focus-visible { outline: 3px solid var(--rt-focus); outline-offset: 2px; }
.breeding-card__history ol { display: grid; gap: 0.5rem; margin: 0.5rem 0 0; padding-left: 1.2rem; }
.breeding-card__history li { padding-left: 0.2rem; }
.breeding-card__history li span,
.breeding-card__history li time { display: block; }
.breeding-card__history time { margin-top: 0.1rem; color: var(--rt-text-muted); font-size: 0.78rem; font-variant-numeric: tabular-nums; }
.breeding-card__transfer > div { padding: 0.4rem 0 0.2rem; }
.breeding-card__transfer p { margin-bottom: 0.65rem; color: var(--rt-text-muted); line-height: 1.5; }
.breeding-card__transfer--unavailable summary { color: var(--rt-text-muted); }
.breeding-activity-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 44px;
  padding: 0.55rem 0.85rem;
  border: 1px solid var(--rt-brand);
  border-radius: var(--rt-radius-small);
  background: var(--rt-brand);
  color: var(--rt-on-brand);
  cursor: pointer;
  font: inherit;
  font-weight: 750;
  touch-action: manipulation;
}
.breeding-activity-button--secondary { border-color: var(--rt-rule); background: var(--rt-surface-3); color: var(--rt-text-strong); }
@media (max-width: 800px) {
  .breeding-card-grid { grid-template-columns: 1fr; }
}
@media (max-width: 520px) {
  .breeding-activity__header,
  .breeding-card__header,
  .breeding-activity-state { align-items: stretch; flex-direction: column; }
  .breeding-card__parents,
  .breeding-card__traits { grid-template-columns: 1fr; }
  .breeding-activity-button { width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .breeding-card,
  .breeding-activity-button { transition: none; animation: none; }
}
</style>
