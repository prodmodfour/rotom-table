import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import {
  createEncounterSettlementDocument,
  parseEncounterSettlementDocument,
  type EncounterSettlementAuthorityRef,
  type EncounterSettlementDocument,
} from '../../shared/encounterSettlement/document'
import { normalizePlayerProfile } from '../../shared/playerProfiles'
import {
  applyEncounterSettlementCapturePlan,
  EncounterSettlementCaptureError,
  planEncounterSettlementCaptures,
  type AcceptedEncounterSettlementCaptureRecordV1,
  type EncounterSettlementCaptureAuthoritySnapshot,
  type EncounterSettlementCaptureDeclaration,
} from '../../server/domain/encounterSettlement/captureSettlement'
import { planEncounterSettlementRewardPackage } from '../../server/domain/encounterSettlement/rewardPackage'
import type { CharacterSheet } from '../../src/types/characterSheet'
import type { TrainerSheet } from '../../src/types/trainerSheet'

const settlementId = 'encounter-settlement:v1:00000000000000000000000000000077'
const profile = normalizePlayerProfile({
  schemaVersion: 1,
  id: 'profile_capture01',
  displayName: 'Capture Player',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-a' }],
})
const hash = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const ref = (kind: EncounterSettlementAuthorityRef['kind'], id: string, revision: number) => ({ kind, id, revision })
const captureRef = ref('capture-operation', 'capture-operation-a', 1)

const settlement = (overrides: Partial<EncounterSettlementDocument> = {}): EncounterSettlementDocument => {
  const created = createEncounterSettlementDocument({
    settlementId,
    rewardPackageId: 'capture-rewards-a',
    encounter: {
      encounterId: 'encounter-capture-a',
      encounterRevision: 12,
      linkedMapSlug: 'arena-a',
      linkedMapRevision: 20,
      campaignMinute: 480,
    },
  })
  return parseEncounterSettlementDocument({
    ...created,
    participants: [{
      participantId: 'captured-placement-a',
      sourceAuthority: ref('map', 'arena-a', 20),
      sheetKind: 'pokemon',
      sheetSlug: 'captured-a',
      sheetRevision: 4,
      sideId: 'wild',
      ownerParticipantId: null,
      settlementRole: 'combatant',
      disposition: 'captured',
    }],
    rewardPackage: {
      rewardPackageId: 'capture-rewards-a',
      status: 'ready',
      lines: [{
        rewardId: 'reward-capture-a',
        visibility: 'destination-owner',
        sourceAuthority: captureRef,
        disposition: 'pending',
        payload: {
          kind: 'capture',
          captureOperationId: 'capture-operation-a',
          pokemonSheetSlug: 'captured-a',
        },
      }],
    },
    ...overrides,
  })
}

const trainer = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'trainer-a',
  revision: 7,
  updatedAt: 10,
  name: 'Trainer A',
  level: 5,
  currentTeam: ['partner-a'],
  boxedPokemon: ['captured-a'],
  ...overrides,
})

const captured = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'captured-a',
  revision: 4,
  updatedAt: 10,
  nickname: 'Pidgey',
  species: 'Pidgey',
  level: 3,
  caughtBall: 'Great Ball',
  ...overrides,
})

const record = (overrides: Partial<AcceptedEncounterSettlementCaptureRecordV1> = {}): AcceptedEncounterSettlementCaptureRecordV1 => ({
  schemaVersion: 1,
  captureOperationId: 'capture-operation-a',
  sourceAuthority: captureRef,
  acceptedResultSha256: 'a'.repeat(64),
  provenanceDefinitionSha256: 'b'.repeat(64),
  actorProfileId: profile.id,
  trainerSheetSlug: 'trainer-a',
  trainerRevisionAfterCapture: 6,
  pokemonSheetSlug: 'captured-a',
  pokemonRevisionAfterCapture: 3,
  rosterDestinationAfterCapture: 'box',
  caughtBall: 'Great Ball',
  namingRequirement: 'required',
  acceptedAtCampaignMinute: 470,
  ...overrides,
})

const allowed = () => ({
  status: 'allowed' as const,
  authority: ref('sheet', 'trainer-a', 7),
  reasonId: null,
})

const declaration = (overrides: Partial<EncounterSettlementCaptureDeclaration> = {}): EncounterSettlementCaptureDeclaration => ({
  rewardId: 'reward-capture-a',
  destination: { kind: 'profile', id: profile.id, revision: 2 },
  ownerTrainerSlug: 'trainer-a',
  rosterDestination: 'team',
  nicknameDecision: 'set',
  nickname: 'Gale',
  permission: allowed(),
  ...overrides,
})

const authority = (
  declarations: readonly EncounterSettlementCaptureDeclaration[] = [declaration()],
  overrides: Partial<EncounterSettlementCaptureAuthoritySnapshot> = {},
): EncounterSettlementCaptureAuthoritySnapshot => ({
  completeness: 'authoritative-current',
  captureRecords: [record()],
  trainerSheets: [{ slug: 'trainer-a', revision: 7, sheet: trainer() }],
  pokemonSheets: [{ slug: 'captured-a', revision: 4, sheet: captured() }],
  profiles: [{ profileId: profile.id, revision: 2, definitionSha256: hash(profile), profile }],
  declarations,
  ...overrides,
})

describe('encounter settlement captures', () => {
  it('reuses accepted capture evidence, assigns team custody, names the sheet, and preserves caught-ball provenance', () => {
    const currentAuthority = authority()
    const plan = planEncounterSettlementCaptures({ settlement: settlement(), authority: currentAuthority })

    expect(plan.complete).toBe(true)
    expect(plan.requiredDecisions).toEqual([])
    expect(plan.allocations).toEqual([
      expect.objectContaining({ rewardId: 'reward-capture-a', method: 'whole', amount: 1 }),
    ])
    expect(plan.previews).toEqual([
      expect.objectContaining({
        pokemonSheetSlug: 'captured-a', rosterBefore: 'box', rosterAfter: 'team',
        nicknameChanged: true, teamSlotsBefore: 1, teamSlotsAfter: 2, caughtBallPreserved: true,
      }),
    ])
    const trainerWrite = plan.sheetWrites.find(write => write.kind === 'trainer')!
    expect(trainerWrite).toMatchObject({ expectedRevision: 7, revision: 8 })
    expect((trainerWrite.nextSheet as TrainerSheet).currentTeam).toEqual(['partner-a', 'captured-a'])
    expect((trainerWrite.nextSheet as TrainerSheet).boxedPokemon).toEqual([])
    const pokemonWrite = plan.sheetWrites.find(write => write.kind === 'pokemon')!
    expect(pokemonWrite).toMatchObject({ expectedRevision: 4, revision: 5 })
    expect(pokemonWrite.nextSheet).toMatchObject({ nickname: 'Gale', caughtBall: 'Great Ball' })

    const rewardPlan = planEncounterSettlementRewardPackage({
      settlement: plan.document,
      authority: { completeness: 'authoritative-current', destinations: plan.destinationAuthorities },
    })
    expect(rewardPlan).toMatchObject({ eligible: true, issues: [] })
    expect(rewardPlan.writePreviews).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'capture-destination', amount: 1, countsTowardAllocation: true }),
      expect.objectContaining({ field: 'capture-destination', amount: 0, countsTowardAllocation: false }),
    ]))
    expect(applyEncounterSettlementCapturePlan({ plan, currentAuthority })).toEqual(plan.sheetWrites)
  })

  it('keeps missing assignment and naming choices visibly pending', () => {
    const missing = planEncounterSettlementCaptures({
      settlement: settlement(),
      authority: authority([]),
    })
    expect(missing).toMatchObject({
      complete: false,
      pendingRewardIds: ['reward-capture-a'],
      allocations: [],
      requiredDecisions: [expect.objectContaining({ kind: 'assignment', pokemonSheetSlug: 'captured-a' })],
    })

    const naming = planEncounterSettlementCaptures({
      settlement: settlement(),
      authority: authority([declaration({ nicknameDecision: null, nickname: null })]),
    })
    expect(naming).toMatchObject({
      complete: false,
      pendingRewardIds: ['reward-capture-a'],
      requiredDecisions: [expect.objectContaining({ kind: 'naming' })],
      sheetWrites: [],
    })
    expect(() => applyEncounterSettlementCapturePlan({
      plan: naming,
      currentAuthority: authority([declaration({ nicknameDecision: null, nickname: null })]),
    })).toThrow(/complete capture authority changed before application/)
  })

  it('handles full-team overflow as a box-only required decision instead of silently reassigning', () => {
    const fullTrainer = trainer({
      currentTeam: ['one', 'two', 'three', 'four', 'five', 'six'],
      boxedPokemon: ['captured-a'],
    })
    const plan = planEncounterSettlementCaptures({
      settlement: settlement(),
      authority: authority([declaration()], {
        trainerSheets: [{ slug: 'trainer-a', revision: 7, sheet: fullTrainer }],
      }),
    })
    expect(plan).toMatchObject({
      complete: false,
      pendingRewardIds: ['reward-capture-a'],
      requiredDecisions: [expect.objectContaining({
        kind: 'team-capacity', legalRosterDestinations: ['box'],
      })],
      sheetWrites: [],
    })

    const boxed = planEncounterSettlementCaptures({
      settlement: settlement(),
      authority: authority([declaration({ rosterDestination: 'box' })], {
        trainerSheets: [{ slug: 'trainer-a', revision: 7, sheet: fullTrainer }],
      }),
    })
    expect(boxed).toMatchObject({ complete: true, pendingRewardIds: [] })
    expect(boxed.previews[0]).toMatchObject({ rosterBefore: 'box', rosterAfter: 'box', teamSlotsAfter: 6 })
  })

  it('rejects changed provenance, duplicate custody, invalid Profile ownership, and forged source records', () => {
    expect(() => planEncounterSettlementCaptures({
      settlement: settlement(),
      authority: authority(undefined, {
        pokemonSheets: [{ slug: 'captured-a', revision: 4, sheet: captured({ caughtBall: 'Basic Ball' }) }],
      }),
    })).toThrow(/original accepted caught-ball field changed/)

    expect(() => planEncounterSettlementCaptures({
      settlement: settlement(),
      authority: authority(undefined, {
        trainerSheets: [{
          slug: 'trainer-a', revision: 7,
          sheet: trainer({ currentTeam: ['captured-a'], boxedPokemon: ['captured-a'] }),
        }],
      }),
    })).toThrow(/unique, disjoint/)

    const otherProfile = normalizePlayerProfile({
      schemaVersion: 1,
      id: 'profile_capture02',
      displayName: 'Other',
      linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'other-trainer' }],
    })
    expect(() => planEncounterSettlementCaptures({
      settlement: settlement(),
      authority: authority([declaration({
        destination: { kind: 'profile', id: otherProfile.id, revision: 1 },
      })], {
        profiles: [{ profileId: otherProfile.id, revision: 1, definitionSha256: hash(otherProfile), profile: otherProfile }],
      }),
    })).toThrow(/must currently control/)

    expect(() => planEncounterSettlementCaptures({
      settlement: settlement(),
      authority: authority(undefined, { captureRecords: [record({ captureOperationId: 'forged-operation' })] }),
    })).toThrow(/exact accepted capture operation/)
  })

  it('fails closed for partial authority, stale apply, foreign allocations, and terminal settlement', () => {
    expect(() => planEncounterSettlementCaptures({
      settlement: settlement(),
      authority: { ...authority(), completeness: 'partial' } as any,
    })).toThrowError(EncounterSettlementCaptureError)

    const currentAuthority = authority()
    const plan = planEncounterSettlementCaptures({ settlement: settlement(), authority: currentAuthority })
    const stale = authority(undefined, {
      trainerSheets: [{ slug: 'trainer-a', revision: 7, sheet: trainer({ updatedAt: 11 }) }],
    })
    expect(() => applyEncounterSettlementCapturePlan({ plan, currentAuthority: stale }))
      .toThrow(/complete capture authority changed before application/)

    expect(() => planEncounterSettlementCaptures({
      settlement: settlement({
        allocations: [{
          allocationId: 'foreign-capture-allocation',
          rewardId: 'reward-capture-a',
          destination: { kind: 'profile', id: profile.id, revision: 2 },
          method: 'whole', amount: 1, weight: null, state: 'proposed', decisionId: null, receiptId: null,
        }],
      }),
      authority: authority(),
    })).toThrow(/owned by another provider/)

    expect(() => planEncounterSettlementCaptures({
      settlement: settlement({ status: 'committing' }),
      authority: authority(),
    })).toThrow(/cannot re-plan captures/)
  })
})
