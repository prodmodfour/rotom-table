import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import securityCertificationJson from '../../data/breeding-automation/security-certification.json'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import semanticClosureJson from '../../data/breeding-automation/semantic-closure-manifest.json'
import wholeSpeciesConformanceJson from '../../data/breeding-automation/whole-species-conformance.json'
import interactionCertificationJson from '../../data/breeding-automation/interaction-certification.json'
import resilienceCertificationJson from '../../data/breeding-automation/resilience-certification.json'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import {
  POKEMON_EGG_DEFINITION_HASH_MAXIMUM,
  POKEMON_EGG_INHERITANCE_CANDIDATE_MAXIMUM,
} from '../../shared/breeding/egg'
import { BREEDING_REALTIME_EVENT_JSON_BYTES_MAXIMUM } from '../../shared/breeding/realtime'
import { BREEDING_ARCHIVE_MAXIMUM_BYTES } from '../../shared/breeding/archives'
import { BREEDING_INHERITANCE_LIMITS } from '../../server/domain/breeding/inheritanceCandidates'
import {
  BREEDING_COMMAND_JSON_MAXIMUM_BYTES,
} from '../../server/security/breedingRequestBody'
import {
  BREEDING_GM_WRITE_LIMIT_PER_MINUTE,
  BREEDING_PLAYER_WRITE_LIMIT_PER_MINUTE,
} from '../../server/security/breedingWriteRateLimit'
import {
  BREEDING_REPOSITORY_PAGE_SIZE_DEFAULT,
  BREEDING_REPOSITORY_PAGE_SIZE_MAXIMUM,
} from '../../server/storage/breedingRepositorySupport'

const ROOT = resolve(import.meta.dirname, '../..')
const report = securityCertificationJson as Record<string, any>
const policy = securityPolicyJson as Record<string, any>
const hash = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const readJson = (path: string): Record<string, any> => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as Record<string, any>
const verifyEvidence = (rows: Record<string, any>[]): void => {
  for (const row of rows) {
    const evidencePath = resolve(ROOT, row.evidencePath)
    expect(existsSync(evidencePath), row.evidencePath).toBe(true)
    expect(readFileSync(evidencePath, 'utf8'), `${row.evidencePath}: ${row.requiredNeedle}`)
      .toContain(row.requiredNeedle)
  }
}

const EXPECTED_DIMENSIONS = [
  'authorization',
  'consent',
  'privacy',
  'information-flow',
  'malformed-input',
  'abuse',
]

const EXPECTED_ROUTES = [
  '/api/breeding/consent',
  '/api/breeding/hatch',
  '/api/breeding/projects/wizard',
  '/api/breeding/projects/wizard/choices',
  '/api/breeding/projects/wizard/guidance',
  '/api/breeding/workshop',
  '/api/breeding/workshop/activity',
]

describe('BR-084 breeding security certification', () => {
  it('is self-hashed and bound to current closure, conformance, interaction, resilience, and security authority', () => {
    expect(report).toMatchObject({
      schemaVersion: 1,
      reportId: 'ptu-1.05-breeding-security-certification-v1',
      rulesetId: rulesetJson.rulesetId,
      rulesetDefinitionSha256: rulesetJson.definitionSha256,
      sourceManifestSha256: semanticClosureJson.sourceManifestSha256,
      definitionSha256: hash(report.definition),
    })
    expect(report.definition).toMatchObject({
      ticket: 'BR-084',
      status: 'certified',
      dimensions: EXPECTED_DIMENSIONS,
      bindings: {
        semanticClosureDefinitionSha256: semanticClosureJson.definitionSha256,
        wholeSpeciesConformanceDefinitionSha256: wholeSpeciesConformanceJson.definitionSha256,
        interactionCertificationDefinitionSha256: interactionCertificationJson.definitionSha256,
        resilienceCertificationDefinitionSha256: resilienceCertificationJson.definitionSha256,
        securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
        authorizationContractDefinitionSha256: readJson('data/breeding-automation/authorization-contract.json').definitionSha256,
        projectionContractDefinitionSha256: readJson('data/breeding-automation/projection-contract.json').definitionSha256,
        operationContractDefinitionSha256: readJson('data/breeding-automation/operation-contract.json').definitionSha256,
        consentWorkflowPresentationContractDefinitionSha256: readJson('data/breeding-automation/consent-workflow-presentation-contract.json').definitionSha256,
        eggTransferContractDefinitionSha256: readJson('data/breeding-automation/egg-transfer-contract.json').definitionSha256,
        realtimeContractDefinitionSha256: readJson('data/breeding-automation/realtime-contract.json').definitionSha256,
        archiveContractDefinitionSha256: readJson('data/breeding-automation/archive-contract.json').definitionSha256,
      },
    })
    expect(semanticClosureJson.definition.projections).toMatchObject({
      securityCertificationOwner: 'BR-084',
      securityCertificationStatus: 'certified-current-information-flow',
      artifactIds: expect.arrayContaining(['breeding-security-certification']),
    })
    expect(semanticClosureJson.definition.semanticRegistry.expectedArtifactCountIncludingThisManifest).toBe(105)
  })

  it('certifies all five audiences and all 22 privacy fields as structurally separate schemas', () => {
    const audiences = report.definition.audiences as Record<string, any>[]
    expect(audiences.map(row => ({
      id: row.id,
      requiresAuthentication: row.requiresAuthentication,
      authority: row.authority,
    }))).toEqual(policy.definition.audiences)
    expect(audiences.map(row => row.id)).toEqual(['public', 'owner', 'participating-owner', 'gm', 'diagnostic'])
    expect(new Set(audiences.map(row => row.id)).size).toBe(5)
    expect(audiences.every(row => row.schemaPolicy === 'structurally-separate-closed-projection')).toBe(true)
    verifyEvidence(audiences)

    const privacy = report.definition.privacyFieldCoverage as Record<string, any>[]
    expect(privacy.map(row => ({ id: row.privacyFieldId, audiences: row.audiences, rule: row.rule })))
      .toEqual(policy.definition.privacyFields)
    expect(privacy).toHaveLength(22)
    expect(new Set(privacy.map(row => row.privacyFieldId)).size).toBe(22)
    expect(privacy.every(row => row.certificationStatus === 'structurally-enforced')).toBe(true)
    verifyEvidence(privacy)
  })

  it('closes every Workshop API behind authentication, strict bounded JSON, and write-only rate admission', () => {
    const routes = report.definition.apiSurfaces as Record<string, any>[]
    expect(routes.map(row => row.route)).toEqual(EXPECTED_ROUTES)
    expect(routes.map(row => row.route)).toEqual(semanticClosureJson.definition.projections.apiRoutes)
    expect(routes.map(row => row.runtimePath)).toEqual(semanticClosureJson.definition.projections.apiRouteFiles)
    expect(new Set(routes.map(row => row.route)).size).toBe(7)
    verifyEvidence(routes)

    for (const row of routes) {
      const source = readFileSync(resolve(ROOT, row.runtimePath), 'utf8')
      expect(source, row.route).toContain('requireAuthRole(event)')
      if (row.method === 'POST') expect(source, row.route).toContain('readBreedingJsonRequestBody(event)')
      if (row.mutationAdmission !== 'not-applicable') {
        expect(source, row.route).toContain('enforceBreedingWriteRateLimit(event')
      }
    }
    expect(routes.filter(row => row.mutationAdmission !== 'not-applicable').map(row => row.route)).toEqual([
      '/api/breeding/consent',
      '/api/breeding/hatch',
      '/api/breeding/projects/wizard/choices',
    ])
  })

  it('binds current authorization, distinct positive consents, and every private information flow to executable evidence', () => {
    const authorization = report.definition.authorizationSurfaces as Record<string, any>[]
    expect(authorization).toHaveLength(8)
    expect(new Set(authorization.map(row => row.surfaceId)).size).toBe(8)
    for (const row of authorization) {
      expect(row.runtimePaths.length).toBeGreaterThan(0)
      expect(row.runtimePaths.every((path: string) => existsSync(resolve(ROOT, path)))).toBe(true)
    }
    verifyEvidence(authorization)

    const consents = report.definition.consentCases as Record<string, any>[]
    expect(consents).toHaveLength(11)
    expect(new Set(consents.map(row => row.caseId)).size).toBe(11)
    expect(consents.map(row => row.caseId)).toEqual(expect.arrayContaining([
      'positive-exact-later-operation',
      'participant-revocation',
      'campaign-time-expiry',
      'gm-project-nonsubstitution',
      'dual-egg-transfer-consent',
      'gm-transfer-nonsubstitution',
      'post-acceptance-immutability',
    ]))
    verifyEvidence(consents)

    const flows = report.definition.informationFlows as Record<string, any>[]
    expect(flows).toHaveLength(9)
    expect(new Set(flows.map(row => row.flowId)).size).toBe(9)
    for (const row of flows) {
      expect(row.allowedPayload).toEqual(expect.any(String))
      expect(row.forbiddenPayload).toEqual(expect.any(String))
      expect(row.runtimePaths.every((path: string) => existsSync(resolve(ROOT, path)))).toBe(true)
    }
    verifyEvidence(flows)
  })

  it('covers the closed threat register and fourteen malformed-input classes without fallback', () => {
    const threats = report.definition.threatCoverage as Record<string, any>[]
    expect(threats.map(row => ({ id: row.threatId, assets: row.assets, mitigations: row.mitigations })))
      .toEqual(policy.definition.threats)
    expect(threats).toHaveLength(13)
    expect(new Set(threats.map(row => row.threatId)).size).toBe(13)
    expect(threats.every(row => row.certificationStatus === 'covered')).toBe(true)
    verifyEvidence(threats)

    const malformed = report.definition.malformedInputCoverage as Record<string, any>[]
    expect(malformed).toHaveLength(14)
    expect(new Set(malformed.map(row => row.caseId)).size).toBe(14)
    expect(malformed.map(row => row.caseId)).toEqual(expect.arrayContaining([
      'unknown-object-field',
      'accessor-backed-object',
      'sparse-or-enriched-array',
      'unsafe-identifier-control-or-traversal',
      'Promise-like-or-asynchronous-provider',
      'stored-row-column-or-JSON-drift',
      'deterministic-fuzzed-snapshot-or-identity',
    ]))
    verifyEvidence(malformed)
  })

  it('enforces all 22 policy abuse controls including request bytes, active-parent admission, pagination, and rate limits', () => {
    const abuse = report.definition.abuseControls as Record<string, any>[]
    expect(abuse.map(row => row.limitId)).toEqual(Object.keys(policy.definition.abuseLimits))
    expect(Object.fromEntries(abuse.map(row => [row.limitId, row.policyValue])))
      .toEqual(policy.definition.abuseLimits)
    expect(abuse).toHaveLength(22)
    expect(new Set(abuse.map(row => row.limitId)).size).toBe(22)
    expect(abuse.every(row => row.certificationStatus === 'active')).toBe(true)
    for (const row of abuse) {
      expect(row.runtimePaths.length).toBeGreaterThan(0)
      expect(row.runtimePaths.every((path: string) => existsSync(resolve(ROOT, path)))).toBe(true)
    }
    verifyEvidence(abuse)

    expect(BREEDING_COMMAND_JSON_MAXIMUM_BYTES).toBe(policy.definition.abuseLimits.commandJsonBytes)
    expect(BREEDING_REALTIME_EVENT_JSON_BYTES_MAXIMUM).toBe(policy.definition.abuseLimits.realtimeEventJsonBytes)
    expect(BREEDING_ARCHIVE_MAXIMUM_BYTES).toBe(policy.definition.abuseLimits.exportEnvelopeBytes)
    expect(POKEMON_EGG_INHERITANCE_CANDIDATE_MAXIMUM).toBe(policy.definition.abuseLimits.inheritanceCandidatesPerEgg)
    expect(POKEMON_EGG_DEFINITION_HASH_MAXIMUM).toBe(policy.definition.abuseLimits.definitionHashesPerAggregate)
    expect(BREEDING_INHERITANCE_LIMITS.effectiveMovesPerParent).toBe(policy.definition.abuseLimits.effectiveMovesPerParent)
    expect(BREEDING_REPOSITORY_PAGE_SIZE_DEFAULT).toBe(policy.definition.abuseLimits.pageSizeDefault)
    expect(BREEDING_REPOSITORY_PAGE_SIZE_MAXIMUM).toBe(policy.definition.abuseLimits.pageSizeMaximum)
    expect(BREEDING_PLAYER_WRITE_LIMIT_PER_MINUTE).toBe(policy.definition.abuseLimits.writeCommandsPerProfilePerMinute)
    expect(BREEDING_GM_WRITE_LIMIT_PER_MINUTE).toBe(policy.definition.abuseLimits.gmWriteCommandsPerSessionPerMinute)

    const rateSource = readFileSync(resolve(ROOT, 'server/security/breedingWriteRateLimit.ts'), 'utf8')
    expect(rateSource).toContain("setResponseHeader(event, 'Retry-After'")
    expect(rateSource).toContain("'gm:authenticated-liveplay-session'")
    const repositorySource = readFileSync(resolve(ROOT, 'server/storage/breedingProjectRepository.ts'), 'utf8')
    expect(repositorySource).toContain('A breeding parent may belong to at most one active Project.')
  })

  it('certifies all durable audit requirements and closes with a unique existing evidence set', () => {
    const audit = report.definition.auditCoverage as Record<string, any>[]
    expect(audit.map(row => row.requirementId)).toEqual(policy.definition.auditRequirements)
    expect(audit).toHaveLength(8)
    expect(audit.every(row => row.certificationStatus === 'durable-and-bound')).toBe(true)
    verifyEvidence(audit)
    expect(report.definition.failurePolicies).toEqual(policy.definition.failures)
    expect(report.definition.invariants).toContain('rate-limit-failure-contains-only-429-and-Retry-After')
    expect(report.definition.invariants).toContain('one-parent-cannot-enter-two-active-Projects')
    expect(report.definition.summary).toEqual({
      dimensionsCertified: 6,
      audiencesCertified: 5,
      apiSurfacesCertified: 7,
      authorizationSurfacesCertified: 8,
      consentCasesCertified: 11,
      privacyFieldsCertified: 22,
      informationFlowsCertified: 9,
      threatsCertified: 13,
      malformedInputClassesCertified: 14,
      abuseControlsCertified: 22,
      auditRequirementsCertified: 8,
      result: 'pass',
    })
    expect(report.definition.evidencePaths).toContain('tests/server/breedingSecurityCertification.test.ts')
    expect(new Set(report.definition.evidencePaths).size).toBe(report.definition.evidencePaths.length)
    expect(report.definition.evidencePaths.every((path: string) => existsSync(resolve(ROOT, path)))).toBe(true)
  })
})
