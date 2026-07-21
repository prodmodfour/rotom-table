import {
  ABILITY_CONTEST_TIE_POLICIES,
  parseAbilityCheckDefinition,
  type AbilityCheckAttempt,
  type AbilityCheckDefinition,
  type AbilityCheckResolution,
  type AbilityContestResolution,
  type AbilityContestTiePolicy,
} from '#shared/abilityAutomation/checks'
import type { AuthoritativeAbilityRandom } from './random'
import type { AbilityExecutionBudget } from './executionBudget'

export type AbilityCheckResolutionErrorCode =
  | 'invalid-resolution-id'
  | 'invalid-reroll-choice'
  | 'reroll-limit-exceeded'
  | 'reroll-trigger-not-met'
  | 'invalid-contest'

export class AbilityCheckResolutionError extends Error {
  constructor(readonly code: AbilityCheckResolutionErrorCode, detail: string) {
    super(detail)
    this.name = 'AbilityCheckResolutionError'
  }
}

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const fail = (code: AbilityCheckResolutionErrorCode, detail: string): never => {
  throw new AbilityCheckResolutionError(code, detail)
}
const successFor = (definition: AbilityCheckDefinition, value: number): boolean | null => {
  if (definition.threshold === null) return null
  return definition.threshold.comparison === 'at-least'
    ? value >= definition.threshold.value
    : value <= definition.threshold.value
}
const triggerMatches = (
  trigger: AbilityCheckDefinition['reroll']['trigger'],
  success: boolean | null,
): boolean => trigger === 'always'
  || (trigger === 'on-success' && success === true)
  || (trigger === 'on-failure' && success === false)

export const resolveAuthoritativeAbilityCheck = (input: {
  readonly resolutionId: string
  readonly definition: unknown
  readonly selectedRerollSourceIds: readonly string[]
  readonly random: AuthoritativeAbilityRandom
  readonly budget: AbilityExecutionBudget
}): AbilityCheckResolution => {
  if (typeof input.resolutionId !== 'string' || !STABLE_ID_PATTERN.test(input.resolutionId)) {
    fail('invalid-resolution-id', 'Ability check resolution ID must be stable.')
  }
  const definition = parseAbilityCheckDefinition(input.definition)
  if (!Array.isArray(input.selectedRerollSourceIds)
    || input.selectedRerollSourceIds.length > definition.reroll.maximumRerolls) {
    fail('reroll-limit-exceeded', 'Selected rerolls exceed the reviewed maximum.')
  }
  const sourceById = new Map(definition.reroll.sources.map(source => [source.id, source]))
  const uses = new Map<string, number>()
  for (const sourceId of input.selectedRerollSourceIds) {
    const source = sourceById.get(sourceId)
      ?? fail('invalid-reroll-choice', `Reroll source ${sourceId} was not reviewed for this check.`)
    const next = (uses.get(sourceId) ?? 0) + 1
    if (next > source.maximumUses) {
      fail('reroll-limit-exceeded', `Reroll source ${sourceId} exceeded its reviewed uses.`)
    }
    uses.set(sourceId, next)
  }
  const attempts: AbilityCheckAttempt[] = []
  let selectedIndex = 0
  const rollAttempt = (rerollSourceId: string | null, parentRollId: string | null): AbilityCheckAttempt => {
    const attempt = attempts.length + 1
    const rollId = `${input.resolutionId}.${definition.checkId}.attempt-${attempt}`
    input.budget.consumeRolls(1)
    const roll = input.random.roll({
      rollId,
      parentEffectId: definition.parentEffectId,
      reason: rerollSourceId === null
        ? `Ability ${definition.checkKind} ${definition.checkId}`
        : `Ability ${definition.checkKind} ${definition.checkId} reroll ${rerollSourceId}`,
      formula: definition.formula,
      modifiers: definition.modifiers,
    })
    return Object.freeze({
      attempt,
      rollId,
      parentRollId,
      rerollSourceId,
      naturalResults: roll.naturalResults,
      naturalResult: roll.naturalResult,
      modifiedResult: roll.modifiedResult,
      finalValue: roll.finalValue,
      success: successFor(definition, roll.finalValue),
    })
  }
  attempts.push(rollAttempt(null, null))
  for (const sourceId of input.selectedRerollSourceIds) {
    const current = attempts[selectedIndex]!
    if (!triggerMatches(definition.reroll.trigger, current.success)) {
      fail('reroll-trigger-not-met', `Reroll source ${sourceId} is not legal for the selected outcome.`)
    }
    const reroll = rollAttempt(sourceId, current.rollId)
    attempts.push(reroll)
    const rerollIndex = attempts.length - 1
    if (definition.reroll.selection === 'replace') selectedIndex = rerollIndex
    else if (definition.reroll.selection === 'highest'
      && reroll.finalValue > attempts[selectedIndex]!.finalValue) selectedIndex = rerollIndex
    else if (definition.reroll.selection === 'lowest'
      && reroll.finalValue < attempts[selectedIndex]!.finalValue) selectedIndex = rerollIndex
  }
  const selected = attempts[selectedIndex]!
  return Object.freeze({
    schemaVersion: 1,
    resolutionId: input.resolutionId,
    checkId: definition.checkId,
    checkKind: definition.checkKind,
    attempts: Object.freeze(attempts),
    selectedAttempt: selected.attempt,
    finalValue: selected.finalValue,
    success: selected.success,
  })
}

export const resolveAuthoritativeAbilityContest = (input: {
  readonly contestId: string
  readonly initiator: {
    readonly resolutionId: string
    readonly definition: unknown
    readonly selectedRerollSourceIds: readonly string[]
  }
  readonly defender: {
    readonly resolutionId: string
    readonly definition: unknown
    readonly selectedRerollSourceIds: readonly string[]
  }
  readonly tiePolicy: AbilityContestTiePolicy
  readonly random: AuthoritativeAbilityRandom
  readonly budget: AbilityExecutionBudget
}): AbilityContestResolution => {
  if (!STABLE_ID_PATTERN.test(input.contestId)
    || !ABILITY_CONTEST_TIE_POLICIES.includes(input.tiePolicy)) {
    fail('invalid-contest', 'Ability contest identity or tie policy is invalid.')
  }
  const initiatorDefinition = parseAbilityCheckDefinition(input.initiator.definition)
  const defenderDefinition = parseAbilityCheckDefinition(input.defender.definition)
  if (initiatorDefinition.checkKind !== 'contest' || defenderDefinition.checkKind !== 'contest'
    || initiatorDefinition.checkId === defenderDefinition.checkId) {
    fail('invalid-contest', 'Ability contests require two distinct total-only contest checks.')
  }
  const initiator = resolveAuthoritativeAbilityCheck({
    ...input.initiator,
    definition: initiatorDefinition,
    random: input.random,
    budget: input.budget,
  })
  const defender = resolveAuthoritativeAbilityCheck({
    ...input.defender,
    definition: defenderDefinition,
    random: input.random,
    budget: input.budget,
  })
  const winner = initiator.finalValue > defender.finalValue
    ? 'initiator'
    : defender.finalValue > initiator.finalValue
      ? 'defender'
      : input.tiePolicy === 'no-winner'
        ? null
        : input.tiePolicy
  return Object.freeze({
    schemaVersion: 1,
    contestId: input.contestId,
    initiator,
    defender,
    tiePolicy: input.tiePolicy,
    winner,
  })
}
