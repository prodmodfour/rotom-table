import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import grants from '../../data/complete-play-loop/equipment-grants.v1.json'
import inventory from '../../data/deferred-closure/closure-inventory.v1.json'
import rubric from '../../data/deferred-closure/completion-rubric.v1.json'

const inventoryById = new Map(inventory.rows.map(row => [row.id, row]))
const rubricById = new Map(rubric.rows.map(row => [row.rowId, row]))
const evidenceById = new Map(rubric.evidenceRegistry.map(row => [row.id, row]))
const allGrants = grants.definitions.flatMap(definition => definition.grants)

describe('P11-008 completion rubric and evidence registry', () => {
  it('binds every inventory row exactly once to target, owner, and evidence', () => {
    expect(rubric).toMatchObject({ schemaVersion: 1, ticket: 'P11-008', status: 'reviewed' })
    expect(rubric.rows).toHaveLength(inventory.rows.length)
    expect(new Set(rubric.rows.map(row => row.rowId))).toEqual(new Set(inventory.rows.map(row => row.id)))
    for (const row of rubric.rows) {
      const source = inventoryById.get(row.rowId)!
      expect(row.targetState, row.rowId).toBe(source.targetState)
      expect(source.owningTickets, row.rowId).toContain(row.closureTicket)
      expect(row.allowedFinalStates).toContain(row.targetState)
      expect(row.requiredEvidenceIds.length).toBeGreaterThan(0)
      for (const evidenceId of row.requiredEvidenceIds) expect(evidenceById.has(evidenceId), evidenceId).toBe(true)
    }
  })

  it('registers every activation debt and no unknown grant debt', () => {
    const registeredGrantIds = new Set(inventory.rows.flatMap(row => 'grantId' in row ? [row.grantId] : []))
    const debt = allGrants.filter(grant => 'executionStatus' in grant && !rubric.completionStates.includes(grant.executionStatus as any))
    for (const grant of debt) expect(registeredGrantIds.has(grant.grantId), grant.grantId).toBe(true)
    expect(rubric.progressPolicy).toEqual({
      activationDebtMayRemainOnlyWhenRegisteredInInventory: true,
      newDebtFailsImmediately: true,
      requireCompleteFlagEnforcesFinalStates: true,
    })
  })

  it('forbids every debt flavor at final acceptance', () => {
    expect(rubric.forbiddenFinalTokens).toEqual(expect.arrayContaining([
      'definition-missing', 'deferred', 'blocked', 'reference-only-deferral',
      'visible-with-reason', 'prose-inferred', 'silently-absent',
    ]))
    expect(rubric.finalAcceptance).toMatchObject({
      ticket: 'P11-089',
      requiredCommand: 'python3 scripts/check_deferred_closure.py --require-complete',
      requiredCounts: { rows: 29, nonFinal: 0, unregisteredDebt: 0, blocked: 0 },
    })
  })

  it('keeps passing evidence real and planned evidence ticket-owned', () => {
    for (const entry of rubric.evidenceRegistry) {
      if (entry.status === 'passing') expect(existsSync(entry.path), entry.path).toBe(true)
      else expect(entry).toMatchObject({ status: 'planned', ownerTicket: expect.stringMatching(/^P11-0\d\d$/) })
    }
  })

  it('passes the progress gate but refuses final acceptance while registered debt remains', () => {
    const report = JSON.parse(execFileSync('python3', ['scripts/check_deferred_closure.py', '--json'], { encoding: 'utf8' }))
    expect(report).toMatchObject({ rows: 29, final: 27, nonFinal: 2, unregisteredDebt: 0, errors: [] })
    const final = spawnSync('python3', ['scripts/check_deferred_closure.py', '--require-complete'], { encoding: 'utf8' })
    expect(final.status).not.toBe(0)
    expect(`${final.stdout}${final.stderr}`).toContain('non-final state')
  })

  it('uses the grants, canonical Contest rows, and inventory as finality surfaces', () => {
    expect(rubric.auditedSurfaces).toEqual(inventory.finalityDecision.readSurfaces)
    expect(rubricById.get('weapon-profile.hunting-bow')?.allowedFinalStates).toEqual(['native'])
    expect(rubricById.get('item-action.old-rod.fish')?.allowedFinalStates).toEqual(['guided', 'native'])
  })
})
