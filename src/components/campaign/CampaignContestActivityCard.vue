<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { PhArrowRight, PhMedal, PhPulse } from '@phosphor-icons/vue'
import type { ContestRoleProjectionV1 } from '#shared/contests/projections'
import { CONTESTS_PATH, contestPath } from '#shared/contests/routes'

const props = defineProps<{ profileId?: string | null }>()
const contests = ref<ContestRoleProjectionV1[]>([])
const unavailable = ref(false)
let loadSequence = 0
const load = async (): Promise<void> => {
  const sequence = ++loadSequence, audience = props.profileId ?? null
  try { const response = await $fetch<{ ok: true, contests: ContestRoleProjectionV1[] }>('/api/contests/list', { query: audience ? { profileId: audience } : {} }); if (sequence === loadSequence && audience === (props.profileId ?? null)) { contests.value = response.contests; unavailable.value = false } }
  catch { if (sequence === loadSequence && audience === (props.profileId ?? null)) unavailable.value = true }
}
const stageLabel = (value: string) => value.replaceAll('-', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
onMounted(load)
watch(() => props.profileId, () => { contests.value = []; unavailable.value = false; void load() })
</script>

<template>
  <section class="contest-activity-card" aria-labelledby="campaign-contests-title">
    <header><PhMedal :size="25" weight="duotone" aria-hidden="true" /><div><p>Parallel liveplay</p><h2 id="campaign-contests-title">Pokémon Contests</h2></div></header>
    <p v-if="unavailable" class="card-note">Contest activity is temporarily unavailable.</p>
    <p v-else-if="!contests.length" class="card-note">No Contest activity is recorded yet.</p>
    <ul v-else>
      <li v-for="contest in contests.slice(0, 4)" :key="contest.contestId">
        <NuxtLink :to="contestPath(contest.contestId)">
          <PhPulse v-if="['introduction','performance','settling'].includes(contest.stage)" :size="17" aria-hidden="true" />
          <PhMedal v-else :size="17" aria-hidden="true" />
          <span><strong>{{ contest.display.name }}</strong><small>{{ contest.display.hallName }} · {{ stageLabel(contest.stage) }}<template v-if="contest.round"> · Round {{ contest.round }}</template></small></span>
          <b v-if="contest.stage === 'completed'">{{ contest.scoreboard.find(row => row.placement === 1)?.pokemonName }}<small v-if="contest.settlement?.entries.some(row => row.placement === 1 && row.ribbon)"> · Ribbon</small></b>
          <PhArrowRight :size="17" aria-hidden="true" />
        </NuxtLink>
      </li>
    </ul>
    <NuxtLink :to="CONTESTS_PATH" class="all-contests">Open Contest Workshop <PhArrowRight :size="17" aria-hidden="true" /></NuxtLink>
  </section>
</template>

<style scoped>
.contest-activity-card{display:grid;gap:.75rem;border:1px solid var(--rt-rule,var(--rule-soft));background:var(--rt-surface-1,var(--paper-soft));padding:1rem}.contest-activity-card header{display:flex;align-items:center;gap:.65rem}.contest-activity-card header>svg{color:var(--rt-pending,var(--warn))}.contest-activity-card header p,.contest-activity-card header h2{margin:0}.contest-activity-card header p{color:var(--rt-text-muted,var(--ink-muted));font-size:.7rem;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.contest-activity-card h2{margin-top:.15rem!important;color:var(--rt-text-strong,var(--ink-bright));font:700 1.45rem var(--font-book)}.card-note{margin:0;color:var(--rt-text-muted,var(--ink-muted))}.contest-activity-card ul{display:grid;gap:.4rem;list-style:none;padding:0;margin:0}.contest-activity-card li a{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:.55rem;min-height:54px;border:1px solid var(--rt-rule,var(--rule-soft));padding:.55rem;color:var(--rt-text,var(--ink));text-decoration:none}.contest-activity-card li a>svg:first-child{color:var(--rt-focus,var(--info))}.contest-activity-card strong,.contest-activity-card small{display:block}.contest-activity-card small{color:var(--rt-text-muted,var(--ink-muted));font-size:.7rem}.contest-activity-card li b{color:var(--rt-pending,var(--warn));font-size:.7rem}.all-contests{display:inline-flex;align-items:center;justify-content:center;gap:.45rem;min-height:44px;border:1px solid var(--rt-focus,var(--info));color:var(--rt-text-strong,var(--ink-bright));text-decoration:none;font-weight:800}.contest-activity-card a:focus-visible{outline:3px solid var(--rt-focus,#59d8ff);outline-offset:3px}@media(max-width:480px){.contest-activity-card li b{display:none}.contest-activity-card li a{grid-template-columns:auto minmax(0,1fr) auto}}
</style>
