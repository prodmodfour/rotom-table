<script setup lang="ts">
import { computed } from 'vue'
import type { CharacterSheet } from '~/types/characterSheet'
import {
  POKEMON_TRAINING_FEATURE_OPTIONS,
  resolvePokemonTrainingFeatureEffects,
} from '~/utils/sheets/pokemonTrainingFeatures'
import { pokemonEggMoveOptionsForSheet } from '~/utils/sheets/pokemonEggMoves'

const skillBgRaisedCsv = defineModel<string>('skillBgRaisedCsv', { required: true })
const skillBgLoweredCsv = defineModel<string>('skillBgLoweredCsv', { required: true })

const INHERITED_LEVELS = ['20', '30', '40', '50', '60', '70', '80', '90'] as const

const props = defineProps<{
  sheet: CharacterSheet
  tutorPointsEarned: number | null
  tutorPointsLeft: number | null
}>()

const activeTrainingFeatureEffects = computed(() =>
  resolvePokemonTrainingFeatureEffects(props.sheet.activeTrainingFeature),
)
const inheritedMoveOptions = computed(() => pokemonEggMoveOptionsForSheet(props.sheet))

const emit = defineEmits<{
  setInheritedMove: [level: string, value: string | undefined]
}>()
</script>

<template>
  <div class="training-grid">
    <section class="panel-card">
      <h2 class="panel-title">Tutor Points</h2>
      <dl class="kv-list">
        <div title="Automatically calculated from level: 1 Tutor Point at hatching, plus 1 at Level 5 and each later multiple of 5.">
          <dt>Earned</dt>
          <dd><span class="derived-value">{{ tutorPointsEarned ?? 0 }}</span></dd>
        </div>
        <div>
          <dt>Spent</dt>
          <dd><EditableCell v-model="sheet.tutorPoints!.spent" type="number" :min="0" /></dd>
        </div>
        <div>
          <dt>Left</dt>
          <dd :class="['derived-value', { 'derived-value--negative': (tutorPointsLeft ?? 0) < 0 }]">
            {{ tutorPointsLeft ?? 0 }}
          </dd>
        </div>
      </dl>
    </section>

    <section class="panel-card">
      <h2 class="panel-title">Active Training Feature</h2>
      <dl class="kv-list">
        <div>
          <dt>Feature</dt>
          <dd>
            <EditableCell
              v-model="sheet.activeTrainingFeature"
              type="select"
              :options="POKEMON_TRAINING_FEATURE_OPTIONS"
              placeholder="None"
            />
          </dd>
        </div>
        <div v-if="activeTrainingFeatureEffects">
          <dt>State</dt>
          <dd>{{ activeTrainingFeatureEffects.stateName }}</dd>
        </div>
      </dl>
      <p v-if="activeTrainingFeatureEffects" class="training-feature-effect">
        {{ activeTrainingFeatureEffects.reference?.effect
          ?? 'Active Training Feature bonus is applied to this sheet.' }}
      </p>
      <p v-else class="training-feature-effect training-feature-effect--muted">
        Choose the Training Feature currently affecting this Pokémon. This is separate from Training Exp.
      </p>
    </section>

    <section class="panel-card">
      <h2 class="panel-title">Skill Background</h2>
      <p class="bg-desc">
        <EditableCell
          v-model="sheet.skillBackground!.description"
          type="textarea"
          placeholder="Skill background description"
          multiline
        />
      </p>
      <dl class="kv-list">
        <div>
          <dt>Raised</dt>
          <dd><EditableCell v-model="skillBgRaisedCsv" placeholder="Athletics, Survival" /></dd>
        </div>
        <div>
          <dt>Lowered</dt>
          <dd><EditableCell v-model="skillBgLoweredCsv" placeholder="Combat" /></dd>
        </div>
      </dl>
    </section>

    <section class="panel-card">
      <h2 class="panel-title">Inherited Moves</h2>
      <dl class="inherited-grid">
        <div v-for="level in INHERITED_LEVELS" :key="level">
          <dt>Lvl {{ level }}</dt>
          <dd>
            <EditableCell
              :model-value="sheet.inheritedMoves?.[level]"
              type="select"
              :options="inheritedMoveOptions"
              placeholder="Egg move"
              @update:model-value="(v) => emit('setInheritedMove', level, v as string | undefined)"
            />
          </dd>
        </div>
      </dl>
      <p class="inherited-foot">
        Remaining: <strong><EditableCell v-model="sheet.inheritedRemaining" type="number" :min="0" /></strong>
      </p>
    </section>
  </div>
</template>

<style scoped>
.training-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.85rem;
}

.panel-title {
  margin: 0 0 0.6rem;
  font-family: var(--font-book);
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ink-bright);
  text-transform: uppercase;
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}

.kv-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0;
}

.kv-list > div {
  display: grid;
  grid-template-columns: minmax(120px, max-content) 1fr;
  gap: 0.6rem;
  align-items: baseline;
}

.kv-list dt {
  font-size: 0.74rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-muted);
}

.kv-list dd {
  margin: 0;
  color: var(--ink-bright);
}

.derived-value {
  font-weight: 700;
}

.derived-value--negative {
  color: var(--bad);
}

.inherited-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.4rem;
  margin: 0;
}

.inherited-grid > div {
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  padding: 0.35rem 0.55rem;
  background: var(--paper-inset);
}

.inherited-grid dt {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-muted);
}

.inherited-grid dd {
  margin: 0.15rem 0 0;
  color: var(--ink-bright);
  font-weight: 600;
}

.inherited-foot {
  margin: 0.5rem 0 0;
  color: var(--ink-soft);
  font-size: 0.85rem;
}

.bg-desc {
  margin: 0 0 0.55rem;
  color: var(--ink);
  font-family: var(--font-book);
  font-style: italic;
}

.training-feature-effect {
  margin: 0.55rem 0 0;
  color: var(--ink-soft);
  font-size: 0.84rem;
  line-height: 1.4;
}

.training-feature-effect--muted {
  color: var(--ink-muted);
  font-style: italic;
}
</style>
