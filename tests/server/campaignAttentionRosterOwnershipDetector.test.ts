import { describe, expect, it } from 'vitest'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import eggContractJson from '../../data/breeding-automation/egg-contract.json'
import lineageContractJson from '../../data/breeding-automation/lineage-contract.json'
import type { CharacterSheet } from '../../src/types/characterSheet'
import type { TrainerSheet } from '../../src/types/trainerSheet'
import type { StoredSheetDocument } from '../../server/storage/sheetRepository'
import type { BreedingOperationLedgerRecord } from '../../server/storage/breedingOperationRepository'
import type {
  StoredEncounterSettlementAttentionSource,
  StoredEncounterSettlementHistoryFact,
} from '../../server/storage/encounterSettlementRepository'
import {
  campaignProfileAuthorityDefinitionSha256,
  CAMPAIGN_ROSTER_OWNERSHIP_ATTENTION_LIMIT,
  projectCampaignRosterOwnershipAttention,
  type CampaignProfileAuthorityV1,
} from '../../server/domain/campaignAttention/rosterOwnershipDetector'
import {
  createPokemonBreedingOriginFromHatchedEgg,
  createPokemonEggOffspringBlueprintV1,
} from '../../server/domain/breeding/lineage'
import {
  createBreedingOperationAcceptedV1,
  createBreedingOperationCommandHash,
} from '../../server/domain/breeding/operations'
import {
  parsePokemonEggDocumentV1,
  type PokemonEggDocumentV1,
} from '../../shared/breeding/egg'
import { parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import type { PokemonBreedingOriginV1 } from '../../shared/breeding/lineage'
import { normalizePlayerProfile, type PlayerProfile } from '../../shared/playerProfiles'
import { activeEquipmentState } from '../fixtures/equipment'

const profileId = 'profile_owner0001'
const pokemon = (slug = 'sprig', overrides: Partial<CharacterSheet> = {}, revision = 4): StoredSheetDocument => ({
  kind: 'pokemon', slug, revision, updatedAt: 1_000,
  document: {
    slug, nickname: slug === 'hatch-child' ? 'Bulbasaur' : 'Sprig',
    species: 'Bulbasaur', level: 5, revision,
    ...overrides,
  } satisfies CharacterSheet,
})
const trainer = (overrides: Partial<TrainerSheet> = {}, revision = 3): StoredSheetDocument => ({
  kind: 'trainer', slug: 'ash', revision, updatedAt: 1_000,
  document: { slug: 'ash', name: 'Ash', level: 5, revision, ...overrides } satisfies TrainerSheet,
})
const profile = (linkedCharacters: PlayerProfile['linkedCharacters'] = [
  { sheetKind: 'trainer', sheetSlug: 'ash' },
]): CampaignProfileAuthorityV1 => {
  const value = normalizePlayerProfile({
    schemaVersion: 1, id: profileId, displayName: 'Owner', linkedCharacters,
  })
  return {
    profileId: value.id,
    revision: 0,
    definitionSha256: campaignProfileAuthorityDefinitionSha256(value),
    profile: value,
  }
}

const capture = (status: 'open' | 'resolved' = 'open'): {
  readonly source: StoredEncounterSettlementAttentionSource
  readonly fact: StoredEncounterSettlementHistoryFact
} => {
  const resolved = status === 'resolved'
  return {
    source: {
      sourceId: 'settlement-capture-attention-0001',
      settlementId: 'settlement-capture-0001',
      operationId: 'settlement-finish-operation-0001',
      reason: 'capture-review',
      audience: 'owner',
      entityKind: 'pokemon-sheet',
      entityId: 'sprig',
      sourceFactId: 'settlement-capture-fact-0001',
      authority: { kind: 'sheet', id: 'sprig', revision: 4 },
      status,
      revision: resolved ? 1 : 0,
      createdAtCampaignMinute: 500,
      resolvedAtCampaignMinute: resolved ? 510 : null,
      resolutionOperationId: resolved ? 'capture-review-resolution-0001' : null,
    },
    fact: {
      factId: 'settlement-capture-fact-0001',
      settlementId: 'settlement-capture-0001',
      operationId: 'settlement-finish-operation-0001',
      kind: 'capture-settled',
      audience: 'destination-owner',
      subjectKind: 'capture',
      subjectId: 'sprig',
      resultCode: 'capture-box',
      payload: { rewardId: 'capture-reward-0001', caughtBallPreserved: true },
      createdAtCampaignMinute: 500,
    },
  }
}

interface ProjectOverrides {
  readonly sheets?: readonly StoredSheetDocument[]
  readonly profiles?: readonly CampaignProfileAuthorityV1[]
  readonly captures?: readonly ReturnType<typeof capture>[]
  readonly eggs?: readonly PokemonEggDocumentV1[]
  readonly origins?: readonly PokemonBreedingOriginV1[]
  readonly operations?: readonly BreedingOperationLedgerRecord[]
  readonly completeness?: Partial<Record<
    'sheets' | 'profiles' | 'settlementSources' | 'historyFacts' | 'eggs' | 'breedingOrigins' | 'breedingOperations',
    true
  >>
}
const project = (overrides: ProjectOverrides = {}) => {
  const captures = overrides.captures ?? []
  return projectCampaignRosterOwnershipAttention({
    sheets: overrides.sheets ?? [trainer(), pokemon()],
    profiles: overrides.profiles ?? [profile()],
    settlementSources: captures.map(row => row.source),
    historyFacts: captures.map(row => row.fact),
    eggs: overrides.eggs ?? [],
    breedingOrigins: overrides.origins ?? [],
    breedingOperations: overrides.operations ?? [],
    campaignMinute: 600,
    completeness: {
      sheets: true,
      profiles: true,
      settlementSources: true,
      historyFacts: true,
      eggs: true,
      breedingOrigins: true,
      breedingOperations: true,
      ...overrides.completeness,
    },
  })
}

const EGG_ID = 'pokemon-egg:v1:22222222222222222222222222222222'
const ORIGIN_ID = 'pokemon-breeding-origin:v1:11111111111111111111111111111111'
const op = (value: number): `breeding-operation:v1:${string}` => (
  `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
)
const hatchedAuthority = (): {
  readonly egg: PokemonEggDocumentV1
  readonly origin: PokemonBreedingOriginV1
  readonly operation: BreedingOperationLedgerRecord
} => {
  const offspring = createPokemonEggOffspringBlueprintV1({
    schemaVersion: 1,
    speciesId: 'bulbasaur',
    familyRootSpeciesId: 'bulbasaur',
    speciesSpecDefinitionSha256: 'b'.repeat(64),
    nature: {
      valueId: 'cuddly', resolutionKind: 'rank-choice', rollRecordId: null,
      optionId: 'option:v1:10000000000000000000000000000000' as never,
      choiceEvidenceId: 'nature-choice',
    },
    ability: {
      valueId: 'overgrow', resolutionKind: 'rank-choice', rollRecordId: null,
      optionId: 'option:v1:20000000000000000000000000000000' as never,
      choiceEvidenceId: 'ability-choice',
    },
    gender: {
      valueId: 'female', resolutionKind: 'rank-choice', rollRecordId: null,
      optionId: 'option:v1:30000000000000000000000000000000' as never,
      choiceEvidenceId: 'gender-choice',
    },
    inheritanceCandidates: [],
    startingLevel: 1,
    babyTemplate: { applied: false, choiceOptionId: null, choiceEvidenceId: null, effects: null },
  })
  const egg = parsePokemonEggDocumentV1({
    schemaVersion: 1,
    eggId: EGG_ID,
    revision: 5,
    status: 'hatched',
    ownerTrainerSlug: 'ash',
    source: {
      kind: 'gm', reasonId: 'breeding.egg-source.reviewed',
      evidenceDefinitionSha256: 'e'.repeat(64),
    },
    ruleset: { rulesetId: rulesetJson.rulesetId, definitionSha256: rulesetJson.definitionSha256 },
    definitionHashes: [
      eggContractJson.definitionSha256,
      lineageContractJson.definitionSha256,
      rulesetJson.definitionSha256,
    ].sort(),
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
    special: {
      state: 'normal',
      rollRecordId: 'breeding-roll:v1:11111111111111111111111111111111',
      rollTotal: 50,
      triggerIds: [], adjudicationId: null, outcomeId: null, automaticShiny: false,
    },
    hatchOperationId: op(2),
    childSheetSlug: 'hatch-child',
    terminal: null,
    createdAtCampaignMinute: 1,
    updatedAtCampaignMinute: 11,
    statusChangedAtCampaignMinute: 11,
    lastOperationId: op(3),
  })
  const origin = createPokemonBreedingOriginFromHatchedEgg({
    originId: ORIGIN_ID as never,
    egg,
  })
  const command = parseBreedingOperationCommandV1({
    schemaVersion: 1,
    operationId: op(3),
    commandKind: 'complete-hatch',
    actor: { profileId, selectedTrainerSlug: 'ash' },
    ruleset: egg.ruleset,
    scopes: [
      { kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: 4 },
      { kind: 'trainer-sheet', sheetSlug: 'ash', expectedRevision: 2, fields: ['experience', 'roster'] },
      { kind: 'pokemon-sheet-allocation', namespace: 'pokemon' },
      { kind: 'species-acquisition', trainerSheetSlug: 'ash', speciesId: 'bulbasaur' },
    ],
    payload: {
      eggId: EGG_ID,
      originId: ORIGIN_ID,
      destination: { kind: 'box', trainerSheetSlug: 'ash' },
    },
  })
  const commandHash = createBreedingOperationCommandHash(command)
  const result = createBreedingOperationAcceptedV1({
    operationId: command.operationId,
    commandHash,
    commandKind: 'complete-hatch',
    outcomeKind: 'hatched',
    aggregateRefs: [
      { kind: 'pokemon-egg', id: EGG_ID, revision: 5 },
      { kind: 'pokemon-sheet', id: 'hatch-child', revision: 0 },
      { kind: 'trainer-sheet', id: 'ash', revision: 3 },
    ],
    changedScopes: command.scopes,
    committedAtCampaignMinute: 11,
  })
  const operation: BreedingOperationLedgerRecord = {
    operationId: command.operationId,
    commandHash,
    command,
    scopes: command.scopes,
    status: 'accepted',
    result,
    createdAtCampaignMinute: 10,
    settledAtCampaignMinute: 11,
  }
  return { egg, origin, operation }
}

describe('campaign team, capture, hatch, ownership, and equipment attention detector', () => {
  it('projects an exact open capture review and requires a current Profile link for its owning Trainer', () => {
    const captured = capture()
    const items = project({
      sheets: [trainer({ boxedPokemon: ['sprig'] }), pokemon()],
      profiles: [],
      captures: [captured],
    })
    expect(items.map(item => item.reason)).toEqual(['ownership-review', 'capture-review'])
    expect(items[0]).toMatchObject({
      audience: 'gm', urgency: 'blocking', entity: { kind: 'trainer-sheet', id: 'ash' },
      requiredDecision: { kind: 'assign-ownership' },
      legalActions: [{ intent: 'review-ownership', href: '/sheets/trainers/ash?attention=ownership' }],
    })
    expect(items[1]).toMatchObject({
      audience: 'owner', reason: 'capture-review',
      sourceEvent: { kind: 'encounter-settlement', eventId: captured.fact.factId },
      legalActions: [{ intent: 'review-capture', href: '/sheets/pokemon/sprig' }],
    })
  })

  it('keeps resolved captures terminal while still validating current roster ownership', () => {
    const items = project({
      sheets: [trainer({ boxedPokemon: ['sprig'] }), pokemon()],
      captures: [capture('resolved')],
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      reason: 'capture-review', resolution: { state: 'resolved', revision: 1 },
      requiredDecision: null, legalActions: [],
    })
  })

  it('surfaces over-capacity, duplicate, missing, and cross-Trainer roster authority without choosing a destination', () => {
    const members = Array.from({ length: 7 }, (_, index) => `member-${index}`)
    const second: StoredSheetDocument = {
      ...trainer({ slug: 'misty', name: 'Misty', currentTeam: ['member-0'] } as never),
      slug: 'misty',
      document: { slug: 'misty', name: 'Misty', level: 5, revision: 3, currentTeam: ['member-0'] },
    }
    const items = project({
      sheets: [
        trainer({ currentTeam: [...members, 'missing-mon'] }),
        second,
        ...members.map(slug => pokemon(slug)),
      ],
      profiles: [profile()],
    })
    expect(items.some(item => item.reason === 'team-overflow')).toBe(true)
    expect(items.filter(item => item.reason === 'ownership-review').length).toBeGreaterThanOrEqual(2)
    expect(items.find(item => item.reason === 'team-overflow')).toMatchObject({
      urgency: 'blocking', requiredDecision: { kind: 'repair-team' },
      legalActions: [{ intent: 'review-team' }],
    })
    expect(items.every(item => item.legalActions.every(action => action.requiresConfirmation === false))).toBe(true)
  })

  it('requires exact settled Egg, lineage, operation, child, owner, roster, and Profile authority for hatch review', () => {
    const hatch = hatchedAuthority()
    const child = pokemon('hatch-child', { nickname: 'Bulbasaur' }, 0)
    const items = project({
      sheets: [trainer({ boxedPokemon: ['hatch-child'] }), child],
      eggs: [hatch.egg], origins: [hatch.origin], operations: [hatch.operation],
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      reason: 'hatch-review', audience: 'owner', urgency: 'normal',
      entity: { kind: 'pokemon-sheet', id: 'hatch-child' },
      sourceEvent: { kind: 'breeding-operation', campaignMinute: 11 },
      authority: { kind: 'sheet', id: 'hatch-child', revision: 0 },
      requiredDecision: { kind: 'review-hatch' },
      legalActions: [{ intent: 'review-hatch', href: '/sheets/pokemon/hatch-child?attention=hatch' }],
    })
    const serialized = JSON.stringify(items)
    expect(serialized).not.toContain(hatch.operation.operationId)
    expect(serialized).not.toContain(hatch.origin.lineageDefinitionSha256)
    expect(serialized).not.toContain(profileId)

    const forged = { ...hatch.operation, settledAtCampaignMinute: 12 }
    expect(() => project({
      sheets: [trainer({ boxedPokemon: ['hatch-child'] }), child],
      eggs: [hatch.egg], origins: [hatch.origin], operations: [forged],
    })).toThrow('exact accepted breeding operation authority')
  })

  it('detects current reviewed-equipment incompatibility and malformed equipment without exposing instance evidence', () => {
    const incompatible = activeEquipmentState({
      ownerKind: 'pokemon', ownerSlug: 'sprig', slotId: 'held', canonicalItemId: 'Thick Club',
    })
    const ordinary = project({
      sheets: [trainer(), pokemon('sprig', { equipmentState: incompatible })],
    })
    expect(ordinary).toHaveLength(1)
    expect(ordinary[0]).toMatchObject({
      reason: 'equipment-review', urgency: 'normal',
      requiredDecision: { kind: 'repair-equipment' },
      legalActions: [{ intent: 'review-equipment', href: '/sheets/pokemon/sprig?attention=equipment' }],
    })
    expect(JSON.stringify(ordinary)).not.toContain(incompatible.instances[0]!.instanceId)
    expect(JSON.stringify(ordinary)).not.toContain(incompatible.instances[0]!.equipmentDefinitionSha256)

    const malformed = project({
      sheets: [trainer(), pokemon('sprig', { equipmentState: { bad: true } as never })],
    })
    expect(malformed[0]).toMatchObject({ reason: 'equipment-review', urgency: 'blocking' })
  })

  it('uses an opaque Profile authority for stale links and never projects Profile identities or mutable names', () => {
    const stale = profile([{ sheetKind: 'trainer', sheetSlug: 'missing-trainer' }])
    const items = project({ profiles: [stale] })
    const repair = items.find(item => item.authority.kind === 'profile')
    expect(repair).toMatchObject({
      reason: 'ownership-review', audience: 'gm', entity: { kind: 'campaign', id: 'campaign' },
      sourceEvent: { kind: 'profile-authority' },
      legalActions: [{ href: '/campaign?attention=profiles' }],
    })
    const serialized = JSON.stringify(repair)
    expect(serialized).not.toContain(profileId)
    expect(serialized).not.toContain('Owner')
    expect(repair?.authority.id).toMatch(/^campaign-profile-authority:v1:[a-f0-9]{64}$/)
  })

  it('fails closed for missing capture facts, partial reads, duplicate identities, and bounded overflow', () => {
    const captured = capture()
    expect(() => projectCampaignRosterOwnershipAttention({
      sheets: [trainer(), pokemon()], profiles: [profile()],
      settlementSources: [captured.source], historyFacts: [],
      eggs: [], breedingOrigins: [], breedingOperations: [], campaignMinute: 600,
      completeness: {
        sheets: true, profiles: true, settlementSources: true, historyFacts: true,
        eggs: true, breedingOrigins: true, breedingOperations: true,
      },
    })).toThrow('exact immutable settlement authority')
    expect(() => project({ completeness: { profiles: false as never } })).toThrow('complete current authority read')
    expect(() => project({ sheets: [trainer(), trainer()] })).toThrow('unique current authority identities')
    expect(() => project({
      profiles: Array.from({ length: CAMPAIGN_ROSTER_OWNERSHIP_ATTENTION_LIMIT + 1 }, () => profile()),
    })).toThrow('bounded to 10000 records')
  })
})
