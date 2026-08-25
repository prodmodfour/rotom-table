import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import fixtures from '../../data/contests/battle-contest-scenarios.v1.json'
import certification from '../../data/deferred-closure/battle-contest-fixtures-certification.v1.json'
import contests from '../../data/reference/contests.json'
import { contestVariantIsNative } from '../../shared/contests/catalog'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'

const verifyBound = (row: { path: string, sha256: string }): void => {
  expect(acceptedSuccessorHead(row.path, row.sha256), row.path).toBe(repositoryFileSha256(row.path))
}

const completeRoster = (rosterSize: number): number[] => Array.from({ length: rosterSize }, (_, index) => index)

describe('P11-079 deterministic Battle Contest fixtures', () => {
  it('binds the four minimum/maximum and KO/budget scenarios to accepted canonical fingerprints', () => {
    expect(fixtures).toMatchObject({
      schemaVersion: 1,
      fixtureSetId: 'battle-contest-deterministic-scenarios-v1',
      ticket: 'P11-079',
    })
    expect(fixtures.scenarios).toHaveLength(4)
    expect(new Set(fixtures.scenarios.map(row => row.id)).size).toBe(4)
    expect(new Set(fixtures.scenarios.map(row => row.seed)).size).toBe(4)
    for (const source of fixtures.sources) verifyBound(source)
    for (const rosterSize of [3, 6]) {
      for (const terminalCondition of ['round-budget-exhausted', 'one-trainer-all-pokemon-knocked-out']) {
        expect(fixtures.scenarios).toContainEqual(expect.objectContaining({
          rosterSize,
          roundBudget: rosterSize * 2,
          expected: expect.objectContaining({ terminalCondition }),
        }))
      }
    }
  })

  it('pins seeded Appeal tallies, Appeal-only placements, complete KO evidence, and one terminal receipt', () => {
    for (const scenario of fixtures.scenarios) {
      const appeals = scenario.script.filter(step => step.kind === 'appeal')
      const endings = scenario.script.filter(step => step.kind === 'end')
      expect(endings, scenario.id).toHaveLength(1)
      expect(scenario.script.at(-1), scenario.id).toEqual(endings[0])
      expect(scenario.expected.appeals, scenario.id).toHaveLength(appeals.length)
      expect(scenario.expected.receiptsByOutcome, scenario.id).toEqual({
        'scored-appeal': appeals.length,
        'canonical-exclusion': 0,
        'lifecycle-applied': scenario.expected.lifecycle.length,
        'contest-ended': 1,
      })

      const teams = Object.values(scenario.expected.teams)
      expect(teams, scenario.id).toHaveLength(2)
      expect(teams.map(team => team.placement).sort()).toEqual([1, 2])
      expect(teams.every(team => team.finalScore === team.appeal), scenario.id).toBe(true)
      expect(teams.find(team => team.placement === 1)?.contestantId).toBe(scenario.expected.winnerContestantId)
      for (const team of teams) {
        expect(team.pokemonVoltage, scenario.id).toHaveLength(scenario.rosterSize)
        expect(team.pokemonVoltage.map(row => row.pokemonIndex)).toEqual(completeRoster(scenario.rosterSize))
        expect(team.pokemonVoltage.every(row => Number.isInteger(row.value) && row.value >= 0 && row.value <= 5), scenario.id).toBe(true)
      }

      if (scenario.expected.terminalCondition === 'round-budget-exhausted') {
        expect(scenario.expected.terminalRound).toBe(scenario.roundBudget)
      } else {
        const completeSides = Object.entries(scenario.expected.knockedOutPokemonIndices)
          .filter(([, indices]) => indices.length === scenario.rosterSize)
        expect(completeSides, scenario.id).toHaveLength(1)
        expect(completeSides[0]![1]).toEqual(completeRoster(scenario.rosterSize))
      }
      expect(scenario.expected.evidenceSha256).toMatch(/^[a-f0-9]{64}$/u)
    }
    expect(new Set(fixtures.scenarios.map(row => row.expected.evidenceSha256)).size).toBe(4)
  })

  it('replays switching and every reviewed voltage lifecycle rule without a parallel mechanics simulator', () => {
    const scriptSwitches = fixtures.scenarios.flatMap(scenario => scenario.script.filter(step => step.kind === 'switch'))
    expect(scriptSwitches.some(step => step.kind === 'switch' && step.exception === null)).toBe(true)
    expect(new Set(scriptSwitches.flatMap(step => step.kind === 'switch' && step.exception ? [step.exception] : []))).toEqual(new Set(['Baton Pass', 'U-Turn']))

    const lifecycle = fixtures.scenarios.flatMap(scenario => scenario.expected.lifecycle)
    expect(new Set(lifecycle.map(row => row.rule))).toEqual(new Set([
      'recall',
      'recall-exception',
      'attack-knockout',
      'damage-over-time-knockout',
    ]))
    for (const row of lifecycle) {
      expect(row.transitions).toHaveLength(1)
      const transition = row.transitions[0]!
      expect(transition.voltageAfter).toBeGreaterThanOrEqual(0)
      expect(transition.voltageAfter).toBeLessThanOrEqual(5)
      if (row.rule === 'recall') expect(transition.ruleDelta).toBe(-2)
      else if (row.rule === 'recall-exception') expect(transition.ruleDelta).toBe(0)
      else expect(transition.ruleDelta).toBe(2)
    }

    const generator = readFileSync('scripts/generate_battle_contest_fixtures.ts', 'utf8')
    expect(generator).toContain('executeBattleContestAcceptedMoveAppeal')
    expect(generator).toContain('executeBattleContestVoltageLifecycle')
    expect(generator).toContain('executeBattleContestEnd')
    expect(generator).not.toMatch(/function\s+(?:score|applyVoltage|finalizePlacements)/u)
  })

  it('preserves exact replay and the historical structured fixture certificate under native activation', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1,
      ticket: 'P11-079',
      status: 'certified',
      runtimeProseParsing: false,
    })
    expect(certification.predecessor.sha256).toBe(repositoryFileSha256(certification.predecessor.path))
    verifyBound(certification.canonicalVariantAuthority)
    for (const authority of certification.authorities) verifyBound(authority)
    for (const evidence of certification.evidence) verifyBound(evidence)
    expect(contests.variants.find(row => row.id === 'battle')).toMatchObject({ completionState: 'native' })
    expect(contestVariantIsNative('battle')).toBe(true)
    expect(certification.acceptance).toEqual({
      deterministicScenarios: 4,
      trainerTeamsPerScenario: 2,
      rosterSizes: [3, 6],
      roundBudgets: [6, 12],
      endConditions: ['round-budget-exhausted', 'one-trainer-all-pokemon-knocked-out'],
      switchingRules: ['ordinary-recall-minus-two', 'Baton Pass', 'U-Turn'],
      voltageRules: ['appeal', 'attack-knockout', 'damage-over-time-knockout', 'recall', 'recall-exception'],
      exactReplayFixtureCheck: true,
      duplicateSeeds: 0,
      duplicateEvidenceHashes: 0,
      parallelMechanicsSimulatorsAdded: 0,
      terminalReceiptsPerScenario: 1,
      variantCompletionState: 'structured',
      nextTicket: 'P11-080',
    })
  })
})
