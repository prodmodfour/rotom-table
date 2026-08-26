import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import acceptance from '../../data/gm-campaign-toolkit/final-acceptance.v1.json'
import finality from '../../data/gm-campaign-toolkit/footprint-finality.v1.json'
import production from '../../data/gm-campaign-toolkit/production-liveplay-acceptance.v1.json'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8')
const sha256 = (path: string): string => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')

describe('P12-096 GM Campaign Toolkit final acceptance', () => {
  it('records all 96 tickets, eight phases, and an archived authoritative ledger', () => {
    expect(acceptance).toMatchObject({
      schemaVersion: 1,
      ticket: 'P12-096',
      status: 'accepted',
      productPhase: 'alpha',
      ticketsDone: 96,
      plan: {
        path: 'implementation-plans/done/GM_CAMPAIGN_TOOLKIT_PLAN.md',
        ticketsTotal: 96,
        ticketsDone: 96,
        phasesTotal: 8,
        phasesDone: 8,
        currentTicket: 'NONE',
        blockers: 0,
        archived: true,
      },
    })
    const ledger = read(acceptance.plan.path)
    expect(ledger).toContain('`PLAN_STATUS: DONE`')
    expect(ledger).toContain('`CURRENT_TICKET: NONE`')
    expect(ledger.match(/^- \[x\] \*\*P12-\d{3}\b/gmu)).toHaveLength(96)
    expect(ledger).not.toMatch(/^- \[ \] \*\*P12-\d{3}\b/gmu)
    expect(existsSync(resolve(root, 'implementation-plans/GM_CAMPAIGN_TOOLKIT_PLAN.md'))).toBe(false)
  })

  it('matches the accepted immutable 40-row footprint with no temporary state', () => {
    expect(finality).toMatchObject({ status: 'accepted-final', finalityTicket: 'P12-093' })
    expect(acceptance.footprint).toEqual({
      activationSha256: '161be4cb987549b3947ba65262d325fcfd28dd5538286d633528e4ef2a2f9862',
      rows: 40,
      finalRows: 40,
      nativeRows: 20,
      migratedRows: 4,
      preservedRows: 5,
      retiredRows: 10,
      documentaryRows: 1,
      pendingRows: 0,
      blockedRows: 0,
      hardFailures: 0,
    })
    expect(finality.summary).toEqual({
      rows: acceptance.footprint.rows,
      final: acceptance.footprint.finalRows,
      pending: acceptance.footprint.pendingRows,
      blocked: acceptance.footprint.blockedRows,
      byState: {
        Native: acceptance.footprint.nativeRows,
        Migrated: acceptance.footprint.migratedRows,
        Preserved: acceptance.footprint.preservedRows,
        Retired: acceptance.footprint.retiredRows,
        Documentary: acceptance.footprint.documentaryRows,
      },
    })
  })

  it('hash-binds finality, generation, recovery, liveplay, documentation, archive, and successor scope', () => {
    expect(acceptance.sourceEvidence.length).toBeGreaterThanOrEqual(14)
    expect(new Set(acceptance.sourceEvidence.map(row => row.path)).size).toBe(acceptance.sourceEvidence.length)
    for (const row of acceptance.sourceEvidence) {
      expect(row.sha256, row.path).toMatch(/^[a-f0-9]{64}$/u)
      expect(sha256(row.path), row.path).toBe(row.sha256)
    }
  })

  it('records passed repository and production acceptance with no critical usability defect', () => {
    expect(Object.entries(acceptance.validation)
      .filter(([, value]) => typeof value === 'string')
      .every(([, value]) => value === 'passed' || value === 'passed-with-zero-errors' || value === 'complete')).toBe(true)
    expect(acceptance.validation).toMatchObject({
      criticalUsabilityDefects: 0,
      fullBrowserMatrix: { passed: 97, failed: 0, skipped: 1, workers: 1 },
      toolkitProductionAcceptance: {
        passed: 6,
        failed: 0,
        traces: 6,
        seriousOrCriticalAxeViolations: 0,
        horizontalOverflowFailures: 0,
      },
    })
    expect(production).toMatchObject({ ticket: 'P12-095', status: 'accepted', results: { passed: 6, failed: 0, traces: 6 } })
    expect(Object.values(acceptance.authorityAssertions).every(value => value === true || value === false)).toBe(true)
    expect(acceptance.authorityAssertions).toMatchObject({
      appOwnedCanonicalReferencesOnly: true,
      documentaryRuntimeReads: false,
      parallelMechanicsAuthority: false,
      parallelPersistenceAuthority: false,
      browserOwnedRandomness: false,
      previewWritesAuthority: false,
      ordinaryGeneratedSheets: true,
      roleSafeServerProjections: true,
      liveplayOnly: true,
    })
  })

  it('registers Plan 13 scope without a numbered ledger, activation, or execution obligation', () => {
    expect(acceptance.nextProspectivePlan).toEqual({
      order: 13,
      name: '1.0 Release Readiness',
      draftPath: 'implementation-plans/drafts/RELEASE_READINESS_PLAN.md',
      draftStatus: 'REGISTERED_FOR_REVIEW',
      numberedLedgerRegistered: false,
      activated: false,
      executionObligation: false,
      ownerStartRequired: true,
      dependsOnPlans10Through12: true,
    })
    const draft = read(acceptance.nextProspectivePlan.draftPath)
    expect(draft).toContain('`DRAFT_STATUS: REGISTERED_FOR_REVIEW`')
    expect(draft).toContain('`NUMBERED_LEDGER_REGISTERED: false`')
    expect(draft).toContain('`ACTIVATED: false`')
    expect(draft).toContain('`EXECUTION_OBLIGATION: false`')
    expect(read('implementation-plans/plan-order.md')).toContain(
      '| 13 | [1.0 Release Readiness](drafts/RELEASE_READINESS_PLAN.md) |',
    )
    expect(read('AGENTS.md')).toContain('is not a numbered ledger, is not activated, and imposes no execution obligation')
    expect(Object.values(acceptance.finalAssertions).every(Boolean)).toBe(true)
  })
})
