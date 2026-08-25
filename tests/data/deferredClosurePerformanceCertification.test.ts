import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/final-performance-certification.v1.json'
import encounterBudgets from '../../data/encounter-workspace/performance-budgets.json'
import scaleBudgets from '../../data/complete-play-loop/performance-scale-budgets.v1.json'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const source = (path: string): string => readFileSync(path, 'utf8')
const verify = (row: { path: string, sha256: string }): void => {
  expect(acceptedSuccessorHead(row.path, row.sha256), row.path).toBe(repositoryFileSha256(row.path))
}

describe('P11-085 final performance certification', () => {
  it('inherits the unchanged encounter, lower-end laptop, mobile, and large-campaign budgets', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1,
      certificationId: 'deferred-closure-final-performance-v1',
      ticket: 'P11-085',
      status: 'certified',
      runtimeProseParsing: false,
    })
    expect(certification.predecessor.sha256).toBe(sha256(certification.predecessor.path))
    expect(certification.budgetPolicy).toEqual({
      inheritedBudgetChanges: 0,
      raisedLimits: 0,
      workers: 1,
      fileParallelism: false,
      warmupRuns: encounterBudgets.measurement.warmupRuns,
      measuredRuns: encounterBudgets.measurement.measuredRuns,
      failurePolicy: 'overrun-blocks-acceptance',
    })
    expect(certification.budgets).toEqual({
      adapterP95Ms: encounterBudgets.runtime.adapterP95Ms,
      interactionP95Ms: encounterBudgets.runtime.interactionP95Ms,
      acceptedPresentationP95Ms: encounterBudgets.runtime.acceptedPresentationP95Ms,
      maximumRenderedOffersOrRows: scaleBudgets.profiles.mobile.maximumRenderedActionOffers,
      maximumProjectionBytes: encounterBudgets.runtime.maximumProjectionBytes,
      lowerEndLaptopInteractionMs: scaleBudgets.profiles.lowerEndLaptop.interactionTargetMs,
      lowerEndLaptopInitialRenderMs: scaleBudgets.profiles.lowerEndLaptop.initialRenderTargetMs,
      largeCampaignInventoryRows: scaleBudgets.profiles.largeCampaign.inventoryRows,
      largeCampaignEquipmentOwners: scaleBudgets.profiles.largeCampaign.equipmentOwnerCount,
      largeCampaignAttentionItems: scaleBudgets.profiles.largeCampaign.attentionItemCount,
      largeCampaignRealtimeClients: scaleBudgets.profiles.largeCampaign.realtimeClientCount,
    })
  })

  it('covers every new cohort plus dense ranged targeting and joined dual-engine Battle play', () => {
    expect(certification.scenarios).toEqual([
      expect.objectContaining({ scenarioId: 'dense-ranged-targeting', cohort: 'ranged-and-weapon-actions', actorCount: 1, targetCount: 256, status: 'passed' }),
      expect.objectContaining({ scenarioId: 'item-actions-large-inventory-and-action-dock', cohort: 'item-actions', storedInventoryRows: 5000, projectedOffers: 512, renderedBatchSize: 80, status: 'passed' }),
      expect.objectContaining({ scenarioId: 'generic-skill-check-bounded-cockpits', cohort: 'generic-skill-checks', renderedRequestCards: 20, renderedHistoryRows: 20, status: 'passed' }),
      expect.objectContaining({ scenarioId: 'trainer-participant-five-entry-projections', cohort: 'trainer-participant-contests', contestantCount: 5, performerCount: 10, status: 'passed' }),
      expect.objectContaining({ scenarioId: 'battle-contest-maximum-roster-projections', cohort: 'battle-contests', teamCount: 2, pokemonPerTeam: 6, performerCount: 12, status: 'passed' }),
      expect.objectContaining({ scenarioId: 'battle-contest-joined-dual-engine-cockpit', cohort: 'battle-contests', joinedProjectionRuns: 100, status: 'passed' }),
      expect.objectContaining({ scenarioId: 'large-campaign-authorities', cohort: 'cross-surface', inventoryRows: 5000, equipmentOwners: 512, attentionItems: 10000, realtimeClients: 32, status: 'passed' }),
    ])
    for (const scenario of certification.scenarios) {
      expect(scenario.hardFailures, scenario.scenarioId).toBe(0)
      expect(scenario.executableEvidence.length, scenario.scenarioId).toBeGreaterThan(0)
    }
    expect(certification.acceptance).toEqual({
      auditedCohorts: 5,
      benchmarkScenarios: 7,
      budgetOverruns: 0,
      raisedLimits: 0,
      incompleteReads: 0,
      silentTruncations: 0,
      hardFailures: 0,
      nextTicket: 'P11-086',
    })
  })

  it('retains executable structural caps and exact dense and dual-engine benchmark scales', () => {
    const focused = source('tests/server/deferredClosurePerformanceBudgets.test.ts')
    expect(focused).toContain("Array.from({ length: 256 }")
    expect(focused).toContain("role: 'player'")
    expect(focused).toContain("createEmptySheetEquipmentState")
    expect(focused).toContain("Array.from({ length: encounterBudgets.measurement.measuredRuns }")
    expect(focused).toContain("Array.from({ length: 5 }")
    expect(focused).toContain("Array.from({ length: 6 }")
    expect(focused).toContain('scaleBudgets.profiles.lowerEndLaptop.interactionTargetMs')
    expect(focused).toContain('encounterBudgets.runtime.acceptedPresentationP95Ms')
    expect(focused).toContain('encounterBudgets.runtime.maximumProjectionBytes')

    const battle = source('tests/server/contestBattleAcceptedMoveAppealsRuntime.test.ts')
    expect(battle).toContain("it('rebuilds the joined cockpit inside the existing Contest projection budget'")
    expect(battle).toContain('for (let index = 0; index < 100; index += 1)')
    expect(battle).toContain('toBeLessThan(250)')

    const dock = source('src/components/encounter/workspace/EncounterActionDock.vue')
    expect(dock).toContain('const RENDER_BATCH_SIZE = 80')
    const gmChecks = source('src/components/encounter/workspace/EncounterGmSkillChecks.vue')
    expect(gmChecks).toContain('const activeCheckLimit = ref(20)')
    expect(gmChecks).toContain(').slice(0, 20)')
    const subjectChecks = source('src/components/encounter/workspace/EncounterSubjectSkillChecks.vue')
    expect(subjectChecks).toContain('const historyLimit = ref(20)')

    const packageSource = source('package.json')
    expect(packageSource).toContain('check:deferred-closure-performance')
    expect(packageSource).toContain('--maxWorkers=1 --no-file-parallelism')
  })

  it('hash-binds current budget authorities and every focused benchmark', () => {
    for (const row of certification.authorities) verify(row)
    for (const row of certification.evidence) verify(row)
    const paths = new Set([...certification.authorities, ...certification.evidence].map(row => row.path))
    for (const path of [
      'data/encounter-workspace/performance-budgets.json',
      'data/complete-play-loop/performance-scale-budgets.v1.json',
      'tests/server/deferredClosurePerformanceBudgets.test.ts',
      'tests/server/contestBattleAcceptedMoveAppealsRuntime.test.ts',
      'tests/server/encounterWorkspaceProjection.test.ts',
      'tests/shared/encounterPresentationPerformance.test.ts',
      'tests/components/completePlayLoopPerformanceBudgets.test.ts',
      'tests/components/encounterGmSkillChecks.test.ts',
      'tests/components/encounterSubjectSkillChecks.test.ts',
      'tests/data/deferredClosurePerformanceCertification.test.ts',
      'package.json',
    ]) expect(paths.has(path), path).toBe(true)
  })
})
