import { describe, expect, it } from 'vitest'
import matrix from '../../data/deferred-closure/item-action-matrix.v1.json'
import fixtures from '../../data/deferred-closure/mechanics-acceptance-fixtures.v1.json'
import grants from '../../data/complete-play-loop/equipment-grants.v1.json'

const auditedActionIds = new Set(matrix.rows.map(row => row.actionId))
const grantActions = grants.definitions.flatMap(definition => definition.grants
  .filter(grant => grant.kind === 'action' && auditedActionIds.has(grant.actionId))
  .map(grant => ({ canonicalItemId: definition.canonicalItemId, ...grant })))

describe('P11-031 frozen item-action closure matrix', () => {
  it('owns exactly the eleven canonical deferred actions without a reference-only target', () => {
    expect(matrix.schemaVersion).toBe(1)
    expect(matrix.ticket).toBe('P11-031')
    expect(matrix.status).toBe('frozen')
    expect(matrix.runtimeProseParsing).toBe(false)
    expect(matrix.rows).toHaveLength(11)
    expect(new Set(matrix.rows.map(row => row.actionId)).size).toBe(11)
    expect(new Set(matrix.rows.map(row => row.finalState))).toEqual(new Set(['native', 'guided']))
    expect(matrix.rows.map(row => row.actionId).sort()).toEqual(
      grantActions.map(row => row.actionId).sort(),
    )
  })

  it('binds custody, timing, duration, resources, privacy, and owning tickets for every row', () => {
    for (const row of matrix.rows) {
      expect(row.custody).toMatch(/active-hash-current|same-source/)
      expect(row.timing).toMatch(/^(?:standard|swift|extended)$/)
      expect(row.duration.length).toBeGreaterThan(0)
      expect(row.resources.length).toBeGreaterThan(0)
      expect(row.privateFacts.length).toBeGreaterThan(0)
      expect(row.closureTicket).toMatch(/^P11-0(?:32|33|34|35|36|38|40)$/)
      expect(grantActions).toContainEqual(expect.objectContaining({
        actionId: row.actionId,
        canonicalItemId: row.canonicalItemId,
        executionStatus: 'native',
        finalState: row.finalState,
        deferredTicket: null,
      }))
    }
  })

  it('matches every deterministic item fixture and its reviewed final state', () => {
    expect(fixtures.itemActions).toHaveLength(11)
    for (const fixture of fixtures.itemActions) {
      expect(matrix.rows).toContainEqual(expect.objectContaining({
        actionId: fixture.actionId,
        canonicalItemId: fixture.source.canonicalItemId,
        finalState: fixture.expected.finalState,
      }))
    }
  })
})
