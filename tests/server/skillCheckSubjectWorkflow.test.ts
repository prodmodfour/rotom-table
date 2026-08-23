import { afterEach, describe, expect, it } from 'vitest'
import { normalizePlayerProfile, type PlayerProfile } from '#shared/playerProfiles'
import type { RequestSkillCheckCommandV1, RespondSkillCheckCommandV1, ResolveSkillCheckCommandV1 } from '#shared/skillChecks/contract'
import { parseLoadSubjectSkillChecksResponse, parseRespondSubjectSkillCheckResponse } from '#shared/skillChecks/subjectWorkflow'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteSkillCheckRepository } from '~~/server/storage/skillCheckRepository'
import { manageGmSkillCheckUseCase } from '~~/server/useCases/manageGmSkillChecks'
import {
  SubjectSkillCheckWorkflowError,
  loadSubjectSkillChecksUseCase,
  respondSubjectSkillCheckUseCase,
  timeoutExpiredSkillChecksUseCase,
} from '~~/server/useCases/manageSubjectSkillChecks'

let database: RotomDatabase | null = null
afterEach(() => {
  database?.close()
  database = null
})

const checkId = 'skill-check:v1:subject-ravine' as const
const trainerSubjectId = 'skill-check-subject:v1:subject-trainer-maya' as const
const pokemonSubjectId = 'skill-check-subject:v1:subject-pokemon-spark' as const

const trainer = (): TrainerSheet => ({
  slug: 'maya', name: 'Maya', level: 5, currentTeam: ['spark'],
  skills: { athletics: { modifier: 1 } },
})
const pokemon = (): CharacterSheet => ({
  slug: 'spark', nickname: 'Spark', species: 'Pikachu', level: 10,
  skills: { athletics: '3d6+2' },
})
const profile = (id: string, kind: 'trainer' | 'pokemon', slug: string): PlayerProfile => normalizePlayerProfile({
  schemaVersion: 1,
  id,
  displayName: id,
  linkedCharacters: [{ sheetKind: kind, sheetSlug: slug }],
})

const request = (overrides: Partial<RequestSkillCheckCommandV1> = {}): RequestSkillCheckCommandV1 => ({
  schemaVersion: 1,
  operationId: 'skill-check-op:v1:subject_request_ravine_0001',
  expectedRevision: 0,
  commandKind: 'request',
  checkId,
  publicLabel: 'Cross the ravine',
  prompt: 'Make an Athletics check to cross safely.',
  gmNotes: 'Private collapsing-ledge detail.',
  visibility: 'participants-results',
  comparison: {
    kind: 'dc',
    difficulty: { kind: 'preset', presetId: 'skill-check-dc-preset:v1:hard' },
    concealment: 'subjects-after-acceptance',
  },
  situationalModifier: -1,
  expiresAt: 500,
  subjects: [
    { subjectId: trainerSubjectId, kind: 'trainer', sheetSlug: 'maya', skillId: 'athletics' },
    { subjectId: pokemonSubjectId, kind: 'pokemon', sheetSlug: 'spark', skillId: 'athletics' },
  ],
  ...overrides,
})

const respond = (
  subjectId: typeof trainerSubjectId | typeof pokemonSubjectId,
  expectedRevision: number,
  decision: 'accept' | 'decline' = 'accept',
  operationId = `skill-check-op:v1:respond_${subjectId.includes('trainer') ? 'trainer' : 'pokemon'}_0001`,
): RespondSkillCheckCommandV1 => ({
  schemaVersion: 1,
  operationId: operationId as RespondSkillCheckCommandV1['operationId'],
  expectedRevision,
  commandKind: 'respond',
  checkId,
  subjectId,
  decision,
})

const harness = (command: RequestSkillCheckCommandV1 = request()) => {
  database = openRotomDatabase({ path: ':memory:', enableWal: false })
  const checks = createSqliteSkillCheckRepository(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  sheets.save({ kind: 'trainer', slug: 'maya', revision: 4, updatedAt: 10, document: trainer() as unknown as Record<string, unknown> })
  sheets.save({ kind: 'pokemon', slug: 'spark', revision: 7, updatedAt: 10, document: pokemon() as unknown as Record<string, unknown> })
  const owner = profile('profile_maya0001', 'trainer', 'maya')
  const sparkOwner = profile('profile_spark001', 'pokemon', 'spark')
  const outsider = profile('profile_other001', 'trainer', 'other')
  manageGmSkillCheckUseCase({ principalId: 'director', command }, {
    database,
    skillCheckRepository: checks,
    sheetRepository: sheets,
    listProfiles: () => [owner, sparkOwner, outsider],
    now: () => 100,
  })
  return { checks, sheets, owner, sparkOwner, outsider }
}

const capture = (work: () => unknown): SubjectSkillCheckWorkflowError | null => {
  try { work(); return null }
  catch (error) {
    expect(error).toBeInstanceOf(SubjectSkillCheckWorkflowError)
    return error as SubjectSkillCheckWorkflowError
  }
}

describe('P11-048 subject Skill Check workflow', () => {
  it('projects only controlled prompts with canonical skill and visible modifier transparency', () => {
    const current = harness()
    const loaded = loadSubjectSkillChecksUseCase({
      authority: { kind: 'profile', profile: current.owner },
    }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 120,
    })
    expect(loaded.requests).toHaveLength(2)
    expect(loaded.requests).toEqual([
      expect.objectContaining({
        projection: 'subject',
        checkId,
        subjectId: trainerSubjectId,
        subjectLabel: 'Maya',
        publicLabel: 'Cross the ravine',
        response: 'pending',
        canRespond: true,
        canDecline: true,
        comparison: { kind: 'dc', difficultyClass: null, disclosure: 'after-acceptance' },
        skillAuthority: expect.objectContaining({
          status: 'available', skillId: 'athletics', privateGmAdjustment: 'may-apply',
        }),
      }),
      expect.objectContaining({
        subjectId: pokemonSubjectId,
        subjectLabel: 'Spark',
        skillAuthority: expect.objectContaining({
          status: 'available', skillId: 'athletics', diceCount: 3, visibleFlatModifier: 2,
          contributors: [{ label: 'Authoritative Pokémon skill modifier', value: 2 }],
          privateGmAdjustment: 'may-apply',
        }),
      }),
    ])
    const serialized = JSON.stringify(loaded)
    expect(serialized).not.toContain('collapsing-ledge')
    expect(serialized).not.toContain('situationalModifier')
    expect(serialized).not.toContain('controllerProfileIds')
    expect(serialized).not.toContain('sheetRevision')
    expect(parseLoadSubjectSkillChecksResponse(JSON.parse(serialized))).toEqual(loaded)
    expect(() => parseLoadSubjectSkillChecksResponse({
      ...loaded,
      requests: [{ ...loaded.requests[0]!, gmNotes: 'forged' }],
    })).toThrow('invalid-subject-workflow-response')
    const firstAuthority = loaded.requests[0]!.skillAuthority
    expect(firstAuthority.status).toBe('available')
    expect(() => parseLoadSubjectSkillChecksResponse({
      ...loaded,
      requests: [{
        ...loaded.requests[0]!,
        skillAuthority: { ...firstAuthority, visibleFlatModifier: firstAuthority.status === 'available' ? firstAuthority.visibleFlatModifier + 1 : 1 },
      }],
    })).toThrow('invalid-subject-workflow-response')

    const outsider = loadSubjectSkillChecksUseCase({ authority: { kind: 'profile', profile: current.outsider } }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 120,
    })
    expect(outsider.requests).toEqual([])
  })

  it('accepts each controlled subject under CAS and advances a group to ready', () => {
    const current = harness()
    const firstCommand = respond(trainerSubjectId, 1)
    const first = respondSubjectSkillCheckUseCase({
      authority: { kind: 'profile', profile: current.owner }, command: firstCommand,
    }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 130,
    })
    expect(first.receipt).toMatchObject({
      subjectId: trainerSubjectId, response: 'accepted', revision: 2, state: 'pending', exactReplay: false,
    })
    expect(first.request).toMatchObject({ response: 'accepted', canRespond: false, unavailableReason: 'already-responded' })

    const second = respondSubjectSkillCheckUseCase({
      authority: { kind: 'profile', profile: current.sparkOwner }, command: respond(pokemonSubjectId, 2),
    }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 140,
    })
    expect(second.receipt).toMatchObject({ response: 'accepted', revision: 3, state: 'ready' })
    expect(current.checks.get(checkId)?.document.subjects.map(subject => subject.response)).toEqual(['accepted', 'accepted'])
    expect(current.checks.get(checkId)?.document.history.map(entry => entry.kind)).toEqual(['requested', 'responded', 'responded'])
    expect(parseRespondSubjectSkillCheckResponse(JSON.parse(JSON.stringify(second)))).toEqual(second)
    expect(() => parseRespondSubjectSkillCheckResponse({
      ...second,
      receipt: { ...second.receipt, dice: [6] },
    })).toThrow('invalid-subject-workflow-response')

    const replay = respondSubjectSkillCheckUseCase({
      authority: { kind: 'profile', profile: current.owner }, command: firstCommand,
    }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets,
      now: () => { throw new Error('Exact response replay must not read time.') },
    })
    expect(replay.receipt).toMatchObject({ revision: 2, state: 'pending', response: 'accepted', exactReplay: true })
    expect(replay.request).toMatchObject({ revision: 3, state: 'ready', response: 'accepted' })
  })

  it('lets GM subject authority answer an otherwise unowned NPC prompt without a forged profile', () => {
    const current = harness(request({ subjects: [request().subjects[0]!] }))
    const gmLoaded = loadSubjectSkillChecksUseCase({ authority: { kind: 'gm', principalId: 'director' } }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 120,
    })
    expect(gmLoaded.requests).toHaveLength(1)
    const accepted = respondSubjectSkillCheckUseCase({
      authority: { kind: 'gm', principalId: 'director' }, command: respond(trainerSubjectId, 1),
    }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 130,
    })
    expect(accepted.receipt).toMatchObject({ state: 'ready', response: 'accepted' })
    expect(current.checks.findOperation(accepted.receipt.operationId)?.principalKey).toBe('gm:director')
  })

  it('records a legal decline durably without making an incomplete group resolvable', () => {
    const current = harness(request({ subjects: [request().subjects[0]!] }))
    const command = respond(trainerSubjectId, 1, 'decline', 'skill-check-op:v1:decline_trainer_0001')
    const declined = respondSubjectSkillCheckUseCase({
      authority: { kind: 'profile', profile: current.owner }, command,
    }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 130,
    })
    expect(declined.receipt).toMatchObject({ response: 'declined', state: 'pending', revision: 2 })
    expect(declined.request).toMatchObject({
      response: 'declined', state: 'pending', canRespond: false, canDecline: false, unavailableReason: 'already-responded',
    })
    expect(current.checks.findOperation(command.operationId)?.command).toMatchObject({ decision: 'decline' })
    const retry = respondSubjectSkillCheckUseCase({
      authority: { kind: 'profile', profile: current.owner }, command,
    }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets,
    })
    expect(retry.receipt.exactReplay).toBe(true)
  })

  it('rejects unauthorized profiles, stale revisions, changed decisions, expired prompts, and stale sheets before writes', () => {
    const current = harness()
    const command = respond(trainerSubjectId, 1)
    expect(capture(() => respondSubjectSkillCheckUseCase({
      authority: { kind: 'profile', profile: current.outsider }, command,
    }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 120,
    }))?.code).toBe('forbidden')
    expect(capture(() => respondSubjectSkillCheckUseCase({
      authority: { kind: 'profile', profile: current.owner }, command: respond(trainerSubjectId, 0),
    }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 120,
    }))?.code).toBe('revision-conflict')
    expect(capture(() => respondSubjectSkillCheckUseCase({
      authority: { kind: 'profile', profile: current.owner }, command,
    }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 500,
    }))?.code).toBe('expired')

    current.sheets.save({
      kind: 'trainer', slug: 'maya', revision: 5, updatedAt: 121,
      document: trainer() as unknown as Record<string, unknown>,
    })
    expect(capture(() => respondSubjectSkillCheckUseCase({
      authority: { kind: 'profile', profile: current.owner }, command,
    }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 130,
    }))?.code).toBe('skill-authority-unavailable')
    expect(current.checks.get(checkId)).toMatchObject({ revision: 1, state: 'pending' })
    expect(current.checks.findOperation(command.operationId)).toBeNull()
  })

  it('rejects operation reuse with changed decisions or principals after one accepted response', () => {
    const current = harness()
    const command = respond(trainerSubjectId, 1)
    respondSubjectSkillCheckUseCase({ authority: { kind: 'profile', profile: current.owner }, command }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 130,
    })
    expect(capture(() => respondSubjectSkillCheckUseCase({
      authority: { kind: 'profile', profile: current.owner },
      command: { ...command, decision: 'decline' },
    }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets,
    }))?.code).toBe('operation-conflict')
    expect(capture(() => respondSubjectSkillCheckUseCase({
      authority: { kind: 'gm', principalId: 'director' }, command,
    }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets,
    }))?.code).toBe('forbidden')
  })

  it('rolls back response documents and operations at both injected boundaries', () => {
    for (const boundary of ['document', 'operation'] as const) {
      database?.close()
      database = null
      const current = harness()
      const command = respond(trainerSubjectId, 1)
      expect(() => respondSubjectSkillCheckUseCase({
        authority: { kind: 'profile', profile: current.owner }, command,
      }, {
        database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 130,
        failAfterWrite: candidate => { if (candidate === boundary) throw new Error(`injected-${boundary}`) },
      })).toThrow(`injected-${boundary}`)
      expect(current.checks.get(checkId)).toMatchObject({ revision: 1, state: 'pending' })
      expect(current.checks.findOperation(command.operationId)).toBeNull()
    }
  })

  it('settles expired pending or declined prompts with server-owned durable timeout evidence', () => {
    const current = harness(request({
      expiresAt: 150,
      subjects: [request().subjects[0]!],
    }))
    respondSubjectSkillCheckUseCase({
      authority: { kind: 'profile', profile: current.owner },
      command: respond(trainerSubjectId, 1, 'decline', 'skill-check-op:v1:decline_before_timeout_0001'),
    }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 120,
    })
    expect(timeoutExpiredSkillChecksUseCase({
      database: database!, skillCheckRepository: current.checks, now: () => 149,
    }).timedOutCheckIds).toEqual([])
    const timedOut = timeoutExpiredSkillChecksUseCase({
      database: database!, skillCheckRepository: current.checks, now: () => 150,
    })
    expect(timedOut).toMatchObject({ schemaVersion: 1, observedAt: 150, campaignMinute: 0, timedOutCheckIds: [checkId] })
    expect(current.checks.get(checkId)?.document).toMatchObject({
      revision: 3, state: 'timed-out', terminalAt: 150,
      subjects: [{ response: 'declined' }],
    })
    const operation = database!.connection.prepare("SELECT principal_key, command_kind FROM skill_check_operations WHERE command_kind = 'timeout'").get()
    expect(operation).toEqual({ principal_key: 'server:skill-check-timeout', command_kind: 'timeout' })
    expect(timeoutExpiredSkillChecksUseCase({
      database: database!, skillCheckRepository: current.checks, now: () => 151,
    }).timedOutCheckIds).toEqual([])
  })

  it('rolls back timed-out documents and operation evidence together', () => {
    for (const boundary of ['document', 'operation'] as const) {
      database?.close()
      database = null
      const current = harness(request({ expiresAt: 150, subjects: [request().subjects[0]!] }))
      expect(() => timeoutExpiredSkillChecksUseCase({
        database: database!, skillCheckRepository: current.checks, now: () => 150,
        failAfterWrite: candidate => { if (candidate === boundary) throw new Error(`timeout-${boundary}`) },
      })).toThrow(`timeout-${boundary}`)
      expect(current.checks.get(checkId)).toMatchObject({ revision: 1, state: 'pending' })
      expect(database!.connection.prepare("SELECT COUNT(*) AS count FROM skill_check_operations WHERE command_kind = 'timeout'").get())
        .toEqual({ count: 0 })
    }
  })

  it('reveals an authorized own result and after-acceptance DC without leaking GM contributors', () => {
    const current = harness(request({ subjects: [request().subjects[0]!] }))
    respondSubjectSkillCheckUseCase({
      authority: { kind: 'profile', profile: current.owner }, command: respond(trainerSubjectId, 1),
    }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 130,
    })
    const resolveCommand: ResolveSkillCheckCommandV1 = {
      schemaVersion: 1,
      operationId: 'skill-check-op:v1:subject_result_resolve_0001',
      expectedRevision: 2,
      commandKind: 'resolve',
      checkId,
    }
    manageGmSkillCheckUseCase({ principalId: 'director', command: resolveCommand }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets,
      now: () => 140, randomInt: () => 4,
    })
    const loaded = loadSubjectSkillChecksUseCase({ authority: { kind: 'profile', profile: current.owner } }, {
      database: database!, skillCheckRepository: current.checks, sheetRepository: current.sheets, now: () => 150,
    })
    expect(loaded.requests[0]).toMatchObject({
      state: 'accepted',
      comparison: { kind: 'dc', difficultyClass: 15, disclosure: 'after-acceptance' },
      result: { visibility: 'visible', outcome: expect.stringMatching(/success|failure/u) },
      skillAuthority: { privateGmAdjustment: 'may-apply' },
    })
    const serialized = JSON.stringify(loaded)
    expect(serialized).not.toContain('request:gm-situational-modifier')
    expect(serialized).not.toContain('results\":[')
    expect(serialized).not.toContain('gmNotes')
  })
})
