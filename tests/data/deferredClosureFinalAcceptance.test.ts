import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import acceptance from '../../data/deferred-closure/final-acceptance.v1.json'
import inventory from '../../data/deferred-closure/closure-inventory.v1.json'
import zeroDeferred from '../../data/deferred-closure/zero-deferred-acceptance.v1.json'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8')

const finalStates = new Set(['native', 'guided', 're-homed', 'verified/retired'])
const forbiddenStates = new Set([
  'absent',
  'blocked',
  'deferred',
  'definition-missing',
  'prose-inferred',
  'reference-only-deferral',
  'silently-absent',
  'visible-with-reason',
])

describe('Deferred Mechanics Closure final acceptance (P11-092)', () => {
  it('records one accepted, archived 92-ticket Plan 11', () => {
    expect(acceptance).toMatchObject({
      schemaVersion: 1,
      acceptanceId: 'deferred-mechanics-closure-final-v1',
      ticket: 'P11-092',
      status: 'accepted',
      productPhase: 'alpha',
      runtimeProseParsing: false,
      plan: {
        path: 'implementation-plans/done/DEFERRED_MECHANICS_CLOSURE_PLAN.md',
        ticketsTotal: 92,
        ticketsDone: 92,
        currentTicket: 'NONE',
        blockers: 0,
        archived: true,
      },
    })

    const ledger = read(acceptance.plan.path)
    expect(ledger).toContain('`PLAN_STATUS: DONE`')
    expect(ledger).toContain('`CURRENT_TICKET: NONE`')
    expect(ledger).toContain('- Plan tickets: **92 DONE / 92 total**')
    expect(ledger.match(/^- \[x\] \*\*P11-\d{3}\b/gm)).toHaveLength(92)
    expect(ledger).not.toMatch(/^- \[ \] \*\*P11-\d{3}\b/gm)
    expect(ledger).toContain('**P11-092 — Record final acceptance and archive the plan** — `DONE`')
  })

  it('closes every known row without a deferred or forbidden final state', () => {
    const rows = inventory.rows as ReadonlyArray<Record<string, unknown>>
    expect(rows).toHaveLength(acceptance.closure.knownRows)
    expect(acceptance.closure).toMatchObject({
      knownRows: 29,
      finalRows: 29,
      nativeRows: 23,
      guidedRows: 4,
      reHomedRows: 1,
      verifiedRetiredRows: 1,
      deferredRows: 0,
      blockedRows: 0,
      definitionMissingRows: 0,
      proseInferredRows: 0,
      silentlyAbsentRows: 0,
      unregisteredRows: 0,
      orphanHandlers: 0,
      hardFailures: 0,
    })
    for (const row of rows) {
      if (row.kind !== 'hygiene') {
        expect(finalStates.has(String(row.currentState)), String(row.id)).toBe(true)
      }
      expect(forbiddenStates.has(String(row.currentState)), String(row.id)).toBe(false)
      expect(row.currentState, String(row.id)).toBe(row.targetState)
    }
    expect(rows.filter(row => row.currentState === 'native')).toHaveLength(acceptance.closure.nativeRows)
    expect(rows.filter(row => row.currentState === 'guided')).toHaveLength(acceptance.closure.guidedRows)
    expect(rows.filter(row => row.currentState === 're-homed')).toHaveLength(acceptance.closure.reHomedRows)
    expect(rows.filter(row => row.currentState === 'verified-or-retired')).toHaveLength(acceptance.closure.verifiedRetiredRows)
    expect(zeroDeferred.status).toBe('accepted')
    expect(zeroDeferred.counts).toMatchObject({
      knownCoreRows: 29,
      finalRows: 29,
      nonFinalRows: 0,
      knownDeferredRows: 0,
      knownBlockedRows: 0,
      definitionMissingRows: 0,
      proseInferredRows: 0,
      silentlyAbsentRows: 0,
      unregisteredRows: 0,
      orphanHandlers: 0,
      hardFailures: 0,
    })
  })

  it('binds every closure certificate to current bytes through accepted successors', () => {
    expect(acceptance.sourceEvidence.length).toBeGreaterThanOrEqual(16)
    for (const source of acceptance.sourceEvidence) {
      expect(acceptedSuccessorHead(source.path, source.sha256), source.path)
        .toBe(repositoryFileSha256(source.path))
    }
    expect(acceptance.validation).toEqual({
      integratedGoldenJourneys: 'passed',
      migrationAndUpgrade: 'passed',
      backupRestoreRestartReconnect: 'passed',
      accessibility: 'passed',
      performance: 'passed',
      privacyAndRoleProjection: 'passed',
      documentation: 'passed',
      driftAndForbiddenGap: 'passed',
      zeroDeferredProof: 'passed',
      fullRepositoryQualityGate: 'passed',
      desktopMobileProductionLiveplay: 'passed',
      multiClientConvergence: 'passed',
      visualReview: 'accepted',
      traceEvidence: 'complete',
    })
    expect(Object.values(acceptance.authorityAssertions)).not.toContain(undefined)
    expect(acceptance.authorityAssertions).toMatchObject({
      appOwnedCanonicalReferencesOnly: true,
      frozenHistoryPreservedByAcceptedSuccessors: true,
      parallelMechanicsAuthority: false,
      parallelPersistenceAuthority: false,
      browserOwnedRandomness: false,
      browserOwnedMechanicalMutation: false,
      postCommitRealtimeOnly: true,
      exactRetryAddsAuthority: false,
      changedMaterialRetryAccepted: false,
      roleSafeServerProjections: true,
      clientRedactionAuthority: false,
      manualStorageRepairRequired: false,
      liveplayOnly: true,
    })
  })

  it('archives Plan 11 consistently in the plan index and agent guidance', () => {
    const planOrder = read('implementation-plans/plan-order.md')
    const authoritativeTable = planOrder.slice(0, planOrder.indexOf('## 1.0 release definition'))
    const agents = read('AGENTS.md')

    expect(planOrder).toContain('| 11 | [Deferred Mechanics Closure](done/DEFERRED_MECHANICS_CLOSURE_PLAN.md) | `DONE` |')
    expect(planOrder).not.toContain('[Deferred Mechanics Closure](DEFERRED_MECHANICS_CLOSURE_PLAN.md)')
    // Accepted successor state (2026-08-25, chain migrations
    // deferred-closure:plan-12-activation-*-register:v1): Plan 12 is registered
    // `NOT_STARTED` behind an explicit owner start gate. The P11-092 boundary
    // this test protects — Plan 11 archived, nothing silently activated — holds.
    expect(authoritativeTable).toContain('| 12 | [GM Campaign Toolkit](GM_CAMPAIGN_TOOLKIT_PLAN.md) | `NOT_STARTED` |')
    expect(authoritativeTable).toContain('OWNER_START_GATE')
    expect(agents).toContain('Plans 1–11 are `DONE` and archived')
    expect(agents).toContain('registered `NOT_STARTED`')
    expect(agents).toContain('OWNER_START_GATE')
    expect(agents).toContain('implementation-plans/done/DEFERRED_MECHANICS_CLOSURE_PLAN.md')
  })

  it('carries the GM Campaign Toolkit scope into a registered owner-gated Plan 12 without implementation', () => {
    // The recorded P11-092 acceptance facts are immutable history.
    expect(acceptance.nextProspectivePlan).toEqual({
      order: 12,
      name: 'GM Campaign Toolkit',
      draftPath: 'implementation-plans/drafts/GM_CAMPAIGN_TOOLKIT_PLAN.md',
      draftStatus: 'REGISTERED_FOR_REVIEW',
      numberedLedgerRegistered: false,
      activated: false,
      executionObligation: false,
      dependsOnPlan11: true,
    })

    // Accepted successor state (2026-08-25, chain migration
    // deferred-closure:plan-12-activation-scope-draft-convert:v1): the reviewed
    // draft converted into the registered numbered ledger. The boundary this
    // test protects is unchanged: no implementation has occurred.
    const draft = read(acceptance.nextProspectivePlan.draftPath)
    const planOrder = read('implementation-plans/plan-order.md')
    const ledger = read('implementation-plans/GM_CAMPAIGN_TOOLKIT_PLAN.md')
    expect(draft).toContain('`DRAFT_STATUS: CONVERTED`')
    expect(draft).toContain('`AUTHORITATIVE_LEDGER: implementation-plans/GM_CAMPAIGN_TOOLKIT_PLAN.md`')
    expect(ledger).toContain('`PLAN_STATUS: NOT_STARTED`')
    expect(ledger).toContain('`BLOCKED_BY: OWNER_START_GATE`')
    expect(ledger.match(/^- \[ \] \*\*P12-\d{3}\b/gm)).toHaveLength(96)
    expect(ledger).not.toMatch(/^- \[x\] \*\*P12-\d{3}\b/gm)
    expect(planOrder).toContain('| 12 | [GM Campaign Toolkit](GM_CAMPAIGN_TOOLKIT_PLAN.md) | `NOT_STARTED` |')
  })

  it('accepts the alpha only when every final assertion holds', () => {
    expect(Object.values(acceptance.finalAssertions).every(Boolean)).toBe(true)
    expect(acceptance.finalAssertions).toMatchObject({
      everyTicketDone: true,
      planArchived: true,
      zeroKnownCoreMechanicsDebt: true,
      allGoldenJourneysPass: true,
      fullQualityGatePasses: true,
      desktopMobileLiveplayPasses: true,
      noCriticalUsabilityDefect: true,
      gmCampaignToolkitDraftRegisteredOnly: true,
      productPhaseRemainsAlpha: true,
    })
  })
})
