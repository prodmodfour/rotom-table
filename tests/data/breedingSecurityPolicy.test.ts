import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')

interface Audience { id: string, requiresAuthentication: boolean, authority: string }
interface PrivacyField { id: string, audiences: string[], rule: string }
interface Threat { id: string, assets: string[], mitigations: string[] }
interface SecurityPolicy {
  schemaVersion: number
  policyId: string
  rulesetId: string
  rulesetDefinitionSha256: string
  sourceManifestSha256: string
  definitionSha256: string
  definition: {
    audiences: Audience[]
    consent: Record<string, string | boolean | string[]>
    privacyFields: PrivacyField[]
    projectionRules: Record<string, string | string[]>
    threats: Threat[]
    abuseLimits: Record<string, string | number>
    auditRequirements: string[]
    failures: Record<string, string>
  }
}

const policy = readJson<SecurityPolicy>('data/breeding-automation/security-policy.json')
const ruleset = readJson<{ rulesetId: string, definitionSha256: string }>('data/breeding-automation/ruleset.json')
const audienceIds = new Set(policy.definition.audiences.map(audience => audience.id))

describe('breeding threat, consent, privacy, and abuse policy', () => {
  it('is source- and ruleset-bound under one stable definition hash', () => {
    expect(policy).toMatchObject({
      schemaVersion: 1,
      policyId: 'breeding-security-privacy-v1',
      rulesetId: ruleset.rulesetId,
      rulesetDefinitionSha256: ruleset.definitionSha256,
    })
    expect(policy.sourceManifestSha256).toBe(sha256(readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))))
    expect(policy.definitionSha256).toBe(sha256(stableJsonStringify(policy.definition)))
  })

  it('requires revision-bound positive consent and rejects ambient authority', () => {
    expect(policy.definition.consent).toMatchObject({
      crossOwnerPolicy: 'positive-current-project-and-parent-revision-consent-required',
      sameOwnerPolicy: 'current-control-authorization-required',
      browserSelectionIsConsent: false,
      publicSheetVisibilityIsConsent: false,
      legacySessionGrantIsConsent: false,
      blanketConsent: 'forbidden',
      grantAuthorization: 'profile-controls-owner-trainer-and-current-parent-link',
      executionAuthorization: 'recheck-profile-control-parent-link-revision-expiry-and-revocation',
      parentRevisionChangeBeforeSnapshot: 'invalidate-consent-and-return-awaiting-consent',
      revocationBeforeEggAcceptance: 'blocks-production-and-preserves-audit',
      revocationAfterEggAcceptance: 'does-not-rewrite-egg-or-parent-snapshot',
      projectCancellation: 'does-not-delete-consent-audit',
      gmOverride: 'typed-reason-id-and-audited-operation-only',
    })
    expect(policy.definition.consent.consentScopes).toEqual([
      'project-participation',
      'own-parent-safe-summary',
      'own-parent-contribution-attribution',
    ])
    expect(policy.definition.consent.requiredRecordFields).toEqual([
      'consent-id', 'project-id', 'parent-sheet-slug', 'parent-sheet-revision',
      'owner-trainer-slug', 'consenting-profile-id', 'scopes',
      'granted-at-campaign-minute', 'expires-at-campaign-minute-or-null',
      'revoked-at-campaign-minute-or-null', 'source-operation-id', 'command-hash',
    ])
    expect(new Set(policy.definition.consent.requiredRecordFields as string[]).size)
      .toBe((policy.definition.consent.requiredRecordFields as string[]).length)
  })

  it('uses separate closed audience schemas and reveals no private participant or diagnostic payloads', () => {
    expect(policy.definition.audiences).toEqual([
      { id: 'public', requiresAuthentication: false, authority: 'none' },
      { id: 'owner', requiresAuthentication: true, authority: 'controlled-owner-trainer-only' },
      { id: 'participating-owner', requiresAuthentication: true, authority: 'controlled-consented-parent-only' },
      { id: 'gm', requiresAuthentication: true, authority: 'campaign-gm' },
      { id: 'diagnostic', requiresAuthentication: true, authority: 'authorized-operator' },
    ])
    expect(audienceIds.size).toBe(policy.definition.audiences.length)
    expect(new Set(policy.definition.privacyFields.map(field => field.id)).size).toBe(policy.definition.privacyFields.length)

    for (const field of policy.definition.privacyFields) {
      expect(field.audiences.length, field.id).toBeGreaterThan(0)
      expect(field.audiences.every(audience => audienceIds.has(audience)), field.id).toBe(true)
      expect(field.audiences, field.id).toContain('gm')
      expect(field.rule.trim().length, field.id).toBeGreaterThan(15)
    }
    expect(policy.definition.privacyFields.filter(field => field.audiences.includes('public')).map(field => field.id))
      .toEqual(['public-summary', 'coarse-lifecycle-status'])
    expect(policy.definition.privacyFields.find(field => field.id === 'other-parent-identity')?.audiences).toEqual(['gm'])
    expect(policy.definition.privacyFields.find(field => field.id === 'full-parent-snapshots')?.audiences).toEqual(['gm'])
    expect(policy.definition.privacyFields.find(field => field.id === 'raw-rolls-and-checks')?.audiences).toEqual(['gm'])
    expect(policy.definition.privacyFields.find(field => field.id === 'own-inheritance-attribution')?.audiences)
      .toEqual(['participating-owner', 'gm'])
    expect(policy.definition.privacyFields.filter(field => field.audiences.includes('diagnostic')).map(field => field.id))
      .toEqual(['project-id', 'egg-id', 'definition-hashes-and-traces'])
  })

  it('restricts realtime, deep-link adoption, control, and local persistence structurally', () => {
    expect(policy.definition.projectionRules).toMatchObject({
      schemaPerAudience: 'required-no-shared-overbroad-payload',
      visibilityBeforeControl: 'required',
      controlCannotExceedVisibleAuthorizedIdentity: 'required',
      deepLinkAdoption: 'only-identities-in-current-authorized-projection',
      unknownAudience: 'deny',
      unknownField: 'omit-and-diagnose',
      clientCssPrivacy: 'forbidden',
      localPersistence: 'presentation-preferences-only',
      realtime: 'privacy-safe-refresh-signal-only',
    })
    expect(policy.definition.projectionRules.realtimePayloadAllowedFields).toEqual([
      'schema-version', 'sequence', 'aggregate-kind', 'aggregate-id-hash',
      'revision', 'operation-kind', 'audience-refresh-scope',
    ])
    const realtimeFields = (policy.definition.projectionRules.realtimePayloadAllowedFields as string[]).join(' ')
    for (const forbidden of ['parent-sheet', 'trait', 'roll', 'consent', 'command', 'choice', 'note', 'profile-id']) {
      expect(realtimeFields).not.toContain(forbidden)
    }
  })

  it('closes the threat register with bounded mitigations', () => {
    expect(policy.definition.threats.map(threat => threat.id)).toEqual([
      'breeding.threat.idor',
      'breeding.threat.cross-owner-without-consent',
      'breeding.threat.hidden-parent-leak',
      'breeding.threat.client-mechanics-injection',
      'breeding.threat.reroll-or-replay',
      'breeding.threat.operation-id-collision',
      'breeding.threat.concurrent-double-hatch',
      'breeding.threat.stale-consent-toctou',
      'breeding.threat.realtime-or-export-leak',
      'breeding.threat.restore-tampering',
      'breeding.threat.legacy-authority-confusion',
      'breeding.threat.resource-exhaustion',
      'breeding.threat.parent-change-after-acceptance',
    ])
    expect(new Set(policy.definition.threats.map(threat => threat.id)).size).toBe(policy.definition.threats.length)
    for (const threat of policy.definition.threats) {
      expect(threat.assets.length, threat.id).toBeGreaterThan(0)
      expect(threat.mitigations.length, threat.id).toBeGreaterThanOrEqual(2)
      expect(new Set(threat.mitigations).size, threat.id).toBe(threat.mitigations.length)
    }
  })

  it('freezes exact parser, cardinality, payload, pagination, rate, and retry limits', () => {
    expect(policy.definition.abuseLimits).toEqual({
      commandJsonBytes: 32_768,
      realtimeEventJsonBytes: 4_096,
      exportEnvelopeBytes: 67_108_864,
      stableIdCharacters: 160,
      boundedNarrativeCharacters: 500,
      parentsPerBreedingProject: 2,
      consentsPerBreedingProject: 2,
      activeProjectsPerParent: 1,
      serverIssuedOptionsPerChoice: 64,
      effectiveMovesPerParent: 64,
      inheritanceCandidatesPerEgg: 256,
      definitionHashesPerAggregate: 256,
      operationRolls: 32,
      pageSizeDefault: 25,
      pageSizeMaximum: 100,
      writeCommandsPerProfilePerMinute: 30,
      gmWriteCommandsPerSessionPerMinute: 120,
      consentMaximumCampaignMinutes: 525_600,
      exactRetryRetention: 'permanent-with-campaign-data',
      negativeOrUnsafeInteger: 'reject',
      unknownObjectField: 'reject',
      duplicateListIdentity: 'reject',
    })
    expect(policy.definition.auditRequirements).toHaveLength(8)
    expect(new Set(policy.definition.auditRequirements).size).toBe(policy.definition.auditRequirements.length)
    expect(policy.definition.failures).toEqual({
      authorization: 'not-found-or-forbidden-without-existence-oracle',
      consent: 'stable-unavailable-reason-with-own-parent-only-context',
      staleRevision: 'safe-current-projection-only',
      rateLimit: 'retry-after-without-private-state',
      projectionContradiction: 'fail-closed-and-refresh',
      replayGap: 'replace-from-authoritative-audience-projection',
    })
  })

  it('documents the same no-CSS, no-ambient-consent, refresh-only boundary', () => {
    const guide = readFileSync(resolve(ROOT, 'docs/breeding/security-and-privacy.md'), 'utf8')
    expect(guide).toContain('It is not a reusable blanket grant.')
    expect(guide).toContain('not one payload hidden with CSS')
    expect(guide).toContain('Realtime events are refresh signals')
    expect(guide).toContain('Local persistence is limited to Workshop presentation preferences.')
    expect(guide).toContain('concurrent double hatch')
  })
})
