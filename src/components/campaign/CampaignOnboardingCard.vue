<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { PhUserCirclePlus } from '@phosphor-icons/vue'
import { useOnboardingOverview } from '~/composables/useOnboarding'
import { ONBOARDING_PATH, onboardingBuilderPath } from '~/utils/onboardingRoutes'

/**
 * Role-appropriate onboarding presence on the Campaign dashboard (P9-073).
 * GM: aggregate queue state with direct review links; other players' private
 * choices never appear here. Player: own onboarding state only.
 */
const { isGm, gmOverview, playerHome, load } = useOnboardingOverview()

const gmSummary = computed(() => {
  const slots = (gmOverview.value?.slots ?? []).filter(slot => slot.status === 'open')
  return {
    total: slots.length,
    awaitingReview: slots.filter(slot => slot.draftState === 'submitted'),
    inProgress: slots.filter(slot => slot.draftState === 'draft' || slot.draftState === 'changes-requested').length,
  }
})

const playerState = computed(() => {
  if (!playerHome.value?.slot) return null
  if (playerHome.value.completion) return { kind: 'ready' as const }
  const state = playerHome.value.slot.draftState
  return {
    kind: 'active' as const,
    state,
    draftId: playerHome.value.draft?.draftId ?? null,
  }
})

onMounted(() => { void load() })
</script>

<template>
  <section
    v-if="(isGm && gmSummary.total > 0) || (!isGm && playerState)"
    class="campaign-onboarding"
    aria-labelledby="campaign-onboarding-title"
  >
    <div class="campaign-onboarding__heading">
      <PhUserCirclePlus :size="24" weight="duotone" aria-hidden="true" />
      <div>
        <p>Campaign onboarding</p>
        <h2 id="campaign-onboarding-title">
          <template v-if="isGm">New characters</template>
          <template v-else>Your character</template>
        </h2>
      </div>
    </div>

    <template v-if="isGm">
      <p class="campaign-onboarding__summary">
        {{ gmSummary.inProgress }} in progress ·
        {{ gmSummary.awaitingReview.length }} awaiting review
      </p>
      <ul v-if="gmSummary.awaitingReview.length > 0" class="campaign-onboarding__list">
        <li v-for="slot in gmSummary.awaitingReview" :key="slot.slotId">
          <NuxtLink :to="`/onboarding/review/${slot.draftId}`">
            Review {{ slot.profileDisplayName }} (submission #{{ slot.submissionRevision }})
          </NuxtLink>
        </li>
      </ul>
      <NuxtLink class="campaign-onboarding__action" :to="ONBOARDING_PATH">Open onboarding queue</NuxtLink>
    </template>

    <template v-else-if="playerState">
      <template v-if="playerState.kind === 'ready'">
        <p class="campaign-onboarding__summary">Your character package is complete and ready for play.</p>
        <NuxtLink class="campaign-onboarding__action" to="/trainers">Open your Trainer</NuxtLink>
      </template>
      <template v-else>
        <p class="campaign-onboarding__summary">
          <template v-if="playerState.state === 'submitted'">Submitted — waiting for GM review.</template>
          <template v-else-if="playerState.state === 'changes-requested'">The GM requested changes to your character.</template>
          <template v-else>Your character is still in progress.</template>
        </p>
        <NuxtLink
          v-if="playerState.draftId"
          class="campaign-onboarding__action"
          :to="onboardingBuilderPath(playerState.draftId)"
        >
          {{ playerState.state === 'changes-requested' ? 'Review requested changes' : 'Continue building' }}
        </NuxtLink>
      </template>
    </template>
  </section>
</template>

<style scoped>
.campaign-onboarding {
  display: grid;
  gap: .65rem;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  border-left: 4px solid var(--rt-focus, #59d8ff);
  background: var(--rt-surface-1, var(--paper-soft));
  padding: var(--rt-space-4, 1rem);
}
.campaign-onboarding__heading { display: flex; align-items: center; gap: .65rem; }
.campaign-onboarding__heading > svg { color: var(--rt-focus, var(--info)); }
.campaign-onboarding__heading p {
  margin: 0;
  color: var(--rt-text-muted, var(--ink-muted));
  font-size: .72rem;
  font-weight: 800;
  letter-spacing: .1em;
  text-transform: uppercase;
}
.campaign-onboarding__heading h2 {
  margin: .15rem 0 0;
  color: var(--rt-text-strong, var(--ink-bright));
  font: 700 1.35rem/1.05 var(--font-book);
}
.campaign-onboarding__summary { margin: 0; color: var(--rt-text-muted, var(--ink-soft)); }
.campaign-onboarding__list { list-style: none; margin: 0; padding: 0; display: grid; gap: .35rem; }
.campaign-onboarding__list a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: var(--rt-text-strong, var(--ink-bright));
  font-weight: 750;
}
.campaign-onboarding__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: .55rem 1rem;
  border: 1px solid var(--rt-focus, var(--info));
  background: var(--rt-surface-2, var(--paper-inset));
  color: var(--rt-text-strong, var(--ink-bright));
  font-weight: 800;
  text-decoration: none;
  width: fit-content;
}
.campaign-onboarding :is(a):focus-visible {
  outline: 3px solid var(--rt-focus, #59d8ff);
  outline-offset: 2px;
}
</style>
