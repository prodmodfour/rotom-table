import { afterEach, describe, expect, it } from 'vitest'
import activityContractJson from '../../data/breeding-automation/workshop-activity-presentation-contract.json'
import { parsePokemonEggDocumentV1, type PokemonEggDocumentV1 } from '../../shared/breeding/egg'
import type { PokemonEggTransferConsentV1 } from '../../shared/breeding/eggTransfer'
import { parseBreedingProjectDocumentV1, type BreedingProjectDocumentV1 } from '../../shared/breeding/project'
import type { PlayerProfile } from '../../shared/playerProfiles'
import {
  parseAuthoritativePokemonEggTransferConsentV1,
  pokemonEggTransferConsentDefinitionSha256,
} from '../../server/domain/breeding/eggTransfer'
import {
  BREEDING_WORKSHOP_ACTIVITY_PRESENTATION_POLICY_DEFINITION_SHA256,
  parseAuthoritativeBreedingWorkshopActivityProjectionV1,
} from '../../server/domain/breeding/workshopActivity'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import {
  LoadBreedingWorkshopActivityError,
  loadBreedingWorkshopActivity,
} from '../../server/useCases/loadBreedingWorkshopActivity'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  databases.push(database)
  return database
}
afterEach(() => { while (databases.length) databases.pop()?.close() })
const ruleset = { rulesetId: 'ptu-1.05-breeding-v1', definitionSha256: 'a'.repeat(64) }
const PROJECT_ID = 'breeding-project:v1:11111111111111111111111111111111'
const EGG_ID = 'pokemon-egg:v1:22222222222222222222222222222222'
const op = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const profile = (): PlayerProfile => ({
  schemaVersion: 1,
  id: 'profile_owner000' as never,
  displayName: 'Owner' as never,
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-owner' }],
})
const project = (): BreedingProjectDocumentV1 => parseBreedingProjectDocumentV1({
  schemaVersion: 1,
  projectId: PROJECT_ID,
  revision: 1,
  status: 'awaiting-parent-consent',
  ruleset,
  projectCreationOptionSnapshotSha256: 'b'.repeat(64),
  ownerTrainerSlug: 'trainer-owner',
  breederTrainerSlug: 'trainer-owner',
  parentRefs: [
    { pokemonSheetSlug: 'pokemon-owned', ownerTrainerSlug: 'trainer-owner', expectedSheetRevision: 0 },
    { pokemonSheetSlug: 'pokemon-private', ownerTrainerSlug: 'trainer-private', expectedSheetRevision: 0 },
  ],
  consentPolicy: 'cross-owner-current-revision-consent',
  timeline: {
    initialRequiredCampaignMinutes: 240,
    initialAccumulatedCampaignMinutes: 0,
    additionalRequiredCampaignMinutes: 240,
    additionalAccumulatedCampaignMinutes: 0,
    initialStartedAtCampaignMinute: null,
    checkReadyAtCampaignMinute: null,
    additionalStartedAtCampaignMinute: null,
    readyToProduceAtCampaignMinute: null,
    eggProducedAtCampaignMinute: null,
    lastAppliedClockRevision: null,
    lastAppliedClockMinute: null,
  },
  check: null,
  producedEggId: null,
  terminal: null,
  createdAtCampaignMinute: 100,
  updatedAtCampaignMinute: 100,
  statusChangedAtCampaignMinute: 100,
  lastOperationId: op(1),
})
const egg = (): PokemonEggDocumentV1 => parsePokemonEggDocumentV1({
  schemaVersion: 1,
  eggId: EGG_ID,
  revision: 0,
  status: 'incubating',
  ownerTrainerSlug: 'trainer-owner',
  source: { kind: 'fossil', sourceId: 'fossil:helix', evidenceDefinitionSha256: '1'.repeat(64) },
  ruleset,
  definitionHashes: ['1'.repeat(64), '2'.repeat(64)],
  parents: [],
  breeder: null,
  offspring: {
    schemaVersion: 1,
    speciesId: 'omanyte',
    familyRootSpeciesId: 'omanyte',
    speciesSpecDefinitionSha256: '2'.repeat(64),
    nature: { valueId: 'cuddly', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    ability: { valueId: 'swift-swim', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    gender: { valueId: 'female', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    inheritanceCandidates: [],
    providerTraits: { serpentsMark: null, fossilRestoration: null, prehistoricBond: null },
    startingLevel: 10,
    babyTemplate: { applied: false, choiceOptionId: null, choiceEvidenceId: null, effects: null },
    definitionSha256: '3'.repeat(64),
  },
  incubation: {
    averageCampaignMinutes: 14_400,
    targetCampaignMinutes: 14_400,
    accumulatedCampaignMinutes: 120,
    variationPolicyId: 'fixed-average',
    durationResultDefinitionSha256: '4'.repeat(64),
    lastAppliedClockRevision: 4,
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
  createdAtCampaignMinute: 90,
  updatedAtCampaignMinute: 100,
  statusChangedAtCampaignMinute: 90,
  lastOperationId: op(2),
})
const save = (database: RotomDatabase, kind: 'trainer' | 'pokemon', slug: string, name: string): void => {
  createSqliteSheetRepository<Record<string, unknown>>(database).saveSetupSheet(kind, slug, {
    slug, revision: 0, updatedAt: 100, name,
    ...(kind === 'trainer' ? { currentTeam: [], boxedPokemon: [] } : {}),
  })
}
const transferConsent = (input: {
  readonly role: 'source-gift' | 'recipient-acceptance'
  readonly consentDigit: string
  readonly counterpartConsentId: PokemonEggTransferConsentV1['counterpartConsentId']
}): PokemonEggTransferConsentV1 => {
  const definition = {
    schemaVersion: 1 as const,
    consentId: `egg-transfer-consent:v1:${input.consentDigit.repeat(32)}` as PokemonEggTransferConsentV1['consentId'],
    revision: 0 as const,
    status: 'active' as const,
    role: input.role,
    eggId: EGG_ID as PokemonEggTransferConsentV1['eggId'],
    eggRevision: 0,
    sourceTrainerSlug: 'trainer-owner',
    destinationTrainerSlug: 'trainer-recipient',
    consentingProfileId: (input.role === 'source-gift' ? 'profile_source00' : 'profile_recipient00') as PokemonEggTransferConsentV1['consentingProfileId'],
    consentingTrainerSlug: input.role === 'source-gift' ? 'trainer-owner' : 'trainer-recipient',
    consentingTrainerRevision: 0,
    consentingTrainerDefinitionSha256: '5'.repeat(64),
    trainerControlDefinitionSha256: '6'.repeat(64),
    counterpartConsentId: input.counterpartConsentId,
    grantedAtCampaignMinute: input.role === 'source-gift' ? 120 : 130,
    expiresAtCampaignMinute: 200,
    settlementOperationId: null,
    settledAtCampaignMinute: null,
  }
  const candidate = { ...definition, definitionSha256: '0'.repeat(64) }
  return parseAuthoritativePokemonEggTransferConsentV1({
    ...definition,
    definitionSha256: pokemonEggTransferConsentDefinitionSha256(candidate),
  })
}
const dependencies = (database: RotomDatabase, options: {
  readonly pending?: readonly unknown[]
  readonly projects?: readonly BreedingProjectDocumentV1[]
  readonly eggs?: readonly PokemonEggDocumentV1[]
  readonly transfers?: readonly PokemonEggTransferConsentV1[]
} = {}) => ({
  database,
  projectRepository: { database, listByOwner: () => options.projects ?? [project()] },
  eggRepository: { database, listByOwner: () => options.eggs ?? [egg()] },
  consentRepository: { database, listByProject: () => [] },
  transferRepository: { database, listByEgg: () => options.transfers ?? [] },
  operationRepository: { database, listPending: () => options.pending ?? [] },
  clockRepository: { database, get: () => ({ campaignMinute: 150 }) },
})

describe('BR-074 Breeding Workshop activity server projection', () => {
  it('projects owner progress, human traits, bounded history, and transfer action with cross-owner redaction', () => {
    const database = open()
    save(database, 'trainer', 'trainer-owner', 'Mira')
    save(database, 'pokemon', 'pokemon-owned', 'Ember')
    save(database, 'pokemon', 'pokemon-private', 'Private Flare')
    const result = loadBreedingWorkshopActivity({
      role: 'player',
      playerProfile: profile(),
      request: { profileId: profile().id, trainerSheetSlug: 'trainer-owner' },
    }, dependencies(database))

    expect(parseAuthoritativeBreedingWorkshopActivityProjectionV1(result)).toEqual(result)
    expect(result).toMatchObject({
      audience: 'owner',
      trainer: { displayName: 'Mira' },
      projects: [{
        progress: { accumulatedCampaignMinutes: 0, targetCampaignMinutes: 480, percent: 0 },
        parents: [
          { displayName: 'Ember', pokemonSheetSlug: 'pokemon-owned', consentStatus: 'not-required' },
          { displayName: 'Participating parent', pokemonSheetSlug: null, consentStatus: 'waiting' },
        ],
      }],
      eggs: [{
        speciesName: 'Omanyte', natureName: 'Cuddly', abilityName: 'Swift Swim',
        progress: { accumulatedCampaignMinutes: 120, targetCampaignMinutes: 14_400 },
        transfer: { state: 'available', action: 'start' },
      }],
    })
    expect(JSON.stringify(result)).not.toContain('pokemon-private')
    expect(BREEDING_WORKSHOP_ACTIVITY_PRESENTATION_POLICY_DEFINITION_SHA256)
      .toBe(activityContractJson.definition.implementation.presentationPolicyDefinitionSha256)
  })

  it('allows current GM cards to identify participating parents without exposing mechanics evidence', () => {
    const database = open()
    save(database, 'trainer', 'trainer-owner', 'Mira')
    save(database, 'pokemon', 'pokemon-owned', 'Ember')
    save(database, 'pokemon', 'pokemon-private', 'Flare')
    const result = loadBreedingWorkshopActivity({
      role: 'gm', playerProfile: null,
      request: { profileId: null, trainerSheetSlug: 'trainer-owner' },
    }, dependencies(database))
    expect(result.audience).toBe('gm')
    expect(result.projects[0]?.parents[1]).toMatchObject({
      displayName: 'Flare', pokemonSheetSlug: 'pokemon-private', relationship: 'participating',
    })
    expect(JSON.stringify(result)).not.toMatch(/definitionSha256|profile_owner|rollRecord|operationId/)
  })

  it('projects an active dual-consent transfer without Profile, consent, or evidence identity', () => {
    const database = open()
    save(database, 'trainer', 'trainer-owner', 'Mira')
    const source = transferConsent({
      role: 'source-gift', consentDigit: '3', counterpartConsentId: null,
    })
    const recipient = transferConsent({
      role: 'recipient-acceptance', consentDigit: '4', counterpartConsentId: source.consentId,
    })
    const result = loadBreedingWorkshopActivity({
      role: 'gm', playerProfile: null,
      request: { profileId: null, trainerSheetSlug: 'trainer-owner' },
    }, dependencies(database, { projects: [], transfers: [source, recipient] }))
    expect(result.eggs[0]?.transfer).toEqual({
      state: 'accepted', action: 'review',
      reasonId: 'breeding.workshop-transfer.active-offer',
      counterpartyTrainerSlug: 'trainer-recipient', expiresAtCampaignMinute: 200,
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(source.consentId)
    expect(serialized).not.toContain(recipient.consentId)
    expect(serialized).not.toContain('consentingProfileId')
  })

  it('turns a current pending aggregate command into visible system recovery and blocks transfer presentation', () => {
    const database = open()
    save(database, 'trainer', 'trainer-owner', 'Mira')
    const pending = [{
      scopes: [{ kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: 0 }],
      createdAtCampaignMinute: 140,
    }]
    const result = loadBreedingWorkshopActivity({
      role: 'gm', playerProfile: null,
      request: { profileId: null, trainerSheetSlug: 'trainer-owner' },
    }, dependencies(database, { projects: [], pending }))
    expect(result.eggs[0]).toMatchObject({
      recovery: { state: 'pending', pendingSinceCampaignMinute: 140, canRefresh: true },
      transfer: {
        state: 'unavailable', action: 'none',
        reasonId: 'breeding.workshop-transfer.pending-recovery',
      },
    })
  })

  it('rejects foreign Profile selectors, malformed authority, repository mismatch, and unbounded pending state', () => {
    const database = open()
    save(database, 'trainer', 'trainer-owner', 'Mira')
    expect(() => loadBreedingWorkshopActivity({
      role: 'player', playerProfile: profile(),
      request: { profileId: profile().id, trainerSheetSlug: 'trainer-foreign' },
    }, dependencies(database))).toThrowError(expect.objectContaining({ statusCode: 403 }))
    expect(() => loadBreedingWorkshopActivity({
      role: 'player', playerProfile: { ...profile(), extra: true },
      request: { profileId: profile().id, trainerSheetSlug: 'trainer-owner' },
    }, dependencies(database))).toThrow(LoadBreedingWorkshopActivityError)
    const other = open()
    expect(() => loadBreedingWorkshopActivity({
      role: 'gm', playerProfile: null,
      request: { profileId: null, trainerSheetSlug: 'trainer-owner' },
    }, {
      ...dependencies(database),
      projectRepository: { database: other, listByOwner: () => [] },
    })).toThrowError(expect.objectContaining({ statusCode: 409 }))
    expect(() => loadBreedingWorkshopActivity({
      role: 'gm', playerProfile: null,
      request: { profileId: null, trainerSheetSlug: 'trainer-owner' },
    }, dependencies(database, { pending: Array.from({ length: 100 }, () => ({})) })))
      .toThrowError(expect.objectContaining({ statusCode: 409 }))
  })
})
