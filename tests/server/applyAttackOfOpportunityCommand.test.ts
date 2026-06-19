import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAuthoritativeLivePlayCommandExecutor } from '../../server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '../../server/livePlay/mapWriteQueue'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteLivePlayOpRepository } from '../../server/storage/opRepository'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { executeAttackOfOpportunityLivePlayCommandUseCase } from '../../server/useCases/applyAttackOfOpportunityCommand'
import {
  ATTACK_OF_OPPORTUNITY_METADATA_KEY,
  writeAttackOfOpportunityState,
  type AttackOfOpportunityPromptRecord,
} from '../../shared/attackOfOpportunityState'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayScope,
} from '../../shared/livePlayCommands'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '../../shared/playerProfiles'
import type { TabletopMap } from '~/types/map'

const tempRoots: string[] = []
const databases: RotomDatabase[] = []

const playerProfile = (linkedCharacters: PlayerProfile['linkedCharacters']): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_aoo00000' as PlayerProfileId,
  displayName: 'AoO Player' as PlayerProfileDisplayName,
  linkedCharacters,
})

const prompt = (overrides: Partial<AttackOfOpportunityPromptRecord> = {}): AttackOfOpportunityPromptRecord => ({
  id: 'aoo-1-attacker-provoker',
  attackerId: 'attacker',
  attackerName: 'Attacker',
  provokerId: 'provoker',
  provokerName: 'Provoker',
  reason: 'movement',
  round: 3,
  ...overrides,
})

const baseMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 7,
  slug: 'arena',
  name: 'Arena',
  dimensions: { x: 8, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    { id: 'provoker', sheetKind: 'pokemon', sheetSlug: 'provoker-mon', position: { x: 1, y: 0, z: 1 } },
    { id: 'attacker', sheetKind: 'pokemon', sheetSlug: 'attacker-mon', position: { x: 0, y: 0, z: 1 } },
    { id: 'other', sheetKind: 'pokemon', sheetSlug: 'other-mon', position: { x: 5, y: 0, z: 5 } },
  ],
  lights: [],
  initiative: { activeId: 'provoker', round: 3 },
  metadata: { owner: 'gm' },
  createdAt: 10,
  updatedAt: 20,
  ...overrides,
})

const createDeps = (options: { map?: TabletopMap; now?: number } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'rotom-table-aoo-'))
  tempRoots.push(root)
  const database = openRotomDatabase({ path: join(root, 'rotom.sqlite'), enableWal: false })
  databases.push(database)
  const mapRepository = createSqliteMapRepository(database)
  const opRepository = createSqliteLivePlayOpRepository({ database, clock: () => options.now ?? 5000 })
  const commandExecutor = createAuthoritativeLivePlayCommandExecutor({
    opStore: opRepository,
    queue: createInProcessMapWriteQueue(),
  })
  const events: unknown[] = []
  const map = options.map ?? baseMap()
  mapRepository.save({ slug: map.slug, document: map, revision: map.revision ?? 0, updatedAt: map.updatedAt ?? 20 })

  return {
    deps: {
      commandExecutor,
      mapRepository,
      now: vi.fn(() => options.now ?? 5000),
      publishRealtimeEvent: vi.fn((event) => events.push(event)),
      relativePath: vi.fn((path: string) => path.replace(/.*data\//, 'data/')),
      readSheet: vi.fn(() => null),
    },
    mapRepository,
    events,
  }
}

const metadataScope = { kind: 'map' as const, lane: 'metadata' as const }

const command = (opId: string, payload: Record<string, unknown>, scopes: readonly LivePlayScope[] = [metadataScope]) => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId,
  mapSlug: 'arena',
  baseRevision: 7,
  type: LIVE_PLAY_COMMAND_TYPES.UPDATE_ATTACK_OF_OPPORTUNITY,
  scopes,
  payload,
})

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('live-play Attack of Opportunity commands', () => {
  it('lets a linked player clear their token\'s persisted AoO prompt and broadcasts metadata', async () => {
    const map = baseMap({
      metadata: writeAttackOfOpportunityState({ owner: 'gm' }, {
        schemaVersion: 1,
        prompts: [prompt()],
        usedRoundByAttackerId: {},
      }),
    })
    const { deps, mapRepository, events } = createDeps({ map, now: 1111 })

    const response = await executeAttackOfOpportunityLivePlayCommandUseCase({
      role: 'player',
      command: command('op_aooclear1', { action: 'clear-prompt', promptId: 'aoo-1-attacker-provoker' }),
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'attacker-mon' }]),
      clientId: 'client-1',
      expectedType: LIVE_PLAY_COMMAND_TYPES.UPDATE_ATTACK_OF_OPPORTUNITY,
    }, deps)

    expect(response.result).toMatchObject({ ok: true, opId: 'op_aooclear1', previousRevision: 7, revision: 8 })
    expect('patches' in response.result ? response.result.patches[0] : null).toMatchObject({
      type: LIVE_PLAY_PATCH_TYPES.MAP_METADATA,
      payload: { action: 'clear-prompt' },
    })
    const storedMap = await mapRepository.getBySlug('arena')
    expect(storedMap?.revision).toBe(8)
    expect(storedMap?.metadata?.[ATTACK_OF_OPPORTUNITY_METADATA_KEY]).toBeUndefined()
    expect(storedMap?.metadata?.owner).toBe('gm')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ channel: 'map:arena', type: 'live-play-command-accepted', clientId: 'client-1' })
  })

  it('lets a linked provoker queue persisted AoO prompts for broadcast live play', async () => {
    const { deps, mapRepository, events } = createDeps({ now: 2222 })
    const queuedPrompt = prompt({ id: 'aoo-queue', round: 1 })

    const response = await executeAttackOfOpportunityLivePlayCommandUseCase({
      role: 'player',
      command: command('op_aooqueue1', { action: 'queue', records: [queuedPrompt] }),
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'provoker-mon' }]),
      clientId: 'client-2',
      expectedType: LIVE_PLAY_COMMAND_TYPES.UPDATE_ATTACK_OF_OPPORTUNITY,
    }, deps)

    expect(response.result).toMatchObject({ ok: true, opId: 'op_aooqueue1', previousRevision: 7, revision: 8 })
    const storedMap = await mapRepository.getBySlug('arena')
    expect(storedMap?.metadata?.[ATTACK_OF_OPPORTUNITY_METADATA_KEY]).toMatchObject({
      prompts: [expect.objectContaining({ id: 'aoo-queue', attackerId: 'attacker', provokerId: 'provoker', round: 3 })],
    })
    expect(events).toHaveLength(1)
  })

  it('rejects player attempts to clear another token owner\'s AoO prompt', async () => {
    const map = baseMap({
      metadata: writeAttackOfOpportunityState({}, {
        schemaVersion: 1,
        prompts: [prompt()],
        usedRoundByAttackerId: {},
      }),
    })
    const { deps, mapRepository, events } = createDeps({ map })

    const response = await executeAttackOfOpportunityLivePlayCommandUseCase({
      role: 'player',
      command: command('op_aoodenied', { action: 'clear-prompt', promptId: 'aoo-1-attacker-provoker' }),
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'provoker-mon' }]),
      clientId: 'client-3',
      expectedType: LIVE_PLAY_COMMAND_TYPES.UPDATE_ATTACK_OF_OPPORTUNITY,
    }, deps)

    expect(response.result).toMatchObject({ ok: false, reason: 'unauthorized' })
    const storedMap = await mapRepository.getBySlug('arena')
    expect(storedMap?.metadata?.[ATTACK_OF_OPPORTUNITY_METADATA_KEY]).toMatchObject({
      prompts: [expect.objectContaining({ id: 'aoo-1-attacker-provoker' })],
    })
    expect(events).toEqual([])
  })
})
