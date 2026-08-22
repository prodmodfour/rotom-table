/**
 * Authoritative onboarding package validation (P9-016/P9-051 core engine).
 *
 * Pure and deterministic: (draft build, policy content, catalog) -> issues.
 * The same engine runs in the builder UI, at submission, and inside approval
 * re-authorization, so client and server can never disagree (P9-020 gates).
 */

import {
  FEATURE_PREREQUISITE_BY_ID,
  evaluateFeaturePrerequisite,
  type FeaturePrerequisiteContext,
  type FeaturePrerequisiteExpression,
} from '../featureAutomation/prerequisites'
import {
  EDGE_PREREQUISITE_BY_KEY,
  evaluateEdgePrerequisite,
} from '../edgeAutomation/prerequisites'
import { canonicalEdgeKey } from '../edgeAutomation/catalog'
import type { OnboardingCreationCatalog } from './catalog'
import type { CampaignOnboardingPolicyContentV1 } from './policy'
import {
  ONBOARDING_STAT_KEYS,
  ONBOARDING_TRAINER_SKILLS,
  type OnboardingPokemonBuildV1,
  type OnboardingStatKey,
  type OnboardingTrainerBuildV1,
  type OnboardingTrainerSkill,
} from './draft'
import { parseOnboardingDecisionId, type OnboardingDecisionId } from './ids'
import {
  ONBOARDING_RANK_EDGE_SEMANTICS,
  ONBOARDING_SKILL_RANK_VALUES,
  computeOnboardingSkillRanks,
} from './preview'
import {
  createOnboardingIssue,
  summarizeOnboardingIssues,
  type OnboardingValidationIssue,
  type OnboardingValidationSummary,
} from './validation'

export interface OnboardingPackageForValidation {
  readonly trainerBuild: OnboardingTrainerBuildV1
  readonly pokemonBuilds: readonly OnboardingPokemonBuildV1[]
  readonly deferredDecisions: readonly OnboardingDecisionId[]
}

const decision = (id: string): OnboardingDecisionId => parseOnboardingDecisionId(id)

const RANK_NAME_TO_VALUE: Readonly<Record<string, number>> = ONBOARDING_SKILL_RANK_VALUES

/* ------------------------------------------------------------------ */
/* Prerequisite helpers                                               */
/* ------------------------------------------------------------------ */

const expressionUsesClause = (expression: FeaturePrerequisiteExpression): boolean => {
  if (expression.kind === 'reviewed-build-clause') return true
  if (expression.kind === 'all' || expression.kind === 'any') {
    return expression.requirements.some(expressionUsesClause)
  }
  return false
}

const collectClauseIds = (expression: FeaturePrerequisiteExpression, out: Set<string>): void => {
  if (expression.kind === 'reviewed-build-clause') out.add(expression.clauseId)
  if (expression.kind === 'all' || expression.kind === 'any') {
    for (const requirement of expression.requirements) collectClauseIds(requirement, out)
  }
}

export interface FeaturePrerequisiteVerdict {
  readonly kind: 'satisfied' | 'needs-clause' | 'unmet'
  readonly unmetLabels: readonly string[]
}

export const judgeFeaturePrerequisite = (
  canonicalId: string,
  context: FeaturePrerequisiteContext,
): FeaturePrerequisiteVerdict => {
  const record = FEATURE_PREREQUISITE_BY_ID.get(canonicalId)
  if (!record) return { kind: 'unmet', unmetLabels: ['unknown canonical feature'] }

  const allClauses = new Set<string>()
  collectClauseIds(record.expression, allClauses)

  const strict = evaluateFeaturePrerequisite(record.expression, context)
  if (strict.satisfied) return { kind: 'satisfied', unmetLabels: [] }

  if (allClauses.size > 0) {
    const withClauses = evaluateFeaturePrerequisite(record.expression, {
      ...context,
      approvedClauseIds: new Set([...(context.approvedClauseIds ?? []), ...allClauses]),
    })
    if (withClauses.satisfied) return { kind: 'needs-clause', unmetLabels: [] }
  }

  const unmet: string[] = []
  const collect = (node: { satisfied: boolean, label: string, children?: readonly { satisfied: boolean, label: string, children?: readonly unknown[] }[] }): void => {
    if (!node.satisfied && (!node.children || node.children.length === 0)) unmet.push(node.label)
    for (const child of node.children ?? []) collect(child as never)
  }
  collect(strict)
  return { kind: 'unmet', unmetLabels: [...new Set(unmet)] }
}

/** Final-state prerequisite context for a trainer build (shared with the builder UI). */
export const buildTrainerPrerequisiteContext = (
  build: OnboardingTrainerBuildV1,
  level: number,
  catalog: OnboardingCreationCatalog,
): FeaturePrerequisiteContext => {
  const skillRows = computeOnboardingSkillRanks(build)
  const skillRanks: Record<string, number> = {}
  for (const skill of ONBOARDING_TRAINER_SKILLS) skillRanks[skill] = skillRows[skill].value
  const featureIds = new Set(build.features.map(feature => feature.canonicalId))
  if (build.trainingFeatureId) featureIds.add(build.trainingFeatureId)
  const featureClassCounts: Record<string, number> = {}
  for (const feature of build.features) {
    const record = catalog.features.get(feature.canonicalId)
    if (record?.className) featureClassCounts[record.className] = (featureClassCounts[record.className] ?? 0) + 1
  }
  return {
    level,
    skillRanks,
    featureIds,
    edgeIds: new Set(build.edges.map(edge => edge.canonicalId)),
    featureClassCounts,
  }
}

/* ------------------------------------------------------------------ */
/* Trainer validation                                                 */
/* ------------------------------------------------------------------ */

const validateTrainerBuild = (
  build: OnboardingTrainerBuildV1,
  policy: CampaignOnboardingPolicyContentV1,
  catalog: OnboardingCreationCatalog,
  issues: OnboardingValidationIssue[],
): void => {
  const level = policy.trainer.startingLevel

  /* Identity */
  if (!build.name) {
    issues.push(createOnboardingIssue('trainer.name-missing', decision('trainer.identity'), 'Give your Trainer a name to continue.'))
  }

  /* Stat allocation */
  const statBudget = catalog.trainer.statBudget(level)
  const statSpent = ONBOARDING_STAT_KEYS.reduce((sum, key) => sum + build.statAllocation[key], 0)
  if (statSpent > statBudget) {
    issues.push(createOnboardingIssue('trainer.stat-budget-overspent', decision('trainer.stat-allocation'), `You allocated ${statSpent} of ${statBudget} stat points; remove ${statSpent - statBudget}.`, { detail: { spent: statSpent, budget: statBudget } }))
  } else if (statSpent < statBudget) {
    issues.push(createOnboardingIssue('trainer.stat-budget-unspent', decision('trainer.stat-allocation'), `You still have ${statBudget - statSpent} stat points to allocate.`, { detail: { spent: statSpent, budget: statBudget } }))
  }

  /* Milestones */
  const milestones = catalog.trainer.milestonesForLevel(level)
  for (const milestone of milestones) {
    const choice = build.milestoneChoices.find(entry => entry.level === milestone.level)
    if (policy.trainer.milestoneCollection === 'defer-to-attention') continue
    if (!choice) {
      issues.push(createOnboardingIssue('trainer.milestone-choice-missing', decision('trainer.milestones'), `Choose your Level ${milestone.level} milestone option.`, { detail: { level: milestone.level } }))
      continue
    }
    const option = milestone.options.find(candidate => candidate.id === choice.optionId)
    if (!option) {
      issues.push(createOnboardingIssue('trainer.milestone-choice-invalid', decision('trainer.milestones'), `"${choice.optionId}" is not a Level ${milestone.level} milestone option.`, { detail: { level: milestone.level } }))
      continue
    }
    const allocated = ONBOARDING_STAT_KEYS.reduce((sum, key) => sum + (choice.immediateAllocation[key] ?? 0), 0)
    const expected = option.immediatePoints ?? 0
    const restrictedKeys: readonly OnboardingStatKey[] = option.id === 'attack-special-attack' ? ['atk', 'satk'] : ONBOARDING_STAT_KEYS
    const outsideRestriction = ONBOARDING_STAT_KEYS.some(key => (choice.immediateAllocation[key] ?? 0) > 0 && !restrictedKeys.includes(key))
    if (allocated !== expected || outsideRestriction) {
      issues.push(createOnboardingIssue('trainer.milestone-allocation-invalid', decision('trainer.milestones'), `The Level ${milestone.level} option grants ${expected} immediate point(s) restricted to ${restrictedKeys.join('/')}.`, { detail: { level: milestone.level } }))
    }
  }
  for (const choice of build.milestoneChoices) {
    if (!milestones.some(milestone => milestone.level === choice.level)) {
      issues.push(createOnboardingIssue('trainer.milestone-choice-invalid', decision('trainer.milestones'), `Level ${choice.level} has no milestone at your starting level.`, { detail: { level: choice.level } }))
    }
  }

  /* Background */
  const background = build.background
  const mechanics = catalog.trainer.background
  if (!background) {
    issues.push(createOnboardingIssue('trainer.background-missing', decision('trainer.background'), 'Create your skill background before continuing.'))
  } else {
    if (
      background.adept.length !== mechanics.adeptPicks
      || background.novice.length !== mechanics.novicePicks
      || background.pathetic.length !== mechanics.patheticPicks
    ) {
      issues.push(createOnboardingIssue('trainer.background-composition-invalid', decision('trainer.background'), `Pick exactly ${mechanics.adeptPicks} Adept, ${mechanics.novicePicks} Novice, and ${mechanics.patheticPicks} Pathetic skills.`))
    }
    if (mechanics.distinctSkillsRequired) {
      const all = [...background.adept, ...background.novice, ...background.pathetic]
      if (new Set(all).size !== all.length) {
        issues.push(createOnboardingIssue('trainer.background-skill-overlap', decision('trainer.background'), 'Each background pick must name a different skill.'))
      }
    }
  }

  /* Skill ranks and caps */
  const skillRows = computeOnboardingSkillRanks(build)
  const capRow = [...catalog.trainer.skillRankMaximums]
    .filter(entry => entry.level <= level)
    .sort((left, right) => right.level - left.level)[0]
  if (capRow) {
    const capValue = RANK_NAME_TO_VALUE[capRow.rank] ?? ONBOARDING_SKILL_RANK_VALUES.Master
    const exceptionValue = capRow.backgroundException ? RANK_NAME_TO_VALUE[capRow.backgroundException] ?? capValue : null
    for (const skill of ONBOARDING_TRAINER_SKILLS) {
      const row = skillRows[skill]
      const backgroundAdept = background?.adept.includes(skill) === true
      const allowed = backgroundAdept && exceptionValue !== null ? Math.max(capValue, exceptionValue) : capValue
      if (row.value > allowed) {
        issues.push(createOnboardingIssue('trainer.skill-rank-cap-exceeded', decision('trainer.skills'), `${skill} is ${row.rank}, above the Level ${level} cap of ${capRow.rank}${capRow.backgroundException ? ` (background may reach ${capRow.backgroundException})` : ''}.`, { detail: { skill } }))
      }
    }
  }
  if (background && mechanics.patheticFloorLockedDuringCreation) {
    for (const skill of background.pathetic) {
      if (skillRows[skill].value > ONBOARDING_SKILL_RANK_VALUES.Pathetic) {
        issues.push(createOnboardingIssue('trainer.pathetic-skill-raised', decision('trainer.background'), `${skill} was lowered to Pathetic by your background and cannot be raised during creation.`, { detail: { skill } }))
      }
    }
  }

  /* Prerequisite context (final-state, set-based) */
  const skillRankByKey: Record<string, number> = {}
  for (const skill of ONBOARDING_TRAINER_SKILLS) skillRankByKey[skill] = skillRows[skill].value
  const selectedFeatureIds = new Set(build.features.map(feature => feature.canonicalId))
  if (build.trainingFeatureId) selectedFeatureIds.add(build.trainingFeatureId)
  const selectedEdgeKeys = new Set(build.edges.map(edge => canonicalEdgeKey('trainer', edge.canonicalId)))
  const featureClassCounts: Record<string, number> = {}
  for (const feature of build.features) {
    const record = catalog.features.get(feature.canonicalId)
    if (record?.className) {
      featureClassCounts[record.className] = (featureClassCounts[record.className] ?? 0) + 1
    }
  }
  const featureContext: FeaturePrerequisiteContext = {
    level,
    skillRanks: skillRankByKey,
    featureIds: selectedFeatureIds,
    edgeIds: new Set(build.edges.map(edge => edge.canonicalId)),
    featureClassCounts,
  }

  /* Training Feature */
  if (!build.trainingFeatureId) {
    issues.push(createOnboardingIssue('trainer.training-feature-missing', decision('trainer.training-feature'), 'Pick your free Training Feature.'))
  } else if (!catalog.trainer.entitlements.freeTrainingFeatureIds.includes(build.trainingFeatureId)) {
    issues.push(createOnboardingIssue('trainer.training-feature-invalid', decision('trainer.training-feature'), `${build.trainingFeatureId} is not one of the four Training Features.`))
  } else {
    const verdict = judgeFeaturePrerequisite(build.trainingFeatureId, featureContext)
    if (verdict.kind === 'unmet') {
      issues.push(createOnboardingIssue('trainer.training-prerequisite-unmet', decision('trainer.training-feature'), `${build.trainingFeatureId} requires: ${verdict.unmetLabels.join('; ')}.`))
    } else if (verdict.kind === 'needs-clause') {
      issues.push(createOnboardingIssue('trainer.feature-requires-reviewed-clause', decision('trainer.training-feature'), `${build.trainingFeatureId} has a prerequisite recorded for GM review.`, { resolution: { kind: 'gm-review', label: 'Confirm during review' } }))
    }
  }

  /* Features */
  const paidSlots = catalog.trainer.paidFeatureSlots(level)
  if (build.features.length > paidSlots) {
    issues.push(createOnboardingIssue('trainer.feature-slots-exceeded', decision('trainer.features'), `You selected ${build.features.length} Features but have ${paidSlots} slots.`, { detail: { selected: build.features.length, slots: paidSlots } }))
  } else if (build.features.length < paidSlots) {
    issues.push(createOnboardingIssue('trainer.feature-slots-unspent', decision('trainer.features'), `You have ${paidSlots - build.features.length} Feature slot(s) left to choose.`, { detail: { selected: build.features.length, slots: paidSlots } }))
  }

  const seenFeatures = new Set<string>()
  for (const feature of build.features) {
    const featureDecision = decision('trainer.features')
    const record = catalog.features.get(feature.canonicalId)
    if (!record) {
      issues.push(createOnboardingIssue('trainer.feature-unknown', featureDecision, `"${feature.canonicalId}" is not a canonical Feature.`))
      continue
    }
    if (seenFeatures.has(feature.canonicalId)) {
      issues.push(createOnboardingIssue('trainer.feature-duplicate', featureDecision, `${feature.canonicalId} is already selected.`))
      continue
    }
    seenFeatures.add(feature.canonicalId)

    if (policy.trainer.featureRestriction.mode === 'allow-list' && !policy.trainer.featureRestriction.canonicalIds.includes(feature.canonicalId)) {
      issues.push(createOnboardingIssue('trainer.feature-restricted-by-policy', featureDecision, `${feature.canonicalId} is not offered in this campaign.`))
    }
    if (policy.trainer.featureRestriction.mode === 'deny-list' && policy.trainer.featureRestriction.canonicalIds.includes(feature.canonicalId)) {
      issues.push(createOnboardingIssue('trainer.feature-restricted-by-policy', featureDecision, `${feature.canonicalId} is excluded in this campaign.`))
    }

    const verdict = judgeFeaturePrerequisite(feature.canonicalId, featureContext)
    if (verdict.kind === 'unmet') {
      issues.push(createOnboardingIssue('trainer.feature-prerequisite-unmet', featureDecision, `${feature.canonicalId} requires: ${verdict.unmetLabels.join('; ')}.`, { detail: { feature: feature.canonicalId } }))
    } else if (verdict.kind === 'needs-clause') {
      issues.push(createOnboardingIssue('trainer.feature-requires-reviewed-clause', featureDecision, `${feature.canonicalId} has a prerequisite recorded for GM review.`, { resolution: { kind: 'gm-review', label: 'Confirm during review' }, detail: { feature: feature.canonicalId } }))
    }
  }

  for (const [className, count] of Object.entries(featureClassCounts)) {
    if (count > catalog.trainer.entitlements.maximumClassFeatures) {
      issues.push(createOnboardingIssue('trainer.class-limit-exceeded', decision('trainer.features'), `${className} has ${count} Features; at most ${catalog.trainer.entitlements.maximumClassFeatures} are permitted.`, { detail: { className } }))
    }
  }

  /* Edges */
  const normalEdges = build.edges.filter(edge => edge.grantLevel === null)
  const bonusEdges = build.edges.filter(edge => edge.grantLevel !== null)
  const edgeSlotCount = catalog.trainer.edgeSlots(level)
  const bonusSlotCount = catalog.trainer.bonusSkillEdgeSlots(level)
  if (normalEdges.length > edgeSlotCount) {
    issues.push(createOnboardingIssue('trainer.edge-slots-exceeded', decision('trainer.edges'), `You selected ${normalEdges.length} Edges but have ${edgeSlotCount} slots.`, { detail: { selected: normalEdges.length, slots: edgeSlotCount } }))
  } else if (normalEdges.length < edgeSlotCount) {
    issues.push(createOnboardingIssue('trainer.edge-slots-unspent', decision('trainer.edges'), `You have ${edgeSlotCount - normalEdges.length} Edge slot(s) left to choose.`, { detail: { selected: normalEdges.length, slots: edgeSlotCount } }))
  }
  if (bonusEdges.length > bonusSlotCount) {
    issues.push(createOnboardingIssue('trainer.edge-slots-exceeded', decision('trainer.edges'), `You used ${bonusEdges.length} bonus Skill Edge slots but have ${bonusSlotCount}.`, { detail: { selected: bonusEdges.length, slots: bonusSlotCount } }))
  } else if (bonusEdges.length < bonusSlotCount) {
    issues.push(createOnboardingIssue('trainer.edge-slots-unspent', decision('trainer.edges'), `You have ${bonusSlotCount - bonusEdges.length} bonus Skill Edge slot(s) (Levels 2/6/12) left to choose.`, { detail: { selected: bonusEdges.length, slots: bonusSlotCount } }))
  }

  const seenEdgeSignatures = new Set<string>()
  for (const edge of build.edges) {
    const edgeDecision = decision('trainer.edges')
    const record = catalog.edges.get(edge.canonicalId)
    if (!record) {
      issues.push(createOnboardingIssue('trainer.edge-unknown', edgeDecision, `"${edge.canonicalId}" is not a canonical Edge.`))
      continue
    }

    const signature = `${edge.canonicalId}::${JSON.stringify(edge.choices)}`
    if (seenEdgeSignatures.has(signature)) {
      issues.push(createOnboardingIssue('trainer.edge-duplicate', edgeDecision, `${edge.canonicalId} with the same choices is already selected.`))
      continue
    }
    if (!record.isSkillEdge && build.edges.filter(candidate => candidate.canonicalId === edge.canonicalId).length > 1) {
      issues.push(createOnboardingIssue('trainer.edge-duplicate', edgeDecision, `${edge.canonicalId} cannot be taken more than once.`))
    }
    seenEdgeSignatures.add(signature)

    if (edge.grantLevel !== null) {
      if (!record.isSkillEdge) {
        issues.push(createOnboardingIssue('trainer.bonus-skill-edge-invalid', edgeDecision, `${edge.canonicalId} is not a Skill Edge and cannot use a bonus slot.`))
      }
      if (!catalog.trainer.entitlements.bonusSkillEdgeLevels.includes(edge.grantLevel) || edge.grantLevel > level) {
        issues.push(createOnboardingIssue('trainer.bonus-skill-edge-invalid', edgeDecision, `Bonus slot level ${edge.grantLevel} is not available at Level ${level}.`))
      }
    }

    if (policy.trainer.edgeRestriction.mode === 'allow-list' && !policy.trainer.edgeRestriction.canonicalIds.includes(edge.canonicalId)) {
      issues.push(createOnboardingIssue('trainer.edge-restricted-by-policy', edgeDecision, `${edge.canonicalId} is not offered in this campaign.`))
    }
    if (policy.trainer.edgeRestriction.mode === 'deny-list' && policy.trainer.edgeRestriction.canonicalIds.includes(edge.canonicalId)) {
      issues.push(createOnboardingIssue('trainer.edge-restricted-by-policy', edgeDecision, `${edge.canonicalId} is excluded in this campaign.`))
    }

    /* Rank edge subchoices */
    if (ONBOARDING_RANK_EDGE_SEMANTICS[edge.canonicalId] && !edge.choices.skill) {
      issues.push(createOnboardingIssue('trainer.edge-subchoice-missing', edgeDecision, `${edge.canonicalId} needs a skill choice.`))
    }
    if (edge.choices.skill && !(ONBOARDING_TRAINER_SKILLS as readonly string[]).includes(edge.choices.skill)) {
      issues.push(createOnboardingIssue('trainer.edge-subchoice-missing', edgeDecision, `"${edge.choices.skill}" is not a canonical skill.`))
    }

    /* Prerequisites via canonical expressions. */
    if (EDGE_PREREQUISITE_BY_KEY.has(canonicalEdgeKey('trainer', edge.canonicalId))) {
      const evaluation = evaluateEdgePrerequisite('trainer', edge.canonicalId, {
        level,
        skillRanks: skillRankByKey,
        effectiveEdgeKeys: selectedEdgeKeys,
      })
      if (!evaluation.eligible) {
        issues.push(createOnboardingIssue('trainer.edge-prerequisite-unmet', edgeDecision, `${edge.canonicalId} requires: ${evaluation.unmet.join('; ')}.`, { detail: { edge: edge.canonicalId } }))
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Pokémon validation                                                 */
/* ------------------------------------------------------------------ */

const validatePokemonBuild = (
  build: OnboardingPokemonBuildV1,
  index: number,
  policy: CampaignOnboardingPolicyContentV1,
  catalog: OnboardingCreationCatalog,
  issues: OnboardingValidationIssue[],
): void => {
  const level = policy.pokemon.starterLevel
  const decisionFor = (suffix: string): OnboardingDecisionId => decision(`pokemon.${index + 1}.${suffix}`)

  if (!build.speciesId) {
    issues.push(createOnboardingIssue('pokemon.species-missing', decisionFor('species'), 'Choose a species for this starter.'))
    return
  }
  const species = catalog.species.get(build.speciesId)
  if (!species) {
    issues.push(createOnboardingIssue('pokemon.species-unknown', decisionFor('species'), `"${build.speciesId}" is not a canonical Pokédex entry.`))
    return
  }
  if (!species.eligible) {
    issues.push(createOnboardingIssue('pokemon.species-data-incomplete', decisionFor('species'), `${species.speciesId} has incomplete canonical data (${species.ineligibleReasons.join(', ')}) and cannot be offered.`, { resolution: { kind: 'policy-repair', label: 'Choose another species or repair the canonical row' } }))
    return
  }

  const pool = policy.pokemon.starterPool
  if (pool.mode === 'curated-list' && !pool.speciesIds.includes(species.speciesId)) {
    issues.push(createOnboardingIssue('pokemon.species-not-in-pool', decisionFor('species'), `${species.speciesId} is not in this campaign's starter pool.`))
  }
  if (policy.pokemon.stageRestriction === 'first-stage-only' && species.stage !== 1) {
    issues.push(createOnboardingIssue('pokemon.stage-restricted', decisionFor('species'), `${species.speciesId} is not a first-stage species.`))
  }

  /* Nature */
  if (!build.natureId) {
    issues.push(createOnboardingIssue('pokemon.nature-missing', decisionFor('nature'), 'Choose a nature.'))
  } else if (!catalog.natures.has(build.natureId)) {
    issues.push(createOnboardingIssue('pokemon.nature-unknown', decisionFor('nature'), `"${build.natureId}" is not on the canonical nature chart.`))
  }

  /* Gender */
  if (species.genderless) {
    if (build.gender !== null) {
      issues.push(createOnboardingIssue('pokemon.gender-not-applicable', decisionFor('gender'), `${species.speciesId} is genderless.`))
    }
  } else if (build.gender === null) {
    issues.push(createOnboardingIssue('pokemon.gender-required', decisionFor('gender'), 'Choose Male or Female.'))
  } else if (build.gender === 'Male' && (species.malePct ?? 0) <= 0) {
    issues.push(createOnboardingIssue('pokemon.gender-ratio-violated', decisionFor('gender'), `${species.speciesId} cannot be Male.`))
  } else if (build.gender === 'Female' && species.malePct !== null && species.malePct >= 100) {
    issues.push(createOnboardingIssue('pokemon.gender-ratio-violated', decisionFor('gender'), `${species.speciesId} cannot be Female.`))
  }

  /* Abilities */
  const ordinals = catalog.pokemon.abilityOrdinalsForLevel(level)
  if (build.abilityIds.length !== ordinals.length) {
    issues.push(createOnboardingIssue('pokemon.ability-count-invalid', decisionFor('ability'), `Level ${level} grants ${ordinals.length} Ability choice(s); you selected ${build.abilityIds.length}.`))
  }
  const seenAbilities = new Set<string>()
  build.abilityIds.forEach((abilityId, ordinalIndex) => {
    if (seenAbilities.has(abilityId)) {
      issues.push(createOnboardingIssue('pokemon.ability-illegal', decisionFor('ability'), `${abilityId} is already selected.`))
      return
    }
    seenAbilities.add(abilityId)
    const ordinal = ordinals[ordinalIndex]
    if (!ordinal) return
    const permitted = new Set<string>()
    for (const tier of ordinal.tiers) {
      const tierList = tier === 'basic' ? species.basicAbilities : tier === 'advanced' ? species.advancedAbilities : species.highAbilities
      for (const ability of tierList) permitted.add(ability)
    }
    if (!permitted.has(abilityId)) {
      issues.push(createOnboardingIssue('pokemon.ability-illegal', decisionFor('ability'), `${abilityId} is not a legal ${ordinal.tiers.join('/')} Ability for ${species.speciesId}.`))
    } else if (!catalog.abilities.has(abilityId)) {
      issues.push(createOnboardingIssue('pokemon.ability-illegal', decisionFor('ability'), `${abilityId} has no canonical Ability entry.`))
    }
  })
  if (build.abilityIds.length === 0 && ordinals.length > 0) {
    issues.push(createOnboardingIssue('pokemon.ability-missing', decisionFor('ability'), 'Choose an Ability.'))
  }

  /* Moves */
  const available = species.levelUpMoves.filter(move => move.level <= level)
  const availableNames = new Set(available.map(move => move.name))
  const required = Math.min(available.length, catalog.pokemon.activeMoveMaximum)
  const seenMoves = new Set<string>()
  for (const moveId of build.moveIds) {
    if (seenMoves.has(moveId)) {
      issues.push(createOnboardingIssue('pokemon.move-duplicate', decisionFor('moves'), `${moveId} is already selected.`))
      continue
    }
    seenMoves.add(moveId)
    if (!catalog.moves.has(moveId)) {
      issues.push(createOnboardingIssue('pokemon.move-unknown', decisionFor('moves'), `"${moveId}" is not a canonical Move.`))
      continue
    }
    if (!availableNames.has(moveId)) {
      issues.push(createOnboardingIssue('pokemon.move-illegal', decisionFor('moves'), `${species.speciesId} does not learn ${moveId} by Level ${level}.`))
    }
  }
  if (build.moveIds.length > catalog.pokemon.activeMoveMaximum) {
    issues.push(createOnboardingIssue('pokemon.move-limit-exceeded', decisionFor('moves'), `At most ${catalog.pokemon.activeMoveMaximum} active Moves.`))
  } else if (build.moveIds.length < required) {
    issues.push(createOnboardingIssue('pokemon.moves-incomplete', decisionFor('moves'), `Select ${required} Move(s); ${available.length} are available by Level ${level}.`, { detail: { required, available: available.length } }))
  }

  /* Added stats and Base Relations */
  const budget = catalog.pokemon.addedStatBudget(level)
  const spent = ONBOARDING_STAT_KEYS.reduce((sum, key) => sum + build.addedStats[key], 0)
  if (spent > budget) {
    issues.push(createOnboardingIssue('pokemon.added-budget-overspent', decisionFor('stats'), `You allocated ${spent} of ${budget} added points; remove ${spent - budget}.`, { detail: { spent, budget } }))
  } else if (spent < budget) {
    issues.push(createOnboardingIssue('pokemon.added-budget-unspent', decisionFor('stats'), `You still have ${budget - spent} added points to allocate.`, { detail: { spent, budget } }))
  }

  if (species.baseStats && build.natureId && catalog.natures.has(build.natureId)) {
    const nature = catalog.natures.get(build.natureId)!
    const rows = ONBOARDING_STAT_KEYS.map((key) => {
      const speciesBase = species.baseStats![key]
      const delta = speciesBase <= 0
        ? 0
        : Math.max(1, speciesBase + (nature.plus === key ? (key === 'hp' ? 1 : 2) : 0) - (nature.minus === key ? (key === 'hp' ? 1 : 2) : 0)) - speciesBase
      const adjusted = speciesBase + delta
      return { key, adjusted, total: adjusted + build.addedStats[key] }
    })
    for (const left of rows) {
      for (const right of rows) {
        if (left.adjusted > right.adjusted && left.total <= right.total) {
          issues.push(createOnboardingIssue('pokemon.base-relations-violated', decisionFor('stats'), `${left.key} (base ${left.adjusted}) must stay above ${right.key} (base ${right.adjusted}); currently ${left.total} vs ${right.total}.`, { detail: { higher: left.key, lower: right.key } }))
        }
      }
    }
  }

  /* Held item */
  if (build.heldItemId !== null) {
    if (!catalog.items.has(build.heldItemId)) {
      issues.push(createOnboardingIssue('pokemon.held-item-unknown', decisionFor('held-item'), `"${build.heldItemId}" is not a canonical item.`))
    } else if (!policy.packages.starterHeldItems.some(grant => grant.itemId === build.heldItemId)) {
      issues.push(createOnboardingIssue('pokemon.held-item-not-permitted', decisionFor('held-item'), 'This campaign does not grant that starter held item.'))
    }
  }

  /* Caught ball */
  if (policy.pokemon.caughtBallPolicy === 'player-choice') {
    if (build.caughtBallId !== null && !catalog.items.has(build.caughtBallId)) {
      issues.push(createOnboardingIssue('pokemon.held-item-unknown', decisionFor('caught-ball'), `"${build.caughtBallId}" is not a canonical item.`))
    }
  } else if (build.caughtBallId !== null) {
    issues.push(createOnboardingIssue('pokemon.held-item-not-permitted', decisionFor('caught-ball'), 'Ball metadata is fixed by campaign policy.'))
  }
}

/* ------------------------------------------------------------------ */
/* Package validation                                                 */
/* ------------------------------------------------------------------ */

export interface ValidateOnboardingPackageOptions {
  /** Fingerprint the draft was built against; mismatch blocks submission. */
  readonly draftCatalogFingerprint?: string
  readonly profileBound?: boolean
}

export const validateOnboardingPackage = (
  pkg: OnboardingPackageForValidation,
  policy: CampaignOnboardingPolicyContentV1,
  catalog: OnboardingCreationCatalog,
  options: ValidateOnboardingPackageOptions = {},
): OnboardingValidationSummary => {
  const issues: OnboardingValidationIssue[] = []

  if (options.draftCatalogFingerprint !== undefined && options.draftCatalogFingerprint !== catalog.catalogFingerprint) {
    issues.push(createOnboardingIssue('draft.catalog-drift', decision('package.review'), 'Canonical data changed since this draft was created. Reload to re-authorize your choices.', { resolution: { kind: 'gm-review', label: 'Reload and re-validate' } }))
  }
  if (options.profileBound === false) {
    issues.push(createOnboardingIssue('package.profile-unbound', decision('package.review'), 'This slot has no bound player profile.', { resolution: { kind: 'gm-review', label: 'GM must rebind the slot' } }))
  }

  validateTrainerBuild(pkg.trainerBuild, policy, catalog, issues)

  if (pkg.pokemonBuilds.length !== policy.pokemon.starterCount) {
    issues.push(createOnboardingIssue('pokemon.species-missing', decision('pokemon.team'), `This campaign starts with ${policy.pokemon.starterCount} starter(s); the draft has ${pkg.pokemonBuilds.length}.`))
  }
  pkg.pokemonBuilds.forEach((build, index) => validatePokemonBuild(build, index, policy, catalog, issues))

  /* Team slots across builds */
  const slotOwners = new Map<number, string>()
  for (const build of pkg.pokemonBuilds) {
    if (build.teamSlot === null) continue
    const existing = slotOwners.get(build.teamSlot)
    if (existing) {
      issues.push(createOnboardingIssue('pokemon.team-slot-conflict', decision('pokemon.team'), `Two starters occupy team slot ${build.teamSlot}.`))
    } else {
      slotOwners.set(build.teamSlot, build.buildId)
    }
  }

  /* Policy packages resolve canonically */
  for (const grant of policy.packages.trainerItems) {
    if (!catalog.items.has(grant.itemId)) {
      issues.push(createOnboardingIssue('package.item-unknown', decision('package.trainer-items'), `Package item "${grant.itemId}" has no canonical identity.`, { resolution: { kind: 'policy-repair', label: 'Repair the policy package' } }))
    }
  }
  for (const grant of policy.packages.starterHeldItems) {
    if (!catalog.items.has(grant.itemId)) {
      issues.push(createOnboardingIssue('package.item-unknown', decision('package.starter-held-items'), `Package item "${grant.itemId}" has no canonical identity.`, { resolution: { kind: 'policy-repair', label: 'Repair the policy package' } }))
    }
  }

  /* Deferred decisions */
  for (const deferred of pkg.deferredDecisions) {
    if (
      policy.workflow.unresolvedChoicePolicy !== 'allow-optional-deferral'
      || !policy.workflow.deferrableDecisions.includes(deferred)
    ) {
      issues.push(createOnboardingIssue('workflow.deferral-not-permitted', deferred, 'This decision must be resolved before submission.'))
    } else {
      issues.push(createOnboardingIssue('workflow.deferred-optional-decision', deferred, 'Deferred; it will appear as a follow-up after completion.'))
    }
  }

  return summarizeOnboardingIssues(issues)
}
