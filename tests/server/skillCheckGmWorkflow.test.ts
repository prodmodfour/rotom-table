import { afterEach, describe, expect, it } from 'vitest'
import { normalizePlayerProfile, type PlayerProfile } from '#shared/playerProfiles'
import type {
  CancelSkillCheckCommandV1,
  RequestSkillCheckCommandV1,
  ResolveSkillCheckCommandV1,
} from '#shared/skillChecks/contract'
import { resolveSkillCheckDifficultyClass, SKILL_CHECK_DC_PRESETS } from '#shared/skillChecks/difficulty'
import { parseLoadGmSkillChecksResponse, parseManageGmSkillCheckResponse } from '#shared/skillChecks/gmWorkflow'
import { parseSkillCheckDocument } from '#shared/skillChecks/persistence'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteSkillCheckRepository } from '~~/server/storage/skillCheckRepository'
import {
  SkillCheckGmWorkflowError,
  loadGmSkillChecksUseCase,
  manageGmSkillCheckUseCase,
} from '~~/server/useCases/manageGmSkillChecks'

let database: RotomDatabase | null = null
afterEach(() => {
  database?.close()
  database = null
})

const checkId = 'skill-check:v1:gm-ravine' as const
const requestOperationId = 'skill-check-op:v1:gm-request-ravine-0001' as const
const cancelOperationId = 'skill-check-op:v1:gm-cancel-ravine-0001' as const

const trainer = (): TrainerSheet => ({
  slug: 'maya',
  name: 'Maya',
  level: 5,
  currentTeam: ['spark'],
  skills: { athletics: { modifier: 1 } },
})
const pokemon = (): CharacterSheet => ({
  slug: 'spark', nickname: 'Spark', species: 'Pikachu', level: 10,
  skills: { athletics: '3d6' },
})
const profile = (input: { readonly id: string, readonly kind: 'trainer' | 'pokemon', readonly slug: string }): PlayerProfile => (
  normalizePlayerProfile({
    schemaVersion: 1,
    id: input.id,
    displayName: input.id,
    linkedCharacters: [{ sheetKind: input.kind, sheetSlug: input.slug }],
  })
)

const requestCommand = (overrides: Partial<RequestSkillCheckCommandV1> = {}): RequestSkillCheckCommandV1 => ({
  schemaVersion: 1,
  operationId: requestOperationId,
  expectedRevision: 0,
  commandKind: 'request',
  checkId,
  publicLabel: 'Cross the ravine',
  prompt: 'Make an Athletics check to cross safely.',
  gmNotes: 'The far ledge may collapse.',
  visibility: 'public-results',
  comparison: {
    kind: 'dc',
    difficulty: { kind: 'preset', presetId: 'skill-check-dc-preset:v1:hard' },
    concealment: 'subjects-after-acceptance',
  },
  situationalModifier: -1,
  expiresAt: 1_000,
  subjects: [
    { subjectId: 'skill-check-subject:v1:trainer-maya', kind: 'trainer', sheetSlug: 'maya', skillId: 'athletics' },
    { subjectId: 'skill-check-subject:v1:pokemon-spark', kind: 'pokemon', sheetSlug: 'spark', skillId: 'athletics' },
  ],
  ...overrides,
})

const cancelCommand = (overrides: Partial<CancelSkillCheckCommandV1> = {}): CancelSkillCheckCommandV1 => ({
  schemaVersion: 1,
  operationId: cancelOperationId,
  expectedRevision: 1,
  commandKind: 'cancel',
  checkId,
  reason: 'The party found another route.',
  ...overrides,
})

const harness = () => {
  database = openRotomDatabase({ path: ':memory:', enableWal: false })
  const checks = createSqliteSkillCheckRepository(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  sheets.save({ kind: 'trainer', slug: 'maya', revision: 4, updatedAt: 10, document: trainer() as unknown as Record<string, unknown> })
  sheets.save({ kind: 'pokemon', slug: 'spark', revision: 7, updatedAt: 10, document: pokemon() as unknown as Record<string, unknown> })
  const profiles = [
    profile({ id: 'profile_maya0001', kind: 'trainer', slug: 'maya' }),
    profile({ id: 'profile_spark001', kind: 'pokemon', slug: 'spark' }),
  ]
  return { checks, sheets, profiles }
}

const captureError = (work: () => unknown): SkillCheckGmWorkflowError | null => {
  try { work(); return null }
  catch (error) {
    expect(error).toBeInstanceOf(SkillCheckGmWorkflowError)
    return error as SkillCheckGmWorkflowError
  }
}

describe('P11-047 GM Skill Check workflow', () => {
  it('creates a source-bound preset group request with exact sheet and controller authority', () => {
    const current = harness()
    const response = manageGmSkillCheckUseCase({ principalId: 'director', command: requestCommand() }, {
      database: database!,
      skillCheckRepository: current.checks,
      sheetRepository: current.sheets,
      listProfiles: () => current.profiles,
      now: () => 100,
    })

    expect(response.receipt).toMatchObject({
      operationId: requestOperationId,
      commandKind: 'request',
      revision: 1,
      state: 'pending',
      exactReplay: false,
    })
    expect(response.document).toMatchObject({
      checkId,
      revision: 1,
      state: 'pending',
      mode: 'group',
      requester: { role: 'gm', principalId: 'gm:director' },
      comparison: { kind: 'dc', difficultyClass: 15, concealment: 'subjects-after-acceptance' },
      situationalModifier: -1,
      createdAt: 100,
      updatedAt: 100,
    })
    expect(response.document.subjects).toEqual([
      expect.objectContaining({
        subjectId: 'skill-check-subject:v1:trainer-maya',
        sheetRevision: 4,
        controllerProfileIds: ['profile_maya0001'],
        response: 'pending',
        respondedAt: null,
      }),
      expect.objectContaining({
        subjectId: 'skill-check-subject:v1:pokemon-spark',
        sheetRevision: 7,
        controllerProfileIds: ['profile_maya0001', 'profile_spark001'],
        response: 'pending',
        respondedAt: null,
      }),
    ])
    expect(current.checks.findOperation(requestOperationId)).toMatchObject({ principalKey: 'gm:director' })
    expect(parseManageGmSkillCheckResponse(JSON.parse(JSON.stringify(response)))).toEqual(response)

    const loaded = loadGmSkillChecksUseCase({}, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets,
      listProfiles: () => current.profiles,
    })
    expect(loaded.checks).toHaveLength(1)
    expect(loaded.subjects.map(subject => [subject.kind, subject.sheetSlug, subject.label, subject.sheetRevision])).toEqual([
      ['trainer', 'maya', 'Maya', 4],
      ['pokemon', 'spark', 'Spark', 7],
    ])
    expect(loaded.subjects.every(subject => subject.skillIds.length === 17)).toBe(true)
    expect(loaded.dcPresets).toEqual(SKILL_CHECK_DC_PRESETS)
    expect(parseLoadGmSkillChecksResponse(JSON.parse(JSON.stringify(loaded)))).toEqual(loaded)
    expect(() => parseLoadGmSkillChecksResponse({ ...loaded, privateDice: [6] })).toThrow('invalid-gm-workflow-response')
    expect(() => parseManageGmSkillCheckResponse({
      ...response,
      receipt: { ...response.receipt, dice: [6] },
    })).toThrow('invalid-gm-workflow-response')
  })

  it('resolves reviewed preset aliases and explicit values without runtime prose parsing', () => {
    expect(SKILL_CHECK_DC_PRESETS.map(preset => [preset.label, preset.difficultyClass])).toEqual([
      ['Easy', 5], ['Challenging', 10], ['Hard', 15], ['Nigh-impossible', 25],
    ])
    expect(resolveSkillCheckDifficultyClass({ kind: 'preset', presetId: 'skill-check-dc-preset:v1:challenging' })).toBe(10)
    expect(resolveSkillCheckDifficultyClass({ kind: 'explicit', difficultyClass: 37 })).toBe(37)
    expect(() => resolveSkillCheckDifficultyClass({ kind: 'explicit', difficultyClass: 101 })).toThrow('outside the reviewed bounds')
  })

  it('returns the original request receipt on exact retry without re-reading profiles or time', () => {
    const current = harness()
    const command = requestCommand()
    const first = manageGmSkillCheckUseCase({ principalId: 'director', command }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets,
      listProfiles: () => current.profiles, now: () => 100,
    })
    const replay = manageGmSkillCheckUseCase({ principalId: 'director', command }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets,
      listProfiles: () => { throw new Error('Replay must not read profiles.') },
      now: () => { throw new Error('Replay must not read time.') },
    })
    expect(replay).toEqual({ ...first, receipt: { ...first.receipt, exactReplay: true } })
    expect(database!.connection.prepare('SELECT COUNT(*) AS count FROM skill_check_operations').get()).toEqual({ count: 1 })
  })

  it('supports explicit single checks and exactly two-subject opposed checks', () => {
    const current = harness()
    const explicit = requestCommand({
      subjects: [requestCommand().subjects[0]!],
      comparison: {
        kind: 'dc',
        difficulty: { kind: 'explicit', difficultyClass: 18 },
        concealment: 'gm-only',
      },
    })
    const single = manageGmSkillCheckUseCase({ principalId: 'director', command: explicit }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets,
      listProfiles: () => current.profiles, now: () => 100,
    })
    expect(single.document).toMatchObject({
      mode: 'single', comparison: { kind: 'dc', difficultyClass: 18, concealment: 'gm-only' },
    })

    database!.close()
    database = null
    const opposedHarness = harness()
    const opposed = manageGmSkillCheckUseCase({ principalId: 'director', command: requestCommand({
      comparison: { kind: 'opposed', tiePolicy: 'reroll-both-up-to-10-then-journaled-server-coin' },
    }) }, {
      database: database!, skillCheckRepository: opposedHarness.checks, sheetRepository: opposedHarness.sheets,
      listProfiles: () => opposedHarness.profiles, now: () => 100,
    })
    expect(opposed.document.comparison).toEqual({
      kind: 'opposed', tiePolicy: 'reroll-both-up-to-10-then-journaled-server-coin',
    })
  })

  it('rejects stale, expired, missing, malformed opposed, duplicate, and principal-conflicting requests', () => {
    const cases: Array<{
      readonly label: string
      readonly command: RequestSkillCheckCommandV1
      readonly mutate?: ReturnType<typeof harness>
      readonly expectedCode: SkillCheckGmWorkflowError['code']
    }> = [
      { label: 'expired', command: requestCommand({ expiresAt: 100 }), expectedCode: 'invalid-command' },
      {
        label: 'missing sheet',
        command: requestCommand({ subjects: [{
          subjectId: 'skill-check-subject:v1:missing-sheet', kind: 'trainer', sheetSlug: 'missing', skillId: 'athletics',
        }] }),
        expectedCode: 'sheet-unavailable',
      },
      {
        label: 'opposed count',
        command: requestCommand({
          comparison: { kind: 'opposed', tiePolicy: 'reroll-both-up-to-10-then-journaled-server-coin' },
          subjects: [requestCommand().subjects[0]!],
        }),
        expectedCode: 'invalid-command',
      },
    ]
    for (const testCase of cases) {
      database?.close()
      database = null
      const current = harness()
      const error = captureError(() => manageGmSkillCheckUseCase({ principalId: 'director', command: testCase.command }, {
        database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets,
        listProfiles: () => current.profiles, now: () => 100,
      }))
      expect(error?.code, testCase.label).toBe(testCase.expectedCode)
      expect(current.checks.get(checkId), testCase.label).toBeNull()
      expect(current.checks.findOperation(requestOperationId), testCase.label).toBeNull()
    }

    database?.close()
    database = null
    const current = harness()
    const command = requestCommand()
    manageGmSkillCheckUseCase({ principalId: 'director', command }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets,
      listProfiles: () => current.profiles, now: () => 100,
    })
    const principalError = captureError(() => manageGmSkillCheckUseCase({ principalId: 'other', command }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets,
    }))
    expect(principalError?.code).toBe('forbidden')
    const duplicateError = captureError(() => manageGmSkillCheckUseCase({ principalId: 'director', command: requestCommand({
      operationId: 'skill-check-op:v1:gm-request-ravine-0002',
    }) }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets,
      listProfiles: () => current.profiles, now: () => 101,
    }))
    expect(duplicateError?.code).toBe('state-conflict')
  })

  it('resolves ready checks through the GM workflow and replays the original server roll', () => {
    const current = harness()
    const requested = manageGmSkillCheckUseCase({ principalId: 'director', command: requestCommand({
      subjects: [requestCommand().subjects[0]!],
      comparison: {
        kind: 'dc',
        difficulty: { kind: 'explicit', difficultyClass: 8 },
        concealment: 'public',
      },
      situationalModifier: 0,
    }) }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets,
      listProfiles: () => current.profiles, now: () => 100,
    })
    const respondOperationId = 'skill-check-op:v1:subject_accept_ravine_0001'
    const ready = parseSkillCheckDocument({
      ...requested.document,
      revision: 2,
      state: 'ready',
      subjects: requested.document.subjects.map(subject => ({ ...subject, response: 'accepted', respondedAt: 110 })),
      history: [...requested.document.history, {
        historyId: 'skill-check-history:v1:subject-accepted-ravine',
        kind: 'responded',
        operationId: respondOperationId,
        subjectId: requested.document.subjects[0]!.subjectId,
        headline: 'Subject accepted Skill Check',
        createdAt: 110,
      }],
      updatedAt: 110,
      lastOperationId: respondOperationId,
    })
    current.checks.replace(1, ready)
    const command: ResolveSkillCheckCommandV1 = {
      schemaVersion: 1,
      operationId: 'skill-check-op:v1:gm_resolve_ravine_0001',
      expectedRevision: 2,
      commandKind: 'resolve',
      checkId,
    }
    const accepted = manageGmSkillCheckUseCase({ principalId: 'director', command }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets,
      now: () => 120, randomInt: () => 4,
    })
    expect(accepted.receipt).toMatchObject({
      commandKind: 'resolve', revision: 3, state: 'accepted', exactReplay: false,
    })
    expect(accepted.document).toMatchObject({ revision: 3, state: 'accepted', terminalAt: 120 })
    expect(accepted.document.journals).toHaveLength(1)
    expect(accepted.document.journals[0]!.results.every(result => result === 4)).toBe(true)
    expect(accepted.document.acceptedResults[0]!.finalTotal).toBe(accepted.document.journals[0]!.finalTotal)
    const replay = manageGmSkillCheckUseCase({ principalId: 'director', command }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets,
      now: () => { throw new Error('Resolve replay must not read time.') },
      randomInt: () => { throw new Error('Resolve replay must not reroll.') },
    })
    expect(replay).toEqual({ ...accepted, receipt: { ...accepted.receipt, exactReplay: true } })
  })

  it('cancels pending checks with a private durable reason and exact terminal replay', () => {
    const current = harness()
    const request = requestCommand()
    manageGmSkillCheckUseCase({ principalId: 'director', command: request }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets,
      listProfiles: () => current.profiles, now: () => 100,
    })
    const cancelled = manageGmSkillCheckUseCase({ principalId: 'director', command: cancelCommand() }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets,
      now: () => 200,
    })
    expect(cancelled.receipt).toMatchObject({
      commandKind: 'cancel', revision: 2, state: 'cancelled', exactReplay: false,
    })
    expect(cancelled.document).toMatchObject({
      revision: 2, state: 'cancelled', terminalAt: 200, lastOperationId: cancelOperationId,
    })
    expect(JSON.stringify(cancelled.document)).not.toContain('another route')
    expect(current.checks.findOperation(cancelOperationId)?.command).toMatchObject({ reason: 'The party found another route.' })

    const replay = manageGmSkillCheckUseCase({ principalId: 'director', command: cancelCommand() }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets,
      now: () => { throw new Error('Terminal replay must not read time.') },
    })
    expect(replay).toEqual({ ...cancelled, receipt: { ...cancelled.receipt, exactReplay: true } })

    const requestReplay = manageGmSkillCheckUseCase({ principalId: 'director', command: request }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets,
    })
    expect(requestReplay.receipt).toMatchObject({ revision: 1, state: 'pending', exactReplay: true })
    expect(requestReplay.document.state).toBe('cancelled')
  })

  it('rejects stale or terminal cancellation without changing history', () => {
    const current = harness()
    manageGmSkillCheckUseCase({ principalId: 'director', command: requestCommand() }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets,
      listProfiles: () => current.profiles, now: () => 100,
    })
    const stale = captureError(() => manageGmSkillCheckUseCase({ principalId: 'director', command: cancelCommand({ expectedRevision: 0 }) }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 200,
    }))
    expect(stale?.code).toBe('revision-conflict')
    manageGmSkillCheckUseCase({ principalId: 'director', command: cancelCommand() }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 200,
    })
    const terminal = captureError(() => manageGmSkillCheckUseCase({ principalId: 'director', command: cancelCommand({
      operationId: 'skill-check-op:v1:gm-cancel-ravine-0002', expectedRevision: 2,
    }) }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 201,
    }))
    expect(terminal?.code).toBe('state-conflict')
    expect(current.checks.get(checkId)?.document.history).toHaveLength(2)
  })

  it('rolls back request and cancel documents with their operation journals at each injected boundary', () => {
    for (const commandKind of ['request', 'cancel'] as const) {
      for (const boundary of ['document', 'operation'] as const) {
        database?.close()
        database = null
        const current = harness()
        if (commandKind === 'cancel') {
          manageGmSkillCheckUseCase({ principalId: 'director', command: requestCommand() }, {
            database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets,
            listProfiles: () => current.profiles, now: () => 100,
          })
        }
        const command = commandKind === 'request' ? requestCommand() : cancelCommand()
        expect(() => manageGmSkillCheckUseCase({ principalId: 'director', command }, {
          database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets,
          listProfiles: () => current.profiles,
          now: () => 200,
          failAfterWrite: candidate => {
            if (candidate === boundary) throw new Error(`injected-${commandKind}-${boundary}`)
          },
        })).toThrow(`injected-${commandKind}-${boundary}`)
        if (commandKind === 'request') {
          expect(current.checks.get(checkId)).toBeNull()
          expect(current.checks.findOperation(requestOperationId)).toBeNull()
        }
        else {
          expect(current.checks.get(checkId)).toMatchObject({ revision: 1, state: 'pending' })
          expect(current.checks.findOperation(cancelOperationId)).toBeNull()
        }
      }
    }
  })
})
