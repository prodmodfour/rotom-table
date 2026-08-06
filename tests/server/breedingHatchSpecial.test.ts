import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import authorityFixture from '../fixtures/breeding/egg-production-authority-v1.json'
import eggContractJson from '../../data/breeding-automation/egg-contract.json'
import hatchDurationPolicyJson from '../../data/breeding-automation/hatch-duration-policy.json'
import hatchSpecialContractJson from '../../data/breeding-automation/hatch-special-contract.json'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import type { PlayerProfile } from '../../shared/playerProfiles'
import { parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import { BREEDING_HATCH_SPECIAL_OUTCOME_IDS } from '../../shared/breeding/hatchSpecial'
import {
  createBreedingActorAuthorityV1,
  createBreedingTrainerControlEvidenceV1,
} from '../../server/domain/breeding/authorization'
import {
  DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT,
  parseBreedingCampaignOptionSnapshotV1,
} from '../../server/domain/breeding/campaignOptions'
import { validatePokemonEggRevisionSuccessor } from '../../server/domain/breeding/eggLifecycle'
import { pokemonEggLifecycleDocumentDefinitionSha256 } from '../../server/domain/breeding/eggLifecyclePolicy'
import {
  authorizeBreedingBeginHatchV1,
  authorizeBreedingResolveHatchSpecialV1,
} from '../../server/domain/breeding/hatchSpecialAuthorization'
import {
  BREEDING_HATCH_SPECIAL_EVIDENCE_DEFINITION_SHA256,
  BREEDING_HATCH_SPECIAL_OUTCOME_POLICY,
  BREEDING_HATCH_SPECIAL_POLICY_DEFINITION_SHA256,
  BREEDING_HATCH_SPECIAL_PROVIDER_ID,
  deriveBreedingHatchSpecialAdjudicationIdV1,
  deriveBreedingHatchSpecialOfferIdV1,
  projectPokemonEggHatchSpecialV1,
} from '../../server/domain/breeding/hatchSpecial'
import {
  createPokemonEggHatchOwnerTrainerFactV1,
} from '../../server/domain/breeding/hatchOffers'
import { createPokemonEggOffspringBlueprintV1, parseAuthoritativePokemonEggDocumentV1 } from '../../server/domain/breeding/lineage'
import { createBreedingOperationAcceptedV1, createBreedingOperationCommandHash } from '../../server/domain/breeding/operations'
import {
  createBreedingOperationReadSetV1,
  createBreedingReferenceVersionSnapshotV1,
} from '../../server/domain/breeding/readSets'
import { compiledBreedingSpeciesSpec } from '../../server/domain/breeding/registry'
import { createSqliteBreedingGmAdjudicationRepository } from '../../server/storage/breedingGmAdjudicationRepository'
import { createSqliteBreedingOperationRepository } from '../../server/storage/breedingOperationRepository'
import { createSqliteBreedingOptionOfferRepository } from '../../server/storage/breedingOptionOfferRepository'
import { createSqliteBreedingRollRepository } from '../../server/storage/breedingRollRepository'
import { createSqliteCampaignClockRepository } from '../../server/storage/campaignClockRepository'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqlitePokemonEggRepository } from '../../server/storage/pokemonEggRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import {
  beginPokemonEggHatchSpecial,
  ManagePokemonEggHatchSpecialError,
  resolvePokemonEggHatchSpecial,
} from '../../server/useCases/managePokemonEggHatchSpecial'
import { projectCurrentPokemonEggHatchOffer } from '../../server/useCases/projectPokemonEggHatchOffer'

const fixture = authorityFixture as any
const optionSnapshot = parseBreedingCampaignOptionSnapshotV1(fixture.campaignOptionSnapshot)
const references = createBreedingReferenceVersionSnapshotV1({
  ...fixture.readSet.referenceVersions,
  campaignOptionSnapshotDefinitionSha256: optionSnapshot.definitionSha256,
})
const ruleset = Object.freeze({ rulesetId: references.rulesetId, definitionSha256: references.rulesetDefinitionSha256 })
const EGG_ID = 'pokemon-egg:v1:55555555555555555555555555555555'
const operationId = (value: number): `breeding-operation:v1:${string}` => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const readSetId = (value: number): `breeding-read-set:v1:${string}` => `breeding-read-set:v1:${value.toString(16).padStart(32, '0')}`
const sha256 = (value: unknown): string => createHash('sha256').update(
  typeof value === 'string' ? value : stableJsonStringify(value),
).digest('hex')
const profile: PlayerProfile = {
  schemaVersion: 1,
  id: 'profile_owner_0001' as any,
  displayName: 'Owner' as any,
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-owner' }],
}
const trainerDocument = () => ({
  slug: 'trainer-owner',
  name: 'Owner',
  currentTeam: ['pokemon-team-0', 'pokemon-team-1'],
  boxedPokemon: ['pokemon-boxed-0'],
})
const sourceCommand = () => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(1),
  commandKind: 'create-source-egg',
  actor: { profileId: 'gm-principal', selectedTrainerSlug: null },
  ruleset,
  scopes: [{ kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: null }],
  payload: {
    eggId: EGG_ID,
    ownerTrainerSlug: 'trainer-owner',
    source: { kind: 'gm', reasonId: 'breeding.egg-source.reviewed', evidenceDefinitionSha256: 'e'.repeat(64) },
    speciesOptionId: 'option:v1:55555555555555555555555555555555',
    resolutions: { selectedOptionIds: [], requestedRollKinds: [] },
  },
})
const markCommand = () => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(2),
  commandKind: 'mark-egg-ready',
  actor: { profileId: 'gm-principal', selectedTrainerSlug: null },
  ruleset,
  scopes: [{ kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: 0 }],
  payload: { eggId: EGG_ID, reasonId: 'breeding.egg-ready.gm-adjudication' },
})
const initialEgg = () => {
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
      optionSnapshot.definitionSha256,
      ruleset.definitionSha256,
    ].sort(),
    parents: [],
    breeder: null,
    offspring: blueprint,
    incubation: {
      averageCampaignMinutes: 600,
      targetCampaignMinutes: 600,
      accumulatedCampaignMinutes: 0,
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
    lastOperationId: operationId(1),
  })
}
const readyEgg = () => {
  const current = initialEgg()
  return validatePokemonEggRevisionSuccessor(current, {
    ...current,
    revision: 1,
    status: 'ready',
    incubation: { ...current.incubation, readyAtCampaignMinute: 700, readinessKind: 'gm-mark-ready', readyOperationId: operationId(2) },
    updatedAtCampaignMinute: 700,
    statusChangedAtCampaignMinute: 700,
    lastOperationId: operationId(2),
  })
}
const seed = () => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  const source = sourceCommand(); const mark = markCommand(); const initial = initialEgg(); const ready = readyEgg()
  database.withTransaction(() => {
    const operations = createSqliteBreedingOperationRepository(database)
    const eggs = createSqlitePokemonEggRepository(database)
    operations.reserve(source, 100)
    eggs.insert(initial)
    operations.settle(source, createBreedingOperationAcceptedV1({
      operationId: source.operationId, commandHash: createBreedingOperationCommandHash(source), commandKind: source.commandKind,
      outcomeKind: 'source-egg-created', aggregateRefs: [{ kind: 'pokemon-egg', id: EGG_ID, revision: 0 }], changedScopes: source.scopes, committedAtCampaignMinute: 100,
    }), 100)
    operations.reserve(mark, 700)
    eggs.replace({ expectedRevision: 0, document: ready })
    operations.settle(mark, createBreedingOperationAcceptedV1({
      operationId: mark.operationId, commandHash: createBreedingOperationCommandHash(mark), commandKind: mark.commandKind,
      outcomeKind: 'egg-ready', aggregateRefs: [{ kind: 'pokemon-egg', id: EGG_ID, revision: 1 }], changedScopes: mark.scopes, committedAtCampaignMinute: 700,
    }), 700)
    database.connection.prepare(`INSERT INTO sheets (kind, slug, document_json, revision, updated_at) VALUES ('trainer', 'trainer-owner', ?, 3, 700)`).run(stableJsonStringify(trainerDocument()))
    database.connection.prepare(`UPDATE campaign_clock SET revision=2, campaign_minute=700, last_operation_id=? WHERE singleton=1`).run(mark.operationId)
  })
  return database
}
const beginCommand = (operation = 10, role: 'owner' | 'gm' = 'owner') => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(operation),
  commandKind: 'begin-hatch',
  actor: role === 'gm' ? { profileId: 'gm-principal', selectedTrainerSlug: null } : { profileId: profile.id, selectedTrainerSlug: 'trainer-owner' },
  ruleset,
  scopes: [{ kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: 1 }],
  payload: { eggId: EGG_ID, destination: { kind: 'box', trainerSheetSlug: 'trainer-owner' }, requestSpecialRoll: true },
})
const actorFor = (command: ReturnType<typeof beginCommand>, role: 'owner' | 'gm', minute = 700) => createBreedingActorAuthorityV1({
  role: role === 'gm' ? 'gm' : 'player', command,
  authenticatedPrincipalSha256: 'a'.repeat(64), authenticationPolicyDefinitionSha256: 'b'.repeat(64),
  profile: role === 'gm' ? null : profile, evaluatedAtCampaignMinute: minute,
})
const dependencySet = (eggRevision: number, checkpoint: 'begin-hatch' | 'hatch-transaction') => {
  const policy = {
    providerKind: 'system' as const,
    providerId: BREEDING_HATCH_SPECIAL_PROVIDER_ID,
    subjectKind: 'pokemon-egg' as const,
    subjectId: EGG_ID,
    subjectRevision: eggRevision,
    checkpoint,
    providerDefinitionSha256: BREEDING_HATCH_SPECIAL_POLICY_DEFINITION_SHA256,
    effectiveEvidenceSha256: BREEDING_HATCH_SPECIAL_EVIDENCE_DEFINITION_SHA256,
  }
  const attestation = {
    providerKind: 'system' as const,
    providerId: 'breeding-effective-dependency-set-v1',
    subjectKind: 'campaign' as const,
    subjectId: 'campaign',
    subjectRevision: null,
    checkpoint: 'authorization' as const,
    providerDefinitionSha256: sha256('breeding-effective-dependency-set-v1'),
    effectiveEvidenceSha256: sha256([policy]),
  }
  return [attestation, policy]
}
const beginAuthority = (database: RotomDatabase, command: ReturnType<typeof beginCommand>, role: 'owner' | 'gm' = 'owner') => {
  const actor = actorFor(command, role)
  const trainer = createSqliteSheetRepository(database).get('trainer', 'trainer-owner')!
  const fact = createPokemonEggHatchOwnerTrainerFactV1({ trainerSheetSlug: trainer.slug, trainerSheetRevision: trainer.revision, trainerSheetDocument: trainer.document })
  const control = role === 'gm' ? null : createBreedingTrainerControlEvidenceV1({
    profile, trainerSheetSlug: trainer.slug, trainerSheetRevision: trainer.revision,
    trainerSheetDefinitionSha256: fact.trainerSheetDefinitionSha256, evaluatedAtCampaignMinute: 700,
  })
  const authority = projectCurrentPokemonEggHatchOffer({ command, actorAuthority: actor, ownerTrainerControl: control, referenceVersions: references }, {
    database, resolveCurrentReferenceVersions: () => references, ...(role === 'gm' ? { validateCurrentGmAuthority: () => true } : {}),
  })
  const egg = createSqlitePokemonEggRepository(database).get(EGG_ID)!
  const clock = createSqliteCampaignClockRepository(database).get()
  const readSet = createBreedingOperationReadSetV1({
    readSetId: readSetId(Number(command.operationId.slice(-4)) || 10),
    operationId: command.operationId,
    commandSha256: createBreedingOperationCommandHash(command),
    commandKind: command.commandKind,
    capturedAtCampaignMinute: clock.campaignMinute,
    resources: [
      { resourceKind: 'campaign-clock', resourceId: 'campaign-clock', existence: 'present', revision: clock.revision, definitionSha256: sha256(clock), observedCampaignMinute: clock.campaignMinute, purposes: ['campaign-time'] },
      { resourceKind: 'pokemon-egg', resourceId: egg.eggId, existence: 'present', revision: egg.revision, definitionSha256: pokemonEggLifecycleDocumentDefinitionSha256(egg), observedCampaignMinute: null, purposes: ['conflict', 'mechanics'] },
      { resourceKind: 'trainer-sheet', resourceId: trainer.slug, existence: 'present', revision: trainer.revision, definitionSha256: fact.trainerSheetDefinitionSha256, observedCampaignMinute: null, purposes: role === 'gm' ? ['write-destination'] : ['authorization', 'write-destination'] },
    ],
    referenceVersions: references,
    dependencyEvidence: dependencySet(egg.revision, 'begin-hatch'),
    writeExpectations: command.scopes,
  })
  const receipt = authorizeBreedingBeginHatchV1({
    command, readSet, actorAuthority: actor, ownerTrainerControl: control, egg, ownerTrainerFact: fact,
    hatchOfferAuthority: authority, campaignOptionSnapshot: optionSnapshot, currentClock: clock,
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  const declaration = { schemaVersion: 1, offerId: authority.offer.offerId, offerDefinitionSha256: authority.offer.offerDefinitionSha256, operationId: command.operationId }
  return { command, actor, control, authority, readSet, receipt, declaration }
}
const beginInput = (value: ReturnType<typeof beginAuthority>, audience: 'owner' | 'gm' = 'owner') => ({
  command: value.command, readSet: value.readSet, authorizationReceipt: value.receipt,
  actorAuthority: value.actor, ownerTrainerControl: value.control, referenceVersions: references,
  campaignOptionSnapshot: optionSnapshot, declaration: value.declaration, hatchOfferAuthority: value.authority, audience,
})
const useCaseOptions = (database: RotomDatabase, draw: () => number, extra: Record<string, unknown> = {}) => ({
  database, campaignProjectionKey: 'test-projection-key-that-is-at-least-32-bytes', realtimeTimestamp: 700_000,
  resolveCurrentReferenceVersions: () => references, drawHatchSpecialD100: draw, ...extra,
})
const resolutionAuthority = (database: RotomDatabase, operation = 30) => {
  const egg = createSqlitePokemonEggRepository(database).get(EGG_ID)!
  const adjudication = createSqliteBreedingGmAdjudicationRepository(database).get(deriveBreedingHatchSpecialAdjudicationIdV1(egg.hatchOperationId!, egg.eggId))!
  const offer = createSqliteBreedingOptionOfferRepository(database).get(deriveBreedingHatchSpecialOfferIdV1(egg.hatchOperationId!, egg.eggId))!
  const command = parseBreedingOperationCommandV1({
    schemaVersion: 1, operationId: operationId(operation), commandKind: 'resolve-hatch-special',
    actor: { profileId: 'gm-principal', selectedTrainerSlug: null }, ruleset,
    scopes: [{ kind: 'pokemon-egg', eggId: egg.eggId, expectedRevision: egg.revision }],
    payload: { eggId: egg.eggId, adjudicationOptionId: offer.options[0]!.optionId },
  })
  const actor = createBreedingActorAuthorityV1({ role: 'gm', command, authenticatedPrincipalSha256: 'a'.repeat(64), authenticationPolicyDefinitionSha256: 'b'.repeat(64), profile: null, evaluatedAtCampaignMinute: 700 })
  const clock = createSqliteCampaignClockRepository(database).get()
  const readSet = createBreedingOperationReadSetV1({
    readSetId: readSetId(operation), operationId: command.operationId, commandSha256: createBreedingOperationCommandHash(command), commandKind: command.commandKind,
    capturedAtCampaignMinute: 700,
    resources: [
      { resourceKind: 'breeding-adjudication', resourceId: adjudication.adjudicationId, existence: 'present', revision: adjudication.revision, definitionSha256: adjudication.definitionSha256, observedCampaignMinute: null, purposes: ['authorization', 'mechanics'] },
      { resourceKind: 'breeding-offer', resourceId: offer.offerId, existence: 'present', revision: offer.revision, definitionSha256: offer.definitionSha256, observedCampaignMinute: null, purposes: ['authorization', 'mechanics'] },
      { resourceKind: 'campaign-clock', resourceId: 'campaign-clock', existence: 'present', revision: clock.revision, definitionSha256: sha256(clock), observedCampaignMinute: 700, purposes: ['campaign-time'] },
      { resourceKind: 'pokemon-egg', resourceId: egg.eggId, existence: 'present', revision: egg.revision, definitionSha256: pokemonEggLifecycleDocumentDefinitionSha256(egg), observedCampaignMinute: null, purposes: ['conflict', 'mechanics'] },
    ],
    referenceVersions: references, dependencyEvidence: dependencySet(egg.revision, 'hatch-transaction'), writeExpectations: command.scopes,
  })
  const receipt = authorizeBreedingResolveHatchSpecialV1({ command, readSet, actorAuthority: actor, egg, adjudication, offer, currentClock: clock, securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256 })
  return { command, actor, readSet, receipt, adjudication, offer }
}

const realtimeCount = (database: RotomDatabase): number => Number((database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get() as any).count)

describe('BR-055 persisted hatch-special roll and bounded GM adjudication', () => {
  it('persists exactly one d100 and advances a normal result without adjudication', () => {
    const database = seed()
    try {
      let draws = 0
      const authority = beginAuthority(database, beginCommand())
      const result = beginPokemonEggHatchSpecial(beginInput(authority), useCaseOptions(database, () => { draws += 1; return 50 }))
      expect(result.execution.record.status).toBe('accepted')
      expect(result.egg).toMatchObject({ revision: 2, status: 'hatching', special: { state: 'normal', rollTotal: 50, triggerIds: [], automaticShiny: false } })
      expect(result.roll).toMatchObject({ purpose: 'hatch-special-d100', formula: '1d100', values: [50], operationRollOrdinal: 0 })
      expect(result.adjudication).toBeNull()
      expect(result.offer).toBeNull()
      expect(result.projection).toMatchObject({ audience: 'owner', specialState: 'normal', requiresGmAdjudication: false, outcomeId: null })
      expect(result.projection).not.toHaveProperty('rollTotal')
      expect(result.projection).not.toHaveProperty('options')
      expect(result.projection).not.toHaveProperty('adjudicationId')
      expect(draws).toBe(1)
      expect(createSqliteBreedingRollRepository(database).listByOperation(authority.command.operationId)).toHaveLength(1)
      expect(realtimeCount(database)).toBe(4)

      const retry = beginPokemonEggHatchSpecial(beginInput(authority), useCaseOptions(database, () => { draws += 1; return 1 }))
      expect(retry.execution.kind).toBe('exact-retry')
      expect(retry.egg?.revision).toBe(2)
      expect(draws).toBe(1)
      expect(realtimeCount(database)).toBe(4)
    }
    finally { database.close() }
  })

  it.each([1, 100])('opens one bounded GM workflow for special roll %i and never implies Shiny', total => {
    const database = seed()
    try {
      const authority = beginAuthority(database, beginCommand(10 + total))
      const result = beginPokemonEggHatchSpecial(beginInput(authority), useCaseOptions(database, () => total))
      expect(result.egg).toMatchObject({
        status: 'awaiting-special-adjudication',
        special: { state: 'pending-adjudication', rollTotal: total, triggerIds: [total === 1 ? 'roll-1' : 'roll-100'], adjudicationId: null, outcomeId: null, automaticShiny: false },
      })
      expect(result.adjudication).toMatchObject({ revision: 0, status: 'pending', adjudicationKind: 'hatch-special-result', decisionMode: 'bounded-option' })
      expect(result.offer).toMatchObject({ revision: 0, status: 'active', choiceKind: 'special-result', expiresAtCampaignMinute: null })
      expect(result.offer?.options.map(option => option.canonicalValueId).sort()).toEqual([...BREEDING_HATCH_SPECIAL_OUTCOME_IDS])
      const gm = projectPokemonEggHatchSpecialV1({ egg: result.egg, audience: 'gm', adjudication: result.adjudication, offer: result.offer, generatedAtCampaignMinute: 700 }) as any
      expect(gm).toMatchObject({ audience: 'gm', rollTotal: total, requiresGmAdjudication: true, adjudicationStatus: 'pending', offerStatus: 'active' })
      expect(gm.options).toHaveLength(3)
      const owner = result.projection as any
      expect(owner.audience).toBe('owner')
      expect(owner).not.toHaveProperty('rollTotal')
      expect(owner).not.toHaveProperty('options')
      expect(result.egg?.special.automaticShiny).toBe(false)
      expect(gm.options.some((option: any) => /shiny/iu.test(option.outcomeId))).toBe(false)
    }
    finally { database.close() }
  })

  it('consumes one active bounded option through current GM authority and settles all records atomically', () => {
    const database = seed()
    try {
      const begin = beginAuthority(database, beginCommand())
      beginPokemonEggHatchSpecial(beginInput(begin), useCaseOptions(database, () => 1))
      const resolution = resolutionAuthority(database)
      const input = { command: resolution.command, readSet: resolution.readSet, authorizationReceipt: resolution.receipt, actorAuthority: resolution.actor, referenceVersions: references, audience: 'gm' }
      const result = resolvePokemonEggHatchSpecial(input, useCaseOptions(database, () => 77, { validateCurrentGmAuthority: () => true }))
      expect(result.execution.record.status).toBe('accepted')
      expect(result.egg).toMatchObject({ revision: 3, status: 'hatching', special: { state: 'resolved', adjudicationId: resolution.adjudication.adjudicationId, outcomeId: resolution.offer.options[0]!.canonicalValueId, automaticShiny: false } })
      expect(result.offer).toMatchObject({ revision: 1, status: 'consumed', selectedOptionId: resolution.offer.options[0]!.optionId, settlementOperationId: resolution.command.operationId })
      expect(result.adjudication).toMatchObject({ revision: 1, status: 'resolved', decision: { kind: 'option', optionId: resolution.offer.options[0]!.optionId }, resolvedByProfileId: 'campaign-gm' })
      expect(result.projection).toMatchObject({ audience: 'gm', specialState: 'resolved', requiresGmAdjudication: false, offerStatus: 'consumed', adjudicationStatus: 'resolved' })
      expect(realtimeCount(database)).toBe(8)

      const retry = resolvePokemonEggHatchSpecial(input, useCaseOptions(database, () => 2, { validateCurrentGmAuthority: () => true }))
      expect(retry.execution.kind).toBe('exact-retry')
      expect(retry.egg?.revision).toBe(3)
      expect(realtimeCount(database)).toBe(8)
    }
    finally { database.close() }
  })

  it('retains the single roll while phase-2 rollback removes Egg, offer, adjudication, result, and realtime writes', () => {
    const database = seed()
    try {
      const authority = beginAuthority(database, beginCommand())
      let draws = 0
      expect(() => beginPokemonEggHatchSpecial(beginInput(authority), useCaseOptions(database, () => { draws += 1; return 1 }, {
        beforeSettle: () => { throw new Error('injected phase-2 failure') },
      }))).toThrow('injected phase-2 failure')
      expect(draws).toBe(1)
      expect(createSqlitePokemonEggRepository(database).get(EGG_ID)).toMatchObject({ revision: 1, status: 'ready', special: { state: 'not-rolled' } })
      expect(createSqliteBreedingRollRepository(database).findHatchSpecialByEgg(EGG_ID)).toMatchObject({ values: [1] })
      expect(createSqliteBreedingGmAdjudicationRepository(database).listHatchSpecialByEgg(EGG_ID)).toHaveLength(0)
      expect(realtimeCount(database)).toBe(0)
      expect(createSqliteBreedingOperationRepository(database).get(authority.command.operationId)?.status).toBe('pending')

      const recovered = beginPokemonEggHatchSpecial(beginInput(authority), useCaseOptions(database, () => { draws += 1; return 50 }, { resumePending: true }))
      expect(recovered.egg).toMatchObject({ revision: 2, status: 'awaiting-special-adjudication', special: { rollTotal: 1 } })
      expect(draws).toBe(1)
      expect(realtimeCount(database)).toBe(4)
    }
    finally { database.close() }
  })

  it('fails closed before persistence for malformed random, stale authority, provider enrichment, and non-GM resolution', () => {
    const database = seed()
    try {
      const authority = beginAuthority(database, beginCommand())
      expect(() => beginPokemonEggHatchSpecial(beginInput(authority), useCaseOptions(database, () => 0))).toThrow(ManagePokemonEggHatchSpecialError)
      expect(createSqliteBreedingRollRepository(database).findHatchSpecialByEgg(EGG_ID)).toBeNull()
      expect(() => beginPokemonEggHatchSpecial({ ...beginInput(authority), forcedByProvider: { providerId: 'fake' } }, useCaseOptions(database, () => 1))).toThrow(ManagePokemonEggHatchSpecialError)
      expect(createSqliteBreedingRollRepository(database).findHatchSpecialByEgg(EGG_ID)).toBeNull()

      database.connection.prepare('UPDATE campaign_clock SET revision=3, campaign_minute=701 WHERE singleton=1').run()
      expect(() => beginPokemonEggHatchSpecial(beginInput(authority), useCaseOptions(database, () => 1))).toThrow()
      expect(createSqliteBreedingRollRepository(database).findHatchSpecialByEgg(EGG_ID)).toBeNull()
    }
    finally { database.close() }
  })

  it('keeps the configured table fail-closed and the default policy bounded', () => {
    expect(optionSnapshot.values['breeding.hatch-special-policy']).toBe('bounded-gm-adjudication')
    expect(DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT.values['breeding.hatch-special-policy']).toBe('bounded-gm-adjudication')
    expect(BREEDING_HATCH_SPECIAL_OUTCOME_IDS).toHaveLength(3)
    expect(BREEDING_HATCH_SPECIAL_OUTCOME_IDS.some(value => /shiny/iu.test(value))).toBe(false)
    expect(BREEDING_HATCH_SPECIAL_OUTCOME_POLICY.automaticShiny).toBe(false)
    expect(hatchSpecialContractJson.definition.bindings.runtimePolicyDefinitionSha256).toBe(BREEDING_HATCH_SPECIAL_POLICY_DEFINITION_SHA256)
    expect(hatchSpecialContractJson.definition.bindings.runtimeEvidenceDefinitionSha256).toBe(BREEDING_HATCH_SPECIAL_EVIDENCE_DEFINITION_SHA256)
  })
})
