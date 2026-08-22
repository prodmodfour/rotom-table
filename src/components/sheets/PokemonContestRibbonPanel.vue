<script setup lang="ts">
import { PhMedal } from '@phosphor-icons/vue'
import { contestRibbonQualificationCount } from '#shared/contests/ribbons'
import { contestPath } from '#shared/contests/routes'
import type { CharacterSheet } from '~/types/characterSheet'
defineProps<{ sheet: CharacterSheet }>()
</script>
<template>
  <section v-if="sheet.contestRibbons?.length" class="panel-card contest-ribbons">
    <h2 class="panel-title"><PhMedal :size="20" weight="duotone" aria-hidden="true" /> Contest ribbons <span class="panel-subtle">{{ contestRibbonQualificationCount(sheet.contestRibbons) }} provenance-backed</span></h2>
    <ul><li v-for="ribbon in [...sheet.contestRibbons].sort((a,b)=>b.awardedAt-a.awardedAt)" :key="ribbon.ribbonId"><PhMedal :size="26" weight="fill" aria-hidden="true" /><span><strong>{{ ribbon.contestName }}</strong><small>{{ ribbon.hallName }} · {{ ribbon.contestTypeId ?? ribbon.variantId }} · {{ new Date(ribbon.awardedAt).toLocaleDateString() }}</small></span><NuxtLink :to="contestPath(ribbon.contestId)">Open result</NuxtLink></li></ul>
  </section>
</template>
<style scoped>
.panel-title{display:flex;align-items:center;gap:.45rem}.panel-title>svg{color:var(--rt-pending,var(--warn))}ul{display:grid;gap:.45rem;list-style:none;margin:0;padding:0}li{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:.6rem;border:1px solid var(--rt-rule,var(--rule-soft));padding:.65rem}li>svg{color:var(--rt-pending,var(--warn))}strong,small{display:block}small{color:var(--rt-text-muted,var(--ink-muted));font-size:.72rem}a{display:grid;place-items:center;min-height:44px;color:var(--rt-focus,var(--info));font-weight:800}a:focus-visible{outline:3px solid var(--rt-focus,#59d8ff);outline-offset:3px}@media(max-width:500px){li{grid-template-columns:auto 1fr}a{grid-column:1/-1}}
</style>
