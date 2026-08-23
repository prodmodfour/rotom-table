import { afterEach, describe, expect, it } from 'vitest'
import { normalizePlayerProfile, type PlayerProfile } from '#shared/playerProfiles'
import type { RequestSkillCheckCommandV1, RespondSkillCheckCommandV1, ResolveSkillCheckCommandV1 } from '#shared/skillChecks/contract'
import { parseSkillCheckRoleProjectionResponse } from '#shared/skillChecks/projections'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteSkillCheckRepository } from '~~/server/storage/skillCheckRepository'
import { loadSkillCheckProjectionsUseCase } from '~~/server/useCases/loadSkillCheckProjections'
import { manageGmSkillCheckUseCase } from '~~/server/useCases/manageGmSkillChecks'
import { respondSubjectSkillCheckUseCase } from '~~/server/useCases/manageSubjectSkillChecks'

let database: RotomDatabase | null = null
afterEach(() => {
  database?.close()
  database = null
})

const checkId = 'skill-check:v1:projection-ravine' as const
const trainerSubjectId = 'skill-check-subject:v1:projection-maya' as const
const pokemonSubjectId = 'skill-check-subject:v1:projection-spark' as const
const owner = (): PlayerProfile => normalizePlayerProfile({
  schemaVersion: 1,
  id: 'profile_maya0001',
  displayName: 'Maya player',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'maya' }],
})
const trainer = (): TrainerSheet => ({
  slug: 'maya', name: 'Maya', level: 5, currentTeam: ['spark'],
  skills: { athletics: { modifier: 1 } },
})
const pokemon = (): CharacterSheet => ({
  slug: 'spark', nickname: 'Spark', species: 'Pikachu', level: 10,
  skills: { athletics: '3d6+2' },
})
const request = (overrides: Partial<RequestSkillCheckCommandV1> = {}): RequestSkillCheckCommandV1 => ({
  schemaVersion: 1,
  operationId: 'skill-check-op:v1:projection_request_0001',
  expectedRevision: 0,
  commandKind: 'request',
  checkId,
  publicLabel: 'Cross the ravine',
  prompt: 'Make an Athletics check to cross safely.',
  gmNotes: 'PRIVATE_LEDGE_DIAGNOSTIC',
  visibility: 'public-results',
  comparison: {
    kind: 'dc',
    difficulty: { kind: 'explicit', difficultyClass: 15 },
    concealment: 'subjects-after-acceptance',
  },
  situationalModifier: -3,
  expiresAt: 1_000,
  subjects: [
    { subjectId: trainerSubjectId, kind: 'trainer', sheetSlug: 'maya', skillId: 'athletics' },
    { subjectId: pokemonSubjectId, kind: 'pokemon', sheetSlug: 'spark', skillId: 'athletics' },
  ],
  ...overrides,
})
const response = (
  subjectId: typeof trainerSubjectId | typeof pokemonSubjectId,
  expectedRevision: number,
): RespondSkillCheckCommandV1 => ({
  schemaVersion: 1,
  operationId: `skill-check-op:v1:projection_${subjectId === trainerSubjectId ? 'maya' : 'spark'}_respond_0001`,
  expectedRevision,
  commandKind: 'respond',
  checkId,
  subjectId,
  decision: 'accept',
})

const harness = (command = request()) => {
  database = openRotomDatabase({ path: ':memory:', enableWal: false })
  const checks = createSqliteSkillCheckRepository(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  sheets.save({ kind: 'trainer', slug: 'maya', revision: 4, updatedAt: 10, document: trainer() as unknown as Record<string, unknown> })
  sheets.save({ kind: 'pokemon', slug: 'spark', revision: 7, updatedAt: 10, document: pokemon() as unknown as Record<string, unknown> })
  const profile = owner()
  manageGmSkillCheckUseCase({ principalId: 'director', command }, {
    database,
    skillCheckRepository: checks,
    sheetRepository: sheets,
    listProfiles: () => [profile],
    now: () => 100,
  })
  return { checks, sheets, profile }
}

const loadAll = (current: ReturnType<typeof harness>) => ({
  gm: loadSkillCheckProjectionsUseCase({ authority: { kind: 'gm' } }, {
    database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 200,
  }),
  subject: loadSkillCheckProjectionsUseCase({ authority: { kind: 'subject', profile: current.profile } }, {
    database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 200,
  }),
  spectator: loadSkillCheckProjectionsUseCase({ authority: { kind: 'spectator' } }, {
    database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 200,
  }),
})

describe('P11-049 Skill Check role projections', () => {
  it('produces structurally distinct GM, subject, and spectator pending projections', () => {
    const current = harness()
    const projected = loadAll(current)
    expect(projected.gm).toMatchObject({ audience: 'gm', checks: [{ projection: 'gm' }] })
    expect(projected.subject).toMatchObject({ audience: 'subject', checks: [
      { projection: 'subject', subjectId: trainerSubjectId },
      { projection: 'subject', subjectId: pokemonSubjectId },
    ] })
    expect(projected.spectator).toMatchObject({
      audience: 'spectator',
      checks: [{
        projection: 'spectator', checkId, state: 'pending', publicLabel: 'Cross the ravine', pendingCount: 2, result: null,
      }],
    })
    expect(Object.keys(projected.gm.checks[0]!).sort()).toEqual(['document', 'projection', 'schemaVersion', 'subjects'])
    expect(Object.keys(projected.spectator.checks[0]!).sort()).toEqual([
      'checkId', 'history', 'pendingCount', 'projection', 'publicLabel', 'result', 'revision', 'schemaVersion', 'state', 'updatedAt',
    ])
    expect(Object.keys(projected.subject.checks[0]!)).toContain('skillAuthority')
    expect(Object.keys(projected.subject.checks[0]!)).not.toContain('document')
    expect(parseSkillCheckRoleProjectionResponse(JSON.parse(JSON.stringify(projected.gm)))).toEqual(projected.gm)
    expect(parseSkillCheckRoleProjectionResponse(JSON.parse(JSON.stringify(projected.subject)))).toEqual(projected.subject)
    expect(parseSkillCheckRoleProjectionResponse(JSON.parse(JSON.stringify(projected.spectator)))).toEqual(projected.spectator)
  })

  it('keeps all GM intent and diagnostics absent from subject and spectator structures', () => {
    const current = harness()
    const { gm, subject, spectator } = loadAll(current)
    expect(JSON.stringify(gm)).toContain('PRIVATE_LEDGE_DIAGNOSTIC')
    expect(JSON.stringify(gm)).toContain('request:gm-situational-modifier')
    expect(gm.checks[0]!.subjects[0]!.modifierAuthority).toMatchObject({ status: 'available', flatModifier: expect.any(Number) })

    for (const projection of [subject, spectator]) {
      const serialized = JSON.stringify(projection)
      expect(serialized).not.toContain('PRIVATE_LEDGE_DIAGNOSTIC')
      expect(serialized).not.toContain('gmNotes')
      expect(serialized).not.toContain('situationalModifier')
      expect(serialized).not.toContain('request:gm-situational-modifier')
      expect(serialized).not.toContain('controllerProfileIds')
      expect(serialized).not.toContain('sheetRevision')
      expect(serialized).not.toContain('operationId')
      expect(serialized).not.toContain('journal')
      expect(serialized).not.toContain('difficultyClass\":15')
    }
    expect(JSON.stringify(spectator)).not.toContain('Make an Athletics check')
    expect(JSON.stringify(spectator)).not.toContain('Maya')
    expect(JSON.stringify(spectator)).not.toContain('Spark')
    expect(JSON.stringify(spectator)).not.toContain('athletics')
  })

  it('projects accepted history and only authorized own or aggregate public results', () => {
    const current = harness()
    respondSubjectSkillCheckUseCase({
      authority: { kind: 'profile', profile: current.profile }, command: response(trainerSubjectId, 1),
    }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 120,
    })
    respondSubjectSkillCheckUseCase({
      authority: { kind: 'profile', profile: current.profile }, command: response(pokemonSubjectId, 2),
    }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 130,
    })
    const resolveCommand: ResolveSkillCheckCommandV1 = {
      schemaVersion: 1,
      operationId: 'skill-check-op:v1:projection_resolve_0001',
      expectedRevision: 3,
      commandKind: 'resolve',
      checkId,
    }
    manageGmSkillCheckUseCase({ principalId: 'director', command: resolveCommand }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets,
      now: () => 140, randomInt: () => 4,
    })
    const { gm, subject, spectator } = loadAll(current)
    expect(gm.checks[0]!.document).toMatchObject({ state: 'accepted', journals: expect.any(Array), acceptedResults: expect.any(Array) })
    expect(gm.checks[0]!.document.journals).toHaveLength(2)
    expect(subject.checks).toHaveLength(2)
    for (const check of subject.checks) {
      expect(check).toMatchObject({
        state: 'accepted', comparison: { kind: 'dc', difficultyClass: 15 }, result: { visibility: 'visible' },
      })
      expect(check.history.map(entry => entry.kind)).toEqual(['requested', 'responded', 'accepted'])
      expect(JSON.stringify(check.history)).not.toContain('operation')
    }
    expect(spectator.checks[0]).toMatchObject({
      state: 'accepted',
      pendingCount: 0,
      result: { visibility: 'visible', successfulSubjects: expect.any(Number), failedSubjects: expect.any(Number), winners: 0, losers: 0 },
      history: [
        { kind: 'requested', headline: 'Skill Check requested' },
        { kind: 'accepted', headline: 'Skill Check resolved' },
      ],
    })
    expect(JSON.stringify(spectator)).not.toContain('finalTotal')
    expect(JSON.stringify(spectator)).not.toContain('responded')
  })

  it('withholds spectator and subject results when GM-only while preserving terminal history', () => {
    const current = harness(request({
      subjects: [request().subjects[0]!],
      visibility: 'gm-only-results',
      comparison: {
        kind: 'dc',
        difficulty: { kind: 'explicit', difficultyClass: 15 },
        concealment: 'gm-only',
      },
    }))
    respondSubjectSkillCheckUseCase({
      authority: { kind: 'profile', profile: current.profile }, command: response(trainerSubjectId, 1),
    }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 120,
    })
    manageGmSkillCheckUseCase({ principalId: 'director', command: {
      schemaVersion: 1,
      operationId: 'skill-check-op:v1:private_projection_resolve_0001',
      expectedRevision: 2,
      commandKind: 'resolve',
      checkId,
    } }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets,
      now: () => 140, randomInt: () => 4,
    })
    const { subject, spectator } = loadAll(current)
    expect(subject.checks[0]).toMatchObject({
      comparison: { kind: 'dc', difficultyClass: null, disclosure: 'gm-only' },
      result: { visibility: 'withheld', finalTotal: null, outcome: null },
    })
    expect(spectator.checks[0]).toMatchObject({
      result: {
        visibility: 'withheld', successfulSubjects: null, failedSubjects: null, winners: null, losers: null,
      },
      history: [
        { kind: 'requested' },
        { kind: 'accepted' },
      ],
    })
  })

  it('strict parsers reject cross-role fields, forged private values, and result arithmetic shapes', () => {
    const current = harness()
    const { subject, spectator } = loadAll(current)
    expect(() => parseSkillCheckRoleProjectionResponse({
      ...spectator,
      checks: [{ ...spectator.checks[0]!, gmNotes: 'forged' }],
    })).toThrow('invalid-role-projection')
    expect(() => parseSkillCheckRoleProjectionResponse({
      ...subject,
      checks: [{ ...subject.checks[0]!, operationId: 'private' }],
    })).toThrow('invalid-subject-workflow-response')
    expect(() => parseSkillCheckRoleProjectionResponse({
      ...spectator,
      audience: 'subject',
    })).toThrow()
  })
})
