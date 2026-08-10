import { describe, expect, it } from 'vitest'
import {
  parseBreedingWorkshopActivityProjectionV1,
  verifyBreedingWorkshopActivityProjectionV1,
  type BreedingWorkshopActivityProjectionV1,
  type BreedingWorkshopEggCardV1,
  type BreedingWorkshopProjectCardV1,
} from '../../shared/breeding/workshopActivity'
import { createBreedingWorkshopActivityProjectionV1 } from '../../server/domain/breeding/workshopActivity'

const project = (digit = '1', updated = 20): BreedingWorkshopProjectCardV1 => ({
  aggregateKind: 'breeding-project',
  projectId: `breeding-project:v1:${digit.repeat(32)}` as BreedingWorkshopProjectCardV1['projectId'],
  revision: 2,
  status: 'initial-time-in-progress',
  breederDisplayName: 'Mira',
  parents: [
    { parentIndex: 0, relationship: 'owned', displayName: 'Ember', pokemonSheetSlug: 'pokemon-ember', consentStatus: 'not-required' },
    { parentIndex: 1, relationship: 'participating', displayName: 'Participating parent', pokemonSheetSlug: null, consentStatus: 'waiting' },
  ],
  progress: { stage: 'initial-time', accumulatedCampaignMinutes: 120, targetCampaignMinutes: 480, percent: 25 },
  history: [
    { kind: 'created', campaignMinute: 10 },
    { kind: 'initial-time-started', campaignMinute: 10 },
  ],
  recovery: { state: 'none', pendingSinceCampaignMinute: null, canRefresh: false },
  createdAtCampaignMinute: 10,
  updatedAtCampaignMinute: updated,
  statusChangedAtCampaignMinute: 10,
})
const egg = (digit = '2', updated = 30): BreedingWorkshopEggCardV1 => ({
  aggregateKind: 'pokemon-egg',
  eggId: `pokemon-egg:v1:${digit.repeat(32)}` as BreedingWorkshopEggCardV1['eggId'],
  revision: 4,
  status: 'incubating',
  sourceKind: 'breeding',
  speciesName: 'Charmander',
  natureName: 'Cuddly',
  abilityName: 'Blaze',
  genderId: 'female',
  startingLevel: 1,
  progress: { stage: 'incubating', accumulatedCampaignMinutes: 600, targetCampaignMinutes: 1_200, percent: 50, paused: false },
  history: [{ kind: 'created', campaignMinute: 12 }],
  recovery: { state: 'none', pendingSinceCampaignMinute: null, canRefresh: false },
  transfer: { state: 'available', action: 'start', reasonId: null, counterpartyTrainerSlug: null, expiresAtCampaignMinute: null },
  childSheetSlug: null,
  createdAtCampaignMinute: 12,
  updatedAtCampaignMinute: updated,
  statusChangedAtCampaignMinute: 12,
})
const projection = (): BreedingWorkshopActivityProjectionV1 => createBreedingWorkshopActivityProjectionV1({
  audience: 'owner',
  trainer: { trainerSheetSlug: 'trainer-owner', trainerRevision: 7, displayName: 'Mira' },
  generatedAtCampaignMinute: 40,
  projectsTruncated: false,
  eggsTruncated: false,
  projects: [project()],
  eggs: [egg()],
})

describe('Breeding Workshop activity contract', () => {
  it('strictly parses and browser-verifies current owner card projections', async () => {
    const value = projection()
    expect(parseBreedingWorkshopActivityProjectionV1(value)).toEqual(value)
    await expect(verifyBreedingWorkshopActivityProjectionV1(value)).resolves.toEqual(value)
    expect(value.projects[0]?.parents[1]).toEqual({
      parentIndex: 1,
      relationship: 'participating',
      displayName: 'Participating parent',
      pokemonSheetSlug: null,
      consentStatus: 'waiting',
    })
  })

  it('rejects tampering, enrichment, accessors, invalid progress, and owner privacy drift', async () => {
    const value = projection()
    await expect(verifyBreedingWorkshopActivityProjectionV1({
      ...value,
      generatedAtCampaignMinute: 41,
    })).rejects.toMatchObject({ code: 'breeding.workshop-activity.hash-mismatch' })
    expect(() => parseBreedingWorkshopActivityProjectionV1({ ...value, operationId: 'private' }))
      .toThrowError(expect.objectContaining({ code: 'breeding.workshop-activity.invalid-document' }))
    expect(() => parseBreedingWorkshopActivityProjectionV1({
      ...value,
      projects: [{
        ...value.projects[0],
        progress: { ...value.projects[0]!.progress, percent: 26 },
      }],
    })).toThrowError(expect.objectContaining({ code: 'breeding.workshop-activity.invalid-invariant' }))
    expect(() => parseBreedingWorkshopActivityProjectionV1({
      ...value,
      projects: [{
        ...value.projects[0],
        parents: [
          value.projects[0]!.parents[0],
          { ...value.projects[0]!.parents[1], pokemonSheetSlug: 'pokemon-private' },
        ],
      }],
    })).toThrowError(expect.objectContaining({ code: 'breeding.workshop-activity.invalid-invariant' }))
    const accessor = structuredClone(value)
    Object.defineProperty(accessor, 'audience', { enumerable: true, get: () => 'owner' })
    expect(() => parseBreedingWorkshopActivityProjectionV1(accessor))
      .toThrowError(expect.objectContaining({ code: 'breeding.workshop-activity.invalid-document' }))
  })

  it('requires repository ordering and exact transfer/recovery state combinations', () => {
    const value = projection()
    expect(() => parseBreedingWorkshopActivityProjectionV1({
      ...value,
      projects: [project('1', 10), project('2', 20)],
    })).toThrowError(expect.objectContaining({ code: 'breeding.workshop-activity.invalid-invariant' }))
    expect(() => parseBreedingWorkshopActivityProjectionV1({
      ...value,
      eggs: [{
        ...value.eggs[0],
        transfer: { ...value.eggs[0]!.transfer, action: 'review' },
      }],
    })).toThrowError(expect.objectContaining({ code: 'breeding.workshop-activity.invalid-invariant' }))
    expect(() => parseBreedingWorkshopActivityProjectionV1({
      ...value,
      eggs: [{
        ...value.eggs[0],
        recovery: { state: 'pending', pendingSinceCampaignMinute: null, canRefresh: true },
      }],
    })).toThrowError(expect.objectContaining({ code: 'breeding.workshop-activity.invalid-invariant' }))
  })

  it('permits GM cards to identify a participating parent while retaining exact hashing', () => {
    const gm = createBreedingWorkshopActivityProjectionV1({
      audience: 'gm',
      trainer: { trainerSheetSlug: 'trainer-owner', trainerRevision: 7, displayName: 'Mira' },
      generatedAtCampaignMinute: 40,
      projectsTruncated: false,
      eggsTruncated: false,
      projects: [{
        ...project(),
        parents: [
          project().parents[0],
          { ...project().parents[1], displayName: 'Flare', pokemonSheetSlug: 'pokemon-flare' },
        ],
      }],
      eggs: [],
    })
    expect(gm.projects[0]?.parents[1]?.pokemonSheetSlug).toBe('pokemon-flare')
  })
})
