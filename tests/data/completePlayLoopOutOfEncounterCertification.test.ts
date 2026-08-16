import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import certificationJson from '../../data/complete-play-loop/out-of-encounter-item-certification.v1.json'
import itemFixturesJson from '../../data/complete-play-loop/fixtures/items.v1.json'
import { stableJsonStringify } from '#shared/automation/stableJson'

const root = resolve(import.meta.dirname, '../..')
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const certification = certificationJson as any

describe('P8-060 out-of-encounter item certification', () => {
  it('binds one current evidence-only certificate to all required workflow categories', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1, ticket: 'P8-060',
      definition: {
        status: 'certified-current-semantics',
        authority: 'acceptance-evidence-only-no-runtime-mechanics',
        summary: {
          journeyCount: 8, evidenceTestCount: 30, manualRepairRequired: false,
          directJsonRepairAllowed: false, directDatabaseRepairAllowed: false,
        },
      },
    })
    expect(certification.definitionSha256).toBe(sha256(`${stableJsonStringify(certification.definition)}\n`))
    expect(certification.definition.requiredCategories).toEqual([
      'medical', 'training', 'move-learning', 'evolution', 'exploration', 'breeding-related', 'guided', 'recovery',
    ])
    expect(certification.definition.journeys.map((row: any) => row.category))
      .toEqual(certification.definition.requiredCategories)
    expect(new Set(certification.definition.journeys.map((row: any) => row.id)).size).toBe(8)
  })

  it('rejects source or executable-evidence drift and certifies every named fixture', () => {
    const fixtureIds = new Set((itemFixturesJson.fixtures as any[]).map(row => row.id))
    for (const binding of certification.definition.sourceBindings) {
      expect(sha256(readFileSync(resolve(root, binding.path))), binding.path).toBe(binding.sha256)
    }
    const testPaths = new Set<string>()
    for (const journey of certification.definition.journeys) {
      expect(journey.manualRepairRequired, journey.id).toBe(false)
      expect(journey.guarantees.length, journey.id).toBeGreaterThanOrEqual(5)
      for (const fixtureId of journey.fixtures) expect(fixtureIds.has(fixtureId), fixtureId).toBe(true)
      for (const evidence of journey.evidenceTests) {
        testPaths.add(evidence.path)
        expect(evidence.path).toMatch(/^tests\/(?:server|integration|composables|e2e)\/.+\.(?:test|spec)\.ts$/u)
        expect(sha256(readFileSync(resolve(root, evidence.path))), evidence.path).toBe(evidence.sha256)
      }
    }
    expect(testPaths.size).toBe(certification.definition.summary.evidenceTestCount)
    expect([...testPaths].some(path => path.startsWith('tests/e2e/'))).toBe(true)
    expect([...testPaths]).toContain('tests/integration/outOfEncounterItemRecovery.test.ts')
  })

  it('closes cancellation, stale, reconnect, restart, uncertain retry, and manual-repair boundaries', () => {
    const recovery = certification.definition.journeys.find((row: any) => row.category === 'recovery')
    expect(recovery.guarantees).toEqual(certification.definition.requiredRecovery)
    expect(recovery.guarantees).toEqual([
      'cancellation', 'stale-revision', 'reconnect', 'process-restart', 'uncertain-exact-retry', 'no-manual-repair',
    ])
    expect(certification.definition.journeys.every((row: any) => row.guarantees.includes('exact-replay')
      || row.category === 'recovery')).toBe(true)
  })
})
