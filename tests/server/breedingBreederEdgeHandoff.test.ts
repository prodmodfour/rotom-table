import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import {
  BREEDING_BREEDER_EDGE_CONTRIBUTION_IDS,
  parseBreedingBreederEdgeHandoffV1,
} from '../../shared/breeding/breederEdgeHandoff'
import { parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import { BREEDING_REFERENCE_SOURCE_IDS } from '../../shared/breeding/readSets'
import type { PlayerProfile } from '../../shared/playerProfiles'
import {
  createBreedingActorAuthorityV1,
  createBreedingTrainerControlEvidenceV1,
} from '../../server/domain/breeding/authorization'
import {
  assertBreedingBreederEdgeHandoffMatchesCurrentTrainerV1,
  BREEDING_BREEDER_EDGE_RECORD_SHA256,
  BreedingBreederEdgeHandoffAuthorityError,
  createBreedingBreederEdgeHandoffV1,
} from '../../server/domain/breeding/breederEdgeHandoff'
import { projectBreedingProjectCampaignOperationOfferV1 } from '../../server/domain/breeding/projectOffers'
import { COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256 } from '../../server/domain/breeding/registry'
import { createBreedingReferenceVersionSnapshotV1 } from '../../server/domain/breeding/readSets'
import { planTrainerEdgeCampaignOperation } from '../../server/domain/edgeAutomation/campaignOperations'
import { resolveEffectiveEdges } from '../../server/domain/edgeAutomation/effectiveEdges'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository, type StoredSheetDocument } from '../../server/storage/sheetRepository'
import {
  resolveCurrentBreedingBreederEdgeHandoff,
  ResolveCurrentBreedingBreederEdgeHandoffError,
} from '../../server/useCases/resolveBreedingBreederEdgeHandoff'
import type { TrainerSheet } from '../../src/types/trainerSheet'

const ruleset = rulesetJson as { readonly rulesetId: string, readonly definitionSha256: string }
const securityPolicy = securityPolicyJson as { readonly definitionSha256: string }
const databases: RotomDatabase[] = []
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const operationId = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const command = (value = 1, actorProfileId = 'profile_breeder_0001', selectedTrainerSlug: string | null = 'trainer-breeder') => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(value),
  commandKind: 'preview-breeding',
  actor: { profileId: actorProfileId, selectedTrainerSlug },
  ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 },
  scopes: [],
  payload: {
    ownerTrainerSlug: 'trainer-breeder',
    breederTrainerSlug: 'trainer-breeder',
    parentRefs: [
      { pokemonSheetSlug: 'pokemon-parent-a', expectedSheetRevision: 1 },
      { pokemonSheetSlug: 'pokemon-parent-b', expectedSheetRevision: 1 },
    ],
    optionSnapshotDefinitionSha256: '1'.repeat(64),
  },
})
const profile: PlayerProfile = {
  schemaVersion: 1,
  id: 'profile_breeder_0001',
  displayName: 'Breeder',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-breeder' }],
}
const trainerDocument = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'trainer-breeder',
  name: 'Breeder',
  level: 5,
  skillBackground: { novice: 'pokeEd' },
  edges: [{ name: 'Breeder' }],
  currentTeam: [],
  boxedPokemon: [],
  ...overrides,
})
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
})
const saveTrainer = (
  database: RotomDatabase,
  document: TrainerSheet = trainerDocument(),
  revision = 3,
): StoredSheetDocument<unknown> => createSqliteSheetRepository(database).save({
  kind: 'trainer',
  slug: 'trainer-breeder',
  document,
  revision,
  updatedAt: 1_000 + revision,
})
const playerAuthority = (trainer: StoredSheetDocument<unknown>, minute = 0) => {
  const actor = createBreedingActorAuthorityV1({
    role: 'player',
    command: command(),
    authenticatedPrincipalSha256: '2'.repeat(64),
    authenticationPolicyDefinitionSha256: '3'.repeat(64),
    profile,
    evaluatedAtCampaignMinute: minute,
  })
  const control = createBreedingTrainerControlEvidenceV1({
    profile,
    trainerSheetSlug: trainer.slug,
    trainerSheetRevision: trainer.revision,
    trainerSheetDefinitionSha256: sha256(trainer.document),
    evaluatedAtCampaignMinute: minute,
  })
  return { actor, control }
}
const gmAuthority = (minute = 0) => createBreedingActorAuthorityV1({
  role: 'gm',
  command: command(2, 'campaign-gm', null),
  authenticatedPrincipalSha256: '4'.repeat(64),
  authenticationPolicyDefinitionSha256: '3'.repeat(64),
  profile: null,
  evaluatedAtCampaignMinute: minute,
})
const playerRequest = (trainer: StoredSheetDocument<unknown>, minute = 0) => {
  const authority = playerAuthority(trainer, minute)
  return {
    request: {
      breederTrainerSlug: trainer.slug,
      expectedTrainerSheetRevision: trainer.revision,
      checkpoint: 'project-creation',
      actorAuthority: authority.actor,
      breederTrainerControl: authority.control,
    },
    ...authority,
  }
}
const references = () => createBreedingReferenceVersionSnapshotV1({
  schemaVersion: 1,
  rulesetId: ruleset.rulesetId,
  rulesetDefinitionSha256: ruleset.definitionSha256,
  sourceManifestSha256: '5'.repeat(64),
  semanticRegistryDefinitionSha256: '6'.repeat(64),
  compiledRegistryDefinitionSha256: COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256,
  canonicalIdsDefinitionSha256: '7'.repeat(64),
  campaignOptionSnapshotDefinitionSha256: '1'.repeat(64),
  referenceSources: BREEDING_REFERENCE_SOURCE_IDS.map((sourceId, index) => ({
    sourceId,
    contentSha256: (index + 10).toString(16).padStart(64, '0'),
  })),
  contractDefinitionHashes: [
    'breeding-authorization-contract', 'breeding-ledger-contract', 'breeding-lineage-contract',
    'breeding-operation-contract', 'breeding-project-contract', 'breeding-read-set-contract',
    'breeding-security-policy', 'pokemon-egg-contract',
  ].map((contractId, index) => ({ contractId, definitionSha256: (index + 30).toString(16).padStart(64, '0') })),
})
const gmRequest = (trainer: StoredSheetDocument<unknown>) => ({
  breederTrainerSlug: trainer.slug,
  expectedTrainerSheetRevision: trainer.revision,
  checkpoint: 'project-check',
  actorAuthority: gmAuthority(),
  breederTrainerControl: null,
})

const expectDomainCode = (callback: () => unknown, code: string): void => {
  try {
    callback()
    throw new Error('Expected Breeder Edge handoff failure.')
  }
  catch (error) {
    expect(error).toBeInstanceOf(BreedingBreederEdgeHandoffAuthorityError)
    expect((error as BreedingBreederEdgeHandoffAuthorityError).code).toBe(code)
  }
}
const expectUseCaseCode = (callback: () => unknown, code: string): void => {
  try {
    callback()
    throw new Error('Expected current Breeder Edge handoff failure.')
  }
  catch (error) {
    expect(error).toBeInstanceOf(ResolveCurrentBreedingBreederEdgeHandoffError)
    expect((error as ResolveCurrentBreedingBreederEdgeHandoffError).code).toBe(code)
  }
}

describe('BR-060 authoritative Breeder Edge handoff', () => {
  it('resolves one current player-controlled Breeder into exact breeding authority and dependency evidence', () => {
    const database = open()
    const trainer = saveTrainer(database)
    const { request, control } = playerRequest(trainer)
    const handoff = resolveCurrentBreedingBreederEdgeHandoff(request, { database })

    expect(handoff).toMatchObject({
      schemaVersion: 1,
      capabilityId: 'breeding.v1',
      requestContractId: 'edge.breeder.request.v1',
      sourceContributionIds: BREEDING_BREEDER_EDGE_CONTRIBUTION_IDS,
      checkpoint: 'project-creation',
      breederAuthority: {
        breederTrainerSlug: trainer.slug,
        breederTrainerRevision: trainer.revision,
        breederTrainerDefinitionSha256: sha256(trainer.document),
        accessMode: 'profile-control',
        accessEvidenceDefinitionSha256: control.definitionSha256,
        edgeCanonicalId: 'Breeder',
        edgeRecordSha256: BREEDING_BREEDER_EDGE_RECORD_SHA256,
        pokemonEducationRank: 'Novice',
        pokemonEducationSkillTotal: 3,
      },
      dependencyEvidence: {
        providerKind: 'edge',
        providerId: 'Breeder',
        subjectKind: 'trainer-sheet',
        subjectId: trainer.slug,
        subjectRevision: trainer.revision,
        checkpoint: 'project-creation',
      },
    })
    expect(handoff.dependencyEvidence.effectiveEvidenceSha256).toBe(handoff.breederAuthority.effectiveEdgeProjectionSha256)
    expect(Object.isFrozen(handoff)).toBe(true)
    expect(parseBreedingBreederEdgeHandoffV1(handoff)).toEqual(handoff)
    const offer = projectBreedingProjectCampaignOperationOfferV1({
      command: command(),
      actorAuthority: playerRequest(trainer).actor,
      ownerTrainerControl: control,
      breederTrainerControl: control,
      breederAuthority: handoff.breederAuthority,
      referenceVersions: references(),
      atCampaignMinute: 0,
      securityPolicyDefinitionSha256: securityPolicy.definitionSha256,
    })
    expect(offer.offer.source).toEqual({ kind: 'edge', canonicalId: 'Breeder' })
    expect(offer.offer.availability).toEqual({ status: 'available', reasonId: null })
  })

  it('requires exact synchronous current GM verification and keeps player and GM access families separate', () => {
    const database = open()
    const trainer = saveTrainer(database)
    const request = gmRequest(trainer)
    const verifier = vi.fn(() => true)
    const handoff = resolveCurrentBreedingBreederEdgeHandoff(request, { database, validateCurrentGmAuthority: verifier })
    expect(verifier).toHaveBeenCalledOnce()
    expect(handoff.breederAuthority.accessMode).toBe('gm-authority')
    expect(handoff.breederAuthority.accessEvidenceDefinitionSha256).toBe(request.actorAuthority.definitionSha256)

    expectUseCaseCode(
      () => resolveCurrentBreedingBreederEdgeHandoff(request, { database, validateCurrentGmAuthority: () => false }),
      'breeding.breeder-edge-handoff-use-case.invalid-authority',
    )
    expectUseCaseCode(
      () => resolveCurrentBreedingBreederEdgeHandoff(request, { database, validateCurrentGmAuthority: (() => Promise.resolve(true)) as never }),
      'breeding.breeder-edge-handoff-use-case.invalid-authority',
    )
    const player = playerRequest(trainer).request
    expectUseCaseCode(
      () => resolveCurrentBreedingBreederEdgeHandoff(player, { database, validateCurrentGmAuthority: () => true }),
      'breeding.breeder-edge-handoff-use-case.invalid-authority',
    )
  })

  it('keeps the Edge campaign operation closed until breeding.v1 is available and emits only the reviewed delegation', () => {
    const database = open()
    const trainer = saveTrainer(database)
    const sheet = trainer.document as TrainerSheet
    const resources = { money: 0, items: {}, tools: new Set(), dailyUses: {} }
    const unavailable = planTrainerEdgeCampaignOperation(sheet, { actionId: 'begin-breeding' }, resources)
    expect(unavailable).toMatchObject({ ok: false, reasonCode: 'downstream-capability-unavailable', delegatedRequest: null })
    const available = planTrainerEdgeCampaignOperation(sheet, { actionId: 'begin-breeding' }, resources, { breedingCapabilityAvailable: true })
    expect(available).toMatchObject({
      ok: true,
      moneyDelta: 0,
      itemDeltas: {},
      dailyUseDeltas: {},
      delegatedRequest: { capabilityId: 'breeding.v1', contractId: 'edge.breeder.request.v1' },
    })
  })

  it('derives the current Pokémon Education rank and modifier contribution and detects later authority drift', () => {
    const database = open()
    const trainer = saveTrainer(database, trainerDocument({
      skillBackground: { adept: 'pokeEd' },
      skills: { pokeEd: { modifier: 2 } },
    }))
    const { request } = playerRequest(trainer)
    const handoff = resolveCurrentBreedingBreederEdgeHandoff(request, { database })
    expect(handoff.breederAuthority.pokemonEducationRank).toBe('Adept')
    expect(handoff.breederAuthority.pokemonEducationSkillTotal).toBe(6)

    const current = saveTrainer(database, trainerDocument({ skillBackground: { novice: 'pokeEd' } }), 4)
    expectDomainCode(() => assertBreedingBreederEdgeHandoffMatchesCurrentTrainerV1({
      authority: handoff.breederAuthority,
      trainerSheet: { slug: current.slug, revision: current.revision, document: current.document },
      checkpoint: handoff.checkpoint,
      evaluatedAtCampaignMinute: 0,
    }), 'breeding.breeder-edge-handoff.stale-trainer')
  })

  it('fails closed for missing, duplicate, and suppressed Breeder identities', () => {
    const database = open()
    const missing = saveTrainer(database, trainerDocument({ edges: [] }))
    expectDomainCode(() => createBreedingBreederEdgeHandoffV1({
      trainerSheet: { slug: missing.slug, revision: missing.revision, document: missing.document },
      accessMode: 'gm-authority',
      accessEvidenceDefinitionSha256: 'a'.repeat(64),
      evaluatedAtCampaignMinute: 0,
      checkpoint: 'project-creation',
    }), 'breeding.breeder-edge-handoff.edge-unavailable')

    const duplicate = saveTrainer(database, trainerDocument({ edges: [{ name: 'Breeder' }, { name: 'Breeder' }] }), 4)
    expectDomainCode(() => createBreedingBreederEdgeHandoffV1({
      trainerSheet: { slug: duplicate.slug, revision: duplicate.revision, document: duplicate.document },
      accessMode: 'gm-authority',
      accessEvidenceDefinitionSha256: 'a'.repeat(64),
      evaluatedAtCampaignMinute: 0,
      checkpoint: 'project-creation',
    }), 'breeding.breeder-edge-handoff.edge-ambiguous')

    const current = saveTrainer(database, trainerDocument(), 5)
    expectDomainCode(() => createBreedingBreederEdgeHandoffV1({
      trainerSheet: { slug: current.slug, revision: current.revision, document: current.document },
      accessMode: 'gm-authority',
      accessEvidenceDefinitionSha256: 'a'.repeat(64),
      evaluatedAtCampaignMinute: 0,
      checkpoint: 'project-creation',
    }, {
      resolveEffectiveEdges: input => resolveEffectiveEdges({
        ...input,
        suppressions: [{ canonicalId: 'Breeder', sourceId: 'test', reasonCode: 'test-suppressed' }],
      }),
    }), 'breeding.breeder-edge-handoff.edge-unavailable')
  })

  it('enforces the canonical Novice prerequisite and reserves Feature-granted Breeder authority for BR-061', () => {
    const database = open()
    const untrained = saveTrainer(database, trainerDocument({ skillBackground: undefined }))
    expectDomainCode(() => createBreedingBreederEdgeHandoffV1({
      trainerSheet: { slug: untrained.slug, revision: untrained.revision, document: untrained.document },
      accessMode: 'gm-authority',
      accessEvidenceDefinitionSha256: 'a'.repeat(64),
      evaluatedAtCampaignMinute: 0,
      checkpoint: 'project-preview',
    }), 'breeding.breeder-edge-handoff.prerequisite-not-met')

    const current = saveTrainer(database, trainerDocument(), 4)
    expectDomainCode(() => createBreedingBreederEdgeHandoffV1({
      trainerSheet: { slug: current.slug, revision: current.revision, document: current.document },
      accessMode: 'gm-authority',
      accessEvidenceDefinitionSha256: 'a'.repeat(64),
      evaluatedAtCampaignMinute: 0,
      checkpoint: 'project-preview',
    }, {
      resolveEffectiveEdges: input => {
        const resolved = resolveEffectiveEdges(input)
        return Object.freeze({
          ...resolved,
          instances: Object.freeze(resolved.instances.map(instance => instance.canonicalId === 'Breeder'
            ? Object.freeze({ ...instance, sources: Object.freeze([{ kind: 'feature-grant' as const, sourceId: 'feature:test', precedence: 350 }]) })
            : instance)),
        })
      },
    }), 'breeding.breeder-edge-handoff.unsupported-provider')
  })

  it('rejects stale Trainer revisions, Profile-control hashes, and campaign-minute authority', () => {
    const database = open()
    const trainer = saveTrainer(database)
    const { request, actor } = playerRequest(trainer)
    expectUseCaseCode(() => resolveCurrentBreedingBreederEdgeHandoff({
      ...request,
      expectedTrainerSheetRevision: trainer.revision - 1,
    }, { database }), 'breeding.breeder-edge-handoff-use-case.stale-authority')

    const staleControl = createBreedingTrainerControlEvidenceV1({
      profile,
      trainerSheetSlug: trainer.slug,
      trainerSheetRevision: trainer.revision,
      trainerSheetDefinitionSha256: 'f'.repeat(64),
      evaluatedAtCampaignMinute: 0,
    })
    expectUseCaseCode(() => resolveCurrentBreedingBreederEdgeHandoff({
      ...request,
      breederTrainerControl: staleControl,
    }, { database }), 'breeding.breeder-edge-handoff-use-case.stale-authority')

    const staleActor = { ...actor, evaluatedAtCampaignMinute: 1 }
    expect(() => resolveCurrentBreedingBreederEdgeHandoff({ ...request, actorAuthority: staleActor }, { database })).toThrow()
  })

  it('rejects enriched requests, accessors, unknown checkpoints, and campaign-shared service claims', () => {
    const database = open()
    const trainer = saveTrainer(database)
    const request = playerRequest(trainer).request
    expectUseCaseCode(() => resolveCurrentBreedingBreederEdgeHandoff({ ...request, clientSkillTotal: 99 } as never, { database }), 'breeding.breeder-edge-handoff-use-case.invalid-request')
    const accessor = Object.create(null) as Record<string, unknown>
    for (const [key, value] of Object.entries(request)) accessor[key] = value
    Object.defineProperty(accessor, 'checkpoint', { enumerable: true, get: () => 'project-creation' })
    expectUseCaseCode(() => resolveCurrentBreedingBreederEdgeHandoff(accessor as never, { database }), 'breeding.breeder-edge-handoff-use-case.invalid-request')
    expectDomainCode(() => createBreedingBreederEdgeHandoffV1({
      trainerSheet: { slug: trainer.slug, revision: trainer.revision, document: trainer.document },
      accessMode: 'gm-authority',
      accessEvidenceDefinitionSha256: 'a'.repeat(64),
      evaluatedAtCampaignMinute: 0,
      checkpoint: 'client-checkpoint',
    }), 'breeding.breeder-edge-handoff.invalid-request')
    expectDomainCode(() => createBreedingBreederEdgeHandoffV1({
      trainerSheet: { slug: trainer.slug, revision: trainer.revision, document: trainer.document },
      accessMode: 'campaign-shared-service',
      accessEvidenceDefinitionSha256: 'a'.repeat(64),
      evaluatedAtCampaignMinute: 0,
      checkpoint: 'project-creation',
    }), 'breeding.breeder-edge-handoff.unsupported-provider')
  })

  it('fails synchronously and without storage mutation when an Edge provider throws or returns a Promise', () => {
    const database = open()
    const trainer = saveTrainer(database)
    const request = gmRequest(trainer)
    const before = createSqliteSheetRepository(database).get('trainer', trainer.slug)
    expectDomainCode(() => resolveCurrentBreedingBreederEdgeHandoff(request, {
      database,
      validateCurrentGmAuthority: () => true,
      planTrainerEdgeCampaignOperation: (() => { throw new Error('injected') }) as never,
    }), 'breeding.breeder-edge-handoff.provider-failure')
    expectDomainCode(() => resolveCurrentBreedingBreederEdgeHandoff(request, {
      database,
      validateCurrentGmAuthority: () => true,
      resolveEffectiveEdges: (() => Promise.resolve({})) as never,
    }), 'breeding.breeder-edge-handoff.provider-failure')
    expect(createSqliteSheetRepository(database).get('trainer', trainer.slug)).toEqual(before)
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM breeding_operations').get()).toEqual({ count: 0 })
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()).toEqual({ count: 0 })
  })

  it('rejects tampered bundle hashes and compares supplied authority by exact stable JSON', () => {
    const database = open()
    const trainer = saveTrainer(database)
    const handoff = resolveCurrentBreedingBreederEdgeHandoff(playerRequest(trainer).request, { database })
    expect(() => parseBreedingBreederEdgeHandoffV1({
      ...handoff,
      dependencyEvidence: { ...handoff.dependencyEvidence, checkpoint: 'project-check' },
    })).toThrow()
    expectDomainCode(() => assertBreedingBreederEdgeHandoffMatchesCurrentTrainerV1({
      authority: { ...handoff.breederAuthority, pokemonEducationSkillTotal: 99 },
      trainerSheet: { slug: trainer.slug, revision: trainer.revision, document: trainer.document },
      checkpoint: handoff.checkpoint,
      evaluatedAtCampaignMinute: 0,
    }), 'breeding.breeder-edge-handoff.invalid-request')
  })
})
