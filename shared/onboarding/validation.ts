/**
 * Onboarding validation issue and explanation contract (P9-016).
 *
 * Issues use stable codes from a closed registry. Every issue names the
 * affected decision, why it matters, and a safe resolution path. Severity is
 * server-owned: hard rules are `blocking` everywhere and cannot be downgraded
 * by clients (product rule 7). `deviation` marks explicitly reviewable
 * canonical lanes (reviewed-build-clauses, policy deviations) that require GM
 * acknowledgement at review; `warning` marks survivable table variation;
 * `info` is explanatory only.
 */

import type { OnboardingDecisionId } from './ids'

export const ONBOARDING_ISSUE_SEVERITIES = Object.freeze(['blocking', 'deviation', 'warning', 'info'] as const)
export type OnboardingIssueSeverity = typeof ONBOARDING_ISSUE_SEVERITIES[number]

export interface OnboardingIssueDefinition {
  readonly code: string
  readonly severity: OnboardingIssueSeverity
  readonly title: string
  readonly explanation: string
}

/** Closed registry. Adding a code is a reviewed contract change. */
export const ONBOARDING_ISSUE_DEFINITIONS: readonly OnboardingIssueDefinition[] = Object.freeze([
  // Draft/package structure
  { code: 'draft.policy-version-unknown', severity: 'blocking', title: 'Policy version unavailable', explanation: 'The draft references a policy version the server no longer recognizes. The GM must migrate or restart the draft.' },
  { code: 'draft.catalog-drift', severity: 'blocking', title: 'Canonical data changed', explanation: 'The canonical creation catalog changed since this draft was built. Choices must be re-authorized before submission.' },
  { code: 'workflow.deferral-not-permitted', severity: 'blocking', title: 'Decision cannot be deferred', explanation: 'This campaign requires every required decision to be resolved before submission.' },
  { code: 'workflow.deferred-optional-decision', severity: 'warning', title: 'Optional decision deferred', explanation: 'A policy-permitted optional decision is deferred and will appear as a follow-up after completion.' },

  // Trainer identity
  { code: 'trainer.name-missing', severity: 'blocking', title: 'Trainer needs a name', explanation: 'A Trainer cannot be created without a name.' },

  // Trainer stats
  { code: 'trainer.stat-budget-overspent', severity: 'blocking', title: 'Too many stat points', explanation: 'Allocated stat points exceed the canonical budget (Level + 9 discretionary points).' },
  { code: 'trainer.stat-budget-unspent', severity: 'blocking', title: 'Unspent stat points', explanation: 'All creation stat points must be allocated before submission.' },
  { code: 'trainer.milestone-allocation-invalid', severity: 'blocking', title: 'Milestone points misallocated', explanation: 'Milestone stat points must go to the stats the chosen milestone option permits.' },
  { code: 'trainer.milestone-choice-missing', severity: 'blocking', title: 'Milestone choice required', explanation: 'Higher-level starts must resolve each canonical milestone choice.' },
  { code: 'trainer.milestone-choice-invalid', severity: 'blocking', title: 'Milestone choice invalid', explanation: 'The selected milestone option is not one of the canonical options for that level.' },

  // Background and skills
  { code: 'trainer.background-missing', severity: 'blocking', title: 'Background required', explanation: 'Character creation requires a named skill background.' },
  { code: 'trainer.background-composition-invalid', severity: 'blocking', title: 'Background picks are off', explanation: 'A creation background raises exactly one skill to Adept, one to Novice, and lowers three distinct skills to Pathetic.' },
  { code: 'trainer.background-skill-overlap', severity: 'blocking', title: 'Background reuses a skill', explanation: 'Each background pick must name a different skill.' },
  { code: 'trainer.skill-rank-cap-exceeded', severity: 'blocking', title: 'Skill rank above level cap', explanation: 'Skill ranks are capped by level (Novice at Level 1, Adept from Level 2, Expert from 6, Master from 12); only the background may reach Adept at Level 1.' },
  { code: 'trainer.pathetic-skill-raised', severity: 'blocking', title: 'Pathetic skill raised during creation', explanation: 'Skills lowered to Pathetic by the background cannot be raised above Pathetic during character creation.' },

  // Training feature
  { code: 'trainer.training-feature-missing', severity: 'blocking', title: 'Training Feature required', explanation: 'Every new Trainer picks one free Training Feature (Agility, Brutal, Focused, or Inspired Training).' },
  { code: 'trainer.training-feature-invalid', severity: 'blocking', title: 'Not a Training Feature', explanation: 'The free Training choice must be one of the four canonical Training Features.' },
  { code: 'trainer.training-prerequisite-unmet', severity: 'blocking', title: 'Training prerequisite unmet', explanation: 'The chosen Training Feature has canonical prerequisites this build does not satisfy.' },

  // Features / classes
  { code: 'trainer.feature-unknown', severity: 'blocking', title: 'Unknown Feature', explanation: 'A selected Feature does not resolve to canonical reference data.' },
  { code: 'trainer.feature-duplicate', severity: 'blocking', title: 'Feature repeated', explanation: 'The same canonical Feature cannot be taken twice at creation.' },
  { code: 'trainer.feature-slots-exceeded', severity: 'blocking', title: 'Too many Features', explanation: 'The build selects more paid Features than the level entitles.' },
  { code: 'trainer.feature-slots-unspent', severity: 'blocking', title: 'Unspent Feature slots', explanation: 'All entitled Feature slots must be used before submission.' },
  { code: 'trainer.feature-prerequisite-unmet', severity: 'blocking', title: 'Feature prerequisite unmet', explanation: 'A selected Feature has canonical prerequisites this build does not satisfy.' },
  { code: 'trainer.feature-requires-reviewed-clause', severity: 'deviation', title: 'Needs GM confirmation', explanation: 'This option has a canonical prerequisite the automation platform records as a reviewed build clause; the GM must confirm it during review.' },
  { code: 'trainer.feature-restricted-by-policy', severity: 'blocking', title: 'Feature restricted by campaign', explanation: 'The campaign policy does not permit this Feature at creation.' },
  { code: 'trainer.feature-subchoice-missing', severity: 'blocking', title: 'Feature choice incomplete', explanation: 'This Feature requires a subchoice (field, type, skill, or similar) before it is complete.' },
  { code: 'trainer.class-limit-exceeded', severity: 'blocking', title: 'Too many class Features', explanation: 'A class supports at most the canonical number of counted class Features.' },

  // Edges
  { code: 'trainer.edge-unknown', severity: 'blocking', title: 'Unknown Edge', explanation: 'A selected Edge does not resolve to canonical reference data.' },
  { code: 'trainer.edge-duplicate', severity: 'blocking', title: 'Edge repeated illegally', explanation: 'Only Edges that canonically permit repetition may be taken more than once, and repeats must differ in their choices.' },
  { code: 'trainer.edge-slots-exceeded', severity: 'blocking', title: 'Too many Edges', explanation: 'The build selects more Edges than the level entitles.' },
  { code: 'trainer.edge-slots-unspent', severity: 'blocking', title: 'Unspent Edge slots', explanation: 'All entitled Edge slots must be used before submission.' },
  { code: 'trainer.edge-prerequisite-unmet', severity: 'blocking', title: 'Edge prerequisite unmet', explanation: 'A selected Edge has canonical prerequisites this build does not satisfy.' },
  { code: 'trainer.edge-requires-reviewed-clause', severity: 'deviation', title: 'Needs GM confirmation', explanation: 'This Edge has a canonical prerequisite recorded as a reviewed build clause; the GM must confirm it during review.' },
  { code: 'trainer.edge-restricted-by-policy', severity: 'blocking', title: 'Edge restricted by campaign', explanation: 'The campaign policy does not permit this Edge at creation.' },
  { code: 'trainer.bonus-skill-edge-invalid', severity: 'blocking', title: 'Bonus slot needs a Skill Edge', explanation: 'Bonus Edge slots from levels 2/6/12 accept only canonical Skill Edges.' },
  { code: 'trainer.edge-subchoice-missing', severity: 'blocking', title: 'Edge choice incomplete', explanation: 'This Edge requires a subchoice (skill, category, or similar) before it is complete.' },

  // Pokémon
  { code: 'pokemon.species-missing', severity: 'blocking', title: 'Choose a species', explanation: 'Every starter needs a species from the campaign pool.' },
  { code: 'pokemon.species-unknown', severity: 'blocking', title: 'Unknown species', explanation: 'The species does not resolve to a canonical Pokédex row.' },
  { code: 'pokemon.species-not-in-pool', severity: 'blocking', title: 'Species not offered', explanation: 'The campaign starter pool does not include this species.' },
  { code: 'pokemon.species-data-incomplete', severity: 'blocking', title: 'Species data incomplete', explanation: 'The canonical Pokédex row is missing required data (base stats, Basic Abilities, or level-up Moves) and fails closed.' },
  { code: 'pokemon.stage-restricted', severity: 'blocking', title: 'Evolution stage restricted', explanation: 'The campaign restricts starters to first-stage species.' },
  { code: 'pokemon.nature-missing', severity: 'blocking', title: 'Choose a nature', explanation: 'Every starter needs a nature from the canonical chart.' },
  { code: 'pokemon.nature-unknown', severity: 'blocking', title: 'Unknown nature', explanation: 'The nature does not resolve to the canonical nature chart.' },
  { code: 'pokemon.gender-required', severity: 'blocking', title: 'Choose a gender', explanation: 'This species has gender ratios; pick Male or Female.' },
  { code: 'pokemon.gender-not-applicable', severity: 'blocking', title: 'Species is genderless', explanation: 'Genderless species cannot carry a gender choice.' },
  { code: 'pokemon.gender-ratio-violated', severity: 'blocking', title: 'Gender impossible for species', explanation: 'The chosen gender contradicts the species gender ratio (0% side).' },
  { code: 'pokemon.ability-missing', severity: 'blocking', title: 'Choose an Ability', explanation: 'A starter takes exactly one Basic Ability at Level 1.' },
  { code: 'pokemon.ability-illegal', severity: 'blocking', title: 'Ability not legal', explanation: 'The Ability is not in the species tier the level authorizes.' },
  { code: 'pokemon.ability-count-invalid', severity: 'blocking', title: 'Wrong number of Abilities', explanation: 'The level authorizes exactly one Ability ordinal at creation levels below 20.' },
  { code: 'pokemon.move-unknown', severity: 'blocking', title: 'Unknown Move', explanation: 'A Move does not resolve to canonical reference data.' },
  { code: 'pokemon.move-illegal', severity: 'blocking', title: 'Move not learnable', explanation: 'A Move is not on the species level-up list at or below the starting level (and no policy source authorizes it).' },
  { code: 'pokemon.move-duplicate', severity: 'blocking', title: 'Move repeated', explanation: 'The same Move cannot occupy two slots.' },
  { code: 'pokemon.move-limit-exceeded', severity: 'blocking', title: 'Too many active Moves', explanation: 'Pokémon keep at most six active Moves.' },
  { code: 'pokemon.moves-incomplete', severity: 'blocking', title: 'Moves not finished', explanation: 'Starters take every level-up Move available at their level, up to the six-Move limit (choosing which six when more are available).' },
  { code: 'pokemon.added-budget-overspent', severity: 'blocking', title: 'Too many added points', explanation: 'Added stat points exceed the canonical budget (Level + 10).' },
  { code: 'pokemon.added-budget-unspent', severity: 'blocking', title: 'Unspent added points', explanation: 'All added stat points must be allocated before submission.' },
  { code: 'pokemon.base-relations-violated', severity: 'blocking', title: 'Base Relations violated', explanation: 'Added points must preserve the order of nature-adjusted Base Stats: a higher Base Stat must keep a higher Total.' },
  { code: 'pokemon.held-item-unknown', severity: 'blocking', title: 'Unknown held item', explanation: 'The held item does not resolve to canonical item data.' },
  { code: 'pokemon.held-item-not-permitted', severity: 'blocking', title: 'Held item not offered', explanation: 'The campaign policy does not grant starter held items (or not this one).' },
  { code: 'pokemon.team-slot-conflict', severity: 'blocking', title: 'Team order conflict', explanation: 'Two starters occupy the same team slot.' },
  { code: 'pokemon.nickname-invalid', severity: 'blocking', title: 'Nickname unusable', explanation: 'Nicknames are bounded display text.' },

  // Packages
  { code: 'package.item-unknown', severity: 'blocking', title: 'Package item unknown', explanation: 'A policy package references an item with no canonical identity; the policy version must be repaired.' },

  // Cross-package
  { code: 'package.profile-unbound', severity: 'blocking', title: 'No owning player profile', explanation: 'The slot must bind a player profile before submission.' },
  { code: 'package.policy-deviation-review', severity: 'deviation', title: 'Campaign deviation to review', explanation: 'The package includes a policy-permitted deviation the GM should acknowledge during review.' },
] as const)

const ISSUE_DEFINITION_BY_CODE: ReadonlyMap<string, OnboardingIssueDefinition> = new Map(
  ONBOARDING_ISSUE_DEFINITIONS.map(definition => [definition.code, definition]),
)

export const onboardingIssueDefinition = (code: string): OnboardingIssueDefinition => {
  const definition = ISSUE_DEFINITION_BY_CODE.get(code)
  if (!definition) throw new Error(`Unknown onboarding issue code "${code}"`)
  return definition
}

export const isOnboardingIssueCode = (code: string): boolean => ISSUE_DEFINITION_BY_CODE.has(code)

export type OnboardingIssueResolution =
  | { readonly kind: 'edit-decision', readonly decisionId: OnboardingDecisionId }
  | { readonly kind: 'gm-review', readonly label: string }
  | { readonly kind: 'policy-repair', readonly label: string }

export interface OnboardingValidationIssue {
  readonly code: string
  readonly severity: OnboardingIssueSeverity
  readonly decisionId: OnboardingDecisionId
  readonly message: string
  readonly resolution: OnboardingIssueResolution
  /** Bounded structured facts (counts, names); never raw hashes or internals. */
  readonly detail?: Readonly<Record<string, string | number>>
}

export interface OnboardingValidationSummary {
  readonly issues: readonly OnboardingValidationIssue[]
  readonly blockingCount: number
  readonly deviationCount: number
  readonly warningCount: number
  readonly infoCount: number
  readonly submittable: boolean
}

export const createOnboardingIssue = (
  code: string,
  decisionId: OnboardingDecisionId,
  message: string,
  options: {
    resolution?: OnboardingIssueResolution
    detail?: Readonly<Record<string, string | number>>
  } = {},
): OnboardingValidationIssue => {
  const definition = onboardingIssueDefinition(code)
  return {
    code,
    severity: definition.severity,
    decisionId,
    message,
    resolution: options.resolution ?? { kind: 'edit-decision', decisionId },
    ...(options.detail ? { detail: options.detail } : {}),
  }
}

export const summarizeOnboardingIssues = (
  issues: readonly OnboardingValidationIssue[],
): OnboardingValidationSummary => {
  let blockingCount = 0
  let deviationCount = 0
  let warningCount = 0
  let infoCount = 0
  for (const issue of issues) {
    if (issue.severity === 'blocking') blockingCount += 1
    else if (issue.severity === 'deviation') deviationCount += 1
    else if (issue.severity === 'warning') warningCount += 1
    else infoCount += 1
  }
  return {
    issues,
    blockingCount,
    deviationCount,
    warningCount,
    infoCount,
    submittable: blockingCount === 0,
  }
}
