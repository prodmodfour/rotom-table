import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizePlayerProfile, type PlayerProfile } from '../../shared/playerProfiles'
import type {
  RequestSkillCheckCommandV1,
  ResolveSkillCheckCommandV1,
  RespondSkillCheckCommandV1,
} from '../../shared/skillChecks/contract'
import type { CharacterSheet } from '../../src/types/characterSheet'
import type { TrainerSheet } from '../../src/types/trainerSheet'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository, type SheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteSkillCheckRepository, type SkillCheckRepository } from '../../server/storage/skillCheckRepository'
import { loadCampaignAttentionUseCase } from '../../server/useCases/loadCampaignAttention'
import { loadCampaignSkillCheckHistoryUseCase } from '../../server/useCases/loadCampaignSkillCheckHistory'
import { manageGmSkillCheckUseCase } from '../../server/useCases/manageGmSkillChecks'
import {
  loadSubjectSkillChecksUseCase,
  respondSubjectSkillCheckUseCase,
  SubjectSkillCheckWorkflowError,
} from '../../server/useCases/manageSubjectSkillChecks'

let database: RotomDatabase | null = null
const temporaryDirectories: string[] = []
afterEach(() => {
  database?.close()
  database = null
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const maya = normalizePlayerProfile({
  schemaVersion: 1,
  id: 'profile_maya0001',
  displayName: 'Maya',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'maya' }],
})
const spark = normalizePlayerProfile({
  schemaVersion: 1,
  id: 'profile_spark001',
  displayName: 'Spark controller',
  linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: 'spark' }],
})
const profiles: readonly PlayerProfile[] = Object.freeze([maya, spark])

const trainer = (): TrainerSheet => ({
  slug: 'maya',
  name: 'Maya',
  level: 5,
  currentTeam: [],
  skills: { athletics: { modifier: 1 } },
})
const pokemon = (): CharacterSheet => ({
  slug: 'spark',
  nickname: 'Spark',
  species: 'Pikachu',
  level: 10,
  skills: { athletics: '3d6+1' },
})

type Harness = {
  readonly checks: SkillCheckRepository
  readonly sheets: SheetRepository<Record<string, unknown>>
}

const openHarness = (path = ':memory:'): Harness => {
  database = openRotomDatabase({ path, enableWal: path !== ':memory:' })
  const checks = createSqliteSkillCheckRepository(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  if (!sheets.get('trainer', 'maya')) {
    sheets.save({
      kind: 'trainer', slug: 'maya', revision: 4, updatedAt: 10,
      document: trainer() as unknown as Record<string, unknown>,
    })
    sheets.save({
      kind: 'pokemon', slug: 'spark', revision: 7, updatedAt: 10,
      document: pokemon() as unknown as Record<string, unknown>,
    })
  }
  return { checks, sheets }
}

const reopen = (path: string): Harness => {
  database!.close()
  database = null
  return openHarness(path)
}

const request = (slug: string, mode: 'single' | 'group'): RequestSkillCheckCommandV1 => ({
  schemaVersion: 1,
  operationId: `skill-check-op:v1:request_${slug}_00000001`,
  expectedRevision: 0,
  commandKind: 'request',
  checkId: `skill-check:v1:${slug}`,
  publicLabel: mode === 'single' ? 'Climb the signal tower' : 'Cross the flooded culvert',
  prompt: 'Make an Athletics check.',
  gmNotes: `private-route-${slug}`,
  visibility: 'participants-results',
  comparison: {
    kind: 'dc',
    difficulty: { kind: 'explicit', difficultyClass: 10 },
    concealment: 'subjects-after-acceptance',
  },
  situationalModifier: 0,
  expiresAt: null,
  subjects: [{
    subjectId: `skill-check-subject:v1:${slug}-maya`,
    kind: 'trainer',
    sheetSlug: 'maya',
    skillId: 'athletics',
  }, ...(mode === 'group' ? [{
    subjectId: `skill-check-subject:v1:${slug}-spark` as const,
    kind: 'pokemon' as const,
    sheetSlug: 'spark',
    skillId: 'athletics' as const,
  }] : [])],
})

const response = (
  command: RequestSkillCheckCommandV1,
  subjectIndex: number,
  expectedRevision: number,
): RespondSkillCheckCommandV1 => ({
  schemaVersion: 1,
  operationId: `skill-check-op:v1:respond_${command.checkId.slice('skill-check:v1:'.length)}_${subjectIndex}_00000001`,
  expectedRevision,
  commandKind: 'respond',
  checkId: command.checkId,
  subjectId: command.subjects[subjectIndex]!.subjectId,
  decision: 'accept',
})

const resolve = (command: RequestSkillCheckCommandV1, expectedRevision: number): ResolveSkillCheckCommandV1 => ({
  schemaVersion: 1,
  operationId: `skill-check-op:v1:resolve_${command.checkId.slice('skill-check:v1:'.length)}_00000001`,
  expectedRevision,
  commandKind: 'resolve',
  checkId: command.checkId,
})

const requestCheck = (
  current: Harness,
  command: RequestSkillCheckCommandV1,
  dependencies: Record<string, unknown> = {},
) => manageGmSkillCheckUseCase({ principalId: 'director', command }, {
  database: database!,
  skillCheckRepository: current.checks,
  sheetRepository: current.sheets,
  listProfiles: () => profiles,
  now: () => 100,
  ...dependencies,
})

const respondCheck = (
  current: Harness,
  authority: PlayerProfile,
  command: RespondSkillCheckCommandV1,
  dependencies: Record<string, unknown> = {},
) => respondSubjectSkillCheckUseCase({ authority: { kind: 'profile', profile: authority }, command }, {
  database: database!,
  skillCheckRepository: current.checks,
  sheetRepository: current.sheets,
  now: () => 120 + command.expectedRevision,
  ...dependencies,
})

const resolveCheck = (
  current: Harness,
  command: ResolveSkillCheckCommandV1,
  dependencies: Record<string, unknown> = {},
) => manageGmSkillCheckUseCase({ principalId: 'director', command }, {
  database: database!,
  skillCheckRepository: current.checks,
  sheetRepository: current.sheets,
  now: () => 150,
  randomInt: () => 4,
  ...dependencies,
})

const operationCount = (checkId: string): number => Number((database!.connection.prepare(
  'SELECT COUNT(*) AS count FROM skill_check_operations WHERE check_id = ?',
).get(checkId) as { count: number }).count)

describe('P11-052 Skill Check recovery, concurrency, and campaign history', () => {
  it('recovers a single check after a real SQLite restart and exact duplicate delivery without reroll or duplicate invalidation', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rotom-skill-runtime-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'campaign.sqlite')
    let current = openHarness(path)
    const command = request('restart-single', 'single')
    const respondCommand = response(command, 0, 1)
    const resolveCommand = resolve(command, 2)
    const publications: unknown[] = []
    const publishAttention = (value: unknown): void => { publications.push(value) }

    requestCheck(current, command, { publishAttention })
    respondCheck(current, maya, respondCommand, { publishAttention })
    let rollCount = 0
    const accepted = resolveCheck(current, resolveCommand, {
      publishAttention,
      randomInt: () => { rollCount += 1; return 4 },
    })
    expect(accepted.document.state).toBe('accepted')
    expect(publications).toHaveLength(3)
    const acceptedRollCount = rollCount

    current = reopen(path)
    const replay = resolveCheck(current, resolveCommand, {
      publishAttention: () => { throw new Error('Exact replay must not publish attention.') },
      now: () => { throw new Error('Exact replay must not read time.') },
      randomInt: () => { throw new Error('Exact replay must not reroll.') },
    })
    expect(replay.receipt.exactReplay).toBe(true)
    expect(replay.document).toEqual(accepted.document)
    expect(rollCount).toBe(acceptedRollCount)
    expect(operationCount(command.checkId)).toBe(3)

    const reconnect = loadSubjectSkillChecksUseCase({
      authority: { kind: 'profile', profile: maya }, states: ['accepted'],
    }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 200,
    })
    expect(reconnect.requests).toEqual([expect.objectContaining({
      state: 'accepted', publicLabel: 'Climb the signal tower', result: expect.objectContaining({ visibility: 'visible' }),
    })])
    expect(loadCampaignSkillCheckHistoryUseCase({ authority: { kind: 'owner', profile: maya } }, {
      database: database!, skillCheckRepository: current.checks, now: () => 200,
    }).entries).toEqual([expect.objectContaining({ state: 'accepted', publicLabel: 'Climb the signal tower' })])
  })

  it('serializes concurrent group responses with CAS, rejects stale delivery without writes, and converges after reconnect', () => {
    const current = openHarness()
    const command = request('concurrent-group', 'group')
    requestCheck(current, command)
    const first = response(command, 0, 1)
    const staleSecond = response(command, 1, 1)
    respondCheck(current, maya, first)

    let staleError: unknown
    try { respondCheck(current, spark, staleSecond) }
    catch (error) { staleError = error }
    expect(staleError).toBeInstanceOf(SubjectSkillCheckWorkflowError)
    expect(staleError).toMatchObject({ code: 'revision-conflict' })
    expect(current.checks.get(command.checkId)).toMatchObject({ revision: 2, state: 'pending' })
    expect(current.checks.findOperation(staleSecond.operationId)).toBeNull()

    const reconnected = loadSubjectSkillChecksUseCase({ authority: { kind: 'profile', profile: spark } }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 130,
    })
    expect(reconnected.requests).toEqual([expect.objectContaining({ revision: 2, response: 'pending', canRespond: true })])
    const currentSecond = { ...staleSecond, expectedRevision: 2 }
    const ready = respondCheck(current, spark, currentSecond)
    expect(ready.receipt).toMatchObject({ revision: 3, state: 'ready' })
    const duplicate = respondCheck(current, spark, currentSecond, {
      now: () => { throw new Error('Duplicate response must not read time.') },
    })
    expect(duplicate.receipt.exactReplay).toBe(true)
    expect(current.checks.get(command.checkId)?.document.subjects.map(subject => subject.response))
      .toEqual(['accepted', 'accepted'])
    expect(operationCount(command.checkId)).toBe(3)
  })

  it('rolls back document and operation writes together for single requests and group responses or resolutions', () => {
    for (const boundary of ['document', 'operation'] as const) {
      database?.close()
      database = null
      let current = openHarness()
      const single = request(`rollback-single-${boundary}`, 'single')
      const requestPublications: unknown[] = []
      expect(() => requestCheck(current, single, {
        publishAttention: (value: unknown) => { requestPublications.push(value) },
        failAfterWrite: (candidate: string) => { if (candidate === boundary) throw new Error(`single-${boundary}`) },
      })).toThrow(`single-${boundary}`)
      expect(current.checks.get(single.checkId)).toBeNull()
      expect(operationCount(single.checkId)).toBe(0)
      expect(requestPublications).toEqual([])

      database!.close()
      database = null
      current = openHarness()
      const group = request(`rollback-group-${boundary}`, 'group')
      requestCheck(current, group)
      const first = response(group, 0, 1)
      const responsePublications: unknown[] = []
      expect(() => respondCheck(current, maya, first, {
        publishAttention: (value: unknown) => { responsePublications.push(value) },
        failAfterWrite: (candidate: string) => { if (candidate === boundary) throw new Error(`group-response-${boundary}`) },
      })).toThrow(`group-response-${boundary}`)
      expect(current.checks.get(group.checkId)).toMatchObject({ revision: 1, state: 'pending' })
      expect(current.checks.findOperation(first.operationId)).toBeNull()
      expect(responsePublications).toEqual([])

      respondCheck(current, maya, first)
      respondCheck(current, spark, response(group, 1, 2))
      const resolution = resolve(group, 3)
      const resolutionPublications: unknown[] = []
      expect(() => resolveCheck(current, resolution, {
        publishAttention: (value: unknown) => { resolutionPublications.push(value) },
        failAfterWrite: (candidate: string) => { if (candidate === boundary) throw new Error(`group-resolve-${boundary}`) },
      })).toThrow(`group-resolve-${boundary}`)
      expect(current.checks.get(group.checkId)).toMatchObject({ revision: 3, state: 'ready' })
      expect(current.checks.findOperation(resolution.operationId)).toBeNull()
      expect(resolutionPublications).toEqual([])
    }
  })

  it('moves unresolved checks through exact GM/owner attention states, then only into private-safe terminal history', () => {
    const current = openHarness()
    const command = request('campaign-attention', 'group')
    const publications: Array<{ cause?: string, profileIds?: readonly string[] }> = []
    const publishAttention = (value: { cause?: string, profileIds?: readonly string[] }): void => { publications.push(value) }
    requestCheck(current, command, { publishAttention })

    const skillItems = (role: 'gm' | 'player', profile?: PlayerProfile) => loadCampaignAttentionUseCase({
      role, playerProfile: profile,
    }, { database: database!, listProfiles: () => profiles }).items
      .filter(item => item.sourceEvent.kind === 'skill-check'
        && (role === 'gm' ? item.audience === 'gm' : item.audience === 'owner'))

    expect(skillItems('gm')).toEqual([expect.objectContaining({
      reason: 'skill-check-response', audience: 'gm', urgency: 'informational',
    })])
    expect(skillItems('player', maya)).toEqual([expect.objectContaining({
      reason: 'skill-check-response', audience: 'owner', entity: { kind: 'campaign', id: 'campaign' },
    })])
    expect(skillItems('player', spark)).toHaveLength(1)

    respondCheck(current, maya, response(command, 0, 1), { publishAttention })
    expect(skillItems('player', maya)).toEqual([])
    expect(skillItems('player', spark)).toHaveLength(1)
    respondCheck(current, spark, response(command, 1, 2), { publishAttention })
    expect(skillItems('gm')).toEqual([expect.objectContaining({
      reason: 'skill-check-resolution', urgency: 'urgent',
    })])
    expect(skillItems('player', spark)).toEqual([])

    resolveCheck(current, resolve(command, 3), { publishAttention })
    expect(skillItems('gm')).toEqual([])
    expect(skillItems('player', maya)).toEqual([])
    const ownerHistory = loadCampaignSkillCheckHistoryUseCase({ authority: { kind: 'owner', profile: maya } }, {
      database: database!, skillCheckRepository: current.checks, now: () => 200,
    })
    expect(ownerHistory.entries).toEqual([expect.objectContaining({
      publicLabel: 'Cross the flooded culvert', state: 'accepted',
    })])
    const serialized = JSON.stringify(ownerHistory)
    for (const privateValue of [
      'private-route', 'gmNotes', 'situationalModifier', 'controllerProfileIds', 'skill-check-subject',
      'skill-check-op', 'sheetRevision', 'journals', 'finalTotal',
    ]) expect(serialized).not.toContain(privateValue)
    expect(publications).toHaveLength(4)
    expect(publications.every(row => row.cause === 'skill-check-operation')).toBe(true)
    expect(publications.every(row => row.profileIds?.includes(maya.id) && row.profileIds.includes(spark.id))).toBe(true)

    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const extra = request('publication-failure', 'single')
    expect(() => requestCheck(current, extra, {
      publishAttention: () => { throw new Error('transient unavailable') },
    })).not.toThrow()
    expect(current.checks.get(extra.checkId)).toMatchObject({ revision: 1, state: 'pending' })
    expect(log).toHaveBeenCalledWith(
      '[campaign-attention] Skill Check invalidation publication failed',
      expect.objectContaining({ message: 'transient unavailable' }),
    )
  })
})
