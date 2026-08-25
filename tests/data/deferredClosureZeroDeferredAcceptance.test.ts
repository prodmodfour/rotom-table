import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import acceptance from '../../data/deferred-closure/zero-deferred-acceptance.v1.json'
import inventory from '../../data/deferred-closure/closure-inventory.v1.json'
import rubric from '../../data/deferred-closure/completion-rubric.v1.json'
import grants from '../../data/complete-play-loop/equipment-grants.v1.json'
import contributions from '../../data/complete-play-loop/equipment-contributions.v1.json'
import cohorts from '../../data/complete-play-loop/item-catalog-cohorts.v1.json'
import contests from '../../data/reference/contests.json'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'

const verify = (binding: { path: string, sha256: string }): void => {
  expect(acceptedSuccessorHead(binding.path, binding.sha256), binding.path)
    .toBe(repositoryFileSha256(binding.path))
}
const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => (
    `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`
  )).join(',')}}`
  return JSON.stringify(value)
}
const stableSha256 = (value: unknown): string => createHash('sha256').update(stableJson(value)).digest('hex')
const allGrants = grants.definitions.flatMap(definition => definition.grants)
const grantById = new Map(allGrants.map(grant => [grant.grantId, grant]))
const variants = new Map(contests.variants.map(variant => [variant.id, variant]))

describe('P11-089 zero-deferred closure acceptance', () => {
  it('publishes exactly 29 final reviewed rows and no forbidden final count', () => {
    expect(acceptance).toMatchObject({
      schemaVersion: 1,
      acceptanceId: 'deferred-mechanics-zero-deferred-v1',
      ticket: 'P11-089',
      status: 'accepted',
      runtimeProseParsing: false,
      nextTicket: 'P11-090',
    })
    expect(acceptance.counts).toEqual({
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
    expect(acceptance.rows).toHaveLength(29)
    expect(new Set(acceptance.rows.map(row => row.rowId)).size).toBe(29)
    expect(acceptance.rows.every(row => row.finalState === row.targetState)).toBe(true)
    expect(new Set(acceptance.rows.map(row => row.finalState))).toEqual(new Set([
      'native', 'guided', 're-homed', 'verified-or-retired',
    ]))
  })

  it('matches every final app-owned registry state rather than trusting prose or the browser', () => {
    expect(inventory).toMatchObject({ status: 'final-acceptance', finalizedBy: 'P11-089' })
    for (const accepted of acceptance.rows) {
      const row = inventory.rows.find(candidate => candidate.id === accepted.rowId)!
      expect(accepted).toEqual({
        rowId: row.id,
        kind: row.kind,
        finalState: row.currentState,
        targetState: row.targetState,
        closureEvidenceId: row.closureEvidenceId,
      })
      if ('grantId' in row) {
        const grant = grantById.get(row.grantId)!
        expect(grant.finalState ?? grant.executionStatus, row.id).toBe(accepted.finalState)
        expect('deferredTicket' in grant ? grant.deferredTicket : null, row.id).toBeNull()
      }
      if (row.kind === 'contest-variant') {
        expect(variants.get(row.id.replace('contest-variant.', ''))?.completionState, row.id).toBe('native')
      }
    }
    expect(cohorts.cohorts.every(cohort => cohort.implementationState !== 'blocked')).toBe(true)
    expect(cohorts.cohorts.every(cohort => cohort.unresolvedRequirements.length === 0)).toBe(true)
  })

  it('classifies every inert legacy contribution owner marker exactly without hiding core debt', () => {
    const rows = contributions.definitions
      .filter(row => row.deferredMechanics.length > 0)
      .map(row => ({ canonicalItemId: row.canonicalItemId, markers: row.deferredMechanics }))
    expect(acceptance.legacyRegistryMarkers).toMatchObject({
      registryPath: 'data/complete-play-loop/equipment-contributions.v1.json',
      field: 'deferredMechanics',
      disposition: 'inert-delegated-owner-marker-not-finality',
      markerCount: rows.length,
      openCoreDebtCount: 0,
      rows,
    })
    expect(acceptance.legacyRegistryMarkers.rows).toEqual(rows)
    expect(acceptance.legacyRegistryMarkers.rowsSha256).toBe(stableSha256(rows))
  })

  it('binds all registries, executable evidence, and the completed predecessor ledgers', () => {
    expect(new Set(acceptance.authorityBindings.map(row => row.path))).toEqual(new Set([
      'data/deferred-closure/closure-inventory.v1.json',
      'data/deferred-closure/completion-rubric.v1.json',
      'data/deferred-closure/drift-forbidden-gap-gate.v1.json',
      'data/complete-play-loop/equipment-grants.v1.json',
      'data/complete-play-loop/equipment-contributions.v1.json',
      'data/complete-play-loop/item-catalog-cohorts.v1.json',
      'data/deferred-closure/item-action-matrix.v1.json',
      'data/reference/contests.json',
      'shared/capabilityAutomation/weaponMoves.ts',
      'shared/skillChecks/contract.ts',
      'scripts/generate_deferred_closure_inventory.py',
      'scripts/generate_zero_deferred_acceptance.py',
      'scripts/check_deferred_closure.py',
    ]))
    for (const binding of acceptance.authorityBindings) verify(binding)
    for (const binding of acceptance.evidenceBindings) verify(binding)
    expect(new Set(acceptance.passingEvidenceIds)).toEqual(new Set(rubric.evidenceRegistry.map(row => row.id)))
    expect(rubric.evidenceRegistry.every(row => row.status === 'passing')).toBe(true)
    expect(acceptance.ledgerAudit).toEqual({
      path: 'implementation-plans/plan-order.md',
      completedPredecessorPlans: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      registeredClosurePlan: 11,
      knownUnregisteredMechanicsLedgers: 0,
    })
  })

  it('regenerates byte-identically and passes the strict successor-aware completion command', () => {
    execFileSync('python3', ['scripts/generate_deferred_closure_inventory.py', '--check'])
    execFileSync('python3', ['scripts/generate_zero_deferred_acceptance.py', '--check'])
    const report = JSON.parse(execFileSync('python3', [
      'scripts/check_deferred_closure.py', '--require-complete', '--check-drift', '--json',
    ], { encoding: 'utf8' }))
    expect(report).toMatchObject({
      rows: 29,
      final: 29,
      nonFinal: 0,
      unregisteredDebt: 0,
      requireComplete: true,
      checkDrift: true,
      errors: [],
    })
  })
})
