<script setup lang="ts">
import { computed } from 'vue'
import { CONTEST_STAT_IDS, type ContestStatId } from '#shared/contests/ids'
import type { BattleContestLiveplayProjectionV1 } from '#shared/contests/battleLiveplay'
import { contestPath } from '#shared/contests/routes'

const props = defineProps<{ projection: BattleContestLiveplayProjectionV1 }>()
const labels: Readonly<Record<ContestStatId, string>> = Object.freeze({
  beauty: 'Beauty', cool: 'Cool', cute: 'Cute', smart: 'Smart', tough: 'Tough',
})
const shortLabels: Readonly<Record<ContestStatId, string>> = Object.freeze({
  beauty: 'Be', cool: 'Co', cute: 'Cu', smart: 'Sm', tough: 'To',
})
const latestAppeal = computed(() => props.projection.acceptedAppeals.at(-1) ?? null)
const poolFor = (contestantId: string) => props.projection.visibleTeamPools.find(pool => pool.contestantId === contestantId) ?? null
</script>

<template>
  <section class="battle-contest-panel" aria-labelledby="battle-contest-panel-title">
    <header>
      <div>
        <p>Joined encounter</p>
        <h2 id="battle-contest-panel-title">Battle Contest</h2>
      </div>
      <div class="battle-contest-panel__round">
        <strong>{{ projection.contestTypeId }}</strong>
        <span class="rt-numeric">Round {{ projection.round }}/{{ projection.roundBudget }}</span>
      </div>
    </header>

    <p v-if="projection.synchronizing" class="battle-contest-panel__sync" role="status">
      <span aria-hidden="true">◷</span> Synchronizing accepted Encounter results…
    </p>
    <p v-else-if="projection.pendingAppeal" class="battle-contest-panel__sync" role="status">
      <span aria-hidden="true">◷</span> Contest Appeal pending
    </p>
    <div v-else-if="projection.stage === 'settling'" class="battle-contest-panel__settling" role="status">
      <span><span aria-hidden="true">◆</span> Battle Contest ended · settlement pending</span>
      <NuxtLink :to="contestPath(projection.contestId)">Open Contest settlement</NuxtLink>
    </div>

    <ol class="battle-contest-panel__scores" aria-label="Battle Contest scores">
      <li v-for="(score, index) in projection.scores" :key="score.contestantId" :data-side="index === 0 ? 'north' : 'south'">
        <div class="battle-contest-panel__score-heading">
          <strong>{{ score.displayName }}</strong>
          <span><b class="rt-numeric">{{ score.appeal }}</b> Appeal</span>
        </div>
        <ul aria-label="Pokémon Voltage">
          <li v-for="performer in score.performers" :key="performer.displayName">
            <span class="battle-contest-panel__monogram" aria-hidden="true">{{ performer.displayName.slice(0, 2).toUpperCase() }}</span>
            <span>{{ performer.displayName }}</span>
            <span class="rt-numeric">Voltage {{ performer.voltage }}</span>
          </li>
        </ul>
        <div v-if="poolFor(score.contestantId)" class="battle-contest-panel__pool">
          <span>Team pool</span>
          <span v-for="statId in CONTEST_STAT_IDS" :key="statId" :title="labels[statId]" class="rt-numeric">
            {{ shortLabels[statId] }} {{ poolFor(score.contestantId)!.remaining[statId] }}
          </span>
        </div>
      </li>
    </ol>

    <section v-if="latestAppeal" class="battle-contest-panel__accepted" aria-labelledby="battle-contest-latest-title">
      <p>Latest accepted Appeal</p>
      <h3 id="battle-contest-latest-title">{{ latestAppeal.moveLabel }}</h3>
      <div>
        <span><b class="rt-numeric">+{{ latestAppeal.appealDelta }}</b> Appeal</span>
        <span><b class="rt-numeric">{{ latestAppeal.voltageAfter }}</b> Voltage</span>
        <span class="battle-contest-panel__accepted-state"><span aria-hidden="true">✓</span> Accepted</span>
      </div>
    </section>
  </section>
</template>

<style scoped>
.battle-contest-panel { border-bottom: 1px solid var(--rt-rule); background: var(--rt-surface-1); }
.battle-contest-panel > header { display: flex; align-items: end; justify-content: space-between; gap: .7rem; padding: .8rem; border-left: 3px solid var(--rt-focus); background: var(--rt-surface-2); }
.battle-contest-panel header p,
.battle-contest-panel__accepted > p { margin: 0; color: var(--rt-focus); font-size: var(--rt-type-meta-xs-size); font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
.battle-contest-panel h2 { margin: .1rem 0 0; color: var(--rt-text-strong); font-size: var(--rt-type-heading-md-size); }
.battle-contest-panel__round { display: grid; justify-items: end; color: var(--rt-text-muted); font-size: var(--rt-type-label-sm-size); text-transform: capitalize; }
.battle-contest-panel__round strong { color: var(--rt-focus); }
.battle-contest-panel__sync { margin: 0; padding: .55rem .8rem; border-left: 3px solid var(--rt-pending); color: var(--rt-pending); background: color-mix(in srgb, var(--rt-pending) 8%, var(--rt-surface-1)); font-size: var(--rt-type-label-sm-size); font-weight: 800; }
.battle-contest-panel__settling { display: flex; align-items: center; justify-content: space-between; gap: .5rem; padding: .55rem .8rem; border-left: 3px solid var(--rt-success); color: var(--rt-success); background: color-mix(in srgb, var(--rt-success) 7%, var(--rt-surface-1)); font-size: var(--rt-type-label-sm-size); font-weight: 800; }
.battle-contest-panel__settling a { min-height: var(--rt-target-min); display: inline-flex; align-items: center; color: var(--rt-text-strong); text-decoration: underline; text-underline-offset: .2em; }
.battle-contest-panel__scores { display: grid; gap: 1px; margin: 0; padding: 0; list-style: none; background: var(--rt-rule); }
.battle-contest-panel__scores > li { padding: .7rem .8rem; border-left: 3px solid var(--rt-side-accent, var(--rt-info)); background: var(--rt-surface-1); }
.battle-contest-panel__scores > li[data-side='north'] { --rt-side-accent: var(--rt-focus); }
.battle-contest-panel__scores > li[data-side='south'] { --rt-side-accent: var(--rt-brand); }
.battle-contest-panel__score-heading { display: flex; align-items: baseline; justify-content: space-between; gap: .5rem; color: var(--rt-text-muted); }
.battle-contest-panel__score-heading > strong { color: var(--rt-text-strong); font-size: 1.05rem; }
.battle-contest-panel__score-heading b { color: var(--rt-text-strong); font-size: 1.35rem; }
.battle-contest-panel__scores ul { display: grid; gap: .3rem; margin: .55rem 0 0; padding: 0; list-style: none; }
.battle-contest-panel__scores ul li { min-height: 2rem; display: grid; grid-template-columns: 1.75rem minmax(0, 1fr) auto; align-items: center; gap: .45rem; border-bottom: 1px solid color-mix(in srgb, var(--rt-rule) 70%, transparent); }
.battle-contest-panel__scores ul li > span:last-child { color: var(--rt-text-muted); font-size: var(--rt-type-label-sm-size); }
.battle-contest-panel__monogram { width: 1.65rem; height: 1.65rem; display: grid; place-items: center; border: 1px solid var(--rt-side-accent); border-radius: var(--rt-radius-round); color: var(--rt-side-accent); font-size: .65rem; font-weight: 850; }
.battle-contest-panel__pool { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem .55rem; margin-top: .55rem; padding-top: .45rem; border-top: 1px solid var(--rt-rule); color: var(--rt-text-muted); font-size: var(--rt-type-meta-xs-size); }
.battle-contest-panel__pool > span:first-child { margin-right: auto; color: var(--rt-side-accent); font-weight: 800; }
.battle-contest-panel__accepted { padding: .7rem .8rem; border-left: 3px solid var(--rt-success); background: color-mix(in srgb, var(--rt-success) 6%, var(--rt-surface-1)); }
.battle-contest-panel__accepted h3 { margin: .15rem 0 .35rem; color: var(--rt-text-strong); font-size: 1rem; }
.battle-contest-panel__accepted > div { display: flex; flex-wrap: wrap; gap: .35rem .8rem; color: var(--rt-text-muted); font-size: var(--rt-type-label-sm-size); }
.battle-contest-panel__accepted-state { margin-left: auto; color: var(--rt-success); font-weight: 800; }
</style>
