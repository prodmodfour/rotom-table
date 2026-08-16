import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import acceptance from '../../data/complete-play-loop/concurrency-failure-acceptance.v1.json'

const root = resolve(import.meta.dirname, '../..')
const sha256 = (value: Buffer): string => createHash('sha256').update(value).digest('hex')

describe('P8-097 concurrency, reconnect, restart, and failure acceptance', () => {
  it('covers every required failure scenario with current executable evidence', () => {
    expect(acceptance).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-097',
      status: 'accepted',
      manualStorageRepairRequired: false,
      automaticReconnectReplayAllowed: false,
    })
    expect(acceptance.scenarios.map(row => row.scenarioId)).toEqual([
      'duplicate-commands',
      'stale-inventories',
      'moved-rows',
      'pending-choices',
      'reservations',
      'server-restart',
      'tab-echo-and-reconnect',
      'partial-transaction-failure',
      'settlement-retry',
      'correction',
    ])
    for (const scenario of acceptance.scenarios) {
      expect(scenario.expected.length, scenario.scenarioId).toBeGreaterThan(60)
      expect(scenario.evidenceTests.length, scenario.scenarioId).toBeGreaterThan(0)
      expect(new Set(scenario.evidenceTests).size).toBe(scenario.evidenceTests.length)
      for (const path of scenario.evidenceTests) expect(readFileSync(resolve(root, path), 'utf8').length).toBeGreaterThan(500)
    }
  })

  it('proves exactly-once ownership for every item-to-continuation asset', () => {
    expect(acceptance.exactlyOnceGuarantees.map(row => row.asset)).toEqual([
      'item',
      'reward',
      'effect',
      'capture',
      'experience',
      'attention-decision',
      'realtime-delivery',
    ])
    for (const guarantee of acceptance.exactlyOnceGuarantees) {
      expect(guarantee.owner.length, guarantee.asset).toBeGreaterThan(20)
      expect(guarantee.evidenceTests.length, guarantee.asset).toBeGreaterThan(0)
    }
  })

  it('keeps retained-command and conflict recovery explicitly user-controlled', () => {
    expect(acceptance.failurePolicy).toEqual({
      unknownOutcome: 'retain-exact-command',
      reconnect: 'status-check-only-no-auto-replay',
      conflict: 'reload-current-authority-and-redeclare',
      crossTab: 'one-durable-scope-lock',
      partialWrite: 'rollback-entire-transaction',
      correction: 'append-only-gm-authority',
      privacy: 'project-safe-status-without-operation-or-row-evidence',
    })
    expect(JSON.stringify(acceptance)).not.toContain('retry-on-reconnect')
    expect(JSON.stringify(acceptance)).not.toContain('manual-storage-repair')
  })

  it('hash-binds every runtime and test authority named by the matrix', () => {
    const evidence = new Map<string, string>()
    for (const row of acceptance.sourceEvidence) {
      expect(evidence.has(row.path), row.path).toBe(false)
      evidence.set(row.path, row.sha256)
      expect(row.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(sha256(readFileSync(resolve(root, row.path))), row.path).toBe(row.sha256)
    }
    const matrixTests = new Set([
      ...acceptance.scenarios.flatMap(row => row.evidenceTests),
      ...acceptance.exactlyOnceGuarantees.flatMap(row => row.evidenceTests),
    ])
    for (const path of matrixTests) expect(evidence.has(path), path).toBe(true)
    for (const required of [
      'server/useCases/executeItemOperation.ts',
      'server/useCases/applyThrowPokeballCommand.ts',
      'server/domain/encounterSettlement/atomicCommit.ts',
      'server/useCases/commitEncounterSettlement.ts',
      'server/domain/encounterSettlement/correction.ts',
      'src/utils/inventoryRecoveryStorage.ts',
      'src/utils/encounterSettlementOperationStorage.ts',
      'tests/data/completePlayLoopConcurrencyFailureAcceptance.test.ts',
      'docs/complete-play-loop-concurrency-reconnect-failure.md',
      'package.json',
      'scripts/quality-gate.sh',
    ]) expect(evidence.has(required), required).toBe(true)
  })
})
