import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { parsePokemonEggDocumentV1, type PokemonEggInheritanceCandidateV1 } from '../../shared/breeding/egg'
import {
  BREEDING_INHERITANCE_CHECKPOINT_LEVELS,
  PokemonBreedingLineageValidationError,
  parsePokemonBreedingOriginV1,
  type BreedingInheritanceLearningRecordV1,
  type PokemonBreedingOriginV1,
} from '../../shared/breeding/lineage'
import {
  AuthoritativeBreedingLineageValidationError,
  appendBreedingInheritanceLearningRecord,
  breedingInheritanceCandidateDefinitionSha256,
  breedingInheritanceCandidateSetDefinitionSha256,
  createBreederSnapshotV1,
  createBreedingInheritanceLearningRecordV1,
  createBreedingParentSnapshotV1,
  createPokemonBreedingOriginFromHatchedEgg,
  createPokemonEggOffspringBlueprintV1,
  parseAuthoritativeBreedingParentSnapshotV1,
  parseAuthoritativePokemonBreedingOriginV1,
  validatePokemonBreedingOriginAgainstHatchedEgg,
} from '../../server/domain/breeding/lineage'
import type { PokemonBreedingOriginId } from '../../shared/breeding/ids'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const policy = readJson<Record<string, any>>('data/breeding-automation/lineage-contract.json')
const eggPolicy = readJson<Record<string, any>>('data/breeding-automation/egg-contract.json')
const ruleset = readJson<Record<string, any>>('data/breeding-automation/ruleset.json')
const op = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const roll = (value: number): string => `breeding-roll:v1:${value.toString(16).padStart(32, '0')}`
const learningId = (value: number): string => `inheritance-learning:v1:${value.toString(16).padStart(32, '0')}`
const ORIGIN_ID = 'pokemon-breeding-origin:v1:11111111111111111111111111111111' as PokemonBreedingOriginId
const EGG_ID = 'pokemon-egg:v1:22222222222222222222222222222222'
const PROJECT_ID = 'breeding-project:v1:33333333333333333333333333333333'
const CHILD_SLUG = 'pokemon-bulbasaur-child'
const knownEvidence = (parentIndex: 0 | 1) => ({
  evidenceId: `parent-${parentIndex}:light-screen`,
  sourceKind: 'sheet-known-move' as const,
  sourceId: `sheet-move:parent-${parentIndex}:light-screen`,
  sourceDefinitionSha256: String(parentIndex + 1).repeat(64),
})
const parent = (parentIndex: 0 | 1, withCandidate = true) => createBreedingParentSnapshotV1({
  schemaVersion: 1,
  parentIndex,
  pokemonSheetSlug: `pokemon-parent-${parentIndex}`,
  displayNameAtSnapshot: parentIndex === 0 ? 'Garden Parent' : 'Meadow Parent',
  ownerTrainerSlug: 'trainer-owner',
  sheetRevision: parentIndex + 8,
  sourceSheetSha256: String(parentIndex + 3).repeat(64),
  speciesId: 'bulbasaur',
  familyRootSpeciesId: 'bulbasaur',
  speciesSpecDefinitionSha256: '5'.repeat(64),
  genderId: parentIndex === 0 ? 'female' : 'male',
  roleId: parentIndex === 0 ? 'female-parent' : 'male-parent',
  roleEvidenceDefinitionSha256: '6'.repeat(64),
  level: 25,
  maturity: {
    policyId: 'minimum-level', minimumLevel: 20, gmConfirmed: null, eligible: true,
    evidenceDefinitionSha256: '7'.repeat(64),
  },
  eggGroupIds: ['monster', 'plant'],
  effectiveKnownMoves: withCandidate ? [{ moveId: 'light-screen', evidence: [knownEvidence(parentIndex)] }] : [],
  controlEvidenceDefinitionSha256: '8'.repeat(64),
  capturedAtCampaignMinute: 95,
})
const candidate = (): PokemonEggInheritanceCandidateV1 => ({
  moveId: 'light-screen',
  sources: [
    { kind: 'parent', parentIndex: 0, parentRef: 'pokemon-parent-0', parentSpeciesId: 'bulbasaur', pathwayId: 'child-egg-move', knownMoveEvidence: [knownEvidence(0)] },
    { kind: 'parent', parentIndex: 0, parentRef: 'pokemon-parent-0', parentSpeciesId: 'bulbasaur', pathwayId: 'child-machine-compatible', knownMoveEvidence: [knownEvidence(0)] },
    { kind: 'parent', parentIndex: 1, parentRef: 'pokemon-parent-1', parentSpeciesId: 'bulbasaur', pathwayId: 'child-egg-move', knownMoveEvidence: [knownEvidence(1)] },
    { kind: 'parent', parentIndex: 1, parentRef: 'pokemon-parent-1', parentSpeciesId: 'bulbasaur', pathwayId: 'child-machine-compatible', knownMoveEvidence: [knownEvidence(1)] },
  ],
} as PokemonEggInheritanceCandidateV1)
const hatchedEgg = (withCandidate = true, startingLevel = 1) => {
  const parents = [parent(0, withCandidate), parent(1, withCandidate)] as const
  const breeder = createBreederSnapshotV1({
    schemaVersion: 1,
    trainerSheetSlug: 'trainer-breeder',
    sheetRevision: 12,
    sourceSheetSha256: '9'.repeat(64),
    pokemonEducationRank: 'Expert',
    permissionEvidenceIds: ['edge:breeder'],
    providerSnapshotDefinitionSha256: 'a'.repeat(64),
    capturedAtCampaignMinute: 96,
  })
  const offspring = createPokemonEggOffspringBlueprintV1({
    schemaVersion: 1,
    speciesId: 'bulbasaur',
    familyRootSpeciesId: 'bulbasaur',
    speciesSpecDefinitionSha256: '5'.repeat(64),
    nature: { valueId: 'cuddly', resolutionKind: 'random', rollRecordId: roll(1), optionId: null, choiceEvidenceId: null },
    ability: { valueId: 'overgrow', resolutionKind: 'random', rollRecordId: roll(2), optionId: null, choiceEvidenceId: null },
    gender: { valueId: 'female', resolutionKind: 'random', rollRecordId: roll(3), optionId: null, choiceEvidenceId: null },
    inheritanceCandidates: withCandidate ? [candidate()] : [],
    startingLevel,
    babyTemplate: { applied: false, choiceOptionId: null, choiceEvidenceId: null, effects: null },
  })
  return parsePokemonEggDocumentV1({
    schemaVersion: 1,
    eggId: EGG_ID,
    revision: 5,
    status: 'hatched',
    ownerTrainerSlug: 'trainer-owner',
    source: { kind: 'breeding', projectId: PROJECT_ID },
    ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 },
    definitionHashes: [eggPolicy.definitionSha256, policy.definitionSha256, ruleset.definitionSha256].sort(),
    parents,
    breeder,
    offspring,
    incubation: {
      averageCampaignMinutes: 14_400,
      targetCampaignMinutes: 14_400,
      accumulatedCampaignMinutes: 14_400,
      variationPolicyId: 'fixed-average',
      durationResultDefinitionSha256: 'b'.repeat(64),
      lastAppliedClockRevision: 20,
      lastAppliedClockMinute: 200,
      readyAtCampaignMinute: 200,
      readinessKind: 'incubation-complete',
      readyOperationId: op(3),
      paused: false,
      pauseReasonId: null,
      pauseOperationId: null,
    },
    special: {
      state: 'normal', rollRecordId: roll(4), rollTotal: 50, triggerIds: [],
      adjudicationId: null, outcomeId: null, automaticShiny: false,
    },
    hatchOperationId: op(4),
    childSheetSlug: CHILD_SLUG,
    terminal: null,
    createdAtCampaignMinute: 100,
    updatedAtCampaignMinute: 203,
    statusChangedAtCampaignMinute: 203,
    lastOperationId: op(6),
  })
}
const origin = (withCandidate = true) => createPokemonBreedingOriginFromHatchedEgg({ originId: ORIGIN_ID, egg: hatchedEgg(withCandidate) })
const learnedRecord = (originValue: PokemonBreedingOriginV1, checkpointLevel: 20 | 30, index: number, revisions: readonly [number, number]): BreedingInheritanceLearningRecordV1 => {
  const frozenCandidate = originValue.offspring.inheritanceCandidates[0]!
  const candidateDefinitionSha256 = breedingInheritanceCandidateDefinitionSha256(frozenCandidate)
  const id = learningId(index)
  const operationId = op(index + 20)
  return createBreedingInheritanceLearningRecordV1({
    schemaVersion: 1,
    learningRecordId: id as any,
    originId: originValue.originId,
    eggId: originValue.eggId,
    childSheetSlug: originValue.childSheetSlug,
    checkpointLevel,
    application: { kind: 'level-up', childSheetRevisionBefore: revisions[0], childSheetRevisionAfter: revisions[1] },
    outcome: {
      kind: 'learned',
      moveId: frozenCandidate.moveId,
      candidateDefinitionSha256,
      permanentMoveProvenance: {
        schemaVersion: 1,
        kind: 'breeding-inheritance',
        originId: originValue.originId,
        eggId: originValue.eggId,
        learningRecordId: id as any,
        checkpointLevel,
        moveId: frozenCandidate.moveId,
        operationId: operationId as any,
        candidateDefinitionSha256,
      },
    },
    recordedAtCampaignMinute: 300 + index,
    operationId: operationId as any,
  })
}

describe('Breeding lineage contracts', () => {
  it('binds the reviewed parent, child-origin, and inheritance-learning policy', () => {
    expect(policy).toMatchObject({
      schemaVersion: 1,
      contractId: 'ptu-1.05-pokemon-breeding-lineage-v1',
      rulesetId: ruleset.rulesetId,
      rulesetDefinitionSha256: ruleset.definitionSha256,
      sourceManifestSha256: sha256(readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))),
    })
    expect(policy.definitionSha256).toBe(sha256(stableJsonStringify(policy.definition)))
    expect(policy.definition.bindings.eggContractDefinitionSha256).toBe(eggPolicy.definitionSha256)
    expect(policy.definition.inheritanceLearning.checkpointLevels).toEqual(BREEDING_INHERITANCE_CHECKPOINT_LEVELS)
    expect(policy.definition.inheritanceLearning).toMatchObject({
      oneRecordPerCheckpoint: true,
      legacyEggMovesAuthority: 'none',
      legacyInheritedMovesAuthority: 'none',
    })
  })

  it('creates complete, detached, self-hashed parent and Breeder snapshots', () => {
    const mutableEvidence = knownEvidence(0)
    const input: any = {
      schemaVersion: 1,
      parentIndex: 0,
      pokemonSheetSlug: 'pokemon-parent-0',
      displayNameAtSnapshot: 'Original Parent',
      ownerTrainerSlug: 'trainer-owner',
      sheetRevision: 8,
      sourceSheetSha256: '3'.repeat(64),
      speciesId: 'bulbasaur',
      familyRootSpeciesId: 'bulbasaur',
      speciesSpecDefinitionSha256: '5'.repeat(64),
      genderId: 'female',
      roleId: 'female-parent',
      roleEvidenceDefinitionSha256: '6'.repeat(64),
      level: 25,
      maturity: { policyId: 'minimum-level', minimumLevel: 20, gmConfirmed: null, eligible: true, evidenceDefinitionSha256: '7'.repeat(64) },
      eggGroupIds: ['monster', 'plant'],
      effectiveKnownMoves: [{ moveId: 'light-screen', evidence: [mutableEvidence] }],
      controlEvidenceDefinitionSha256: '8'.repeat(64),
      capturedAtCampaignMinute: 95,
    }
    const snapshot = createBreedingParentSnapshotV1(input)
    expect(parseAuthoritativeBreedingParentSnapshotV1(snapshot)).toEqual(snapshot)
    expect(snapshot).toMatchObject({
      displayNameAtSnapshot: 'Original Parent',
      familyRootSpeciesId: 'bulbasaur',
      roleId: 'female-parent',
      maturity: { policyId: 'minimum-level', eligible: true },
      effectiveKnownMoves: [{ moveId: 'light-screen' }],
    })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.effectiveKnownMoves[0]!.evidence)).toBe(true)
    input.displayNameAtSnapshot = 'Renamed Later'
    mutableEvidence.sourceId = 'changed-later'
    expect(snapshot.displayNameAtSnapshot).toBe('Original Parent')
    expect(snapshot.effectiveKnownMoves[0]!.evidence[0]!.sourceId).toBe('sheet-move:parent-0:light-screen')
    expect(() => parseAuthoritativeBreedingParentSnapshotV1({ ...snapshot, definitionSha256: '0'.repeat(64) }))
      .toThrowError(expect.objectContaining({ code: 'breeding.lineage.hash-mismatch' }))
  })

  it('creates a complete immutable child origin as an exact settled-Egg projection', () => {
    const egg = hatchedEgg()
    const result = createPokemonBreedingOriginFromHatchedEgg({ originId: ORIGIN_ID, egg })
    expect(result).toMatchObject({
      schemaVersion: 1,
      originId: ORIGIN_ID,
      eggId: egg.eggId,
      sourceEggRevision: 5,
      source: { kind: 'breeding', projectId: PROJECT_ID },
      parents: [{ displayNameAtSnapshot: 'Garden Parent' }, { displayNameAtSnapshot: 'Meadow Parent' }],
      offspring: { speciesId: 'bulbasaur', inheritanceCandidates: [{ moveId: 'light-screen' }] },
      special: { state: 'normal', automaticShiny: false },
      childSheetSlug: CHILD_SLUG,
      hatchOperationId: op(4),
      settlementOperationId: op(6),
      inheritanceLearningRecords: [],
    })
    expect(validatePokemonBreedingOriginAgainstHatchedEgg(result, egg)).toEqual(result)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.parents)).toBe(true)
    expect(Object.isFrozen(result.offspring.inheritanceCandidates)).toBe(true)
    expect(parseAuthoritativePokemonBreedingOriginV1(structuredClone(result))).toEqual(result)
  })

  it('appends one learned candidate with permanent-Move provenance at Level 20', () => {
    const initial = origin()
    const learning = learnedRecord(initial, 20, 1, [4, 5])
    const next = appendBreedingInheritanceLearningRecord(initial, learning)
    expect(next.inheritanceLearningRecords).toHaveLength(1)
    expect(next.inheritanceLearningRecords[0]).toMatchObject({
      checkpointLevel: 20,
      outcome: {
        kind: 'learned',
        moveId: 'light-screen',
        permanentMoveProvenance: {
          kind: 'breeding-inheritance',
          originId: ORIGIN_ID,
          eggId: EGG_ID,
          learningRecordId: learning.learningRecordId,
          checkpointLevel: 20,
          moveId: 'light-screen',
          operationId: learning.operationId,
        },
      },
    })
    expect(next.lineageDefinitionSha256).toBe(initial.lineageDefinitionSha256)
    expect(initial.inheritanceLearningRecords).toEqual([])
  })

  it('records an illegal empty Level-20 slot and retains the candidate for Level 30', () => {
    const initial = origin()
    const candidateMove = initial.offspring.inheritanceCandidates[0]!.moveId
    const illegal = createBreedingInheritanceLearningRecordV1({
      schemaVersion: 1,
      learningRecordId: learningId(2) as any,
      originId: initial.originId,
      eggId: initial.eggId,
      childSheetSlug: initial.childSheetSlug,
      checkpointLevel: 20,
      application: { kind: 'level-up', childSheetRevisionBefore: 2, childSheetRevisionAfter: 3 },
      outcome: {
        kind: 'empty-illegal',
        moveId: candidateMove,
        reasonIds: ['breeding.inheritance.frequency-too-high'],
        prerequisiteEvaluationDefinitionSha256: 'c'.repeat(64),
      },
      recordedAtCampaignMinute: 300,
      operationId: op(22) as any,
    })
    const afterIllegal = appendBreedingInheritanceLearningRecord(initial, illegal)
    const learned = learnedRecord(afterIllegal, 30, 3, [8, 9])
    const afterLearned = appendBreedingInheritanceLearningRecord(afterIllegal, learned)
    expect(afterLearned.inheritanceLearningRecords.map(record => [record.checkpointLevel, record.outcome.kind])).toEqual([
      [20, 'empty-illegal'],
      [30, 'learned'],
    ])
    expect(afterLearned.offspring.inheritanceCandidates[0]!.moveId).toBe('light-screen')
  })

  it('records empty checkpoints only when no unlearned frozen candidate remains', () => {
    const initial = origin(false)
    const empty = createBreedingInheritanceLearningRecordV1({
      schemaVersion: 1,
      learningRecordId: learningId(4) as any,
      originId: initial.originId,
      eggId: initial.eggId,
      childSheetSlug: initial.childSheetSlug,
      checkpointLevel: 20,
      application: { kind: 'level-up', childSheetRevisionBefore: 1, childSheetRevisionAfter: 2 },
      outcome: {
        kind: 'empty-no-candidate',
        candidateSetDefinitionSha256: breedingInheritanceCandidateSetDefinitionSha256(initial.offspring.inheritanceCandidates),
      },
      recordedAtCampaignMinute: 330,
      operationId: op(24) as any,
    })
    expect(appendBreedingInheritanceLearningRecord(initial, empty).inheritanceLearningRecords[0]!.outcome.kind).toBe('empty-no-candidate')
    const candidateOrigin = origin(true)
    const candidateEmpty = { ...empty, originId: candidateOrigin.originId, eggId: candidateOrigin.eggId, childSheetSlug: candidateOrigin.childSheetSlug }
    expect(() => appendBreedingInheritanceLearningRecord(candidateOrigin, candidateEmpty)).toThrow(PokemonBreedingLineageValidationError)

    const level25Egg = hatchedEgg(false, 25)
    const hatchRecord = createBreedingInheritanceLearningRecordV1({
      schemaVersion: 1,
      learningRecordId: learningId(8) as any,
      originId: ORIGIN_ID,
      eggId: level25Egg.eggId,
      childSheetSlug: level25Egg.childSheetSlug!,
      checkpointLevel: 20,
      application: { kind: 'hatch-construction', childSheetRevision: 0 },
      outcome: {
        kind: 'empty-no-candidate',
        candidateSetDefinitionSha256: breedingInheritanceCandidateSetDefinitionSha256(level25Egg.offspring.inheritanceCandidates),
      },
      recordedAtCampaignMinute: level25Egg.updatedAtCampaignMinute,
      operationId: level25Egg.lastOperationId,
    })
    expect(() => createPokemonBreedingOriginFromHatchedEgg({ originId: ORIGIN_ID, egg: level25Egg }))
      .toThrow(PokemonBreedingLineageValidationError)
    expect(createPokemonBreedingOriginFromHatchedEgg({
      originId: ORIGIN_ID,
      egg: level25Egg,
      initialInheritanceLearningRecords: [hatchRecord],
    }).inheritanceLearningRecords[0]!.application.kind).toBe('hatch-construction')
  })

  it('rejects gaps, duplicate learning, stale hashes, fabricated candidates, and enriched legacy lineage', () => {
    const initial = origin()
    const level30 = learnedRecord(initial, 30, 5, [1, 2])
    expect(() => appendBreedingInheritanceLearningRecord(initial, level30))
      .toThrowError(expect.objectContaining({ code: 'breeding.lineage.invalid-successor' }))

    const level20 = learnedRecord(initial, 20, 6, [1, 2])
    const after20 = appendBreedingInheritanceLearningRecord(initial, level20)
    const duplicate = learnedRecord(after20, 30, 7, [4, 5])
    expect(() => appendBreedingInheritanceLearningRecord(after20, duplicate)).toThrow(PokemonBreedingLineageValidationError)

    expect(() => parseAuthoritativePokemonBreedingOriginV1({ ...initial, lineageDefinitionSha256: '0'.repeat(64) }))
      .toThrowError(expect.objectContaining({ code: 'breeding.lineage.hash-mismatch' }))
    expect(() => parsePokemonBreedingOriginV1({ ...initial, inheritedMoves: ['light-screen'] }))
      .toThrowError(expect.objectContaining({ code: 'breeding.lineage.unknown-field' }))
    const unknownCandidate = structuredClone(level20)
    unknownCandidate.outcome.moveId = 'tackle' as any
    unknownCandidate.outcome.permanentMoveProvenance.moveId = 'tackle' as any
    expect(() => appendBreedingInheritanceLearningRecord(initial, unknownCandidate)).toThrow(AuthoritativeBreedingLineageValidationError)
  })

  it('fails closed when any supposedly linked settled-Egg fact drifts', () => {
    const egg = hatchedEgg()
    const result = createPokemonBreedingOriginFromHatchedEgg({ originId: ORIGIN_ID, egg })
    const changedOwnerEgg = { ...egg, ownerTrainerSlug: 'trainer-other' }
    expect(() => validatePokemonBreedingOriginAgainstHatchedEgg(result, changedOwnerEgg))
      .toThrowError(expect.objectContaining({ code: 'breeding.lineage.egg-mismatch' }))
    const changedOrigin = { ...result, childSheetSlug: 'pokemon-other-child' }
    expect(() => validatePokemonBreedingOriginAgainstHatchedEgg(changedOrigin, egg))
      .toThrow(AuthoritativeBreedingLineageValidationError)
  })
})
