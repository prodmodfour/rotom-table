import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import criteria from '../../data/encounter-workspace/ux-success-criteria.json'
import fixtureIndex from '../../data/encounter-workspace/fixtures/index.json'
import report from '../../data/encounter-workspace/synthetic-acceptance.v1.json'

const ROOT = resolve(import.meta.dirname, '../..')
const sha256 = (path: string): string => createHash('sha256').update(readFileSync(resolve(ROOT, path))).digest('hex')
const compare = (operator: string, measured: number, target: number): boolean => {
  if (operator === '>=') return measured >= target
  if (operator === '<=') return measured <= target
  if (operator === '=') return measured === target
  if (operator === 'review') return true
  throw new Error(`Unknown acceptance target operator ${operator}.`)
}

describe('encounter workspace synthetic release acceptance', () => {
  it('is source-hash-bound to the reviewed criteria, fixtures, budgets, and rollout contract', () => {
    expect(report.sourceHashes).toEqual({
      criteriaSha256: sha256('data/encounter-workspace/ux-success-criteria.json'),
      fixtureIndexSha256: sha256('data/encounter-workspace/fixtures/index.json'),
      performanceBudgetsSha256: sha256('data/encounter-workspace/performance-budgets.json'),
      rolloutSha256: sha256('data/encounter-workspace/rollout.v1.json'),
    })
    expect(report.scope).toBe('synthetic-release-gate')
    expect(report.disclaimer).toMatch(/not a substitute for post-rollout field observation/i)
  })

  it('runs every canonical script once without synthetic facilitator rescue', () => {
    expect(report.fixtureRuns.map(run => run.fixtureId)).toEqual(fixtureIndex.fixtures.map(fixture => fixture.fixtureId))
    for (const indexed of fixtureIndex.fixtures) {
      const fixture = JSON.parse(readFileSync(resolve(ROOT, indexed.path), 'utf8')) as { scripts: Array<{ id: string }> }
      const run = report.fixtureRuns.find(candidate => candidate.fixtureId === indexed.fixtureId)!
      expect(run.scriptIds).toEqual(fixture.scripts.map(script => script.id))
      expect(run.attempted).toBe(fixture.scripts.length)
      expect(run.completed).toBe(run.attempted)
      expect(run.facilitatorRescues).toBe(0)
    }
  })

  it('compares every measured result to the versioned target and retains review evidence', () => {
    expect(report.results.map(result => result.criterionId).sort()).toEqual(criteria.criteria.map(criterion => criterion.id).sort())
    expect(new Set(report.results.map(result => result.criterionId)).size).toBe(report.results.length)
    for (const criterion of criteria.criteria) {
      const result = report.results.find(candidate => candidate.criterionId === criterion.id)!
      expect(Number.isFinite(result.value), criterion.id).toBe(true)
      expect(compare(criterion.target.operator, result.value, criterion.target.value), criterion.id).toBe(true)
      expect(result.status, criterion.id).toBe(criterion.target.operator === 'review' ? 'reviewed' : 'pass')
      expect(result.evidence.length, criterion.id).toBeGreaterThan(0)
      for (const evidence of result.evidence) expect(existsSync(resolve(ROOT, evidence)), `${criterion.id}: ${evidence}`).toBe(true)
    }
    const failedReleaseGates = criteria.criteria.filter(criterion => criterion.releaseGate).filter((criterion) => {
      const result = report.results.find(candidate => candidate.criterionId === criterion.id)!
      return result.status !== 'pass'
    })
    expect(failedReleaseGates).toEqual([])
  })
})
