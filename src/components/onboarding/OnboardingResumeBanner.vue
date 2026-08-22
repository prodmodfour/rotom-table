<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useOnboardingOverview } from '~/composables/useOnboarding'
import { onboardingBuilderPath } from '~/utils/onboardingRoutes'

/**
 * Routes a player with an open onboarding slot into the guided builder from
 * ordinary player surfaces (P9-077/P9-098). Renders nothing for GMs, players
 * without slots, or completed packages.
 */
const { isGm, playerHome, load } = useOnboardingOverview()

const banner = computed(() => {
  if (isGm.value) return null
  const home = playerHome.value
  if (!home?.slot || home.completion || !home.draft) return null
  const state = home.slot.draftState
  return {
    draftId: home.draft.draftId,
    label: state === 'changes-requested'
      ? 'The GM requested changes to your character.'
      : state === 'submitted'
        ? 'Your character is submitted and waiting for GM review.'
        : 'Your character is waiting to be finished.',
    action: state === 'changes-requested' ? 'Review changes' : state === 'submitted' ? 'View submission' : 'Continue building',
  }
})

onMounted(() => { void load() })
</script>

<template>
  <aside v-if="banner" class="onboarding-resume" role="status">
    <p>{{ banner.label }}</p>
    <NuxtLink class="onboarding-resume__action" :to="onboardingBuilderPath(banner.draftId)">
      {{ banner.action }}
    </NuxtLink>
  </aside>
</template>

<style scoped>
.onboarding-resume {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: .6rem;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  border-left: 4px solid var(--rt-focus, #59d8ff);
  background: var(--rt-surface-1, var(--paper-soft));
  padding: .7rem 1rem;
  margin-block-end: 1rem;
}
.onboarding-resume p { margin: 0; font-weight: 700; }
.onboarding-resume__action {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: .5rem .95rem;
  border: 1px solid var(--rt-focus, var(--info));
  color: var(--rt-text-strong, var(--ink-bright));
  font-weight: 800;
  text-decoration: none;
}
.onboarding-resume__action:focus-visible {
  outline: 3px solid var(--rt-focus, #59d8ff);
  outline-offset: 2px;
}
</style>
