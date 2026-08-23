import { afterEach, describe, expect, it } from 'vitest'
import { loadCampaignSkillCheckHistoryUseCase } from '../../server/useCases/loadCampaignSkillCheckHistory'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSkillCheckRepository } from '../../server/storage/skillCheckRepository'
import { parseCampaignSkillCheckHistoryResponse } from '../../shared/skillChecks/campaignHistory'
import type { SkillCheckDocumentV1, SkillCheckState, SkillCheckVisibility } from '../../shared/skillChecks/contract'
import { parseSkillCheckDocument } from '../../shared/skillChecks/persistence'
import { normalizePlayerProfile } from '../../shared/playerProfiles'

let database: RotomDatabase | null = null
afterEach(() => {
  database?.close()
  database = null
})

const profile = (id: string) => normalizePlayerProfile({
  schemaVersion: 1,
  id,
  displayName: id,
  linkedCharacters: [],
})

const operationId = (slug: string, kind: string) => `skill-check-op:v1:${kind}_${slug.replaceAll(/[^A-Za-z0-9_-]/g, '_')}_00000001` as const
const checkId = (slug: string) => `skill-check:v1:${slug}` as const
const subjectId = (slug: string) => `skill-check-subject:v1:${slug}` as const

const pending = (input: {
  slug: string
  label: string
  profileId: string
  createdAt: number
  visibility?: SkillCheckVisibility
}): SkillCheckDocumentV1 => parseSkillCheckDocument({
  schemaVersion: 1,
  checkId: checkId(input.slug),
  revision: 1,
  state: 'pending',
  mode: 'single',
  requester: { role: 'gm', principalId: 'gm:session' },
  publicLabel: input.label,
  prompt: 'Make the requested check.',
  gmNotes: `private-${input.slug}`,
  visibility: input.visibility ?? 'participants-results',
  comparison: { kind: 'dc', difficultyClass: 5, concealment: 'gm-only' },
  situationalModifier: 3,
  subjects: [{
    subjectId: subjectId(input.slug),
    kind: 'trainer',
    sheetSlug: `sheet-${input.slug}`,
    sheetRevision: 7,
    skillId: 'athletics',
    controllerProfileIds: [input.profileId],
    response: 'pending',
    respondedAt: null,
  }],
  journals: [],
  acceptedResults: [],
  corrections: [],
  history: [{
    historyId: `history-${input.slug}-request`,
    kind: 'requested',
    operationId: operationId(input.slug, 'request'),
    subjectId: null,
    headline: 'Skill Check requested',
    createdAt: input.createdAt,
  }],
  createdAt: input.createdAt,
  updatedAt: input.createdAt,
  expiresAt: null,
  terminalAt: null,
  lastOperationId: operationId(input.slug, 'request'),
})

const terminal = (
  initial: SkillCheckDocumentV1,
  state: Extract<SkillCheckState, 'accepted' | 'cancelled' | 'timed-out'>,
  terminalAt: number,
): readonly SkillCheckDocumentV1[] => {
  if (state !== 'accepted') {
    return [parseSkillCheckDocument({
      ...initial,
      revision: 2,
      state,
      history: [...initial.history, {
        historyId: `history-${initial.checkId}-${state}`,
        kind: state,
        operationId: operationId(initial.checkId.slice(-20), state),
        subjectId: null,
        headline: state === 'cancelled' ? 'Skill Check cancelled' : 'Skill Check timed out',
        createdAt: terminalAt,
      }],
      updatedAt: terminalAt,
      terminalAt,
      lastOperationId: operationId(initial.checkId.slice(-20), state),
    })]
  }
  const respondedAt = terminalAt - 1
  const respondOperation = operationId(initial.checkId.slice(-20), 'respond')
  const resolveOperation = operationId(initial.checkId.slice(-20), 'resolve')
  const ready = parseSkillCheckDocument({
    ...initial,
    revision: 2,
    state: 'ready',
    subjects: [{ ...initial.subjects[0]!, response: 'accepted', respondedAt }],
    history: [...initial.history, {
      historyId: `history-${initial.checkId}-responded`,
      kind: 'responded',
      operationId: respondOperation,
      subjectId: initial.subjects[0]!.subjectId,
      headline: 'Subject accepted Skill Check',
      createdAt: respondedAt,
    }],
    updatedAt: respondedAt,
    lastOperationId: respondOperation,
  })
  const journalId = `skill-check-journal:v1:${initial.checkId.slice(-20).replaceAll(':', '-')}-roll`
  return [ready, parseSkillCheckDocument({
    ...ready,
    revision: 3,
    state: 'accepted',
    journals: [{
      journalId,
      subjectId: initial.subjects[0]!.subjectId,
      attempt: 1,
      diceCount: 1,
      dieSides: 6,
      flatModifier: 0,
      contributors: [],
      results: [6],
      dieTotal: 6,
      finalTotal: 6,
      rolledAt: terminalAt,
    }],
    acceptedResults: [{
      subjectId: initial.subjects[0]!.subjectId,
      journalIds: [journalId],
      finalTotal: 6,
      outcome: 'success',
      acceptedAt: terminalAt,
    }],
    history: [...ready.history, {
      historyId: `history-${initial.checkId}-accepted`,
      kind: 'accepted',
      operationId: resolveOperation,
      subjectId: null,
      headline: 'Skill Check resolved',
      createdAt: terminalAt,
    }],
    updatedAt: terminalAt,
    terminalAt,
    lastOperationId: resolveOperation,
  })]
}

const seed = (input: Parameters<typeof pending>[0], state: 'accepted' | 'cancelled' | 'timed-out', at: number): void => {
  const repository = createSqliteSkillCheckRepository(database!)
  const initial = pending(input)
  repository.insert(initial)
  let revision = 1
  for (const next of terminal(initial, state, at)) repository.replace(revision++, next)
}

describe('campaign Skill Check history projection', () => {
  it('returns newest owner-safe terminal records without private authority or unrelated checks', () => {
    database = openRotomDatabase({ path: ':memory:', enableWal: false })
    seed({ slug: 'owner-success', label: 'Cross the flooded culvert', profileId: 'profile_maya0001', createdAt: 10 }, 'accepted', 100)
    seed({ slug: 'owner-cancelled', label: 'Decode the weather vane', profileId: 'profile_maya0001', createdAt: 20 }, 'cancelled', 110)
    seed({ slug: 'owner-timeout', label: 'Hold the rope bridge', profileId: 'profile_maya0001', createdAt: 30 }, 'timed-out', 120)
    seed({ slug: 'other-owner', label: 'Secret unrelated check', profileId: 'profile_brock002', createdAt: 40 }, 'cancelled', 130)

    const response = loadCampaignSkillCheckHistoryUseCase({
      authority: { kind: 'owner', profile: profile('profile_maya0001') },
    }, { database, now: () => 200 })
    expect(response.audience).toBe('owner')
    expect(response.entries.map(entry => [entry.publicLabel, entry.state, entry.outcome])).toEqual([
      ['Hold the rope bridge', 'timed-out', null],
      ['Decode the weather vane', 'cancelled', null],
      ['Cross the flooded culvert', 'accepted', 'success'],
    ])
    const serialized = JSON.stringify(response)
    expect(serialized).not.toContain('Secret unrelated check')
    expect(serialized).not.toContain('private-')
    expect(serialized).not.toContain('skill-check:v1:')
    expect(serialized).not.toContain('skill-check-subject')
    expect(serialized).not.toContain('finalTotal')
    expect(serialized).not.toContain('situationalModifier')
    expect(serialized).not.toContain('sheetRevision')
  })

  it('withholds owner results under GM-only visibility and keeps GM terminal outcomes generic', () => {
    database = openRotomDatabase({ path: ':memory:', enableWal: false })
    seed({
      slug: 'withheld-result', label: 'Read the hidden current', profileId: 'profile_maya0001',
      createdAt: 10, visibility: 'gm-only-results',
    }, 'accepted', 100)
    expect(loadCampaignSkillCheckHistoryUseCase({
      authority: { kind: 'owner', profile: profile('profile_maya0001') },
    }, { database, now: () => 200 }).entries[0]?.outcome).toBe('withheld')
    expect(loadCampaignSkillCheckHistoryUseCase({ authority: { kind: 'gm' } }, {
      database, now: () => 200,
    }).entries[0]?.outcome).toBe('resolved')
  })

  it('bounds history and strictly rejects malformed cross-shape responses', () => {
    database = openRotomDatabase({ path: ':memory:', enableWal: false })
    expect(() => loadCampaignSkillCheckHistoryUseCase({ authority: { kind: 'gm' }, limit: 21 }, {
      database,
    })).toThrow('limit must be an integer from 1 through 20')
    expect(() => parseCampaignSkillCheckHistoryResponse({
      schemaVersion: 1,
      projection: 'campaign-skill-check-history',
      audience: 'owner',
      entries: [{
        entryId: `campaign-skill-check-history:v1:${'a'.repeat(64)}`,
        publicLabel: 'A check',
        state: 'cancelled',
        outcome: null,
        terminalAt: 1,
        gmNotes: 'leak',
      }],
      serverNow: 2,
    })).toThrow('skill-check.invalid-campaign-history')
  })
})
