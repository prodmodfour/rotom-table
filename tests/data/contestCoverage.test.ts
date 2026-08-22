import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import contests from '../../data/reference/contests.json'
import moves from '../../data/reference/moves.json'
import integration from '../../data/contests/integration-coverage.v1.json'
import rules from '../../data/contests/rule-coverage.v1.json'
import matrix from '../../data/contests/variant-matrix.v1.json'
import recovery from '../../data/contests/failure-recovery-fixtures.v1.json'
import acceptance from '../../data/contests/alpha-acceptance.v1.json'
import { CONTEST_EFFECT_IDS, CONTEST_STAT_IDS } from '../../shared/contests/ids'
import { CONTEST_COMMAND_KINDS } from '../../shared/contests/operations'
import { CONTEST_OPERATION_ATOMICITY } from '../../shared/contests/architecture'

const root = resolve(import.meta.dirname, '../..')
const sha = (path: string) => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')

describe('Pokémon Contest canonical closure', () => {
  it('keeps the canonical catalog source-hash-bound and registered as runtime authority', () => {
    expect((contests as any).sourceFingerprint.algorithm).toBe('sha256')
    expect((contests as any).sourceFingerprint.sources.every((source: any) => sha(source.path) === source.sha256)).toBe(true)
    expect(readFileSync(resolve(root, 'AGENTS.md'), 'utf8')).toContain('`data/reference/contests.json`')
  })

  it('keeps every Move identity explicit and every effect owned', () => {
    const rows = Object.values(moves as Record<string, any>)
    const defined = rows.filter(row => row.contest?.status === 'defined')
    const unavailable = rows.filter(row => row.contest?.status === 'unavailable')
    expect(defined).toHaveLength(761)
    expect(unavailable).toHaveLength(16)
    expect(defined.length + unavailable.length).toBe(rows.length)
    expect(new Set(defined.map(row => row.contest.effectId))).toEqual(new Set(CONTEST_EFFECT_IDS))
    expect(new Set(defined.map(row => row.contest.typeId))).toEqual(new Set(CONTEST_STAT_IDS))
    expect(new Set((contests as any).contestEffects.map((row: any) => row.id))).toEqual(new Set(CONTEST_EFFECT_IDS))
  })

  it('has one final, unblocked integration row for every reviewed provider', () => {
    const rows = integration.rows
    const keys = rows.map(row => `${row.kind}:${row.id}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const [kind, count] of Object.entries(integration.expectedCounts)) expect(rows.filter(row => row.kind === kind)).toHaveLength(count)
    expect(rows).toHaveLength(44)
    expect(rows.some(row => row.completionState === 'blocked')).toBe(false)
    expect(integration.blockedCount).toBe(0)
    expect((contests as any).integrationRows.map((row: any) => `${row.kind}:${row.id}`).sort()).toEqual([...keys].sort())
  })

  it('has no blocked or prose-inferred canonical rule', () => {
    expect(rules.rows.some(row => row.state === 'blocked')).toBe(false)
    expect(rules.blockedCount).toBe(0)
    expect(rules.runtimeProseParsing).toBe(false)
    expect(rules.rows.every(row => row.ownerTickets.length > 0 && row.authority.length > 0)).toBe(true)
  })

  it('pins and closes the full scale/type/variant matrix', () => {
    expect(matrix.sources.every(source => sha(source.path) === source.sha256)).toBe(true)
    expect(matrix.scenarios).toHaveLength(18)
    for (const typeId of CONTEST_STAT_IDS) for (const count of [3,4,5]) expect(matrix.scenarios.some(row => row.id === `standard-${typeId}-${count}`)).toBe(true)
    for (const id of ['supercontest-five','festival-five','rotation-three']) expect(matrix.scenarios.some(row => row.id === id)).toBe(true)
    for (const scenario of matrix.scenarios) {
      expect(scenario.expected.letters).toHaveLength(scenario.contestantCount)
      expect(scenario.expected.placements).toHaveLength(scenario.contestantCount)
      expect(scenario.expected.settlement).toHaveLength(scenario.contestantCount)
      expect(scenario.expected.evidenceSha256).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it('owns atomicity for every command and named recovery evidence for critical failures', () => {
    expect(Object.keys(CONTEST_OPERATION_ATOMICITY).sort()).toEqual([...CONTEST_COMMAND_KINDS].sort())
    const ids = new Set(recovery.fixtures.map(row => row.id))
    for (const id of ['stale-revision','duplicate-declaration-exact-retry','operation-id-payload-conflict','gm-restart-mid-round','illegal-move-repeat','dice-pool-overspend','interrupted-settlement','server-restart-between-rounds','forged-option-id','spectator-mutation']) expect(ids.has(id)).toBe(true)
  })

  it('records a hash-bound final alpha candidate and requires archival before acceptance', () => {
    expect(['candidate', 'accepted']).toContain(acceptance.status)
    expect(acceptance).toMatchObject({
      schemaVersion: 1,
      ticket: 'P10-100',
      productPhase: 'alpha',
      catalog: {
        canonicalMoveRows: 777,
        definedMoveRows: 761,
        explicitUnavailableMoveRows: 16,
        canonicalRuleRows: 34,
        integrationRows: 44,
        blockedRows: 0,
        runtimeProseParsing: false,
      },
      acceptance: {
        deterministicScenarios: 18,
        contestantScales: [3, 4, 5],
        desktopMobileProjects: ['chromium', 'mobile-chromium'],
        hardAccessibilityFailures: 0,
        criticalContestDebt: 0,
        manualStorageRepairRequired: false,
        clientOwnedRandomness: false,
        clientOwnedMechanicalMutation: false,
      },
    })
    expect(acceptance.acceptance.variants).toEqual(['standard', 'supercontest', 'festival', 'rotation'])
    expect(acceptance.acceptance.concurrentProductionRoles).toEqual(['gm', 'player-owner-1', 'player-owner-2', 'spectator'])
    expect(acceptance.visualEvidence.every(path => path.startsWith('.pi/artifacts/'))).toBe(true)
    expect(acceptance.browserTraceEvidence).toHaveLength(2)
    for (const row of acceptance.browserTraceEvidence) {
      expect(row.path).toMatch(/^\.pi\/artifacts\/ui-validation\/contests\/traces\/(?:mobile-)?chromium\.zip$/u)
      expect(row.sha256).toMatch(/^[a-f0-9]{64}$/u)
      expect(sha(row.path), row.path).toBe(row.sha256)
    }

    const plan = readFileSync(resolve(root, acceptance.plan.path), 'utf8')
    const ticketRows = [...plan.matchAll(/^- \[([ x])\] \*\*P10-(\d{3})\b.*?— `([A-Z_]+)`$/gmu)]
    expect(ticketRows).toHaveLength(100)
    expect(new Set(ticketRows.map(match => match[2])).size).toBe(100)
    if (acceptance.status === 'candidate') {
      expect(acceptance.plan).toEqual({ path: 'implementation-plans/POKEMON_CONTESTS_PLAN.md', ticketsTotal: 100, ticketsDone: 99, currentTicket: 'P10-100', blockers: 0 })
      expect(plan).toContain('`PLAN_STATUS: IN_PROGRESS`')
      expect(plan).toContain('`CURRENT_TICKET: P10-100`')
      expect(ticketRows.filter(match => match[3] === 'DONE')).toHaveLength(99)
      expect(ticketRows.find(match => match[2] === '100')?.[3]).toBe('IN_PROGRESS')
      expect(acceptance.validation.repositoryPlaywright).toBe('pending-final-rerun')
      expect(acceptance.validation.repositoryQualityGate).toBe('pending-final-rerun')
      expect(acceptance.finalAssertions).toMatchObject({ everyTicketDone: false, planArchived: false })
    } else {
      expect(acceptance.plan).toEqual({ path: 'implementation-plans/done/POKEMON_CONTESTS_PLAN.md', ticketsTotal: 100, ticketsDone: 100, currentTicket: 'NONE', blockers: 0 })
      expect(plan).toContain('`PLAN_STATUS: DONE`')
      expect(plan).toContain('`CURRENT_TICKET: NONE`')
      expect(ticketRows.every(match => match[3] === 'DONE')).toBe(true)
      expect(Object.values(acceptance.validation).every(value => value === 'passed')).toBe(true)
      expect(acceptance.finalAssertions).toMatchObject({ everyTicketDone: true, planArchived: true })
    }
    expect(acceptance.finalAssertions).toMatchObject({ noBlockedCanonicalRow: true, noCriticalContestDebt: true, liveplayOnly: true, legacyContestTextIsNonAuthoritative: true })

    const paths = new Set<string>()
    for (const row of acceptance.sourceEvidence) {
      expect(paths.has(row.path), row.path).toBe(false)
      paths.add(row.path)
      expect(row.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(sha(row.path), row.path).toBe(row.sha256)
    }
  })

  it('never imports documentary or parser inputs at runtime', () => {
    const paths = [
      'shared/contests/catalog.ts','shared/contests/integrations.ts','shared/contests/preparation.ts',
      'server/domain/contests/engine.ts','server/useCases/contests.ts','server/useCases/contestPreparation.ts',
    ]
    for (const path of paths) {
      const source = readFileSync(resolve(root, path), 'utf8')
      expect(source).not.toMatch(/books\/|ptu-data\/|\.pdf|https?:\/\//u)
    }
  })
})
