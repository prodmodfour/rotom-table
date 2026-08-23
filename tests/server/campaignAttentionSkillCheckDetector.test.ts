import { describe, expect, it } from 'vitest'
import { projectCampaignSkillCheckAttention } from '../../server/domain/campaignAttention/skillCheckDetector'
import { projectCampaignAttentionForViewer } from '../../server/domain/campaignAttention/projection'
import type { StoredSkillCheckV1 } from '../../server/storage/skillCheckRepository'
import { parseSkillCheckDocument } from '../../shared/skillChecks/persistence'
import { normalizePlayerProfile } from '../../shared/playerProfiles'

const stored = (input: {
  state?: 'pending' | 'ready' | 'cancelled'
  firstResponse?: 'pending' | 'accepted' | 'declined'
  secondResponse?: 'pending' | 'accepted' | 'declined'
} = {}): StoredSkillCheckV1 => {
  const state = input.state ?? 'pending'
  const firstResponse = input.firstResponse ?? (state === 'ready' ? 'accepted' : 'pending')
  const secondResponse = input.secondResponse ?? (state === 'ready' ? 'accepted' : 'pending')
  const terminal = state === 'cancelled'
  const document = parseSkillCheckDocument({
    schemaVersion: 1,
    checkId: 'skill-check:v1:attention-ravine',
    revision: terminal ? 2 : state === 'ready' ? 3 : 1,
    state,
    mode: 'group',
    requester: { role: 'gm', principalId: 'gm:session' },
    publicLabel: 'Cross the ravine',
    prompt: 'Choose a safe route.',
    gmNotes: 'Private.',
    visibility: 'public-results',
    comparison: { kind: 'dc', difficultyClass: 15, concealment: 'subjects-after-acceptance' },
    situationalModifier: 0,
    subjects: [{
      subjectId: 'skill-check-subject:v1:attention-maya',
      kind: 'trainer',
      sheetSlug: 'maya',
      sheetRevision: 2,
      skillId: 'athletics',
      controllerProfileIds: ['profile_maya0001'],
      response: firstResponse,
      respondedAt: firstResponse === 'pending' ? null : 110,
    }, {
      subjectId: 'skill-check-subject:v1:attention-spark',
      kind: 'pokemon',
      sheetSlug: 'spark',
      sheetRevision: 3,
      skillId: 'athletics',
      controllerProfileIds: ['profile_maya0001', 'profile_brock002'],
      response: secondResponse,
      respondedAt: secondResponse === 'pending' ? null : 120,
    }],
    journals: [],
    acceptedResults: [],
    corrections: [],
    history: [{
      historyId: 'skill-check-history:v1:attention-requested',
      kind: 'requested',
      operationId: 'skill-check-op:v1:attention_request_0001',
      subjectId: null,
      headline: 'Skill Check requested',
      createdAt: 100,
    }, ...(terminal ? [{
      historyId: 'skill-check-history:v1:attention-cancelled',
      kind: 'cancelled' as const,
      operationId: 'skill-check-op:v1:attention_cancel_0002',
      subjectId: null,
      headline: 'Skill Check cancelled',
      createdAt: 130,
    }] : [])],
    createdAt: 100,
    updatedAt: terminal ? 130 : state === 'ready' ? 120 : 100,
    expiresAt: null,
    terminalAt: terminal ? 130 : null,
    lastOperationId: terminal
      ? 'skill-check-op:v1:attention_cancel_0002'
      : state === 'ready'
        ? 'skill-check-op:v1:attention_response_0003'
        : 'skill-check-op:v1:attention_request_0001',
  })
  return Object.freeze({
    document,
    revision: document.revision,
    state: document.state,
    mode: document.mode,
    requesterPrincipalId: document.requester.principalId,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    expiresAt: document.expiresAt,
    terminalAt: document.terminalAt,
  })
}

const project = (rows: readonly StoredSkillCheckV1[]) => projectCampaignSkillCheckAttention({
  skillChecks: rows,
  campaignMinute: 80,
  completeness: { skillChecks: true },
})

describe('campaign Skill Check attention detector', () => {
  it('creates one GM observation and exact profile-bound owner responses for pending subjects', () => {
    const items = project([stored()])
    expect(items).toHaveLength(4)
    expect(items.filter(item => item.audience === 'gm')).toHaveLength(1)
    expect(items.filter(item => item.audience === 'owner')).toHaveLength(3)
    expect(items.every(item => item.reason === 'skill-check-response')).toBe(true)
    expect(items.every(item => item.authority.kind === 'resource'
      && item.authority.id === 'skill-check:v1:attention-ravine'
      && item.legalActions[0]?.href === '/play')).toBe(true)
    expect(items.find(item => item.audience === 'gm')?.urgency).toBe('informational')
  })

  it('promotes ready or declined checks to urgent GM review and removes owner response work', () => {
    const ready = project([stored({ state: 'ready' })])
    expect(ready).toHaveLength(1)
    expect(ready[0]).toMatchObject({
      audience: 'gm',
      urgency: 'urgent',
      reason: 'skill-check-resolution',
    })
    const declined = project([stored({ firstResponse: 'declined', secondResponse: 'accepted' })])
    expect(declined.filter(item => item.audience === 'gm')[0]).toMatchObject({
      urgency: 'urgent', reason: 'skill-check-resolution',
    })
    expect(declined.filter(item => item.audience === 'owner')).toEqual([])
  })

  it('projects owner attention only to the exact snapshotted controller and redacts the Profile identity', () => {
    const items = project([stored({ secondResponse: 'accepted' })])
    const maya = normalizePlayerProfile({
      schemaVersion: 1,
      id: 'profile_maya0001',
      displayName: 'Maya',
      linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'maya' }],
    })
    const misty = normalizePlayerProfile({
      schemaVersion: 1,
      id: 'profile_misty002',
      displayName: 'Misty',
      linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'maya' }],
    })
    const mayaProjection = projectCampaignAttentionForViewer({
      role: 'player', playerProfile: maya, sheets: [], campaignMinute: 80, items,
    })
    expect(mayaProjection.items).toHaveLength(1)
    expect(mayaProjection.items[0]?.entity).toEqual({ kind: 'campaign', id: 'campaign' })
    expect(JSON.stringify(mayaProjection)).not.toContain(maya.id)
    expect(projectCampaignAttentionForViewer({
      role: 'player', playerProfile: misty, sheets: [], campaignMinute: 80, items,
    }).items).toEqual([])
    expect(projectCampaignAttentionForViewer({
      role: 'gm', sheets: [], campaignMinute: 80, items,
    }).items).toHaveLength(2)
  })

  it('removes terminal checks and rejects incomplete, duplicate, or over-limit authority', () => {
    expect(project([stored({ state: 'cancelled' })])).toEqual([])
    expect(() => projectCampaignSkillCheckAttention({
      skillChecks: [stored()], campaignMinute: 80, completeness: { skillChecks: false as never },
    })).toThrow('complete current Skill Check authority read')
    expect(() => project([stored(), stored()])).toThrow('unique current check identities')
    expect(() => projectCampaignSkillCheckAttention({
      skillChecks: Array.from({ length: 10_001 }) as StoredSkillCheckV1[],
      campaignMinute: 80,
      completeness: { skillChecks: true },
    })).toThrow('bounded to 10000 checks')
  })
})
