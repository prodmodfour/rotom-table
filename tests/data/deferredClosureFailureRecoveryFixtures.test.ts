import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import fixtures from '../../data/deferred-closure/failure-recovery-fixtures.v1.json'
import inventory from '../../data/deferred-closure/closure-inventory.v1.json'

const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const mechanicsIds = inventory.rows.filter(row => row.kind !== 'hygiene').map(row => row.id)
const scenarioIds = new Set([
  ...fixtures.scenarioTemplates.map(row => row.scenarioId),
  ...fixtures.battleContestDualEngineFixtures.map(row => row.scenarioId),
])

describe('P11-010 failure, concurrency, and recovery fixtures', () => {
  it('covers every mechanics surface exactly once', () => {
    expect(fixtures).toMatchObject({ schemaVersion: 1, ticket: 'P11-010', status: 'reviewed', deterministic: true })
    expect(fixtures.counts).toEqual({ surfaces: 27, scenarioTemplates: 5, dualEngineFixtures: 4 })
    expect(fixtures.surfaces).toHaveLength(mechanicsIds.length)
    expect(new Set(fixtures.surfaces.map(row => row.surfaceId))).toEqual(new Set(mechanicsIds))
    expect(new Set(fixtures.surfaces.map(row => row.seed)).size).toBe(fixtures.surfaces.length)
    expect(sha(fixtures.sourceFixtures.path)).toBe(fixtures.sourceFixtures.sha256)
  })

  it('requires stale, duplicate, reconnect, and restart coverage on every surface', () => {
    const baseline = ['stale-revision', 'duplicate-delivery', 'reconnect-pending', 'server-restart-pending']
    for (const surface of fixtures.surfaces) {
      expect(surface.requiredScenarioIds, surface.surfaceId).toEqual(expect.arrayContaining(baseline))
      for (const scenarioId of surface.requiredScenarioIds) expect(scenarioIds.has(scenarioId), `${surface.surfaceId}:${scenarioId}`).toBe(true)
      expect(surface.retryExpectation).toContain('no-new-roll-spend-or-revision')
      expect(surface.rollbackExpectation).toContain('commits-no-mechanical-document')
    }
  })

  it('defines structurally distinct public, owner, and GM projections per surface', () => {
    for (const surface of fixtures.surfaces) {
      const { public: publicFields, owner, gm } = surface.projections
      expect(publicFields.length).toBeGreaterThan(0)
      expect(owner.length).toBeGreaterThan(0)
      expect(gm.length).toBeGreaterThan(owner.length)
      expect(publicFields).not.toEqual(owner)
      expect(owner).not.toEqual(gm)
      expect(publicFields.join(' ')).not.toMatch(/diagnostic|read-set|gm-notes|all-modifiers/)
      expect(owner.join(' ')).not.toMatch(/diagnostic|read-set|gm-notes|all-modifiers/)
      expect(gm.join(' ')).toMatch(/diagnostic|read-set|gm-notes|all-modifiers|all-journals/)
    }
  })

  it('pins rollback and exact-retry outcomes without rerolls or double spending', () => {
    expect(fixtures.scenarioTemplates.find(row => row.scenarioId === 'stale-revision')?.expected)
      .toMatchObject({ status: 'conflict', reroll: false, resourceSpend: 0, revisionDelta: 0, rollback: 'complete' })
    expect(fixtures.scenarioTemplates.find(row => row.scenarioId === 'duplicate-delivery')?.expected)
      .toMatchObject({ status: 'exact-retry', sameResult: true, reroll: false, revisionDelta: 0 })
    expect(fixtures.scenarioTemplates.find(row => row.scenarioId === 'reconnect-pending')?.expected)
      .toMatchObject({ reroll: false, duplicateSpend: false })
    expect(fixtures.scenarioTemplates.find(row => row.scenarioId === 'interrupted-atomic-commit')?.expected)
      .toMatchObject({ status: 'rolled-back', resourceSpend: 0, revisionDelta: 0, historyRows: 0, realtimeRows: 0 })
  })

  it('binds Battle Contest fixtures to both documents and forbids partial cross-engine state', () => {
    const battle = fixtures.surfaces.find(row => row.surfaceId === 'contest-variant.battle')!
    expect(battle.authorityDocuments).toEqual(['contest', 'encounter'])
    expect(battle.requiredScenarioIds).toEqual(expect.arrayContaining([
      'dual-engine-stale-contest', 'dual-engine-stale-encounter',
      'dual-engine-duplicate-handoff', 'dual-engine-interrupted-settlement',
    ]))
    const stale = fixtures.battleContestDualEngineFixtures.filter(row => row.scenarioId.includes('stale'))
    expect(stale).toHaveLength(2)
    for (const row of stale) expect(row.expected).toMatchObject({ appealDelta: 0, writes: [] })
    expect(fixtures.battleContestDualEngineFixtures.find(row => row.scenarioId === 'dual-engine-duplicate-handoff')?.expected)
      .toMatchObject({ exactRetry: true, appealApplications: 1, contestDiceSpend: 1, encounterResourceSpend: 0, rollJournals: 1 })
    expect(fixtures.battleContestDualEngineFixtures.find(row => row.scenarioId === 'dual-engine-interrupted-settlement')?.expected)
      .toMatchObject({ contestRewards: 0, encounterRewards: 0, sheetWrites: 0, historyRows: 0 })
  })

  it('states one transactional and server-randomness policy for every engine', () => {
    expect(fixtures.policies).toMatchObject({
      serverOwnsRandomness: true,
      operationKey: 'operation-id-plus-command-hash',
      revisionPolicy: 'exact-read-set-before-write',
      projectionPolicy: 'structurally-distinct-server-projections',
    })
    expect(fixtures.policies.transactionPolicy).toContain('or-none')
  })
})
