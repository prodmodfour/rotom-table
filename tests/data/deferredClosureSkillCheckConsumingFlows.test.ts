import { describe, expect, it } from 'vitest'
import policy from '../../data/deferred-closure/skill-check-consuming-flow-policy.v1.json'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'

const expectedFlows = new Map([
  ['equipped-fishing-rod-guided-settlement', 'integrated-generic-check'],
  ['first-aid-kit-medicine-healing', 'retain-bespoke-atomic-check'],
  ['move-embedded-skill-and-opposed-checks', 'retain-bespoke-atomic-check'],
  ['contest-stage-dice', 'retain-bespoke-document-check'],
  ['breeding-specific-check-ledgers', 'retain-bespoke-document-check'],
  ['route-lure-and-dowsing-exploration-rolls', 'retain-bespoke-activity-roll'],
])

describe('P11-050 generic Skill Check consuming-flow policy', () => {
  it('binds every integrated and intentionally retained flow to accepted source bytes', () => {
    expect(policy).toMatchObject({
      schemaVersion: 1,
      policyId: 'generic-skill-check-consuming-flows-v1',
      ticket: 'P11-050',
      status: 'reviewed-and-implemented',
      runtimeProseParsing: false,
    })
    expect(new Map(policy.flows.map(flow => [flow.flowId, flow.disposition]))).toEqual(expectedFlows)
    for (const flow of policy.flows) {
      expect(flow.reason.length, flow.flowId).toBeGreaterThan(80)
      for (const binding of flow.authorityBindings) {
        expect(acceptedSuccessorHead(binding.path, binding.sha256), `${flow.flowId}:${binding.path}`)
          .toBe(repositoryFileSha256(binding.path))
      }
    }
  })

  it('integrates all three rods through one accepted actor-, skill-, declaration-, and reuse-bound generic check', () => {
    const fishing = policy.flows.find(flow => flow.flowId === 'equipped-fishing-rod-guided-settlement')!
    expect(fishing.canonicalScope).toEqual([
      'equipment.fishing.old-rod',
      'equipment.fishing.good-rod',
      'equipment.fishing.super-rod',
    ])
    expect(fishing.integrationPolicy).toEqual({
      selectionAuthority: 'authenticated-gm-projection-only',
      requiredCheckState: 'accepted',
      requiredMode: 'single',
      requiredComparison: 'dc',
      requiredSubjectCount: 1,
      subjectBinding: 'exact-fishing-actor-kind-and-sheet-slug',
      skillBinding: 'exact-command-and-check-canonical-skill-id',
      declarationBoundary: 'check-created-at-or-after-guided-request',
      reusePolicy: 'one-accepted-check-cannot-settle-another-fishing-request-for-the-actor',
      hookPolicy: 'accepted check is evidence; bounded hook or no-hook remains private GM campaign-content authority',
      clientDiceOrTotals: 'forbidden',
      publicCheckIdentity: 'forbidden',
    })
  })

  it('records the exact closure review and private terminal-link boundary', () => {
    expect(policy.inventoryReview).toMatchObject({
      reviewedRows: ['runtime.generic-skill-check'],
      reviewedHandoffBoundaries: ['fishing-hook-content-tooling'],
    })
    expect(policy.privacy).toEqual({
      fishingCheckIdStoredOnlyInPrivateTerminalCommand: true,
      fishingSyntheticIntegrationNonceRemainsPrivate: true,
      ownerProjectionIncludesCheckId: false,
      publicProjectionIncludesCheckId: false,
      gmMayInspectAcceptedCheckTotalAndOutcome: true,
      hookSpeciesLevelAndNoteRemainPrivate: true,
    })
  })
})
