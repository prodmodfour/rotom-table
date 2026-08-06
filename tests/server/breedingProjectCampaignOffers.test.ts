import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import securityJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import {
  CampaignOperationOfferValidationError,
  parseCampaignOperationOfferDeclarationV1,
  parseCampaignOperationOfferV1,
} from '../../shared/campaignOperationOffers'
import { parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import { BREEDING_REFERENCE_SOURCE_IDS } from '../../shared/breeding/readSets'
import type { PlayerProfile } from '../../shared/playerProfiles'
import {
  createBreedingActorAuthorityV1,
  createBreedingBreederAuthorityEvidenceV1,
  createBreedingTrainerControlEvidenceV1,
} from '../../server/domain/breeding/authorization'
import {
  assertCampaignOperationOfferExactReplayV1,
} from '../../server/domain/campaignOperationOffers'
import {
  BreedingProjectCampaignOfferAuthorityError,
  assertBreedingProjectCampaignOfferAuthorityExactReplayV1,
  consumeBreedingProjectCampaignOperationOfferV1,
  parseAuthoritativeBreedingProjectCampaignOfferAuthorityV1,
  projectBreedingProjectCampaignOperationOfferV1,
} from '../../server/domain/breeding/projectOffers'
import { createBreedingReferenceVersionSnapshotV1 } from '../../server/domain/breeding/readSets'

const ROOT = resolve(import.meta.dirname, '../..')
const ruleset = rulesetJson as Record<string, string>
const security = securityJson as Record<string, string>
const operationId = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const projectId = (value: number): string => `breeding-project:v1:${value.toString(16).padStart(32, '0')}`
const profile: PlayerProfile = {
  schemaVersion: 1,
  id: 'profile_owner1234',
  displayName: 'Owner',
  linkedCharacters: [
    { sheetKind: 'trainer', sheetSlug: 'trainer-owner' },
    { sheetKind: 'trainer', sheetSlug: 'trainer-breeder' },
  ],
}
const command = (input: {
  readonly value?: number
  readonly role?: 'gm' | 'player'
  readonly kind?: 'create-breeding-project' | 'preview-breeding'
} = {}) => {
  const role = input.role ?? 'player'
  const kind = input.kind ?? 'preview-breeding'
  const base = {
    schemaVersion: 1,
    operationId: operationId(input.value ?? 1),
    commandKind: kind,
    actor: {
      profileId: role === 'gm' ? 'campaign-gm' : profile.id,
      selectedTrainerSlug: role === 'gm' ? null : 'trainer-owner',
    },
    ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 },
    scopes: kind === 'create-breeding-project'
      ? [{ kind: 'breeding-project', projectId: projectId(1), expectedRevision: null }]
      : [],
    payload: {
      ownerTrainerSlug: 'trainer-owner',
      breederTrainerSlug: 'trainer-breeder',
      parentRefs: [
        { pokemonSheetSlug: 'pokemon-parent-a', expectedSheetRevision: 2 },
        { pokemonSheetSlug: 'pokemon-parent-b', expectedSheetRevision: 3 },
      ],
      optionSnapshotDefinitionSha256: '5'.repeat(64),
      ...(kind === 'create-breeding-project'
        ? { projectId: projectId(1), consentPolicy: 'same-owner-control' }
        : {}),
    },
  }
  return parseBreedingOperationCommandV1(base)
}
const actor = (setupCommand = command(), role: 'gm' | 'player' = 'player', minute = 100) => (
  createBreedingActorAuthorityV1({
    role,
    command: setupCommand,
    authenticatedPrincipalSha256: '6'.repeat(64),
    authenticationPolicyDefinitionSha256: '7'.repeat(64),
    profile: role === 'player' ? profile : null,
    evaluatedAtCampaignMinute: minute,
  })
)
const ownerControl = (minute = 100) => createBreedingTrainerControlEvidenceV1({
  profile,
  trainerSheetSlug: 'trainer-owner',
  trainerSheetRevision: 5,
  trainerSheetDefinitionSha256: '8'.repeat(64),
  evaluatedAtCampaignMinute: minute,
})
const breederControl = (minute = 100) => createBreedingTrainerControlEvidenceV1({
  profile,
  trainerSheetSlug: 'trainer-breeder',
  trainerSheetRevision: 6,
  trainerSheetDefinitionSha256: '9'.repeat(64),
  evaluatedAtCampaignMinute: minute,
})
const breederAuthority = (control = breederControl(), minute = 100) => (
  createBreedingBreederAuthorityEvidenceV1({
    breederTrainerSlug: 'trainer-breeder',
    breederTrainerRevision: 6,
    breederTrainerDefinitionSha256: '9'.repeat(64),
    accessMode: 'profile-control',
    accessEvidenceDefinitionSha256: control.definitionSha256,
    edgeCanonicalId: 'Breeder',
    edgeInstanceId: 'edge-instance:breeder',
    edgeRecordSha256: 'a'.repeat(64),
    effectiveEdgeProjectionSha256: 'b'.repeat(64),
    pokemonEducationRank: 'Expert',
    pokemonEducationSkillTotal: 5,
    evaluatedAtCampaignMinute: minute,
  })
)
const references = (campaignOptionSnapshotDefinitionSha256 = '5'.repeat(64)) => createBreedingReferenceVersionSnapshotV1({
  schemaVersion: 1,
  rulesetId: ruleset.rulesetId,
  rulesetDefinitionSha256: ruleset.definitionSha256,
  sourceManifestSha256: '1'.repeat(64),
  semanticRegistryDefinitionSha256: '2'.repeat(64),
  compiledRegistryDefinitionSha256: '3'.repeat(64),
  canonicalIdsDefinitionSha256: '4'.repeat(64),
  campaignOptionSnapshotDefinitionSha256,
  referenceSources: BREEDING_REFERENCE_SOURCE_IDS.map((sourceId, index) => ({
    sourceId,
    contentSha256: (index + 1).toString(16).padStart(64, '0'),
  })),
  contractDefinitionHashes: [
    'breeding-archive-contract',
    'breeding-authorization-contract',
    'breeding-ledger-contract',
    'breeding-lineage-contract',
    'breeding-operation-contract',
    'breeding-project-contract',
    'breeding-read-set-contract',
    'breeding-security-policy',
    'pokemon-egg-contract',
  ].map((contractId, index) => ({
    contractId,
    definitionSha256: (index + 20).toString(16).padStart(64, '0'),
  })),
})
const playerInput = (overrides: Record<string, unknown> = {}) => {
  const setupCommand = command()
  const breeder = breederControl()
  return {
    command: setupCommand,
    actorAuthority: actor(setupCommand),
    ownerTrainerControl: ownerControl(),
    breederTrainerControl: breeder,
    breederAuthority: breederAuthority(breeder),
    referenceVersions: references(),
    atCampaignMinute: 100,
    securityPolicyDefinitionSha256: security.definitionSha256,
    ...overrides,
  }
}
const declaration = (authority: ReturnType<typeof projectBreedingProjectCampaignOperationOfferV1>) => ({
  schemaVersion: 1,
  offerId: authority.offer.offerId,
  offerDefinitionSha256: authority.offer.offerDefinitionSha256,
  operationId: authority.commandOperationId,
})

const privateMarkers = [
  'actorAuthorityDefinitionSha256',
  'ownerTrainerControlDefinitionSha256',
  'breederTrainerControlDefinitionSha256',
  'breederAuthorityDefinitionSha256',
  'referenceVersionsDefinitionSha256',
  'securityPolicyDefinitionSha256',
  'edge-instance:breeder',
]

describe('Breeding Project generic campaign-operation offers', () => {
  it('projects a deterministic owner offer from current controlled Breeder Edge authority', () => {
    const first = projectBreedingProjectCampaignOperationOfferV1(playerInput())
    const replay = projectBreedingProjectCampaignOperationOfferV1(playerInput())
    expect(first).toEqual(replay)
    expect(first.offer).toMatchObject({
      schemaVersion: 1,
      audience: 'owner',
      role: 'campaign-operation',
      workspaceId: 'breeding',
      operationFamilyId: 'breeding-project',
      actionId: 'breeding.project.preview',
      actor: { kind: 'trainer-sheet', resourceId: 'trainer-owner', revision: 5 },
      source: { kind: 'edge', canonicalId: 'Breeder' },
      availability: { status: 'available', reasonId: null },
      requiredInputKinds: ['parent-pair', 'project-options'],
      issuedAtCampaignMinute: 100,
      expiresAtCampaignMinute: 101,
    })
    expect(first.offer.offerId).toMatch(/^campaign-operation-offer:v1:[0-9a-f]{32}$/)
    expect(first.offer.offerDefinitionSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(parseAuthoritativeBreedingProjectCampaignOfferAuthorityV1(structuredClone(first))).toEqual(first)
    expect(assertCampaignOperationOfferExactReplayV1(first.offer, structuredClone(first.offer))).toEqual(first.offer)
    expect(assertBreedingProjectCampaignOfferAuthorityExactReplayV1(first, structuredClone(first))).toEqual(first)
    const { offerDefinitionSha256: _offerHash, ...originalDefinition } = structuredClone(first.offer)
    const changedDefinition = {
      ...originalDefinition,
      presentation: { ...originalDefinition.presentation, tone: 'warning' as const },
    }
    const changedOffer = {
      ...changedDefinition,
      offerDefinitionSha256: createHash('sha256')
        .update(stableJsonStringify(changedDefinition))
        .digest('hex'),
    }
    expect(() => assertCampaignOperationOfferExactReplayV1(first.offer, changedOffer))
      .toThrow(/exact stable-JSON replay only/u)
    for (const marker of privateMarkers) expect(JSON.stringify(first.offer)).not.toContain(marker)
    expect(JSON.stringify(first.offer)).not.toMatch(/mapSlug|mapRevision|encounter/i)
  })

  it('projects a safe unavailable offer when current controlled Trainer lacks effective Breeder evidence', () => {
    const projected = projectBreedingProjectCampaignOperationOfferV1(playerInput({ breederAuthority: null }))
    expect(projected.offer).toMatchObject({
      audience: 'owner',
      source: { kind: 'edge', canonicalId: 'Breeder' },
      availability: {
        status: 'unavailable',
        reasonId: 'breeding.offer.breeder-edge-required',
      },
    })
    expect(projected.breederAuthorityDefinitionSha256).toBeNull()
    expect(() => consumeBreedingProjectCampaignOperationOfferV1({
      ...playerInput({ breederAuthority: null }),
      declaration: declaration(projected),
    })).toThrowError(expect.objectContaining({ code: 'breeding.project-offer.unavailable' }))
  })

  it('projects current GM system authority without manufacturing a Breeder Edge or override', () => {
    const setupCommand = command({ role: 'gm', kind: 'create-breeding-project', value: 2 })
    const authority = projectBreedingProjectCampaignOperationOfferV1({
      command: setupCommand,
      actorAuthority: actor(setupCommand, 'gm'),
      ownerTrainerControl: null,
      breederTrainerControl: null,
      breederAuthority: null,
      referenceVersions: references(),
      atCampaignMinute: 100,
      securityPolicyDefinitionSha256: security.definitionSha256,
    })
    expect(authority.offer).toMatchObject({
      audience: 'gm',
      actionId: 'breeding.project.create',
      actor: { kind: 'campaign', resourceId: 'campaign', revision: null },
      source: { kind: 'system', canonicalId: 'breeding.v1' },
      availability: { status: 'available', reasonId: null },
      requiredInputKinds: ['confirmation', 'parent-pair', 'project-options'],
    })
    expect(authority).toMatchObject({
      ownerTrainerControlDefinitionSha256: null,
      breederTrainerControlDefinitionSha256: null,
      breederAuthorityDefinitionSha256: null,
    })
  })

  it('consumes identities only after rebuilding the exact current server offer', () => {
    const input = playerInput()
    const authority = projectBreedingProjectCampaignOperationOfferV1(input)
    const consumed = consumeBreedingProjectCampaignOperationOfferV1({
      ...input,
      declaration: declaration(authority),
    })
    expect(consumed).toMatchObject({ offer: authority.offer, authority, command: input.command })
    expect(parseCampaignOperationOfferDeclarationV1(consumed.declaration)).toEqual(consumed.declaration)

    for (const changed of [
      { ...declaration(authority), offerId: 'campaign-operation-offer:v1:ffffffffffffffffffffffffffffffff' },
      { ...declaration(authority), offerDefinitionSha256: 'f'.repeat(64) },
      { ...declaration(authority), operationId: operationId(99) },
    ]) {
      expect(() => consumeBreedingProjectCampaignOperationOfferV1({
        ...input,
        declaration: changed,
      })).toThrowError(expect.objectContaining({ code: 'breeding.project-offer.declaration-mismatch' }))
    }
  })

  it('rejects stale campaign time, reference drift, command drift, and mismatched control evidence', () => {
    const input = playerInput()
    expect(() => projectBreedingProjectCampaignOperationOfferV1({ ...input, atCampaignMinute: 101 }))
      .toThrowError(expect.objectContaining({ code: 'breeding.project-offer.stale-authority' }))
    const staleReferences = { ...references(), rulesetDefinitionSha256: 'f'.repeat(64) }
    expect(() => projectBreedingProjectCampaignOperationOfferV1({ ...input, referenceVersions: staleReferences })).toThrow()
    expect(() => projectBreedingProjectCampaignOperationOfferV1({
      ...input,
      referenceVersions: references('f'.repeat(64)),
    })).toThrowError(expect.objectContaining({ code: 'breeding.project-offer.stale-authority' }))
    const otherCommand = structuredClone(command({ value: 3 }))
    otherCommand.payload.ownerTrainerSlug = 'trainer-other'
    expect(() => projectBreedingProjectCampaignOperationOfferV1({ ...input, command: otherCommand }))
      .toThrowError(expect.objectContaining({ code: 'breeding.project-offer.unauthorized' }))
    const selectionBase = command({ value: 4 })
    const changedSelection = {
      ...selectionBase,
      actor: { ...selectionBase.actor, selectedTrainerSlug: 'trainer-other' },
    }
    expect(() => projectBreedingProjectCampaignOperationOfferV1({ ...input, command: changedSelection }))
      .toThrowError(expect.objectContaining({ code: 'breeding.project-offer.unauthorized' }))
    expect(() => projectBreedingProjectCampaignOperationOfferV1({
      ...input,
      ownerTrainerControl: breederControl(),
    })).toThrowError(expect.objectContaining({ code: 'breeding.project-offer.unauthorized' }))
  })

  it('rejects unknown fields, accessors, malformed hashes, tampering, and non-project commands', () => {
    const authority = projectBreedingProjectCampaignOperationOfferV1(playerInput())
    expect(() => parseCampaignOperationOfferV1({ ...authority.offer, mapSlug: 'arena' }))
      .toThrowError(expect.objectContaining({ code: 'campaign-operation-offer.unknown-field' }))
    const accessor = structuredClone(authority.offer) as Record<string, unknown>
    Object.defineProperty(accessor, 'offerId', { enumerable: true, get: () => authority.offer.offerId })
    expect(() => parseCampaignOperationOfferV1(accessor)).toThrow(CampaignOperationOfferValidationError)
    expect(() => parseCampaignOperationOfferDeclarationV1({
      ...declaration(authority),
      offerDefinitionSha256: 'not-a-hash',
    })).toThrow(CampaignOperationOfferValidationError)
    expect(() => parseAuthoritativeBreedingProjectCampaignOfferAuthorityV1({
      ...authority,
      commandSha256: 'f'.repeat(64),
    })).toThrow(BreedingProjectCampaignOfferAuthorityError)

    const unsupported = parseBreedingOperationCommandV1({
      schemaVersion: 1,
      operationId: operationId(4),
      commandKind: 'advance-campaign-clock',
      actor: { profileId: profile.id, selectedTrainerSlug: 'trainer-owner' },
      ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 },
      scopes: [{ kind: 'campaign-clock', expectedRevision: 0 }],
      payload: { targetCampaignMinute: 101 },
    })
    expect(() => projectBreedingProjectCampaignOperationOfferV1({
      ...playerInput(),
      command: unsupported,
      actorAuthority: actor(unsupported),
    })).toThrowError(expect.objectContaining({ code: 'breeding.project-offer.command-unavailable' }))
  })

  it('binds source-owned references without consulting documentary or map data', () => {
    const sourceManifest = readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))
    expect(createHash('sha256').update(sourceManifest).digest('hex')).toMatch(/^[0-9a-f]{64}$/)
    const offer = projectBreedingProjectCampaignOperationOfferV1(playerInput())
    const authorityHash = createHash('sha256').update(stableJsonStringify({
      schemaVersion: offer.schemaVersion,
      offer: offer.offer,
      commandOperationId: offer.commandOperationId,
      commandSha256: offer.commandSha256,
      actorAuthorityDefinitionSha256: offer.actorAuthorityDefinitionSha256,
      ownerTrainerControlDefinitionSha256: offer.ownerTrainerControlDefinitionSha256,
      breederTrainerControlDefinitionSha256: offer.breederTrainerControlDefinitionSha256,
      breederAuthorityDefinitionSha256: offer.breederAuthorityDefinitionSha256,
      referenceVersionsDefinitionSha256: offer.referenceVersionsDefinitionSha256,
      securityPolicyDefinitionSha256: offer.securityPolicyDefinitionSha256,
    })).digest('hex')
    expect(offer.authorityDefinitionSha256).toBe(authorityHash)
  })
})
