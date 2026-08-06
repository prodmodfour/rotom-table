import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import hatchDurationPolicyJson from '../../data/breeding-automation/hatch-duration-policy.json'
import productionSnapshotJson from '../fixtures/breeding/production-snapshot-v1.json'
import choiceProductionSnapshotJson from '../fixtures/breeding/production-snapshot-ability-choice-v1.json'
import inheritanceProductionSnapshotJson from '../fixtures/breeding/production-snapshot-inheritance-v1.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import type { BreedingRollRecordV1 } from '../../shared/breeding/ledgers'
import { parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import { parseBreedingOffspringResolutionRecordV1 } from '../../shared/breeding/offspringProduction'
import { createBreedingOptionOfferRecordV1, createBreedingRollRecordFromInjectedValues } from '../../server/domain/breeding/ledgers'
import { resolveBreedingCampaignOptionSnapshot } from '../../server/domain/breeding/campaignOptions'
import { createBreedingFrozenCampaignOptionSnapshotV1 } from '../../server/domain/breeding/productionSnapshots'
import { createBreedingOperationCommandHash } from '../../server/domain/breeding/operations'
import {
  BreedingOffspringProductionAuthorityError,
  breedingOffspringRollSourceDefinitionHashes,
  parseAuthoritativeBreedingOffspringResolutionRecordV1,
  planBreedingOffspringResolutionV1,
  projectBreedingOffspringResolutionV1,
  BREEDING_BABY_TEMPLATE_GM_AUTHORITY_EVIDENCE_ID,
  breedingBabyTemplateOfferOptionIdV1,
  breedingBabyTemplateOptionDefinitionSha256V1,
  breedingCampaignOptionsFromProductionSnapshotV1,
  createBreedingBabyTemplateOptionOfferV1,
} from '../../server/domain/breeding/offspringProduction'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteBreedingOperationRepository } from '../../server/storage/breedingOperationRepository'
import { createSqliteBreedingRollRepository, BreedingRollRepositoryTransactionError } from '../../server/storage/breedingRollRepository'
import { createSqliteBreedingOptionOfferRepository, BreedingOptionOfferRepositoryTransactionError } from '../../server/storage/breedingOptionOfferRepository'
import { BreedingRepositoryIdentityCollisionError } from '../../server/storage/breedingRepositorySupport'

const databases: RotomDatabase[] = []
afterEach(() => { while (databases.length > 0) databases.pop()?.close() })
const PROJECT_ID = 'breeding-project:v1:33333333333333333333333333333333'
const EGG_ID = 'pokemon-egg:v1:44444444444444444444444444444444'
const OPERATION_ID = 'breeding-operation:v1:00000000000000000000000000000014'
const ruleset = rulesetJson as { readonly rulesetId: string, readonly definitionSha256: string }
const snapshot = productionSnapshotJson
const command = parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: OPERATION_ID,
  commandKind: 'produce-egg',
  actor: { profileId: 'profile_owner_0001', selectedTrainerSlug: 'trainer-owner' },
  ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 },
  scopes: [
    { kind: 'breeding-project', projectId: PROJECT_ID, expectedRevision: 2 },
    { kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: null },
  ],
  payload: {
    projectId: PROJECT_ID,
    eggId: EGG_ID,
    resolutions: {
      selectedOptionIds: [],
      requestedRollKinds: ['offspring-family', 'nature', 'ability', 'gender'],
    },
  },
})
const rollId = (value: number): `breeding-roll:v1:${string}` => `breeding-roll:v1:${value.toString(16).padStart(32, '0')}`
const makeRoll = (input: {
  readonly ordinal: number
  readonly purpose: BreedingRollRecordV1['purpose']
  readonly formula: BreedingRollRecordV1['formula']
  readonly dieCount: number
  readonly dieSides: number
  readonly ordered: boolean
  readonly values: readonly number[]
  readonly generatedAtCampaignMinute?: number
  readonly sourceSnapshot?: unknown
  readonly modifier?: number
  readonly commandValue?: ReturnType<typeof parseBreedingOperationCommandV1>
}): BreedingRollRecordV1 => createBreedingRollRecordFromInjectedValues({
  schemaVersion: 1,
  rollRecordId: rollId(input.ordinal + 1) as never,
  operationId: (input.commandValue ?? command).operationId,
  commandSha256: createBreedingOperationCommandHash(input.commandValue ?? command),
  operationRollOrdinal: input.ordinal,
  purpose: input.purpose,
  target: { kind: 'breeding-project', projectId: PROJECT_ID as never, revision: 2 },
  formula: input.formula,
  dieCount: input.dieCount,
  dieSides: input.dieSides,
  ordered: input.ordered,
  modifier: input.modifier ?? 0,
  values: input.values,
  generatorId: 'server-rng-v1',
  sourceDefinitionHashes: breedingOffspringRollSourceDefinitionHashes(input.sourceSnapshot ?? snapshot),
  generatedAtCampaignMinute: input.generatedAtCampaignMinute ?? 600,
})
const rolls = (): readonly BreedingRollRecordV1[] => [
  makeRoll({ ordinal: 0, purpose: 'offspring-family-d20', formula: '1d20', dieCount: 1, dieSides: 20, ordered: false, values: [5] }),
  makeRoll({ ordinal: 1, purpose: 'nature-ordered-2d6', formula: 'ordered-2d6', dieCount: 2, dieSides: 6, ordered: true, values: [1, 1] }),
  makeRoll({ ordinal: 2, purpose: 'ability-uniform-index', formula: 'uniform-index', dieCount: 1, dieSides: 2, ordered: false, values: [1] }),
  makeRoll({ ordinal: 3, purpose: 'gender-d100', formula: '1d100', dieCount: 1, dieSides: 100, ordered: false, values: [13] }),
]
const inheritanceSnapshot = inheritanceProductionSnapshotJson
const inheritanceRolls = (): readonly BreedingRollRecordV1[] => [
  makeRoll({ ordinal: 0, purpose: 'offspring-family-d20', formula: '1d20', dieCount: 1, dieSides: 20, ordered: false, values: [5], sourceSnapshot: inheritanceSnapshot }),
  makeRoll({ ordinal: 1, purpose: 'nature-ordered-2d6', formula: 'ordered-2d6', dieCount: 2, dieSides: 6, ordered: true, values: [1, 1], sourceSnapshot: inheritanceSnapshot }),
  makeRoll({ ordinal: 2, purpose: 'ability-uniform-index', formula: 'uniform-index', dieCount: 1, dieSides: 2, ordered: false, values: [1], sourceSnapshot: inheritanceSnapshot }),
  makeRoll({ ordinal: 3, purpose: 'gender-d100', formula: '1d100', dieCount: 1, dieSides: 100, ordered: false, values: [13], sourceSnapshot: inheritanceSnapshot }),
]
const plan = (overrides: Partial<Parameters<typeof planBreedingOffspringResolutionV1>[0]> = {}) => planBreedingOffspringResolutionV1({
  productionSnapshot: snapshot,
  command,
  rolls: rolls(),
  offers: [],
  roleOverride: null,
  roleOverrideEvidenceDefinitionSha256: null,
  ...overrides,
})
const clone = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value)) as Value
const CHOICE_OPTION_ID = 'option:v1:00000000000000000000000000000001'
const CHOICE_OFFER_ID = 'breeding-offer:v1:00000000000000000000000000000001'
const ISSUANCE_OPERATION_ID = 'breeding-operation:v1:0000000000000000000000000000001e'
const choiceSnapshot = choiceProductionSnapshotJson
const choiceCommand = parseBreedingOperationCommandV1({
  ...command,
  payload: {
    projectId: PROJECT_ID,
    eggId: EGG_ID,
    resolutions: {
      selectedOptionIds: [CHOICE_OPTION_ID],
      requestedRollKinds: ['offspring-family', 'nature', 'gender'],
    },
  },
})
const activeAbilityOffer = (overrides: { readonly expiresAtCampaignMinute?: number | null, readonly minimumPokemonEducationRank?: 'Expert'|'Master', readonly chooserProfileId?: string } = {}) => createBreedingOptionOfferRecordV1({
  schemaVersion: 1,
  offerId: CHOICE_OFFER_ID as never,
  choiceKind: 'ability',
  target: { kind: 'breeding-project', projectId: PROJECT_ID as never, revision: 2 },
  chooserProfileId: overrides.chooserProfileId ?? 'profile_owner_0001',
  minimumPokemonEducationRank: overrides.minimumPokemonEducationRank ?? 'Expert',
  options: [{
    optionId: CHOICE_OPTION_ID as never,
    kind: 'ability',
    canonicalValueId: 'overgrow',
    valueDefinitionSha256: choiceSnapshot.parents[0]!.speciesSpecDefinitionSha256,
    authorityEvidenceIds: ['breeding-offer-authority:ability:overgrow'],
  }],
  issuedOperationId: ISSUANCE_OPERATION_ID as never,
  issuedCommandSha256: 'e'.repeat(64),
  issuedAtCampaignMinute: 590,
  expiresAtCampaignMinute: overrides.expiresAtCampaignMinute === undefined ? 650 : overrides.expiresAtCampaignMinute,
})
const choiceRoll = (input: { readonly ordinal: number, readonly purpose: BreedingRollRecordV1['purpose'], readonly formula: BreedingRollRecordV1['formula'], readonly dieCount: number, readonly dieSides: number, readonly ordered: boolean, readonly values: readonly number[] }): BreedingRollRecordV1 => createBreedingRollRecordFromInjectedValues({
  schemaVersion: 1,
  rollRecordId: rollId(input.ordinal + 10) as never,
  operationId: choiceCommand.operationId,
  commandSha256: createBreedingOperationCommandHash(choiceCommand),
  operationRollOrdinal: input.ordinal,
  purpose: input.purpose,
  target: { kind: 'breeding-project', projectId: PROJECT_ID as never, revision: 2 },
  formula: input.formula,
  dieCount: input.dieCount,
  dieSides: input.dieSides,
  ordered: input.ordered,
  modifier: 0,
  values: input.values,
  generatorId: 'server-rng-v1',
  sourceDefinitionHashes: breedingOffspringRollSourceDefinitionHashes(choiceSnapshot),
  generatedAtCampaignMinute: 600,
})
const choiceRolls = (): readonly BreedingRollRecordV1[] => [
  choiceRoll({ ordinal: 0, purpose: 'offspring-family-d20', formula: '1d20', dieCount: 1, dieSides: 20, ordered: false, values: [5] }),
  choiceRoll({ ordinal: 1, purpose: 'nature-ordered-2d6', formula: 'ordered-2d6', dieCount: 2, dieSides: 6, ordered: true, values: [2, 2] }),
  choiceRoll({ ordinal: 2, purpose: 'gender-d100', formula: '1d100', dieCount: 1, dieSides: 100, ordered: false, values: [5] }),
]
const choicePlan = (offer = activeAbilityOffer()) => planBreedingOffspringResolutionV1({
  productionSnapshot: choiceSnapshot,
  command: choiceCommand,
  rolls: choiceRolls(),
  offers: [offer],
  roleOverride: null,
  roleOverrideEvidenceDefinitionSha256: null,
})
const sha = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const snapshotWithCampaignOptions = (
  source: typeof productionSnapshotJson,
  commandValue: ReturnType<typeof parseBreedingOperationCommandV1>,
  optionOverrides: Record<string, unknown>,
): typeof productionSnapshotJson => {
  const existingOptions = Object.fromEntries(source.campaignOptionSnapshot.entries.map(entry => [entry.optionId, entry.value]))
  const campaignOptionSnapshot = createBreedingFrozenCampaignOptionSnapshotV1(resolveBreedingCampaignOptionSnapshot({ ...existingOptions, ...optionOverrides }))
  const definition = clone(source) as any
  delete definition.acceptedDefinitionHashes
  delete definition.definitionSha256
  definition.commandSha256 = createBreedingOperationCommandHash(commandValue)
  definition.campaignOptionSnapshot = campaignOptionSnapshot
  const hashes = [
    definition.projectDefinitionSha256,
    definition.checkDefinitionSha256,
    definition.breeder.definitionSha256,
    definition.providerSnapshot.definitionSha256,
    definition.referenceSnapshot.definitionSha256,
    definition.referenceSnapshot.rulesetDefinitionSha256,
    definition.referenceSnapshot.compiledRegistryDefinitionSha256,
    campaignOptionSnapshot.definitionSha256,
    campaignOptionSnapshot.sourceSnapshotDefinitionSha256,
    ...definition.parents.flatMap((parent: any) => [parent.definitionSha256, parent.speciesSpecDefinitionSha256, parent.effectiveMoveSnapshotDefinitionSha256]),
  ].filter((value: string, index: number, values: string[]) => values.indexOf(value) === index).sort()
  const withHashes = { ...definition, acceptedDefinitionHashes: hashes }
  return { ...withHashes, definitionSha256: sha(withHashes) }
}

describe('durable offspring production resolution', () => {
  it('freezes server-rolled family, Nature, Ability, Gender, inheritance, and complete source evidence', () => {
    expect(createBreedingOperationCommandHash(command)).toBe(snapshot.commandSha256)
    const result = plan()
    expect(result.consumedOffers).toEqual([])
    expect(result.record).toMatchObject({
      schemaVersion: 1,
      projectId: PROJECT_ID,
      projectRevision: 2,
      eggId: EGG_ID,
      operationId: OPERATION_ID,
      resolvedAtCampaignMinute: 600,
      family: {
        selectionKind: 'core-d20',
        selectedParentIndex: 0,
        selectedRoleId: 'female-parent',
        offspringSpeciesId: 'bulbasaur',
      },
      blueprint: {
        speciesId: 'bulbasaur',
        familyRootSpeciesId: 'bulbasaur',
        nature: { valueId: 'cuddly', resolutionKind: 'random', rollRecordId: rollId(2) },
        ability: { valueId: 'chlorophyll', resolutionKind: 'random', rollRecordId: rollId(3) },
        gender: { valueId: 'male', resolutionKind: 'random', rollRecordId: rollId(4) },
        inheritanceCandidates: [],
        startingLevel: 1,
        babyTemplate: { applied: false },
      },
    })
    expect(result.record.rollRecordIds).toEqual(rolls().map(value => value.rollRecordId).sort())
    expect(result.record.sourceEvidenceDefinitionHashes).toContain(snapshot.definitionSha256)
    expect(parseAuthoritativeBreedingOffspringResolutionRecordV1(result.record)).toEqual(result.record)
    expect(Object.isFrozen(result.record)).toBe(true)
    expect(Object.isFrozen(result.record.blueprint)).toBe(true)
  })

  it('freezes one server-issued optional Baby Template choice and rejects editable-choice substitutes', () => {
    const babyOptionId = breedingBabyTemplateOfferOptionIdV1(PROJECT_ID as never, 2, ISSUANCE_OPERATION_ID as never, 'baby-template:apply:size-percent:65')
    const babyCommand = parseBreedingOperationCommandV1({
      ...command,
      payload: { ...command.payload, resolutions: {
        selectedOptionIds: [babyOptionId],
        requestedRollKinds: ['offspring-family', 'nature', 'ability', 'gender'],
      } },
    })
    const babySnapshot = snapshotWithCampaignOptions(snapshot, babyCommand, {
      'breeding.baby-template-policy': 'per-egg-gm-choice',
      'breeding.baby-template-stat-penalty': 4,
    })
    const issuanceInput = {
      projectId: PROJECT_ID,
      projectRevision: 2,
      chooserProfileId: 'profile_owner_0001',
      campaignOptionSnapshot: breedingCampaignOptionsFromProductionSnapshotV1(babySnapshot),
      adultSizePercentages: [65],
      issuedOperationId: ISSUANCE_OPERATION_ID,
      issuedCommandSha256: 'e'.repeat(64),
      issuedAtCampaignMinute: 590,
      expiresAtCampaignMinute: 650,
    }
    const offer = createBreedingBabyTemplateOptionOfferV1(issuanceInput)
    expect(offer.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonicalValueId: 'baby-template:decline', authorityEvidenceIds: [BREEDING_BABY_TEMPLATE_GM_AUTHORITY_EVIDENCE_ID] }),
      expect.objectContaining({ optionId: babyOptionId, canonicalValueId: 'baby-template:apply:size-percent:65' }),
    ]))
    expect(() => createBreedingBabyTemplateOptionOfferV1({ ...issuanceInput,
      campaignOptionSnapshot: resolveBreedingCampaignOptionSnapshot() })).toThrowError(expect.objectContaining({ code: 'breeding.offspring-production.unavailable' }))
    expect(() => createBreedingBabyTemplateOptionOfferV1({ ...issuanceInput,
      adultSizePercentages: [65, 65] })).toThrowError(expect.objectContaining({ code: 'breeding.offspring-production.invalid-choice' }))
    const getter = vi.fn(() => [65])
    const accessorInput = { ...issuanceInput }
    Object.defineProperty(accessorInput, 'adultSizePercentages', { enumerable: true, get: getter })
    expect(() => createBreedingBabyTemplateOptionOfferV1(accessorInput)).toThrowError(expect.objectContaining({ code: 'breeding.offspring-production.invalid-choice' }))
    expect(getter).not.toHaveBeenCalled()
    const babyRolls = rolls().map((roll, ordinal) => makeRoll({
      ordinal,
      purpose: roll.purpose,
      formula: roll.formula,
      dieCount: roll.dieCount,
      dieSides: roll.dieSides,
      ordered: roll.ordered,
      values: roll.values,
      sourceSnapshot: babySnapshot,
      commandValue: babyCommand,
    }))
    const result = planBreedingOffspringResolutionV1({ productionSnapshot: babySnapshot, command: babyCommand,
      rolls: babyRolls, offers: [offer], roleOverride: null, roleOverrideEvidenceDefinitionSha256: null })
    expect(result.record.blueprint.babyTemplate).toMatchObject({ applied: true, choiceOptionId: babyOptionId,
      choiceEvidenceId: BREEDING_BABY_TEMPLATE_GM_AUTHORITY_EVIDENCE_ID,
      effects: { baseStatPenaltyEach: 4, sizePercentOfAdult: 65, recoveryStepCount: 4 } })
    const forged = createBreedingOptionOfferRecordV1({
      schemaVersion: 1,
      offerId: 'breeding-offer:v1:99999999999999999999999999999992' as never,
      choiceKind: 'baby-template',
      target: { kind: 'breeding-project', projectId: PROJECT_ID as never, revision: 2 },
      chooserProfileId: 'profile_owner_0001',
      minimumPokemonEducationRank: null,
      options: [{ optionId: 'option:v1:99999999999999999999999999999992' as never,
        kind: 'baby-template', canonicalValueId: 'baby-template:apply:size-percent:65',
        valueDefinitionSha256: breedingBabyTemplateOptionDefinitionSha256V1({ canonicalValueId: 'baby-template:apply:size-percent:65', campaignOptionSnapshotDefinitionSha256: babySnapshot.campaignOptionSnapshot.sourceSnapshotDefinitionSha256 }),
        authorityEvidenceIds: ['browser-authored-baby-template'] }],
      issuedOperationId: ISSUANCE_OPERATION_ID as never,
      issuedCommandSha256: 'e'.repeat(64), issuedAtCampaignMinute: 590, expiresAtCampaignMinute: 650,
    })
    const forgedCommand = parseBreedingOperationCommandV1({ ...babyCommand,
      payload: { ...babyCommand.payload, resolutions: { ...babyCommand.payload.resolutions,
        selectedOptionIds: ['option:v1:99999999999999999999999999999992'] } } })
    const forgedSnapshot = snapshotWithCampaignOptions(snapshot, forgedCommand, {
      'breeding.baby-template-policy': 'per-egg-gm-choice', 'breeding.baby-template-stat-penalty': 4,
    })
    expect(() => planBreedingOffspringResolutionV1({ productionSnapshot: forgedSnapshot, command: forgedCommand,
      rolls: babyRolls.map((roll, ordinal) => makeRoll({ ordinal, purpose: roll.purpose, formula: roll.formula,
        dieCount: roll.dieCount, dieSides: roll.dieSides, ordered: roll.ordered, values: roll.values,
        sourceSnapshot: forgedSnapshot, commandValue: forgedCommand })), offers: [forged], roleOverride: null,
      roleOverrideEvidenceDefinitionSha256: null })).toThrowError(expect.objectContaining({ code: 'breeding.offspring-production.invalid-choice' }))
  })

  it('requires and binds one persisted server-random hatch-duration percentage roll', () => {
    const randomCommand = parseBreedingOperationCommandV1({
      ...command,
      payload: { ...command.payload, resolutions: { selectedOptionIds: [], requestedRollKinds: ['offspring-family', 'nature', 'ability', 'gender', 'hatch-duration'] } },
    })
    const randomSnapshot = snapshotWithCampaignOptions(snapshot, randomCommand, {
      'breeding.hatch-duration-variation': 'server-random-half-to-double',
    })
    const randomRolls = [
      makeRoll({ ordinal: 0, purpose: 'offspring-family-d20', formula: '1d20', dieCount: 1, dieSides: 20, ordered: false, values: [5], sourceSnapshot: randomSnapshot, commandValue: randomCommand }),
      makeRoll({ ordinal: 1, purpose: 'nature-ordered-2d6', formula: 'ordered-2d6', dieCount: 2, dieSides: 6, ordered: true, values: [1, 1], sourceSnapshot: randomSnapshot, commandValue: randomCommand }),
      makeRoll({ ordinal: 2, purpose: 'ability-uniform-index', formula: 'uniform-index', dieCount: 1, dieSides: 2, ordered: false, values: [1], sourceSnapshot: randomSnapshot, commandValue: randomCommand }),
      makeRoll({ ordinal: 3, purpose: 'gender-d100', formula: '1d100', dieCount: 1, dieSides: 100, ordered: false, values: [13], sourceSnapshot: randomSnapshot, commandValue: randomCommand }),
      makeRoll({ ordinal: 4, purpose: 'hatch-duration-percentage', formula: 'percentage-50-to-200', dieCount: 1, dieSides: 151, ordered: false, modifier: 49, values: [51], sourceSnapshot: randomSnapshot, commandValue: randomCommand }),
    ]
    const result = planBreedingOffspringResolutionV1({
      productionSnapshot: randomSnapshot,
      command: randomCommand,
      rolls: randomRolls,
      offers: [],
      roleOverride: null,
      roleOverrideEvidenceDefinitionSha256: null,
    })
    expect(result.record.hatchDurationRollRecordId).toBe(rollId(5))
    expect(result.record.rollRecordIds).toEqual(randomRolls.map(value => value.rollRecordId).sort())
    expect(() => planBreedingOffspringResolutionV1({
      productionSnapshot: randomSnapshot, command: randomCommand, rolls: randomRolls.slice(0, 4), offers: [],
      roleOverride: null, roleOverrideEvidenceDefinitionSha256: null,
    })).toThrow(/exactly equal persisted rolls|required/)
  })

  it('consumes one bounded GM hatch-duration offer and rejects unoffered campaign overrides', () => {
    const durationOptionId = 'option:v1:00000000000000000000000000000009'
    const durationCommand = parseBreedingOperationCommandV1({
      ...command,
      payload: { ...command.payload, resolutions: { selectedOptionIds: [durationOptionId], requestedRollKinds: ['offspring-family', 'nature', 'ability', 'gender'] } },
    })
    const durationSnapshot = snapshotWithCampaignOptions(snapshot, durationCommand, {
      'breeding.hatch-duration-variation': 'gm-within-half-to-double',
    })
    const durationOffer = createBreedingOptionOfferRecordV1({
      schemaVersion: 1,
      offerId: 'breeding-offer:v1:00000000000000000000000000000009' as never,
      choiceKind: 'hatch-duration',
      target: { kind: 'breeding-project', projectId: PROJECT_ID as never, revision: 2 },
      chooserProfileId: 'profile_owner_0001',
      minimumPokemonEducationRank: 'Expert',
      options: [{
        optionId: durationOptionId as never,
        kind: 'hatch-duration',
        canonicalValueId: 'campaign-minutes:450',
        valueDefinitionSha256: hatchDurationPolicyJson.definitionSha256,
        authorityEvidenceIds: ['breeding-offer-authority:hatch-duration:450'],
      }],
      issuedOperationId: ISSUANCE_OPERATION_ID as never,
      issuedCommandSha256: 'e'.repeat(64),
      issuedAtCampaignMinute: 590,
      expiresAtCampaignMinute: 650,
    })
    const durationRolls = rolls().map((roll, ordinal) => makeRoll({
      ordinal,
      purpose: roll.purpose,
      formula: roll.formula,
      dieCount: roll.dieCount,
      dieSides: roll.dieSides,
      ordered: roll.ordered,
      values: roll.values,
      sourceSnapshot: durationSnapshot,
      commandValue: durationCommand,
    }))
    const result = planBreedingOffspringResolutionV1({
      productionSnapshot: durationSnapshot, command: durationCommand, rolls: durationRolls, offers: [durationOffer],
      roleOverride: null, roleOverrideEvidenceDefinitionSha256: null,
    })
    expect(result.record.hatchDurationRollRecordId).toBeNull()
    expect(result.record.selectedOffers).toEqual([expect.objectContaining({ choiceKind: 'hatch-duration', canonicalValueId: 'campaign-minutes:450' })])
    expect(result.consumedOffers).toEqual([expect.objectContaining({ status: 'consumed', selectedOptionId: durationOptionId })])
    expect(() => planBreedingOffspringResolutionV1({
      productionSnapshot: durationSnapshot, command: durationCommand, rolls: durationRolls, offers: [],
      roleOverride: null, roleOverrideEvidenceDefinitionSha256: null,
    })).toThrow(/exactly one server-issued offer/)
  })

  it('freezes eligible inheritance with exact parent, pathway, source identity, and known-Move provenance', () => {
    const result = plan({ productionSnapshot: inheritanceSnapshot, rolls: inheritanceRolls() })
    expect(result.record.blueprint.inheritanceCandidates).toEqual([{
      moveId: 'charm',
      sources: [{
        kind: 'parent',
        parentIndex: 0,
        parentRef: 'pokemon-parent-a',
        parentSpeciesId: 'bulbasaur',
        pathwayId: 'child-egg-move',
        knownMoveEvidence: [{
          evidenceId: 'parent-known-move:charm',
          sourceKind: 'sheet-known-move',
          sourceId: 'pokemon-parent-a:move:charm',
          sourceDefinitionSha256: '2'.repeat(64),
        }],
      }],
    }])
    expect(parseAuthoritativeBreedingOffspringResolutionRecordV1(result.record)).toEqual(result.record)
    const tampered = clone(result.record) as any
    tampered.blueprint.inheritanceCandidates[0].sources[0].knownMoveEvidence[0].sourceId = 'forged:move'
    expect(() => parseAuthoritativeBreedingOffspringResolutionRecordV1(tampered)).toThrow()
  })

  it('consumes only a current server-issued rank-bounded choice and removes the corresponding random roll', () => {
    expect(createBreedingOperationCommandHash(choiceCommand)).toBe(choiceSnapshot.commandSha256)
    const result = choicePlan()
    expect(result.record.blueprint.ability).toEqual({
      valueId: 'overgrow',
      resolutionKind: 'rank-choice',
      rollRecordId: null,
      optionId: CHOICE_OPTION_ID,
      choiceEvidenceId: 'breeding-offer-authority:ability:overgrow',
    })
    expect(result.record.rollRecordIds).toEqual(choiceRolls().map(value => value.rollRecordId).sort())
    expect(result.record.selectedOffers).toEqual([expect.objectContaining({
      offerId: CHOICE_OFFER_ID,
      offerRevision: 0,
      choiceKind: 'ability',
      optionId: CHOICE_OPTION_ID,
      canonicalValueId: 'overgrow',
    })])
    expect(result.consumedOffers).toEqual([expect.objectContaining({
      offerId: CHOICE_OFFER_ID,
      revision: 1,
      status: 'consumed',
      selectedOptionId: CHOICE_OPTION_ID,
      settlementOperationId: OPERATION_ID,
      settlementCommandSha256: createBreedingOperationCommandHash(choiceCommand),
      settledAtCampaignMinute: 600,
    })])
    expect(parseAuthoritativeBreedingOffspringResolutionRecordV1(result.record)).toEqual(result.record)
  })

  it('rejects expired-at-equality, wrong-actor, insufficient-rank, absent, and extraneous bounded choices', () => {
    expect(() => choicePlan(activeAbilityOffer({ expiresAtCampaignMinute: 600 }))).toThrow(/active, current, unexpired/)
    expect(() => choicePlan(activeAbilityOffer({ chooserProfileId: 'profile_other_0001' }))).toThrow(/actor-bound/)
    expect(() => choicePlan(activeAbilityOffer({ minimumPokemonEducationRank: 'Master' }))).toThrow(/rank-authorized/)
    expect(() => planBreedingOffspringResolutionV1({
      productionSnapshot: choiceSnapshot, command: choiceCommand, rolls: choiceRolls(), offers: [],
      roleOverride: null, roleOverrideEvidenceDefinitionSha256: null,
    })).toThrow(/exactly one server-issued offer/)
  })

  it('projects only a bounded prepared summary without species, rolls, choices, parents, or hashes', () => {
    const projection = projectBreedingOffspringResolutionV1({ record: plan().record, audience: 'owner' })
    expect(projection).toEqual({
      schemaVersion: 1,
      audience: 'owner',
      status: 'prepared',
      resolvedAtCampaignMinute: 600,
      traitsResolved: true,
      inheritanceFrozen: true,
    })
    expect(JSON.stringify(projection)).not.toMatch(/bulbasaur|parent|roll|offer|option|hash|project|egg|trainer/iu)
  })

  it('rejects missing, extraneous, reordered, stale, biased, or client-substituted roll sets', () => {
    expect(() => plan({ rolls: rolls().slice(0, 3) })).toThrow(/exactly equal persisted rolls|required/)
    expect(() => plan({ rolls: [...rolls()].reverse() })).toThrow(/gap-free ordinal sequence|declared order/)
    const stale = rolls().map((roll, index) => index === 0
      ? makeRoll({ ordinal: 0, purpose: 'offspring-family-d20', formula: '1d20', dieCount: 1, dieSides: 20, ordered: false, values: [5], generatedAtCampaignMinute: 599 })
      : roll)
    expect(() => plan({ rolls: stale })).toThrow(/exact command-bound persisted server randomness/)
    const biased = rolls().map((roll, index) => index === 2
      ? makeRoll({ ordinal: 2, purpose: 'ability-uniform-index', formula: 'uniform-index', dieCount: 1, dieSides: 3, ordered: false, values: [1] })
      : roll)
    expect(() => plan({ rolls: biased })).toThrow(/die sides must equal/)
    const wrongCommand = parseBreedingOperationCommandV1({ ...command, payload: { ...command.payload, resolutions: { selectedOptionIds: [], requestedRollKinds: ['offspring-family', 'nature', 'ability'] } } })
    expect(() => plan({ command: wrongCommand })).toThrow(/production snapshot|exact Project revision/)
  })

  it('fails closed on accessor-backed, enriched, unknown, malformed, and self-hash-tampered records', () => {
    const record = plan().record
    expect(() => parseBreedingOffspringResolutionRecordV1({ ...record, surprise: true })).toThrow(/exactly the declared fields/)
    const accessor = clone(record) as Record<string, unknown>
    Object.defineProperty(accessor, 'resolvedAtCampaignMinute', { enumerable: true, get: () => 600 })
    expect(() => parseBreedingOffspringResolutionRecordV1(accessor)).toThrow(/enumerable data field/)
    const enriched = clone(record) as { rollRecordIds: unknown[] }
    Object.defineProperty(enriched.rollRecordIds, 'extra', { enumerable: true, value: true })
    expect(() => parseBreedingOffspringResolutionRecordV1(enriched)).toThrow(/non-enriched array/)
    expect(() => parseAuthoritativeBreedingOffspringResolutionRecordV1({ ...record, resolvedAtCampaignMinute: 601 })).toThrow(/hash does not match/)
    expect(() => parseAuthoritativeBreedingOffspringResolutionRecordV1({ ...record, definitionSha256: 'f'.repeat(64) })).toThrow(/hash does not match/)
  })

  it('persists a gap-free operation roll ledger before reduction and permits exact replay only', () => {
    const database = openRotomDatabase({ path: ':memory:', enableWal: false }); databases.push(database)
    const operations = createSqliteBreedingOperationRepository(database)
    database.withTransaction(() => operations.reserve(command, 600))
    const repository = createSqliteBreedingRollRepository(database)
    expect(() => repository.insert({ command, roll: rolls()[0]! })).toThrow(BreedingRollRepositoryTransactionError)
    database.withTransaction(() => {
      for (const roll of rolls()) expect(repository.insert({ command, roll })).toEqual(roll)
      expect(repository.insert({ command, roll: rolls()[0]! })).toEqual(rolls()[0])
    })
    expect(repository.listByOperation(command.operationId)).toEqual(rolls())
    expect(repository.get(rollId(3))).toEqual(rolls()[2])
    const conflicting = { ...rolls()[0]!, values: [6], total: 6,
      definitionSha256: createHash('sha256').update('conflict').digest('hex') } as never
    expect(() => database.withTransaction(() => repository.insert({ command, roll: conflicting }))).toThrow()
    expect(repository.listByOperation(command.operationId)).toEqual(rolls())
  })

  it('persists immutable option offers and one monotonic consumed successor in the caller transaction', () => {
    const database = openRotomDatabase({ path: ':memory:', enableWal: false }); databases.push(database)
    database.withTransaction(() => {
      createSqliteBreedingOperationRepository(database).reserve(choiceCommand, 600)
      database.connection.prepare(`
        INSERT INTO breeding_operations (
          operation_id, command_sha256, command_kind, command_json, status,
          result_json, result_definition_sha256, created_at_campaign_minute, settled_at_campaign_minute
        ) VALUES (?, ?, 'preview-breeding', '{}', 'pending', NULL, NULL, 590, NULL)
      `).run(ISSUANCE_OPERATION_ID, 'e'.repeat(64))
    })
    const repository = createSqliteBreedingOptionOfferRepository(database)
    expect(() => repository.insert(activeAbilityOffer())).toThrow(BreedingOptionOfferRepositoryTransactionError)
    database.withTransaction(() => {
      expect(repository.insert(activeAbilityOffer())).toEqual(activeAbilityOffer())
      expect(repository.insert(activeAbilityOffer())).toEqual(activeAbilityOffer())
    })
    expect(repository.listByProject(PROJECT_ID)).toEqual([activeAbilityOffer()])
    expect(repository.findByProjectOptionIds({ projectId: PROJECT_ID, optionIds: [CHOICE_OPTION_ID] })).toEqual([activeAbilityOffer()])
    expect(repository.findByProjectOptionIds({ projectId: PROJECT_ID, optionIds: [] })).toEqual([])
    const successor = choicePlan().consumedOffers[0]!
    expect(database.withTransaction(() => repository.replace({ expectedRevision: 0, record: successor }))).toEqual({ kind: 'applied', document: successor })
    expect(repository.get(CHOICE_OFFER_ID)).toEqual(successor)
    expect(database.withTransaction(() => repository.replace({ expectedRevision: 0, record: successor }))).toEqual({ kind: 'stale', expectedRevision: 0, currentRevision: 1 })
    expect(() => database.withTransaction(() => repository.insert(activeAbilityOffer()))).toThrow(BreedingRepositoryIdentityCollisionError)
  })

  it('rejects ordinal gaps and purposes not declared by the command', () => {
    const database = openRotomDatabase({ path: ':memory:', enableWal: false }); databases.push(database)
    database.withTransaction(() => createSqliteBreedingOperationRepository(database).reserve(command, 600))
    const repository = createSqliteBreedingRollRepository(database)
    expect(() => database.withTransaction(() => repository.insert({ command, roll: rolls()[1]! }))).toThrow(BreedingRepositoryIdentityCollisionError)
    const wrongPurpose = makeRoll({ ordinal: 0, purpose: 'gender-d100', formula: '1d100', dieCount: 1, dieSides: 100, ordered: false, values: [5] })
    expect(() => database.withTransaction(() => repository.insert({ command, roll: wrongPurpose }))).toThrow(BreedingRepositoryIdentityCollisionError)
    expect(repository.listByOperation(command.operationId)).toEqual([])
  })

  it('uses stable resolution hashes and never consults ambient randomness', () => {
    const first = plan().record
    const second = plan().record
    expect(second).toEqual(first)
    expect(second.definitionSha256).toBe(first.definitionSha256)
    expect(second.definitionSha256).toBe(createHash('sha256').update(stableJsonStringify((({ definitionSha256: _hash, ...value }) => value)(second))).digest('hex'))
  })

  it('reports stable authority codes for wrong commands and fails closed before malformed providers can execute', () => {
    const providerSnapshot = clone(snapshot) as any
    providerSnapshot.providerSnapshot.contributions.push({ anything: true })
    expect(() => plan({ productionSnapshot: providerSnapshot })).toThrow()
    const wrongCommand = parseBreedingOperationCommandV1({
      schemaVersion: 1,
      operationId: OPERATION_ID,
      commandKind: 'advance-breeding-project-time',
      actor: command.actor,
      ruleset: command.ruleset,
      scopes: [{ kind: 'breeding-project', projectId: PROJECT_ID, expectedRevision: 2 }],
      payload: { projectId: PROJECT_ID, throughClockRevision: 3, throughCampaignMinute: 600 },
    })
    try { plan({ command: wrongCommand }) }
    catch (error) {
      expect(error).toBeInstanceOf(BreedingOffspringProductionAuthorityError)
      expect((error as BreedingOffspringProductionAuthorityError).code).toBe('breeding.offspring-production.wrong-command')
    }
  })
})
