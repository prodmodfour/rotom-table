<script setup lang="ts">
import { PhArrowClockwise, PhEgg, PhUsersThree } from '@phosphor-icons/vue'
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import type {
  BreedingWorkshopOwnershipContextV1,
  BreedingWorkshopProjectionV1,
} from '#shared/breeding/workshop'

const props = defineProps<{
  projection: BreedingWorkshopProjectionV1 | null
  ownershipContexts: readonly BreedingWorkshopOwnershipContextV1[]
  loading: boolean
  loadingMore: boolean
  error: string | null
  profileSwitchPath: RouteLocationRaw
}>()

const emit = defineEmits<{
  retry: []
  selectOwnership: [trainerSheetSlug: string]
  loadMore: []
  startProject: [trainerSheetSlug: string]
}>()

const handleOwnershipChange = (event: Event): void => {
  const target = event.target
  if (!(target instanceof HTMLSelectElement) || !target.value) return
  emit('selectOwnership', target.value)
}

const selected = computed(() => props.projection?.selectedOwnershipContext ?? null)
const hasMore = computed(() => props.projection?.nextOwnershipCursor !== null)
const activityLabel = computed(() => {
  if (!selected.value || selected.value.availability === 'unavailable') return ''
  if (selected.value.hasProjects && selected.value.hasEggs) return 'Projects and Eggs are available.'
  if (selected.value.hasProjects) return 'Breeding projects are available.'
  if (selected.value.hasEggs) return 'Eggs are available.'
  return 'No breeding activity yet.'
})
</script>

<template>
  <section
    class="breeding-workshop-shell"
    aria-labelledby="breeding-workshop-title"
    :aria-busy="loading || loadingMore"
  >
    <header class="breeding-workshop-shell__hero">
      <div>
        <p class="breeding-workshop-shell__eyebrow">Campaign Workshop</p>
        <h1 id="breeding-workshop-title">Breeding Workshop</h1>
        <p class="breeding-workshop-shell__lede">
          Plan breeding projects and follow Eggs without moving campaign authority into the browser.
        </p>
      </div>
      <p
        v-if="projection"
        class="breeding-workshop-shell__clock"
        aria-label="Current campaign minute"
      >
        Campaign minute <strong>{{ projection.generatedAtCampaignMinute }}</strong>
      </p>
    </header>

    <div v-if="loading && !projection" class="breeding-workshop-state" role="status" aria-live="polite">
      <PhEgg :size="28" weight="duotone" aria-hidden="true" />
      <div>
        <h2>Opening the Workshop</h2>
        <p>Loading current ownership and campaign context…</p>
      </div>
    </div>

    <div v-else-if="error" class="breeding-workshop-state breeding-workshop-state--error" role="alert">
      <div>
        <h2>The Workshop could not load</h2>
        <p>{{ error }}</p>
      </div>
      <button type="button" class="breeding-workshop-button" @click="emit('retry')">
        <PhArrowClockwise :size="18" weight="bold" aria-hidden="true" />
        Retry
      </button>
    </div>

    <template v-else-if="projection">
      <div
        v-if="projection.profileSelectionRequired"
        class="breeding-workshop-state"
        data-testid="breeding-profile-required"
      >
        <PhUsersThree :size="30" weight="duotone" aria-hidden="true" />
        <div>
          <h2>Choose a player profile</h2>
          <p>A selected profile establishes which Trainer ownership contexts this Workshop may show.</p>
          <NuxtLink class="breeding-workshop-button" :to="profileSwitchPath">Choose profile</NuxtLink>
        </div>
      </div>

      <div
        v-else-if="projection.emptyState === 'no-authorized-trainers'"
        class="breeding-workshop-state"
        data-testid="breeding-no-trainers"
      >
        <PhUsersThree :size="30" weight="duotone" aria-hidden="true" />
        <div>
          <h2>No Trainer contexts are available</h2>
          <p>Link a Trainer to the selected profile, or ask the GM to create a Trainer sheet.</p>
        </div>
      </div>

      <template v-else-if="selected">
        <section class="breeding-ownership" aria-labelledby="breeding-ownership-title">
          <div class="breeding-ownership__heading">
            <div>
              <p class="breeding-workshop-shell__eyebrow">Ownership context</p>
              <h2 id="breeding-ownership-title">{{ selected.displayName }}</h2>
            </div>
            <span class="breeding-ownership__audience">
              {{ projection.audience === 'gm' ? 'GM view' : 'Owner view' }}
            </span>
          </div>

          <label class="breeding-ownership__selector">
            <span>Trainer</span>
            <select
              :value="selected.trainerSheetSlug"
              :disabled="loading || ownershipContexts.length === 0"
              @change="handleOwnershipChange"
            >
              <option
                v-for="context in ownershipContexts"
                :key="context.trainerSheetSlug"
                :value="context.trainerSheetSlug"
              >
                {{ context.displayName }}{{ context.availability === 'unavailable' ? ' — unavailable' : '' }}
              </option>
            </select>
          </label>

          <button
            v-if="hasMore"
            type="button"
            class="breeding-workshop-button breeding-workshop-button--secondary"
            :disabled="loadingMore"
            @click="emit('loadMore')"
          >
            {{ loadingMore ? 'Loading Trainers…' : 'Load more Trainers' }}
          </button>

          <p v-if="selected.trainerRevision !== null" class="breeding-ownership__revision">
            Trainer revision <strong>{{ selected.trainerRevision }}</strong>
          </p>
        </section>

        <div
          v-if="selected.availability === 'unavailable'"
          class="breeding-workshop-state breeding-workshop-state--warning"
          role="alert"
          data-testid="breeding-context-unavailable"
        >
          <div>
            <h2>This Trainer context is unavailable</h2>
            <p>The linked Trainer no longer exists. Refresh the selected profile before planning a project.</p>
          </div>
        </div>

        <div v-else class="breeding-workshop-grid">
          <section class="breeding-workshop-panel" aria-labelledby="breeding-projects-title">
            <div class="breeding-workshop-panel__icon" aria-hidden="true">
              <PhUsersThree :size="24" weight="duotone" />
            </div>
            <div>
              <h2 id="breeding-projects-title">Breeding projects</h2>
              <p v-if="selected.hasProjects">Current project activity is available for this Trainer.</p>
              <p v-else>No breeding projects yet.</p>
              <button
                type="button"
                class="breeding-workshop-button breeding-workshop-button--panel"
                @click="emit('startProject', selected.trainerSheetSlug)"
              >
                Start a project
              </button>
            </div>
          </section>

          <section class="breeding-workshop-panel" aria-labelledby="breeding-eggs-title">
            <div class="breeding-workshop-panel__icon" aria-hidden="true">
              <PhEgg :size="24" weight="duotone" />
            </div>
            <div>
              <h2 id="breeding-eggs-title">Eggs</h2>
              <p v-if="selected.hasEggs">Current Egg activity is available for this Trainer.</p>
              <p v-else>No Eggs are in this Trainer’s Workshop.</p>
            </div>
          </section>
        </div>

        <p class="breeding-workshop-shell__status" role="status" aria-live="polite">
          {{ activityLabel }}
        </p>
      </template>
    </template>
  </section>
</template>

<style scoped>
.breeding-workshop-shell {
  display: grid;
  gap: 1rem;
  color: var(--rt-text);
}

.breeding-workshop-shell__hero,
.breeding-ownership,
.breeding-workshop-panel,
.breeding-workshop-state {
  border: 1px solid var(--rt-rule);
  background: var(--rt-surface-1);
  box-shadow: var(--rt-elevation-1);
}

.breeding-workshop-shell__hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.5rem;
  padding: clamp(1.25rem, 3vw, 2rem);
  border-radius: var(--rt-radius-large);
}

.breeding-workshop-shell__eyebrow {
  margin: 0 0 0.35rem;
  color: var(--rt-focus);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.breeding-workshop-shell h1,
.breeding-workshop-shell h2,
.breeding-workshop-shell p {
  margin-top: 0;
}

.breeding-workshop-shell h1 {
  margin-bottom: 0.6rem;
  color: var(--rt-text-strong);
  font-family: var(--rt-font-interface);
  font-size: clamp(2rem, 5vw, 3.25rem);
  line-height: 1;
}

.breeding-workshop-shell h2 {
  margin-bottom: 0.35rem;
  color: var(--rt-text-strong);
  font-size: 1.15rem;
}

.breeding-workshop-shell__lede,
.breeding-workshop-panel p,
.breeding-workshop-state p {
  max-width: 68ch;
  margin-bottom: 0;
  color: var(--rt-text-muted);
  line-height: 1.55;
}

.breeding-workshop-shell__clock {
  flex: 0 0 auto;
  margin-bottom: 0;
  color: var(--rt-text-muted);
  font-variant-numeric: tabular-nums;
}

.breeding-workshop-shell__clock strong,
.breeding-ownership__revision strong {
  color: var(--rt-text-strong);
}

.breeding-workshop-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 8rem;
  padding: 1.25rem;
  border-radius: var(--rt-radius-medium);
}

.breeding-workshop-state > svg {
  flex: 0 0 auto;
  color: var(--rt-focus);
}

.breeding-workshop-state--error {
  border-color: var(--rt-danger);
}

.breeding-workshop-state--warning {
  border-color: var(--rt-pending);
}

.breeding-ownership {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(14rem, 22rem) auto;
  align-items: end;
  gap: 0.8rem 1rem;
  padding: 1rem;
  border-radius: var(--rt-radius-medium);
}

.breeding-ownership__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.breeding-ownership__audience {
  display: inline-flex;
  align-items: center;
  min-height: 2rem;
  padding: 0.25rem 0.65rem;
  border: 1px solid var(--rt-rule);
  border-radius: var(--rt-radius-round);
  color: var(--rt-text-muted);
  font-size: 0.8rem;
  font-weight: 700;
}

.breeding-ownership__selector {
  display: grid;
  gap: 0.35rem;
  color: var(--rt-text-muted);
  font-size: 0.82rem;
  font-weight: 700;
}

.breeding-ownership__selector select {
  min-height: 44px;
  width: 100%;
  padding: 0.55rem 2.25rem 0.55rem 0.7rem;
  border: 1px solid var(--rt-rule);
  border-radius: var(--rt-radius-small);
  background: var(--rt-surface-2);
  color: var(--rt-text-strong);
  font: inherit;
}

.breeding-ownership__selector select:focus-visible,
.breeding-workshop-button:focus-visible {
  outline: 3px solid var(--rt-focus);
  outline-offset: 2px;
}

.breeding-ownership__revision {
  grid-column: 1 / -1;
  margin-bottom: 0;
  color: var(--rt-text-muted);
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
}

.breeding-workshop-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.breeding-workshop-panel {
  display: flex;
  align-items: flex-start;
  gap: 0.9rem;
  min-height: 9rem;
  padding: 1rem;
  border-radius: var(--rt-radius-medium);
}

.breeding-workshop-panel__icon {
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  flex: 0 0 auto;
  border-radius: var(--rt-radius-small);
  background: var(--rt-surface-2);
  color: var(--rt-focus);
}

.breeding-workshop-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 44px;
  padding: 0.55rem 0.9rem;
  border: 1px solid var(--rt-brand);
  border-radius: var(--rt-radius-small);
  background: var(--rt-brand);
  color: var(--rt-on-brand);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  text-decoration: none;
}

.breeding-workshop-button--secondary {
  border-color: var(--rt-rule);
  background: var(--rt-surface-2);
  color: var(--rt-text-strong);
}

.breeding-workshop-button--panel {
  margin-top: 0.8rem;
}

.breeding-workshop-button:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.breeding-workshop-shell__status {
  margin: 0;
  color: var(--rt-text-muted);
  font-size: 0.85rem;
}

@media (max-width: 760px) {
  .breeding-workshop-shell__hero,
  .breeding-workshop-state {
    align-items: flex-start;
    flex-direction: column;
  }

  .breeding-ownership,
  .breeding-workshop-grid {
    grid-template-columns: 1fr;
  }

  .breeding-ownership__heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .breeding-workshop-button,
  .breeding-ownership__selector {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .breeding-workshop-shell *,
  .breeding-workshop-shell *::before,
  .breeding-workshop-shell *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
