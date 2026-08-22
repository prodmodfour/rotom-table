/**
 * Guided builder decision state machine (P9-031).
 *
 * Computes the ordered list of guided decisions for a draft under its policy
 * and the catalog: which exist (structural not-applicable exclusions are
 * derived, never hidden UI), which are complete, and which currently block
 * submission. The same computation runs client- and server-side.
 */

import type { OnboardingCreationCatalog } from './catalog'
import type { CampaignOnboardingPolicyContentV1 } from './policy'
import type { OnboardingDraftV1, OnboardingPokemonBuildV1 } from './draft'
import { ONBOARDING_STAT_KEYS } from './draft'
import { parseOnboardingDecisionId, type OnboardingDecisionId } from './ids'
import type { OnboardingValidationSummary } from './validation'

export type OnboardingDecisionStatus = 'complete' | 'incomplete' | 'attention' | 'not-applicable'

export interface OnboardingDecisionNode {
  readonly decisionId: OnboardingDecisionId
  readonly area: 'trainer' | 'pokemon' | 'package'
  readonly title: string
  readonly summary: string
  readonly status: OnboardingDecisionStatus
  /** Issue count from the latest validation summary scoped to this decision. */
  readonly blockingCount: number
  readonly warningCount: number
}

const decision = (id: string): OnboardingDecisionId => parseOnboardingDecisionId(id)

const statSpent = (allocation: Readonly<Record<string, number>>): number =>
  ONBOARDING_STAT_KEYS.reduce((sum, key) => sum + (allocation[key] ?? 0), 0)

const pokemonDecisionNodes = (
  build: OnboardingPokemonBuildV1,
  index: number,
  policy: CampaignOnboardingPolicyContentV1,
  catalog: OnboardingCreationCatalog,
): OnboardingDecisionNode[] => {
  const prefix = `pokemon.${index + 1}`
  const species = build.speciesId ? catalog.species.get(build.speciesId) ?? null : null
  const level = policy.pokemon.starterLevel
  const nodes: OnboardingDecisionNode[] = []

  nodes.push({
    decisionId: decision(`${prefix}.species`),
    area: 'pokemon',
    title: `Starter ${index + 1}: species`,
    summary: species ? species.speciesId : 'Choose a species',
    status: species ? 'complete' : 'incomplete',
    blockingCount: 0,
    warningCount: 0,
  })

  const genderless = species?.genderless === true
  nodes.push({
    decisionId: decision(`${prefix}.identity`),
    area: 'pokemon',
    title: `Starter ${index + 1}: nature & identity`,
    summary: [
      build.natureId ?? 'nature?',
      genderless ? 'genderless' : (build.gender ?? 'gender?'),
      build.nickname ? `“${build.nickname}”` : null,
    ].filter(Boolean).join(' · '),
    status: !species
      ? 'incomplete'
      : (build.natureId !== null && (genderless ? build.gender === null : build.gender !== null))
          ? 'complete'
          : 'incomplete',
    blockingCount: 0,
    warningCount: 0,
  })

  const ordinals = catalog.pokemon.abilityOrdinalsForLevel(level)
  nodes.push({
    decisionId: decision(`${prefix}.ability`),
    area: 'pokemon',
    title: `Starter ${index + 1}: ability`,
    summary: build.abilityIds.length > 0 ? build.abilityIds.join(', ') : `Choose ${ordinals.length}`,
    status: !species ? 'incomplete' : build.abilityIds.length === ordinals.length ? 'complete' : 'incomplete',
    blockingCount: 0,
    warningCount: 0,
  })

  const available = species ? species.levelUpMoves.filter(move => move.level <= level).length : 0
  const requiredMoves = Math.min(available, catalog.pokemon.activeMoveMaximum)
  nodes.push({
    decisionId: decision(`${prefix}.moves`),
    area: 'pokemon',
    title: `Starter ${index + 1}: moves`,
    summary: species ? `${build.moveIds.length}/${requiredMoves} chosen` : 'Choose moves',
    status: !species ? 'incomplete' : build.moveIds.length === requiredMoves ? 'complete' : 'incomplete',
    blockingCount: 0,
    warningCount: 0,
  })

  const budget = catalog.pokemon.addedStatBudget(level)
  const spent = statSpent(build.addedStats)
  nodes.push({
    decisionId: decision(`${prefix}.stats`),
    area: 'pokemon',
    title: `Starter ${index + 1}: stat points`,
    summary: `${spent}/${budget} allocated`,
    status: !species ? 'incomplete' : spent === budget ? 'complete' : 'incomplete',
    blockingCount: 0,
    warningCount: 0,
  })

  if (policy.packages.starterHeldItems.length > 0) {
    nodes.push({
      decisionId: decision(`${prefix}.held-item`),
      area: 'pokemon',
      title: `Starter ${index + 1}: held item`,
      summary: build.heldItemId ?? 'Optional held item',
      status: 'complete',
      blockingCount: 0,
      warningCount: 0,
    })
  }

  if (policy.pokemon.caughtBallPolicy === 'player-choice') {
    const deferrable = policy.workflow.deferrableDecisions.includes(decision(`${prefix}.caught-ball`))
    nodes.push({
      decisionId: decision(`${prefix}.caught-ball`),
      area: 'pokemon',
      title: `Starter ${index + 1}: Poké Ball`,
      summary: build.caughtBallId ?? (deferrable ? 'Optional — may defer' : 'Choose a ball'),
      status: build.caughtBallId !== null || deferrable ? 'complete' : 'incomplete',
      blockingCount: 0,
      warningCount: 0,
    })
  }

  return nodes
}

export const computeOnboardingDecisionNodes = (
  draft: OnboardingDraftV1,
  policy: CampaignOnboardingPolicyContentV1,
  catalog: OnboardingCreationCatalog,
  validation?: OnboardingValidationSummary,
): readonly OnboardingDecisionNode[] => {
  const level = policy.trainer.startingLevel
  const build = draft.trainerBuild
  const nodes: OnboardingDecisionNode[] = []

  nodes.push({
    decisionId: decision('trainer.identity'),
    area: 'trainer',
    title: 'Trainer identity',
    summary: build.name ?? 'Name your Trainer',
    status: build.name ? 'complete' : 'incomplete',
    blockingCount: 0,
    warningCount: 0,
  })

  const statBudget = catalog.trainer.statBudget(level)
  const spent = statSpent(build.statAllocation)
  nodes.push({
    decisionId: decision('trainer.stat-allocation'),
    area: 'trainer',
    title: 'Stat points',
    summary: `${spent}/${statBudget} allocated`,
    status: spent === statBudget ? 'complete' : 'incomplete',
    blockingCount: 0,
    warningCount: 0,
  })

  const mechanics = catalog.trainer.background
  const backgroundComplete = build.background !== null
    && build.background.adept.length === mechanics.adeptPicks
    && build.background.novice.length === mechanics.novicePicks
    && build.background.pathetic.length === mechanics.patheticPicks
  nodes.push({
    decisionId: decision('trainer.background'),
    area: 'trainer',
    title: 'Skill background',
    summary: build.background
      ? build.background.name
      : `${mechanics.adeptPicks} Adept · ${mechanics.novicePicks} Novice · ${mechanics.patheticPicks} Pathetic`,
    status: backgroundComplete ? 'complete' : 'incomplete',
    blockingCount: 0,
    warningCount: 0,
  })

  nodes.push({
    decisionId: decision('trainer.training-feature'),
    area: 'trainer',
    title: 'Training Feature',
    summary: build.trainingFeatureId ?? 'Choose your free Training Feature',
    status: build.trainingFeatureId ? 'complete' : 'incomplete',
    blockingCount: 0,
    warningCount: 0,
  })

  const edgeSlots = catalog.trainer.edgeSlots(level)
  const bonusSlots = catalog.trainer.bonusSkillEdgeSlots(level)
  const normalEdges = build.edges.filter(edge => edge.grantLevel === null).length
  const bonusEdges = build.edges.filter(edge => edge.grantLevel !== null).length
  nodes.push({
    decisionId: decision('trainer.edges'),
    area: 'trainer',
    title: 'Edges',
    summary: bonusSlots > 0
      ? `${normalEdges}/${edgeSlots} + ${bonusEdges}/${bonusSlots} skill bonus`
      : `${normalEdges}/${edgeSlots} chosen`,
    status: normalEdges === edgeSlots && bonusEdges === bonusSlots ? 'complete' : 'incomplete',
    blockingCount: 0,
    warningCount: 0,
  })

  const featureSlots = catalog.trainer.paidFeatureSlots(level)
  nodes.push({
    decisionId: decision('trainer.features'),
    area: 'trainer',
    title: 'Features & classes',
    summary: `${build.features.length}/${featureSlots} chosen`,
    status: build.features.length === featureSlots ? 'complete' : 'incomplete',
    blockingCount: 0,
    warningCount: 0,
  })

  const milestones = catalog.trainer.milestonesForLevel(level)
  if (milestones.length > 0 && policy.trainer.milestoneCollection === 'during-onboarding') {
    const resolved = milestones.filter(milestone =>
      build.milestoneChoices.some(choice => choice.level === milestone.level)).length
    nodes.push({
      decisionId: decision('trainer.milestones'),
      area: 'trainer',
      title: 'Milestone choices',
      summary: `${resolved}/${milestones.length} resolved`,
      status: resolved === milestones.length ? 'complete' : 'incomplete',
      blockingCount: 0,
      warningCount: 0,
    })
  }

  draft.pokemonBuilds.forEach((pokemonBuild, index) => {
    nodes.push(...pokemonDecisionNodes(pokemonBuild, index, policy, catalog))
  })

  if (draft.pokemonBuilds.length > 1) {
    const slots = draft.pokemonBuilds.map(pokemonBuild => pokemonBuild.teamSlot)
    const distinct = new Set(slots.filter(slot => slot !== null))
    nodes.push({
      decisionId: decision('pokemon.team'),
      area: 'pokemon',
      title: 'Team order',
      summary: `${distinct.size}/${draft.pokemonBuilds.length} ordered`,
      status: distinct.size === draft.pokemonBuilds.length ? 'complete' : 'incomplete',
      blockingCount: 0,
      warningCount: 0,
    })
  }

  nodes.push({
    decisionId: decision('package.review'),
    area: 'package',
    title: 'Review & submit',
    summary: 'Check everything, then submit for GM review',
    status: 'incomplete',
    blockingCount: 0,
    warningCount: 0,
  })

  if (!validation) return nodes

  /* Attach validation issue counts to their owning decisions. */
  const blockingByDecision = new Map<string, number>()
  const warningByDecision = new Map<string, number>()
  for (const issue of validation.issues) {
    if (issue.severity === 'blocking') {
      blockingByDecision.set(issue.decisionId, (blockingByDecision.get(issue.decisionId) ?? 0) + 1)
    } else if (issue.severity === 'warning' || issue.severity === 'deviation') {
      warningByDecision.set(issue.decisionId, (warningByDecision.get(issue.decisionId) ?? 0) + 1)
    }
  }
  return nodes.map((node) => {
    const blockingCount = blockingByDecision.get(node.decisionId) ?? 0
    const warningCount = warningByDecision.get(node.decisionId) ?? 0
    const status: OnboardingDecisionStatus = node.decisionId === 'package.review'
      ? (validation.submittable ? 'complete' : 'incomplete')
      : blockingCount > 0
          ? 'attention'
          : node.status
    return { ...node, status, blockingCount, warningCount }
  })
}

/** The next decision the builder should focus, honoring an explicit position. */
export const nextOnboardingDecision = (
  nodes: readonly OnboardingDecisionNode[],
  currentDecisionId: OnboardingDecisionId | null,
): OnboardingDecisionId => {
  if (currentDecisionId && nodes.some(node => node.decisionId === currentDecisionId)) {
    return currentDecisionId
  }
  const firstOpen = nodes.find(node => node.status === 'incomplete' || node.status === 'attention')
  return firstOpen?.decisionId ?? nodes[nodes.length - 1]!.decisionId
}
