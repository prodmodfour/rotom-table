import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/skill-check-gm-workflow-certification.v1.json'
import presets from '../../data/deferred-closure/skill-check-dc-presets.v1.json'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'

const expectedScenarios = new Set([
  'preset-group-request',
  'exact-sheet-and-controller-binding',
  'strict-gm-response-parsing',
  'explicit-single-request',
  'opposed-two-subject-request',
  'expired-missing-malformed-and-duplicate-rejection',
  'principal-bound-request-replay',
  'gm-resolve-and-no-reroll-replay',
  'private-cancel-and-terminal-replay',
  'stale-and-terminal-cancel-conflict',
  'request-and-cancel-rollback',
  'gm-only-routes',
  'bounded-gm-query',
  'strict-command-envelope',
  'forged-principal-and-dice-envelope-rejection',
  'ready-request-presentation',
  'reviewed-preset-composer',
  'exact-client-command-retry',
  'blocked-private-and-no-roll-presentation',
  'source-hash-bound-preset-registry',
  'preset-and-explicit-dc-fail-closed-runtime',
])

describe('P11-047 Skill Check GM workflow certification', () => {
  it('binds every predecessor, authority, generated preset, and evidence file through accepted bytes', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1,
      certificationId: 'deferred-closure-skill-check-gm-workflow-v1',
      ticket: 'P11-047',
      status: 'certified',
      runtimeProseParsing: false,
    })
    for (const predecessor of certification.predecessors) {
      expect(acceptedSuccessorHead(predecessor.path, predecessor.sha256), predecessor.path)
        .toBe(repositoryFileSha256(predecessor.path))
    }
    for (const [path, recorded] of [
      [certification.presetAuthority.migrationPath, certification.presetAuthority.migrationSha256],
      [certification.presetAuthority.registryPath, certification.presetAuthority.registrySha256],
      [certification.presetAuthority.runtimePath, certification.presetAuthority.runtimeSha256],
    ] as const) {
      expect(acceptedSuccessorHead(path, recorded), path).toBe(repositoryFileSha256(path))
    }
    for (const authority of certification.authorities) {
      expect(acceptedSuccessorHead(authority.path, authority.sha256), authority.id)
        .toBe(repositoryFileSha256(authority.path))
      expect(authority.guarantees.length).toBeGreaterThan(0)
    }
    for (const evidence of certification.evidence) {
      expect(acceptedSuccessorHead(evidence.path, evidence.sha256), evidence.path)
        .toBe(repositoryFileSha256(evidence.path))
    }
  })

  it('certifies the complete reviewed preset inventory and explicit bounds', () => {
    expect(certification.presetAuthority.presets).toEqual(presets.presets.map(preset => [preset.presetId, preset.difficultyClass]))
    expect(certification.presetAuthority.explicitDifficultyClassBounds).toEqual([
      presets.explicitDifficultyClass.minimum,
      presets.explicitDifficultyClass.maximum,
    ])
    expect(presets.runtimeProseParsing).toBe(false)
    expect(presets.policy.runtimeSource).toBe('this-reviewed-json-only')
  })

  it('covers every GM lifecycle, privacy, idempotency, and presentation scenario', () => {
    expect(new Set(certification.evidence.flatMap(evidence => evidence.scenarioIds))).toEqual(expectedScenarios)
    expect(certification.acceptance).toMatchObject({
      singleRequests: true,
      groupRequests: true,
      trainerSubjects: true,
      pokemonSubjects: true,
      reviewedPresets: true,
      explicitDc: true,
      opposedChecks: true,
      pendingObservation: true,
      serverResolution: true,
      cancellationReceipts: true,
      exactRetry: true,
      atomicWrites: true,
      subjectWorkflowDeferredTo: 'P11-048',
      projectionClosureDeferredTo: 'P11-049',
    })
    expect(certification.privacy).toEqual({
      fullWorkflowRouteAudience: 'gm-only',
      gmNotesPublic: false,
      privateDcPublicWhilePending: false,
      cancellationReasonInDocument: false,
      clientDiceAccepted: false,
      roleSafeProjectionOwnerTicket: 'P11-049',
    })
  })
})
