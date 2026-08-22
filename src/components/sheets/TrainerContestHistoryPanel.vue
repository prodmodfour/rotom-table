<script setup lang="ts">
import { PhMedal } from '@phosphor-icons/vue'
import { contestPath } from '#shared/contests/routes'
import type { TrainerSheet } from '~/types/trainerSheet'
defineProps<{ sheet: TrainerSheet }>()
</script>
<template>
  <section v-if="sheet.contestResults?.length" class="panel-card contest-history">
    <h2 class="panel-title"><PhMedal :size="20" weight="duotone" aria-hidden="true" /> Contest history <span class="panel-subtle">ordinary campaign record</span></h2>
    <ul><li v-for="result in [...sheet.contestResults].sort((a,b)=>b.completedAt-a.completedAt)" :key="result.resultId"><b>#{{ result.placement }}</b><span><strong>{{ result.contestName }}</strong><small>{{ result.hallName }} · {{ result.contestTypeId ?? result.variantId }} · score {{ result.score }} · {{ new Date(result.completedAt).toLocaleDateString() }}</small></span><em v-if="result.ribbonAwarded === true">Ribbon</em><em v-else-if="result.ribbonAwarded === undefined" title="Early result predates explicit Ribbon settlement evidence">Ribbon status unavailable</em><NuxtLink :to="contestPath(result.contestId)">Result</NuxtLink></li></ul>
  </section>
</template>
<style scoped>
.panel-title{display:flex;align-items:center;gap:.45rem}.panel-title>svg,li>em{color:var(--rt-pending,var(--warn))}ul{display:grid;gap:.45rem;list-style:none;margin:0;padding:0}li{display:grid;grid-template-columns:3rem minmax(0,1fr) auto auto;align-items:center;gap:.6rem;border:1px solid var(--rt-rule,var(--rule-soft));padding:.65rem}li>b{font:800 1.25rem var(--font-mono)}strong,small{display:block}small{color:var(--rt-text-muted,var(--ink-muted));font-size:.72rem}em{font-style:normal;font-weight:850}a{display:grid;place-items:center;min-height:44px;color:var(--rt-focus,var(--info));font-weight:800}a:focus-visible{outline:3px solid var(--rt-focus,#59d8ff);outline-offset:3px}@media(max-width:520px){li{grid-template-columns:3rem 1fr}li em{grid-column:1}li a{grid-column:2}}
</style>
