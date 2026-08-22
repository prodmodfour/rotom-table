<script setup lang="ts">
import { computed } from 'vue'
import type { OnboardingCreationCatalog } from '#shared/onboarding/catalog'
import type { OnboardingDraftV1 } from '#shared/onboarding/draft'
import type { CampaignOnboardingPolicyContentV1 } from '#shared/onboarding/policy'
import {
  computeOnboardingPokemonPreview,
  computeOnboardingTrainerPreview,
} from '#shared/onboarding/preview'

const props = defineProps<{
  draft: OnboardingDraftV1
  policy: CampaignOnboardingPolicyContentV1
  catalog: OnboardingCreationCatalog
}>()

const trainerPreview = computed(() =>
  computeOnboardingTrainerPreview(props.draft.trainerBuild, props.policy.trainer.startingLevel, props.catalog))

const statLabels: Record<string, string> = {
  hp: 'HP stat', atk: 'ATK', def: 'DEF', satk: 'SP.ATK', sdef: 'SP.DEF', spd: 'SPD',
}

const budgets = computed(() => {
  const preview = trainerPreview.value
  const rows = [
    { label: 'Stat points', ...preview.statPoints },
    { label: 'Edges', ...preview.edgeSlots },
    { label: 'Features', ...preview.featureSlots },
  ]
  if (preview.bonusSkillEdgeSlots.budget > 0) {
    rows.splice(2, 0, { label: 'Skill bonus', ...preview.bonusSkillEdgeSlots })
  }
  if (preview.milestonePoints.budget > 0) {
    rows.push({ label: 'Milestone pts', ...preview.milestonePoints })
  }
  return rows
})

const meterTone = (row: { budget: number, spent: number }): string => {
  if (row.budget === 0) return 'neutral'
  if (row.spent === row.budget) return 'full'
  if (row.spent > row.budget) return 'over'
  return 'partial'
}

const starters = computed(() => props.draft.pokemonBuilds.map((build) => {
  const preview = computeOnboardingPokemonPreview(build, props.policy.pokemon.starterLevel, props.catalog)
  return {
    buildId: build.buildId,
    monogram: build.speciesId ? build.speciesId.charAt(0).toUpperCase() : '?',
    title: build.nickname
      ? `${build.nickname} · ${build.speciesId ?? '?'}`
      : (build.speciesId ?? 'Species not chosen'),
    level: props.policy.pokemon.starterLevel,
    maxHp: preview?.maxHp.value ?? null,
    spent: preview?.addedPoints.spent ?? 0,
    budget: preview?.addedPoints.budget ?? props.catalog.pokemon.addedStatBudget(props.policy.pokemon.starterLevel),
  }
}))
</script>

<template>
  <aside class="preview-rail" aria-label="Derived preview">
    <section class="preview-rail__card">
      <h2 class="preview-rail__title">
        {{ draft.trainerBuild.name ?? 'New Trainer' }} · Trainer Lv {{ policy.trainer.startingLevel }}
      </h2>
      <div class="preview-rail__vitals">
        <div>
          <span class="preview-rail__vital-label">Max HP</span>
          <span class="preview-rail__vital-value">{{ trainerPreview.maxHp.value }}</span>
        </div>
        <div>
          <span class="preview-rail__vital-label">AP</span>
          <span class="preview-rail__vital-value">{{ trainerPreview.apMax.value }}</span>
        </div>
      </div>
      <dl class="preview-rail__stats">
        <div v-for="stat in trainerPreview.stats" :key="stat.key">
          <dt>{{ statLabels[stat.key] }}</dt>
          <dd>{{ stat.total }}</dd>
        </div>
      </dl>
      <div class="preview-rail__budgets">
        <div v-for="row in budgets" :key="row.label" class="preview-rail__budget">
          <span class="preview-rail__budget-label">{{ row.label }}</span>
          <span class="preview-rail__budget-value">{{ row.spent }}/{{ row.budget }}</span>
          <span class="preview-rail__meter" :data-tone="meterTone(row)">
            <span
              class="preview-rail__meter-fill"
              :style="{ inlineSize: `${row.budget === 0 ? 0 : Math.min(100, (row.spent / row.budget) * 100)}%` }"
            />
          </span>
        </div>
      </div>
    </section>

    <section
      v-for="starter in starters"
      :key="starter.buildId"
      class="preview-rail__card preview-rail__card--starter"
    >
      <span class="preview-rail__monogram" aria-hidden="true">{{ starter.monogram }}</span>
      <div class="preview-rail__starter-text">
        <strong>{{ starter.title }}</strong>
        <span class="preview-rail__starter-meta">
          Lv {{ starter.level }} ·
          {{ starter.maxHp === null ? 'HP —' : `HP ${starter.maxHp}` }} ·
          {{ starter.spent }}/{{ starter.budget }} pts
        </span>
      </div>
    </section>
  </aside>
</template>

<style scoped>
.preview-rail { display: grid; gap: .75rem; align-content: start; }
.preview-rail__card {
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-1, var(--paper-soft));
  padding: .85rem;
  display: grid;
  gap: .7rem;
}
.preview-rail__title {
  margin: 0;
  font: 700 1rem/1.2 var(--font-book);
  color: var(--rt-text-strong, var(--ink-bright));
}
.preview-rail__vitals {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: .5rem;
}
.preview-rail__vitals > div { display: grid; justify-items: start; }
.preview-rail__vital-label {
  font-size: .7rem;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--rt-text-muted, var(--ink-muted));
}
.preview-rail__vital-value {
  font-size: 1.8rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--rt-text-strong, var(--ink-bright));
}
.preview-rail__stats {
  margin: 0;
  display: grid;
  gap: .2rem;
}
.preview-rail__stats > div {
  display: flex;
  justify-content: space-between;
  border-top: 1px solid var(--rt-rule, var(--rule-soft));
  padding-top: .25rem;
}
.preview-rail__stats dt { color: var(--rt-text-muted, var(--ink-soft)); font-size: .82rem; }
.preview-rail__stats dd {
  margin: 0;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
}
.preview-rail__budgets { display: grid; gap: .45rem; }
.preview-rail__budget {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: .15rem .5rem;
  align-items: center;
}
.preview-rail__budget-label { font-size: .8rem; color: var(--rt-text-muted, var(--ink-soft)); }
.preview-rail__budget-value { font-size: .8rem; font-weight: 750; font-variant-numeric: tabular-nums; }
.preview-rail__meter {
  grid-column: 1 / -1;
  display: block;
  block-size: 6px;
  background: var(--rt-surface-3, var(--paper-inset));
  overflow: hidden;
}
.preview-rail__meter-fill {
  display: block;
  block-size: 100%;
  background: var(--rt-text-muted, #9ca8b5);
}
.preview-rail__meter[data-tone="full"] .preview-rail__meter-fill { background: var(--rt-success, #58d5a0); }
.preview-rail__meter[data-tone="partial"] .preview-rail__meter-fill { background: var(--rt-pending, #ffbf52); }
.preview-rail__meter[data-tone="over"] .preview-rail__meter-fill { background: var(--rt-danger, #ff6672); }
.preview-rail__card--starter {
  grid-template-columns: auto 1fr;
  align-items: center;
}
.preview-rail__monogram {
  inline-size: 2.6rem;
  block-size: 2.6rem;
  display: grid;
  place-items: center;
  border-radius: 999px;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-2, var(--paper-inset));
  font-weight: 800;
  font-size: 1.1rem;
}
.preview-rail__starter-text { display: grid; gap: .1rem; min-width: 0; }
.preview-rail__starter-meta { color: var(--rt-text-muted, var(--ink-muted)); font-size: .78rem; }
</style>
