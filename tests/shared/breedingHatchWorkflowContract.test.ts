import { describe, expect, it } from 'vitest'
import hatchDestinationContractJson from '../../data/breeding-automation/hatch-destination-presentation-contract.json'
import {
  BreedingHatchWorkflowContractError,
  parseBreedingHatchWorkflowProjectionV1,
  parseBreedingHatchWorkflowRequestV1,
  verifyBreedingHatchWorkflowProjectionV1,
} from '../../shared/breeding/hatchWorkflow'
import {
  BREEDING_HATCH_DESTINATION_PRESENTATION_POLICY_DEFINITION_SHA256,
  createBreedingHatchWorkflowProjectionV1,
} from '../../server/domain/breeding/hatchWorkflow'

const EGG_ID = 'pokemon-egg:v1:75757575757575757575757575757575'
const BOX_OPTION_ID = 'option:v1:75757575757575757575757575757570'
const TEAM_OPTION_ID = 'option:v1:75757575757575757575757575757571'
const ready = () => createBreedingHatchWorkflowProjectionV1({
  audience: 'owner',
  trainerSheetSlug: 'trainer-owner',
  stage: 'ready',
  egg: { eggId: EGG_ID as never, revision: 1, status: 'ready', speciesName: 'Bulbasaur', updatedAtCampaignMinute: 700 },
  decision: { kind: 'begin-hatch', canSubmit: true, requiresConfirmation: true, reasonId: null },
  special: { state: 'not-rolled', outcomeId: null, gmReview: null },
  destination: { teamCapacity: 6, acceptedKind: null, options: [
    { optionId: BOX_OPTION_ID as never, kind: 'box', availability: 'available', reasonId: null, remainingTeamSlots: null },
    { optionId: TEAM_OPTION_ID as never, kind: 'team', availability: 'available', reasonId: null, remainingTeamSlots: 2 },
  ] },
  childReveal: null,
  recovery: { state: 'none', pendingSinceCampaignMinute: null },
  transition: 'none',
  generatedAtCampaignMinute: 700,
})

describe('BR-075/BR-076 hatch workflow contract', () => {
  it('binds the reviewed destination contract to the current presentation policy', () => {
    expect(hatchDestinationContractJson.contractId).toBe('rotom-breeding-hatch-destination-presentation-v1')
    expect(hatchDestinationContractJson.definition.ticket).toBe('BR-076')
    expect(hatchDestinationContractJson.definition.implementation.destinationPresentationPolicyDefinitionSha256)
      .toBe(BREEDING_HATCH_DESTINATION_PRESENTATION_POLICY_DEFINITION_SHA256)
  })

  it('accepts only selector-only, explicitly confirmed mutation requests', () => {
    expect(parseBreedingHatchWorkflowRequestV1({
      schemaVersion: 1, profileId: 'profile_owner_0075', trainerSheetSlug: 'trainer-owner', eggId: EGG_ID,
      expectedEggRevision: 1, intent: 'inspect', destinationOptionId: null, selectedOptionId: null, confirmed: false,
    })).toMatchObject({ intent: 'inspect', confirmed: false })
    expect(() => parseBreedingHatchWorkflowRequestV1({
      schemaVersion: 1, profileId: 'profile_owner_0075', trainerSheetSlug: 'trainer-owner', eggId: EGG_ID,
      expectedEggRevision: 1, intent: 'begin', destinationOptionId: BOX_OPTION_ID, selectedOptionId: null, confirmed: false,
    })).toThrow(BreedingHatchWorkflowContractError)
    expect(() => parseBreedingHatchWorkflowRequestV1({
      schemaVersion: 1, profileId: 'profile_owner_0075', trainerSheetSlug: 'trainer-owner', eggId: EGG_ID,
      expectedEggRevision: 1, intent: 'begin', destinationOptionId: BOX_OPTION_ID, selectedOptionId: null, confirmed: true, command: {},
    })).toThrow(BreedingHatchWorkflowContractError)
    expect(parseBreedingHatchWorkflowRequestV1({
      schemaVersion: 1, profileId: 'profile_owner_0075', trainerSheetSlug: 'trainer-owner', eggId: EGG_ID,
      expectedEggRevision: 1, intent: 'begin', destinationOptionId: TEAM_OPTION_ID, selectedOptionId: null, confirmed: true,
    })).toMatchObject({ intent: 'begin', destinationOptionId: TEAM_OPTION_ID })
  })

  it('verifies the current security binding and exact self hash', async () => {
    const projection = ready()
    await expect(verifyBreedingHatchWorkflowProjectionV1(JSON.parse(JSON.stringify(projection)))).resolves.toEqual(projection)
    await expect(verifyBreedingHatchWorkflowProjectionV1({ ...projection, stage: 'hatched' })).rejects.toThrow(BreedingHatchWorkflowContractError)
    await expect(verifyBreedingHatchWorkflowProjectionV1({ ...projection, projectionDefinitionSha256: '0'.repeat(64) })).rejects.toThrowError(expect.objectContaining({ code: 'breeding.hatch-workflow.hash-mismatch' }))
    await expect(verifyBreedingHatchWorkflowProjectionV1({ ...projection, securityPolicyDefinitionSha256: '0'.repeat(64) })).rejects.toThrowError(expect.objectContaining({ code: 'breeding.hatch-workflow.security-policy-mismatch' }))
  })

  it('rejects destination capacity, order, availability, and accepted-link drift', () => {
    const projection = ready()
    expect(() => parseBreedingHatchWorkflowProjectionV1({
      ...projection,
      destination: { ...projection.destination, options: [...projection.destination.options].reverse() },
    })).toThrow(BreedingHatchWorkflowContractError)
    expect(() => parseBreedingHatchWorkflowProjectionV1({
      ...projection,
      destination: { ...projection.destination, options: [
        projection.destination.options[0],
        { ...projection.destination.options[1], remainingTeamSlots: 0, availability: 'available' },
      ] },
    })).toThrow(BreedingHatchWorkflowContractError)
    expect(() => parseBreedingHatchWorkflowProjectionV1({
      ...projection,
      destination: { ...projection.destination, acceptedKind: 'team' },
    })).toThrow(BreedingHatchWorkflowContractError)
  })

  it('rejects owner roll/options, accessor-backed data, and incoherent reveal state', () => {
    const projection = ready()
    expect(() => parseBreedingHatchWorkflowProjectionV1({
      ...projection,
      special: { state: 'pending-adjudication', outcomeId: null, gmReview: { rollTotal: 1, triggerIds: ['roll-1'], options: [] } },
    })).toThrow(BreedingHatchWorkflowContractError)
    expect(() => parseBreedingHatchWorkflowProjectionV1({
      ...projection,
      childReveal: { childSheetSlug: 'bulbasaur', speciesName: 'Bulbasaur', natureName: 'Cuddly', abilityName: 'Overgrow', genderId: 'female', startingLevel: 1, destinationKind: 'box', hatchedAtCampaignMinute: 700 },
    })).toThrow(BreedingHatchWorkflowContractError)
    const accessor = { ...projection } as Record<string, unknown>
    Object.defineProperty(accessor, 'stage', { enumerable: true, get: () => 'ready' })
    expect(() => parseBreedingHatchWorkflowProjectionV1(accessor)).toThrow(BreedingHatchWorkflowContractError)
  })
})
