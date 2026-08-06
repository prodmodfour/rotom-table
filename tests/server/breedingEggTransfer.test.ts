import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import authorityJson from '../fixtures/breeding/egg-production-cross-owner-authority-v1.json'
import eggContractJson from '../../data/breeding-automation/egg-contract.json'
import hatchDurationPolicyJson from '../../data/breeding-automation/hatch-duration-policy.json'
import eggTransferContractJson from '../../data/breeding-automation/egg-transfer-contract.json'
import storageSchemaV26Json from '../../data/breeding-automation/storage-schema-v26.json'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import type { PlayerProfile } from '../../shared/playerProfiles'
import { parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import { parseBreedingReadResourceV1 } from '../../shared/breeding/readSets'
import type { PokemonEggDocumentV1 } from '../../shared/breeding/egg'
import {
  createBreedingActorAuthorityV1,
  createBreedingTrainerControlEvidenceV1,
} from '../../server/domain/breeding/authorization'
import {
  POKEMON_EGG_TRANSFER_POLICY_DEFINITION_SHA256,
  PokemonEggTransferAuthorityError,
  authorizePokemonEggTransferV1,
  createPokemonEggTransferConsentV1,
  pokemonEggTransferEffectiveEvidenceSha256,
  projectPokemonEggTransferV1,
  resolvePokemonEggTransferAgreementV1,
} from '../../server/domain/breeding/eggTransfer'
import {
  createPokemonEggOffspringBlueprintV1,
  parseAuthoritativePokemonEggDocumentV1,
} from '../../server/domain/breeding/lineage'
import {
  createBreedingOperationAcceptedV1,
  createBreedingOperationCommandHash,
} from '../../server/domain/breeding/operations'
import { createBreedingOperationReadSetV1 } from '../../server/domain/breeding/readSets'
import { compiledBreedingSpeciesSpec } from '../../server/domain/breeding/registry'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteBreedingOperationRepository } from '../../server/storage/breedingOperationRepository'
import { createSqlitePokemonEggRepository } from '../../server/storage/pokemonEggRepository'
import { createSqlitePokemonEggTransferConsentRepository } from '../../server/storage/pokemonEggTransferConsentRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import {
  grantPokemonEggTransferConsent,
  queryPokemonEggTransferConsent,
} from '../../server/useCases/managePokemonEggTransferConsent'
import {
  transferPokemonEggOwnership,
  TransferPokemonEggOwnershipError,
} from '../../server/useCases/transferPokemonEggOwnership'

const authority = authorityJson as any
const databases: RotomDatabase[] = []
afterEach(() => { while (databases.length > 0) databases.pop()?.close() })
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}
const sha = (value: unknown): string => createHash('sha256')
  .update(typeof value === 'string' ? value : stableJsonStringify(value))
  .digest('hex')
const op = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const eggId = (value: number): string => `pokemon-egg:v1:${value.toString(16).padStart(32, '0')}`
const consentId = (value: number): string => `egg-transfer-consent:v1:${value.toString(16).padStart(32, '0')}`
const readSetId = (value: number): string => `breeding-read-set:v1:${value.toString(16).padStart(32, '0')}`
const optionId = (value: number): string => `option:v1:${value.toString(16).padStart(32, '0')}`
const ruleset = authority.project.ruleset
const EGG_ID = eggId(1)
const SOURCE_CONSENT_ID = consentId(1)
const RECIPIENT_CONSENT_ID = consentId(2)
const SOURCE_PROFILE: PlayerProfile = {
  schemaVersion: 1,
  id: 'profile_owner_0001' as any,
  displayName: 'Source' as any,
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-owner' }],
}
const RECIPIENT_PROFILE: PlayerProfile = {
  schemaVersion: 1,
  id: 'profile_recipient_0001' as any,
  displayName: 'Recipient' as any,
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-recipient' }],
}
const sourceCommand = () => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: op(1),
  commandKind: 'create-source-egg',
  actor: { profileId: 'gm-principal', selectedTrainerSlug: null },
  ruleset,
  scopes: [{ kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: null }],
  payload: {
    eggId: EGG_ID,
    ownerTrainerSlug: 'trainer-owner',
    source: { kind: 'gm', reasonId: 'breeding.egg-source.reviewed', evidenceDefinitionSha256: 'e'.repeat(64) },
    speciesOptionId: optionId(1),
    resolutions: { selectedOptionIds: [], requestedRollKinds: [] },
  },
})
const egg = (): PokemonEggDocumentV1 => {
  const species = compiledBreedingSpeciesSpec('bulbasaur')!
  const blueprint = createPokemonEggOffspringBlueprintV1({
    schemaVersion: 1,
    speciesId: species.speciesId,
    familyRootSpeciesId: species.familyRootSpeciesId,
    speciesSpecDefinitionSha256: species.definitionSha256,
    nature: { valueId: 'cuddly', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    ability: { valueId: species.basicAbilityIds[0]!, resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    gender: { valueId: 'female', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    inheritanceCandidates: [],
    startingLevel: 1,
    babyTemplate: { applied: false, choiceOptionId: null, choiceEvidenceId: null, effects: null },
  })
  const durationResultDefinitionSha256 = 'd'.repeat(64)
  return parseAuthoritativePokemonEggDocumentV1({
    schemaVersion: 1,
    eggId: EGG_ID,
    revision: 0,
    status: 'incubating',
    ownerTrainerSlug: 'trainer-owner',
    source: { kind: 'gm', reasonId: 'breeding.egg-source.reviewed', evidenceDefinitionSha256: 'e'.repeat(64) },
    ruleset,
    definitionHashes: [
      blueprint.definitionSha256,
      durationResultDefinitionSha256,
      eggContractJson.definitionSha256,
      hatchDurationPolicyJson.definitionSha256,
      ruleset.definitionSha256,
    ].sort(),
    parents: [],
    breeder: null,
    offspring: blueprint,
    incubation: {
      averageCampaignMinutes: 600,
      targetCampaignMinutes: 600,
      accumulatedCampaignMinutes: 100,
      variationPolicyId: 'fixed-average',
      durationResultDefinitionSha256,
      lastAppliedClockRevision: 1,
      lastAppliedClockMinute: 100,
      readyAtCampaignMinute: null,
      readinessKind: null,
      readyOperationId: null,
      paused: false,
      pauseReasonId: null,
      pauseOperationId: null,
    },
    special: { state: 'not-rolled', rollRecordId: null, rollTotal: null, triggerIds: [], adjudicationId: null, outcomeId: null, automaticShiny: false },
    hatchOperationId: null,
    childSheetSlug: null,
    terminal: null,
    createdAtCampaignMinute: 100,
    updatedAtCampaignMinute: 100,
    statusChangedAtCampaignMinute: 100,
    lastOperationId: op(1),
  })
}
const transferCommand = (operation = 10) => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: op(operation),
  commandKind: 'transfer-egg',
  actor: { profileId: SOURCE_PROFILE.id, selectedTrainerSlug: 'trainer-owner' },
  ruleset,
  scopes: [
    { kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: 0 },
    { kind: 'egg-transfer-consent', consentId: SOURCE_CONSENT_ID, expectedRevision: 0 },
    { kind: 'egg-transfer-consent', consentId: RECIPIENT_CONSENT_ID, expectedRevision: 0 },
  ],
  payload: {
    eggId: EGG_ID,
    destinationTrainerSlug: 'trainer-recipient',
    consentEvidenceIds: [SOURCE_CONSENT_ID, RECIPIENT_CONSENT_ID],
  },
})
const resource = (
  resourceKind: string,
  resourceId: string,
  revision: number,
  definitionSha256: string,
  purposes: readonly string[],
  observedCampaignMinute: number | null = null,
) => parseBreedingReadResourceV1({
  resourceKind,
  resourceId,
  existence: 'present',
  revision,
  definitionSha256,
  observedCampaignMinute,
  purposes: [...purposes].sort(),
})

interface Seeded {
  readonly database: RotomDatabase
  readonly egg: PokemonEggDocumentV1
  readonly sourceFact: { readonly slug: string, readonly revision: number, readonly definitionSha256: string }
  readonly recipientFact: { readonly slug: string, readonly revision: number, readonly definitionSha256: string }
}
const seed = (): Seeded => {
  const database = open()
  const command = sourceCommand()
  const initialEgg = egg()
  database.withTransaction(() => {
    const operations = createSqliteBreedingOperationRepository(database)
    operations.reserve(command, 100)
    createSqlitePokemonEggRepository(database).insert(initialEgg)
    operations.settle(command, createBreedingOperationAcceptedV1({
      operationId: command.operationId,
      commandHash: createBreedingOperationCommandHash(command),
      commandKind: command.commandKind,
      outcomeKind: 'source-egg-created',
      aggregateRefs: [{ kind: 'pokemon-egg', id: EGG_ID, revision: 0 }],
      changedScopes: command.scopes,
      committedAtCampaignMinute: 100,
    }), 100)
    database.connection.prepare(`
      UPDATE campaign_clock SET revision = 1, campaign_minute = 100, last_operation_id = ? WHERE singleton = 1
    `).run(command.operationId)
    database.connection.prepare(`
      INSERT INTO sheets (kind, slug, document_json, revision, updated_at)
      VALUES ('trainer', 'trainer-owner', ?, 5, 100), ('trainer', 'trainer-recipient', ?, 7, 100)
    `).run(stableJsonStringify({ slug: 'trainer-owner', folder: '' }), stableJsonStringify({ slug: 'trainer-recipient', folder: '' }))
  })
  const sheets = createSqliteSheetRepository(database)
  const source = sheets.get('trainer', 'trainer-owner')!
  const recipient = sheets.get('trainer', 'trainer-recipient')!
  return {
    database,
    egg: initialEgg,
    sourceFact: { slug: source.slug, revision: source.revision, definitionSha256: sha(source.document) },
    recipientFact: { slug: recipient.slug, revision: recipient.revision, definitionSha256: sha(recipient.document) },
  }
}
const controls = (seeded: Seeded, campaignMinute = 100) => ({
  source: createBreedingTrainerControlEvidenceV1({
    profile: SOURCE_PROFILE,
    trainerSheetSlug: seeded.sourceFact.slug,
    trainerSheetRevision: seeded.sourceFact.revision,
    trainerSheetDefinitionSha256: seeded.sourceFact.definitionSha256,
    evaluatedAtCampaignMinute: campaignMinute,
  }),
  recipient: createBreedingTrainerControlEvidenceV1({
    profile: RECIPIENT_PROFILE,
    trainerSheetSlug: seeded.recipientFact.slug,
    trainerSheetRevision: seeded.recipientFact.revision,
    trainerSheetDefinitionSha256: seeded.recipientFact.definitionSha256,
    evaluatedAtCampaignMinute: campaignMinute,
  }),
})
const consents = (seeded: Seeded, expiresAtCampaignMinute = 200) => {
  const currentControls = controls(seeded)
  const source = createPokemonEggTransferConsentV1({
    consentId: SOURCE_CONSENT_ID,
    role: 'source-gift',
    egg: seeded.egg,
    sourceTrainer: seeded.sourceFact,
    destinationTrainer: seeded.recipientFact,
    trainerControl: currentControls.source,
    counterpartConsent: null,
    grantedAtCampaignMinute: 100,
    expiresAtCampaignMinute,
  })
  const recipient = createPokemonEggTransferConsentV1({
    consentId: RECIPIENT_CONSENT_ID,
    role: 'recipient-acceptance',
    egg: seeded.egg,
    sourceTrainer: seeded.sourceFact,
    destinationTrainer: seeded.recipientFact,
    trainerControl: currentControls.recipient,
    counterpartConsent: source,
    grantedAtCampaignMinute: 100,
    expiresAtCampaignMinute,
  })
  seeded.database.withTransaction(() => {
    const repository = createSqlitePokemonEggTransferConsentRepository(seeded.database)
    repository.insert(source)
    repository.insert(recipient)
  })
  return { source, recipient, controls: currentControls }
}
const readSetAndReceipt = (seeded: Seeded, accepted: ReturnType<typeof consents>, command = transferCommand()) => {
  const agreement = resolvePokemonEggTransferAgreementV1({
    egg: seeded.egg,
    destinationTrainerSlug: 'trainer-recipient',
    consents: [accepted.source, accepted.recipient],
    atCampaignMinute: 100,
  })
  const transferDependency = {
    providerKind: 'system' as const,
    providerId: 'breeding.egg-transfer-policy-v1',
    subjectKind: 'pokemon-egg' as const,
    subjectId: EGG_ID,
    subjectRevision: 0,
    checkpoint: 'authorization' as const,
    providerDefinitionSha256: POKEMON_EGG_TRANSFER_POLICY_DEFINITION_SHA256,
    effectiveEvidenceSha256: pokemonEggTransferEffectiveEvidenceSha256({
      egg: seeded.egg,
      agreement,
      sourceControl: accepted.controls.source,
      destinationControl: accepted.controls.recipient,
    }),
  }
  const dependencies = [{
    providerKind: 'system' as const,
    providerId: 'breeding-effective-dependency-set-v1',
    subjectKind: 'campaign' as const,
    subjectId: 'campaign',
    subjectRevision: null,
    checkpoint: 'authorization' as const,
    providerDefinitionSha256: securityPolicyJson.definitionSha256,
    effectiveEvidenceSha256: sha([transferDependency]),
  }, transferDependency]
  const readSet = createBreedingOperationReadSetV1({
    readSetId: readSetId(10) as any,
    operationId: command.operationId,
    commandSha256: createBreedingOperationCommandHash(command),
    commandKind: command.commandKind,
    capturedAtCampaignMinute: 100,
    resources: [
      resource('campaign-clock', 'campaign-clock', 1, sha({ schemaVersion: 1, revision: 1, campaignMinute: 100, lastOperationId: op(1) }), ['campaign-time'], 100),
      resource('pokemon-egg', EGG_ID, 0, sha(seeded.egg), ['conflict', 'mechanics']),
      resource('egg-transfer-consent', accepted.source.consentId, 0, accepted.source.definitionSha256, ['conflict', 'consent']),
      resource('egg-transfer-consent', accepted.recipient.consentId, 0, accepted.recipient.definitionSha256, ['conflict', 'consent']),
      resource('trainer-sheet', seeded.sourceFact.slug, seeded.sourceFact.revision, seeded.sourceFact.definitionSha256, ['authorization']),
      resource('trainer-sheet', seeded.recipientFact.slug, seeded.recipientFact.revision, seeded.recipientFact.definitionSha256, ['authorization', 'write-destination']),
    ],
    referenceVersions: authority.readSet.referenceVersions,
    dependencyEvidence: dependencies,
    writeExpectations: command.scopes,
  })
  const actor = createBreedingActorAuthorityV1({
    role: 'player',
    command,
    authenticatedPrincipalSha256: 'a'.repeat(64),
    authenticationPolicyDefinitionSha256: 'b'.repeat(64),
    profile: SOURCE_PROFILE,
    evaluatedAtCampaignMinute: 100,
  })
  const receipt = authorizePokemonEggTransferV1({
    command,
    readSet,
    actorAuthority: actor,
    egg: seeded.egg,
    agreement,
    sourceControl: accepted.controls.source,
    destinationControl: accepted.controls.recipient,
    gmAuthorityVerified: false,
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  return { readSet, receipt, actor }
}
const options = (seeded: Seeded, accepted: ReturnType<typeof consents>, overrides: Record<string, unknown> = {}) => ({
  database: seeded.database,
  campaignProjectionKey: 'campaign-projection-key-at-least-32-bytes',
  realtimeTimestamp: 1_000,
  resolveCurrentTrainerControl: ({ trainerSlug }: { trainerSlug: string }) => trainerSlug === 'trainer-owner'
    ? accepted.controls.source
    : accepted.controls.recipient,
  ...overrides,
})

describe('BR-064 Egg transfer, gift consent, storage, and privacy', () => {
  it('binds the reviewed transfer, privacy, transaction, and v26 storage contract', () => {
    expect(sha(eggTransferContractJson.definition)).toBe(eggTransferContractJson.definitionSha256)
    expect(eggTransferContractJson.definition.bindings.runtimePolicyDefinitionSha256)
      .toBe(POKEMON_EGG_TRANSFER_POLICY_DEFINITION_SHA256)
    expect(eggTransferContractJson.definition).toMatchObject({
      clientAuthority: 'none',
      workflow: { requiredConsentCount: 2, gmOverride: 'cannot-create-or-replace-positive-consent' },
      storage: { schemaVersion: 26, mutationHelpers: 'caller-owned-transaction-only' },
    })
    expect(storageSchemaV26Json.definition).toMatchObject({
      fromVersion: 25,
      toVersion: 26,
      newScopeKind: 'egg-transfer-consent',
      invariants: { offlineParity: true, noMapEncounterColumns: true },
    })
  })

  it('grants each participant consent only through current Profile control and supports targeted polling', () => {
    const seeded = seed()
    const currentControls = controls(seeded)
    const sourceActor = createBreedingActorAuthorityV1({
      role: 'player', command: transferCommand(), authenticatedPrincipalSha256: 'a'.repeat(64),
      authenticationPolicyDefinitionSha256: 'b'.repeat(64), profile: SOURCE_PROFILE,
      evaluatedAtCampaignMinute: 100,
    })
    const source = grantPokemonEggTransferConsent({
      consentId: SOURCE_CONSENT_ID,
      role: 'source-gift',
      eggId: EGG_ID,
      destinationTrainerSlug: 'trainer-recipient',
      sourceConsentId: null,
      expiresAtCampaignMinute: 200,
      actorAuthority: sourceActor,
      trainerControl: currentControls.source,
    }, { database: seeded.database, validateCurrentProfileControl: () => true })
    const recipientCommand = parseBreedingOperationCommandV1({
      ...transferCommand(),
      actor: { profileId: RECIPIENT_PROFILE.id, selectedTrainerSlug: 'trainer-recipient' },
    })
    const recipientActor = createBreedingActorAuthorityV1({
      role: 'player', command: recipientCommand, authenticatedPrincipalSha256: 'c'.repeat(64),
      authenticationPolicyDefinitionSha256: 'b'.repeat(64), profile: RECIPIENT_PROFILE,
      evaluatedAtCampaignMinute: 100,
    })
    const recipient = grantPokemonEggTransferConsent({
      consentId: RECIPIENT_CONSENT_ID,
      role: 'recipient-acceptance',
      eggId: EGG_ID,
      destinationTrainerSlug: 'trainer-recipient',
      sourceConsentId: SOURCE_CONSENT_ID,
      expiresAtCampaignMinute: 200,
      actorAuthority: recipientActor,
      trainerControl: currentControls.recipient,
    }, { database: seeded.database, validateCurrentProfileControl: () => true })
    expect(recipient.counterpartConsentId).toBe(source.consentId)
    const projection = queryPokemonEggTransferConsent({
      sourceConsentId: source.consentId,
      audience: 'recipient',
      trainerControl: currentControls.recipient,
    }, { database: seeded.database, validateCurrentProfileControl: () => true })
    expect(projection).toMatchObject({ state: 'accepted', canTransfer: true, counterpartyTrainerSlug: 'trainer-owner' })
    expect(createSqlitePokemonEggRepository(seeded.database).get(EGG_ID)).toEqual(seeded.egg)
    expect(() => queryPokemonEggTransferConsent({
      sourceConsentId: source.consentId,
      audience: 'recipient',
      trainerControl: currentControls.source,
    }, { database: seeded.database, validateCurrentProfileControl: () => true })).toThrow('exact current control')
  })

  it('rejects failed current-control validation, exactly replays one grant, and serializes competing active gifts', () => {
    const seeded = seed()
    const currentControls = controls(seeded)
    const actor = createBreedingActorAuthorityV1({
      role: 'player', command: transferCommand(), authenticatedPrincipalSha256: 'a'.repeat(64),
      authenticationPolicyDefinitionSha256: 'b'.repeat(64), profile: SOURCE_PROFILE,
      evaluatedAtCampaignMinute: 100,
    })
    const request = {
      consentId: SOURCE_CONSENT_ID,
      role: 'source-gift' as const,
      eggId: EGG_ID,
      destinationTrainerSlug: 'trainer-recipient',
      sourceConsentId: null,
      expiresAtCampaignMinute: 200,
      actorAuthority: actor,
      trainerControl: currentControls.source,
    }
    expect(() => grantPokemonEggTransferConsent(request, {
      database: seeded.database,
      validateCurrentProfileControl: () => false,
    })).toThrow('exact true')
    expect(createSqlitePokemonEggTransferConsentRepository(seeded.database).listByEgg(EGG_ID)).toEqual([])
    const first = grantPokemonEggTransferConsent(request, {
      database: seeded.database,
      validateCurrentProfileControl: () => true,
    })
    expect(grantPokemonEggTransferConsent(request, {
      database: seeded.database,
      validateCurrentProfileControl: () => true,
    })).toEqual(first)
    expect(() => grantPokemonEggTransferConsent({ ...request, consentId: consentId(3) }, {
      database: seeded.database,
      validateCurrentProfileControl: () => true,
    })).toThrow()
    expect(createSqlitePokemonEggTransferConsentRepository(seeded.database).listByEgg(EGG_ID)).toHaveLength(1)
  })

  it('creates linked positive consents and projects only coarse targeted invitation state', () => {
    const seeded = seed()
    const accepted = consents(seeded)
    const agreement = resolvePokemonEggTransferAgreementV1({
      egg: seeded.egg,
      destinationTrainerSlug: 'trainer-recipient',
      consents: [accepted.source, accepted.recipient],
      atCampaignMinute: 100,
    })
    expect(agreement.recipientConsent.counterpartConsentId).toBe(accepted.source.consentId)
    const projection = projectPokemonEggTransferV1({
      sourceConsent: accepted.source,
      recipientConsent: accepted.recipient,
      audience: 'recipient',
      generatedAtCampaignMinute: 100,
    })
    expect(projection).toMatchObject({ state: 'accepted', canTransfer: true, counterpartyTrainerSlug: 'trainer-owner' })
    expect(stableJsonStringify(projection)).not.toMatch(/offspring|parent|breeder|sourceKind|provider|profile_/)
    const expiredProjection = projectPokemonEggTransferV1({
      sourceConsent: accepted.source,
      recipientConsent: accepted.recipient,
      audience: 'recipient',
      generatedAtCampaignMinute: 200,
    })
    expect(expiredProjection).toMatchObject({
      state: 'expired', canAccept: false, canTransfer: false, canRevoke: false,
    })
  })

  it('atomically transfers one current Egg, consumes both consents, preserves mechanics, and retries silently', () => {
    const seeded = seed()
    const accepted = consents(seeded)
    const authority = readSetAndReceipt(seeded, accepted)
    const first = transferPokemonEggOwnership({
      command: transferCommand(),
      readSet: authority.readSet,
      authorizationReceipt: authority.receipt,
      actorAuthority: authority.actor,
      audience: 'source-owner',
    }, options(seeded, accepted))
    expect(first.execution.kind).toBe('executed')
    expect(first.projection).toMatchObject({ state: 'transferred', canTransfer: false })
    const transferred = createSqlitePokemonEggRepository(seeded.database).get(EGG_ID)!
    expect(transferred).toMatchObject({ ownerTrainerSlug: 'trainer-recipient', revision: 1, status: 'incubating' })
    expect(transferred.incubation).toEqual(seeded.egg.incubation)
    expect(transferred.offspring).toEqual(seeded.egg.offspring)
    expect(createSqlitePokemonEggTransferConsentRepository(seeded.database).listByEgg(EGG_ID).map(value => value.status)).toEqual(['consumed', 'consumed'])
    expect(seeded.database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()).toEqual({ count: 5 })
    const realtimeJson = seeded.database.connection.prepare('SELECT event_json FROM realtime_events ORDER BY sequence ASC').all()
      .map(row => String(row.event_json)).join('\n')
    expect(realtimeJson).not.toMatch(/offspring|parents|breeder|consent|profile_|provider|readSet|receipt/)

    const retry = transferPokemonEggOwnership({
      command: transferCommand(),
      readSet: authority.readSet,
      authorizationReceipt: authority.receipt,
      actorAuthority: authority.actor,
      audience: 'recipient',
    }, options(seeded, accepted))
    expect(retry.execution.kind).toBe('exact-retry')
    expect(retry.projection?.state).toBe('transferred')
    expect(seeded.database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()).toEqual({ count: 5 })
  })

  it('rolls back Egg, consent, result, and realtime rows together while retaining recoverable phase-one evidence', () => {
    const seeded = seed()
    const accepted = consents(seeded)
    const authority = readSetAndReceipt(seeded, accepted)
    expect(() => transferPokemonEggOwnership({
      command: transferCommand(),
      readSet: authority.readSet,
      authorizationReceipt: authority.receipt,
      actorAuthority: authority.actor,
      audience: 'source-owner',
    }, options(seeded, accepted, { beforeSettle: () => { throw new Error('injected') } }))).toThrow('injected')
    expect(createSqlitePokemonEggRepository(seeded.database).get(EGG_ID)?.revision).toBe(0)
    expect(createSqlitePokemonEggTransferConsentRepository(seeded.database).listByEgg(EGG_ID).map(value => value.status)).toEqual(['active', 'active'])
    expect(createSqliteBreedingOperationRepository(seeded.database).get(op(10))?.status).toBe('pending')
    expect(seeded.database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()).toEqual({ count: 0 })
    const pending = transferPokemonEggOwnership({
      command: transferCommand(),
      readSet: authority.readSet,
      authorizationReceipt: authority.receipt,
      actorAuthority: authority.actor,
      audience: 'source-owner',
    }, options(seeded, accepted))
    expect(pending).toMatchObject({ execution: { kind: 'pending' }, projection: null })
    expect(seeded.database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()).toEqual({ count: 0 })

    const resumed = transferPokemonEggOwnership({
      command: transferCommand(),
      readSet: authority.readSet,
      authorizationReceipt: authority.receipt,
      actorAuthority: authority.actor,
      audience: 'recipient',
    }, options(seeded, accepted, { resumePending: true }))
    expect(resumed.execution.kind).toBe('executed')
    expect(createSqlitePokemonEggRepository(seeded.database).get(EGG_ID)?.revision).toBe(1)
  })

  it('fails closed at expiry equality, on stale Trainer authority, and on Promise-like control providers', () => {
    const expiredSeed = seed()
    const expired = consents(expiredSeed, 200)
    expect(() => resolvePokemonEggTransferAgreementV1({
      egg: expiredSeed.egg,
      destinationTrainerSlug: 'trainer-recipient',
      consents: [expired.source, expired.recipient],
      atCampaignMinute: 200,
    })).toThrow(PokemonEggTransferAuthorityError)

    const staleSeed = seed()
    const stale = consents(staleSeed)
    const authority = readSetAndReceipt(staleSeed, stale)
    staleSeed.database.connection.prepare("UPDATE sheets SET revision = revision + 1 WHERE kind = 'trainer' AND slug = 'trainer-recipient'").run()
    expect(() => transferPokemonEggOwnership({
      command: transferCommand(), readSet: authority.readSet, authorizationReceipt: authority.receipt,
      actorAuthority: authority.actor, audience: 'source-owner',
    }, options(staleSeed, stale))).toThrow(TransferPokemonEggOwnershipError)

    const asyncSeed = seed()
    const asyncConsents = consents(asyncSeed)
    const asyncAuthority = readSetAndReceipt(asyncSeed, asyncConsents)
    expect(() => transferPokemonEggOwnership({
      command: transferCommand(), readSet: asyncAuthority.readSet, authorizationReceipt: asyncAuthority.receipt,
      actorAuthority: asyncAuthority.actor, audience: 'source-owner',
    }, options(asyncSeed, asyncConsents, { resolveCurrentTrainerControl: () => Promise.resolve(asyncConsents.controls.source) }))).toThrow('must be synchronous')
  })

  it('rejects malformed, enriched, accessor-backed, or mismatched consent evidence', () => {
    const seeded = seed()
    const accepted = consents(seeded)
    expect(() => resolvePokemonEggTransferAgreementV1({
      egg: seeded.egg,
      destinationTrainerSlug: 'trainer-other',
      consents: [accepted.source, accepted.recipient],
      atCampaignMinute: 100,
    })).toThrow(PokemonEggTransferAuthorityError)
    const enriched = { ...accepted.source, extra: true }
    expect(() => resolvePokemonEggTransferAgreementV1({
      egg: seeded.egg, destinationTrainerSlug: 'trainer-recipient', consents: [enriched, accepted.recipient], atCampaignMinute: 100,
    })).toThrow()
    const accessor = { ...accepted.source } as Record<string, unknown>
    Object.defineProperty(accessor, 'status', { enumerable: true, get: () => 'active' })
    expect(() => resolvePokemonEggTransferAgreementV1({
      egg: seeded.egg, destinationTrainerSlug: 'trainer-recipient', consents: [accessor, accepted.recipient], atCampaignMinute: 100,
    })).toThrow()
    const accessorArray = [accepted.source, accepted.recipient]
    Object.defineProperty(accessorArray, '0', { enumerable: true, get: () => accepted.source })
    expect(() => resolvePokemonEggTransferAgreementV1({
      egg: seeded.egg, destinationTrainerSlug: 'trainer-recipient', consents: accessorArray, atCampaignMinute: 100,
    })).toThrow('enumerable data entry')
    expect(() => createSqlitePokemonEggTransferConsentRepository(seeded.database).insert(accepted.source)).toThrow('caller-owned SQLite transaction')
  })
})
