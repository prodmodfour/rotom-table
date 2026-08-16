<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { PhArrowRight, PhCalendarBlank } from '@phosphor-icons/vue'
import AppNavigation from '~/components/AppNavigation.vue'
import CampaignContinuationDashboard from '~/components/campaign/CampaignContinuationDashboard.vue'
import CampaignDayPreflightDialog from '~/components/campaign/CampaignDayPreflightDialog.vue'
import { useCampaignContinuationDashboard } from '~/composables/campaign/useCampaignContinuationDashboard'
import { useCampaignDayPreflight } from '~/composables/campaign/useCampaignDayPreflight'

const { isGm, isPlayer } = useAuth()
const profiles = usePlayerProfiles()
const dashboard = useCampaignContinuationDashboard()
const nextDayOrigin = ref<HTMLButtonElement | null>(null)
const campaignDay = useCampaignDayPreflight({
  onAccepted: () => dashboard.load({ silent: true }),
})

const showNextDayPreflight = async (): Promise<void> => {
  if (!isGm.value) return
  await campaignDay.show()
}
const closeNextDayPreflight = async (): Promise<void> => {
  campaignDay.close()
  await nextTick()
  nextDayOrigin.value?.focus()
}

onMounted(async () => {
  if (isPlayer.value) {
    profiles.loadRememberedProfile()
    try {
      await profiles.reloadProfiles({ silent: true, clearMissingSelection: true })
    }
    catch {
      // The dashboard still loads a safe empty owner projection when no current Profile is available.
    }
  }
  await dashboard.load()
})

useHead({ title: 'Campaign · Rotom Table' })
</script>

<template>
  <main class="campaign-page rt-context-workshop">
    <AppNavigation />

    <CampaignContinuationDashboard
      :projection="dashboard.projection.value"
      :status="dashboard.status.value"
      :error="dashboard.error.value"
      :has-selected-profile="profiles.hasSelectedProfile.value"
      @refresh="dashboard.refresh"
    >
      <template #campaign-tools>
        <section v-if="isGm" class="next-day-tool" aria-labelledby="next-day-title">
          <div class="next-day-tool__heading">
            <PhCalendarBlank :size="24" weight="duotone" aria-hidden="true" />
            <div>
              <p>GM campaign tool</p>
              <h2 id="next-day-title">Next day</h2>
            </div>
          </div>
          <p class="next-day-tool__summary">
            Review open work, then advance shared recovery and Egg time through the authoritative campaign clock.
          </p>
          <details class="next-day-tool__details">
            <summary>What changes</summary>
            <ul>
              <li>Starts a new Injury-healing allowance and removes 1 Injury from each eligible sheet.</li>
              <li>Restores eligible HP, clears conditions, Daily Move usage, and Trainer AP.</li>
              <li>Advances timed effects and due Eggs; paused Egg time remains skipped.</li>
            </ul>
          </details>
          <button
            ref="nextDayOrigin"
            type="button"
            class="next-day-tool__action"
            :disabled="campaignDay.busy.value"
            @click="showNextDayPreflight"
          >
            {{ campaignDay.busy.value ? 'Reviewing…' : 'Review next day' }}
            <PhArrowRight v-if="!campaignDay.busy.value" :size="18" weight="bold" aria-hidden="true" />
          </button>
        </section>
      </template>
    </CampaignContinuationDashboard>

    <CampaignDayPreflightDialog
      v-if="isGm"
      :open="campaignDay.open.value"
      :phase="campaignDay.phase.value"
      :projection="campaignDay.projection.value"
      :postflight="campaignDay.postflight.value"
      :confirmed="campaignDay.confirmed.value"
      :error="campaignDay.error.value"
      :uncertain="campaignDay.uncertain.value"
      :online="campaignDay.online.value"
      :can-commit="campaignDay.canCommit.value"
      :remaining-attention="dashboard.projection.value?.attention.summary ?? null"
      @close="closeNextDayPreflight"
      @recheck="campaignDay.check"
      @commit="campaignDay.commit"
      @update:confirmed="campaignDay.confirmed.value = $event"
    />

    <CampaignGuidedItemAdjudication v-if="isGm" />
  </main>
</template>

<style scoped>
.campaign-page {
  min-height: 100vh;
  display: grid;
  align-content: start;
  gap: var(--rt-space-6, 1.5rem);
  padding: clamp(.75rem, 2vw, 1.5rem);
  background: var(--rt-bg-canvas, var(--paper));
  color: var(--rt-text, var(--ink));
}
.next-day-tool {
  display: grid;
  gap: var(--rt-space-3, .75rem);
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-1, var(--paper-soft));
  padding: var(--rt-space-4, 1rem);
}
.next-day-tool__heading { display: flex; align-items: center; gap: .65rem; }
.next-day-tool__heading > svg { color: var(--rt-focus, var(--info)); }
.next-day-tool__heading p,
.next-day-tool__heading h2,
.next-day-tool__summary { margin: 0; }
.next-day-tool__heading p {
  color: var(--rt-text-muted, var(--ink-muted));
  font-size: .72rem;
  font-weight: 800;
  letter-spacing: .1em;
  text-transform: uppercase;
}
.next-day-tool__heading h2 {
  margin-top: .15rem;
  color: var(--rt-text-strong, var(--ink-bright));
  font: 700 1.55rem/1.05 var(--font-book);
}
.next-day-tool__summary,
.next-day-tool__details {
  color: var(--rt-text-muted, var(--ink-soft));
  line-height: 1.45;
}
.next-day-tool__details summary {
  min-height: 44px;
  display: flex;
  align-items: center;
  cursor: pointer;
  color: var(--rt-text, var(--ink));
  font-weight: 750;
}
.next-day-tool__details ul { margin: 0; padding: 0 0 0 1.2rem; }
.next-day-tool__details li + li { margin-top: .35rem; }
.next-day-tool__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: .55rem;
  min-height: 46px;
  width: 100%;
  border: 1px solid var(--rt-focus, var(--info));
  background: var(--rt-surface-2, var(--paper-inset));
  color: var(--rt-text-strong, var(--ink-bright));
  cursor: pointer;
  font-weight: 800;
  padding: .7rem 1rem;
}
.next-day-tool__action:disabled { cursor: progress; opacity: .62; }
.next-day-tool button:focus-visible,
.next-day-tool summary:focus-visible {
  outline: 3px solid var(--rt-focus, #59d8ff);
  outline-offset: 3px;
}
@media (max-width: 520px) {
  .campaign-page { padding: .65rem; }
}
</style>
