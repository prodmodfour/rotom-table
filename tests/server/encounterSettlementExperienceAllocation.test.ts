import { describe, expect, it } from 'vitest'
import { createEmptyCapabilityCampaignState } from '../../shared/capabilityAutomation/campaignState'
import {
  createEncounterSettlementDocument,
  parseEncounterSettlementDocument,
  type EncounterSettlementDocument,
} from '../../shared/encounterSettlement/document'
import {
  applyEncounterSettlementBatchExperiencePlan,
  EncounterSettlementExperienceAllocationError,
  planEncounterSettlementBatchExperience,
  type EncounterSettlementExperienceAuthoritySnapshot,
  type EncounterSettlementExperienceDeclaration,
  type EncounterSettlementPokemonExperienceAuthority,
} from '../../server/domain/encounterSettlement/experienceAllocation'
import { planEncounterSettlementRewardPackage } from '../../server/domain/encounterSettlement/rewardPackage'
import {
  createBreedingBabyTemplateAuthorityV1,
  createBreedingMarsupialProviderTraitV1,
  resolveBreedingMarsupialBabyTemplateV1,
} from '../../server/domain/breeding/babyTemplate'
import { pokemonExperienceNeededForLevel } from '../../src/utils/sheets/pokemonExperience'
import type { CharacterSheet } from '../../src/types/characterSheet'

const encounter = {
  encounterId: 'encounter-a',
  encounterRevision: 12,
  linkedMapSlug: 'arena-a',
  linkedMapRevision: 20,
  campaignMinute: 480,
} as const

const pokemonSheet = (
  slug: string,
  level: number,
  totalExp = pokemonExperienceNeededForLevel(level)!,
  overrides: Partial<CharacterSheet> = {},
): CharacterSheet => ({
  slug,
  nickname: slug,
  species: 'Bulbasaur',
  level,
  totalExp,
  ...overrides,
})

const participants = [
  { id: 'placement-a', slug: 'pokemon-a', level: 10, total: 90 },
  { id: 'placement-b', slug: 'pokemon-b', level: 10, total: 90 },
  { id: 'placement-c', slug: 'pokemon-c', level: 5, total: 40 },
] as const

const settlement = (input: {
  readonly amount?: number
  readonly disposition?: 'pending' | 'allocated' | 'excluded' | 'committed'
  readonly participantRows?: readonly { readonly id: string, readonly slug: string, readonly revision?: number }[]
  readonly overrides?: Partial<EncounterSettlementDocument>
} = {}): EncounterSettlementDocument => {
  const created = createEncounterSettlementDocument({
    settlementId: 'encounter-settlement:v1:00000000000000000000000000000075',
    rewardPackageId: 'reward-package-a',
    encounter,
  })
  const rows = input.participantRows ?? participants
  return parseEncounterSettlementDocument({
    ...created,
    participants: rows.map(row => ({
      participantId: row.id,
      sourceAuthority: { kind: 'map', id: 'arena-a', revision: 20 },
      sheetKind: 'pokemon',
      sheetSlug: row.slug,
      sheetRevision: row.revision ?? 7,
      sideId: 'heroes',
      ownerParticipantId: null,
      settlementRole: 'combatant',
      disposition: 'active',
    })),
    rewardPackage: {
      rewardPackageId: 'reward-package-a',
      status: 'ready',
      lines: [{
        rewardId: 'reward-experience-a',
        visibility: 'public',
        sourceAuthority: { kind: 'encounter-document', id: 'encounter-a', revision: 12 },
        disposition: input.disposition ?? 'pending',
        payload: { kind: 'experience', amount: input.amount ?? 101 },
      }],
    },
    ...input.overrides,
  })
}

const sheets = (
  overrides: Partial<Record<string, EncounterSettlementPokemonExperienceAuthority>> = {},
): EncounterSettlementPokemonExperienceAuthority[] => participants.map(row => overrides[row.slug] ?? ({
  sheetSlug: row.slug,
  revision: 7,
  sheet: pokemonSheet(row.slug, row.level, row.total),
}))

const permission = (status: 'allowed' | 'denied' = 'allowed') => ({
  status,
  authority: { kind: 'encounter-document' as const, id: 'encounter-a', revision: 12 },
  reasonId: status === 'denied' ? 'profile-cannot-allocate-experience' : null,
})

const declaration = (
  method: EncounterSettlementExperienceDeclaration['method'] = 'fixed',
  recipients: EncounterSettlementExperienceDeclaration['recipients'] = participants.map(row => ({
    participantId: row.id,
    weight: null,
    amount: null,
  })),
  overrides: Partial<EncounterSettlementExperienceDeclaration> = {},
): EncounterSettlementExperienceDeclaration => ({
  rewardId: 'reward-experience-a',
  destination: { kind: 'side', id: 'heroes', revision: 12 },
  method,
  recipients,
  permission: permission(),
  ...overrides,
})

const authority = (
  declarations: readonly EncounterSettlementExperienceDeclaration[],
  overrides: Partial<EncounterSettlementExperienceAuthoritySnapshot> = {},
): EncounterSettlementExperienceAuthoritySnapshot => ({
  completeness: 'authoritative-current',
  pokemonSheets: sheets(),
  declarations,
  ...overrides,
})

describe('encounter settlement batch Experience allocation', () => {
  it('equal-splits fixed XP deterministically and previews every crossed canonical level threshold', () => {
    const plan = planEncounterSettlementBatchExperience({
      settlement: settlement(),
      authority: authority([declaration()]),
    })

    expect(plan.complete).toBe(true)
    expect(plan.pendingRewardIds).toEqual([])
    expect(plan.allocations).toEqual([
      expect.objectContaining({
        rewardId: 'reward-experience-a',
        destination: { kind: 'side', id: 'heroes', revision: 12 },
        method: 'fixed',
        amount: 101,
        state: 'proposed',
      }),
    ])
    expect(plan.recipientPreviews.map(preview => [preview.sheetSlug, preview.grantAmount])).toEqual([
      ['pokemon-a', 34],
      ['pokemon-b', 34],
      ['pokemon-c', 33],
    ])
    expect(plan.recipientPreviews.find(preview => preview.sheetSlug === 'pokemon-a')).toMatchObject({
      totalExperienceBefore: 90,
      totalExperienceAfter: 124,
      levelBefore: 10,
      levelAfter: 11,
      crossedThresholds: [{ level: 11, totalExperience: 110 }],
    })
    expect(plan.recipientPreviews.find(preview => preview.sheetSlug === 'pokemon-c')?.crossedThresholds)
      .toEqual([
        { level: 6, totalExperience: 50 },
        { level: 7, totalExperience: 60 },
        { level: 8, totalExperience: 70 },
      ])

    const rewardPlan = planEncounterSettlementRewardPackage({
      settlement: plan.document,
      authority: { completeness: 'authoritative-current', destinations: plan.destinationAuthorities },
    })
    expect(rewardPlan).toMatchObject({ eligible: true, issues: [] })
    expect(rewardPlan.writePreviews.reduce((sum, write) => sum + (
      write.countsTowardAllocation ? write.amount : 0
    ), 0)).toBe(101)
  })

  it('supports deterministic weighted and exact individually adjusted distributions', () => {
    const weighted = planEncounterSettlementBatchExperience({
      settlement: settlement({ amount: 100 }),
      authority: authority([declaration('weighted', [
        { participantId: 'placement-a', weight: 1, amount: null },
        { participantId: 'placement-b', weight: 2, amount: null },
        { participantId: 'placement-c', weight: 3, amount: null },
      ])]),
    })
    expect(weighted.recipientPreviews.map(preview => preview.grantAmount)).toEqual([17, 33, 50])
    expect(weighted.allocations[0]).toMatchObject({ method: 'weighted', amount: 100, weight: 6 })

    const individual = planEncounterSettlementBatchExperience({
      settlement: settlement({ amount: 100 }),
      authority: authority([declaration('individual', [
        { participantId: 'placement-a', weight: null, amount: 10 },
        { participantId: 'placement-b', weight: null, amount: 30 },
        { participantId: 'placement-c', weight: null, amount: 60 },
      ], { destination: { kind: 'group', id: 'party-a', revision: 12 } })]),
    })
    expect(individual.recipientPreviews.map(preview => preview.grantAmount)).toEqual([10, 30, 60])
    expect(individual.allocations[0]).toMatchObject({ method: 'individual', amount: 100, weight: null })
  })

  it('keeps missing or denied declarations non-committable while excluded rewards require no grant', () => {
    const pending = planEncounterSettlementBatchExperience({
      settlement: settlement(),
      authority: authority([]),
    })
    expect(pending).toMatchObject({
      complete: false,
      allocations: [],
      destinationAuthorities: [],
      recipientPreviews: [],
      pendingRewardIds: ['reward-experience-a'],
    })
    expect(() => applyEncounterSettlementBatchExperiencePlan({
      plan: pending,
      currentPokemonSheets: sheets(),
    })).toThrow(/all Experience rewards must be allocated or explicitly excluded/)

    const denied = planEncounterSettlementBatchExperience({
      settlement: settlement(),
      authority: authority([declaration('fixed', undefined, { permission: permission('denied') })]),
    })
    expect(denied).toMatchObject({ complete: false, deniedRewardIds: ['reward-experience-a'] })
    expect(denied.sheetWrites).toEqual([])
    expect(denied.destinationAuthorities[0]?.writes).toEqual([])

    const excluded = planEncounterSettlementBatchExperience({
      settlement: settlement({ disposition: 'excluded' }),
      authority: authority([]),
    })
    expect(excluded).toMatchObject({ complete: true, allocations: [], pendingRewardIds: [] })
  })

  it('applies only one complete revision-bound batch plan and rejects stale retry authority', () => {
    const currentSheets = sheets()
    const plan = planEncounterSettlementBatchExperience({
      settlement: settlement(),
      authority: authority([declaration()], { pokemonSheets: currentSheets }),
    })
    const writes = applyEncounterSettlementBatchExperiencePlan({ plan, currentPokemonSheets: currentSheets })
    expect(writes).toHaveLength(3)
    expect(writes.map(write => write.revision)).toEqual([8, 8, 8])
    expect(writes.map(write => write.nextSheet.totalExp)).toEqual([124, 124, 73])

    const stale = currentSheets.map((entry, index) => index === 0
      ? { ...entry, revision: 8 }
      : entry)
    expect(() => applyEncounterSettlementBatchExperiencePlan({
      plan,
      currentPokemonSheets: stale,
    })).toThrow(/no longer matches the complete batch preview/)
  })

  it('fails closed for invalid recipients, stale or inconsistent sheets, and invalid distribution totals', () => {
    const duplicate = declaration('fixed', [
      { participantId: 'placement-a', weight: null, amount: null },
      { participantId: 'placement-a', weight: null, amount: null },
    ])
    expect(() => planEncounterSettlementBatchExperience({
      settlement: settlement(),
      authority: authority([duplicate]),
    })).toThrow(/unique stable participant identities/)

    const wrongSide = declaration('fixed', undefined, {
      destination: { kind: 'side', id: 'rivals', revision: 12 },
    })
    expect(() => planEncounterSettlementBatchExperience({
      settlement: settlement(),
      authority: authority([wrongSide]),
    })).toThrow(/match the current settlement side authority/)

    expect(() => planEncounterSettlementBatchExperience({
      settlement: settlement(),
      authority: authority([declaration()], {
        pokemonSheets: sheets({
          'pokemon-a': { sheetSlug: 'pokemon-a', revision: 8, sheet: pokemonSheet('pokemon-a', 10, 90) },
        }),
      }),
    })).toThrow(/exact current participant sheet revision/)

    expect(() => planEncounterSettlementBatchExperience({
      settlement: settlement(),
      authority: authority([declaration()], {
        pokemonSheets: sheets({
          'pokemon-a': { sheetSlug: 'pokemon-a', revision: 7, sheet: pokemonSheet('pokemon-a', 10, 50) },
        }),
      }),
    })).toThrow(/consistent with the current Level/)

    expect(() => planEncounterSettlementBatchExperience({
      settlement: settlement({ amount: 100 }),
      authority: authority([declaration('individual', [
        { participantId: 'placement-a', weight: null, amount: 10 },
        { participantId: 'placement-b', weight: null, amount: 20 },
        { participantId: 'placement-c', weight: null, amount: 30 },
      ])]),
    })).toThrow(/sum exactly to the reward total/)
  })

  it('reuses Marsupial sharing and level lifecycle authority, including a zero-XP related sheet write', () => {
    const pouch = {
      motherSheetSlug: 'kangaskhan-mother',
      babySheetSlug: 'kangaskhan-baby',
      experienceSharePercent: 20 as const,
      establishedAt: 100,
      sourceOperationId: 'shelter-operation',
    }
    const template = resolveBreedingMarsupialBabyTemplateV1()
    const babyAuthority = createBreedingBabyTemplateAuthorityV1({
      sourceEggId: 'pokemon-egg:v1:94949494949494949494949494949494',
      babyTemplate: template,
      marsupial: createBreedingMarsupialProviderTraitV1(),
    })
    const mother = pokemonSheet('kangaskhan-mother', 30, pokemonExperienceNeededForLevel(30), {
      species: 'Kangaskhan',
      capabilityCampaignState: { ...createEmptyCapabilityCampaignState(), marsupialPouch: pouch },
    })
    const level25 = pokemonExperienceNeededForLevel(25)!
    const baby = pokemonSheet('kangaskhan-baby', 24, level25 - 10, {
      species: 'Kangaskhan',
      babyTemplate: true,
      babyTemplateMechanics: {
        schemaVersion: 1,
        applicationKind: babyAuthority.applicationKind,
        effects: babyAuthority.effects,
      },
      serverPrivate: { breedingBabyTemplate: babyAuthority },
      capabilityCampaignState: { ...createEmptyCapabilityCampaignState(), marsupialPouch: pouch },
    })
    const currentSettlement = settlement({
      amount: 20,
      participantRows: [{ id: 'baby-placement', slug: 'kangaskhan-baby', revision: 4 }],
    })
    const currentSheets: EncounterSettlementPokemonExperienceAuthority[] = [
      { sheetSlug: mother.slug, revision: 3, sheet: mother },
      { sheetSlug: baby.slug, revision: 4, sheet: baby },
    ]
    const plan = planEncounterSettlementBatchExperience({
      settlement: currentSettlement,
      authority: {
        completeness: 'authoritative-current',
        pokemonSheets: currentSheets,
        declarations: [declaration('individual', [{
          participantId: 'baby-placement', weight: null, amount: 20,
        }], {
          destination: { kind: 'participant', id: 'baby-placement', revision: 4 },
        })],
      },
    })

    expect(plan.recipientPreviews).toEqual([
      expect.objectContaining({
        sheetSlug: 'kangaskhan-baby', grantAmount: 20, levelBefore: 24, levelAfter: 25,
        lifecycleReasonIds: expect.arrayContaining([
          'capability.marsupial.baby-template-ended',
          'capability.marsupial.pouch-ended',
        ]),
      }),
      expect.objectContaining({
        sheetSlug: 'kangaskhan-mother', grantAmount: 0,
        lifecycleReasonIds: ['capability.marsupial.pouch-ended'],
      }),
    ])
    const writes = plan.destinationAuthorities[0]!.writes
    expect(writes).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetAuthority: expect.objectContaining({ id: 'kangaskhan-baby' }), amount: 20, countsTowardAllocation: true }),
      expect.objectContaining({ targetAuthority: expect.objectContaining({ id: 'kangaskhan-mother' }), amount: 0, countsTowardAllocation: false }),
    ]))
    expect(plan.sheetWrites.find(write => write.sheetSlug === 'kangaskhan-baby')?.nextSheet.capabilityCampaignState?.marsupialPouch ?? null).toBeNull()
    expect(plan.sheetWrites.find(write => write.sheetSlug === 'kangaskhan-mother')?.nextSheet.capabilityCampaignState?.marsupialPouch ?? null).toBeNull()

    const rewardPlan = planEncounterSettlementRewardPackage({
      settlement: plan.document,
      authority: { completeness: 'authoritative-current', destinations: plan.destinationAuthorities },
    })
    expect(rewardPlan.eligible).toBe(true)
  })

  it('rejects partial snapshots and corrupt relationship authority instead of dropping side effects', () => {
    expect(() => planEncounterSettlementBatchExperience({
      settlement: settlement(),
      authority: { ...authority([declaration()]), completeness: 'partial' } as any,
    })).toThrowError(EncounterSettlementExperienceAllocationError)

    const malformed = sheets()
    malformed[0] = {
      ...malformed[0]!,
      sheet: {
        ...malformed[0]!.sheet,
        capabilityCampaignState: {
          ...createEmptyCapabilityCampaignState(),
          marsupialPouch: {
            motherSheetSlug: 'pokemon-a',
            babySheetSlug: 'missing-baby',
            experienceSharePercent: 20,
            establishedAt: 1,
            sourceOperationId: 'broken-pouch',
          },
        },
      },
    }
    expect(() => planEncounterSettlementBatchExperience({
      settlement: settlement(),
      authority: authority([declaration()], { pokemonSheets: malformed }),
    })).toThrow(/counterpart sheet is unavailable/)
  })
})
