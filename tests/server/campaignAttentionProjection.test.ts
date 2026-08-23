import { describe, expect, it } from 'vitest'
import type { CharacterSheet } from '../../src/types/characterSheet'
import type { TrainerSheet } from '../../src/types/trainerSheet'
import type { StoredSheetDocument } from '../../server/storage/sheetRepository'
import { normalizePlayerProfile, type PlayerProfile } from '../../shared/playerProfiles'
import { createOpenCampaignAttentionItem, resolveCampaignAttentionItem } from '../../shared/campaignAttention/model'
import {
  mergeCampaignAttentionItems,
  projectCampaignAttentionForViewer,
} from '../../server/domain/campaignAttention/projection'
import {
  campaignAttentionInvalidationMaterials,
  publishCampaignAttentionInvalidation,
} from '../../server/realtime/campaignAttentionRealtime'
import { evaluateRealtimeEventAccess } from '../../server/realtime/realtimeEventAccessPolicy'
import {
  loadCampaignAttentionUseCase,
  readCampaignAttentionAuthority,
  type CampaignAttentionAuthoritySnapshot,
} from '../../server/useCases/loadCampaignAttention'
import { openRotomDatabase } from '../../server/storage/database'

const trainer = (slug: string, roster: Partial<TrainerSheet> = {}): StoredSheetDocument => ({
  kind: 'trainer', slug, revision: 2, updatedAt: 100,
  document: { slug, name: slug, level: 5, revision: 2, ...roster } satisfies TrainerSheet,
})
const pokemon = (slug: string): StoredSheetDocument => ({
  kind: 'pokemon', slug, revision: 3, updatedAt: 100,
  document: { slug, nickname: slug, species: 'Bulbasaur', level: 5, revision: 3 } satisfies CharacterSheet,
})
const profile = (id: string, trainerSlug: string): PlayerProfile => normalizePlayerProfile({
  schemaVersion: 1,
  id,
  displayName: id.endsWith('2') ? 'Misty' : 'Ash',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: trainerSlug }],
})

const attention = (input: {
  id: string
  audience?: 'gm' | 'owner'
  kind?: 'trainer-sheet' | 'pokemon-sheet'
  slug?: string
  urgency?: 'blocking' | 'urgent' | 'normal' | 'informational'
}) => {
  const kind = input.kind ?? 'trainer-sheet'
  const slug = input.slug ?? 'ash'
  const authority = { kind: 'sheet' as const, id: slug, revision: kind === 'trainer-sheet' ? 2 : 3 }
  return createOpenCampaignAttentionItem({
    itemId: `campaign-attention:v1:${input.id.repeat(64).slice(0, 64)}`,
    reason: input.audience === 'gm' ? 'ownership-review' : 'recovery-review',
    audience: input.audience ?? 'owner',
    urgency: input.urgency ?? 'normal',
    entity: { kind, id: slug },
    sourceEvent: {
      kind: 'sheet-authority',
      eventId: `campaign-attention-source:v1:${input.id.repeat(64).slice(0, 64)}`,
      campaignMinute: 20,
    },
    authority,
    requiredDecision: {
      decisionId: `campaign-attention-decision:v1:${input.id.repeat(64).slice(0, 64)}`,
      kind: input.audience === 'gm' ? 'assign-ownership' : 'review-recovery',
      authority,
    },
    legalActions: [{
      actionId: `campaign-attention-action:v1:${input.id.repeat(64).slice(0, 64)}`,
      intent: input.audience === 'gm' ? 'review-ownership' : 'review-recovery',
      href: kind === 'trainer-sheet' ? `/sheets/trainers/${slug}` : `/sheets/pokemon/${slug}`,
      authority,
      requiresConfirmation: false,
    }],
    createdAtCampaignMinute: 20,
  })
}

const sheets = [
  trainer('ash', { currentTeam: ['sprig'], boxedPokemon: ['box-mon'] }),
  trainer('misty', { currentTeam: ['staryu'] }),
  pokemon('sprig'), pokemon('box-mon'), pokemon('staryu'),
]

describe('campaign attention role, Profile, and realtime projection', () => {
  it('gives the GM every open owner and GM item while clearing terminal rows', () => {
    const owner = attention({ id: 'a', kind: 'pokemon-sheet', slug: 'sprig' })
    const gm = attention({ id: 'b', audience: 'gm', slug: 'misty', urgency: 'blocking' })
    const terminal = resolveCampaignAttentionItem({
      current: attention({ id: 'c', kind: 'pokemon-sheet', slug: 'staryu' }),
      code: 'completed', resolutionEventId: 'attention-resolution:v1:complete', resolvedAtCampaignMinute: 25,
    })
    const result = projectCampaignAttentionForViewer({
      role: 'gm', sheets, campaignMinute: 30, items: [owner, terminal, gm],
    })
    expect(result.scope).toBe('gm')
    expect(result.items.map(item => item.itemId)).toEqual([gm.itemId, owner.itemId])
    expect(result.summary).toEqual({ total: 2, blocking: 1, urgent: 0, normal: 1, informational: 0 })
  })

  it('gives a player only owner items on their linked Trainer, team, and Box authorities', () => {
    const selected = profile('profile_ash00001', 'ash')
    const visible = [
      attention({ id: 'a', slug: 'ash' }),
      attention({ id: 'b', kind: 'pokemon-sheet', slug: 'sprig' }),
      attention({ id: 'c', kind: 'pokemon-sheet', slug: 'box-mon' }),
    ]
    const hidden = [
      attention({ id: 'd', slug: 'misty' }),
      attention({ id: 'e', kind: 'pokemon-sheet', slug: 'staryu' }),
      attention({ id: 'f', audience: 'gm', slug: 'ash', urgency: 'blocking' }),
    ]
    const result = projectCampaignAttentionForViewer({
      role: 'player', playerProfile: selected, sheets, campaignMinute: 30,
      items: [...visible, ...hidden],
    })
    expect(new Set(result.items.map(item => item.itemId))).toEqual(new Set(visible.map(item => item.itemId)))
    expect(result.items.every(item => item.audience === 'owner')).toBe(true)
    const json = JSON.stringify(result)
    expect(json).not.toContain(selected.id)
    expect(json).not.toContain(selected.displayName)
  })

  it('fails closed instead of granting indirect Pokémon attention through malformed roster authority', () => {
    const malformedSheets = [
      trainer('ash', { currentTeam: ['sprig', 'sprig'] }),
      pokemon('sprig'),
    ]
    const result = projectCampaignAttentionForViewer({
      role: 'player', playerProfile: profile('profile_ash00001', 'ash'),
      sheets: malformedSheets, campaignMinute: 30,
      items: [attention({ id: 'a', slug: 'ash' }), attention({ id: 'b', kind: 'pokemon-sheet', slug: 'sprig' })],
    })
    expect(result.items.map(item => item.entity)).toEqual([{ kind: 'trainer-sheet', id: 'ash' }])
    expect(projectCampaignAttentionForViewer({
      role: 'player', playerProfile: null, sheets, campaignMinute: 30,
      items: [attention({ id: 'a', slug: 'ash' })],
    }).items).toEqual([])
  })

  it('deduplicates byte-equal providers and rejects divergent identities or action authority', () => {
    const first = attention({ id: 'a' })
    expect(mergeCampaignAttentionItems([[first], [first]])).toEqual([first])
    expect(() => mergeCampaignAttentionItems([[first], [{ ...first, urgency: 'urgent' }]]))
      .toThrow('divergent duplicate item identity')
    expect(() => mergeCampaignAttentionItems([[
      { ...first, legalActions: [{ ...first.legalActions[0]!, authority: { ...first.authority, revision: 99 } }] },
    ]])).toThrow('action authority must match')
  })

  it('scopes invalidation events to GM and exact Profile audiences without payload identity leakage', () => {
    const first = profile('profile_ash00001', 'ash')
    const second = profile('profile_misty002', 'misty')
    const materials = campaignAttentionInvalidationMaterials({
      cause: 'profile-authority', profileIds: [second.id, first.id, first.id],
    })
    expect(materials).toHaveLength(3)
    expect(materials.map(row => row.access.kind)).toEqual([
      'gm-only', 'player-profile-access', 'player-profile-access',
    ])
    expect(JSON.stringify(materials.map(row => row.event))).not.toContain(first.id)
    const dependencies = {
      getMap: () => null,
      getSheet: () => null,
      listTrainerSheets: () => [],
      playerVisibleMapSheetAccessKeys: () => new Set<never>(),
    }
    expect(evaluateRealtimeEventAccess({
      access: { kind: 'player-profile-access', profileId: first.id },
      principal: { role: 'player', playerProfile: first }, dependencies,
    })).toEqual({ allowed: true })
    expect(evaluateRealtimeEventAccess({
      access: { kind: 'player-profile-access', profileId: first.id },
      principal: { role: 'player', playerProfile: second }, dependencies,
    })).toEqual({ allowed: false, reason: 'player-profile-not-accessible' })
    expect(evaluateRealtimeEventAccess({
      access: { kind: 'player-profile-access', profileId: first.id },
      principal: { role: 'gm' }, dependencies,
    })).toEqual({ allowed: false, reason: 'player-profile-not-accessible' })

    const published: unknown[] = []
    publishCampaignAttentionInvalidation({
      cause: 'profile-authority', profileIds: [first.id],
      publish: value => { published.push(value) },
    })
    expect(published).toHaveLength(2)
    expect(campaignAttentionInvalidationMaterials({
      cause: 'skill-check-operation', profileIds: [first.id],
    }).map(row => row.event.data)).toEqual([
      { schemaVersion: 1, cause: 'skill-check-operation' },
      { schemaVersion: 1, cause: 'skill-check-operation' },
    ])
  })

  it('reads one complete bounded SQLite authority snapshot and loads an empty role projection', () => {
    const database = openRotomDatabase({ path: ':memory:', enableWal: false })
    try {
      const authority = readCampaignAttentionAuthority({ database, listProfiles: () => [] })
      expect(authority).toMatchObject({
        campaignMinute: 0,
        sheets: [], profiles: [], settlementSources: [], historyFacts: [],
        itemOperations: [], eggs: [], breedingOrigins: [], breedingOperations: [], skillChecks: [],
        completeness: {
          sheets: true, profiles: true, settlementSources: true, historyFacts: true,
          itemOperations: true, eggs: true, breedingOrigins: true,
          breedingOperations: true, skillChecks: true, campaignClock: true,
        },
      })
      const result = loadCampaignAttentionUseCase({ role: 'gm' }, {
        loadAuthority: () => authority as CampaignAttentionAuthoritySnapshot,
      })
      expect(result).toMatchObject({ scope: 'gm', campaignMinute: 0, items: [], summary: { total: 0 } })
    }
    finally {
      database.close()
    }
  })
})
