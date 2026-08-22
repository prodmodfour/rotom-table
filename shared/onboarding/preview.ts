/**
 * Deterministic derived previews with contribution explanations (P9-017).
 *
 * Every derived value identifies its canonical and campaign-policy
 * contributors so the builder never becomes a second opaque rules engine.
 * The formulas mirror the ordinary sheet runtime; drift gates compare both.
 */

import { ptuNatureAdjustedDelta } from '../ruleset/natures'
import type { OnboardingCreationCatalog } from './catalog'
import {
  ONBOARDING_STAT_KEYS,
  ONBOARDING_TRAINER_SKILLS,
  type OnboardingPokemonBuildV1,
  type OnboardingStatKey,
  type OnboardingTrainerBuildV1,
  type OnboardingTrainerSkill,
} from './draft'

export interface OnboardingContribution {
  readonly source: 'canonical-formula' | 'canonical-species' | 'canonical-rule' | 'nature' | 'allocation' | 'background' | 'edge' | 'milestone' | 'policy'
  readonly label: string
  readonly value: number
}

export interface OnboardingDerivedValue {
  readonly value: number
  readonly contributions: readonly OnboardingContribution[]
}

/* ------------------------------------------------------------------ */
/* Skill ranks                                                        */
/* ------------------------------------------------------------------ */

export const ONBOARDING_SKILL_RANK_VALUES = Object.freeze({
  Pathetic: 1,
  Untrained: 2,
  Novice: 3,
  Adept: 4,
  Expert: 5,
  Master: 6,
} as const)
export type OnboardingSkillRankName = keyof typeof ONBOARDING_SKILL_RANK_VALUES

export const onboardingRankName = (value: number): OnboardingSkillRankName => {
  const entry = (Object.entries(ONBOARDING_SKILL_RANK_VALUES) as [OnboardingSkillRankName, number][])
    .find(([, rankValue]) => rankValue === value)
  return entry ? entry[0] : 'Untrained'
}

/** Skill edges that change ranks during creation, with exact from-rank rules. */
export const ONBOARDING_RANK_EDGE_SEMANTICS: Readonly<Record<string, { readonly kind: 'increment-below-novice' } | { readonly kind: 'set-target', readonly from: number, readonly to: number }>> = Object.freeze({
  'Basic Skills': { kind: 'increment-below-novice' },
  'Adept Skills': { kind: 'set-target', from: ONBOARDING_SKILL_RANK_VALUES.Novice, to: ONBOARDING_SKILL_RANK_VALUES.Adept },
  'Expert Skills': { kind: 'set-target', from: ONBOARDING_SKILL_RANK_VALUES.Adept, to: ONBOARDING_SKILL_RANK_VALUES.Expert },
  'Master Skills': { kind: 'set-target', from: ONBOARDING_SKILL_RANK_VALUES.Expert, to: ONBOARDING_SKILL_RANK_VALUES.Master },
})

export interface OnboardingSkillRankRow {
  readonly skill: OnboardingTrainerSkill
  readonly value: number
  readonly rank: OnboardingSkillRankName
  readonly contributions: readonly OnboardingContribution[]
}

export const computeOnboardingSkillRanks = (
  build: OnboardingTrainerBuildV1,
): Readonly<Record<OnboardingTrainerSkill, OnboardingSkillRankRow>> => {
  const rows = {} as Record<OnboardingTrainerSkill, { value: number, contributions: OnboardingContribution[] }>
  for (const skill of ONBOARDING_TRAINER_SKILLS) {
    rows[skill] = {
      value: ONBOARDING_SKILL_RANK_VALUES.Untrained,
      contributions: [{ source: 'canonical-rule', label: 'Untrained default', value: ONBOARDING_SKILL_RANK_VALUES.Untrained }],
    }
  }

  const background = build.background
  if (background) {
    const apply = (skills: readonly OnboardingTrainerSkill[], target: number, label: string): void => {
      for (const skill of skills) {
        rows[skill].value = target
        rows[skill].contributions.push({ source: 'background', label: `${background.name}: ${label}`, value: target })
      }
    }
    apply(background.pathetic, ONBOARDING_SKILL_RANK_VALUES.Pathetic, 'Pathetic')
    apply(background.novice, ONBOARDING_SKILL_RANK_VALUES.Novice, 'Novice')
    apply(background.adept, ONBOARDING_SKILL_RANK_VALUES.Adept, 'Adept')
  }

  for (const edge of build.edges) {
    const semantics = ONBOARDING_RANK_EDGE_SEMANTICS[edge.canonicalId]
    if (!semantics) continue
    const skill = edge.choices.skill
    if (!skill || !(ONBOARDING_TRAINER_SKILLS as readonly string[]).includes(skill)) continue
    const row = rows[skill as OnboardingTrainerSkill]
    if (semantics.kind === 'increment-below-novice') {
      if (row.value < ONBOARDING_SKILL_RANK_VALUES.Novice) {
        row.value += 1
        row.contributions.push({ source: 'edge', label: `${edge.canonicalId} (${skill})`, value: row.value })
      }
    } else if (row.value < semantics.to) {
      row.value = Math.max(row.value, semantics.to)
      row.contributions.push({ source: 'edge', label: `${edge.canonicalId} (${skill})`, value: row.value })
    }
  }

  const out = {} as Record<OnboardingTrainerSkill, OnboardingSkillRankRow>
  for (const skill of ONBOARDING_TRAINER_SKILLS) {
    out[skill] = {
      skill,
      value: rows[skill].value,
      rank: onboardingRankName(rows[skill].value),
      contributions: rows[skill].contributions,
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Trainer preview                                                    */
/* ------------------------------------------------------------------ */

export const ONBOARDING_TRAINER_BASE_STATS: Readonly<Record<OnboardingStatKey, number>> = Object.freeze({
  hp: 10, atk: 5, def: 5, satk: 5, sdef: 5, spd: 5,
})

export interface OnboardingTrainerStatPreview {
  readonly key: OnboardingStatKey
  readonly base: number
  readonly allocated: number
  readonly milestone: number
  readonly total: number
}

export interface OnboardingBudgetPreview {
  readonly budget: number
  readonly spent: number
  readonly remaining: number
}

export interface OnboardingTrainerPreviewV1 {
  readonly level: number
  readonly stats: readonly OnboardingTrainerStatPreview[]
  readonly maxHp: OnboardingDerivedValue
  readonly apMax: OnboardingDerivedValue
  readonly statPoints: OnboardingBudgetPreview
  readonly milestonePoints: OnboardingBudgetPreview
  readonly featureSlots: OnboardingBudgetPreview
  readonly edgeSlots: OnboardingBudgetPreview
  readonly bonusSkillEdgeSlots: OnboardingBudgetPreview
  readonly skills: Readonly<Record<OnboardingTrainerSkill, OnboardingSkillRankRow>>
}

export const computeOnboardingTrainerPreview = (
  build: OnboardingTrainerBuildV1,
  level: number,
  catalog: OnboardingCreationCatalog,
): OnboardingTrainerPreviewV1 => {
  const milestoneAllocation = {} as Record<OnboardingStatKey, number>
  for (const key of ONBOARDING_STAT_KEYS) milestoneAllocation[key] = 0
  let milestoneBudget = 0
  for (const milestone of catalog.trainer.milestonesForLevel(level)) {
    const choice = build.milestoneChoices.find(entry => entry.level === milestone.level)
    if (!choice) continue
    const option = milestone.options.find(candidate => candidate.id === choice.optionId)
    if (option?.immediatePoints) milestoneBudget += option.immediatePoints
    for (const key of ONBOARDING_STAT_KEYS) {
      milestoneAllocation[key] += choice.immediateAllocation[key] ?? 0
    }
  }

  const stats: OnboardingTrainerStatPreview[] = ONBOARDING_STAT_KEYS.map(key => ({
    key,
    base: ONBOARDING_TRAINER_BASE_STATS[key],
    allocated: build.statAllocation[key],
    milestone: milestoneAllocation[key],
    total: ONBOARDING_TRAINER_BASE_STATS[key] + build.statAllocation[key] + milestoneAllocation[key],
  }))

  const hpTotal = stats.find(stat => stat.key === 'hp')!.total
  const maxHp: OnboardingDerivedValue = {
    value: level * 2 + hpTotal * 3 + 10,
    contributions: [
      { source: 'canonical-formula', label: 'Level × 2', value: level * 2 },
      { source: 'canonical-formula', label: `HP stat ${hpTotal} × 3`, value: hpTotal * 3 },
      { source: 'canonical-formula', label: 'Trainer base 10', value: 10 },
    ],
  }

  const apMax: OnboardingDerivedValue = {
    value: 5 + Math.floor(level / 5),
    contributions: [
      { source: 'canonical-formula', label: 'Base 5 AP', value: 5 },
      { source: 'canonical-formula', label: 'floor(Level ÷ 5)', value: Math.floor(level / 5) },
    ],
  }

  const statBudget = catalog.trainer.statBudget(level)
  const statSpent = ONBOARDING_STAT_KEYS.reduce((sum, key) => sum + build.statAllocation[key], 0)
  const milestoneSpent = ONBOARDING_STAT_KEYS.reduce((sum, key) => sum + milestoneAllocation[key], 0)

  const paidFeatureSlots = catalog.trainer.paidFeatureSlots(level)
  const edgeSlotCount = catalog.trainer.edgeSlots(level)
  const bonusSlots = catalog.trainer.bonusSkillEdgeSlots(level)
  const normalEdges = build.edges.filter(edge => edge.grantLevel === null)
  const bonusEdges = build.edges.filter(edge => edge.grantLevel !== null)

  return {
    level,
    stats,
    maxHp,
    apMax,
    statPoints: { budget: statBudget, spent: statSpent, remaining: statBudget - statSpent },
    milestonePoints: { budget: milestoneBudget, spent: milestoneSpent, remaining: milestoneBudget - milestoneSpent },
    featureSlots: { budget: paidFeatureSlots, spent: build.features.length, remaining: paidFeatureSlots - build.features.length },
    edgeSlots: { budget: edgeSlotCount, spent: normalEdges.length, remaining: edgeSlotCount - normalEdges.length },
    bonusSkillEdgeSlots: { budget: bonusSlots, spent: bonusEdges.length, remaining: bonusSlots - bonusEdges.length },
    skills: computeOnboardingSkillRanks(build),
  }
}

/* ------------------------------------------------------------------ */
/* Pokémon preview                                                    */
/* ------------------------------------------------------------------ */

export interface OnboardingPokemonStatPreview {
  readonly key: OnboardingStatKey
  readonly speciesBase: number
  readonly natureDelta: number
  readonly adjustedBase: number
  readonly added: number
  readonly total: number
}

export interface OnboardingPokemonPreviewV1 {
  readonly speciesId: string
  readonly level: number
  readonly stats: readonly OnboardingPokemonStatPreview[]
  readonly maxHp: OnboardingDerivedValue
  readonly addedPoints: OnboardingBudgetPreview
  readonly tutorPoints: OnboardingDerivedValue
  readonly experience: number | null
  readonly moveCount: number
}

export const computeOnboardingPokemonPreview = (
  build: OnboardingPokemonBuildV1,
  level: number,
  catalog: OnboardingCreationCatalog,
): OnboardingPokemonPreviewV1 | null => {
  if (!build.speciesId) return null
  const species = catalog.species.get(build.speciesId)
  if (!species || !species.baseStats) return null

  const nature = build.natureId ? catalog.natures.get(build.natureId) ?? null : null

  const stats: OnboardingPokemonStatPreview[] = ONBOARDING_STAT_KEYS.map((key) => {
    const speciesBase = species.baseStats![key]
    const natureDelta = nature ? ptuNatureAdjustedDelta(speciesBase, key, nature.plus, nature.minus) : 0
    const adjustedBase = Math.max(speciesBase <= 0 ? 0 : 1, speciesBase + natureDelta)
    const added = build.addedStats[key]
    return { key, speciesBase, natureDelta, adjustedBase, added, total: adjustedBase + added }
  })

  const hpTotal = stats.find(stat => stat.key === 'hp')!.total
  const maxHp: OnboardingDerivedValue = {
    value: level + hpTotal * 3 + 10,
    contributions: [
      { source: 'canonical-formula', label: `Level ${level}`, value: level },
      { source: 'canonical-formula', label: `HP stat ${hpTotal} × 3`, value: hpTotal * 3 },
      { source: 'canonical-formula', label: 'Pokémon base 10', value: 10 },
    ],
  }

  const budget = catalog.pokemon.addedStatBudget(level)
  const spent = ONBOARDING_STAT_KEYS.reduce((sum, key) => sum + build.addedStats[key], 0)

  return {
    speciesId: species.speciesId,
    level,
    stats,
    maxHp,
    addedPoints: { budget, spent, remaining: budget - spent },
    tutorPoints: {
      value: catalog.pokemon.tutorPoints(level),
      contributions: [
        { source: 'canonical-rule', label: 'Hatch/creation Tutor Point', value: 1 },
        { source: 'canonical-rule', label: 'floor(Level ÷ 5)', value: Math.floor(Math.max(1, level) / 5) },
      ],
    },
    experience: catalog.pokemon.experienceForLevel(level),
    moveCount: build.moveIds.length,
  }
}
