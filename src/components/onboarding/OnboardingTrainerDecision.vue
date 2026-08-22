<script setup lang="ts">
import { computed, ref } from 'vue'
import type { OnboardingCreationCatalog } from '#shared/onboarding/catalog'
import {
  ONBOARDING_STAT_KEYS,
  ONBOARDING_TRAINER_SKILLS,
  type OnboardingDraftV1,
  type OnboardingEdgeEntryV1,
  type OnboardingFeatureEntryV1,
  type OnboardingStatKey,
  type OnboardingTrainerSkill,
} from '#shared/onboarding/draft'
import type { CampaignOnboardingPolicyContentV1 } from '#shared/onboarding/policy'
import {
  ONBOARDING_RANK_EDGE_SEMANTICS,
  computeOnboardingSkillRanks,
} from '#shared/onboarding/preview'
import {
  buildTrainerPrerequisiteContext,
  judgeFeaturePrerequisite,
} from '#shared/onboarding/validate'
import {
  EDGE_PREREQUISITE_BY_KEY,
  evaluateEdgePrerequisite,
} from '#shared/edgeAutomation/prerequisites'
import { canonicalEdgeKey } from '#shared/edgeAutomation/catalog'
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

const emit = defineEmits<{ (event: 'patch-trainer', patch: Partial<OnboardingDraftV1['trainerBuild']>): void }>()

const build = computed(() => props.draft.trainerBuild)
const level = computed(() => props.policy.trainer.startingLevel)

/** Scoped patches merge against the live working draft in the page, so rapid
 *  same-tick events (blur + change) can never stomp each other. */
const updateTrainer = (patch: Partial<OnboardingDraftV1['trainerBuild']>): void => {
  if (!props.editable) return
  emit('patch-trainer', patch)
}

/* ---------------- identity ---------------- */
const identityField = (key: keyof OnboardingDraftV1['trainerBuild']['identity'], value: string): void => {
  updateTrainer({ identity: { ...build.value.identity, [key]: value.trim() === '' ? null : value } })
}

/* ---------------- stats ---------------- */
const statLabels: Record<OnboardingStatKey, string> = {
  hp: 'HP', atk: 'Attack', def: 'Defense', satk: 'Sp. Attack', sdef: 'Sp. Defense', spd: 'Speed',
}
const statBudget = computed(() => props.catalog.trainer.statBudget(level.value))
const statSpent = computed(() =>
  ONBOARDING_STAT_KEYS.reduce((sum, key) => sum + build.value.statAllocation[key], 0))
const adjustStat = (key: OnboardingStatKey, delta: number): void => {
  const current = build.value.statAllocation[key]
  const next = current + delta
  if (next < 0) return
  if (delta > 0 && statSpent.value >= statBudget.value) return
  updateTrainer({ statAllocation: { ...build.value.statAllocation, [key]: next } })
}

/* ---------------- background ---------------- */
const backgroundMechanics = computed(() => props.catalog.trainer.background)
const backgroundName = ref(build.value.background?.name ?? '')
const skillLabel = (skill: string): string => ({
  generalEd: 'General Ed', medicineEd: 'Medicine Ed', occultEd: 'Occult Ed',
  pokeEd: 'Pokémon Ed', techEd: 'Tech Ed',
} as Record<string, string>)[skill] ?? skill.charAt(0).toUpperCase() + skill.slice(1)

const backgroundPick = (bucket: 'adept' | 'novice' | 'pathetic', skill: OnboardingTrainerSkill): void => {
  const current = build.value.background ?? { name: backgroundName.value || 'Background', adept: [], novice: [], pathetic: [] }
  const inBucket = current[bucket].includes(skill)
  const limits = {
    adept: backgroundMechanics.value.adeptPicks,
    novice: backgroundMechanics.value.novicePicks,
    pathetic: backgroundMechanics.value.patheticPicks,
  }
  const without = {
    adept: current.adept.filter(entry => entry !== skill),
    novice: current.novice.filter(entry => entry !== skill),
    pathetic: current.pathetic.filter(entry => entry !== skill),
  }
  const next = inBucket
    ? { ...current, ...without }
    : {
        ...current,
        ...without,
        [bucket]: without[bucket].length >= limits[bucket]
          ? without[bucket]
          : [...without[bucket], skill],
      }
  updateTrainer({ background: { ...next, name: backgroundName.value.trim() || current.name } })
}

const backgroundBucketOf = (skill: OnboardingTrainerSkill): 'adept' | 'novice' | 'pathetic' | null => {
  const background = build.value.background
  if (!background) return null
  if (background.adept.includes(skill)) return 'adept'
  if (background.novice.includes(skill)) return 'novice'
  if (background.pathetic.includes(skill)) return 'pathetic'
  return null
}

const commitBackgroundName = (): void => {
  const current = build.value.background
  if (!current) {
    if (backgroundName.value.trim() === '') return
    updateTrainer({ background: { name: backgroundName.value.trim(), adept: [], novice: [], pathetic: [] } })
    return
  }
  updateTrainer({ background: { ...current, name: backgroundName.value.trim() || current.name } })
}

/* ---------------- training feature ---------------- */
const prerequisiteContext = computed(() =>
  buildTrainerPrerequisiteContext(build.value, level.value, props.catalog))

const trainingOptions = computed(() =>
  props.catalog.trainer.entitlements.freeTrainingFeatureIds.map((id) => {
    const verdict = judgeFeaturePrerequisite(id, prerequisiteContext.value)
    return { id, verdict }
  }))

/* ---------------- edges ---------------- */
const edgeSearch = ref('')
const allocateEntryId = (prefix: string, existing: readonly { entryId: string }[]): string => {
  let index = existing.length + 1
  while (existing.some(entry => entry.entryId === `${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

const chosenEdges = computed(() => build.value.edges)
const skillRanks = computed(() => computeOnboardingSkillRanks(build.value))

const edgeOptions = computed(() => {
  const query = edgeSearch.value.trim().toLocaleLowerCase()
  const out: { id: string, note: string, eligible: boolean, unmet: string, repeatable: boolean }[] = []
  for (const record of props.catalog.edges.values()) {
    if (query && !record.canonicalId.toLocaleLowerCase().includes(query)) continue
    if (props.policy.trainer.edgeRestriction.mode === 'allow-list'
      && !props.policy.trainer.edgeRestriction.canonicalIds.includes(record.canonicalId)) continue
    if (props.policy.trainer.edgeRestriction.mode === 'deny-list'
      && props.policy.trainer.edgeRestriction.canonicalIds.includes(record.canonicalId)) continue
    const repeatable = record.isSkillEdge
    if (!repeatable && chosenEdges.value.some(entry => entry.canonicalId === record.canonicalId)) continue
    let eligible = true
    let unmet = ''
    if (EDGE_PREREQUISITE_BY_KEY.has(canonicalEdgeKey('trainer', record.canonicalId))) {
      const evaluation = evaluateEdgePrerequisite('trainer', record.canonicalId, {
        level: level.value,
        skillRanks: Object.fromEntries(
          ONBOARDING_TRAINER_SKILLS.map(skill => [skill, skillRanks.value[skill].value]),
        ),
        effectiveEdgeKeys: new Set(chosenEdges.value.map(entry => canonicalEdgeKey('trainer', entry.canonicalId))),
      })
      eligible = evaluation.eligible
      unmet = evaluation.unmet.join('; ')
    }
    out.push({
      id: record.canonicalId,
      note: record.prerequisitesText && record.prerequisitesText !== 'None' ? record.prerequisitesText : '',
      eligible,
      unmet,
      repeatable,
    })
  }
  return out.sort((left, right) => Number(right.eligible) - Number(left.eligible) || left.id.localeCompare(right.id)).slice(0, 40)
})

const edgeSlotState = computed(() => {
  const normal = chosenEdges.value.filter(entry => entry.grantLevel === null).length
  const bonus = chosenEdges.value.filter(entry => entry.grantLevel !== null).length
  return {
    normal,
    normalBudget: props.catalog.trainer.edgeSlots(level.value),
    bonus,
    bonusBudget: props.catalog.trainer.bonusSkillEdgeSlots(level.value),
  }
})

const addEdge = (canonicalId: string, asBonus = false): void => {
  const state = edgeSlotState.value
  if (!asBonus && state.normal >= state.normalBudget) return
  if (asBonus && state.bonus >= state.bonusBudget) return
  const grantLevel = asBonus
    ? props.catalog.trainer.entitlements.bonusSkillEdgeLevels.find(at => at <= level.value) ?? null
    : null
  const entry: OnboardingEdgeEntryV1 = {
    entryId: allocateEntryId(asBonus ? 'bonus' : 'edge', chosenEdges.value),
    canonicalId,
    grantLevel,
    choices: {},
  }
  updateTrainer({ edges: [...chosenEdges.value, entry] })
}

const removeEdge = (entryId: string): void => {
  updateTrainer({ edges: chosenEdges.value.filter(entry => entry.entryId !== entryId) })
}

const setEdgeSkillChoice = (entryId: string, skill: string): void => {
  updateTrainer({
    edges: chosenEdges.value.map(entry =>
      entry.entryId === entryId
        ? { ...entry, choices: skill ? { ...entry.choices, skill } : {} }
        : entry),
  })
}

const setEdgeCategoryChoice = (entryId: string, category: string): void => {
  updateTrainer({
    edges: chosenEdges.value.map(entry =>
      entry.entryId === entryId
        ? { ...entry, choices: category ? { ...entry.choices, category } : {} }
        : entry),
  })
}

const edgeNeedsSkillChoice = (canonicalId: string): boolean =>
  Boolean(ONBOARDING_RANK_EDGE_SEMANTICS[canonicalId])

/* ---------------- features & classes ---------------- */
const featureSearch = ref('')
const chosenFeatures = computed(() => build.value.features)
const featureSlots = computed(() => props.catalog.trainer.paidFeatureSlots(level.value))

const featureOptions = computed(() => {
  const query = featureSearch.value.trim().toLocaleLowerCase()
  const out: { id: string, note: string, isClass: boolean, className: string | null, verdict: ReturnType<typeof judgeFeaturePrerequisite> }[] = []
  for (const record of props.catalog.features.values()) {
    if (props.catalog.trainer.entitlements.freeTrainingFeatureIds.includes(record.canonicalId)) continue
    if (query && !record.canonicalId.toLocaleLowerCase().includes(query)) continue
    if (props.policy.trainer.featureRestriction.mode === 'allow-list'
      && !props.policy.trainer.featureRestriction.canonicalIds.includes(record.canonicalId)) continue
    if (props.policy.trainer.featureRestriction.mode === 'deny-list'
      && props.policy.trainer.featureRestriction.canonicalIds.includes(record.canonicalId)) continue
    if (chosenFeatures.value.some(entry => entry.canonicalId === record.canonicalId)) continue
    const verdict = judgeFeaturePrerequisite(record.canonicalId, prerequisiteContext.value)
    out.push({
      id: record.canonicalId,
      note: record.prerequisitesText && record.prerequisitesText !== 'None' ? record.prerequisitesText : '',
      isClass: record.isClass,
      className: record.className,
      verdict,
    })
  }
  const rank = (verdict: ReturnType<typeof judgeFeaturePrerequisite>): number =>
    verdict.kind === 'satisfied' ? 0 : verdict.kind === 'needs-clause' ? 1 : 2
  return out.sort((left, right) => rank(left.verdict) - rank(right.verdict) || left.id.localeCompare(right.id)).slice(0, 40)
})

const addFeature = (canonicalId: string): void => {
  if (chosenFeatures.value.length >= featureSlots.value) return
  const record = props.catalog.features.get(canonicalId)
  const entry: OnboardingFeatureEntryV1 = {
    entryId: allocateEntryId('feature', chosenFeatures.value),
    canonicalId,
    isClassAnchor: record?.isClass === true,
    choices: {},
  }
  updateTrainer({ features: [...chosenFeatures.value, entry] })
}

const removeFeature = (entryId: string): void => {
  updateTrainer({ features: chosenFeatures.value.filter(entry => entry.entryId !== entryId) })
}

const setFeatureChoice = (entryId: string, key: string, value: string): void => {
  updateTrainer({
    features: chosenFeatures.value.map((entry) => {
      if (entry.entryId !== entryId) return entry
      const choices = { ...entry.choices }
      if (value) choices[key] = value
      else delete choices[key]
      return { ...entry, choices }
    }),
  })
}

/* ---------------- milestones ---------------- */
const milestones = computed(() => props.catalog.trainer.milestonesForLevel(level.value))
const milestoneChoiceFor = (milestoneLevel: number) =>
  build.value.milestoneChoices.find(choice => choice.level === milestoneLevel) ?? null

const chooseMilestone = (milestoneLevel: number, optionId: string): void => {
  const others = build.value.milestoneChoices.filter(choice => choice.level !== milestoneLevel)
  updateTrainer({
    milestoneChoices: [...others, { level: milestoneLevel, optionId, immediateAllocation: {} }],
  })
}

const adjustMilestoneStat = (milestoneLevel: number, key: OnboardingStatKey, delta: number): void => {
  const choice = milestoneChoiceFor(milestoneLevel)
  if (!choice) return
  const milestone = milestones.value.find(entry => entry.level === milestoneLevel)
  const option = milestone?.options.find(candidate => candidate.id === choice.optionId)
  const maximum = option?.immediatePoints ?? 0
  const current = choice.immediateAllocation[key] ?? 0
  const total = ONBOARDING_STAT_KEYS.reduce((sum, statKey) => sum + (choice.immediateAllocation[statKey] ?? 0), 0)
  const next = current + delta
  if (next < 0) return
  if (delta > 0 && total >= maximum) return
  const others = build.value.milestoneChoices.filter(entry => entry.level !== milestoneLevel)
  updateTrainer({
    milestoneChoices: [...others, {
      ...choice,
      immediateAllocation: { ...choice.immediateAllocation, [key]: next },
    }],
  })
}

const decisionTitle = computed(() => ({
  'trainer.identity': 'Trainer identity',
  'trainer.stat-allocation': 'Stat points',
  'trainer.background': 'Skill background',
  'trainer.training-feature': 'Training Feature',
  'trainer.edges': 'Edges',
  'trainer.features': 'Features & classes',
  'trainer.milestones': 'Milestone choices',
}[props.decisionId] ?? props.decisionId))
</script>

<template>
  <article class="decision-card" :aria-labelledby="`decision-title-${decisionId}`">
    <header class="decision-card__header">
      <h2 :id="`decision-title-${decisionId}`">{{ decisionTitle }}</h2>
      <span class="decision-card__meta">TRAINER · Level {{ level }}</span>
    </header>

    <!-- Identity -->
    <template v-if="decisionId === 'trainer.identity'">
      <p class="decision-card__prompt">Who is this Trainer? Only the name is required.</p>
      <div class="decision-card__grid">
        <label class="decision-field decision-field--wide">
          <span>Name *</span>
          <input
            :value="build.name ?? ''"
            type="text"
            maxlength="80"
            :disabled="!editable"
            @input="updateTrainer({ name: ($event.target as HTMLInputElement).value.trim() || null })"
          >
        </label>
        <label class="decision-field">
          <span>Age</span>
          <input :value="build.identity.age ?? ''" type="text" maxlength="40" :disabled="!editable" @input="identityField('age', ($event.target as HTMLInputElement).value)">
        </label>
        <label class="decision-field">
          <span>Gender / pronouns</span>
          <input :value="build.identity.sex ?? ''" type="text" maxlength="40" :disabled="!editable" @input="identityField('sex', ($event.target as HTMLInputElement).value)">
        </label>
        <label class="decision-field decision-field--wide">
          <span>Concept & background notes</span>
          <textarea :value="build.identity.background ?? ''" rows="3" maxlength="4000" :disabled="!editable" @input="identityField('background', ($event.target as HTMLTextAreaElement).value)" />
        </label>
      </div>
    </template>

    <!-- Stat allocation -->
    <template v-else-if="decisionId === 'trainer.stat-allocation'">
      <p class="decision-card__prompt">
        Distribute {{ statBudget }} stat points. {{ statBudget - statSpent }} left.
      </p>
      <ul class="stat-rows">
        <li v-for="key in ONBOARDING_STAT_KEYS" :key="key" class="stat-row">
          <span class="stat-row__label">{{ statLabels[key] }}</span>
          <span class="stat-row__base">base {{ key === 'hp' ? 10 : 5 }}</span>
          <div class="stat-row__controls">
            <button type="button" :disabled="!editable || build.statAllocation[key] === 0" :aria-label="`Remove point from ${statLabels[key]}`" @click="adjustStat(key, -1)">−</button>
            <span class="stat-row__value">{{ build.statAllocation[key] }}</span>
            <button type="button" :disabled="!editable || statSpent >= statBudget" :aria-label="`Add point to ${statLabels[key]}`" @click="adjustStat(key, 1)">+</button>
          </div>
          <span class="stat-row__total">= {{ (key === 'hp' ? 10 : 5) + build.statAllocation[key] }}</span>
        </li>
      </ul>
    </template>

    <!-- Background -->
    <template v-else-if="decisionId === 'trainer.background'">
      <p class="decision-card__prompt">
        Name your background, raise {{ backgroundMechanics.adeptPicks }} skill to Adept and
        {{ backgroundMechanics.novicePicks }} to Novice, then lower {{ backgroundMechanics.patheticPicks }} to Pathetic.
        Pathetic skills stay Pathetic during creation.
      </p>
      <label class="decision-field decision-field--wide">
        <span>Background name *</span>
        <input v-model="backgroundName" type="text" maxlength="80" :disabled="!editable" @input="commitBackgroundName">
      </label>
      <div class="background-scroll">
        <table class="background-table">
        <thead>
          <tr>
            <th scope="col">Skill</th>
            <th scope="col">Adept ({{ build.background?.adept.length ?? 0 }}/{{ backgroundMechanics.adeptPicks }})</th>
            <th scope="col">Novice ({{ build.background?.novice.length ?? 0 }}/{{ backgroundMechanics.novicePicks }})</th>
            <th scope="col">Pathetic ({{ build.background?.pathetic.length ?? 0 }}/{{ backgroundMechanics.patheticPicks }})</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="skill in ONBOARDING_TRAINER_SKILLS" :key="skill">
            <th scope="row">{{ skillLabel(skill) }}</th>
            <td v-for="bucket in (['adept', 'novice', 'pathetic'] as const)" :key="bucket">
              <button
                type="button"
                class="background-pick"
                :data-active="backgroundBucketOf(skill) === bucket ? '1' : undefined"
                :disabled="!editable"
                :aria-pressed="backgroundBucketOf(skill) === bucket"
                :aria-label="`${skillLabel(skill)} ${bucket}`"
                @click="backgroundPick(bucket, skill)"
              >
                {{ backgroundBucketOf(skill) === bucket ? '●' : '○' }}
              </button>
            </td>
          </tr>
        </tbody>
        </table>
      </div>
    </template>

    <!-- Training feature -->
    <template v-else-if="decisionId === 'trainer.training-feature'">
      <p class="decision-card__prompt">Every Trainer picks one free Training Feature. It shapes how your Pokémon train.</p>
      <ul class="option-rows">
        <li v-for="option in trainingOptions" :key="option.id">
          <button
            type="button"
            class="option-row option-row--selectable"
            :data-selected="build.trainingFeatureId === option.id ? '1' : undefined"
            :disabled="!editable"
            @click="updateTrainer({ trainingFeatureId: option.id })"
          >
            <span class="option-row__body">
              <strong>{{ option.id }}</strong>
              <span v-if="option.verdict.kind === 'unmet'" class="option-row__note option-row__note--warn">
                needs {{ option.verdict.unmetLabels.join('; ') }}
              </span>
              <span v-else-if="option.verdict.kind === 'needs-clause'" class="option-row__note option-row__note--warn">
                GM confirms prerequisite at review
              </span>
            </span>
            <span class="option-row__mark" aria-hidden="true">{{ build.trainingFeatureId === option.id ? '●' : '○' }}</span>
          </button>
        </li>
      </ul>
    </template>

    <!-- Edges -->
    <template v-else-if="decisionId === 'trainer.edges'">
      <p class="decision-card__prompt">
        Choose {{ edgeSlotState.normalBudget }} Edges.
        <template v-if="edgeSlotState.bonusBudget > 0">
          Plus {{ edgeSlotState.bonusBudget }} bonus Skill Edge slot(s) from levels 2/6/12.
        </template>
        {{ Math.max(0, edgeSlotState.normalBudget - edgeSlotState.normal) }} slot(s) left.
      </p>
      <ul v-if="chosenEdges.length > 0" class="chosen-rows">
        <li v-for="entry in chosenEdges" :key="entry.entryId" class="chosen-row">
          <span class="chosen-row__check" aria-hidden="true">✓</span>
          <span class="chosen-row__name">
            {{ entry.canonicalId }}
            <span v-if="entry.grantLevel !== null" class="chosen-row__tag">bonus L{{ entry.grantLevel }}</span>
          </span>
          <select
            v-if="edgeNeedsSkillChoice(entry.canonicalId)"
            class="chosen-row__choice"
            :value="entry.choices.skill ?? ''"
            :disabled="!editable"
            :aria-label="`${entry.canonicalId} skill`"
            @change="setEdgeSkillChoice(entry.entryId, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">Choose skill…</option>
            <option v-for="skill in ONBOARDING_TRAINER_SKILLS" :key="skill" :value="skill">{{ skillLabel(skill) }}</option>
          </select>
          <select
            v-else-if="entry.canonicalId === 'Categoric Inclination'"
            class="chosen-row__choice"
            :value="entry.choices.category ?? ''"
            :disabled="!editable"
            aria-label="Categoric Inclination category"
            @change="setEdgeCategoryChoice(entry.entryId, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">Choose category…</option>
            <option value="Body">Body</option>
            <option value="Mind">Mind</option>
            <option value="Spirit">Spirit</option>
          </select>
          <button type="button" class="chosen-row__remove" :disabled="!editable" @click="removeEdge(entry.entryId)">Remove</button>
        </li>
      </ul>
      <label class="decision-field decision-field--wide">
        <span class="sr-only">Search Edges</span>
        <input v-model="edgeSearch" type="search" placeholder="Search Edges…" :disabled="!editable">
      </label>
      <ul class="option-rows">
        <li v-for="option in edgeOptions" :key="option.id" class="option-row">
          <span class="option-row__body">
            <strong>{{ option.id }}</strong>
            <span v-if="!option.eligible" class="option-row__note option-row__note--warn">needs {{ option.unmet }}</span>
            <span v-else-if="option.note" class="option-row__note">{{ option.note }}</span>
          </span>
          <span class="option-row__actions">
            <button
              type="button"
              class="option-row__add"
              :disabled="!editable || !option.eligible || edgeSlotState.normal >= edgeSlotState.normalBudget"
              @click="addEdge(option.id)"
            >
              Add
            </button>
            <button
              v-if="option.repeatable && edgeSlotState.bonusBudget > edgeSlotState.bonus"
              type="button"
              class="option-row__add"
              :disabled="!editable || !option.eligible"
              @click="addEdge(option.id, true)"
            >
              Add as bonus
            </button>
          </span>
        </li>
      </ul>
    </template>

    <!-- Features -->
    <template v-else-if="decisionId === 'trainer.features'">
      <p class="decision-card__prompt">
        Choose {{ featureSlots }} Features. Classes are Features too — taking a class anchor starts that class.
        {{ Math.max(0, featureSlots - chosenFeatures.length) }} slot(s) left.
      </p>
      <ul v-if="chosenFeatures.length > 0" class="chosen-rows">
        <li v-for="entry in chosenFeatures" :key="entry.entryId" class="chosen-row">
          <span class="chosen-row__check" aria-hidden="true">✓</span>
          <span class="chosen-row__name">
            {{ entry.canonicalId }}
            <span v-if="entry.isClassAnchor" class="chosen-row__tag">class</span>
          </span>
          <template v-if="entry.canonicalId === 'Researcher'">
            <select
              class="chosen-row__choice"
              :value="entry.choices.researcherField ?? ''"
              :disabled="!editable"
              aria-label="Researcher field 1"
              @change="setFeatureChoice(entry.entryId, 'researcherField', ($event.target as HTMLSelectElement).value)"
            >
              <option value="">Field 1…</option>
              <option v-for="field in ['General Education', 'Apothecary', 'Artificer', 'Botany', 'Chemistry', 'Climatology', 'Occultism', 'Paleontology']" :key="field" :value="field">{{ field }}</option>
            </select>
            <select
              class="chosen-row__choice"
              :value="entry.choices.researcherField2 ?? ''"
              :disabled="!editable"
              aria-label="Researcher field 2"
              @change="setFeatureChoice(entry.entryId, 'researcherField2', ($event.target as HTMLSelectElement).value)"
            >
              <option value="">Field 2…</option>
              <option v-for="field in ['General Education', 'Apothecary', 'Artificer', 'Botany', 'Chemistry', 'Climatology', 'Occultism', 'Paleontology']" :key="field" :value="field">{{ field }}</option>
            </select>
          </template>
          <button type="button" class="chosen-row__remove" :disabled="!editable" @click="removeFeature(entry.entryId)">Remove</button>
        </li>
      </ul>
      <label class="decision-field decision-field--wide">
        <span class="sr-only">Search Features</span>
        <input v-model="featureSearch" type="search" placeholder="Search Features and classes…" :disabled="!editable">
      </label>
      <ul class="option-rows">
        <li v-for="option in featureOptions" :key="option.id" class="option-row">
          <span class="option-row__body">
            <strong>{{ option.id }}</strong>
            <span v-if="option.isClass" class="chosen-row__tag">class</span>
            <span v-if="option.verdict.kind === 'unmet'" class="option-row__note option-row__note--warn">
              needs {{ option.verdict.unmetLabels.join('; ') }}
            </span>
            <span v-else-if="option.verdict.kind === 'needs-clause'" class="option-row__note option-row__note--pending">
              GM confirms prerequisite at review
            </span>
            <span v-else-if="option.note" class="option-row__note">{{ option.note }}</span>
          </span>
          <button
            type="button"
            class="option-row__add"
            :disabled="!editable || option.verdict.kind === 'unmet' || chosenFeatures.length >= featureSlots"
            @click="addFeature(option.id)"
          >
            Add
          </button>
        </li>
      </ul>
    </template>

    <!-- Milestones -->
    <template v-else-if="decisionId === 'trainer.milestones'">
      <p class="decision-card__prompt">Higher-level starts resolve each milestone choice now.</p>
      <section v-for="milestone in milestones" :key="milestone.level" class="milestone">
        <h3>Level {{ milestone.level }}</h3>
        <ul class="option-rows">
          <li v-for="option in milestone.options" :key="option.id">
            <button
              type="button"
              class="option-row option-row--selectable"
              :data-selected="milestoneChoiceFor(milestone.level)?.optionId === option.id ? '1' : undefined"
              :disabled="!editable"
              @click="chooseMilestone(milestone.level, option.id)"
            >
              <span class="option-row__body">
                <strong>
                  {{ option.id === 'attack-special-attack' ? 'Attack / Sp. Attack points' : option.id === 'two-edges' ? 'Two extra Edges' : 'Extra Feature' }}
                </strong>
                <span class="option-row__note">
                  <template v-if="option.immediatePoints">+{{ option.immediatePoints }} points now (Attack/Sp. Attack only)</template>
                  <template v-else-if="option.edgeSlots">+{{ option.edgeSlots }} Edge slots</template>
                  <template v-else-if="option.featureSlots">+{{ option.featureSlots }} Feature slot</template>
                  <template v-else>Scheduled bonus points on later even levels</template>
                </span>
              </span>
              <span class="option-row__mark" aria-hidden="true">
                {{ milestoneChoiceFor(milestone.level)?.optionId === option.id ? '●' : '○' }}
              </span>
            </button>
          </li>
        </ul>
        <div
          v-if="milestoneChoiceFor(milestone.level)?.optionId === 'attack-special-attack'
            && (milestone.options.find(o => o.id === 'attack-special-attack')?.immediatePoints ?? 0) > 0"
          class="milestone__allocation"
        >
          <span>Allocate the immediate points:</span>
          <div v-for="key in (['atk', 'satk'] as const)" :key="key" class="stat-row__controls">
            <span>{{ statLabels[key] }}</span>
            <button type="button" :disabled="!editable" :aria-label="`Remove milestone point from ${statLabels[key]}`" @click="adjustMilestoneStat(milestone.level, key, -1)">−</button>
            <span class="stat-row__value">{{ milestoneChoiceFor(milestone.level)?.immediateAllocation[key] ?? 0 }}</span>
            <button type="button" :disabled="!editable" :aria-label="`Add milestone point to ${statLabels[key]}`" @click="adjustMilestoneStat(milestone.level, key, 1)">+</button>
          </div>
        </div>
      </section>
    </template>

    <OnboardingIssueList :issues="issues" />
  </article>
</template>

<style scoped src="./onboardingDecision.css" />
