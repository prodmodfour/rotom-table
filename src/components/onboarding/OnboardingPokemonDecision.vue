<script setup lang="ts">
import { computed, ref } from 'vue'
import type { OnboardingCreationCatalog, OnboardingSpeciesRecord } from '#shared/onboarding/catalog'
import {
  ONBOARDING_STAT_KEYS,
  type OnboardingDraftV1,
  type OnboardingPokemonBuildV1,
  type OnboardingStatKey,
} from '#shared/onboarding/draft'
import type { CampaignOnboardingPolicyContentV1 } from '#shared/onboarding/policy'
import { computeOnboardingPokemonPreview } from '#shared/onboarding/preview'
import type { OnboardingValidationIssue } from '#shared/onboarding/validation'
import OnboardingIssueList from '~/components/onboarding/OnboardingIssueList.vue'

const props = defineProps<{
  decisionId: string
  draft: OnboardingDraftV1
  policy: CampaignOnboardingPolicyContentV1
  catalog: OnboardingCreationCatalog
  issues: readonly OnboardingValidationIssue[]
  editable: boolean
}>()

const emit = defineEmits<{ (event: 'patch-pokemon', index: number, patch: Partial<OnboardingPokemonBuildV1>): void }>()

const parsed = computed(() => {
  const match = /^pokemon\.(\d+)\.(.+)$/.exec(props.decisionId)
  return { index: match ? Number(match[1]) - 1 : 0, part: match ? match[2]! : 'species' }
})

const build = computed<OnboardingPokemonBuildV1>(() =>
  props.draft.pokemonBuilds[parsed.value.index]!)

const level = computed(() => props.policy.pokemon.starterLevel)

const species = computed<OnboardingSpeciesRecord | null>(() =>
  build.value.speciesId ? props.catalog.species.get(build.value.speciesId) ?? null : null)

/** Scoped patches merge against the live working draft in the page. */
const updateBuild = (patch: Partial<OnboardingPokemonBuildV1>): void => {
  if (!props.editable) return
  emit('patch-pokemon', parsed.value.index, patch)
}

/* ---------------- species ---------------- */
const speciesSearch = ref('')
const poolEntries = computed(() => {
  const pool = props.policy.pokemon.starterPool
  const query = speciesSearch.value.trim().toLocaleLowerCase()
  const candidates: OnboardingSpeciesRecord[] = []
  if (pool.mode === 'curated-list') {
    for (const id of pool.speciesIds) {
      const record = props.catalog.species.get(id)
      if (record) candidates.push(record)
    }
  } else {
    for (const record of props.catalog.species.values()) {
      if (!record.eligible) continue
      candidates.push(record)
    }
  }
  return candidates
    .filter((record) => {
      if (query && !record.speciesId.toLocaleLowerCase().includes(query)) return false
      if (props.policy.pokemon.stageRestriction === 'first-stage-only' && record.stage !== 1) return false
      return true
    })
    .slice(0, query ? 30 : pool.mode === 'curated-list' ? 100 : 24)
})

const unavailableReason = (record: OnboardingSpeciesRecord): string | null => {
  if (!record.eligible) return `incomplete canonical data (${record.ineligibleReasons.join(', ')})`
  return null
}

const chooseSpecies = (record: OnboardingSpeciesRecord): void => {
  if (unavailableReason(record)) return
  updateBuild({
    speciesId: record.speciesId,
    abilityIds: [],
    moveIds: defaultMovesFor(record),
    gender: record.genderless ? null : build.value.gender,
    addedStats: { hp: 0, atk: 0, def: 0, satk: 0, sdef: 0, spd: 0 },
  })
}

/** Starters take every level-up move at or below level, up to six; player edits when more available. */
const defaultMovesFor = (record: OnboardingSpeciesRecord): string[] => {
  const available = record.levelUpMoves.filter(move => move.level <= level.value).map(move => move.name)
  const distinct = [...new Set(available)]
  return distinct.length <= props.catalog.pokemon.activeMoveMaximum ? distinct : []
}

/* ---------------- identity ---------------- */
const natures = computed(() => [...props.catalog.natures.values()])
const natureSummary = (nature: { plus: string, minus: string }): string =>
  nature.plus === nature.minus ? 'neutral' : `+${nature.plus.toUpperCase()} / −${nature.minus.toUpperCase()}`

/* ---------------- ability ---------------- */
const abilityOptions = computed(() => {
  if (!species.value) return []
  const ordinals = props.catalog.pokemon.abilityOrdinalsForLevel(level.value)
  const permitted = new Set<string>()
  for (const ordinal of ordinals) {
    for (const tier of ordinal.tiers) {
      const list = tier === 'basic'
        ? species.value.basicAbilities
        : tier === 'advanced' ? species.value.advancedAbilities : species.value.highAbilities
      for (const ability of list) permitted.add(ability)
    }
  }
  return [...permitted]
})
const abilityCount = computed(() => props.catalog.pokemon.abilityOrdinalsForLevel(level.value).length)

const toggleAbility = (ability: string): void => {
  const current = build.value.abilityIds
  if (current.includes(ability)) {
    updateBuild({ abilityIds: current.filter(entry => entry !== ability) })
  } else if (current.length < abilityCount.value) {
    updateBuild({ abilityIds: [...current, ability] })
  } else if (abilityCount.value === 1) {
    updateBuild({ abilityIds: [ability] })
  }
}

/* ---------------- moves ---------------- */
const availableMoves = computed(() => {
  if (!species.value) return []
  const seen = new Set<string>()
  return species.value.levelUpMoves
    .filter(move => move.level <= level.value)
    .filter((move) => {
      if (seen.has(move.name)) return false
      seen.add(move.name)
      return true
    })
})
const requiredMoveCount = computed(() =>
  Math.min(availableMoves.value.length, props.catalog.pokemon.activeMoveMaximum))

const toggleMove = (move: string): void => {
  const current = build.value.moveIds
  if (current.includes(move)) {
    updateBuild({ moveIds: current.filter(entry => entry !== move) })
  } else if (current.length < props.catalog.pokemon.activeMoveMaximum) {
    updateBuild({ moveIds: [...current, move] })
  }
}

/* ---------------- stats ---------------- */
const statLabels: Record<OnboardingStatKey, string> = {
  hp: 'HP', atk: 'Attack', def: 'Defense', satk: 'Sp. Attack', sdef: 'Sp. Defense', spd: 'Speed',
}
const preview = computed(() =>
  computeOnboardingPokemonPreview(build.value, level.value, props.catalog))
const addedBudget = computed(() => props.catalog.pokemon.addedStatBudget(level.value))
const addedSpent = computed(() =>
  ONBOARDING_STAT_KEYS.reduce((sum, key) => sum + build.value.addedStats[key], 0))

const adjustAdded = (key: OnboardingStatKey, delta: number): void => {
  const current = build.value.addedStats[key]
  const next = current + delta
  if (next < 0) return
  if (delta > 0 && addedSpent.value >= addedBudget.value) return
  updateBuild({ addedStats: { ...build.value.addedStats, [key]: next } })
}

/* ---------------- ball ---------------- */
const ballOptions = computed(() =>
  [...props.catalog.items].filter(name => /ball/i.test(name)).sort())

const decisionTitle = computed(() => {
  const starter = `Starter ${parsed.value.index + 1}`
  return {
    'species': `${starter}: species`,
    'identity': `${starter}: nature & identity`,
    'ability': `${starter}: ability`,
    'moves': `${starter}: moves`,
    'stats': `${starter}: stat points`,
    'held-item': `${starter}: held item`,
    'caught-ball': `${starter}: Poké Ball`,
  }[parsed.value.part] ?? props.decisionId
})
</script>

<template>
  <article class="decision-card" :aria-labelledby="`decision-title-${decisionId}`">
    <header class="decision-card__header">
      <h2 :id="`decision-title-${decisionId}`">{{ decisionTitle }}</h2>
      <span class="decision-card__meta">STARTER · Level {{ level }}</span>
    </header>

    <!-- Species -->
    <template v-if="parsed.part === 'species'">
      <p class="decision-card__prompt">
        <template v-if="policy.pokemon.starterPool.mode === 'curated-list'">
          Choose from this campaign's starter pool.
        </template>
        <template v-else>
          Choose any species with complete canonical data.
        </template>
        <template v-if="policy.pokemon.stageRestriction === 'first-stage-only'">
          First-stage species only.
        </template>
      </p>
      <label class="decision-field decision-field--wide">
        <span class="sr-only">Search species</span>
        <input v-model="speciesSearch" type="search" placeholder="Search species…" :disabled="!editable">
      </label>
      <ul class="option-rows option-rows--species">
        <li v-for="record in poolEntries" :key="record.speciesId">
          <button
            type="button"
            class="option-row option-row--selectable"
            :data-selected="build.speciesId === record.speciesId ? '1' : undefined"
            :disabled="!editable || unavailableReason(record) !== null"
            @click="chooseSpecies(record)"
          >
            <span class="species-monogram" aria-hidden="true">{{ record.speciesId.charAt(0) }}</span>
            <span class="option-row__body">
              <strong>{{ record.speciesId }}</strong>
              <span class="option-row__note">
                {{ record.types.join(' / ') }}
                <template v-if="record.stage !== null"> · stage {{ record.stage }}</template>
              </span>
              <span v-if="unavailableReason(record)" class="option-row__note option-row__note--warn">
                {{ unavailableReason(record) }}
              </span>
            </span>
            <span class="option-row__mark" aria-hidden="true">{{ build.speciesId === record.speciesId ? '●' : '○' }}</span>
          </button>
        </li>
      </ul>
    </template>

    <!-- Nature & identity -->
    <template v-else-if="parsed.part === 'identity'">
      <p v-if="!species" class="decision-card__prompt">Choose a species first.</p>
      <template v-else>
        <p class="decision-card__prompt">
          Pick a nature{{ species.genderless ? '' : ' and gender' }}; nickname is optional.
        </p>
        <div class="decision-card__grid">
          <label class="decision-field">
            <span>Nickname</span>
            <input
              :value="build.nickname ?? ''"
              type="text"
              maxlength="80"
              :disabled="!editable"
              @input="updateBuild({ nickname: ($event.target as HTMLInputElement).value.trim() || null })"
            >
          </label>
          <label class="decision-field">
            <span>Nature *</span>
            <select
              :value="build.natureId ?? ''"
              :disabled="!editable"
              @change="updateBuild({ natureId: ($event.target as HTMLSelectElement).value || null })"
            >
              <option value="">Choose nature…</option>
              <option v-for="nature in natures" :key="nature.name" :value="nature.name">
                {{ nature.name }} ({{ natureSummary(nature) }})
              </option>
            </select>
          </label>
          <div v-if="!species.genderless" class="decision-field">
            <span>Gender *</span>
            <div class="gender-buttons">
              <button
                v-for="gender in (['Male', 'Female'] as const)"
                :key="gender"
                type="button"
                class="gender-button"
                :data-selected="build.gender === gender ? '1' : undefined"
                :disabled="!editable
                  || (gender === 'Male' && (species.malePct ?? 0) <= 0)
                  || (gender === 'Female' && species.malePct !== null && species.malePct >= 100)"
                @click="updateBuild({ gender })"
              >
                {{ gender }}
                <span v-if="species.malePct !== null" class="option-row__note">
                  {{ gender === 'Male' ? species.malePct : Math.round((100 - species.malePct) * 10) / 10 }}%
                </span>
              </button>
            </div>
          </div>
          <p v-else class="decision-card__prompt">{{ species.speciesId }} is genderless.</p>
        </div>
      </template>
    </template>

    <!-- Ability -->
    <template v-else-if="parsed.part === 'ability'">
      <p v-if="!species" class="decision-card__prompt">Choose a species first.</p>
      <template v-else>
        <p class="decision-card__prompt">
          Choose {{ abilityCount }} Basic Ability{{ abilityCount === 1 ? '' : ' choices' }} for {{ species.speciesId }}.
        </p>
        <ul class="option-rows">
          <li v-for="ability in abilityOptions" :key="ability">
            <button
              type="button"
              class="option-row option-row--selectable"
              :data-selected="build.abilityIds.includes(ability) ? '1' : undefined"
              :disabled="!editable"
              @click="toggleAbility(ability)"
            >
              <span class="option-row__body"><strong>{{ ability }}</strong></span>
              <span class="option-row__mark" aria-hidden="true">{{ build.abilityIds.includes(ability) ? '●' : '○' }}</span>
            </button>
          </li>
        </ul>
      </template>
    </template>

    <!-- Moves -->
    <template v-else-if="parsed.part === 'moves'">
      <p v-if="!species" class="decision-card__prompt">Choose a species first.</p>
      <template v-else>
        <p class="decision-card__prompt">
          {{ species.speciesId }} knows its level-up Moves through Level {{ level }}.
          <template v-if="availableMoves.length <= catalog.pokemon.activeMoveMaximum">
            All {{ availableMoves.length }} are taken automatically.
          </template>
          <template v-else>
            Choose {{ requiredMoveCount }} of {{ availableMoves.length }}.
          </template>
        </p>
        <ul class="option-rows">
          <li v-for="move in availableMoves" :key="move.name">
            <button
              type="button"
              class="option-row option-row--selectable"
              :data-selected="build.moveIds.includes(move.name) ? '1' : undefined"
              :disabled="!editable"
              @click="toggleMove(move.name)"
            >
              <span class="option-row__body">
                <strong>{{ move.name }}</strong>
                <span class="option-row__note">learned at Level {{ move.level }}</span>
              </span>
              <span class="option-row__mark" aria-hidden="true">{{ build.moveIds.includes(move.name) ? '●' : '○' }}</span>
            </button>
          </li>
        </ul>
      </template>
    </template>

    <!-- Stats -->
    <template v-else-if="parsed.part === 'stats'">
      <p v-if="!species" class="decision-card__prompt">Choose a species first.</p>
      <template v-else>
        <p class="decision-card__prompt">
          Distribute {{ addedBudget }} added points over {{ species.speciesId }}'s nature-adjusted base stats.
          Higher base stats must keep higher totals (Base Relations). {{ addedBudget - addedSpent }} left.
        </p>
        <ul class="stat-rows">
          <li v-for="stat in preview?.stats ?? []" :key="stat.key" class="stat-row">
            <span class="stat-row__label">{{ statLabels[stat.key] }}</span>
            <span class="stat-row__base">
              base {{ stat.speciesBase }}
              <template v-if="stat.natureDelta !== 0">
                {{ stat.natureDelta > 0 ? `+${stat.natureDelta}` : stat.natureDelta }} nature
              </template>
            </span>
            <div class="stat-row__controls">
              <button type="button" :disabled="!editable || build.addedStats[stat.key] === 0" :aria-label="`Remove point from ${statLabels[stat.key]}`" @click="adjustAdded(stat.key, -1)">−</button>
              <span class="stat-row__value">{{ build.addedStats[stat.key] }}</span>
              <button type="button" :disabled="!editable || addedSpent >= addedBudget" :aria-label="`Add point to ${statLabels[stat.key]}`" @click="adjustAdded(stat.key, 1)">+</button>
            </div>
            <span class="stat-row__total">= {{ stat.total }}</span>
          </li>
        </ul>
        <p v-if="preview" class="decision-card__prompt">
          Max HP becomes <strong>{{ preview.maxHp.value }}</strong>
          ({{ preview.maxHp.contributions.map(entry => entry.label).join(' + ') }}).
        </p>
      </template>
    </template>

    <!-- Held item -->
    <template v-else-if="parsed.part === 'held-item'">
      <p class="decision-card__prompt">This campaign offers a starter held item.</p>
      <ul class="option-rows">
        <li v-for="grant in policy.packages.starterHeldItems" :key="grant.itemId">
          <button
            type="button"
            class="option-row option-row--selectable"
            :data-selected="build.heldItemId === grant.itemId ? '1' : undefined"
            :disabled="!editable"
            @click="updateBuild({ heldItemId: build.heldItemId === grant.itemId ? null : grant.itemId })"
          >
            <span class="option-row__body"><strong>{{ grant.itemId }}</strong></span>
            <span class="option-row__mark" aria-hidden="true">{{ build.heldItemId === grant.itemId ? '●' : '○' }}</span>
          </button>
        </li>
      </ul>
    </template>

    <!-- Caught ball -->
    <template v-else-if="parsed.part === 'caught-ball'">
      <p class="decision-card__prompt">
        Choose the Poké Ball this starter was caught in.
        <template v-if="draft.deferredDecisions.includes(decisionId as never)">Currently deferred.</template>
      </p>
      <label class="decision-field">
        <span>Ball</span>
        <select
          :value="build.caughtBallId ?? ''"
          :disabled="!editable"
          @change="updateBuild({ caughtBallId: ($event.target as HTMLSelectElement).value || null })"
        >
          <option value="">Not chosen</option>
          <option v-for="ball in ballOptions" :key="ball" :value="ball">{{ ball }}</option>
        </select>
      </label>
    </template>

    <OnboardingIssueList :issues="issues" />
  </article>
</template>

<style scoped src="./onboardingDecision.css" />
<style scoped>
.option-rows--species { max-height: 30rem; overflow-y: auto; }
.species-monogram {
  flex: none;
  inline-size: 2.4rem;
  block-size: 2.4rem;
  display: grid;
  place-items: center;
  border-radius: 999px;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-1, var(--paper-soft));
  font-weight: 800;
}
.gender-buttons { display: flex; gap: .5rem; }
.gender-button {
  min-height: 44px;
  padding: .45rem .9rem;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-2, var(--paper-inset));
  color: var(--rt-text, var(--ink));
  font-weight: 750;
  cursor: pointer;
  display: inline-flex;
  gap: .45rem;
  align-items: center;
}
.gender-button[data-selected="1"] { border-color: var(--rt-focus, #59d8ff); }
.gender-button:disabled { opacity: .45; cursor: not-allowed; }
</style>
