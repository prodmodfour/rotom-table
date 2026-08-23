import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/item-action-recovery-certification.v1.json'
import failureFixtures from '../../data/deferred-closure/failure-recovery-fixtures.v1.json'
import matrix from '../../data/deferred-closure/item-action-matrix.v1.json'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const evidenceById = new Map(certification.evidenceRegistry.map(row => [row.id, row]))
const matrixByActionId = new Map(matrix.rows.map(row => [row.actionId, row]))
const itemFailureBySurfaceId = new Map(failureFixtures.surfaces
  .filter(row => row.kind === 'item-action')
  .map(row => [row.surfaceId, row]))

describe('P11-043 item-action recovery and concurrency certification', () => {
  it('binds the reviewed action and failure fixtures plus every execution authority by exact hash', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1,
      certificationId: 'deferred-closure-item-action-recovery-v1',
      ticket: 'P11-043',
      status: 'certified',
      runtimeProseParsing: false,
    })
    for (const source of certification.sourceFixtures) {
      expect(sha256(source.path), source.path).toBe(source.sha256)
    }
    for (const authority of certification.authorities) {
      expect(sha256(authority.path), authority.path).toBe(authority.sha256)
      expect(authority.guarantees.length, authority.id).toBeGreaterThanOrEqual(3)
    }
  })

  it('covers exactly all eleven frozen item actions in their reviewed final state', () => {
    expect(certification.actions).toHaveLength(11)
    expect(certification.actions.map(row => row.actionId).sort())
      .toEqual(matrix.rows.map(row => row.actionId).sort())
    expect(certification.actions.map(row => row.surfaceId).sort())
      .toEqual([...itemFailureBySurfaceId.keys()].sort())
    for (const action of certification.actions) {
      const matrixRow = matrixByActionId.get(action.actionId)!
      expect(action).toMatchObject({
        actionId: matrixRow.actionId,
        canonicalItemId: matrixRow.canonicalItemId,
        finalState: matrixRow.finalState,
      })
      expect(['native', 'guided']).toContain(action.finalState)
      expect(new Set(action.evidenceIds).size, action.actionId).toBe(action.evidenceIds.length)
    }
  })

  it('supplies executable evidence for every required recovery scenario on every action', () => {
    expect(certification.requiredScenarioIds).toEqual([
      'stale-revision',
      'duplicate-delivery',
      'reconnect-pending',
      'server-restart-pending',
      'interrupted-atomic-commit',
    ])
    for (const action of certification.actions) {
      const fixture = itemFailureBySurfaceId.get(action.surfaceId)!
      expect(fixture.requiredScenarioIds, action.surfaceId)
        .toEqual(expect.arrayContaining(certification.requiredScenarioIds))
      const covered = new Set(action.evidenceIds.flatMap((id) => {
        const evidence = evidenceById.get(id)
        expect(evidence, `${action.actionId}:${id}`).toBeDefined()
        return evidence?.scenarioIds ?? []
      }))
      expect([...covered].sort(), action.actionId).toEqual([...certification.requiredScenarioIds].sort())
    }
  })

  it('pins passing tests and proves each action identity is exercised by its named evidence', () => {
    for (const evidence of certification.evidenceRegistry) {
      expect(sha256(evidence.path), evidence.path).toBe(evidence.sha256)
      expect(evidence.path).toMatch(/^tests\/server\/.+\.test\.ts$/u)
      expect(evidence.guarantees.length, evidence.id).toBeGreaterThanOrEqual(3)
    }
    for (const action of certification.actions) {
      const source = action.evidenceIds
        .map(id => readFileSync(evidenceById.get(id)!.path, 'utf8'))
        .join('\n')
      expect(source, action.actionId).toContain(action.actionId)
    }
  })

  it('certifies client-attributed convergence for both shields and both restraint families', () => {
    const durableActionIds = new Set(certification.crossClientConvergence.flatMap(row => row.actionIds))
    expect(durableActionIds).toEqual(new Set([
      'equipment.light-shield.ready',
      'equipment.heavy-shield.ready',
      'equipment.hand-net.attack',
      'equipment.weighted-nets.throw',
      'equipment.weighted-nets.pull',
    ]))
    for (const journey of certification.crossClientConvergence) {
      expect(evidenceById.has(journey.evidenceId), journey.stateFamily).toBe(true)
      expect(journey.requiredFacts).toContain('exact-replay-emits-no-event')
      expect(journey.requiredFacts.some(fact => fact.includes('map-revision'))).toBe(true)
    }
  })

  it('forbids repair, duplicate spend, partial commit, and private realtime authority', () => {
    expect(certification.acceptance).toEqual({
      actionCount: 11,
      uncoveredActionCount: 0,
      uncoveredScenarioCount: 0,
      manualRepairRequired: false,
      duplicateRollAllowed: false,
      duplicateSpendAllowed: false,
      partialCommitAllowed: false,
      privateAuthorityInRealtimeAllowed: false,
    })
  })
})
