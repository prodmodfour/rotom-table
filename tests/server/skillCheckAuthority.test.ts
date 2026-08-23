import { afterEach, describe, expect, it } from 'vitest'
import {
  SKILL_CHECK_TIE_BREAK_CONTRIBUTOR_ID,
  type ResolveSkillCheckCommandV1,
  type SkillCheckComparisonPolicyV1,
  type SkillCheckDocumentV1,
  type SkillCheckSubjectV1,
} from '#shared/skillChecks/contract'
import { parseSkillCheckDocument } from '#shared/skillChecks/persistence'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteSkillCheckRepository } from '~~/server/storage/skillCheckRepository'
import {
  SkillCheckAuthorityError,
  resolveSkillCheckUseCase,
} from '~~/server/useCases/resolveSkillCheck'
import { activeEquipmentState } from '../fixtures/equipment'

let database: RotomDatabase | null = null
afterEach(() => {
  database?.close()
  database = null
})

const checkId = 'skill-check:v1:server-authority' as const
const resolveOperationId = 'skill-check-op:v1:resolve-authority-0001' as const
const requestOperationId = 'skill-check-op:v1:request-authority-0001' as const
const trainerSubjectId = 'skill-check-subject:v1:trainer-maya' as const
const pokemonSubjectId = 'skill-check-subject:v1:pokemon-spark' as const

const trainerSheet = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'maya',
  name: 'Maya',
  level: 5,
  skillBackground: { adept: 'athletics' },
  skills: { athletics: { modifier: 2 } },
  ...overrides,
})

const pokemonSheet = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'spark',
  nickname: 'Spark',
  species: 'Pikachu',
  level: 10,
  skills: { athletics: '3d6-1' },
  ...overrides,
})

const subject = (input: {
  readonly subjectId: SkillCheckSubjectV1['subjectId']
  readonly kind: SkillCheckSubjectV1['kind']
  readonly sheetSlug: string
  readonly sheetRevision: number
}): SkillCheckSubjectV1 => ({
  ...input,
  skillId: 'athletics',
  controllerProfileIds: [`profile:${input.sheetSlug}`],
  response: 'accepted',
  respondedAt: 20,
})

const readyDocument = (input: {
  readonly comparison?: SkillCheckComparisonPolicyV1
  readonly situationalModifier?: number
  readonly subjects?: readonly SkillCheckSubjectV1[]
  readonly expiresAt?: number | null
} = {}): SkillCheckDocumentV1 => {
  const subjects = input.subjects ?? [subject({
    subjectId: trainerSubjectId,
    kind: 'trainer',
    sheetSlug: 'maya',
    sheetRevision: 4,
  })]
  return parseSkillCheckDocument({
    schemaVersion: 1,
    checkId,
    revision: 1,
    state: 'ready',
    mode: subjects.length === 1 ? 'single' : 'group',
    requester: { role: 'gm', principalId: 'gm:director' },
    publicLabel: 'Cross the ravine',
    prompt: 'Make an Athletics check.',
    gmNotes: 'The far ledge is unstable.',
    visibility: 'public-results',
    comparison: input.comparison ?? { kind: 'dc', difficultyClass: 12, concealment: 'public' },
    situationalModifier: input.situationalModifier ?? 0,
    subjects,
    journals: [],
    acceptedResults: [],
    corrections: [],
    history: [{
      historyId: 'skill-check-history:v1:request-authority-0001',
      kind: 'requested',
      operationId: requestOperationId,
      subjectId: null,
      headline: 'Skill Check requested',
      createdAt: 10,
    }],
    createdAt: 10,
    updatedAt: 20,
    expiresAt: input.expiresAt === undefined ? 1_000 : input.expiresAt,
    terminalAt: null,
    lastOperationId: requestOperationId,
  })
}

const resolveCommand = (overrides: Partial<ResolveSkillCheckCommandV1> = {}): ResolveSkillCheckCommandV1 => ({
  schemaVersion: 1,
  operationId: resolveOperationId,
  expectedRevision: 1,
  commandKind: 'resolve',
  checkId,
  ...overrides,
})

const openHarness = (input: {
  readonly document?: SkillCheckDocumentV1
  readonly trainer?: TrainerSheet
  readonly pokemon?: CharacterSheet
  readonly secondPokemon?: CharacterSheet
} = {}) => {
  database = openRotomDatabase({ path: ':memory:', enableWal: false })
  const checks = createSqliteSkillCheckRepository(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  if (input.trainer !== undefined || input.document?.subjects.some(candidate => candidate.kind === 'trainer') !== false) {
    sheets.save({
      kind: 'trainer',
      slug: input.trainer?.slug ?? 'maya',
      revision: 4,
      updatedAt: 10,
      document: (input.trainer ?? trainerSheet()) as unknown as Record<string, unknown>,
    })
  }
  if (input.pokemon) {
    sheets.save({
      kind: 'pokemon', slug: input.pokemon.slug, revision: 7, updatedAt: 10,
      document: input.pokemon as unknown as Record<string, unknown>,
    })
  }
  if (input.secondPokemon) {
    sheets.save({
      kind: 'pokemon', slug: input.secondPokemon.slug, revision: 8, updatedAt: 10,
      document: input.secondPokemon as unknown as Record<string, unknown>,
    })
  }
  checks.insert(input.document ?? readyDocument())
  return { checks, sheets }
}

const sequenceRandom = (values: readonly number[]) => {
  let index = 0
  return (minimum: number, maximumExclusive: number): number => {
    const value = values[index++]
    if (value === undefined) throw new Error('Random sequence exhausted.')
    expect(value).toBeGreaterThanOrEqual(minimum)
    expect(value).toBeLessThan(maximumExclusive)
    return value
  }
}

const authority = { kind: 'gm', principalId: 'director' } as const

describe('P11-046 server-authoritative Skill Check resolution', () => {
  it('resolves Trainer and Pokémon dice and modifiers from exact authoritative sheet revisions', () => {
    const document = readyDocument({
      situationalModifier: 1,
      subjects: [
        subject({ subjectId: trainerSubjectId, kind: 'trainer', sheetSlug: 'maya', sheetRevision: 4 }),
        subject({ subjectId: pokemonSubjectId, kind: 'pokemon', sheetSlug: 'spark', sheetRevision: 7 }),
      ],
    })
    const harness = openHarness({
      document,
      trainer: trainerSheet({
        equipmentState: activeEquipmentState({
          ownerKind: 'trainer', ownerSlug: 'maya', slotId: 'feet', canonicalItemId: 'Running Shoes',
        }),
      }),
      pokemon: pokemonSheet(),
    })
    const receipt = resolveSkillCheckUseCase({ authority, command: resolveCommand() }, {
      database: database!,
      skillCheckRepository: harness.checks,
      sheetRepository: harness.sheets,
      now: () => 100,
      randomInt: sequenceRandom([3, 3, 3, 3, 4, 3, 2]),
    })

    expect(receipt).toMatchObject({
      schemaVersion: 1,
      operationId: resolveOperationId,
      checkId,
      revision: 2,
      state: 'accepted',
      updatedAt: 100,
      exactReplay: false,
    })
    expect(receipt.journals).toHaveLength(2)
    expect(receipt.journals[0]).toMatchObject({
      subjectId: trainerSubjectId,
      diceCount: 4,
      flatModifier: 4,
      results: [3, 3, 3, 3],
      dieTotal: 12,
      finalTotal: 16,
    })
    expect(receipt.journals[0]!.contributors.map(contributor => contributor.value)).toEqual([2, 1, 1])
    expect(receipt.journals[0]!.contributors.map(contributor => contributor.label)).toContain('Running Shoes')
    expect(receipt.journals[1]).toMatchObject({
      subjectId: pokemonSubjectId,
      diceCount: 3,
      flatModifier: 0,
      results: [4, 3, 2],
      dieTotal: 9,
      finalTotal: 9,
    })
    expect(receipt.journals[1]!.contributors.map(contributor => contributor.value)).toEqual([-1, 1])
    expect(receipt.acceptedResults).toEqual([
      expect.objectContaining({ subjectId: trainerSubjectId, finalTotal: 16, outcome: 'success', acceptedAt: 100 }),
      expect.objectContaining({ subjectId: pokemonSubjectId, finalTotal: 9, outcome: 'failure', acceptedAt: 100 }),
    ])
    expect(harness.checks.get(checkId)?.document).toMatchObject({
      revision: 2,
      state: 'accepted',
      terminalAt: 100,
      lastOperationId: resolveOperationId,
    })
    expect(harness.checks.findOperation(resolveOperationId)).toMatchObject({
      principalKey: 'gm:director',
      resultRevision: 2,
    })
  })

  it('returns the original journals and outcomes on an exact operation retry without consuming entropy', () => {
    const harness = openHarness()
    const command = resolveCommand()
    const first = resolveSkillCheckUseCase({ authority, command }, {
      database: database!,
      skillCheckRepository: harness.checks,
      sheetRepository: harness.sheets,
      now: () => 100,
      randomInt: sequenceRandom([6, 5, 4, 3]),
    })
    const replay = resolveSkillCheckUseCase({ authority, command }, {
      database: database!,
      skillCheckRepository: harness.checks,
      sheetRepository: harness.sheets,
      now: () => { throw new Error('Replay must not read time.') },
      randomInt: () => { throw new Error('Replay must not roll.') },
    })
    expect(replay).toEqual({ ...first, exactReplay: true })
    expect(harness.checks.get(checkId)?.revision).toBe(2)
    expect(database!.connection.prepare('SELECT COUNT(*) AS count FROM skill_check_operations').get())
      .toEqual({ count: 1 })
  })

  it('rerolls both opposed subjects only after ties and accepts the higher final total', () => {
    const first = pokemonSheet({ slug: 'first', nickname: 'First', skills: { athletics: '1d6' } })
    const second = pokemonSheet({ slug: 'second', nickname: 'Second', skills: { athletics: '1d6' } })
    const document = readyDocument({
      comparison: { kind: 'opposed', tiePolicy: 'reroll-both-up-to-10-then-journaled-server-coin' },
      subjects: [
        subject({ subjectId: 'skill-check-subject:v1:pokemon-first', kind: 'pokemon', sheetSlug: 'first', sheetRevision: 7 }),
        subject({ subjectId: 'skill-check-subject:v1:pokemon-second', kind: 'pokemon', sheetSlug: 'second', sheetRevision: 8 }),
      ],
    })
    const harness = openHarness({ document, trainer: undefined, pokemon: first, secondPokemon: second })
    const receipt = resolveSkillCheckUseCase({ authority, command: resolveCommand() }, {
      database: database!, skillCheckRepository: harness.checks, sheetRepository: harness.sheets,
      now: () => 100, randomInt: sequenceRandom([3, 3, 6, 2]),
    })
    expect(receipt.journals.map(journal => [journal.subjectId, journal.attempt, journal.finalTotal])).toEqual([
      ['skill-check-subject:v1:pokemon-first', 1, 3],
      ['skill-check-subject:v1:pokemon-second', 1, 3],
      ['skill-check-subject:v1:pokemon-first', 2, 6],
      ['skill-check-subject:v1:pokemon-second', 2, 2],
    ])
    expect(receipt.acceptedResults.map(result => result.outcome)).toEqual(['winner', 'loser'])
    expect(receipt.acceptedResults.map(result => result.journalIds.length)).toEqual([2, 2])
  })

  it('journals the bounded fair d6-parity coin after ten tied opposed rerolls', () => {
    const first = pokemonSheet({ slug: 'first', nickname: 'First', skills: { athletics: '1d6' } })
    const second = pokemonSheet({ slug: 'second', nickname: 'Second', skills: { athletics: '1d6' } })
    const document = readyDocument({
      comparison: { kind: 'opposed', tiePolicy: 'reroll-both-up-to-10-then-journaled-server-coin' },
      subjects: [
        subject({ subjectId: 'skill-check-subject:v1:pokemon-first', kind: 'pokemon', sheetSlug: 'first', sheetRevision: 7 }),
        subject({ subjectId: 'skill-check-subject:v1:pokemon-second', kind: 'pokemon', sheetSlug: 'second', sheetRevision: 8 }),
      ],
    })
    const harness = openHarness({ document, trainer: undefined, pokemon: first, secondPokemon: second })
    const receipt = resolveSkillCheckUseCase({ authority, command: resolveCommand() }, {
      database: database!, skillCheckRepository: harness.checks, sheetRepository: harness.sheets,
      now: () => 100, randomInt: sequenceRandom([...Array<number>(22).fill(3), 5]),
    })
    expect(receipt.journals).toHaveLength(23)
    const coin = receipt.journals.at(-1)!
    expect(coin).toMatchObject({ attempt: 11, diceCount: 1, results: [5], flatModifier: 0 })
    expect(coin.contributors).toEqual([expect.objectContaining({
      contributorId: SKILL_CHECK_TIE_BREAK_CONTRIBUTOR_ID,
      value: 0,
    })])
    expect(receipt.acceptedResults.map(result => [result.finalTotal, result.outcome, result.journalIds.length]))
      .toEqual([[3, 'winner', 11], [3, 'loser', 11]])
  })

  it('rejects client-supplied roll fields, stale commands, stale sheets, invalid skills, and expired checks before rolling', () => {
    const cases: Array<{
      readonly name: string
      readonly document?: SkillCheckDocumentV1
      readonly pokemon?: CharacterSheet
      readonly command?: unknown
      readonly now?: number
      readonly expectedCode: SkillCheckAuthorityError['code']
      readonly expectedCause?: string
    }> = [
      {
        name: 'client roll',
        command: { ...resolveCommand(), results: [6] },
        expectedCode: 'invalid-command',
      },
      {
        name: 'stale check',
        command: resolveCommand({ expectedRevision: 0 }),
        expectedCode: 'revision-conflict',
      },
      {
        name: 'stale sheet',
        document: readyDocument({ subjects: [subject({
          subjectId: trainerSubjectId, kind: 'trainer', sheetSlug: 'maya', sheetRevision: 3,
        })] }),
        expectedCode: 'resolution-rejected',
        expectedCause: 'sheet-revision-conflict',
      },
      {
        name: 'invalid skill dice',
        document: readyDocument({ subjects: [subject({
          subjectId: pokemonSubjectId, kind: 'pokemon', sheetSlug: 'spark', sheetRevision: 7,
        })] }),
        pokemon: pokemonSheet({ skills: { athletics: '7d6' } }),
        expectedCode: 'resolution-rejected',
        expectedCause: 'skill-unavailable',
      },
      {
        name: 'expired',
        document: readyDocument({ expiresAt: 100 }),
        now: 100,
        expectedCode: 'resolution-rejected',
        expectedCause: 'expired',
      },
    ]
    for (const testCase of cases) {
      database?.close()
      database = null
      const harness = openHarness({ document: testCase.document, pokemon: testCase.pokemon })
      let rolls = 0
      try {
        resolveSkillCheckUseCase({ authority, command: testCase.command ?? resolveCommand() }, {
          database: database!, skillCheckRepository: harness.checks, sheetRepository: harness.sheets,
          now: () => testCase.now ?? 100,
          randomInt: () => { rolls += 1; return 6 },
        })
        throw new Error(`${testCase.name} unexpectedly resolved.`)
      }
      catch (error) {
        expect(error, testCase.name).toBeInstanceOf(SkillCheckAuthorityError)
        expect((error as SkillCheckAuthorityError).code, testCase.name).toBe(testCase.expectedCode)
        expect((error as SkillCheckAuthorityError).causeCode, testCase.name).toBe(testCase.expectedCause ?? null)
      }
      expect(rolls, testCase.name).toBe(0)
      expect(harness.checks.get(checkId)?.state, testCase.name).toBe('ready')
      expect(harness.checks.findOperation(resolveOperationId), testCase.name).toBeNull()
    }
  })

  it('rejects changed operation reuse and principal-crossing replay without rerolling', () => {
    const harness = openHarness()
    const command = resolveCommand()
    resolveSkillCheckUseCase({ authority, command }, {
      database: database!, skillCheckRepository: harness.checks, sheetRepository: harness.sheets,
      now: () => 100, randomInt: sequenceRandom([1, 2, 3, 4]),
    })
    const changedInputError = (() => {
      try {
        resolveSkillCheckUseCase({ authority, command: { ...command, expectedRevision: 0 } }, {
          database: database!, skillCheckRepository: harness.checks, sheetRepository: harness.sheets,
          randomInt: () => { throw new Error('must not roll') },
        })
      }
      catch (error) { return error }
    })()
    expect(changedInputError).toMatchObject({ code: 'operation-conflict' })
    const principalError = (() => {
      try {
        resolveSkillCheckUseCase({ authority: { kind: 'gm', principalId: 'other-gm' }, command }, {
          database: database!, skillCheckRepository: harness.checks, sheetRepository: harness.sheets,
          randomInt: () => { throw new Error('must not roll') },
        })
      }
      catch (error) { return error }
    })()
    expect(principalError).toMatchObject({ code: 'forbidden' })
  })

  it('rolls back the accepted document and operation journal atomically on either write boundary failure', () => {
    for (const boundary of ['document', 'operation'] as const) {
      database?.close()
      database = null
      const harness = openHarness()
      expect(() => resolveSkillCheckUseCase({ authority, command: resolveCommand() }, {
        database: database!, skillCheckRepository: harness.checks, sheetRepository: harness.sheets,
        now: () => 100,
        randomInt: sequenceRandom([1, 2, 3, 4]),
        failAfterWrite: candidate => {
          if (candidate === boundary) throw new Error(`injected-${boundary}-failure`)
        },
      })).toThrow(`injected-${boundary}-failure`)
      expect(harness.checks.get(checkId)).toMatchObject({ revision: 1, state: 'ready' })
      expect(harness.checks.findOperation(resolveOperationId)).toBeNull()
    }
  })

  it('rejects invalid server randomness and leaves no accepted evidence', () => {
    const harness = openHarness()
    const error = (() => {
      try {
        resolveSkillCheckUseCase({ authority: { kind: 'server' }, command: resolveCommand() }, {
          database: database!, skillCheckRepository: harness.checks, sheetRepository: harness.sheets,
          now: () => 100,
          randomInt: () => 7,
        })
      }
      catch (caught) { return caught }
    })()
    expect(error).toMatchObject({ code: 'resolution-rejected', causeCode: 'invalid-randomness' })
    expect(harness.checks.get(checkId)).toMatchObject({ revision: 1, state: 'ready' })
    expect(harness.checks.findOperation(resolveOperationId)).toBeNull()
  })
})
