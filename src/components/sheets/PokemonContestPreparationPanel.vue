<script setup lang="ts">
import { computed } from 'vue'
import { PhSparkle } from '@phosphor-icons/vue'
import { derivePokemonContestPreparation } from '#shared/contests/preparation'
import { CONTEST_STAT_IDS } from '#shared/contests/ids'
import type { CharacterSheet } from '~/types/characterSheet'

const props = defineProps<{ sheet: CharacterSheet }>()
const preparation = computed(() => derivePokemonContestPreparation(props.sheet))
</script>

<template>
  <section class="panel-card contest-preparation" aria-labelledby="contest-preparation-title">
    <h2 id="contest-preparation-title" class="panel-title">
      <PhSparkle :size="20" weight="duotone" aria-hidden="true" /> Pokémon Contest preparation
      <span class="panel-subtle">combat-stat dice · accepted Poffins · enrollment snapshot</span>
    </h2>
    <div class="contest-stat-grid">
      <article v-for="stat in CONTEST_STAT_IDS" :key="stat">
        <header><strong>{{ preparation.rows[stat].label }}</strong><b>{{ preparation.rows[stat].totalDice }}d6</b></header>
        <dl>
          <div><dt>{{ preparation.rows[stat].combatStatId.toUpperCase() }} {{ preparation.rows[stat].combatStatValue }}</dt><dd>{{ preparation.rows[stat].combatDice }}d6</dd></div>
          <div><dt>Poffins active</dt><dd>{{ preparation.rows[stat].poffinDiceActive }}d6</dd></div>
          <div v-if="preparation.rows[stat].featureDice"><dt>Style Expert</dt><dd>{{ preparation.rows[stat].featureDice }}d6</dd></div>
        </dl>
      </article>
    </div>
    <footer>
      <p><strong>{{ preparation.poffinsActive }} / {{ preparation.poffinAllowance }}</strong> accepted Poffins active at level {{ preparation.level }}<span v-if="preparation.poffinsSuppressed"> · {{ preparation.poffinsSuppressed }} stored die suppressed by the current allowance</span>.</p>
      <p>Grace, Style Expert, Groomer, and daily Flexible Preparations are resolved from the paired Trainer when a Contest snapshot is enrolled. Consume or craft Poffins through the Contest preparation workflow.</p>
      <p v-if="preparation.legacyDescription" class="legacy-note"><strong>Legacy note (non-mechanical):</strong> {{ preparation.legacyDescription }}</p>
    </footer>
  </section>
</template>

<style scoped>
.panel-title { display: flex; align-items: center; flex-wrap: wrap; gap: .45rem; }
.panel-title > svg { color: var(--rt-focus, var(--info)); }
.contest-stat-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: .6rem; }
.contest-stat-grid article { border: 1px solid var(--rt-rule, var(--rule-soft)); background: var(--rt-bg-canvas, var(--paper-inset)); padding: .7rem; }
.contest-stat-grid header { display: flex; align-items: baseline; justify-content: space-between; gap: .4rem; color: var(--rt-text-strong, var(--ink-bright)); }
.contest-stat-grid header b { color: var(--rt-pending, var(--warn)); font: 800 1rem var(--font-mono); }
dl { display: grid; gap: .3rem; margin: .7rem 0 0; }
dl div { display: flex; justify-content: space-between; gap: .4rem; border-top: 1px solid var(--rt-rule, var(--rule-soft)); padding-top: .3rem; }
dt { color: var(--rt-text-muted, var(--ink-muted)); font-size: .67rem; }
dd { margin: 0; font: 700 .72rem var(--font-mono); }
footer { margin-top: .8rem; color: var(--rt-text-muted, var(--ink-muted)); font-size: .76rem; line-height: 1.45; }
footer p { margin: .25rem 0; }
.legacy-note { border-left: 3px solid var(--rt-rule, var(--rule-soft)); padding-left: .6rem; }
@media (max-width: 850px) { .contest-stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 480px) { .contest-stat-grid { grid-template-columns: 1fr; } }
</style>
