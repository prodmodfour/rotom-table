<script setup lang="ts">
import { ref } from 'vue'
import AppNavigation from '~/components/AppNavigation.vue'
import { CAMPAIGN_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { getErrorMessage } from '~/utils/errorMessages'
import type { CampaignNextDayResult } from '#shared/campaign'

const { isGm } = useAuth()
const { postJson } = useApiClient()

const advancingDay = ref(false)
const nextDayError = ref<string | null>(null)
const nextDayResult = ref<CampaignNextDayResult | null>(null)

const formatCount = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : plural}`

const advanceCampaignDay = async () => {
  if (!isGm.value || advancingDay.value) return
  const confirmed = window.confirm(
    'Advance the campaign to the next day? This starts a new Injury-healing allowance, removes 1 Injury from every Pokémon and Trainer sheet, restores HP for sheets below 5 Injuries, clears conditions, resets Daily move use, and restores Trainer AP.',
  )
  if (!confirmed) return

  advancingDay.value = true
  nextDayError.value = null
  try {
    nextDayResult.value = await postJson<CampaignNextDayResult>(CAMPAIGN_API_PATHS.nextDay, {
      clientId: getClientId(),
    })
  } catch (error) {
    nextDayError.value = getErrorMessage(error)
  } finally {
    advancingDay.value = false
  }
}

useHead({ title: 'Campaign · Rotom Table' })
</script>

<template>
  <main class="campaign-page">
    <AppNavigation />

    <section class="panel-card campaign-hero">
      <div>
        <p class="campaign-eyebrow">Campaign tools</p>
        <h1>Campaign day</h1>
        <p>
          Advance shared campaign recovery in one step. The next day action applies to every saved Pokémon and Trainer sheet.
        </p>
      </div>
      <button
        type="button"
        class="next-day-button"
        :disabled="!isGm || advancingDay"
        @click="advanceCampaignDay"
      >
        {{ advancingDay ? 'Advancing…' : 'Next day' }}
      </button>
    </section>

    <section class="panel-card next-day-card">
      <h2>Next day effects</h2>
      <ul>
        <li>Start a new Injury-healing allowance and remove 1 Injury from each sheet.</li>
        <li>Restore HP to the injury-adjusted Max HP when the sheet is below 5 Injuries.</li>
        <li>Clear sheet conditions and reset Daily move usage.</li>
        <li>Restore Trainer AP while preserving bound AP.</li>
      </ul>
      <p v-if="!isGm" class="campaign-note campaign-note--warning">
        GM login is required to advance the campaign day.
      </p>
      <p v-if="nextDayError" class="campaign-note campaign-note--error" role="alert">
        {{ nextDayError }}
      </p>
      <div v-if="nextDayResult" class="next-day-result" role="status">
        <strong>Next day complete.</strong>
        <span>{{ formatCount(nextDayResult.updatedSheets, 'sheet') }} updated out of {{ nextDayResult.totalSheets }}.</span>
        <span>{{ formatCount(nextDayResult.hitPointsRestored, 'HP', 'HP') }} restored.</span>
        <span>{{ formatCount(nextDayResult.injuriesHealed, 'Injury', 'Injuries') }} healed.</span>
        <span>{{ formatCount(nextDayResult.dailyMoveUsesCleared, 'Daily move use') }} cleared.</span>
        <span>{{ formatCount(nextDayResult.conditionsCleared, 'condition') }} cleared.</span>
        <span>{{ formatCount(nextDayResult.trainerApRestored, 'Trainer AP', 'Trainer AP') }} restored.</span>
      </div>
    </section>
  </main>
</template>

<style scoped>
.campaign-page {
  min-height: 100vh;
  display: grid;
  align-content: start;
  gap: 1rem;
  padding: 1rem;
  background: var(--paper);
  color: var(--ink);
}

.campaign-hero {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.campaign-eyebrow {
  margin: 0 0 0.2rem;
  color: var(--accent);
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

.campaign-hero h1,
.next-day-card h2 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  letter-spacing: 0.04em;
}

.campaign-hero h1 {
  font-size: clamp(1.7rem, 4vw, 2.45rem);
}

.campaign-hero p,
.next-day-card li,
.campaign-note,
.next-day-result {
  color: var(--ink-soft);
  line-height: 1.5;
}

.campaign-hero p {
  max-width: 62ch;
  margin: 0.35rem 0 0;
}

.next-day-button {
  flex: 0 0 auto;
  border: 1px solid color-mix(in srgb, var(--accent) 65%, var(--rule-soft));
  border-radius: 999px;
  background: rgba(var(--accent-rgb), 0.18);
  color: var(--ink-bright);
  cursor: pointer;
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  padding: 0.78rem 1.2rem;
  text-transform: uppercase;
  transition: background 0.12s, border-color 0.12s, transform 0.12s;
}

.next-day-button:hover:not(:disabled),
.next-day-button:focus-visible:not(:disabled) {
  border-color: var(--accent);
  background: rgba(var(--accent-rgb), 0.26);
  transform: translateY(-1px);
}

.next-day-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.next-day-card {
  display: grid;
  gap: 0.65rem;
}

.next-day-card ul {
  margin: 0;
  padding-left: 1.2rem;
}

.campaign-note {
  margin: 0;
}

.campaign-note--warning {
  color: #f2b67b;
}

.campaign-note--error {
  color: #ffb3b3;
}

.next-day-result {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem 0.8rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper-inset);
  padding: 0.65rem 0.75rem;
}

.next-day-result strong {
  color: var(--ink-bright);
}

@media (max-width: 760px) {
  .campaign-hero {
    align-items: stretch;
    flex-direction: column;
  }

  .next-day-button {
    width: 100%;
  }
}
</style>
