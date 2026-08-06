import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import securityJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import type { PlayerProfile } from '../../shared/playerProfiles'
import { parseBreedingReadResourceV1, BREEDING_REFERENCE_SOURCE_IDS, type BreedingDependencyEvidenceV1 } from '../../shared/breeding/readSets'
import { parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import {
  createBreedingActorAuthorityV1,
  createBreedingBreederAuthorityEvidenceV1,
  createBreedingParentControlEvidenceV1,
  createBreedingTrainerControlEvidenceV1,
} from '../../server/domain/breeding/authorization'
import {
  BREEDING_COMPATIBILITY_POLICY_DEFINITION_SHA256,
} from '../../server/domain/breeding/compatibility'
import {
  resolveBreedingCampaignOptionSnapshot,
  type BreedingCampaignOptionSnapshotV1,
} from '../../server/domain/breeding/campaignOptions'
import {
  createBreedingGmAdjudicationRecordV1,
  createBreedingOptionOfferRevisionV1,
} from '../../server/domain/breeding/ledgers'
import { createBreedingOperationCommandHash } from '../../server/domain/breeding/operations'
import {
  BreedingProjectSetupAuthorityError,
  createBreedingProjectParentFactsV1,
  parseAuthoritativeBreedingProjectSetupValidationV1,
  projectBreedingProjectSetupValidationV1,
  validateBreedingProjectSetupV1,
} from '../../server/domain/breeding/projectSetupValidation'
import {
  COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256,
  compiledBreedingSpeciesSpec,
} from '../../server/domain/breeding/registry'
import {
  createBreedingOperationReadSetV1,
  createBreedingReferenceVersionSnapshotV1,
} from '../../server/domain/breeding/readSets'

const ruleset = rulesetJson as Record<string, string>
const security = securityJson as Record<string, string>
const sha256 = (value: unknown): string => createHash('sha256')
  .update(typeof value === 'string' ? value : stableJsonStringify(value))
  .digest('hex')
const op = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const readSetId = (value: number): string => `breeding-read-set:v1:${value.toString(16).padStart(32, '0')}`
const adjudicationId = (value: number): string => `breeding-adjudication:v1:${value.toString(16).padStart(32, '0')}`
const offerId = (value: number): string => `breeding-offer:v1:${value.toString(16).padStart(32, '0')}`
const optionId = (value: number): string => `option:v1:${value.toString(16).padStart(32, '0')}`
const projectId = 'breeding-project:v1:11111111111111111111111111111111'
const EDGE_RECORD = 'd303cbe8c377ec9bb2a305ee5626e3c80f9c1ebd77975623c985bce741a321f4'
const EDGE_EFFECTIVE = '6'.repeat(64)
const hashes = {
  ownerTrainer: sha256('trainer-owner:5'),
  otherTrainer: sha256('trainer-other:7'),
  parentA: sha256('pokemon-parent-a:2'),
  parentB: sha256('pokemon-parent-b:3'),
}
const profile: PlayerProfile = {
  schemaVersion: 1,
  id: 'profile_setup123',
  displayName: 'Setup Owner',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-owner' }],
}
const minimumOptions = (minimum = 20, extra: Record<string, unknown> = {}) => (
  resolveBreedingCampaignOptionSnapshot({
    'breeding.maturity-policy': 'minimum-level',
    'breeding.minimum-maturity-level': minimum,
    ...extra,
  })
)
const command = (input: {
  readonly kind?: 'create-breeding-project' | 'preview-breeding'
  readonly options?: BreedingCampaignOptionSnapshotV1
  readonly crossOwner?: boolean
  readonly value?: number
} = {}) => {
  const kind = input.kind ?? 'preview-breeding'
  const options = input.options ?? minimumOptions()
  return parseBreedingOperationCommandV1({
    schemaVersion: 1,
    operationId: op(input.value ?? 1),
    commandKind: kind,
    actor: { profileId: profile.id, selectedTrainerSlug: 'trainer-owner' },
    ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 },
    scopes: kind === 'create-breeding-project'
      ? [{ kind: 'breeding-project', projectId, expectedRevision: null }]
      : [],
    payload: {
      ...(kind === 'create-breeding-project' ? { projectId } : {}),
      ownerTrainerSlug: 'trainer-owner',
      breederTrainerSlug: 'trainer-owner',
      parentRefs: [
        { pokemonSheetSlug: 'pokemon-parent-a', expectedSheetRevision: 2 },
        { pokemonSheetSlug: 'pokemon-parent-b', expectedSheetRevision: 3 },
      ],
      optionSnapshotDefinitionSha256: options.definitionSha256,
      ...(kind === 'create-breeding-project'
        ? { consentPolicy: input.crossOwner ? 'cross-owner-current-revision-consent' : 'same-owner-control' }
        : {}),
    },
  })
}
const actor = (setupCommand: ReturnType<typeof command>) => createBreedingActorAuthorityV1({
  role: 'player',
  command: setupCommand,
  authenticatedPrincipalSha256: '7'.repeat(64),
  authenticationPolicyDefinitionSha256: '8'.repeat(64),
  profile,
  evaluatedAtCampaignMinute: 100,
})
const ownerControl = () => createBreedingTrainerControlEvidenceV1({
  profile,
  trainerSheetSlug: 'trainer-owner',
  trainerSheetRevision: 5,
  trainerSheetDefinitionSha256: hashes.ownerTrainer,
  evaluatedAtCampaignMinute: 100,
})
const breeder = () => {
  const control = ownerControl()
  return createBreedingBreederAuthorityEvidenceV1({
    breederTrainerSlug: 'trainer-owner',
    breederTrainerRevision: 5,
    breederTrainerDefinitionSha256: hashes.ownerTrainer,
    accessMode: 'profile-control',
    accessEvidenceDefinitionSha256: control.definitionSha256,
    edgeCanonicalId: 'Breeder',
    edgeInstanceId: 'edge-instance:breeder',
    edgeRecordSha256: EDGE_RECORD,
    effectiveEdgeProjectionSha256: EDGE_EFFECTIVE,
    pokemonEducationRank: 'Expert',
    pokemonEducationSkillTotal: 5,
    evaluatedAtCampaignMinute: 100,
  })
}
const parentControl = (
  slug: 'pokemon-parent-a' | 'pokemon-parent-b',
  crossOwner = false,
) => {
  const isA = slug.endsWith('a')
  if (crossOwner && !isA) {
    return createBreedingParentControlEvidenceV1({
      parentSheetSlug: slug,
      parentSheetRevision: 3,
      parentSheetDefinitionSha256: hashes.parentB,
      ownerTrainer: {
        slug: 'trainer-other',
        revision: 7,
        definitionSha256: hashes.otherTrainer,
        currentTeam: [],
        boxedPokemon: ['pokemon-parent-b'],
      },
      trainerControl: null,
      verificationMode: 'server-verified-link',
      evaluatedAtCampaignMinute: 100,
    })
  }
  return createBreedingParentControlEvidenceV1({
    parentSheetSlug: slug,
    parentSheetRevision: isA ? 2 : 3,
    parentSheetDefinitionSha256: isA ? hashes.parentA : hashes.parentB,
    ownerTrainer: {
      slug: 'trainer-owner',
      revision: 5,
      definitionSha256: hashes.ownerTrainer,
      currentTeam: ['pokemon-parent-a'],
      boxedPokemon: ['pokemon-parent-b'],
    },
    trainerControl: ownerControl(),
    verificationMode: 'profile-control',
    evaluatedAtCampaignMinute: 100,
  })
}
const facts = (input: {
  readonly parent?: 'a' | 'b'
  readonly species?: 'Bulbasaur' | 'Ivysaur' | 'Pikachu'
  readonly gender?: 'female' | 'genderless' | 'male'
  readonly level?: number
} = {}) => {
  const parent = input.parent ?? 'a'
  const speciesName = input.species ?? (parent === 'a' ? 'Bulbasaur' : 'Ivysaur')
  const speciesId = speciesName.toLowerCase()
  const spec = compiledBreedingSpeciesSpec(speciesId)!
  return createBreedingProjectParentFactsV1({
    schemaVersion: 1,
    parentSheetSlug: `pokemon-parent-${parent}`,
    parentSheetRevision: parent === 'a' ? 2 : 3,
    parentSheetDefinitionSha256: parent === 'a' ? hashes.parentA : hashes.parentB,
    speciesId: spec.speciesId,
    speciesSpecDefinitionSha256: spec.definitionSha256,
    genderId: input.gender ?? (parent === 'a' ? 'female' : 'male'),
    level: input.level ?? 25,
    eggGroupIds: spec.eggGroupIds,
    capturedAtCampaignMinute: 100,
  })
}
const readResource = (
  resourceKind: string,
  resourceId: string,
  revision: number | null,
  definitionSha256: string | null,
  purposes: readonly string[],
  observedCampaignMinute: number | null = null,
) => parseBreedingReadResourceV1({
  resourceKind,
  resourceId,
  existence: definitionSha256 === null ? 'absent' : 'present',
  revision,
  definitionSha256,
  observedCampaignMinute,
  purposes: [...purposes].sort(),
})
const references = (options: BreedingCampaignOptionSnapshotV1) => createBreedingReferenceVersionSnapshotV1({
  schemaVersion: 1,
  rulesetId: ruleset.rulesetId,
  rulesetDefinitionSha256: ruleset.definitionSha256,
  sourceManifestSha256: '2'.repeat(64),
  semanticRegistryDefinitionSha256: '3'.repeat(64),
  compiledRegistryDefinitionSha256: COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256,
  canonicalIdsDefinitionSha256: '5'.repeat(64),
  campaignOptionSnapshotDefinitionSha256: options.definitionSha256,
  referenceSources: BREEDING_REFERENCE_SOURCE_IDS.map((sourceId, index) => ({
    sourceId,
    contentSha256: (index + 1).toString(16).padStart(64, '0'),
  })),
  contractDefinitionHashes: [
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
const dependencies = (
  checkpoint: 'project-creation' | 'project-preview',
  withFacility = false,
): readonly BreedingDependencyEvidenceV1[] => {
  const resolved: BreedingDependencyEvidenceV1[] = [{
    providerKind: 'edge',
    providerId: 'Breeder',
    subjectKind: 'trainer-sheet',
    subjectId: 'trainer-owner',
    subjectRevision: 5,
    checkpoint,
    providerDefinitionSha256: EDGE_RECORD,
    effectiveEvidenceSha256: EDGE_EFFECTIVE,
  }]
  if (withFacility) resolved.push({
    providerKind: 'facility',
    providerId: 'unreviewed-day-care',
    subjectKind: 'trainer-sheet',
    subjectId: 'trainer-owner',
    subjectRevision: 5,
    checkpoint,
    providerDefinitionSha256: 'c'.repeat(64),
    effectiveEvidenceSha256: 'd'.repeat(64),
  })
  resolved.sort((left, right) => `${left.providerKind}\u0000${left.providerId}`.localeCompare(`${right.providerKind}\u0000${right.providerId}`))
  return [{
    providerKind: 'system',
    providerId: 'breeding-effective-dependency-set-v1',
    subjectKind: 'campaign',
    subjectId: 'campaign',
    subjectRevision: null,
    checkpoint: 'authorization',
    providerDefinitionSha256: 'e'.repeat(64),
    effectiveEvidenceSha256: sha256(resolved),
  }, ...resolved]
}
const readSet = (input: {
  readonly command: ReturnType<typeof command>
  readonly options: BreedingCampaignOptionSnapshotV1
  readonly crossOwner?: boolean
  readonly facility?: boolean
  readonly extraResources?: readonly ReturnType<typeof readResource>[]
}) => createBreedingOperationReadSetV1({
  readSetId: readSetId(Number.parseInt(input.command.operationId.slice(-2), 16) || 1) as never,
  operationId: input.command.operationId,
  commandSha256: createBreedingOperationCommandHash(input.command),
  commandKind: input.command.commandKind,
  capturedAtCampaignMinute: 100,
  resources: [
    readResource('campaign-clock', 'campaign-clock', 4, sha256('clock:4:100'), ['campaign-time'], 100),
    readResource('trainer-sheet', 'trainer-owner', 5, hashes.ownerTrainer, ['authorization', 'mechanics']),
    ...(input.crossOwner
      ? [readResource('trainer-sheet', 'trainer-other', 7, hashes.otherTrainer, ['consent'])]
      : []),
    readResource('pokemon-sheet', 'pokemon-parent-a', 2, hashes.parentA, ['snapshot']),
    readResource('pokemon-sheet', 'pokemon-parent-b', 3, hashes.parentB, ['snapshot']),
    ...(input.command.commandKind === 'create-breeding-project'
      ? [readResource('breeding-project', projectId, null, null, ['conflict'])]
      : []),
    ...(input.extraResources ?? []),
  ],
  referenceVersions: references(input.options),
  dependencyEvidence: dependencies(
    input.command.commandKind === 'create-breeding-project' ? 'project-creation' : 'project-preview',
    input.facility,
  ),
  writeExpectations: input.command.scopes,
})
const setupInput = (input: {
  readonly options?: BreedingCampaignOptionSnapshotV1
  readonly setupCommand?: ReturnType<typeof command>
  readonly crossOwner?: boolean
  readonly parentFacts?: readonly unknown[]
  readonly maturityAdjudications?: readonly unknown[]
  readonly roleAdjudication?: unknown | null
  readonly roleOffer?: unknown | null
  readonly facility?: boolean
  readonly extraResources?: readonly ReturnType<typeof readResource>[]
} = {}) => {
  const options = input.options ?? minimumOptions()
  const setupCommand = input.setupCommand ?? command({ options, crossOwner: input.crossOwner })
  const control = ownerControl()
  return {
    command: setupCommand,
    readSet: readSet({
      command: setupCommand,
      options,
      crossOwner: input.crossOwner,
      facility: input.facility,
      extraResources: input.extraResources,
    }),
    actorAuthority: actor(setupCommand),
    ownerTrainerControl: control,
    breederAuthority: breeder(),
    breederTrainerControl: control,
    parents: [
      { parentControl: parentControl('pokemon-parent-a'), ownerTrainerControl: control, consentEvidence: null },
      input.crossOwner
        ? { parentControl: parentControl('pokemon-parent-b', true), ownerTrainerControl: null, consentEvidence: null }
        : { parentControl: parentControl('pokemon-parent-b'), ownerTrainerControl: control, consentEvidence: null },
    ],
    gmOverrides: [],
    securityPolicyDefinitionSha256: security.definitionSha256,
    campaignOptions: options,
    parentFacts: input.parentFacts ?? [facts(), facts({ parent: 'b' })],
    maturityAdjudications: input.maturityAdjudications ?? [],
    roleAdjudication: input.roleAdjudication ?? null,
    roleOffer: input.roleOffer ?? null,
  }
}
const roleRecords = (input: {
  readonly parentFacts: readonly [ReturnType<typeof facts>, ReturnType<typeof facts>]
  readonly options: BreedingCampaignOptionSnapshotV1
  readonly invalidCanonicalValue?: boolean
  readonly consumedAtExpiry?: boolean
}) => {
  const evidenceIds = input.parentFacts.map(value => value.definitionSha256).sort()
  const selectedValue = input.invalidCanonicalValue ? 'free-text-outcome' : 'first-female-second-male'
  const selectedRoles = ['female-parent', 'male-parent'] as const
  const selectedDefinition = {
    schemaVersion: 1,
    canonicalValueId: selectedValue,
    roles: selectedRoles,
  }
  const alternateDefinition = {
    schemaVersion: 1,
    canonicalValueId: 'first-male-second-female',
    roles: ['male-parent', 'female-parent'],
  }
  const issuedOperationId = op(70)
  const issuedCommandSha256 = '7'.repeat(64)
  const settlementOperationId = op(71)
  const settlementCommandSha256 = '8'.repeat(64)
  const offer = createBreedingOptionOfferRevisionV1({
    schemaVersion: 1,
    offerId: offerId(1) as never,
    revision: 1,
    status: 'consumed',
    choiceKind: 'parent-role',
    target: { kind: 'trainer-sheet', sheetSlug: 'trainer-owner', revision: 5 },
    chooserProfileId: 'campaign-gm',
    minimumPokemonEducationRank: null,
    options: [
      {
        optionId: optionId(1) as never,
        kind: 'parent-role',
        canonicalValueId: selectedValue,
        valueDefinitionSha256: sha256(selectedDefinition),
        authorityEvidenceIds: evidenceIds,
      },
      {
        optionId: optionId(2) as never,
        kind: 'parent-role',
        canonicalValueId: 'first-male-second-female',
        valueDefinitionSha256: sha256(alternateDefinition),
        authorityEvidenceIds: evidenceIds,
      },
    ],
    issuedOperationId: issuedOperationId as never,
    issuedCommandSha256,
    issuedAtCampaignMinute: 90,
    expiresAtCampaignMinute: input.consumedAtExpiry ? 99 : 110,
    selectedOptionId: optionId(1) as never,
    settlementOperationId: settlementOperationId as never,
    settlementCommandSha256,
    settledAtCampaignMinute: 99,
    settlementReasonId: null,
  })
  const adjudication = createBreedingGmAdjudicationRecordV1({
    schemaVersion: 1,
    adjudicationId: adjudicationId(10) as never,
    revision: 1,
    status: 'resolved',
    adjudicationKind: 'parent-role-override',
    decisionMode: 'bounded-option',
    target: { kind: 'trainer-sheet', sheetSlug: 'trainer-owner', revision: 5 },
    createdByProfileId: 'campaign-gm',
    reasonId: 'breeding.parent-role.reviewed',
    offerId: offer.offerId,
    decision: { kind: 'option', optionId: optionId(1) as never },
    createdOperationId: issuedOperationId as never,
    createdCommandSha256: issuedCommandSha256,
    createdAtCampaignMinute: 90,
    resolvedByProfileId: 'campaign-gm',
    settlementOperationId: settlementOperationId as never,
    settlementCommandSha256,
    settledAtCampaignMinute: 99,
    settlementReasonId: null,
    authorityDefinitionHashes: [
      BREEDING_COMPATIBILITY_POLICY_DEFINITION_SHA256,
      input.options.definitionSha256,
      input.options.rulesetDefinitionSha256,
      ...input.parentFacts.map(value => value.definitionSha256),
    ].sort(),
  })
  return { offer, adjudication }
}
const gmAdjudicationDependencies = {
  validateResolvedGmAdjudication: ({ adjudication, offer }: {
    adjudication: { createdByProfileId: string, resolvedByProfileId: string | null }
    offer: { chooserProfileId: string } | null
  }) => adjudication.createdByProfileId === 'campaign-gm'
    && adjudication.resolvedByProfileId === 'campaign-gm'
    && (offer === null || offer.chooserProfileId === 'campaign-gm'),
}
const maturityRecord = (
  parentFacts: ReturnType<typeof facts>,
  options: BreedingCampaignOptionSnapshotV1,
  value: number,
  confirmed = true,
) => createBreedingGmAdjudicationRecordV1({
  schemaVersion: 1,
  adjudicationId: adjudicationId(value) as never,
  revision: 1,
  status: 'resolved',
  adjudicationKind: 'maturity-confirmation',
  decisionMode: 'audited-confirmation',
  target: {
    kind: 'pokemon-sheet',
    sheetSlug: parentFacts.parentSheetSlug,
    revision: parentFacts.parentSheetRevision,
  },
  createdByProfileId: 'campaign-gm',
  reasonId: 'breeding.maturity.reviewed',
  offerId: null,
  decision: {
    kind: 'confirmation',
    confirmed,
    evidenceDefinitionSha256: parentFacts.definitionSha256,
  },
  createdOperationId: op(90 + value) as never,
  createdCommandSha256: (value + 1).toString(16).padStart(64, '0'),
  createdAtCampaignMinute: 90,
  resolvedByProfileId: 'campaign-gm',
  settlementOperationId: op(100 + value) as never,
  settlementCommandSha256: (value + 10).toString(16).padStart(64, '0'),
  settledAtCampaignMinute: 99,
  settlementReasonId: null,
  authorityDefinitionHashes: [
    BREEDING_COMPATIBILITY_POLICY_DEFINITION_SHA256,
    options.definitionSha256,
    parentFacts.definitionSha256,
    options.rulesetDefinitionSha256,
  ].sort(),
})

describe('Breeding Project setup validation', () => {
  it('composes current ownership, minimum-Level maturity, no-facility policy, and compatibility into ready authority', () => {
    const first = validateBreedingProjectSetupV1(setupInput())
    const replay = validateBreedingProjectSetupV1(setupInput())
    expect(first).toEqual(replay)
    expect(first.authority).toMatchObject({
      status: 'ready',
      reasonIds: [],
      checks: {
        ownership: 'satisfied',
        consent: 'satisfied',
        maturity: 'satisfied',
        locationFacility: 'satisfied',
        compatibility: 'satisfied',
      },
      compatibility: {
        status: 'compatible',
        compatibilityKind: 'conventional',
        reasonIds: [],
      },
      locationPolicyId: 'campaign-workshop-off-map-v1',
      facilityId: null,
    })
    expect(first.authority.parentFactsDefinitionHashes).toHaveLength(2)
    expect(parseAuthoritativeBreedingProjectSetupValidationV1(structuredClone(first.authority)))
      .toEqual(first.authority)
    expect(projectBreedingProjectSetupValidationV1(first.authority, setupInput().actorAuthority))
      .toEqual(first.projection)
    const serialized = JSON.stringify(first.projection)
    for (const marker of [
      'pokemon-parent-a', 'pokemon-parent-b', profile.id, 'definitionSha256',
      'trainer-owner', 'Breeder', 'mapSlug', 'encounterId', 'consentEvidence',
    ]) expect(serialized).not.toContain(marker)
  })

  it('fails minimum-Level maturity without treating a preview as final compatibility authority', () => {
    const options = minimumOptions(30)
    const result = validateBreedingProjectSetupV1(setupInput({
      options,
      setupCommand: command({ options, value: 2 }),
      parentFacts: [facts({ level: 29 }), facts({ parent: 'b', level: 40 })],
    }))
    expect(result.authority).toMatchObject({
      status: 'unavailable',
      reasonIds: ['breeding.setup.maturity-level-low'],
      checks: { maturity: 'unavailable', compatibility: 'unavailable' },
      compatibility: {
        status: 'unavailable',
        reasonIds: ['breeding.compatibility.maturity-level-low'],
      },
    })
  })

  it('requires two exact current resolved GM maturity confirmations under the default policy', () => {
    const options = resolveBreedingCampaignOptionSnapshot()
    const setupCommand = command({ options, value: 3 })
    const parentFacts = [facts(), facts({ parent: 'b' })] as const
    const records = [
      maturityRecord(parentFacts[0], options, 1),
      maturityRecord(parentFacts[1], options, 2),
    ] as const
    const extraResources = records.map(value => readResource(
      'breeding-adjudication', value.adjudicationId, value.revision,
      value.definitionSha256, ['mechanics'],
    ))
    const evidenceInput = setupInput({
      options,
      setupCommand,
      parentFacts,
      maturityAdjudications: records,
      extraResources,
    })
    expect(() => validateBreedingProjectSetupV1(evidenceInput))
      .toThrowError(expect.objectContaining({ code: 'breeding.setup.invalid-adjudication' }))
    const ready = validateBreedingProjectSetupV1(evidenceInput, gmAdjudicationDependencies)
    expect(ready.authority).toMatchObject({
      status: 'ready',
      maturityAdjudicationIds: [records[0].adjudicationId, records[1].adjudicationId],
    })

    const missing = validateBreedingProjectSetupV1(setupInput({ options, setupCommand, parentFacts }))
    expect(missing.authority).toMatchObject({
      status: 'unavailable',
      reasonIds: ['breeding.setup.maturity-unconfirmed'],
      checks: { maturity: 'unavailable', compatibility: 'not-evaluated' },
    })
    const deniedRecord = maturityRecord(parentFacts[1], options, 2, false)
    const denied = validateBreedingProjectSetupV1(setupInput({
      options,
      setupCommand,
      parentFacts,
      maturityAdjudications: [records[0], deniedRecord],
      extraResources: [
        extraResources[0]!,
        readResource('breeding-adjudication', deniedRecord.adjudicationId, 1, deniedRecord.definitionSha256, ['mechanics']),
      ],
    }), gmAdjudicationDependencies)
    expect(denied.authority).toMatchObject({ status: 'unavailable', reasonIds: ['breeding.setup.maturity-unconfirmed'] })
  })

  it('returns awaiting consent before parsing or exposing cross-owner private mechanics', () => {
    const options = minimumOptions()
    const setupCommand = command({ kind: 'create-breeding-project', options, crossOwner: true, value: 4 })
    const privateFacts: Record<string, unknown> = {}
    Object.defineProperty(privateFacts, 'speciesId', {
      enumerable: true,
      get: () => { throw new Error('private facts must not be read') },
    })
    const result = validateBreedingProjectSetupV1(setupInput({
      options,
      setupCommand,
      crossOwner: true,
      parentFacts: [],
    }))
    expect(result.authority).toMatchObject({
      status: 'awaiting-consent',
      reasonIds: ['breeding.setup.awaiting-consent'],
      checks: {
        ownership: 'satisfied',
        consent: 'awaiting',
        maturity: 'not-evaluated',
        locationFacility: 'not-evaluated',
        compatibility: 'not-evaluated',
      },
      parentFactsDefinitionHashes: [],
    })
    expect(JSON.stringify(result.projection)).not.toMatch(/pokemon-parent-b|trainer-other|speciesId|profile/iu)
    expect(() => validateBreedingProjectSetupV1(setupInput({
      options,
      setupCommand,
      crossOwner: true,
      parentFacts: [facts(), privateFacts],
    }))).toThrowError(expect.objectContaining({ code: 'breeding.setup.extraneous-evidence' }))
  })

  it('denies cross-owner preview before consent without loading parent facts', () => {
    const options = minimumOptions()
    const setupCommand = command({ options, value: 5 })
    const result = validateBreedingProjectSetupV1(setupInput({
      options,
      setupCommand,
      crossOwner: true,
      parentFacts: [],
    }))
    expect(result.authority).toMatchObject({
      status: 'unavailable',
      reasonIds: ['breeding.authorization.consent-required'],
      compatibility: { status: 'not-evaluated', reasonIds: [] },
      parentFactsDefinitionHashes: [],
    })
  })

  it('rejects unsupported facility authority and ignores map or encounter placement as location evidence', () => {
    const result = validateBreedingProjectSetupV1(setupInput({ facility: true, parentFacts: [] }))
    expect(result.authority).toMatchObject({
      status: 'unavailable',
      reasonIds: ['breeding.setup.facility-unsupported'],
      checks: { locationFacility: 'unavailable', compatibility: 'not-evaluated' },
      locationPolicyId: 'campaign-workshop-off-map-v1',
      facilityId: null,
    })
    expect(() => validateBreedingProjectSetupV1({
      ...setupInput(),
      mapSlug: 'arena',
    })).toThrowError(expect.objectContaining({ code: 'breeding.setup.invalid-request' }))
  })

  it('rejects stale parent facts and returns bounded canonical incompatibility reasons', () => {
    const changed = { ...facts(), parentSheetRevision: 99 }
    expect(() => validateBreedingProjectSetupV1(setupInput({ parentFacts: [changed, facts({ parent: 'b' })] })))
      .toThrow(BreedingProjectSetupAuthorityError)

    const incompatible = validateBreedingProjectSetupV1(setupInput({
      parentFacts: [facts(), facts({ parent: 'b', species: 'Pikachu' })],
    }))
    expect(incompatible.authority).toMatchObject({
      status: 'unavailable',
      reasonIds: ['breeding.setup.compatibility-unavailable'],
      compatibility: {
        status: 'unavailable',
        reasonIds: ['breeding.compatibility.no-shared-egg-group'],
      },
    })
  })

  it('requires and consumes only a matching bounded parent-role adjudication when campaign policy allows it', () => {
    const options = minimumOptions(20, { 'breeding.same-sex-policy': 'gm-role-override' })
    const setupCommand = command({ options, value: 6 })
    const parentFacts = [facts({ gender: 'female' }), facts({ parent: 'b', gender: 'female' })] as const
    const missing = validateBreedingProjectSetupV1(setupInput({ options, setupCommand, parentFacts }))
    expect(missing.authority).toMatchObject({
      status: 'unavailable',
      reasonIds: ['breeding.setup.role-adjudication-required'],
      compatibility: {
        status: 'unavailable',
        reasonIds: ['breeding.compatibility.role-override-required'],
      },
    })

    const records = roleRecords({ parentFacts, options })
    const extraResources = [
      readResource('breeding-adjudication', records.adjudication.adjudicationId, 1, records.adjudication.definitionSha256, ['mechanics']),
      readResource('breeding-offer', records.offer.offerId, 1, records.offer.definitionSha256, ['mechanics']),
    ]
    const ready = validateBreedingProjectSetupV1(setupInput({
      options,
      setupCommand,
      parentFacts,
      roleAdjudication: records.adjudication,
      roleOffer: records.offer,
      extraResources,
    }), gmAdjudicationDependencies)
    expect(ready.authority).toMatchObject({
      status: 'ready',
      roleAdjudicationId: records.adjudication.adjudicationId,
      compatibility: { status: 'compatible', compatibilityKind: 'gm-role-override', reasonIds: [] },
    })

    const freeText = roleRecords({ parentFacts, options, invalidCanonicalValue: true })
    expect(() => validateBreedingProjectSetupV1(setupInput({
      options,
      setupCommand,
      parentFacts,
      roleAdjudication: freeText.adjudication,
      roleOffer: freeText.offer,
      extraResources: [
        readResource('breeding-adjudication', freeText.adjudication.adjudicationId, 1, freeText.adjudication.definitionSha256, ['mechanics']),
        readResource('breeding-offer', freeText.offer.offerId, 1, freeText.offer.definitionSha256, ['mechanics']),
      ],
    }), gmAdjudicationDependencies)).toThrowError(expect.objectContaining({ code: 'breeding.setup.invalid-adjudication' }))

    const expired = roleRecords({ parentFacts, options, consumedAtExpiry: true })
    expect(() => validateBreedingProjectSetupV1(setupInput({
      options,
      setupCommand,
      parentFacts,
      roleAdjudication: expired.adjudication,
      roleOffer: expired.offer,
      extraResources: [
        readResource('breeding-adjudication', expired.adjudication.adjudicationId, 1, expired.adjudication.definitionSha256, ['mechanics']),
        readResource('breeding-offer', expired.offer.offerId, 1, expired.offer.definitionSha256, ['mechanics']),
      ],
    }), gmAdjudicationDependencies)).toThrowError(expect.objectContaining({ code: 'breeding.setup.invalid-adjudication' }))
  })

  it('rejects unknown, enriched, sparse, accessor-backed, and extraneous adjudication evidence', () => {
    expect(() => validateBreedingProjectSetupV1({
      ...setupInput(),
      browserAuthorized: true,
    })).toThrowError(expect.objectContaining({ code: 'breeding.setup.invalid-request' }))
    expect(() => validateBreedingProjectSetupV1({
      ...setupInput(),
      parentFacts: new Array(2),
    })).toThrowError(expect.objectContaining({ code: 'breeding.setup.invalid-request' }))
    const input = setupInput() as Record<string, unknown>
    Object.defineProperty(input, 'campaignOptions', {
      enumerable: true,
      get: () => minimumOptions(),
    })
    expect(() => validateBreedingProjectSetupV1(input))
      .toThrowError(expect.objectContaining({ code: 'breeding.setup.invalid-request' }))
    expect(() => validateBreedingProjectSetupV1(setupInput({
      maturityAdjudications: [{ manufactured: true }],
    }))).toThrowError(expect.objectContaining({ code: 'breeding.setup.extraneous-evidence' }))

    const commandOptions = minimumOptions(20)
    const currentOptions = minimumOptions(30)
    expect(() => validateBreedingProjectSetupV1(setupInput({
      options: currentOptions,
      setupCommand: command({ options: commandOptions, value: 7 }),
    }))).toThrowError(expect.objectContaining({ code: 'breeding.read-set.command-mismatch' }))

    const authority = validateBreedingProjectSetupV1(setupInput()).authority
    expect(() => parseAuthoritativeBreedingProjectSetupValidationV1({
      ...authority,
      evaluatedAtCampaignMinute: authority.evaluatedAtCampaignMinute + 1,
    })).toThrowError(expect.objectContaining({ code: 'breeding.setup.hash-mismatch' }))
  })
})
