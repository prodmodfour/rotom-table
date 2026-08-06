import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import movesJson from '../../data/reference/moves.json'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import eggContractJson from '../../data/breeding-automation/egg-contract.json'
import lineageContractJson from '../../data/breeding-automation/lineage-contract.json'
import inheritanceContractJson from '../../data/breeding-automation/inheritance-learning-contract.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import { parsePokemonEggDocumentV1, type PokemonEggDocumentV1 } from '../../shared/breeding/egg'
import type { PokemonBreedingOriginId } from '../../shared/breeding/ids'
import type { CharacterSheet } from '../../src/types/characterSheet'
import {
  createPokemonBreedingOriginFromHatchedEgg,
  createPokemonEggOffspringBlueprintV1,
} from '../../server/domain/breeding/lineage'
import {
  applyBreedingHatchConstructionInheritanceV1,
  breedingInheritanceLearningOptionIdV1,
  BREEDING_INHERITANCE_LEARNING_POLICY_DEFINITION_SHA256,
  createBreedingHatchConstructionLearningRecordsV1,
  createBreedingInheritanceLearningOptionOffersV1,
  evaluateBreedingInheritancePrerequisiteV1,
  planBreedingInheritanceLearningV1,
} from '../../server/domain/breeding/inheritanceLearning'
import { parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'

const ORIGIN_ID = 'pokemon-breeding-origin:v1:11111111111111111111111111111111' as PokemonBreedingOriginId
const EGG_ID = 'pokemon-egg:v1:22222222222222222222222222222222'
const CHILD_SLUG = 'pokemon-inheritance-child'
const op = (value: number) => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const candidate = (moveId: string) => ({
  moveId,
  sources: [{
    kind: 'source-authority' as const,
    authorityKind: 'gm' as const,
    authorityId: 'reviewed-gm-source',
    evidenceDefinitionSha256: 'a'.repeat(64),
  }],
})
const egg = (moveIds: readonly string[], startingLevel = 1): PokemonEggDocumentV1 => {
  const offspring = createPokemonEggOffspringBlueprintV1({
    schemaVersion: 1,
    speciesId: 'bulbasaur',
    familyRootSpeciesId: 'bulbasaur',
    speciesSpecDefinitionSha256: 'b'.repeat(64),
    nature: { valueId: 'cuddly', resolutionKind: 'rank-choice', rollRecordId: null, optionId: 'option:v1:10000000000000000000000000000000' as any, choiceEvidenceId: 'nature-choice' },
    ability: { valueId: 'overgrow', resolutionKind: 'rank-choice', rollRecordId: null, optionId: 'option:v1:20000000000000000000000000000000' as any, choiceEvidenceId: 'ability-choice' },
    gender: { valueId: 'female', resolutionKind: 'rank-choice', rollRecordId: null, optionId: 'option:v1:30000000000000000000000000000000' as any, choiceEvidenceId: 'gender-choice' },
    inheritanceCandidates: moveIds.map(candidate) as any,
    startingLevel,
    babyTemplate: { applied: false, choiceOptionId: null, choiceEvidenceId: null, effects: null },
  })
  return parsePokemonEggDocumentV1({
    schemaVersion: 1,
    eggId: EGG_ID,
    revision: 5,
    status: 'hatched',
    ownerTrainerSlug: 'trainer-owner',
    source: { kind: 'gm', reasonId: 'breeding.egg-source.reviewed', evidenceDefinitionSha256: 'e'.repeat(64) },
    ruleset: { rulesetId: rulesetJson.rulesetId, definitionSha256: rulesetJson.definitionSha256 },
    definitionHashes: [eggContractJson.definitionSha256, lineageContractJson.definitionSha256, rulesetJson.definitionSha256].sort(),
    parents: [],
    breeder: null,
    offspring,
    incubation: {
      averageCampaignMinutes: 1,
      targetCampaignMinutes: 1,
      accumulatedCampaignMinutes: 1,
      variationPolicyId: 'fixed-average',
      durationResultDefinitionSha256: 'c'.repeat(64),
      lastAppliedClockRevision: 1,
      lastAppliedClockMinute: 10,
      readyAtCampaignMinute: 10,
      readinessKind: 'incubation-complete',
      readyOperationId: op(1),
      paused: false,
      pauseReasonId: null,
      pauseOperationId: null,
    },
    special: { state: 'normal', rollRecordId: 'breeding-roll:v1:11111111111111111111111111111111', rollTotal: 50, triggerIds: [], adjudicationId: null, outcomeId: null, automaticShiny: false },
    hatchOperationId: op(2),
    childSheetSlug: CHILD_SLUG,
    terminal: null,
    createdAtCampaignMinute: 1,
    updatedAtCampaignMinute: 11,
    statusChangedAtCampaignMinute: 11,
    lastOperationId: op(3),
  })
}
const origin = (moves: readonly string[], startingLevel = 1) => createPokemonBreedingOriginFromHatchedEgg({ originId: ORIGIN_ID, egg: egg(moves, startingLevel) })
const sheet = (level: number, names: readonly string[] = ['Tackle']): CharacterSheet => ({
  slug: CHILD_SLUG,
  nickname: 'Child',
  species: 'Bulbasaur',
  level,
  movelist: names.map(name => ({ name })),
  inheritedMoves: {},
  eggMoves: [],
})
const command = (input: { operation: number, revision: number, levels: readonly number[], optionIds: readonly string[] }) => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: op(input.operation),
  commandKind: 'record-inheritance-learning',
  actor: { profileId: 'profile-owner', selectedTrainerSlug: 'trainer-owner' },
  ruleset: { rulesetId: rulesetJson.rulesetId, definitionSha256: rulesetJson.definitionSha256 },
  scopes: [{ kind: 'pokemon-sheet', sheetSlug: CHILD_SLUG, expectedRevision: input.revision, fields: ['lineage', 'moves'] }],
  payload: { originId: ORIGIN_ID, eggId: EGG_ID, childSheetSlug: CHILD_SLUG, checkpointLevels: input.levels, selectedOptionIds: [...input.optionIds].sort() },
})
const selectedOffer = (offers: ReturnType<typeof createBreedingInheritanceLearningOptionOffersV1>, optionId: string) => offers.find(offer => offer.options.some(option => option.optionId === optionId))

const levelPlan = (input: { moveId: string, level?: number, slotMode?: 'auto' | 'replace-0' | 'replace-1' | 'replace-2' | 'replace-3' | 'replace-4' | 'replace-5', names?: readonly string[] }) => {
  const level = input.level ?? 20
  const slotMode = input.slotMode ?? 'auto'
  const initial = origin([input.moveId])
  const optionId = breedingInheritanceLearningOptionIdV1({ operationId: op(20), checkpointLevel: level, moveId: input.moveId, slotMode })
  const learningCommand = command({ operation: 20, revision: 4, levels: [level], optionIds: [optionId] })
  const childSheet = { slug: CHILD_SLUG, revision: 4, document: sheet(level, input.names) }
  const offers = createBreedingInheritanceLearningOptionOffersV1({
    command: learningCommand,
    origin: initial,
    learningRecords: [],
    childSheet,
    issuedAtCampaignMinute: 20,
    expiresAtCampaignMinute: 30,
  })
  const offer = selectedOffer(offers, optionId)
  return planBreedingInheritanceLearningV1({
    command: learningCommand,
    origin: initial,
    learningRecords: [],
    childSheet,
    offers: offer ? [offer] : [],
    recordedAtCampaignMinute: 21,
  })
}

describe('Breeding inheritance learning', () => {
  it('binds the reviewed BR-068 contract to the strict runtime and wire-free authority boundary', () => {
    expect(createHash('sha256').update(stableJsonStringify(inheritanceContractJson.definition)).digest('hex')).toBe(inheritanceContractJson.definitionSha256)
    expect(inheritanceContractJson.definition.bindings.runtimePolicyDefinitionSha256).toBe(BREEDING_INHERITANCE_LEARNING_POLICY_DEFINITION_SHA256)
    expect(inheritanceContractJson.definition.input.clientAuthority).toContain('no canonical Move')
    expect(inheritanceContractJson.definition.transaction.boundary).toContain('caller-owned')
  })

  it('applies the reviewed errata prerequisite bands from app-owned Moves', () => {
    expect(evaluateBreedingInheritancePrerequisiteV1({ moveId: 'tackle', level: 19 })).toMatchObject({ legal: true, maximumFrequency: 'EOT', maximumDamageBase: 7 })
    expect(evaluateBreedingInheritancePrerequisiteV1({ moveId: 'light-screen', level: 19 })).toMatchObject({ legal: false, reasonIds: ['breeding.inheritance.frequency-too-high'] })
    expect(evaluateBreedingInheritancePrerequisiteV1({ moveId: 'hyper-beam', level: 20 })).toMatchObject({
      legal: false,
      reasonIds: ['breeding.inheritance.frequency-too-high', 'breeding.inheritance.damage-base-too-high'],
    })
    expect(evaluateBreedingInheritancePrerequisiteV1({ moveId: 'hyper-beam', level: 30 })).toMatchObject({ legal: true, maximumFrequency: null, maximumDamageBase: null })
    expect(evaluateBreedingInheritancePrerequisiteV1({ moveId: 'dragon-rage', level: 20 })).toMatchObject({ legal: false, reasonIds: ['breeding.inheritance.move-data-unavailable'] })
    expect(evaluateBreedingInheritancePrerequisiteV1({ moveId: 'dragon-rage', level: 30 })).toMatchObject({ legal: true })
    expect(evaluateBreedingInheritancePrerequisiteV1({ moveId: 'not-a-current-move', level: 20 })).toMatchObject({
      legal: false,
      reasonIds: ['breeding.inheritance.move-data-unavailable'],
      moveRecordDefinitionSha256: null,
    })
  })

  it('learns one frozen candidate into an open slot with exact permanent provenance', () => {
    const plan = levelPlan({ moveId: 'light-screen' })
    expect(plan.records).toHaveLength(1)
    expect(plan.records[0]).toMatchObject({
      checkpointLevel: 20,
      application: { kind: 'level-up', childSheetRevisionBefore: 4, childSheetRevisionAfter: 5 },
      outcome: {
        kind: 'learned',
        moveId: 'light-screen',
        permanentMoveProvenance: { kind: 'breeding-inheritance', originId: ORIGIN_ID, eggId: EGG_ID, checkpointLevel: 20 },
      },
    })
    const learned = plan.nextSheetDocument.movelist!.find(move => move.name === 'Light Screen')!
    expect(learned.permanentMoveSource).toEqual((plan.records[0]!.outcome as any).permanentMoveProvenance)
    expect(plan.nextSheetDocument.inheritedMoves).toEqual({ 20: 'Light Screen' })
    expect(plan.consumedOffers).toHaveLength(1)
    expect(plan.consumedOffers[0]).toMatchObject({ status: 'consumed', revision: 1 })
  })

  it('records an illegal checkpoint without consuming the candidate or mutating a move slot', () => {
    const plan = levelPlan({ moveId: 'hyper-beam' })
    expect(plan.records[0]!.outcome).toMatchObject({
      kind: 'empty-illegal',
      moveId: 'hyper-beam',
      reasonIds: ['breeding.inheritance.frequency-too-high', 'breeding.inheritance.damage-base-too-high'],
    })
    expect(plan.nextSheetDocument.movelist).toEqual([{ name: 'Tackle' }])
    expect(plan.nextSheetDocument.inheritedRemaining).toBe(1)
    expect(plan.nextOrigin.offspring.inheritanceCandidates).toHaveLength(1)
  })

  it('requires and applies a bounded replacement when all six move slots are occupied', () => {
    const names = ['Tackle', 'Growl', 'Vine Whip', 'Poison Powder', 'Sleep Powder', 'Take Down']
    expect(() => levelPlan({ moveId: 'light-screen', names })).toThrowError(expect.objectContaining({ code: 'breeding.inheritance-learning.invalid-choice' }))
    const replaced = levelPlan({ moveId: 'light-screen', names, slotMode: 'replace-2' })
    expect(replaced.nextSheetDocument.movelist).toHaveLength(6)
    expect(replaced.nextSheetDocument.movelist![2]).toMatchObject({ name: 'Light Screen', permanentMoveSource: { kind: 'breeding-inheritance' } })
    expect(replaced.nextSheetDocument.movelist!.some(move => move.name === 'Vine Whip')).toBe(false)
  })

  it('reclassifies an inherited TM/Tutor Move as natural and frees its separate applied slot', () => {
    const initial = origin(['light-screen'])
    const optionId = breedingInheritanceLearningOptionIdV1({ operationId: op(45), checkpointLevel: 20, moveId: 'light-screen', slotMode: 'auto' })
    const learningCommand = command({ operation: 45, revision: 6, levels: [20], optionIds: [optionId] })
    const childSheet = {
      slug: CHILD_SLUG,
      revision: 6,
      document: {
        ...sheet(20, ['Tackle', 'Growl', 'Vine Whip', 'Poison Powder', 'Sleep Powder']),
        appliedMoves: [{ name: 'Light Screen', source: 'tm' as const }],
      },
    }
    const offers = createBreedingInheritanceLearningOptionOffersV1({ command: learningCommand, origin: initial, learningRecords: [], childSheet, issuedAtCampaignMinute: 20, expiresAtCampaignMinute: 30 })
    const plan = planBreedingInheritanceLearningV1({ command: learningCommand, origin: initial, learningRecords: [], childSheet, offers: [selectedOffer(offers, optionId)!], recordedAtCampaignMinute: 20 })
    expect(plan.nextSheetDocument.movelist).toHaveLength(6)
    expect(plan.nextSheetDocument.movelist).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Light Screen', permanentMoveSource: expect.objectContaining({ kind: 'breeding-inheritance' }) })]))
    expect(plan.nextSheetDocument.appliedMoves).toEqual([])
  })

  it('processes skipped contiguous checkpoints in order and retains an illegal candidate until it becomes legal', () => {
    const initial = origin(['hyper-beam'])
    const partial = command({ operation: 49, revision: 8, levels: [20], optionIds: [] })
    expect(() => createBreedingInheritanceLearningOptionOffersV1({ command: partial, origin: initial, learningRecords: [], childSheet: { slug: CHILD_SLUG, revision: 8, document: sheet(30) }, issuedAtCampaignMinute: 20, expiresAtCampaignMinute: 40 }))
      .toThrowError(expect.objectContaining({ code: 'breeding.inheritance-learning.checkpoint-unavailable' }))
    const option20 = breedingInheritanceLearningOptionIdV1({ operationId: op(50), checkpointLevel: 20, moveId: 'hyper-beam', slotMode: 'auto' })
    const option30 = breedingInheritanceLearningOptionIdV1({ operationId: op(50), checkpointLevel: 30, moveId: 'hyper-beam', slotMode: 'auto' })
    const learningCommand = command({ operation: 50, revision: 8, levels: [20, 30], optionIds: [option20, option30] })
    const childSheet = { slug: CHILD_SLUG, revision: 8, document: sheet(30) }
    const offers = createBreedingInheritanceLearningOptionOffersV1({ command: learningCommand, origin: initial, learningRecords: [], childSheet, issuedAtCampaignMinute: 20, expiresAtCampaignMinute: 40 })
    const selected = [selectedOffer(offers, option20)!, selectedOffer(offers, option30)!]
    expect(selected.every(Boolean)).toBe(true)
    const plan = planBreedingInheritanceLearningV1({ command: learningCommand, origin: initial, learningRecords: [], childSheet, offers: selected, recordedAtCampaignMinute: 30 })
    expect(plan.records.map(record => [record.checkpointLevel, record.outcome.kind])).toEqual([[20, 'empty-illegal'], [30, 'learned']])
    expect(plan.nextSheetDocument.movelist).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Hyper Beam', permanentMoveSource: expect.objectContaining({ checkpointLevel: 30 }) })]))
    expect(plan.consumedOffers).toHaveLength(2)
    expect(plan.childSheetRevisionAfter).toBe(9)
  })

  it('records reached empty checkpoints without offers after every frozen candidate was learned', () => {
    const initial = origin([])
    const learningCommand = command({ operation: 60, revision: 3, levels: [20, 30], optionIds: [] })
    const childSheet = { slug: CHILD_SLUG, revision: 3, document: sheet(30) }
    expect(createBreedingInheritanceLearningOptionOffersV1({ command: learningCommand, origin: initial, learningRecords: [], childSheet, issuedAtCampaignMinute: 20, expiresAtCampaignMinute: 40 })).toEqual([])
    const plan = planBreedingInheritanceLearningV1({ command: learningCommand, origin: initial, learningRecords: [], childSheet, offers: [], recordedAtCampaignMinute: 30 })
    expect(plan.records.map(record => [record.checkpointLevel, record.outcome.kind])).toEqual([[20, 'empty-no-candidate'], [30, 'empty-no-candidate']])
    expect(plan.nextSheetDocument.inheritedRemaining).toBe(0)
  })

  it('creates every starting-Level hatch checkpoint and applies legal candidates before revision zero', () => {
    const terminal = egg(['hyper-beam'], 30)
    const sourceEgg = parsePokemonEggDocumentV1({ ...terminal, status: 'hatching', childSheetSlug: null, lastOperationId: op(2) })
    const completeCommand = parseBreedingOperationCommandV1({
      schemaVersion: 1,
      operationId: op(30),
      commandKind: 'complete-hatch',
      actor: { profileId: 'gm-profile', selectedTrainerSlug: null },
      ruleset: sourceEgg.ruleset,
      scopes: [
        { kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: 5 },
        { kind: 'trainer-sheet', sheetSlug: 'trainer-owner', expectedRevision: 1, fields: ['experience', 'roster'] },
        { kind: 'pokemon-sheet-allocation', namespace: 'pokemon' },
        { kind: 'species-acquisition', trainerSheetSlug: 'trainer-owner', speciesId: 'bulbasaur' },
      ],
      payload: { eggId: EGG_ID, originId: ORIGIN_ID, destination: { kind: 'box', trainerSheetSlug: 'trainer-owner' } },
    })
    const document = applyBreedingHatchConstructionInheritanceV1({ egg: sourceEgg, command: completeCommand, document: sheet(30) })
    const settledEgg = parsePokemonEggDocumentV1({ ...sourceEgg, revision: 6, status: 'hatched', childSheetSlug: CHILD_SLUG, lastOperationId: op(30) })
    const records = createBreedingHatchConstructionLearningRecordsV1({ egg: settledEgg, command: completeCommand, childSheetSlug: CHILD_SLUG, recordedAtCampaignMinute: 11 })
    expect(records.map(record => [record.checkpointLevel, record.outcome.kind])).toEqual([[20, 'empty-illegal'], [30, 'learned']])
    expect(records.every(record => record.application.kind === 'hatch-construction')).toBe(true)
    expect(document.movelist!.some(move => move.name === (movesJson as any)['Hyper Beam'].name && move.permanentMoveSource?.kind === 'breeding-inheritance')).toBe(true)
    const settledOrigin = createPokemonBreedingOriginFromHatchedEgg({ originId: ORIGIN_ID, egg: settledEgg, initialInheritanceLearningRecords: records })
    expect(settledOrigin.inheritanceLearningRecords).toHaveLength(2)
  })

  it('rejects accessor-backed move slots without invoking their getter', () => {
    const initial = origin(['light-screen'])
    const optionId = breedingInheritanceLearningOptionIdV1({ operationId: op(70), checkpointLevel: 20, moveId: 'light-screen', slotMode: 'auto' })
    const learningCommand = command({ operation: 70, revision: 2, levels: [20], optionIds: [optionId] })
    const getter = vi.fn(() => 'Tackle')
    const row: Record<string, unknown> = {}
    Object.defineProperty(row, 'name', { enumerable: true, get: getter })
    const childSheet = { slug: CHILD_SLUG, revision: 2, document: { ...sheet(20), movelist: [row] } }
    expect(() => createBreedingInheritanceLearningOptionOffersV1({ command: learningCommand, origin: initial, learningRecords: [], childSheet, issuedAtCampaignMinute: 20, expiresAtCampaignMinute: 30 })).toThrowError(expect.objectContaining({ code: 'breeding.inheritance-learning.move-list-invalid' }))
    expect(getter).not.toHaveBeenCalled()
  })

  it('rejects altered, expired, extraneous, and wrong-checkpoint option authority', () => {
    const initial = origin(['light-screen'])
    const optionId = breedingInheritanceLearningOptionIdV1({ operationId: op(40), checkpointLevel: 20, moveId: 'light-screen', slotMode: 'auto' })
    const learningCommand = command({ operation: 40, revision: 2, levels: [20], optionIds: [optionId] })
    const childSheet = { slug: CHILD_SLUG, revision: 2, document: sheet(20) }
    const offers = createBreedingInheritanceLearningOptionOffersV1({ command: learningCommand, origin: initial, learningRecords: [], childSheet, issuedAtCampaignMinute: 20, expiresAtCampaignMinute: 21 })
    const offer = selectedOffer(offers, optionId)
    expect(() => planBreedingInheritanceLearningV1({ command: learningCommand, origin: initial, learningRecords: [], childSheet, offers: [offer], recordedAtCampaignMinute: 21 }))
      .toThrowError(expect.objectContaining({ code: 'breeding.inheritance-learning.invalid-choice' }))
    expect(() => planBreedingInheritanceLearningV1({ command: learningCommand, origin: initial, learningRecords: [], childSheet, offers: [{ ...offer, chooserProfileId: 'forged' }], recordedAtCampaignMinute: 20 }))
      .toThrow()
  })
})
