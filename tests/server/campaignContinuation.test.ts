import { describe, expect, it } from 'vitest'
import type { PokemonEggDocumentV1 } from '../../shared/breeding/egg'
import type { CampaignAttentionProjectionV1 } from '../../shared/campaignAttention/projection'
import type { EncounterSettlementDocument } from '../../shared/encounterSettlement/document'
import type { EncounterWorkspaceSummary } from '../../shared/encounterWorkspace/library'
import type { SessionPreparationDocumentV1 } from '../../shared/gmToolkit/sessionPreparation'
import { normalizePlayerProfile, type PlayerProfile } from '../../shared/playerProfiles'
import { openRotomDatabase } from '../../server/storage/database'
import {
  loadCampaignContinuationUseCase,
  projectCampaignContinuation,
} from '../../server/useCases/loadCampaignContinuation'
import { readCampaignAttentionAuthority } from '../../server/useCases/loadCampaignAttention'

const attention = (scope: 'gm' | 'owner'): CampaignAttentionProjectionV1 => ({
  schemaVersion: 1,
  snapshotId: `campaign-attention-snapshot:v1:${'a'.repeat(64)}`,
  scope,
  campaignMinute: 500,
  items: [],
  summary: { total: 0, blocking: 0, urgent: 0, normal: 0, informational: 0 },
})

const workspace = (encounterId: string, lifecycle: 'active' | 'paused' = 'active'): EncounterWorkspaceSummary => ({
  schemaVersion: 1,
  encounterId,
  mapSlug: encounterId,
  documentBacked: true,
  encounterRevision: 4,
  lifecycle,
  recipe: null,
  name: encounterId === 'harbor-duel' ? 'Harbor duel' : 'Forest watch',
  folder: '',
  revision: 4,
  updatedAt: 400,
  playerVisible: true,
  state: 'live',
  participantCount: 4,
  sideCount: 2,
  round: 3,
  currentParticipantId: null,
  scene: { active: true, name: 'Battle', startedAt: 300 },
})

const settlement = (settlementId: string, encounterId: string, status: 'blocked' | 'ready'): EncounterSettlementDocument => ({
  settlementId,
  status,
  updatedAtCampaignMinute: status === 'ready' ? 490 : 480,
  encounter: { encounterId },
  unresolvedGates: status === 'ready' ? [] : [{ gateId: 'gate-1' }],
} as unknown as EncounterSettlementDocument)

const egg = (eggId: string, ownerTrainerSlug: string, status: 'incubating' | 'ready'): PokemonEggDocumentV1 => ({
  eggId,
  ownerTrainerSlug,
  status,
} as unknown as PokemonEggDocumentV1)
const preparation = (id: string, lifecycle: 'ready' | 'launched', scenes = 2): SessionPreparationDocumentV1 => ({
  preparationId: id, title: id === 'session-preparation:v1:forest' ? 'Forest Session' : 'Later Session', lifecycle,
  scheduledFor: id.endsWith('forest') ? '2026-08-26T12:00:00.000Z' : null,
  updatedAt: '2026-08-26T11:00:00.000Z', scenes: Array.from({ length: scenes }, (_, index) => ({ sceneId: `scene:${id}:${index}` })),
  launches: lifecycle === 'launched' ? [{ sceneId: `scene:${id}:0` }] : [],
} as unknown as SessionPreparationDocumentV1)

const profile: PlayerProfile = normalizePlayerProfile({
  schemaVersion: 1,
  id: 'profile_test0000',
  displayName: 'Test Player',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-alpha' }],
})

describe('campaign continuation projection', () => {
  it('projects the current encounter, freshest unfinished settlement, and GM-wide Egg summary', () => {
    const projected = projectCampaignContinuation({
      role: 'gm',
      attention: attention('gm'),
      workspaces: [workspace('harbor-duel'), workspace('forest-watch', 'paused')],
      settlements: [
        settlement('settlement-old', 'harbor-duel', 'blocked'),
        settlement('settlement-new', 'forest-watch', 'ready'),
      ],
      preparations: [preparation('session-preparation:v1:later', 'launched'), preparation('session-preparation:v1:forest', 'ready')],
      eggs: [egg('egg-one', 'trainer-alpha', 'incubating'), egg('egg-two', 'trainer-beta', 'ready')],
    })
    expect(projected.activeEncounter).toMatchObject({ label: 'Harbor duel', state: 'active', href: '/play/harbor-duel' })
    expect(projected.additionalActiveEncounters).toBe(1)
    expect(projected.unfinishedSettlement).toMatchObject({ label: 'Forest watch', state: 'ready-to-finish', openWorkCount: 0 })
    expect(projected.additionalUnfinishedSettlements).toBe(1)
    expect(projected.readyPreparation).toMatchObject({ label: 'Forest Session', state: 'ready', sceneCount: 2, href: '/session-prep?preparation=session-preparation%3Av1%3Aforest' })
    expect(projected.additionalReadyPreparations).toBe(1)
    expect(projected.eggs).toMatchObject({ active: 2, incubating: 1, ready: 1 })
    expect(projected.snapshotId).toMatch(/^campaign-continuation-snapshot:v1:[a-f0-9]{64}$/)
  })

  it('limits owner Eggs to exact linked Trainer authority and suppresses private settlement gate counts', () => {
    const projected = projectCampaignContinuation({
      role: 'player',
      playerProfile: profile,
      attention: attention('owner'),
      workspaces: [workspace('harbor-duel')],
      settlements: [settlement('settlement-one', 'harbor-duel', 'blocked')],
      preparations: [preparation('session-preparation:v1:forest', 'ready')],
      eggs: [egg('egg-one', 'trainer-alpha', 'incubating'), egg('egg-two', 'trainer-beta', 'ready')],
    })
    expect(projected.eggs).toMatchObject({ active: 1, incubating: 1, ready: 0 })
    expect(projected.unfinishedSettlement?.openWorkCount).toBeNull()
    expect(projected.readyPreparation).toBeNull()
    expect(JSON.stringify(projected)).not.toContain('Forest Session')
    expect(JSON.stringify(projected)).not.toContain('trainer-alpha')
    expect(JSON.stringify(projected)).not.toContain('trainer-beta')
  })

  it('loads one production-shaped SQLite continuation and preserves detector-owned setup work', () => {
    const database = openRotomDatabase({ path: ':memory:', enableWal: false })
    try {
      const authority = readCampaignAttentionAuthority({
        database,
        listProfiles: () => [profile],
      })
      const projected = loadCampaignContinuationUseCase({ role: 'gm' }, {
        database,
        loadAuthority: () => authority,
        listWorkspaces: () => [],
      })
      expect(projected).toMatchObject({
        activeEncounter: null,
        unfinishedSettlement: null,
        eggs: { active: 0 },
        attention: { scope: 'gm', summary: { total: 1 } },
      })
    }
    finally {
      database.close()
    }
  })

  it('fails closed on role-scope mismatch, duplicate identities, and settlements without visible encounter authority', () => {
    expect(() => projectCampaignContinuation({
      role: 'player', attention: attention('gm'), workspaces: [], settlements: [], eggs: [],
    })).toThrow('attention scope does not match its authenticated role')

    expect(() => projectCampaignContinuation({
      role: 'gm', attention: attention('gm'),
      workspaces: [workspace('harbor-duel'), workspace('harbor-duel')], settlements: [], eggs: [],
    })).toThrow('unique current authority identities')

    const projected = projectCampaignContinuation({
      role: 'gm', attention: attention('gm'), workspaces: [],
      settlements: [settlement('settlement-hidden', 'private-encounter', 'blocked')], eggs: [],
    })
    expect(projected.unfinishedSettlement).toBeNull()
  })
})
