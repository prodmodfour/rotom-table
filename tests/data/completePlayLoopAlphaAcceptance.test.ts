import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import acceptance from '../../data/complete-play-loop/alpha-product-acceptance.v1.json'
import cohorts from '../../data/complete-play-loop/item-catalog-cohorts.v1.json'
import catalogClosure from '../../data/complete-play-loop/item-catalog-closure.v1.json'
import authority from '../../data/complete-play-loop/authority-guardrails.v1.json'
import performanceBudgets from '../../data/complete-play-loop/performance-scale-budgets.v1.json'
import accessibility from '../../data/complete-play-loop/accessibility-responsive-visual-acceptance.v1.json'
import failureAcceptance from '../../data/complete-play-loop/concurrency-failure-acceptance.v1.json'
import goldenCampaigns from '../../data/complete-play-loop/golden-campaign-acceptance.v1.json'
import documentation from '../../data/complete-play-loop/documentation-closure.v1.json'

const root = resolve(import.meta.dirname, '../..')
const sha256 = (value: Buffer): string => createHash('sha256').update(value).digest('hex')
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8')

describe('P8-100 final alpha product acceptance', () => {
  it('joins every focused completion gate at one exact candidate or accepted revision', () => {
    expect(['candidate', 'accepted']).toContain(acceptance.status)
    expect(acceptance).toMatchObject({ schemaVersion: 1, ticket: 'P8-100', productPhase: 'alpha' })
    expect(acceptance.gates.map(gate => gate.gateId)).toEqual([
      'catalog-closure',
      'authority-guardrails',
      'performance',
      'accessibility-visual',
      'concurrency-failure',
      'golden-campaigns',
      'documentation',
    ])
    expect(catalogClosure.status).toBe('implemented')
    expect(authority.status).toBe('enforced')
    expect(performanceBudgets.status).toBe('enforced')
    expect(accessibility.status).toBe('accepted')
    expect(failureAcceptance.status).toBe('accepted')
    expect(goldenCampaigns.status).toBe('accepted')
    expect(documentation.status).toBe('complete')
  })

  it('proves all 349 canonical items are complete with no blocked row', () => {
    expect(acceptance.catalog).toEqual({
      canonicalRows: 349,
      native: 205,
      guided: 40,
      passive: 104,
      blocked: 0,
    })
    expect(cohorts.itemCount).toBe(349)
    expect(cohorts.implementationStateCounts).toEqual({ guided: 40, native: 205, passive: 104 })
    expect(cohorts.cohorts.flatMap(cohort => cohort.unresolvedRequirements)).toEqual([])
    expect(cohorts.providerCounts['canonical-data-defect']).toBe(0)
    expect(authority.catalog).toMatchObject({ itemCount: 349, registeredExactlyOnce: true, blockedCount: 0 })
  })

  it('records no hard usability, authority, privacy, replay, or fixture debt', () => {
    expect(acceptance.acceptance).toEqual({
      goldenCampaigns: 3,
      canonicalFixtures: 21,
      desktopMobileLiveplayProjects: 8,
      hardAccessibilityFailures: 0,
      criticalUsabilityDebt: 0,
      manualStorageRepairRequired: false,
      runtimeProseParsing: false,
      clientOwnedMechanicalMutation: false,
    })
    expect(accessibility.criticalUsabilityDebt).toBe(0)
    expect(accessibility.hardFailures).toBe(0)
    expect(failureAcceptance.manualStorageRepairRequired).toBe(false)
    expect(failureAcceptance.automaticReconnectReplayAllowed).toBe(false)
    expect(goldenCampaigns.canonicalFixtureCount).toBe(21)
    expect(goldenCampaigns.directStorageRepairAllowed).toBe(false)
  })

  it('keeps the ledger candidate-valid during closure and fully archived after acceptance', () => {
    const plan = read(acceptance.plan.path)
    const ticketRows = [...plan.matchAll(/^- \[[ x]\] \*\*P8-(\d{3})\b.*?— `([A-Z_]+)`/gmu)]
    expect(ticketRows).toHaveLength(100)
    expect(new Set(ticketRows.map(match => match[1])).size).toBe(100)

    if (acceptance.status === 'candidate') {
      expect(acceptance.plan).toMatchObject({ ticketsTotal: 100, ticketsDone: 99, currentTicket: 'P8-100', blockers: 0 })
      expect(plan).toContain('`PLAN_STATUS: IN_PROGRESS`')
      expect(plan).toContain('`CURRENT_TICKET: P8-100`')
      expect(ticketRows.filter(match => match[2] === 'DONE')).toHaveLength(99)
      expect(ticketRows.find(match => match[1] === '100')?.[2]).toBe('IN_PROGRESS')
      return
    }

    expect(acceptance.plan).toMatchObject({ ticketsTotal: 100, ticketsDone: 100, currentTicket: 'NONE', blockers: 0 })
    expect(plan).toContain('`PLAN_STATUS: DONE`')
    expect(plan).toContain('`CURRENT_TICKET: NONE`')
    expect(ticketRows.every(match => match[2] === 'DONE')).toBe(true)
    expect(acceptance.plan.path).toBe('implementation-plans/done/COMPLETE_PLAY_LOOP_PLAN.md')
    expect(read('implementation-plans/plan-order.md')).toContain('| [Complete Play Loop](done/COMPLETE_PLAY_LOOP_PLAN.md) | `DONE` | Complete and archived')
    const agentGuidance = read('AGENTS.md')
    expect(agentGuidance).toContain('Read `implementation-plans/plan-order.md` before implementation work')
    expect(agentGuidance).not.toContain('implementation-plans/COMPLETE_PLAY_LOOP_PLAN.md')
  })

  it('requires every final validator and assertion only after accepted closure', () => {
    if (acceptance.status === 'candidate') return
    expect(acceptance.gates.every(gate => gate.status === 'passed')).toBe(true)
    expect(Object.values(acceptance.validation).every(value => value === 'passed')).toBe(true)
    expect(acceptance.finalAssertions).toEqual({
      everyPlanDone: true,
      everyTicketDone: true,
      planArchived: true,
      noBlockedCatalogRow: true,
      noCriticalPrimaryLoopDebt: true,
      liveplayOnly: true,
    })
  })

  it('hash-binds every final ledger, gate, evidence contract, guide, command, and acceptance test', () => {
    const paths = new Set<string>()
    for (const row of acceptance.sourceEvidence) {
      expect(paths.has(row.path), row.path).toBe(false)
      paths.add(row.path)
      expect(row.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(sha256(readFileSync(resolve(root, row.path))), row.path).toBe(row.sha256)
    }
    for (const path of [
      acceptance.plan.path,
      'implementation-plans/plan-order.md',
      'AGENTS.md',
      'data/complete-play-loop/item-catalog-closure.v1.json',
      'data/complete-play-loop/authority-guardrails.v1.json',
      'data/complete-play-loop/performance-scale-budgets.v1.json',
      'data/complete-play-loop/accessibility-responsive-visual-acceptance.v1.json',
      'data/complete-play-loop/concurrency-failure-acceptance.v1.json',
      'data/complete-play-loop/golden-campaign-acceptance.v1.json',
      'data/complete-play-loop/documentation-closure.v1.json',
      'docs/complete-play-loop-alpha-acceptance.md',
      'tests/data/completePlayLoopAlphaAcceptance.test.ts',
      'package.json',
      'scripts/quality-gate.sh',
    ]) expect(paths.has(path), path).toBe(true)
  })
})
