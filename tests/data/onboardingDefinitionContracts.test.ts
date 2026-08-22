import { describe, expect, it } from 'vitest'
import policyMatrix from '../../data/onboarding/campaign-policy-matrix.json'
import rolesContract from '../../data/onboarding/roles-privacy-contract.json'
import completionRubric from '../../data/onboarding/completion-rubric.json'
import uxCriteria from '../../data/onboarding/ux-success-criteria.json'

describe('campaign policy matrix (P9-005)', () => {
  it('freezes bounded knobs with canonical constraints and defaults', () => {
    expect(policyMatrix.matrixId).toBe('onboarding-campaign-policy-matrix-v1')
    expect(new Set(policyMatrix.knobs.map(knob => knob.id)).size).toBe(policyMatrix.knobs.length)
    const areas = new Set(policyMatrix.areas)
    for (const knob of policyMatrix.knobs) {
      expect(areas.has(knob.area), knob.id).toBe(true)
      expect(knob.canonicalConstraint.trim(), knob.id).not.toBe('')
      expect(knob.policyControl.trim(), knob.id).not.toBe('')
      expect(knob.shippedDefault.trim(), knob.id).not.toBe('')
      expect(knob.varianceRationale.trim(), knob.id).not.toBe('')
    }
    const ids = new Set(policyMatrix.knobs.map(knob => knob.id))
    for (const required of [
      'starting-trainer-level',
      'starting-money',
      'starter-count',
      'starter-pool',
      'starter-level',
      'trainer-item-package',
      'feature-source-restrictions',
      'unresolved-choice-policy',
      'approval-policy',
      'folder-destinations',
    ]) expect(ids, required).toContain(required)
  })

  it('records the deliberate non-knobs explicitly', () => {
    const fixedBudget = policyMatrix.knobs.find(knob => knob.id === 'trainer-stat-budget-source')
    expect(fixedBudget?.policyControl).toBe('none')
    const approval = policyMatrix.knobs.find(knob => knob.id === 'approval-policy')
    expect(approval?.shippedDefault).toBe('gm-review-required')
  })
})

describe('roles and privacy contract (P9-006)', () => {
  it('covers every role for every resource with structural projection rules', () => {
    expect(rolesContract.contractId).toBe('onboarding-roles-privacy-v1')
    expect(rolesContract.roles).toEqual([
      'gm',
      'owner-player',
      'other-player',
      'public-observer',
      'diagnostic-operator',
    ])
    for (const resource of rolesContract.resources) {
      for (const role of rolesContract.roles) {
        expect(
          (resource.access as Record<string, string>)[role]?.trim(),
          `${resource.id} access for ${role}`,
        ).toBeTruthy()
      }
      expect(resource.projectionRule.trim(), resource.id).not.toBe('')
    }
    const resourceIds = new Set(rolesContract.resources.map(resource => resource.id))
    for (const required of [
      'policy-active',
      'onboarding-slot-list',
      'draft-content',
      'review-comments',
      'corrections',
      'submission-snapshots',
      'completion-state',
      'onboarding-metrics',
    ]) expect(resourceIds, required).toContain(required)
  })

  it('keeps the trusted-table boundary: no accounts, tokens, or reusable links', () => {
    const boundaries = rolesContract.trustBoundaries.join(' ')
    expect(boundaries).toMatch(/No public signup/i)
    expect(boundaries).toMatch(/structural/i)
    expect(
      rolesContract.resources.every(resource =>
        (resource.access as Record<string, string>)['public-observer'] === 'none'
        || resource.id === 'policy-active',
      ),
    ).toBe(true)
  })
})

describe('completion rubric (P9-007)', () => {
  it('defines the six rule states and the acceptance predicates', () => {
    expect(completionRubric.rubricId).toBe('onboarding-completion-rubric-v1')
    expect(completionRubric.ruleStates.map(state => state.id)).toEqual([
      'complete',
      'guided',
      'campaign-policy',
      'warning',
      'blocked',
      'not-applicable',
    ])
    for (const state of completionRubric.ruleStates) {
      expect(state.definition.trim(), state.id).not.toBe('')
    }
    expect(completionRubric.workflowBranchStates.length).toBeGreaterThanOrEqual(4)
    expect(completionRubric.acceptancePredicates.length).toBe(6)
    expect(completionRubric.acceptancePredicates.join(' ')).toMatch(/SQLite/i)
  })
})

describe('UX success criteria (P9-008)', () => {
  it('freezes release-gated aggregate-only criteria', () => {
    expect(uxCriteria.contractId).toBe('onboarding-ux-success-v1')
    expect(uxCriteria.privacyPolicy).toMatch(/Aggregate-only/i)
    expect(uxCriteria.criteria.length).toBeGreaterThanOrEqual(10)
    expect(new Set(uxCriteria.criteria.map(criterion => criterion.id)).size)
      .toBe(uxCriteria.criteria.length)
    for (const criterion of uxCriteria.criteria) {
      expect(criterion.statement.trim(), criterion.id).not.toBe('')
      expect(criterion.target.trim(), criterion.id).not.toBe('')
      expect(criterion.measurement.trim(), criterion.id).not.toBe('')
      expect(criterion.releaseGate, criterion.id).toBe(true)
    }
    const ids = new Set(uxCriteria.criteria.map(criterion => criterion.id))
    for (const required of [
      'time-to-first-valid-preview',
      'validation-recovery',
      'resume-fidelity',
      'gm-review-effort',
      'atomic-commit-reliability',
      'time-to-first-encounter-action',
      'privacy-zero-disclosure',
    ]) expect(ids, required).toContain(required)
  })
})
