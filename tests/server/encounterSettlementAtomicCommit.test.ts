import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import {
  createEncounterSettlementDocument,
  parseEncounterSettlementDocument,
  type EncounterSettlementDocument,
  type EncounterSettlementParticipant,
} from '#shared/encounterSettlement/document'
import { createEncounterDocument, parseEncounterDocument } from '#shared/encounterDocuments/model'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { applyCombatStagesToSheet } from '~/utils/sheetMutations'
import { pokemonExperienceNeededForLevel } from '~/utils/sheets/pokemonExperience'
import {
  assertEncounterSettlementAtomicPlanCurrent,
  EncounterSettlementAtomicCommitError,
  planEncounterSettlementAtomicCommit,
  type EncounterSettlementAtomicAuthoritySnapshot,
  type EncounterSettlementAtomicComponentPlans,
} from '../../server/domain/encounterSettlement/atomicCommit'
import {
  planEncounterSettlementBatchExperience,
  type EncounterSettlementExperienceAuthoritySnapshot,
} from '../../server/domain/encounterSettlement/experienceAllocation'
import type { EncounterSettlementLootAllocationPlan } from '../../server/domain/encounterSettlement/lootAllocation'
import type { EncounterSettlementCapturePlan } from '../../server/domain/encounterSettlement/captureSettlement'
import { planEncounterSettlementOutcomes } from '../../server/domain/encounterSettlement/outcomeSettlement'
import {
  ENCOUNTER_SETTLEMENT_CLEANUP_SOURCE_IDS,
  planEncounterSettlementTemporaryCleanup,
} from '../../server/domain/encounterSettlement/temporaryCleanup'

const participant: EncounterSettlementParticipant = {
  participantId: 'participant-mon-a',
  sourceAuthority: { kind: 'map', id: 'atomic-arena', revision: 20 },
  sheetKind: 'pokemon',
  sheetSlug: 'mon-a',
  sheetRevision: 4,
  sideId: 'heroes',
  ownerParticipantId: null,
  settlementRole: 'combatant',
  disposition: 'active',
}

const sheet = (): CharacterSheet => {
  const base = {
    slug: 'mon-a',
    species: 'Bulbasaur',
    nickname: 'Bud',
    level: 10,
    totalExp: pokemonExperienceNeededForLevel(10)!,
    revision: 4,
    updatedAt: 900,
    combat: { currentHp: 13, injuries: 1, conditions: ['Poisoned'] },
    stats: {
      atk: { stage: 0 }, def: { stage: 0 }, satk: { stage: 0 },
      sdef: { stage: 0 }, spd: { stage: 0 },
    },
    combatStages: { acc: 0 },
    movelist: [],
  }
  return applyCombatStagesToSheet('pokemon', base as never, {
    atk: 3, def: -1, satk: 0, sdef: 2, spd: 1, acc: 2,
  }) as unknown as CharacterSheet
}

const map = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'atomic-arena',
  name: 'Atomic Arena',
  folder: '',
  revision: 20,
  updatedAt: 900,
  dimensions: { x: 8, y: 3, z: 8 },
  voxels: [],
  placements: [{
    id: 'token-a', sheetKind: 'pokemon', sheetSlug: 'mon-a',
    position: { x: 1, y: 0, z: 1 }, initiative: 12,
  }],
  initiative: { activeId: 'token-a', round: 2 },
  encounterState: createEmptyEncounterState(),
})

const encounterDocument = () => parseEncounterDocument({
  ...createEncounterDocument({
    encounterId: 'encounter-atomic-a',
    name: 'Atomic encounter',
    linkedMapSlug: 'atomic-arena',
    recipe: 'trainer-duel',
    now: 800,
  }),
  revision: 12,
  lifecycle: 'active',
  updatedAt: 900,
})

const settlement = (overrides: Partial<EncounterSettlementDocument> = {}): EncounterSettlementDocument => {
  const created = createEncounterSettlementDocument({
    settlementId: 'encounter-settlement:v1:00000000000000000000000000000080',
    rewardPackageId: 'atomic-rewards-a',
    encounter: {
      encounterId: 'encounter-atomic-a', encounterRevision: 12,
      linkedMapSlug: 'atomic-arena', linkedMapRevision: 20, campaignMinute: 480,
    },
  })
  return parseEncounterSettlementDocument({
    ...created,
    status: 'ready',
    participants: [participant],
    rewardPackage: {
      rewardPackageId: 'atomic-rewards-a',
      status: 'ready',
      lines: [{
        rewardId: 'reward-xp-a',
        visibility: 'participant-owner',
        sourceAuthority: { kind: 'encounter-document', id: 'encounter-atomic-a', revision: 12 },
        disposition: 'pending',
        payload: { kind: 'experience', amount: 25 },
      }],
    },
    temporaryCleanup: [{
      cleanupId: 'cleanup-stage-a',
      kind: 'combat-stages',
      authority: { kind: 'map', id: 'atomic-arena', revision: 20 },
      participantIds: ['participant-mon-a'],
      sourceIds: ['sheet:pokemon:mon-a'],
      behavior: 'reset', state: 'ready', decisionId: null, receiptId: null,
    }, {
      cleanupId: 'cleanup-resource-a',
      kind: 'encounter-resources',
      authority: { kind: 'map', id: 'atomic-arena', revision: 20 },
      participantIds: ['participant-mon-a'],
      sourceIds: [ENCOUNTER_SETTLEMENT_CLEANUP_SOURCE_IDS.encounterResources],
      behavior: 'reset', state: 'ready', decisionId: null, receiptId: null,
    }, {
      cleanupId: 'cleanup-initiative-a',
      kind: 'initiative',
      authority: { kind: 'map', id: 'atomic-arena', revision: 20 },
      participantIds: ['participant-mon-a'],
      sourceIds: [ENCOUNTER_SETTLEMENT_CLEANUP_SOURCE_IDS.initiative],
      behavior: 'reset', state: 'ready', decisionId: null, receiptId: null,
    }],
    createdAtCampaignMinute: 480,
    updatedAtCampaignMinute: 480,
    ...overrides,
  })
}

const components = (base: EncounterSettlementDocument = settlement()): EncounterSettlementAtomicComponentPlans => {
  const currentSheet = sheet()
  const experience = planEncounterSettlementBatchExperience({
    settlement: base,
    authority: {
      completeness: 'authoritative-current',
      pokemonSheets: [{ sheetSlug: 'mon-a', revision: 4, sheet: currentSheet }],
      declarations: [{
        rewardId: 'reward-xp-a',
        destination: { kind: 'participant', id: 'participant-mon-a', revision: 4 },
        method: 'fixed',
        recipients: [{ participantId: 'participant-mon-a', weight: null, amount: null }],
        permission: {
          status: 'allowed',
          authority: { kind: 'encounter-document', id: 'encounter-atomic-a', revision: 12 },
          reasonId: null,
        },
      }],
    } satisfies EncounterSettlementExperienceAuthoritySnapshot,
  })
  const outcomes = planEncounterSettlementOutcomes({
    settlement: base,
    authority: {
      completeness: 'authoritative-current',
      encounterDocument: encounterDocument(),
      declarations: [],
      campaignConsequencesComplete: true,
      campaignConsequences: [],
      authorization: {
        status: 'allowed',
        authority: { kind: 'encounter-document', id: 'encounter-atomic-a', revision: 12 },
        reasonId: null,
      },
      writeTimestamp: 1_000,
    },
  })
  const cleanup = planEncounterSettlementTemporaryCleanup({
    settlement: base,
    authority: {
      completeness: 'authoritative-current',
      map: map(),
      sheetsComplete: true,
      sheets: [{ kind: 'pokemon', slug: 'mon-a', revision: 4, document: currentSheet }],
      activeReservationOperationIds: [],
      transformationsComplete: true,
      transformations: [],
      authorization: {
        status: 'allowed', authority: { kind: 'map', id: 'atomic-arena', revision: 20 }, reasonId: null,
      },
      writeTimestamp: 1_000,
    },
  })
  const loot: EncounterSettlementLootAllocationPlan = {
    complete: true, document: base, allocations: [], destinationAuthorities: [], previews: [],
    containerWrites: [], pendingRewardIds: [], deniedRewardIds: [],
  }
  const capture: EncounterSettlementCapturePlan = {
    complete: true,
    authorityDefinitionSha256: 'a'.repeat(64),
    document: base,
    allocations: [], destinationAuthorities: [], previews: [], sheetWrites: [],
    requiredDecisions: [], pendingRewardIds: [], deniedRewardIds: [],
  }
  return { experience, loot, capture, outcomes, cleanup }
}

const authority = (
  base: EncounterSettlementDocument = settlement(),
  overrides: Partial<EncounterSettlementAtomicAuthoritySnapshot> = {},
): EncounterSettlementAtomicAuthoritySnapshot => ({
  completeness: 'authoritative-current',
  settlement: base,
  eligibility: {
    completeness: 'authoritative-current',
    encounter: base.encounter,
    participants: [participant],
    blockingFacts: [],
  },
  sheetsComplete: true,
  sheets: [{ kind: 'pokemon', slug: 'mon-a', revision: 4, document: sheet() }],
  groupsComplete: true,
  groups: [],
  map: map(),
  encounterDocument: encounterDocument(),
  additionalRewardDestinations: [],
  ...overrides,
})

const plan = () => {
  const base = settlement()
  return planEncounterSettlementAtomicCommit({
    operationId: 'settlement-operation:atomic-commit-a',
    campaignMinute: 500,
    committedAt: 1_000,
    authority: authority(base),
    components: components(base),
  })
}

describe('atomic encounter settlement plan', () => {
  it('merges disjoint XP and cleanup writes into one sheet revision and terminalizes every domain', () => {
    const result = plan()

    expect(result.rewardValidation).toMatchObject({ eligible: true, issues: [] })
    expect(result.sheetWrites).toHaveLength(1)
    expect(result.sheetWrites[0]).toMatchObject({
      kind: 'pokemon', slug: 'mon-a', expectedRevision: 4, revision: 5,
      sourceKinds: ['cleanup', 'experience'],
    })
    const nextSheet = result.sheetWrites[0]!.nextDocument as CharacterSheet
    expect(nextSheet.level).toBe(11)
    expect(nextSheet.totalExp).toBe(115)
    expect((nextSheet as any).stats.atk.stage).toBe(0)
    expect((nextSheet as any).combatStages.acc).toBe(0)
    expect((nextSheet as any).combat).toEqual({ currentHp: 13, injuries: 1, conditions: ['Poisoned'] })

    expect(result.encounterWrite).toMatchObject({ expectedRevision: 12, revision: 13 })
    expect(result.mapWrite).toMatchObject({ expectedRevision: 20, revision: 21 })
    expect(result.mapWrite?.nextMap.initiative).toEqual({ activeId: null, round: 1 })
    expect(result.mapWrite?.nextMap.placements[0]?.initiative).toBeUndefined()
    expect(result.settlementWrite).toMatchObject({ expectedRevision: 0, revision: 1 })
    expect(result.settlementWrite.nextDocument).toMatchObject({
      status: 'completed',
      rewardPackage: { status: 'committed', lines: [expect.objectContaining({ disposition: 'committed' })] },
      completion: {
        state: 'accepted',
        operationId: 'settlement-operation:atomic-commit-a',
        completedEncounterRevision: 13,
        completedAtCampaignMinute: 500,
      },
    })
    expect(result.settlementWrite.nextDocument.allocations).toEqual([
      expect.objectContaining({ state: 'applied', receiptId: expect.any(String) }),
    ])
    expect(result.settlementWrite.nextDocument.temporaryCleanup.every(row => row.state === 'applied')).toBe(true)
    expect(result.historyFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'experience-award', resultCode: 'experience-committed' }),
      expect.objectContaining({ kind: 'cleanup' }),
      expect.objectContaining({ kind: 'completion' }),
    ]))
    expect(result.attentionSources).toEqual([
      expect.objectContaining({ reason: 'level-threshold', entityKind: 'pokemon-sheet', entityId: 'mon-a' }),
    ])
    expect(result.planDefinitionSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(assertEncounterSettlementAtomicPlanCurrent({ plan: result, currentAuthority: authority() })).toBe(result)
  })

  it('is deterministic for exact authority and rejects stale authority', () => {
    const first = plan()
    const second = plan()
    expect(second.planDefinitionSha256).toBe(first.planDefinitionSha256)
    expect(second.settlementWrite).toEqual(first.settlementWrite)
    expect(second.sheetWrites).toEqual(first.sheetWrites)

    expect(() => assertEncounterSettlementAtomicPlanCurrent({
      plan: first,
      currentAuthority: authority(settlement(), { map: { ...map(), revision: 21 } }),
    })).toThrowError(EncounterSettlementAtomicCommitError)
  })

  it('fails closed for incomplete providers, unresolved gates, and overlapping divergent sheet writes', () => {
    const base = settlement()
    const incomplete = components(base)
    expect(() => planEncounterSettlementAtomicCommit({
      operationId: 'settlement-operation:atomic-incomplete', campaignMinute: 500, committedAt: 1_000,
      authority: authority(base),
      components: { ...incomplete, loot: { ...incomplete.loot, complete: false } },
    })).toThrow(/every reward, outcome, and cleanup provider must be complete/)

    expect(() => planEncounterSettlementAtomicCommit({
      operationId: 'settlement-operation:atomic-blocked', campaignMinute: 500, committedAt: 1_000,
      authority: authority(base, {
        eligibility: {
          ...authority(base).eligibility,
          blockingFacts: [{
            factId: 'pending-resolution-a', kind: 'pending-resolution', audience: 'public',
            authorityRefs: [{ kind: 'map', id: 'atomic-arena', revision: 20 }],
            participantIds: ['participant-mon-a'], resolutionKinds: ['retry-exact'],
          }],
        },
      }),
      components: components(base),
    })).toThrow(/blocking settlement gates/)

    const conflict = components(base)
    const before = sheet()
    const conflictingNext = { ...before, level: 99, revision: 5 }
    const hash = (value: unknown) => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
    expect(() => planEncounterSettlementAtomicCommit({
      operationId: 'settlement-operation:atomic-conflict', campaignMinute: 500, committedAt: 1_000,
      authority: authority(base),
      components: {
        ...conflict,
        capture: {
          ...conflict.capture,
          sheetWrites: [{
            kind: 'pokemon', slug: 'mon-a', expectedRevision: 4, revision: 5,
            beforeDefinitionSha256: hash(before), afterDefinitionSha256: hash(conflictingNext),
            nextSheet: conflictingNext,
          }],
        },
      },
    })).toThrow(/changed divergently by more than one settlement provider/)
  })

  it('rejects terminal replanning before exposing writes', () => {
    const terminal = plan().settlementWrite.nextDocument
    expect(() => planEncounterSettlementAtomicCommit({
      operationId: 'settlement-operation:atomic-terminal', campaignMinute: 501, committedAt: 1_001,
      authority: authority(terminal, {
        settlement: terminal,
        eligibility: {
          completeness: 'authoritative-current', encounter: terminal.encounter,
          participants: terminal.participants, blockingFacts: [],
        },
      }),
      components: components(settlement()),
    })).toThrow(/cannot create a new atomic plan/)
  })
})
