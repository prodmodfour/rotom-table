import { describe, expect, it } from 'vitest'
import {
  ItemBreedingWorkflowValidationError,
  parseItemBreedingOperationCommand,
  parseItemBreedingOperationResult,
  parseItemBreedingState,
} from '#shared/breeding/itemWorkflows'

const operationId = (value: string) => `item-breeding:v1:${value.repeat(32)}`
const optionId = (value: string) => `breeding-item-option:v1:${value.repeat(32)}`

describe('item breeding workflow strict contracts', () => {
  it('normalizes missing private state and sorts exact assignments', () => {
    expect(parseItemBreedingState(undefined)).toEqual({ schemaVersion: 1, eggWarmerAssignments: [] })
    expect(parseItemBreedingState({ schemaVersion: 1, eggWarmerAssignments: [
      { inventoryEntryId: 'row-z', unitOrdinal: 0, eggIds: ['egg-z'], assignedAtCampaignMinute: 2, lastOperationId: operationId('a') },
      { inventoryEntryId: 'row-a', unitOrdinal: 1, eggIds: ['egg-a'], assignedAtCampaignMinute: 1, lastOperationId: operationId('b') },
    ] }).eggWarmerAssignments.map(value => value.inventoryEntryId)).toEqual(['row-a','row-z'])
  })

  it('fails closed for duplicate Egg custody, empty assignments, and enriched commands', () => {
    for (const state of [
      { schemaVersion: 1, eggWarmerAssignments: [
        { inventoryEntryId: 'row-a', unitOrdinal: 0, eggIds: ['egg-a'], assignedAtCampaignMinute: 1, lastOperationId: operationId('a') },
        { inventoryEntryId: 'row-b', unitOrdinal: 0, eggIds: ['egg-a'], assignedAtCampaignMinute: 1, lastOperationId: operationId('b') },
      ] },
      { schemaVersion: 1, eggWarmerAssignments: [
        { inventoryEntryId: 'row-a', unitOrdinal: 0, eggIds: [], assignedAtCampaignMinute: 1, lastOperationId: operationId('a') },
      ] },
    ]) expect(() => parseItemBreedingState(state)).toThrow(ItemBreedingWorkflowValidationError)
    expect(() => parseItemBreedingOperationCommand({
      schemaVersion: 1, kind: 'assign-egg-warmer', operationId: operationId('a'),
      trainerSheetSlug: 'trainer-owner', expectedTrainerRevision: 1,
      warmerUnitOptionId: optionId('b'), eggOptionIds: [], inventoryEntryId: 'private-row',
    })).toThrow(ItemBreedingWorkflowValidationError)
  })

  it('rejects result payloads that conflict with settlement kind or status', () => {
    expect(() => parseItemBreedingOperationResult({
      schemaVersion: 1, operationId: operationId('a'), kind: 'restore-fossil', status: 'accepted',
      trainerSheetSlug: 'trainer-owner', trainerRevision: 2, egg: null, assignment: null, message: 'Accepted.',
    })).toThrow(ItemBreedingWorkflowValidationError)
    expect(() => parseItemBreedingOperationResult({
      schemaVersion: 1, operationId: operationId('a'), kind: 'assign-egg-warmer', status: 'rejected',
      trainerSheetSlug: 'trainer-owner', trainerRevision: 1, egg: null,
      assignment: { warmerLabel: 'Egg Warmer', assignedEggLabels: [], capacity: 4, progressRateNumerator: 2, progressRateDenominator: 1 },
      message: 'Rejected.',
    })).toThrow(ItemBreedingWorkflowValidationError)
  })
})
