import { describe, expect, it } from 'vitest'
import {
  AbilityCheckValidationError,
  parseAbilityCheckDefinition,
} from '#shared/abilityAutomation/checks'
import {
  AbilityCheckResolutionError,
  resolveAuthoritativeAbilityCheck,
  resolveAuthoritativeAbilityContest,
} from '../../server/domain/abilityAutomation/checks'
import {
  createAuthoritativeAbilityRandom,
  createFiniteAuthoritativeAbilityRandomStream,
} from '../../server/domain/abilityAutomation/random'
import {
  createAbilityExecutionBudget,
  type AbilityExecutionBudgetLimits,
} from '../../server/domain/abilityAutomation/executionBudget'
import { ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY } from '../../server/domain/abilityAutomation/sharedKernelExtensions'

const check = (overrides: Record<string, unknown> = {}) => ({
  kind: 'ability-check',
  checkId: 'save.poison',
  checkKind: 'save',
  parentEffectId: 'operation.poison-save',
  formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
  modifiers: [{ sourceId: 'ability.save-bonus', reason: 'Ability save bonus', value: 2 }],
  threshold: { comparison: 'at-least', value: 11 },
  reroll: {
    trigger: 'on-failure',
    selection: 'highest',
    maximumRerolls: 2,
    sources: [
      { id: 'ability.probability-control', maximumUses: 1 },
      { id: 'item.lucky-charm', maximumUses: 1 },
    ],
  },
  ...overrides,
})
const contest = (checkId: string, modifier = 0) => check({
  checkId,
  checkKind: 'contest',
  parentEffectId: `operation.${checkId}`,
  formula: { kind: 'dice', count: 1, sides: 20, modifier },
  modifiers: [],
  threshold: null,
  reroll: { trigger: 'always', selection: 'replace', maximumRerolls: 0, sources: [] },
})
const resolve = (input: {
  values: readonly number[]
  definition?: unknown
  sources?: readonly string[]
  limits?: Partial<AbilityExecutionBudgetLimits>
}) => {
  const random = createAuthoritativeAbilityRandom(createFiniteAuthoritativeAbilityRandomStream(input.values))
  const result = resolveAuthoritativeAbilityCheck({
    resolutionId: 'resolution.check-one',
    definition: input.definition ?? check(),
    selectedRerollSourceIds: input.sources ?? [],
    random,
    budget: createAbilityExecutionBudget(input.limits ? { limits: input.limits } : {}),
  })
  return { result, ledger: random.complete() }
}

describe('authoritative ability checks, saves, rerolls, and contests', () => {
  it('strictly registers bounded check/save definitions', () => {
    expect(parseAbilityCheckDefinition(check())).toMatchObject({
      checkKind: 'save', threshold: { comparison: 'at-least', value: 11 },
      reroll: { trigger: 'on-failure', selection: 'highest', maximumRerolls: 2 },
    })
    expect(ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY.resolve('operation', 'ability-check'))
      .toMatchObject({ version: 1 })
    expect(() => parseAbilityCheckDefinition({ ...check(), callback: () => true }))
      .toThrowError(AbilityCheckValidationError)
  })

  it('resolves a save from server entropy and retains exact modifiers in the private ledger', () => {
    const { result, ledger } = resolve({ values: [0.45] })
    expect(result).toMatchObject({
      checkKind: 'save', finalValue: 12, success: true, selectedAttempt: 1,
      attempts: [{ naturalResult: 10, modifiedResult: 12, rerollSourceId: null }],
    })
    expect(ledger[0]).toMatchObject({
      rollId: 'resolution.check-one.save.poison.attempt-1',
      parentEffectId: 'operation.poison-save',
      modifiers: [{ sourceId: 'ability.save-bonus', value: 2 }],
    })
    expect(Object.isFrozen(result.attempts)).toBe(true)
  })

  it('applies reviewed failure rerolls with stable parent-roll ancestry and highest selection', () => {
    const { result, ledger } = resolve({
      values: [0.05, 0.9],
      sources: ['ability.probability-control'],
    })
    expect(result).toMatchObject({ finalValue: 21, success: true, selectedAttempt: 2 })
    expect(result.attempts).toEqual([
      expect.objectContaining({
        attempt: 1, rollId: 'resolution.check-one.save.poison.attempt-1',
        parentRollId: null, finalValue: 4, success: false,
      }),
      expect.objectContaining({
        attempt: 2, rollId: 'resolution.check-one.save.poison.attempt-2',
        parentRollId: 'resolution.check-one.save.poison.attempt-1',
        rerollSourceId: 'ability.probability-control', finalValue: 21, success: true,
      }),
    ])
    expect(ledger).toHaveLength(2)
  })

  it('supports replace/lowest policies without normalizing attempt order', () => {
    const definition = check({
      reroll: {
        trigger: 'always', selection: 'lowest', maximumRerolls: 2,
        sources: [{ id: 'source.one', maximumUses: 2 }],
      },
    })
    const { result } = resolve({ values: [0.8, 0.4, 0.6], definition, sources: ['source.one', 'source.one'] })
    expect(result.attempts.map(attempt => attempt.finalValue)).toEqual([19, 11, 15])
    expect(result).toMatchObject({ finalValue: 11, selectedAttempt: 2, success: true })
    expect(result.attempts[2]?.parentRollId).toBe(result.attempts[1]?.rollId)
  })

  it('rejects unreviewed/excess sources and rerolls whose trigger is not met', () => {
    expect(() => resolve({ values: [0], sources: ['source.unreviewed'] }))
      .toThrowError(AbilityCheckResolutionError)
    expect(() => resolve({
      values: [0, 0.5],
      sources: ['ability.probability-control', 'ability.probability-control'],
    })).toThrowError(/exceeded its reviewed uses/)
    expect(() => resolve({ values: [0.9, 0.1], sources: ['ability.probability-control'] }))
      .toThrowError(/not legal for the selected outcome/)
  })

  it('charges every attempt to shared causal roll budgets', () => {
    expect(() => resolve({
      values: [0, 0.5],
      sources: ['ability.probability-control'],
      limits: { rollsPerCausalChain: 1 },
    })).toThrowError(/rollsPerCausalChain/)
  })

  it('resolves deterministic opposed contests with explicit tie policy', () => {
    const random = createAuthoritativeAbilityRandom(createFiniteAuthoritativeAbilityRandomStream([0.4, 0.4]))
    const result = resolveAuthoritativeAbilityContest({
      contestId: 'contest.grapple',
      initiator: {
        resolutionId: 'resolution.contest.initiator',
        definition: contest('contest.initiator'),
        selectedRerollSourceIds: [],
      },
      defender: {
        resolutionId: 'resolution.contest.defender',
        definition: contest('contest.defender'),
        selectedRerollSourceIds: [],
      },
      tiePolicy: 'defender',
      random,
      budget: createAbilityExecutionBudget(),
    })
    expect(result).toMatchObject({
      tiePolicy: 'defender', winner: 'defender',
      initiator: { finalValue: 9 }, defender: { finalValue: 9 },
    })
    expect(random.complete()).toHaveLength(2)
  })

  it('requires thresholds for checks/saves and total-only contest definitions', () => {
    expect(() => parseAbilityCheckDefinition(check({ threshold: null }))).toThrowError(/contest checks alone/)
    expect(() => parseAbilityCheckDefinition(contest('contest.bad', 0) as object & { threshold: object }))
      .not.toThrow()
    expect(() => resolveAuthoritativeAbilityContest({
      contestId: 'contest.bad',
      initiator: { resolutionId: 'resolution.a', definition: check(), selectedRerollSourceIds: [] },
      defender: { resolutionId: 'resolution.b', definition: contest('contest.b'), selectedRerollSourceIds: [] },
      tiePolicy: 'no-winner',
      random: createAuthoritativeAbilityRandom(() => 0),
      budget: createAbilityExecutionBudget(),
    })).toThrowError(/total-only/)
  })
})
