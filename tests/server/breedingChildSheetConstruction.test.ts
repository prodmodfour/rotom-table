import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import childSheetContractJson from '../../data/breeding-automation/child-sheet-construction-contract.json'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import eggContractJson from '../../data/breeding-automation/egg-contract.json'
import hatchDurationPolicyJson from '../../data/breeding-automation/hatch-duration-policy.json'
import initializedSheetContractJson from '../../data/breeding-automation/initialized-pokemon-sheet-contract.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import { parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import { createPokemonEggOffspringBlueprintV1, parseAuthoritativePokemonEggDocumentV1 } from '../../server/domain/breeding/lineage'
import { compiledBreedingSpeciesSpec } from '../../server/domain/breeding/registry'
import { BREEDING_BABY_TEMPLATE_POLICY_DEFINITION_SHA256 } from '../../server/domain/breeding/babyTemplate'
import {
  assertPokemonEggChildSheetConstructionExactReplayV1,
  BREEDING_CHILD_SHEET_CONSTRUCTION_POLICY_DEFINITION_SHA256,
  planPokemonEggChildSheetConstructionV1,
  PokemonEggChildSheetConstructionError,
} from '../../server/domain/breeding/childSheetConstruction'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteInitializedPokemonSheetRepository } from '../../server/storage/initializedPokemonSheetRepository'

const databases: RotomDatabase[] = []
afterEach(() => { while (databases.length > 0) databases.pop()?.close() })
const ruleset = { rulesetId: rulesetJson.rulesetId, definitionSha256: rulesetJson.definitionSha256 }
const eggId = 'pokemon-egg:v1:55555555555555555555555555555555'
const operationId = (value: number): `breeding-operation:v1:${string}` => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const originId = 'pokemon-breeding-origin:v1:55555555555555555555555555555555'
const rollId = 'breeding-roll:v1:55555555555555555555555555555555'

const hatchingEgg = (overrides: {
  readonly speciesId?: string
  readonly abilityId?: string
  readonly genderId?: 'male' | 'female' | 'genderless'
  readonly level?: number
  readonly babyTemplate?: boolean
  readonly status?: 'ready' | 'hatching'
  readonly speciesSpecHash?: string
} = {}) => {
  const species = compiledBreedingSpeciesSpec(overrides.speciesId ?? 'bulbasaur')!
  const blueprint = createPokemonEggOffspringBlueprintV1({
    schemaVersion: 1,
    speciesId: species.speciesId,
    familyRootSpeciesId: species.familyRootSpeciesId,
    speciesSpecDefinitionSha256: overrides.speciesSpecHash ?? species.definitionSha256,
    nature: { valueId: 'cuddly', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    ability: { valueId: overrides.abilityId ?? species.basicAbilityIds[0]!, resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    gender: { valueId: overrides.genderId ?? 'female', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    inheritanceCandidates: [],
    startingLevel: overrides.level ?? 1,
    babyTemplate: {
      applied: overrides.babyTemplate ?? false,
      choiceOptionId: overrides.babyTemplate ? 'option:v1:55555555555555555555555555555555' : null,
      choiceEvidenceId: overrides.babyTemplate ? 'breeding.baby-template.gm-authority' : null,
      effects: overrides.babyTemplate ? {
        baseStatPenaltyEach: 2,
        skillRankPenalty: 1,
        capabilityPenalty: 2,
        sizePercentOfAdult: 50,
        recoveryBaseStatPointsEachInterval: 1,
        recoveryIntervalLevels: 5,
        recoveryStepCount: 2,
        removeSkillAndCapabilityPenaltyAfterFinalRecovery: true,
      } : null,
    },
  })
  const status = overrides.status ?? 'hatching'
  return parseAuthoritativePokemonEggDocumentV1({
    schemaVersion: 1,
    eggId,
    revision: status === 'hatching' ? 2 : 1,
    status,
    ownerTrainerSlug: 'trainer-owner',
    source: { kind: 'gm', reasonId: 'breeding.egg-source.reviewed', evidenceDefinitionSha256: 'e'.repeat(64) },
    ruleset,
    definitionHashes: [
      blueprint.definitionSha256,
      eggContractJson.definitionSha256,
      hatchDurationPolicyJson.definitionSha256,
      ruleset.definitionSha256,
      ...(overrides.babyTemplate ? [BREEDING_BABY_TEMPLATE_POLICY_DEFINITION_SHA256] : []),
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
      lastAppliedClockRevision: 2,
      lastAppliedClockMinute: 700,
      readyAtCampaignMinute: 700,
      readinessKind: 'incubation-complete',
      readyOperationId: operationId(2),
      paused: false,
      pauseReasonId: null,
      pauseOperationId: null,
    },
    special: status === 'hatching'
      ? { state: 'normal', rollRecordId: rollId, rollTotal: 42, triggerIds: [], adjudicationId: null, outcomeId: null, automaticShiny: false }
      : { state: 'not-rolled', rollRecordId: null, rollTotal: null, triggerIds: [], adjudicationId: null, outcomeId: null, automaticShiny: false },
    hatchOperationId: status === 'hatching' ? operationId(10) : null,
    childSheetSlug: null,
    terminal: null,
    createdAtCampaignMinute: 100,
    updatedAtCampaignMinute: 700,
    statusChangedAtCampaignMinute: 700,
    lastOperationId: status === 'hatching' ? operationId(10) : operationId(2),
  })
}
const completeCommand = (egg = hatchingEgg(), destination: 'box' | 'team' = 'box') => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(11),
  commandKind: 'complete-hatch',
  actor: { profileId: 'profile_owner_0001', selectedTrainerSlug: 'trainer-owner' },
  ruleset,
  scopes: [
    { kind: 'pokemon-egg', eggId, expectedRevision: egg.revision },
    { kind: 'trainer-sheet', sheetSlug: 'trainer-owner', expectedRevision: 3, fields: ['experience', 'roster'] },
    { kind: 'pokemon-sheet-allocation', namespace: 'pokemon' },
    { kind: 'species-acquisition', trainerSheetSlug: 'trainer-owner', speciesId: egg.offspring.speciesId },
  ],
  payload: { eggId, originId, destination: { kind: destination, trainerSheetSlug: 'trainer-owner' } },
})

const plan = (egg = hatchingEgg(), command = completeCommand(egg)) => planPokemonEggChildSheetConstructionV1({ egg, command })

describe('complete frozen-Egg child sheet construction', () => {
  it('binds the reviewed no-placeholder child construction contract and runtime policy', () => {
    expect(createHash('sha256').update(stableJsonStringify(childSheetContractJson.definition)).digest('hex'))
      .toBe(childSheetContractJson.definitionSha256)
    expect(childSheetContractJson.definition.bindings.runtimePolicyDefinitionSha256)
      .toBe(BREEDING_CHILD_SHEET_CONSTRUCTION_POLICY_DEFINITION_SHA256)
    expect(childSheetContractJson.definition.construction).toMatchObject({ shiny: false, appliedMoves: [], pokeEdges: [] })
    expect(childSheetContractJson.definition.storage).toMatchObject({
      insertRevision: 0,
      placeholderOrFollowupSave: 'forbidden-except-one-same-hatch-transaction-Marsupial-pouch-link-revision',
      marsupialChildRevision: 'one-after-atomic-reciprocal-pouch-link-otherwise-zero',
    })
  })

  it('builds a complete canonical newborn accepted by the one-write initialized-sheet repository', () => {
    const result = plan()
    expect(result).toMatchObject({
      schemaVersion: 1,
      eggId,
      sourceEggRevision: 2,
      operationId: operationId(11),
      originId,
      ownerTrainerSlug: 'trainer-owner',
      destination: { kind: 'box', trainerSheetSlug: 'trainer-owner' },
      baseSlug: 'Bulbasaur',
      folder: '',
      document: {
        nickname: 'Bulbasaur', species: 'Bulbasaur', level: 1, totalExp: 0, gender: 'Female',
        loyalty: 3, tutorPoints: { earned: 1, spent: 0 }, shiny: false, caughtBall: 'Basic Ball', player: false, nature: 'Cuddly',
        babyTemplate: false, inheritedRemaining: 0,
        abilities: [{ name: 'Chlorophyll', activated: false }],
        movelist: [{ name: 'Tackle' }],
        eggMoves: [], appliedMoves: [], edges: [], combat: { currentHp: 29 },
      },
    })
    expect(result.sourceDefinitionHashes).toContain(BREEDING_CHILD_SHEET_CONSTRUCTION_POLICY_DEFINITION_SHA256)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.document.stats)).toBe(true)
    expect(result.document).not.toHaveProperty('slug')
    expect(result.document).not.toHaveProperty('revision')
    expect(result.document).not.toHaveProperty('updatedAt')

    const database = openRotomDatabase({ path: ':memory:', enableWal: false }); databases.push(database)
    const created = createSqliteInitializedPokemonSheetRepository({ database }).create({
      baseSlug: result.baseSlug,
      folder: result.folder,
      updatedAt: 1_700_000_000_000,
      document: result.document,
    })
    expect(created).toMatchObject({ slug: 'bulbasaur', revision: 0, sheet: { species: 'Bulbasaur', combat: { currentHp: 29 } } })
    expect(created.sheet.createdAt).toBe(1_700_000_000_000)
  })

  it('uses frozen species, trait, Level, Ability, Gender, and current schema/reference identities deterministically', () => {
    const egg = hatchingEgg({ speciesId: 'abra', abilityId: 'synchronize', genderId: 'male', level: 10 })
    const result = plan(egg, completeCommand(egg, 'team'))
    expect(result.document).toMatchObject({
      nickname: 'Abra', species: 'Abra', level: 10, totalExp: 90, gender: 'Male', nature: 'Cuddly',
      abilities: [{ name: 'Synchronize' }], babyTemplate: false,
    })
    expect(result.document.movelist?.map(move => move.name)).toEqual(['Teleport'])
    expect(result.destination.kind).toBe('team')
    expect(planPokemonEggChildSheetConstructionV1({ egg, command: completeCommand(egg, 'team') })).toEqual(result)
    expect(assertPokemonEggChildSheetConstructionExactReplayV1({ plan: result, egg, command: completeCommand(egg, 'team') })).toEqual(result)
  })

  it('never derives Shiny, lineage, storage authority, applied Moves, or Poké Edges from a special classification', () => {
    const egg = hatchingEgg()
    const resolved = parseAuthoritativePokemonEggDocumentV1({
      ...egg,
      special: {
        state: 'resolved', rollRecordId: rollId, rollTotal: 1, triggerIds: ['roll-1'],
        adjudicationId: 'breeding-adjudication:v1:55555555555555555555555555555555',
        outcomeId: 'breeding.hatch-special.distinctive-appearance', automaticShiny: false,
      },
    })
    const result = plan(resolved, completeCommand(resolved))
    expect(result.document.shiny).toBe(false)
    expect(result.document.appliedMoves).toEqual([])
    expect(result.document.edges).toEqual([])
    expect(JSON.stringify(result.document)).not.toMatch(/origin|lineage|parent|breeder|adjudication|roll-1|distinctive/iu)
  })

  it('rejects enriched input, wrong commands, stale owner/ruleset/spec authority, and non-hatching Eggs', () => {
    const egg = hatchingEgg()
    const command = completeCommand(egg)
    expect(() => planPokemonEggChildSheetConstructionV1({ egg, command, displayName: 'Forged' })).toThrow(PokemonEggChildSheetConstructionError)
    expect(() => planPokemonEggChildSheetConstructionV1({ egg, command: { ...command, commandKind: 'cancel-egg' } })).toThrow()
    expect(() => plan(hatchingEgg({ status: 'ready' }), completeCommand(hatchingEgg({ status: 'ready' })))).toThrowError(expect.objectContaining({ code: 'breeding.child-sheet.unavailable' }))
    expect(() => planPokemonEggChildSheetConstructionV1({
      egg,
      command: { ...command, payload: { ...command.payload, destination: { kind: 'box', trainerSheetSlug: 'trainer-other' } } },
    })).toThrow()
    const stale = hatchingEgg({ speciesSpecHash: 'f'.repeat(64) })
    expect(() => plan(stale, completeCommand(stale))).toThrowError(expect.objectContaining({ code: 'breeding.child-sheet.stale-authority' }))
  })

  it('constructs server-owned Baby Template mechanics while retaining the BR-068 starting-Level gate', () => {
    const baby = hatchingEgg({ babyTemplate: true })
    const result = plan(baby, completeCommand(baby))
    expect(result.document).toMatchObject({
      babyTemplate: true,
      babyTemplateMechanics: {
        applicationKind: 'campaign-option',
        effects: { baseStatPenaltyEach: 2, skillRankPenalty: 1, capabilityPenalty: 2 },
      },
      serverPrivate: {
        breedingBabyTemplate: {
          sourceEggId: eggId,
          choiceOptionId: 'option:v1:55555555555555555555555555555555',
          choiceEvidenceId: 'breeding.baby-template.gm-authority',
        },
      },
    })
    const hp = result.document.stats?.hp
    expect(hp).toBeDefined()
    const highLevel = hatchingEgg({ level: 20 })
    expect(() => plan(highLevel, completeCommand(highLevel))).toThrowError(expect.objectContaining({ code: 'breeding.child-sheet.unavailable' }))
  })

  it('rejects a modified or enriched retained plan instead of accepting partial replay', () => {
    const egg = hatchingEgg(); const command = completeCommand(egg); const result = plan(egg, command)
    expect(() => assertPokemonEggChildSheetConstructionExactReplayV1({
      plan: { ...result, document: { ...result.document, nickname: 'Client Child' } }, egg, command,
    })).toThrowError(expect.objectContaining({ code: 'breeding.child-sheet.hash-mismatch' }))
    expect(initializedSheetContractJson.definition.candidate.newbornAppliedMoves).toBe(0)
    expect(initializedSheetContractJson.definition.candidate.newbornPokeEdges).toBe(0)
  })
})
