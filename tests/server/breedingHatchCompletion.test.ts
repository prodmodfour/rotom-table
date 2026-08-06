import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import authorityFixture from '../fixtures/breeding/egg-production-authority-v1.json'
import eggContractJson from '../../data/breeding-automation/egg-contract.json'
import hatchDurationPolicyJson from '../../data/breeding-automation/hatch-duration-policy.json'
import hatchCompletionContractJson from '../../data/breeding-automation/hatch-completion-contract.json'
import hatchSpeciesAcquisitionContractJson from '../../data/breeding-automation/hatch-species-acquisition-contract.json'
import initializedSheetContractJson from '../../data/breeding-automation/initialized-pokemon-sheet-contract.json'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import type { PlayerProfile } from '../../shared/playerProfiles'
import { parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import { breedingDependencyEvidenceKey } from '../../shared/breeding/readSets'
import {
  createBreedingActorAuthorityV1,
  createBreedingTrainerControlEvidenceV1,
} from '../../server/domain/breeding/authorization'
import { planPokemonEggChildSheetConstructionV1 } from '../../server/domain/breeding/childSheetConstruction'
import {
  BREEDING_BABY_TEMPLATE_POLICY_DEFINITION_SHA256,
  createBreedingMarsupialProviderTraitV1,
  resolveBreedingMarsupialBabyTemplateV1,
} from '../../server/domain/breeding/babyTemplate'
import {
  authorizeBreedingCompleteHatchV1,
  BREEDING_HATCH_COMPLETION_EVIDENCE_DEFINITION_SHA256,
  BREEDING_HATCH_COMPLETION_POLICY_DEFINITION_SHA256,
  BREEDING_HATCH_COMPLETION_PROVIDER_ID,
} from '../../server/domain/breeding/hatchCompletion'
import { pokemonEggLifecycleDocumentDefinitionSha256 } from '../../server/domain/breeding/eggLifecyclePolicy'
import { createPokemonEggHatchOwnerTrainerFactV1 } from '../../server/domain/breeding/hatchOffers'
import {
  BREEDING_HATCH_SPECIES_ACQUISITION_POLICY_DEFINITION_SHA256,
  PokemonHatchSpeciesAcquisitionError,
} from '../../server/domain/breeding/hatchSpeciesAcquisition'
import { createPokemonEggOffspringBlueprintV1, parseAuthoritativePokemonEggDocumentV1 } from '../../server/domain/breeding/lineage'
import { createBreedingMarsupialHandoffV1, createBreedingParentalBondHandoffV1 } from '../../server/domain/breeding/modifierProviderHandoff'
import { resolveMarsupialRelationship } from '../../server/domain/capabilityAutomation/marsupialRelationship'
import { createBreedingOperationAcceptedV1, createBreedingOperationCommandHash } from '../../server/domain/breeding/operations'
import {
  createBreedingOperationReadSetV1,
  createBreedingReferenceVersionSnapshotV1,
} from '../../server/domain/breeding/readSets'
import { compiledBreedingSpeciesSpec } from '../../server/domain/breeding/registry'
import { createSqliteBreedingLineageRepository } from '../../server/storage/breedingLineageRepository'
import { createSqliteBreedingOperationRepository } from '../../server/storage/breedingOperationRepository'
import { createSqliteCampaignClockRepository } from '../../server/storage/campaignClockRepository'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteInitializedPokemonSheetRepository } from '../../server/storage/initializedPokemonSheetRepository'
import { createSqlitePokemonEggRepository } from '../../server/storage/pokemonEggRepository'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteTrainerSpeciesAcquisitionRepository } from '../../server/storage/trainerSpeciesAcquisitionRepository'
import {
  completePokemonEggHatch,
  CompletePokemonEggHatchError,
} from '../../server/useCases/completePokemonEggHatch'
import { createBreedingTransactionCoordinator } from '../../server/useCases/executeBreedingTransaction'
import { createTrainerSpeciesAcquisitionRewardService } from '../../server/useCases/recordTrainerSpeciesAcquisition'

const databases: RotomDatabase[] = []
const roots: string[] = []
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})
const fixture = authorityFixture as any
const references = createBreedingReferenceVersionSnapshotV1(fixture.readSet.referenceVersions)
const ruleset = Object.freeze({ rulesetId: rulesetJson.rulesetId, definitionSha256: rulesetJson.definitionSha256 })
const EGG_ID = 'pokemon-egg:v1:57575757575757575757575757575757'
const ORIGIN_ID = 'pokemon-breeding-origin:v1:57575757575757575757575757575757'
const operationId = (value: number): `breeding-operation:v1:${string}` => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const readSetId = (value: number): `breeding-read-set:v1:${string}` => `breeding-read-set:v1:${value.toString(16).padStart(32, '0')}`
const rollId = 'breeding-roll:v1:57575757575757575757575757575757'
const sha256 = (value: unknown): string => createHash('sha256').update(typeof value === 'string' ? value : stableJsonStringify(value)).digest('hex')
const profile: PlayerProfile = {
  schemaVersion: 1,
  id: 'profile_owner_0001' as any,
  displayName: 'Owner' as any,
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-owner' }],
}
const trainerDocument = (team: readonly string[] = [], boxed: readonly string[] = []) => ({
  slug: 'trainer-owner', name: 'Owner', level: 10, dexExp: 7,
  currentTeam: [...team], boxedPokemon: [...boxed],
})
const beginCommand = (destination: 'box' | 'team') => parseBreedingOperationCommandV1({
  schemaVersion: 1, operationId: operationId(10), commandKind: 'begin-hatch',
  actor: { profileId: profile.id, selectedTrainerSlug: 'trainer-owner' }, ruleset,
  scopes: [{ kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: 0 }],
  payload: { eggId: EGG_ID, destination: { kind: destination, trainerSheetSlug: 'trainer-owner' }, requestSpecialRoll: true },
})
const hatchingEgg = (destination: 'box' | 'team') => {
  const species = compiledBreedingSpeciesSpec('bulbasaur')!
  const blueprint = createPokemonEggOffspringBlueprintV1({
    schemaVersion: 1, speciesId: species.speciesId, familyRootSpeciesId: species.familyRootSpeciesId,
    speciesSpecDefinitionSha256: species.definitionSha256,
    nature: { valueId: 'cuddly', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    ability: { valueId: species.basicAbilityIds[0]!, resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    gender: { valueId: 'female', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    inheritanceCandidates: [], startingLevel: 1,
    babyTemplate: { applied: false, choiceOptionId: null, choiceEvidenceId: null, effects: null },
  })
  return parseAuthoritativePokemonEggDocumentV1({
    schemaVersion: 1, eggId: EGG_ID, revision: 0, status: 'hatching', ownerTrainerSlug: 'trainer-owner',
    source: { kind: 'gm', reasonId: 'breeding.egg-source.reviewed', evidenceDefinitionSha256: 'e'.repeat(64) },
    ruleset,
    definitionHashes: [blueprint.definitionSha256, eggContractJson.definitionSha256, hatchDurationPolicyJson.definitionSha256, ruleset.definitionSha256].sort(),
    parents: [], breeder: null, offspring: blueprint,
    incubation: {
      averageCampaignMinutes: 600, targetCampaignMinutes: 600, accumulatedCampaignMinutes: 600,
      variationPolicyId: 'fixed-average', durationResultDefinitionSha256: 'd'.repeat(64),
      lastAppliedClockRevision: 1, lastAppliedClockMinute: 700, readyAtCampaignMinute: 700,
      readinessKind: 'incubation-complete', readyOperationId: beginCommand(destination).operationId, paused: false,
      pauseReasonId: null, pauseOperationId: null,
    },
    special: { state: 'normal', rollRecordId: rollId, rollTotal: 42, triggerIds: [], adjudicationId: null, outcomeId: null, automaticShiny: false },
    hatchOperationId: beginCommand(destination).operationId, childSheetSlug: null, terminal: null,
    createdAtCampaignMinute: 100, updatedAtCampaignMinute: 700, statusChangedAtCampaignMinute: 700,
    lastOperationId: beginCommand(destination).operationId,
  })
}
const completeCommand = (egg: ReturnType<typeof hatchingEgg>, destination: 'box' | 'team', operation = 11, trainerRevision = 0) => parseBreedingOperationCommandV1({
  schemaVersion: 1, operationId: operationId(operation), commandKind: 'complete-hatch',
  actor: { profileId: profile.id, selectedTrainerSlug: 'trainer-owner' }, ruleset,
  scopes: [
    { kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: egg.revision },
    { kind: 'trainer-sheet', sheetSlug: 'trainer-owner', expectedRevision: trainerRevision, fields: ['experience', 'roster'] },
    { kind: 'pokemon-sheet-allocation', namespace: 'pokemon' },
    { kind: 'species-acquisition', trainerSheetSlug: 'trainer-owner', speciesId: egg.offspring.speciesId },
  ],
  payload: { eggId: EGG_ID, originId: ORIGIN_ID, destination: { kind: destination, trainerSheetSlug: 'trainer-owner' } },
})
const seed = (destination: 'box' | 'team' = 'box', team: readonly string[] = [], path = ':memory:') => {
  const database = openRotomDatabase({ path, enableWal: path !== ':memory:' }); databases.push(database)
  const clock = createSqliteCampaignClockRepository(database)
  const begin = beginCommand(destination)
  const egg = hatchingEgg(destination)
  database.withTransaction(() => {
    const operations = createSqliteBreedingOperationRepository(database)
    operations.reserve(begin, 700)
    clock.advance({ expectedRevision: 0, targetCampaignMinute: 700, operationId: begin.operationId })
    createSqlitePokemonEggRepository(database).insert(egg)
    operations.settle(begin, createBreedingOperationAcceptedV1({
      operationId: begin.operationId, commandHash: createBreedingOperationCommandHash(begin), commandKind: begin.commandKind,
      outcomeKind: 'hatch-started', aggregateRefs: [{ kind: 'pokemon-egg', id: EGG_ID, revision: 0 }],
      changedScopes: begin.scopes, committedAtCampaignMinute: 700,
    }), 700)
  })
  createSqliteSheetRepository(database).save({ kind: 'trainer', slug: 'trainer-owner', revision: 0, updatedAt: 1_000, document: trainerDocument(team) })
  return { database, egg, begin }
}
const dependencies = (eggRevision: number) => {
  const policy = {
    providerKind: 'system' as const, providerId: BREEDING_HATCH_COMPLETION_PROVIDER_ID,
    subjectKind: 'pokemon-egg' as const, subjectId: EGG_ID, subjectRevision: eggRevision,
    checkpoint: 'hatch-transaction' as const,
    providerDefinitionSha256: BREEDING_HATCH_COMPLETION_POLICY_DEFINITION_SHA256,
    effectiveEvidenceSha256: BREEDING_HATCH_COMPLETION_EVIDENCE_DEFINITION_SHA256,
  }
  return [{
    providerKind: 'system' as const, providerId: 'breeding-effective-dependency-set-v1',
    subjectKind: 'campaign' as const, subjectId: 'campaign', subjectRevision: null,
    checkpoint: 'authorization' as const, providerDefinitionSha256: sha256('breeding-effective-dependency-set-v1'),
    effectiveEvidenceSha256: sha256([policy]),
  }, policy]
}
const authority = (database: RotomDatabase, egg: ReturnType<typeof hatchingEgg>, begin: ReturnType<typeof beginCommand>, destination: 'box' | 'team', operation = 11) => {
  const trainer = createSqliteSheetRepository(database).get('trainer', 'trainer-owner')!
  const command = completeCommand(egg, destination, operation, trainer.revision)
  const actor = createBreedingActorAuthorityV1({
    role: 'player', command, authenticatedPrincipalSha256: 'a'.repeat(64),
    authenticationPolicyDefinitionSha256: 'b'.repeat(64), profile, evaluatedAtCampaignMinute: 700,
  })
  const fact = createPokemonEggHatchOwnerTrainerFactV1({ trainerSheetSlug: trainer.slug, trainerSheetRevision: trainer.revision, trainerSheetDocument: trainer.document })
  const control = createBreedingTrainerControlEvidenceV1({
    profile, trainerSheetSlug: trainer.slug, trainerSheetRevision: trainer.revision,
    trainerSheetDefinitionSha256: fact.trainerSheetDefinitionSha256, evaluatedAtCampaignMinute: 700,
  })
  const clock = createSqliteCampaignClockRepository(database).get()
  const acquisition = createSqliteTrainerSpeciesAcquisitionRepository(database).get(trainer.slug, egg.offspring.speciesId)
  const readSet = createBreedingOperationReadSetV1({
    readSetId: readSetId(operation), operationId: command.operationId, commandSha256: createBreedingOperationCommandHash(command),
    commandKind: command.commandKind, capturedAtCampaignMinute: 700,
    resources: [
      { resourceKind: 'breeding-operation', resourceId: begin.operationId, existence: 'present', revision: null, definitionSha256: createBreedingOperationCommandHash(begin), observedCampaignMinute: null, purposes: ['idempotency'] },
      { resourceKind: 'campaign-clock', resourceId: 'campaign-clock', existence: 'present', revision: clock.revision, definitionSha256: sha256(clock), observedCampaignMinute: 700, purposes: ['campaign-time'] },
      { resourceKind: 'pokemon-egg', resourceId: egg.eggId, existence: 'present', revision: egg.revision, definitionSha256: pokemonEggLifecycleDocumentDefinitionSha256(egg), observedCampaignMinute: null, purposes: ['conflict', 'mechanics'] },
      { resourceKind: 'pokemon-sheet-allocation', resourceId: 'pokemon', existence: 'present', revision: 0, definitionSha256: initializedSheetContractJson.definitionSha256, observedCampaignMinute: null, purposes: ['conflict', 'write-destination'] },
      { resourceKind: 'species-acquisition', resourceId: `${trainer.slug}/${egg.offspring.speciesId}`, existence: acquisition ? 'present' : 'absent', revision: null, definitionSha256: acquisition?.definitionSha256 ?? null, observedCampaignMinute: null, purposes: ['conflict'] },
      { resourceKind: 'trainer-sheet', resourceId: trainer.slug, existence: 'present', revision: trainer.revision, definitionSha256: fact.trainerSheetDefinitionSha256, observedCampaignMinute: null, purposes: ['authorization', 'conflict', 'write-destination'] },
    ],
    referenceVersions: references, dependencyEvidence: dependencies(egg.revision), writeExpectations: command.scopes,
  })
  const childPlan = planPokemonEggChildSheetConstructionV1({ egg, command })
  const receipt = authorizeBreedingCompleteHatchV1({
    command, readSet, actorAuthority: actor, ownerTrainerControl: control, egg, ownerTrainerFact: fact,
    currentClock: clock, beginHatchCommand: begin,
    currentSpeciesAcquisitionDefinitionSha256: acquisition?.definitionSha256 ?? null,
    childPlanDefinitionSha256: childPlan.definitionSha256,
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  return { command, actor, control, readSet, receipt, childPlan }
}
const input = (value: ReturnType<typeof authority>, currentControl = value.control) => ({
  command: value.command, readSet: value.readSet, authorizationReceipt: value.receipt,
  actorAuthority: value.actor, ownerTrainerControl: value.control, currentOwnerTrainerControl: currentControl,
  referenceVersions: references, childPlan: value.childPlan, audience: 'owner' as const,
})
const options = (database: RotomDatabase, extra: Record<string, unknown> = {}) => ({
  database, campaignProjectionKey: 'hatch-completion-test-projection-key-32', realtimeTimestamp: 1_700_000_000_000,
  sheetUpdatedAt: 2_000, resolveCurrentReferenceVersions: () => references, ...extra,
})
const count = (database: RotomDatabase, table: string): number => Number((database.connection.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as any).count)
const currentControl = (database: RotomDatabase, _command: ReturnType<typeof completeCommand>) => {
  const trainer = createSqliteSheetRepository(database).get('trainer', 'trainer-owner')!
  const fact = createPokemonEggHatchOwnerTrainerFactV1({ trainerSheetSlug: trainer.slug, trainerSheetRevision: trainer.revision, trainerSheetDocument: trainer.document })
  return createBreedingTrainerControlEvidenceV1({ profile, trainerSheetSlug: trainer.slug, trainerSheetRevision: trainer.revision, trainerSheetDefinitionSha256: fact.trainerSheetDefinitionSha256, evaluatedAtCampaignMinute: 700 })
}

describe('BR-057 atomic Pokémon Egg hatch completion', () => {
  it('commits child, first reward, Trainer link, Egg settlement, lineage, result, and restricted refreshes atomically', () => {
    expect(sha256(hatchCompletionContractJson.definition)).toBe(hatchCompletionContractJson.definitionSha256)
    expect(hatchCompletionContractJson.definition.bindings).toMatchObject({
      runtimePolicyDefinitionSha256: BREEDING_HATCH_COMPLETION_POLICY_DEFINITION_SHA256,
      runtimeEvidenceDefinitionSha256: BREEDING_HATCH_COMPLETION_EVIDENCE_DEFINITION_SHA256,
    })
    const { database, egg, begin } = seed('box')
    const auth = authority(database, egg, begin, 'box')
    const result = completePokemonEggHatch(input(auth), options(database))
    expect(result.execution.kind).toBe('executed')
    expect(result.projection).toMatchObject({
      audience: 'owner', status: 'hatched', eggId: EGG_ID, eggRevision: 1,
      childSheetSlug: 'bulbasaur', childSheetRevision: 0, ownerTrainerSlug: 'trainer-owner',
      ownerTrainerRevision: 2, destinationKind: 'box', hatchedAtCampaignMinute: 700,
    })
    expect(result.childSheet?.sheet).toMatchObject({ species: 'Bulbasaur', revision: 0, shiny: false })
    expect(result.ownerTrainerSheet?.sheet).toMatchObject({ dexExp: 8, boxedPokemon: ['bulbasaur'], revision: 2 })
    expect(result.egg).toMatchObject({ status: 'hatched', revision: 1, childSheetSlug: 'bulbasaur', lastOperationId: auth.command.operationId })
    const lineage = createSqliteBreedingLineageRepository(database)
    const origin = lineage.findOriginByEgg(EGG_ID)
    expect(origin).toMatchObject({ originId: ORIGIN_ID, childSheetSlug: 'bulbasaur', sourceEggRevision: 1, settlementOperationId: auth.command.operationId })
    expect(() => lineage.insertOrigin(origin!)).toThrow('caller-owned SQLite transaction')
    expect(createSqliteTrainerSpeciesAcquisitionRepository(database).get('trainer-owner', 'bulbasaur')).toMatchObject({ sourceKind: 'hatch', operationId: auth.command.operationId })
    expect(createSqliteBreedingOperationRepository(database).get(auth.command.operationId)?.status).toBe('accepted')
    expect(count(database, 'realtime_events')).toBe(6)
    expect(JSON.stringify(database.connection.prepare('SELECT event_json, access_json FROM realtime_events').all())).not.toContain(ORIGIN_ID)
  })

  it('atomically creates reciprocal Marsupial pouch state and binds optional Parental Bond authority', () => {
    const database = openRotomDatabase({ path: ':memory:', enableWal: false }); databases.push(database)
    const begin = beginCommand('box')
    const species = compiledBreedingSpeciesSpec('kangaskhan')!
    const forced = resolveBreedingMarsupialBabyTemplateV1()
    const trait = createBreedingMarsupialProviderTraitV1()
    const blueprint = createPokemonEggOffspringBlueprintV1({
      schemaVersion: 1, speciesId: species.speciesId, familyRootSpeciesId: species.familyRootSpeciesId,
      speciesSpecDefinitionSha256: species.definitionSha256,
      nature: { valueId: 'cuddly', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
      ability: { valueId: species.basicAbilityIds[0]!, resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
      gender: { valueId: 'female', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
      inheritanceCandidates: [], startingLevel: 1,
      babyTemplate: { applied: true, choiceOptionId: null, choiceEvidenceId: null, effects: forced.effects },
      providerTraits: { serpentsMark: null, fossilRestoration: null, prehistoricBond: null, marsupial: trait },
    })
    const egg = parseAuthoritativePokemonEggDocumentV1({
      schemaVersion: 1, eggId: EGG_ID, revision: 0, status: 'hatching', ownerTrainerSlug: 'trainer-owner',
      source: { kind: 'gm', reasonId: 'breeding.egg-source.reviewed', evidenceDefinitionSha256: 'e'.repeat(64) }, ruleset,
      definitionHashes: [blueprint.definitionSha256, BREEDING_BABY_TEMPLATE_POLICY_DEFINITION_SHA256, eggContractJson.definitionSha256, hatchDurationPolicyJson.definitionSha256, ruleset.definitionSha256].sort(),
      parents: [], breeder: null, offspring: blueprint,
      incubation: { averageCampaignMinutes: 600, targetCampaignMinutes: 600, accumulatedCampaignMinutes: 600,
        variationPolicyId: 'fixed-average', durationResultDefinitionSha256: 'd'.repeat(64), lastAppliedClockRevision: 1,
        lastAppliedClockMinute: 700, readyAtCampaignMinute: 700, readinessKind: 'incubation-complete', readyOperationId: begin.operationId,
        paused: false, pauseReasonId: null, pauseOperationId: null },
      special: { state: 'normal', rollRecordId: rollId, rollTotal: 42, triggerIds: [], adjudicationId: null, outcomeId: null, automaticShiny: false },
      hatchOperationId: begin.operationId, childSheetSlug: null, terminal: null, createdAtCampaignMinute: 100,
      updatedAtCampaignMinute: 700, statusChangedAtCampaignMinute: 700, lastOperationId: begin.operationId,
    })
    const sheets = createSqliteSheetRepository(database)
    sheets.save({ kind: 'trainer', slug: 'trainer-owner', revision: 0, updatedAt: 1_000, document: trainerDocument([], ['kangaskhan-mother']) })
    sheets.save({ kind: 'pokemon', slug: 'kangaskhan-mother', revision: 0, updatedAt: 1_000, document: {
      slug: 'kangaskhan-mother', revision: 0, nickname: 'Mother', species: 'Kangaskhan', level: 30, totalExp: 0,
      nature: 'Cuddly', babyTemplate: false, abilities: [{ name: 'Parental Bond' }],
    } })
    database.withTransaction(() => {
      const operations = createSqliteBreedingOperationRepository(database)
      operations.reserve(begin, 700)
      createSqliteCampaignClockRepository(database).advance({ expectedRevision: 0, targetCampaignMinute: 700, operationId: begin.operationId })
      createSqlitePokemonEggRepository(database).insert(egg)
      operations.settle(begin, createBreedingOperationAcceptedV1({ operationId: begin.operationId,
        commandHash: createBreedingOperationCommandHash(begin), commandKind: begin.commandKind, outcomeKind: 'hatch-started',
        aggregateRefs: [{ kind: 'pokemon-egg', id: EGG_ID, revision: 0 }], changedScopes: begin.scopes,
        committedAtCampaignMinute: 700 }), 700)
    })
    const trainer = sheets.get('trainer', 'trainer-owner')!
    const mother = sheets.get('pokemon', 'kangaskhan-mother')!
    const command = parseBreedingOperationCommandV1({ schemaVersion: 1, operationId: operationId(21), commandKind: 'complete-hatch',
      actor: { profileId: profile.id, selectedTrainerSlug: 'trainer-owner' }, ruleset,
      scopes: [
        { kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: 0 },
        { kind: 'trainer-sheet', sheetSlug: trainer.slug, expectedRevision: trainer.revision, fields: ['experience','roster'] },
        { kind: 'pokemon-sheet', sheetSlug: mother.slug, expectedRevision: mother.revision, fields: ['marsupial-pouch'] },
        { kind: 'pokemon-sheet-allocation', namespace: 'pokemon' },
        { kind: 'species-acquisition', trainerSheetSlug: trainer.slug, speciesId: species.speciesId },
      ], payload: { eggId: EGG_ID, originId: ORIGIN_ID, destination: { kind: 'box', trainerSheetSlug: trainer.slug } },
    })
    const resolveEffectiveCapabilities = () => ({ actorPlacementId: 'breeding-source:kangaskhan-mother', unresolved: [], instances: [{
      instanceId: 'capability:marsupial:mother', canonicalId: 'Marsupial', parameters: {}, value: null, effective: true,
      suppressionReasons: [], sources: [], primarySource: { kind: 'species-default', sourceId: 'species:kangaskhan', precedence: 1, label: 'Marsupial', value: null }, sourceEffectSha256: sha256('marsupial'),
    }] }) as any
    const motherAuthority = { slug: mother.slug, revision: mother.revision, document: mother.document }
    const marsupialHandoff = createBreedingMarsupialHandoffV1({ sourcePokemonSheet: motherAuthority, capturedAtCampaignMinute: 700 }, { resolveEffectiveCapabilities })
    const parentalBondHandoff = createBreedingParentalBondHandoffV1({ sourcePokemonSheet: motherAuthority, capturedAtCampaignMinute: 700 })
    const lifecycleDependency = dependencies(0).find(entry => entry.providerId === BREEDING_HATCH_COMPLETION_PROVIDER_ID)!
    const resolved = [lifecycleDependency, ...marsupialHandoff.dependencyEvidence, ...parentalBondHandoff.dependencyEvidence]
      .sort((left, right) => breedingDependencyEvidenceKey(left).localeCompare(breedingDependencyEvidenceKey(right)))
    const dependencyEvidence = [{ providerKind: 'system' as const, providerId: 'breeding-effective-dependency-set-v1',
      subjectKind: 'campaign' as const, subjectId: 'campaign', subjectRevision: null, checkpoint: 'authorization' as const,
      providerDefinitionSha256: sha256('breeding-effective-dependency-set-v1'), effectiveEvidenceSha256: sha256(resolved) }, ...resolved]
      .sort((left, right) => breedingDependencyEvidenceKey(left).localeCompare(breedingDependencyEvidenceKey(right)))
    const actor = createBreedingActorAuthorityV1({ role: 'player', command, authenticatedPrincipalSha256: 'a'.repeat(64),
      authenticationPolicyDefinitionSha256: 'b'.repeat(64), profile, evaluatedAtCampaignMinute: 700 })
    const fact = createPokemonEggHatchOwnerTrainerFactV1({ trainerSheetSlug: trainer.slug, trainerSheetRevision: trainer.revision, trainerSheetDocument: trainer.document })
    const control = createBreedingTrainerControlEvidenceV1({ profile, trainerSheetSlug: trainer.slug, trainerSheetRevision: trainer.revision,
      trainerSheetDefinitionSha256: fact.trainerSheetDefinitionSha256, evaluatedAtCampaignMinute: 700 })
    const clock = createSqliteCampaignClockRepository(database).get()
    const readSet = createBreedingOperationReadSetV1({ readSetId: readSetId(21), operationId: command.operationId,
      commandSha256: createBreedingOperationCommandHash(command), commandKind: command.commandKind, capturedAtCampaignMinute: 700,
      resources: [
        { resourceKind: 'breeding-operation', resourceId: begin.operationId, existence: 'present', revision: null, definitionSha256: createBreedingOperationCommandHash(begin), observedCampaignMinute: null, purposes: ['idempotency'] },
        { resourceKind: 'campaign-clock', resourceId: 'campaign-clock', existence: 'present', revision: clock.revision, definitionSha256: sha256(clock), observedCampaignMinute: 700, purposes: ['campaign-time'] },
        { resourceKind: 'pokemon-egg', resourceId: EGG_ID, existence: 'present', revision: 0, definitionSha256: pokemonEggLifecycleDocumentDefinitionSha256(egg), observedCampaignMinute: null, purposes: ['conflict','mechanics'] },
        { resourceKind: 'pokemon-sheet', resourceId: mother.slug, existence: 'present', revision: mother.revision, definitionSha256: sha256(mother.document), observedCampaignMinute: null, purposes: ['conflict','mechanics'] },
        { resourceKind: 'pokemon-sheet-allocation', resourceId: 'pokemon', existence: 'present', revision: 0, definitionSha256: initializedSheetContractJson.definitionSha256, observedCampaignMinute: null, purposes: ['conflict','write-destination'] },
        { resourceKind: 'species-acquisition', resourceId: `${trainer.slug}/${species.speciesId}`, existence: 'absent', revision: null, definitionSha256: null, observedCampaignMinute: null, purposes: ['conflict'] },
        { resourceKind: 'trainer-sheet', resourceId: trainer.slug, existence: 'present', revision: trainer.revision, definitionSha256: fact.trainerSheetDefinitionSha256, observedCampaignMinute: null, purposes: ['authorization','conflict','write-destination'] },
      ], referenceVersions: references, dependencyEvidence, writeExpectations: command.scopes,
    })
    const childPlan = planPokemonEggChildSheetConstructionV1({ egg, command })
    const receipt = authorizeBreedingCompleteHatchV1({ command, readSet, actorAuthority: actor, ownerTrainerControl: control,
      egg, ownerTrainerFact: fact, currentClock: clock, beginHatchCommand: begin, currentSpeciesAcquisitionDefinitionSha256: null,
      childPlanDefinitionSha256: childPlan.definitionSha256, securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256 })
    expect(receipt.authorized).toBe(true)
    const hatchInput = { command, readSet, authorizationReceipt: receipt, actorAuthority: actor,
      ownerTrainerControl: control, currentOwnerTrainerControl: control, referenceVersions: references, childPlan, audience: 'owner' as const }
    sheets.save({ kind: 'pokemon', slug: 'conflicting-claim', revision: 0, updatedAt: 1_500, document: {
      slug: 'conflicting-claim', revision: 0, nickname: 'Conflict', species: 'Pikachu', level: 20,
      capabilityCampaignState: { schemaVersion: 1, storedItems: [], planter: null, keystoneSynchronizations: [],
        letterPress: null, marsupialPouch: { motherSheetSlug: mother.slug, babySheetSlug: 'unavailable-baby',
          experienceSharePercent: 0, establishedAt: 650, sourceOperationId: operationId(20) } },
    } })
    expect(() => completePokemonEggHatch(hatchInput, options(database, { resolveEffectiveCapabilities })))
      .toThrowError(expect.objectContaining({ code: 'breeding.hatch-completion-use-case.stale-authority' }))
    expect(sheets.delete('pokemon', 'conflicting-claim')).toBe(true)
    expect(() => completePokemonEggHatch(hatchInput, options(database, {
      resolveEffectiveCapabilities, beforeSettle: () => { throw new Error('rollback-marsupial-hatch') },
    }))).toThrow('rollback-marsupial-hatch')
    expect(sheets.get('pokemon', mother.slug)?.revision).toBe(0)
    expect(sheets.list('pokemon').map(entry => entry.slug)).toEqual([mother.slug])
    const result = completePokemonEggHatch(hatchInput, options(database, { resolveEffectiveCapabilities, resumePending: true }))
    expect(result.execution.record.status).toBe('accepted')
    expect(result.childSheet?.revision).toBe(1)
    expect(count(database, 'realtime_events')).toBe(8)
    expect(result.execution.record.result?.ok && result.execution.record.result.aggregateRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'pokemon-sheet', id: mother.slug, revision: 1 }),
    ]))
    const linkedMother = sheets.getByRef('pokemon', mother.slug)!
    const linkedBaby = result.childSheet!
    expect(resolveMarsupialRelationship({ subjectSlug: linkedBaby.slug, pokemonBySlug: new Map([
      [linkedMother.slug, linkedMother.sheet as any], [linkedBaby.slug, linkedBaby.sheet as any],
    ]) })).toMatchObject({ status: 'valid', subjectRole: 'baby', pouch: { experienceSharePercent: 0, sourceOperationId: command.operationId } })
    expect((linkedBaby.sheet as any).serverPrivate.breedingProviderTraits.marsupial).toMatchObject({
      motherSheetSlug: mother.slug, hatchHandoffDefinitionSha256: marsupialHandoff.definitionSha256,
      parentalBondHandoffDefinitionSha256: parentalBondHandoff.definitionSha256,
    })
  })

  it('preserves an earlier first-Species identity and grants no duplicate Experience during hatch', () => {
    expect(sha256(hatchSpeciesAcquisitionContractJson.definition)).toBe(hatchSpeciesAcquisitionContractJson.definitionSha256)
    expect(hatchSpeciesAcquisitionContractJson.definition.bindings.runtimePolicyDefinitionSha256)
      .toBe(BREEDING_HATCH_SPECIES_ACQUISITION_POLICY_DEFINITION_SHA256)
    const { database, egg, begin } = seed('box')
    const historical = createTrainerSpeciesAcquisitionRewardService({ database }).record({
      schemaVersion: 1,
      trainerSheetSlug: 'trainer-owner',
      expectedTrainerRevision: 0,
      speciesId: 'bulbasaur',
      sourceKind: 'migration',
      sourceEggId: null,
      acquiredAtCampaignMinute: 650,
      operationId: begin.operationId,
      sheetUpdatedAt: 1_500,
    })
    expect(historical).toMatchObject({ outcome: 'first-acquisition-rewarded', appliedRewardAmount: 1, trainerRevision: 1, currentDexExp: 8 })
    const auth = authority(database, egg, begin, 'box')
    expect(auth.readSet.resources.find(entry => entry.resourceKind === 'species-acquisition')).toMatchObject({ existence: 'present', definitionSha256: historical.acquisition.definitionSha256 })
    const result = completePokemonEggHatch(input(auth), options(database))
    expect(result.execution.kind).toBe('executed')
    expect(result.ownerTrainerSheet).toMatchObject({ revision: 2, sheet: { dexExp: 8, boxedPokemon: ['bulbasaur'] } })
    expect(createSqliteTrainerSpeciesAcquisitionRepository(database).get('trainer-owner', 'bulbasaur')).toEqual(historical.acquisition)
    expect(count(database, 'trainer_species_acquisitions')).toBe(1)
  })

  it('rolls back when a reward participant contradicts the immutable existing history', () => {
    const { database, egg, begin } = seed('box')
    const historical = createTrainerSpeciesAcquisitionRewardService({ database }).record({
      schemaVersion: 1, trainerSheetSlug: 'trainer-owner', expectedTrainerRevision: 0,
      speciesId: 'bulbasaur', sourceKind: 'migration', sourceEggId: null,
      acquiredAtCampaignMinute: 650, operationId: begin.operationId, sheetUpdatedAt: 1_500,
    })
    const auth = authority(database, egg, begin, 'box')
    const invalidRewardService = Object.freeze({
      database,
      record: () => Object.freeze({ ...historical, appliedRewardAmount: 1 as const }),
    })
    const coordinator = createBreedingTransactionCoordinator({ database, speciesAcquisitionRewardService: invalidRewardService })
    expect(() => completePokemonEggHatch(input(auth), options(database, { coordinator }))).toThrow(PokemonHatchSpeciesAcquisitionError)
    expect(createSqliteBreedingOperationRepository(database).get(auth.command.operationId)?.status).toBe('pending')
    expect(createSqlitePokemonEggRepository(database).get(EGG_ID)?.status).toBe('hatching')
    expect(createSqliteSheetRepository(database).get('trainer', 'trainer-owner')?.revision).toBe(1)
    expect(count(database, 'sheets')).toBe(1)
    expect(count(database, 'pokemon_breeding_origins')).toBe(0)
    expect(count(database, 'realtime_events')).toBe(0)
  })

  it('links team destinations without exceeding six and projects only coarse settlement facts', () => {
    const { database, egg, begin } = seed('team', ['one', 'two'])
    const auth = authority(database, egg, begin, 'team')
    const result = completePokemonEggHatch(input(auth), options(database))
    expect(result.ownerTrainerSheet?.sheet.currentTeam).toEqual(['one', 'two', 'bulbasaur'])
    expect(result.projection).not.toHaveProperty('speciesId')
    expect(result.projection).not.toHaveProperty('parents')
    expect(result.projection).not.toHaveProperty('reward')
    expect(result.projection).not.toHaveProperty('authorizationReceipt')
  })

  it('returns an authority-revalidated, publication-silent exact retry', () => {
    const { database, egg, begin } = seed('box')
    const auth = authority(database, egg, begin, 'box')
    const first = completePokemonEggHatch(input(auth), options(database))
    const rows = count(database, 'realtime_events')
    const retryControl = currentControl(database, auth.command)
    const retry = completePokemonEggHatch(input(auth, retryControl), options(database))
    expect(first.execution.kind).toBe('executed')
    expect(retry.execution.kind).toBe('exact-retry')
    expect(retry.execution.committedRealtimeEvents).toEqual([])
    expect(retry.projection).toEqual(first.projection)
    expect(() => completePokemonEggHatch({ ...input(auth, retryControl), childPlan: { ...auth.childPlan, baseSlug: 'forged' } }, options(database))).toThrow()
    expect(() => completePokemonEggHatch({ ...input(auth, retryControl), ownerTrainerControl: null }, options(database))).toThrow()
    expect(count(database, 'realtime_events')).toBe(rows)
    expect(count(database, 'sheets')).toBe(2)
    expect(count(database, 'pokemon_breeding_origins')).toBe(1)
  })

  it('allows only one of two stale concurrent hatch commands across SQLite connections', () => {
    const root = mkdtempSync(join(tmpdir(), 'breeding-hatch-concurrent-')); roots.push(root)
    const path = join(root, 'campaign.sqlite')
    const seeded = seed('box', [], path)
    const second = openRotomDatabase({ path, enableWal: true }); databases.push(second)
    const winner = authority(seeded.database, seeded.egg, seeded.begin, 'box', 11)
    const loser = authority(second, seeded.egg, seeded.begin, 'box', 12)
    expect(completePokemonEggHatch(input(winner), options(seeded.database)).execution.kind).toBe('executed')
    expect(() => completePokemonEggHatch(input(loser), options(second))).toThrow()
    expect(createSqliteBreedingOperationRepository(second).get(loser.command.operationId)).toBeNull()
    expect(count(second, 'sheets')).toBe(2)
    expect(count(second, 'trainer_species_acquisitions')).toBe(1)
    expect(count(second, 'pokemon_breeding_origins')).toBe(1)
    expect(count(second, 'realtime_events')).toBe(6)
  })

  it('settles a recoverable pending loser as stale after another hatch wins', () => {
    const { database, egg, begin } = seed('box')
    const loser = authority(database, egg, begin, 'box', 11)
    const winner = authority(database, egg, begin, 'box', 12)
    expect(() => completePokemonEggHatch(input(loser), options(database, { beforeSettle: () => { throw new Error('loser-paused') } }))).toThrow('loser-paused')
    expect(createSqliteBreedingOperationRepository(database).get(loser.command.operationId)?.status).toBe('pending')
    expect(completePokemonEggHatch(input(winner), options(database)).execution.kind).toBe('executed')
    const control = currentControl(database, loser.command)
    const recovered = completePokemonEggHatch(input(loser, control), options(database, { resumePending: true }))
    expect(recovered.execution.kind).toBe('executed')
    expect(recovered.execution.record.status).toBe('rejected')
    expect(recovered.execution.record.result).toMatchObject({ ok: false, reasonId: 'breeding.operation.stale-revision' })
    expect(count(database, 'sheets')).toBe(2)
    expect(count(database, 'trainer_species_acquisitions')).toBe(1)
    expect(count(database, 'pokemon_breeding_origins')).toBe(1)
    expect(count(database, 'realtime_events')).toBe(6)
  })

  it('rolls an injected post-child failure back and recovers the same pending command', () => {
    const { database, egg, begin } = seed('box')
    const auth = authority(database, egg, begin, 'box')
    const initializedPokemonSheetRepository = createSqliteInitializedPokemonSheetRepository({
      database,
      afterSheetInsert: () => { throw new Error('after-child-insert') },
    })
    const failingCoordinator = createBreedingTransactionCoordinator({ database, initializedPokemonSheetRepository })
    expect(() => completePokemonEggHatch(input(auth), options(database, { coordinator: failingCoordinator }))).toThrow('after-child-insert')
    expect(createSqliteBreedingOperationRepository(database).get(auth.command.operationId)?.status).toBe('pending')
    expect(count(database, 'sheets')).toBe(1)
    expect(count(database, 'trainer_species_acquisitions')).toBe(0)
    expect(count(database, 'pokemon_breeding_origins')).toBe(0)
    expect(count(database, 'realtime_events')).toBe(0)
    const recovered = completePokemonEggHatch(input(auth), options(database, { resumePending: true }))
    expect(recovered.execution.kind).toBe('executed')
    expect(count(database, 'sheets')).toBe(2)
    expect(count(database, 'trainer_species_acquisitions')).toBe(1)
  })

  it('recovers a pending hatch after process restart and exposes a replay gap without replaying mechanics', () => {
    const root = mkdtempSync(join(tmpdir(), 'breeding-hatch-restart-')); roots.push(root)
    const path = join(root, 'campaign.sqlite')
    const seeded = seed('box', [], path)
    const auth = authority(seeded.database, seeded.egg, seeded.begin, 'box')
    expect(() => completePokemonEggHatch(input(auth), options(seeded.database, { beforeSettle: () => { throw new Error('restart') } }))).toThrow('restart')
    seeded.database.close(); databases.splice(databases.indexOf(seeded.database), 1)
    const database = openRotomDatabase({ path, enableWal: true }); databases.push(database)
    const recovered = completePokemonEggHatch(input(auth), options(database, { resumePending: true }))
    expect(recovered.execution.kind).toBe('executed')
    expect(createSqlitePokemonEggRepository(database).get(EGG_ID)?.status).toBe('hatched')
    expect(count(database, 'sheets')).toBe(2)
    const realtime = createSqliteRealtimeEventRepository({ database })
    expect(realtime.readAfter({ afterSequence: 0 }).events).toHaveLength(6)
    realtime.pruneThrough(2)
    expect(realtime.readAfter({ afterSequence: 0 })).toMatchObject({ status: 'gap', events: [], hasMore: false, earliestAvailableSequence: 3, latestSequence: 6 })
    const retry = completePokemonEggHatch(input(auth, currentControl(database, auth.command)), options(database))
    expect(retry.execution.kind).toBe('exact-retry')
    expect(realtime.cursorState()).toEqual({ earliestAvailableSequence: 3, latestSequence: 6 })
  })

  it('rolls every phase-2 write back and resumes the durable pending reservation without duplication', () => {
    const { database, egg, begin } = seed('box')
    const auth = authority(database, egg, begin, 'box')
    expect(() => completePokemonEggHatch(input(auth), options(database, { beforeSettle: () => { throw new Error('rollback') } }))).toThrow('rollback')
    expect(createSqliteBreedingOperationRepository(database).get(auth.command.operationId)?.status).toBe('pending')
    expect(createSqlitePokemonEggRepository(database).get(EGG_ID)?.status).toBe('hatching')
    expect(createSqliteSheetRepository(database).get('trainer', 'trainer-owner')?.revision).toBe(0)
    expect(count(database, 'sheets')).toBe(1)
    expect(count(database, 'trainer_species_acquisitions')).toBe(0)
    expect(count(database, 'pokemon_breeding_origins')).toBe(0)
    expect(count(database, 'realtime_events')).toBe(0)
    const recovered = completePokemonEggHatch(input(auth), options(database, { resumePending: true }))
    expect(recovered.execution.kind).toBe('executed')
    expect(count(database, 'sheets')).toBe(2)
    expect(count(database, 'pokemon_breeding_origins')).toBe(1)
    expect(count(database, 'realtime_events')).toBe(6)
  })

  it('rejects full-team, stale, changed-plan, enriched, asynchronous, and forged-current authority before settlement', () => {
    const full = seed('team', ['one', 'two', 'three', 'four', 'five', 'six'])
    const fullAuth = authority(full.database, full.egg, full.begin, 'team')
    expect(fullAuth.receipt.authorized).toBe(false)
    expect(() => completePokemonEggHatch(input(fullAuth), options(full.database))).toThrow(CompletePokemonEggHatchError)
    expect(count(full.database, 'sheets')).toBe(1)

    const seeded = seed('box'); const auth = authority(seeded.database, seeded.egg, seeded.begin, 'box')
    expect(() => completePokemonEggHatch({ ...input(auth), clientChoice: 'team' }, options(seeded.database))).toThrowError(expect.objectContaining({ code: 'breeding.hatch-completion-use-case.invalid-request' }))
    expect(() => completePokemonEggHatch({ ...input(auth), childPlan: { ...auth.childPlan, baseSlug: 'forged' } }, options(seeded.database))).toThrow()
    expect(() => completePokemonEggHatch(input(auth), options(seeded.database, { resolveCurrentReferenceVersions: () => Promise.resolve(references) }))).toThrowError(expect.objectContaining({ code: 'breeding.hatch-completion-use-case.stale-authority' }))
    const forgedControl = { ...auth.control, trainerSheetRevision: 99 }
    expect(() => completePokemonEggHatch({ ...input(auth), currentOwnerTrainerControl: forgedControl }, options(seeded.database))).toThrow()
    expect(count(seeded.database, 'sheets')).toBe(1)
  })

  it('publishes only after commit and leaves accepted state durable when a publisher fails', () => {
    const { database, egg, begin } = seed('box'); const auth = authority(database, egg, begin, 'box')
    const publish = vi.fn(() => { throw new Error('offline') })
    const report = vi.fn()
    const coordinator = createBreedingTransactionCoordinator({ database, publish, reportPublicationFailure: report })
    const result = completePokemonEggHatch(input(auth), options(database, { coordinator }))
    expect(result.execution.kind).toBe('executed')
    expect(result.execution.publicationFailureCount).toBe(6)
    expect(publish).toHaveBeenCalledTimes(6)
    expect(report).toHaveBeenCalledTimes(6)
    expect(createSqlitePokemonEggRepository(database).get(EGG_ID)?.status).toBe('hatched')
  })
})
