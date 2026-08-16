import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { createEncounterDocument, parseEncounterDocument } from '#shared/encounterDocuments/model'
import {
  createEncounterSettlementDocument,
  parseEncounterSettlementDocument,
} from '#shared/encounterSettlement/document'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import {
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  createLivePlayAcceptedResult,
} from '#shared/livePlayCommands'
import { normalizePlayerProfile } from '#shared/playerProfiles'
import { createDefaultGroupInventoryDocument } from '~/types/groupInventory'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { pokemonExperienceNeededForLevel } from '~/utils/sheets/pokemonExperience'
import { openRotomDatabase } from '../../server/storage/database'
import { createSqliteEncounterDocumentRepository } from '../../server/storage/encounterDocumentRepository'
import { createSqliteEncounterSettlementRepository } from '../../server/storage/encounterSettlementRepository'
import { createSqliteGroupInventoryRepository } from '../../server/storage/groupInventoryRepository'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { finishEncounter } from '../../server/useCases/finishEncounter'
import { prepareFinishEncounter } from '../../server/useCases/prepareFinishEncounter'
import { createSqlitePendingMoveResolutionRepository } from '../../server/storage/pendingMoveResolutionRepository'
import { createSqliteItemOperationRepository } from '../../server/storage/itemOperationRepository'
import { createSqliteLivePlayOpRepository } from '../../server/storage/opRepository'
import { createSqliteTrainerSpeciesAcquisitionSourceOperationRepository } from '../../server/storage/trainerSpeciesAcquisitionSourceOperationRepository'
import { createSqliteTrainerSpeciesAcquisitionRepository } from '../../server/storage/trainerSpeciesAcquisitionRepository'
import {
  createBreedingSpeciesAcquisitionSourceEvidenceV1,
  createBreedingSpeciesAcquisitionSourceSettlementV1,
} from '../../server/domain/breeding/speciesAcquisitionIntegration'
import { createBreedingSpeciesAcquisitionArchiveRecordV1 } from '../../server/domain/breeding/speciesAcquisitionHistory'
import { createPendingMoveResolutionFixture } from '../fixtures/moveAutomation/pendingResolution'
import type { ItemOperationPlanV1, UseItemCommandV1 } from '#shared/itemAutomation/operations'

const seed = (path = ':memory:') => {
  const database = openRotomDatabase({ path, enableWal: false })
  database.connection.prepare('UPDATE campaign_clock SET campaign_minute = 500 WHERE singleton = 1').run()
  const pokemon: CharacterSheet = {
    slug: 'sprig', folder: '', species: 'Bulbasaur', nickname: 'Sprig',
    level: 10, totalExp: pokemonExperienceNeededForLevel(10)!, revision: 4, updatedAt: 900,
    combat: { currentHp: 0, injuries: 5, conditions: ['Poisoned'] },
    stats: {
      atk: { stage: 0 }, def: { stage: 0 }, satk: { stage: 0 },
      sdef: { stage: 0 }, spd: { stage: 0 },
    },
    combatStages: { acc: 0 }, movelist: [],
  } as unknown as CharacterSheet
  const sheets = createSqliteSheetRepository(database)
  sheets.save({
    kind: 'pokemon', slug: 'sprig', document: pokemon, revision: 4, updatedAt: 900,
  })
  sheets.save({
    kind: 'pokemon', slug: 'bench-mon',
    document: {
      ...pokemon,
      slug: 'bench-mon', nickname: 'Bench', revision: 2,
      stats: { ...pokemon.stats, atk: { ...pokemon.stats.atk, stage: 4 } },
      combatStages: { ...pokemon.combatStages, acc: 3 },
    },
    revision: 2, updatedAt: 900,
  })
  const map: TabletopMap = {
    schemaVersion: 2, slug: 'riverside-training', name: 'Riverside Training', folder: '',
    revision: 20, updatedAt: 900, dimensions: { x: 8, y: 3, z: 8 }, voxels: [],
    placements: [{
      id: 'participant-sprig', sheetKind: 'pokemon', sheetSlug: 'sprig',
      position: { x: 1, y: 0, z: 1 }, initiative: 12,
    }],
    initiative: { activeId: 'participant-sprig', round: 2 },
    fieldEffects: { weather: [{ kind: 'rainy', rounds: 2 }], terrains: [], rooms: [] },
    encounterState: createEmptyEncounterState(),
  }
  createSqliteMapRepository(database).save({
    slug: map.slug, document: map, revision: 20, updatedAt: 900,
  })
  const encounter = parseEncounterDocument({
    ...createEncounterDocument({
      encounterId: 'encounter-riverside-training', name: 'Riverside Training',
      linkedMapSlug: map.slug, recipe: 'trainer-duel', now: 800,
    }),
    revision: 0, lifecycle: 'active', updatedAt: 900,
  })
  createSqliteEncounterDocumentRepository(database).create(encounter)
  const group = {
    ...createDefaultGroupInventoryDocument({ slug: 'main', now: 900 }),
    revision: 5, updatedAt: 900, money: 20,
  }
  createSqliteGroupInventoryRepository(database).save({
    slug: 'main', document: group, revision: 5, updatedAt: 900,
  })
  const draft = createEncounterSettlementDocument({
    settlementId: 'encounter-settlement:riverside-training',
    rewardPackageId: 'rewards-riverside-training',
    encounter: {
      encounterId: encounter.encounterId, encounterRevision: encounter.revision,
      linkedMapSlug: map.slug, linkedMapRevision: 20, campaignMinute: 500,
    },
  })
  createSqliteEncounterSettlementRepository(database).create(parseEncounterSettlementDocument({
    ...draft,
    rewardPackage: {
      ...draft.rewardPackage,
      status: 'ready',
      lines: [{
        rewardId: 'reward-sprig-xp', visibility: 'participant-owner',
        sourceAuthority: { kind: 'encounter-document', id: encounter.encounterId, revision: encounter.revision },
        disposition: 'pending', payload: { kind: 'experience', amount: 10 },
      }, {
        rewardId: 'reward-shared-money', visibility: 'destination-owner',
        sourceAuthority: { kind: 'encounter-document', id: encounter.encounterId, revision: encounter.revision },
        disposition: 'pending', payload: { kind: 'money', amount: 500 },
      }, {
        rewardId: 'reward-shared-potions', visibility: 'destination-owner',
        sourceAuthority: { kind: 'encounter-document', id: encounter.encounterId, revision: encounter.revision },
        disposition: 'pending',
        payload: {
          kind: 'item', canonicalItemId: 'Potion', quantity: 12, serialized: false,
          definitionAuthority: { kind: 'item-operation', id: 'reward-source-potion', revision: 0 },
        },
      }, {
        rewardId: 'reward-shared-armor', visibility: 'destination-owner',
        sourceAuthority: { kind: 'encounter-document', id: encounter.encounterId, revision: encounter.revision },
        disposition: 'pending',
        payload: {
          kind: 'item', canonicalItemId: 'Light Armor', quantity: 1, serialized: true,
          definitionAuthority: { kind: 'equipment-operation', id: 'reward-source-armor', revision: 0 },
        },
      }],
    },
  }))
  return database
}

const captureSeed = () => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  database.connection.prepare('UPDATE campaign_clock SET campaign_minute = 500 WHERE singleton = 1').run()
  const trainer: TrainerSheet = {
    slug: 'guide', name: 'Guide', level: 5, currentHp: 20, currentInjuries: 0, conditions: [],
    currentTeam: ['team-one', 'team-two', 'team-three', 'team-four', 'team-five', 'team-six'],
    boxedPokemon: ['pidgey'], inventory: { pokeBalls: [] }, revision: 2, updatedAt: 900,
  }
  const captured: CharacterSheet = {
    slug: 'pidgey', nickname: 'Pidgey', species: 'Pidgey', level: 3,
    caughtBall: 'Basic Ball', combat: { currentHp: 8, injuries: 0, conditions: [] },
    stats: {
      atk: { stage: 0 }, def: { stage: 0 }, satk: { stage: 0 },
      sdef: { stage: 0 }, spd: { stage: 0 },
    },
    combatStages: { acc: 0 }, movelist: [], revision: 1, updatedAt: 900,
  } as unknown as CharacterSheet
  const sheets = createSqliteSheetRepository(database)
  sheets.save({ kind: 'trainer', slug: 'guide', document: trainer, revision: 2, updatedAt: 900 })
  sheets.save({ kind: 'pokemon', slug: 'pidgey', document: captured, revision: 1, updatedAt: 900 })
  const map: TabletopMap = {
    schemaVersion: 2, slug: 'capture-arena', name: 'Capture Arena', folder: '', revision: 21, updatedAt: 900,
    dimensions: { x: 8, y: 3, z: 8 }, voxels: [],
    placements: [{ id: 'participant-guide', sheetKind: 'trainer', sheetSlug: 'guide', position: { x: 0, y: 0, z: 0 } }],
    initiative: { activeId: null, round: 2 }, encounterState: createEmptyEncounterState(),
  }
  createSqliteMapRepository(database).save({ slug: map.slug, document: map, revision: 21, updatedAt: 900 })
  const encounter = parseEncounterDocument({
    ...createEncounterDocument({
      encounterId: 'encounter-capture-arena', name: 'Capture Arena', linkedMapSlug: map.slug,
      recipe: 'hunt-capture', now: 800,
    }),
    revision: 0, lifecycle: 'active', updatedAt: 900,
  })
  createSqliteEncounterDocumentRepository(database).create(encounter)

  const profile = normalizePlayerProfile({
    schemaVersion: 1,
    id: 'profile_capture00',
    displayName: 'Capture Guide',
    linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'guide' }],
  })
  const opId = 'op_capture_finish001'
  const result = createLivePlayAcceptedResult({
    opId, mapSlug: map.slug, previousRevision: 20, revision: 21,
    patches: [{
      schemaVersion: 1,
      type: LIVE_PLAY_PATCH_TYPES.MAP_METADATA,
      mapSlug: map.slug,
      revision: 21,
      scopes: [
        { kind: 'map', lane: 'metadata' },
        { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'guide', field: 'inventory' },
        { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'guide', field: 'pokemonRoster' },
      ],
      payload: {
        capture: {
          trainerId: 'participant-guide', targetId: 'captured-placement', targetSlug: 'pidgey',
          pokeballName: 'Basic Ball', result: { hit: true, success: true, accuracyRoll: 20, captureRoll: 1 },
        },
      },
    }],
  })
  createSqliteLivePlayOpRepository({ database, clock: () => 900 }).saveCommandResult({
    mapSlug: map.slug,
    opId,
    commandHash: 'capture-finish-command-hash' as never,
    command: { type: LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL },
    result,
  })
  const sourceAuthority = {
    schemaVersion: 1,
    authorityKind: 'live-play-capture',
    livePlayOperationId: opId,
    actorProfileId: profile.id,
    mapSlug: map.slug,
    acceptedMapRevision: result.revision,
    trainerSheetSlug: 'guide',
    pokemonSheetSlug: 'pidgey',
    pokemonSheetRevision: 1,
    captureTargetSheetSlug: 'pidgey',
    captureSucceeded: true,
  }
  const sourceAuthorityDefinitionSha256 = createHash('sha256')
    .update(stableJsonStringify(sourceAuthority)).digest('hex')
  const evidence = createBreedingSpeciesAcquisitionSourceEvidenceV1({
    sourceKind: 'capture',
    sourceAuthorityKind: 'live-play-capture',
    sourceEventId: 'capture-event-finish-001',
    sourceAuthorityDefinitionSha256,
    trainerSheetSlug: 'guide',
    trainerRevisionBeforeReward: 1,
    speciesId: 'pidgey',
    pokemonSheetSlug: 'pidgey',
    pokemonSheetRevision: 1,
    campaignMinute: 500,
  })
  createSqliteTrainerSpeciesAcquisitionRepository(database).insert(
    createBreedingSpeciesAcquisitionArchiveRecordV1({
      trainerSheetSlug: 'guide',
      trainerRevisionBeforeReward: 1,
      trainerSheetUpdatedAt: 900,
      speciesId: 'pidgey',
      sourceKind: 'capture',
      firstAcquiredAtCampaignMinute: 500,
      sourceEggId: null,
      operationId: evidence.operationId,
    }),
  )
  createSqliteTrainerSpeciesAcquisitionSourceOperationRepository(database).insert(
    createBreedingSpeciesAcquisitionSourceSettlementV1({
      evidence,
      outcome: 'first-acquisition-rewarded',
      acquisitionDefinitionSha256: 'a'.repeat(64),
      trainerRevisionAfterReward: 2,
      trainerDexExpAfterReward: 1,
      appliedRewardAmount: 1,
      settledAtCampaignMinute: 500,
    }),
  )
  return { database, profile }
}

describe('Finish Encounter orchestration', () => {
  it('prepares and atomically accepts a simple duel without sheet or inventory repair', () => {
    const database = seed()
    try {
      const prepared = prepareFinishEncounter({
        role: 'gm', encounterId: 'encounter-riverside-training', now: 1_000,
      }, { database })
      expect(prepared.view).toMatchObject({
        state: 'ready', readinessLabel: 'Ready to settle', participantCount: 1,
        rewards: expect.arrayContaining([
          { kind: 'experience', amountLabel: '10 XP', destinationLabel: 'Sprig', label: expect.any(String), detail: null },
          { kind: 'money', amountLabel: '₽500', destinationLabel: 'Shared inventory', label: expect.any(String), detail: null },
        ]),
      })
      expect(prepared.view.command).not.toBeNull()

      const accepted = finishEncounter({
        role: 'gm', principalKey: 'role:gm', command: prepared.view.command,
      }, { database })
      expect(accepted).toMatchObject({
        state: 'accepted', readinessLabel: 'Encounter finished', command: null,
        accepted: { replayed: false },
      })
      expect(createSqliteSheetRepository(database).get('pokemon', 'sprig')?.document)
        .toMatchObject({
          totalExp: pokemonExperienceNeededForLevel(10)! + 10,
          combat: { currentHp: 0, injuries: 5, conditions: ['Poisoned'] },
        })
      expect(createSqliteGroupInventoryRepository(database).get('main')?.document).toMatchObject({
        money: 520,
        inventory: {
          medicalKit: [expect.objectContaining({ name: 'Potion', qty: 12 })],
          equipment: [expect.objectContaining({
            name: 'Light Armor',
            serializedEquipment: expect.objectContaining({ canonicalItemId: 'Light Armor', revision: 0 }),
          })],
        },
      })
      expect(createSqliteEncounterDocumentRepository(database).get('encounter-riverside-training')?.lifecycle).toBe('completed')
      expect(createSqliteMapRepository<TabletopMap>(database).getBySlug('riverside-training')).toMatchObject({
        initiative: { activeId: null, round: 1 },
        fieldEffects: { weather: [] },
      })
      expect(createSqliteSheetRepository<CharacterSheet>(database).get('pokemon', 'bench-mon')).toMatchObject({
        revision: 2,
        document: { stats: { atk: { stage: 4 } }, combatStages: { acc: 3 } },
      })

      expect(() => finishEncounter({
        role: 'gm', principalKey: 'role:gm',
        command: { ...prepared.view.command!, planDefinitionSha256: 'b'.repeat(64) },
      }, { database })).toThrow(/already bound to another command/)
      const replayed = finishEncounter({
        role: 'gm', principalKey: 'role:gm', command: prepared.view.command,
      }, { database })
      expect(replayed.accepted?.replayed).toBe(true)
    }
    finally { database.close() }
  })

  it('settles a real accepted capture into review, cleanup, history, and follow-up without exposing authority evidence', () => {
    const { database, profile } = captureSeed()
    try {
      const prepared = prepareFinishEncounter({
        role: 'gm', encounterId: 'encounter-capture-arena', now: 1_000,
      }, { database, playerProfiles: [profile] })
      expect(prepared.view).toMatchObject({
        state: 'ready', participantCount: 2,
        rewards: [expect.objectContaining({
          kind: 'capture', label: 'Pidgey', amountLabel: 'Captured', destinationLabel: 'Storage box',
        })],
        outstandingWork: [expect.objectContaining({ kind: 'capture-review' })],
      })
      expect(JSON.stringify(prepared.view)).not.toContain('sourceAuthorityDefinitionSha256')
      expect(JSON.stringify(prepared.view)).not.toContain(profile.id)

      const accepted = finishEncounter({
        role: 'gm', principalKey: 'role:gm', command: prepared.view.command,
      }, { database, playerProfiles: [profile] })
      expect(accepted).toMatchObject({
        state: 'accepted', accepted: { attentionSourceCount: 1 },
        outstandingWork: [expect.objectContaining({ kind: 'capture-review' })],
      })
      expect(createSqliteSheetRepository<CharacterSheet>(database).get('pokemon', 'pidgey')?.document.caughtBall)
        .toBe('Basic Ball')
    }
    finally { database.close() }
  })

  it('replays the exact accepted command after a server restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'rotom-finish-encounter-'))
    const path = join(root, 'campaign.sqlite')
    let database = seed(path)
    try {
      const prepared = prepareFinishEncounter({
        role: 'gm', encounterId: 'encounter-riverside-training', now: 1_000,
      }, { database })
      finishEncounter({ role: 'gm', principalKey: 'role:gm', command: prepared.view.command }, { database })
      database.close()
      database = openRotomDatabase({ path, enableWal: false })
      const replayed = finishEncounter({
        role: 'gm', principalKey: 'role:gm', command: prepared.view.command,
      }, { database })
      expect(replayed).toMatchObject({ state: 'accepted', accepted: { replayed: true } })
    }
    finally {
      database.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('projects pending move and item resolution as authoritative blockers', () => {
    const database = seed()
    try {
      createSqlitePendingMoveResolutionRepository(database).create({
        resolution: createPendingMoveResolutionFixture({
          resolutionId: 'resolution-riverside-pending',
          originMapSlug: 'riverside-training',
          originOpId: 'op_riverside_pending_move',
          actorPlacementId: 'participant-sprig',
        }),
      })
      const itemCommand: UseItemCommandV1 = {
        schemaVersion: 1,
        operationId: 'op_item_riverside_pending',
        context: 'encounter',
        offerId: 'offer:item:potion',
        sourceInstanceId: 'item-instance:trainer:guide:medicalKit:potion-row',
        actorParticipantId: 'participant-guide',
        actorSheet: { kind: 'trainer', slug: 'guide', expectedRevision: 1 },
        source: { kind: 'trainer', slug: 'guide', section: 'medicalKit', rowId: 'potion-row', expectedRevision: 1 },
        targetIds: ['participant-sprig'],
        choices: [],
        readSet: [
          { kind: 'map', id: 'riverside-training', revision: 20 },
          { kind: 'sheet', sheetKind: 'trainer', id: 'guide', revision: 1 },
          { kind: 'sheet', sheetKind: 'pokemon', id: 'sprig', revision: 4 },
        ],
      }
      const itemPlan: ItemOperationPlanV1 = {
        schemaVersion: 1,
        operationId: itemCommand.operationId,
        canonicalItemId: 'Potion',
        canonicalDefinitionSha256: 'a'.repeat(64),
        readSet: itemCommand.readSet,
        operations: [{
          operationId: 'inventory.consume', ordinal: 0, kind: 'inventory',
          aggregate: { kind: 'sheet', sheetKind: 'trainer', id: 'guide', revision: 1 },
          subjectId: 'potion-row', payload: { action: 'consume', quantity: 1 }, label: 'Consume Potion',
        }],
        receiptFacts: [],
      }
      createSqliteItemOperationRepository({ database }).createPending({
        command: itemCommand, canonicalItemId: 'Potion', canonicalDefinitionSha256: 'a'.repeat(64), plan: itemPlan,
      })

      const prepared = prepareFinishEncounter({
        role: 'gm', encounterId: 'encounter-riverside-training', now: 1_000,
      }, { database })
      expect(prepared.view.state).toBe('blocked')
      expect(prepared.view.command).toBeNull()
      expect(prepared.view.gates.map(row => row.kind)).toEqual(expect.arrayContaining([
        'pending-resolution',
      ]))
      expect(prepared.view.gates.filter(row => row.kind === 'pending-resolution')).toHaveLength(2)
    }
    finally { database.close() }
  })

  it('requires explicit current story outcomes instead of silently completing them', () => {
    const database = seed()
    try {
      const repository = createSqliteEncounterDocumentRepository(database)
      const current = repository.get('encounter-riverside-training')!
      repository.replace({
        expectedRevision: current.revision,
        document: parseEncounterDocument({
          ...current,
          revision: current.revision + 1,
          updatedAt: 950,
          objectives: [{
            objectiveId: 'objective-cross-river', label: 'Cross the river', visibility: 'public',
            status: 'active', progress: null, maximum: null,
          }],
        }),
      })
      const prepared = prepareFinishEncounter({
        role: 'gm', encounterId: 'encounter-riverside-training', now: 1_000,
      }, { database })
      expect(prepared.view.state).toBe('blocked')
      expect(prepared.view.gates).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'outcome-decision', title: 'Encounter outcomes need review' }),
      ]))
    }
    finally { database.close() }
  })

  it('fails closed instead of guessing how unallocated Experience should cross opposing Pokémon', () => {
    const database = seed()
    try {
      const maps = createSqliteMapRepository<TabletopMap>(database)
      const current = maps.getBySlug('riverside-training')!
      expect(maps.applyLivePlayUpdate({
        slug: current.slug,
        expectedRevision: current.revision,
        nextMap: {
          ...current,
          revision: current.revision + 1,
          updatedAt: 950,
          encounterState: {
            ...(current.encounterState ?? createEmptyEncounterState()),
            sides: {
              ...(current.encounterState?.sides ?? {}),
              opponents: { id: 'opponents', label: 'Opponents', status: 'active', color: '#ef4444' },
            },
          },
          placements: [...current.placements, {
            id: 'participant-bench-opponent', sheetKind: 'pokemon', sheetSlug: 'bench-mon',
            sideId: 'opponents', position: { x: 6, y: 0, z: 6 }, initiative: 8,
          }],
        },
      })).toBe('applied')
      const prepared = prepareFinishEncounter({
        role: 'gm', encounterId: 'encounter-riverside-training', now: 1_000,
      }, { database })
      expect(prepared.view.state).toBe('blocked')
      expect(prepared.view.command).toBeNull()
      expect(prepared.view.gates).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'reward-allocation', title: 'Experience needs recipients' }),
      ]))
    }
    finally { database.close() }
  })

  it('rejects stale confirmation and requires a fresh explicit review', () => {
    const database = seed()
    try {
      const first = prepareFinishEncounter({
        role: 'gm', encounterId: 'encounter-riverside-training', now: 1_000,
      }, { database })
      const repository = createSqliteSheetRepository<CharacterSheet>(database)
      const current = repository.get('pokemon', 'sprig')!
      repository.save({
        kind: 'pokemon', slug: 'sprig',
        document: { ...current.document, revision: current.revision + 1, updatedAt: 1_001 },
        revision: current.revision + 1, updatedAt: 1_001,
      })
      expect(() => finishEncounter({
        role: 'gm', principalKey: 'role:gm', command: first.view.command,
      }, { database })).toThrow(/unavailable or stale|authority changed/)
      expect(createSqliteEncounterDocumentRepository(database).get('encounter-riverside-training')?.lifecycle).toBe('active')

      const fresh = prepareFinishEncounter({
        role: 'gm', encounterId: 'encounter-riverside-training', now: 1_100,
      }, { database })
      expect(fresh.view.state).toBe('ready')
      expect(fresh.view.command).not.toEqual(first.view.command)
    }
    finally { database.close() }
  })

  it('keeps Finish Encounter GM-only', () => {
    const database = seed()
    try {
      expect(() => prepareFinishEncounter({
        role: 'player', encounterId: 'encounter-riverside-training', now: 1_000,
      }, { database })).toThrow(/Only the GM/)
    }
    finally { database.close() }
  })
})
