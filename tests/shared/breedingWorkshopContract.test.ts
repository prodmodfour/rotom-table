import { describe, expect, it } from 'vitest'
import {
  BREEDING_WORKSHOP_SECURITY_POLICY_DEFINITION_SHA256,
  BreedingWorkshopContractError,
  BreedingWorkshopProjectionVerificationError,
  parseBreedingWorkshopProjectionV1,
  parseBreedingWorkshopQueryV1,
  verifyBreedingWorkshopProjectionV1,
} from '../../shared/breeding/workshop'

const context = {
  trainerSheetSlug: 'trainer-owner',
  trainerRevision: 3,
  displayName: 'Mira',
  availability: 'available' as const,
  unavailableReasonId: null,
  hasProjects: false,
  hasEggs: false,
}
const projection = () => ({
  schemaVersion: 1 as const,
  audience: 'owner' as const,
  generatedAtCampaignMinute: 600,
  profileSelectionRequired: false,
  ownershipCursor: null,
  nextOwnershipCursor: null,
  ownershipContexts: [context],
  selectedOwnershipContext: context,
  emptyState: 'selected-context-empty' as const,
  securityPolicyDefinitionSha256: 'a'.repeat(64),
  projectionDefinitionSha256: 'b'.repeat(64),
})

describe('Breeding Workshop shared contract', () => {
  it('parses and deeply freezes one bounded owner projection', () => {
    const parsed = parseBreedingWorkshopProjectionV1(projection())
    expect(parsed).toMatchObject({
      audience: 'owner',
      selectedOwnershipContext: { trainerSheetSlug: 'trainer-owner', trainerRevision: 3 },
      emptyState: 'selected-context-empty',
    })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.ownershipContexts)).toBe(true)
    expect(Object.isFrozen(parsed.ownershipContexts[0])).toBe(true)
  })

  it('accepts profile-required without leaking ownership and rejects contradictory empty states', () => {
    expect(parseBreedingWorkshopProjectionV1({
      ...projection(),
      ownershipContexts: [],
      selectedOwnershipContext: null,
      profileSelectionRequired: true,
      emptyState: 'profile-required',
    })).toMatchObject({ profileSelectionRequired: true, ownershipContexts: [] })

    expect(() => parseBreedingWorkshopProjectionV1({
      ...projection(),
      emptyState: null,
    })).toThrowError(expect.objectContaining({
      code: 'breeding.workshop.invalid-invariant',
    }))
    expect(() => parseBreedingWorkshopProjectionV1({
      ...projection(),
      audience: 'gm',
      profileSelectionRequired: true,
      ownershipContexts: [],
      selectedOwnershipContext: null,
      emptyState: 'profile-required',
    })).toThrow(BreedingWorkshopContractError)
  })

  it('rejects enriched, accessor-backed, sparse, unsorted, and overfull pages', () => {
    expect(() => parseBreedingWorkshopProjectionV1({ ...projection(), privateEggId: 'nope' }))
      .toThrow(BreedingWorkshopContractError)
    const accessor = projection()
    Object.defineProperty(accessor, 'audience', { enumerable: true, get: () => 'owner' })
    expect(() => parseBreedingWorkshopProjectionV1(accessor)).toThrow(BreedingWorkshopContractError)
    const sparse = projection()
    sparse.ownershipContexts = Array(2) as never
    sparse.ownershipContexts[1] = context
    expect(() => parseBreedingWorkshopProjectionV1(sparse)).toThrow(BreedingWorkshopContractError)
    expect(() => parseBreedingWorkshopProjectionV1({
      ...projection(),
      ownershipContexts: [
        { ...context, trainerSheetSlug: 'trainer-zed' },
        { ...context, trainerSheetSlug: 'trainer-ash' },
      ],
    })).toThrowError(expect.objectContaining({ code: 'breeding.workshop.invalid-invariant' }))
    expect(() => parseBreedingWorkshopProjectionV1({
      ...projection(),
      ownershipContexts: Array.from({ length: 101 }, (_entry, index) => ({
        ...context,
        trainerSheetSlug: `trainer-${String(index).padStart(3, '0')}`,
      })),
    })).toThrow(BreedingWorkshopContractError)
  })

  it('verifies current security authority and the exact browser-compatible projection hash', async () => {
    const databaseProjection = (await import('../../server/domain/breeding/workshop')).createBreedingWorkshopProjectionV1({
      audience: 'owner',
      generatedAtCampaignMinute: 600,
      profileSelectionRequired: false,
      ownershipCursor: null,
      nextOwnershipCursor: null,
      ownershipContexts: [context],
      selectedOwnershipContext: context,
      emptyState: 'selected-context-empty',
    })
    await expect(verifyBreedingWorkshopProjectionV1(databaseProjection))
      .resolves.toStrictEqual(databaseProjection)
    expect(databaseProjection.securityPolicyDefinitionSha256)
      .toBe(BREEDING_WORKSHOP_SECURITY_POLICY_DEFINITION_SHA256)
    await expect(verifyBreedingWorkshopProjectionV1({
      ...databaseProjection,
      generatedAtCampaignMinute: 601,
    })).rejects.toBeInstanceOf(BreedingWorkshopProjectionVerificationError)
  })

  it('parses only exact canonical query fields', () => {
    expect(parseBreedingWorkshopQueryV1({
      trainerSheetSlug: 'trainer-owner',
      ownershipCursor: null,
    })).toEqual({ trainerSheetSlug: 'trainer-owner', ownershipCursor: null })
    expect(() => parseBreedingWorkshopQueryV1({
      trainerSheetSlug: 'trainer-owner',
      ownershipCursor: null,
      aggregateId: 'private',
    })).toThrow(BreedingWorkshopContractError)
  })
})
