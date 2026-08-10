import { describe, expect, it } from 'vitest'
import eggContractJson from '../../data/breeding-automation/egg-contract.json'
import hatchDurationPolicyJson from '../../data/breeding-automation/hatch-duration-policy.json'
import { type PlayerProfile } from '../../shared/playerProfiles'
import { parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import { createCurrentBreedingReferenceVersionSnapshotV1 } from '../../server/domain/breeding/currentReferences'
import { DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT } from '../../server/domain/breeding/campaignOptions'
import { validatePokemonEggRevisionSuccessor } from '../../server/domain/breeding/eggLifecycle'
import { createPokemonEggOffspringBlueprintV1, parseAuthoritativePokemonEggDocumentV1 } from '../../server/domain/breeding/lineage'
import { compiledBreedingSpeciesSpec } from '../../server/domain/breeding/registry'
import { createBreedingOperationAcceptedV1, createBreedingOperationCommandHash } from '../../server/domain/breeding/operations'
import { createSqliteBreedingOperationRepository } from '../../server/storage/breedingOperationRepository'
import { createSqliteCampaignClockRepository } from '../../server/storage/campaignClockRepository'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqlitePokemonEggRepository } from '../../server/storage/pokemonEggRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { manageBreedingHatchWorkflow } from '../../server/useCases/manageBreedingHatchWorkflow'

const EGG_ID = 'pokemon-egg:v1:75757575757575757575757575757575'
const operationId = (value: number): `breeding-operation:v1:${string}` => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const profile: PlayerProfile = {
  schemaVersion: 1,
  id: 'profile_owner_0075' as never,
  displayName: 'Owner' as never,
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-owner' }],
}
const readyEgg = () => {
  const references = createCurrentBreedingReferenceVersionSnapshotV1(DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT)
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
  return parseAuthoritativePokemonEggDocumentV1({
    schemaVersion: 1,
    eggId: EGG_ID,
    revision: 1,
    status: 'ready',
    ownerTrainerSlug: 'trainer-owner',
    source: { kind: 'gm', reasonId: 'breeding.egg-source.reviewed', evidenceDefinitionSha256: 'e'.repeat(64) },
    ruleset: { rulesetId: references.rulesetId, definitionSha256: references.rulesetDefinitionSha256 },
    definitionHashes: [
      blueprint.definitionSha256,
      eggContractJson.definitionSha256,
      hatchDurationPolicyJson.definitionSha256,
      DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT.definitionSha256,
      references.rulesetDefinitionSha256,
      'd'.repeat(64),
    ].sort(),
    parents: [],
    breeder: null,
    offspring: blueprint,
    incubation: {
      averageCampaignMinutes: 600,
      targetCampaignMinutes: 600,
      accumulatedCampaignMinutes: 600,
      variationPolicyId: 'fixed-average',
      durationResultDefinitionSha256: 'd'.repeat(64),
      lastAppliedClockRevision: 1,
      lastAppliedClockMinute: 700,
      readyAtCampaignMinute: 700,
      readinessKind: 'gm-mark-ready',
      readyOperationId: operationId(2),
      paused: false,
      pauseReasonId: null,
      pauseOperationId: null,
    },
    special: { state: 'not-rolled', rollRecordId: null, rollTotal: null, triggerIds: [], adjudicationId: null, outcomeId: null, automaticShiny: false },
    hatchOperationId: null,
    childSheetSlug: null,
    terminal: null,
    createdAtCampaignMinute: 100,
    updatedAtCampaignMinute: 700,
    statusChangedAtCampaignMinute: 700,
    lastOperationId: operationId(2),
  })
}
const seed = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  createSqliteSheetRepository(database).save({
    kind: 'trainer', slug: 'trainer-owner', revision: 0, updatedAt: 1_000,
    document: { slug: 'trainer-owner', name: 'Owner', level: 10, dexExp: 0, currentTeam: [], boxedPokemon: [] },
  })
  const ready = readyEgg()
  const initial = parseAuthoritativePokemonEggDocumentV1({
    ...ready,
    revision: 0,
    status: 'incubating',
    incubation: {
      ...ready.incubation,
      accumulatedCampaignMinutes: 0,
      lastAppliedClockRevision: 0,
      lastAppliedClockMinute: 100,
      readyAtCampaignMinute: null,
      readinessKind: null,
      readyOperationId: null,
    },
    updatedAtCampaignMinute: 100,
    statusChangedAtCampaignMinute: 100,
    lastOperationId: operationId(1),
  })
  validatePokemonEggRevisionSuccessor(initial, ready)
  const source = parseBreedingOperationCommandV1({
    schemaVersion: 1, operationId: operationId(1), commandKind: 'create-source-egg',
    actor: { profileId: 'campaign-gm', selectedTrainerSlug: null }, ruleset: ready.ruleset,
    scopes: [{ kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: null }],
    payload: { eggId: EGG_ID, ownerTrainerSlug: 'trainer-owner',
      source: ready.source, speciesOptionId: 'option:v1:75757575757575757575757575757575',
      resolutions: { selectedOptionIds: [], requestedRollKinds: [] } },
  })
  const mark = parseBreedingOperationCommandV1({
    schemaVersion: 1, operationId: operationId(2), commandKind: 'mark-egg-ready',
    actor: { profileId: 'campaign-gm', selectedTrainerSlug: null }, ruleset: ready.ruleset,
    scopes: [{ kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: 0 }],
    payload: { eggId: EGG_ID, reasonId: 'breeding.egg-ready.gm-adjudication' },
  })
  database.withTransaction(() => {
    const eggs = createSqlitePokemonEggRepository(database)
    const operations = createSqliteBreedingOperationRepository(database)
    const clock = createSqliteCampaignClockRepository(database)
    operations.reserve(source, 100)
    clock.advance({ expectedRevision: 0, targetCampaignMinute: 100, operationId: source.operationId })
    eggs.insert(initial)
    operations.settle(source, createBreedingOperationAcceptedV1({ operationId: source.operationId,
      commandHash: createBreedingOperationCommandHash(source), commandKind: source.commandKind,
      outcomeKind: 'source-egg-created', aggregateRefs: [{ kind: 'pokemon-egg', id: EGG_ID, revision: 0 }],
      changedScopes: source.scopes, committedAtCampaignMinute: 100 }), 100)
    operations.reserve(mark, 700)
    clock.advance({ expectedRevision: 1, targetCampaignMinute: 700, operationId: mark.operationId })
    eggs.replace({ expectedRevision: 0, document: ready })
    operations.settle(mark, createBreedingOperationAcceptedV1({ operationId: mark.operationId,
      commandHash: createBreedingOperationCommandHash(mark), commandKind: mark.commandKind,
      outcomeKind: 'egg-ready', aggregateRefs: [{ kind: 'pokemon-egg', id: EGG_ID, revision: 1 }],
      changedScopes: mark.scopes, committedAtCampaignMinute: 700 }), 700)
  })
  return database
}
const request = (database: RotomDatabase, value: {
  intent: 'inspect' | 'begin' | 'resolve-special' | 'complete'
  revision: number
  optionId?: string
  role?: 'player' | 'gm'
  draw?: number
}) => manageBreedingHatchWorkflow({
  role: value.role ?? 'player',
  playerProfile: value.role === 'gm' ? null : profile,
  request: {
    schemaVersion: 1,
    profileId: value.role === 'gm' ? null : profile.id,
    trainerSheetSlug: 'trainer-owner',
    eggId: EGG_ID,
    expectedEggRevision: value.revision,
    intent: value.intent,
    selectedOptionId: value.optionId ?? null,
    confirmed: value.intent !== 'inspect',
  },
}, {
  database,
  drawHatchSpecialD100: () => value.draw ?? 50,
  realtimeTimestamp: 2_000,
  sheetUpdatedAt: 2_000,
})

describe('BR-075 server-authorized hatch workflow', () => {
  it('inspects, begins, completes, reveals, and exactly replays without duplicate mutation', () => {
    const database = seed()
    try {
      const inspected = request(database, { intent: 'inspect', revision: 1 })
      expect(inspected).toMatchObject({ audience: 'owner', stage: 'ready', decision: { kind: 'begin-hatch', canSubmit: true } })
      expect(inspected).not.toHaveProperty('authorizationReceipt')
      expect(inspected).not.toHaveProperty('operationId')

      const begun = request(database, { intent: 'begin', revision: 1, draw: 50 })
      expect(begun).toMatchObject({ stage: 'ready-to-complete', transition: 'hatch-started', egg: { revision: 2, status: 'hatching' } })
      expect(begun.special).toEqual({ state: 'normal', outcomeId: null, gmReview: null })

      const completed = request(database, { intent: 'complete', revision: 2 })
      expect(completed).toMatchObject({
        stage: 'hatched', transition: 'child-revealed', egg: { revision: 3, status: 'hatched' },
        childReveal: { childSheetSlug: 'bulbasaur', speciesName: 'Bulbasaur', destinationKind: 'box' },
      })
      expect(createSqliteSheetRepository(database).get('trainer', 'trainer-owner')?.document).toMatchObject({ boxedPokemon: ['bulbasaur'], dexExp: 1 })

      const eventCount = Number((database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get() as { count: number }).count)
      const replay = request(database, { intent: 'complete', revision: 2 })
      expect(replay).toMatchObject({ transition: 'exact-replay', egg: { revision: 3 }, childReveal: { childSheetSlug: 'bulbasaur' } })
      expect(createSqliteSheetRepository(database).list('pokemon')).toHaveLength(1)
      expect(Number((database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get() as { count: number }).count)).toBe(eventCount)
    }
    finally { database.close() }
  })

  it('redacts a triggered roll from owners and permits only the GM bounded option', () => {
    const database = seed()
    try {
      const begun = request(database, { intent: 'begin', revision: 1, draw: 1 })
      expect(begun).toMatchObject({ stage: 'awaiting-gm', decision: { kind: 'none', reasonId: 'breeding.hatch.awaiting-gm' } })
      expect(JSON.stringify(begun)).not.toContain('rollTotal')
      expect(JSON.stringify(begun)).not.toContain('option:v1:')

      const gm = request(database, { intent: 'inspect', revision: 2, role: 'gm' })
      expect(gm).toMatchObject({ stage: 'awaiting-gm', decision: { kind: 'resolve-special' }, special: { gmReview: { rollTotal: 1 } } })
      expect(gm.special.gmReview?.options).toHaveLength(3)
      const selected = gm.special.gmReview!.options[0]!.optionId
      const resolved = request(database, { intent: 'resolve-special', revision: 2, role: 'gm', optionId: selected })
      expect(resolved).toMatchObject({ stage: 'ready-to-complete', transition: 'special-resolved', egg: { revision: 3 } })
    }
    finally { database.close() }
  })

  it('fails closed on stale, enriched, cross-owner, and non-GM special requests', () => {
    const database = seed()
    try {
      expect(() => manageBreedingHatchWorkflow({
        role: 'player', playerProfile: profile,
        request: { schemaVersion: 1, profileId: profile.id, trainerSheetSlug: 'trainer-owner', eggId: EGG_ID,
          expectedEggRevision: 1, intent: 'inspect', selectedOptionId: null, confirmed: false, authority: true },
      }, { database })).toThrow()
      expect(() => request(database, { intent: 'inspect', revision: 0 })).toThrow()
      expect(() => manageBreedingHatchWorkflow({
        role: 'player', playerProfile: { ...profile, linkedCharacters: [] },
        request: { schemaVersion: 1, profileId: profile.id, trainerSheetSlug: 'trainer-owner', eggId: EGG_ID,
          expectedEggRevision: 1, intent: 'inspect', selectedOptionId: null, confirmed: false },
      }, { database })).toThrowError(expect.objectContaining({ statusCode: 403 }))
    }
    finally { database.close() }
  })
})
