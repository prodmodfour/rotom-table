<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { CONTEST_STAT_IDS, type ContestStatId } from '#shared/contests/ids'
import type {
  BattleContestLiveplayAppealDecisionV1,
  BattleContestLiveplayPoolV1,
  BattleContestLiveplaySpendV1,
} from '#shared/contests/battleLiveplay'

const props = defineProps<{
  decision: BattleContestLiveplayAppealDecisionV1
  pool: BattleContestLiveplayPoolV1 | null
  busy: boolean
  error: string | null
  uncertain: boolean
}>()
const emit = defineEmits<{
  score: [spend: BattleContestLiveplaySpendV1]
  retry: []
}>()

const labels: Readonly<Record<ContestStatId, string>> = Object.freeze({
  beauty: 'Beauty', cool: 'Cool', cute: 'Cute', smart: 'Smart', tough: 'Tough',
})
const allocation = ref<Record<ContestStatId, number>>({ beauty: 0, cool: 0, cute: 0, smart: 0, tough: 0 })
const heading = ref<HTMLElement | null>(null)
const total = computed(() => CONTEST_STAT_IDS.reduce((sum, statId) => sum + allocation.value[statId], 0))
const remaining = (statId: ContestStatId): number => props.pool?.remaining[statId] ?? 0
const mayAdd = (statId: ContestStatId): boolean => (
  !props.busy && total.value < props.decision.maximumSpend && allocation.value[statId] < remaining(statId)
)
const mayRemove = (statId: ContestStatId): boolean => !props.busy && allocation.value[statId] > 0
const change = (statId: ContestStatId, delta: -1 | 1): void => {
  if (delta === 1 && !mayAdd(statId) || delta === -1 && !mayRemove(statId)) return
  allocation.value = { ...allocation.value, [statId]: allocation.value[statId] + delta }
}
const submit = (): void => emit('score', Object.freeze({ ...allocation.value }))
const submitZero = (): void => emit('score', Object.freeze({ beauty: 0, cool: 0, cute: 0, smart: 0, tough: 0 }))

watch(() => `${props.decision.contestantId}:${props.decision.moveName}:${props.decision.round}`, async () => {
  allocation.value = { beauty: 0, cool: 0, cute: 0, smart: 0, tough: 0 }
  await nextTick(); heading.value?.focus()
}, { immediate: true })
</script>

<template>
  <section
    class="battle-contest-decision rt-surface"
    data-rt-elevation="3"
    role="dialog"
    aria-modal="false"
    aria-labelledby="battle-contest-decision-title"
    :aria-busy="busy"
  >
    <div class="battle-contest-decision__signal" aria-hidden="true">◌</div>
    <div v-if="!decision.canResolve" class="battle-contest-decision__waiting">
      <p class="battle-contest-decision__eyebrow"><span aria-hidden="true">◷</span> Contest Appeal pending</p>
      <h2 id="battle-contest-decision-title" ref="heading" tabindex="-1">{{ decision.waitingForDisplayName }} is choosing Contest Dice</h2>
      <p>The accepted {{ decision.moveName }} Appeal will appear when Contest authority settles it.</p>
    </div>

    <template v-else>
      <header>
        <div>
          <p class="battle-contest-decision__eyebrow">{{ decision.pokemonDisplayName }} · Round {{ decision.round }}</p>
          <h2 id="battle-contest-decision-title" ref="heading" tabindex="-1">Score {{ decision.moveName }}’s Contest Appeal</h2>
          <p>Spend up to {{ decision.maximumSpend }} team dice.</p>
        </div>
        <span class="battle-contest-decision__pending"><span aria-hidden="true">◷</span> Pending</span>
      </header>

      <div class="battle-contest-decision__stats" role="group" aria-label="Contest Dice allocation">
        <div v-for="statId in CONTEST_STAT_IDS" :key="statId" class="battle-contest-decision__stat" :data-selected="allocation[statId] > 0 || undefined">
          <div>
            <strong>{{ labels[statId] }}</strong>
            <span class="rt-numeric">{{ remaining(statId) }} available</span>
          </div>
          <div class="battle-contest-decision__stepper">
            <button type="button" :disabled="!mayRemove(statId)" :aria-label="`Remove one ${labels[statId]} die`" @click="change(statId, -1)">−</button>
            <output class="rt-numeric" :aria-label="`${allocation[statId]} ${labels[statId]} dice selected`">{{ allocation[statId] }}</output>
            <button type="button" :disabled="!mayAdd(statId)" :aria-label="`Add one ${labels[statId]} die`" @click="change(statId, 1)">+</button>
          </div>
        </div>
      </div>

      <p class="battle-contest-decision__selection rt-numeric" aria-live="polite">
        {{ total }} team {{ total === 1 ? 'die' : 'dice' }} selected
      </p>
      <p v-if="error" class="battle-contest-decision__error" role="alert">{{ error }}</p>
      <div v-if="uncertain" class="battle-contest-decision__recovery" role="alert">
        <p>The allocation outcome is uncertain. Retry the exact same decision before continuing.</p>
        <button type="button" :disabled="busy" @click="emit('retry')">Retry exact allocation</button>
      </div>
      <footer v-else>
        <button type="button" class="battle-contest-decision__secondary" :disabled="busy" @click="submitZero">Use no team dice</button>
        <button type="button" class="battle-contest-decision__commit" :disabled="busy" @click="submit">
          <span aria-hidden="true">✦</span> {{ busy ? 'Scoring…' : 'Score Appeal' }}
        </button>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.battle-contest-decision {
  position: relative;
  width: min(44rem, calc(100% - 2rem));
  margin: clamp(1rem, 6vh, 4rem) auto;
  padding: clamp(1rem, 2.4vw, 1.5rem);
  border: 2px solid var(--rt-pending);
  border-radius: var(--rt-radius-medium);
  background: color-mix(in srgb, var(--rt-surface-1) 94%, var(--rt-pending) 6%);
  box-shadow: var(--rt-elevation-3);
  color: var(--rt-text);
}
.battle-contest-decision::before {
  content: '';
  position: absolute;
  inset: -2px auto auto 50%;
  width: 1.1rem;
  height: 1.1rem;
  translate: -50% -50%;
  rotate: 45deg;
  border: 2px solid var(--rt-pending);
  border-right: 0;
  border-bottom: 0;
  background: var(--rt-surface-1);
}
.battle-contest-decision__signal { position: absolute; inset: 0.9rem 1rem auto auto; color: var(--rt-pending); font-size: 1.5rem; }
.battle-contest-decision header { display: flex; justify-content: space-between; gap: 1rem; padding-right: 2rem; }
.battle-contest-decision h2 { margin: 0.15rem 0 0.35rem; color: var(--rt-text-strong); font-size: var(--rt-type-heading-md-size); line-height: var(--rt-type-heading-md-line); font-weight: 850; }
.battle-contest-decision h2:focus-visible { outline: 3px solid var(--rt-focus); outline-offset: 4px; }
.battle-contest-decision p { margin: 0; }
.battle-contest-decision__eyebrow { color: var(--rt-pending); font-size: var(--rt-type-label-sm-size); line-height: var(--rt-type-label-sm-line); font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; }
.battle-contest-decision__pending { align-self: center; white-space: nowrap; color: var(--rt-pending); font-weight: 800; }
.battle-contest-decision__stats { display: grid; gap: 0.45rem; margin-top: 1.25rem; }
.battle-contest-decision__stat { min-height: 3.2rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.35rem 0.45rem 0.35rem 0.8rem; border-left: 3px solid var(--rt-rule); background: var(--rt-surface-2); }
.battle-contest-decision__stat[data-selected='true'] { border-left-color: var(--rt-focus); background: color-mix(in srgb, var(--rt-surface-2) 92%, var(--rt-focus) 8%); }
.battle-contest-decision__stat > div:first-child { display: grid; gap: 0.1rem; }
.battle-contest-decision__stat span { color: var(--rt-text-muted); font-size: var(--rt-type-meta-xs-size); }
.battle-contest-decision__stepper { display: grid; grid-template-columns: 2.75rem 2.4rem 2.75rem; align-items: center; }
.battle-contest-decision__stepper button { min-width: 2.75rem; min-height: 2.75rem; border: 1px solid var(--rt-rule); background: var(--rt-surface-3); color: var(--rt-text-strong); font: inherit; font-size: 1.35rem; cursor: pointer; }
.battle-contest-decision__stepper button:focus-visible { outline: 3px solid var(--rt-focus); outline-offset: -3px; }
.battle-contest-decision__stepper button:disabled { opacity: 0.36; cursor: not-allowed; }
.battle-contest-decision__stepper output { text-align: center; font-size: 1.2rem; font-weight: 800; }
.battle-contest-decision__selection { margin: 0.8rem 0 !important; text-align: center; color: var(--rt-pending); font-weight: 800; }
.battle-contest-decision__error { margin: 0.6rem 0 !important; padding: 0.65rem; border-left: 3px solid var(--rt-danger); background: color-mix(in srgb, var(--rt-danger) 10%, var(--rt-surface-1)); }
.battle-contest-decision footer { display: grid; grid-template-columns: 1fr 1.25fr; gap: 0.7rem; padding-top: 0.85rem; border-top: 1px solid var(--rt-rule); }
.battle-contest-decision footer button,
.battle-contest-decision__recovery button { min-height: 3rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); color: var(--rt-text-strong); font: inherit; font-weight: 800; cursor: pointer; }
.battle-contest-decision__secondary { background: var(--rt-surface-3); }
.battle-contest-decision__commit { border-color: var(--rt-brand) !important; background: var(--rt-brand); color: var(--rt-on-brand) !important; }
.battle-contest-decision footer button:focus-visible,
.battle-contest-decision__recovery button:focus-visible { outline: 3px solid var(--rt-focus); outline-offset: 2px; }
.battle-contest-decision footer button:disabled { opacity: 0.55; cursor: wait; }
.battle-contest-decision__waiting { padding: clamp(1.1rem, 3vw, 2.4rem) 1rem; text-align: center; }
.battle-contest-decision__waiting h2 { margin: 0.45rem 0 0.75rem; }
.battle-contest-decision__waiting > p:last-child { max-width: 34rem; margin-inline: auto; color: var(--rt-text-muted); }
.battle-contest-decision__recovery { display: grid; gap: 0.65rem; margin-top: 0.75rem; padding: 0.8rem; border-left: 3px solid var(--rt-pending); background: var(--rt-pending-soft); }
.battle-contest-decision__recovery button { background: var(--rt-surface-3); }
@media (max-width: 42rem) {
  .battle-contest-decision { width: calc(100% - 1rem); margin: 0.5rem auto; padding: 0.85rem; }
  .battle-contest-decision header { display: block; }
  .battle-contest-decision__pending { display: inline-block; margin-top: 0.45rem; }
  .battle-contest-decision footer { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) { .battle-contest-decision * { scroll-behavior: auto !important; } }
</style>
