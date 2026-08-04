import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import taskInventory from '../../data/encounter-workspace/encounter-task-inventory.json'
import criteriaJson from '../../data/encounter-workspace/ux-success-criteria.json'

const ROOT = resolve(import.meta.dirname, '../..')
const VALID_OPERATORS = new Set(['=', '<=', '>=', 'review'])
const REQUIRED_CRITERIA = [
  'task-completion-critical',
  'action-discovery-time',
  'action-activation-input-count',
  'response-completion-time',
  'non-spatial-forced-lens-rate',
  'exact-spatial-lens-coverage',
  'safe-recovery-time',
  'unsafe-duplicate-mutations',
  'private-choice-leaks',
  'serious-accessibility-violations',
  'keyboard-task-coverage',
  'touch-target-conformance',
  'table-distance-readability',
  'workspace-adapter-budget',
  'workspace-interaction-latency',
  'tactical-lens-startup',
  'large-encounter-frame-rate',
  'overlay-collision-count',
] as const

const isValidTarget = (target: { operator: string, value: number }): boolean => (
  VALID_OPERATORS.has(target.operator)
  && Number.isFinite(target.value)
  && target.value >= 0
)

describe('encounter workspace UX success criteria', () => {
  it('links measurable, privacy-safe criteria to frozen tasks and canonical fixtures', () => {
    expect(criteriaJson).toMatchObject({
      schemaVersion: 1,
      criteriaId: 'encounter-ux-success-v1',
      designAuthority: 'DESIGN.md',
      baselineEvidenceTicket: 'EUX-009',
    })
    expect(criteriaJson.criteria).toHaveLength(25)
    expect(new Set(criteriaJson.criteria.map(criterion => criterion.id)).size).toBe(25)
    expect(criteriaJson.privacyPolicy.storeRawParticipantIds).toBe(false)
    expect(criteriaJson.privacyPolicy.storeRulesChoiceValues).toBe(false)
    expect(criteriaJson.privacyPolicy.storePrivatePrompts).toBe(false)

    const taskIds = new Set(taskInventory.tasks.map(task => task.id))
    const fixtureIds = new Set(criteriaJson.canonicalFixtures)
    const plan = readFileSync(resolve(ROOT, 'implementation-plans/done/ENCOUNTER_UI_UX_PLAN.md'), 'utf8')
    expect(plan).toContain('**EUX-009 ')

    for (const criterion of criteriaJson.criteria) {
      expect(criterion.taskIds.length, criterion.id).toBeGreaterThan(0)
      expect(criterion.taskIds.every(taskId => taskIds.has(taskId)), criterion.id).toBe(true)
      expect(criterion.fixtures.length, criterion.id).toBeGreaterThan(0)
      expect(criterion.fixtures.every(fixtureId => fixtureIds.has(fixtureId)), criterion.id).toBe(true)
      expect(criterion.measurement.trim(), criterion.id).not.toBe('')
      expect(criterion.metric.trim(), criterion.id).not.toBe('')
      expect(criterion.unit.trim(), criterion.id).not.toBe('')
      expect(criterion.aggregation.trim(), criterion.id).not.toBe('')
      expect(isValidTarget(criterion.target), criterion.id).toBe(true)
      if ('guardrail' in criterion) expect(isValidTarget(criterion.guardrail), criterion.id).toBe(true)
      expect(['pending', 'automated-existing']).toContain(criterion.baseline.status)
      if (criterion.baseline.status === 'pending') expect(criterion.baseline.ticket).toBe('EUX-009')
    }
  })

  it('gates every required UX, safety, privacy, accessibility, and performance outcome', () => {
    const byId = new Map(criteriaJson.criteria.map(criterion => [criterion.id, criterion]))
    for (const id of REQUIRED_CRITERIA) {
      expect(byId.has(id), id).toBe(true)
      expect(byId.get(id)?.releaseGate, id).toBe(true)
    }

    const categories = new Set(criteriaJson.criteria.map(criterion => criterion.category))
    expect(categories).toEqual(new Set([
      'task-success',
      'action-discovery',
      'interaction-cost',
      'pending-response',
      'progressive-spatiality',
      'error-recovery',
      'multiplayer',
      'privacy',
      'accessibility',
      'readability',
      'performance',
      'visual-hierarchy',
    ]))
    expect(criteriaJson.measurementEvents).toEqual(expect.arrayContaining([
      'action-activated',
      'decision-presented',
      'decision-submitted',
      'tactical-lens-opened',
      'tactical-lens-ready',
      'system-recovery-opened',
      'system-recovery-terminal',
      'accepted-presentation-settled',
    ]))
  })
})
