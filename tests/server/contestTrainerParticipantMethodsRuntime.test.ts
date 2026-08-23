import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteContestRepository } from '../../server/storage/contestRepository'
import { executeContestCommandUseCase, loadContestUseCase } from '../../server/useCases/contests'
import { createSeededContestRandomSource } from '../../shared/contests/dice'
import type { ContestPublicProjectionV1 } from '../../shared/contests/projections'

const databases: RotomDatabase[] = []
afterEach(() => { while (databases.length) databases.pop()!.close() })
const op = (id: string) => `contest-op:v1:${id.padEnd(8, 'x')}`
const base = (contestId: string, commandKind: string, operation: string, expectedRevision: number) => ({ schemaVersion: 1, contestId, commandKind, operationId: op(operation), expectedRevision, clientId: 'method-runtime' })
const setup = () => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false }); databases.push(database)
  return {
    database,
    deps: { database, random: createSeededContestRandomSource(55), now: () => 500, publishPersistedRealtimeEvent: () => {}, reportAfterCommitPublicationFailure: () => {} },
  }
}
const settings = (participantMethodId: 'simultaneous'|'alternating') => ({
  name: 'Method Runtime', hallName: 'Method Hall', description: '', variantId: 'standard', participantVariantId: 'trainer-participant', participantMethodId,
  contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon: true, prize: { declared: true, money: 0, items: [], notes: '' }, gmNotes: '',
})

describe('Trainer Participant method runtime', () => {
  it('persists an explicit method, projects it publicly, and changes it with exact CAS replay', () => {
    const context = setup(), contestId = 'contest:v1:participant-method-runtime'
    let response = executeContestCommandUseCase({ ...base(contestId, 'create-contest', 'method-create', 0), settings: settings('alternating') }, { role: 'gm' }, context.deps)
    expect(response.projection).toMatchObject({ participantVariantId: 'trainer-participant', participantMethodId: 'alternating', revision: 0 })
    expect(loadContestUseCase(contestId, { role: 'player' }, context.deps)).toMatchObject({ participantMethodId: 'alternating' })

    const choose = { ...base(contestId, 'set-participant-method', 'method-choose', response.result.revision), participantMethodId: 'simultaneous' }
    response = executeContestCommandUseCase(choose, { role: 'gm' }, context.deps)
    expect(response.result).toMatchObject({ exactRetry: false, revision: 1 })
    expect(response.projection).toMatchObject({ participantMethodId: 'simultaneous' })
    expect((response.projection as ContestPublicProjectionV1).history.at(-1)).toMatchObject({ type: 'participant-method-selected', headline: 'Simultaneous method selected' })

    const retry = executeContestCommandUseCase(choose, { role: 'gm' }, context.deps)
    expect(retry.result).toEqual({ ...response.result, exactRetry: true })
    const stored = createSqliteContestRepository(context.database).get(contestId)!
    expect(stored.document.participantMethodId).toBe('simultaneous')
    expect(stored.document.history.filter(row => row.type === 'participant-method-selected')).toHaveLength(1)
    expect(createSqliteContestRepository(context.database).findOperation(op('method-choose'))?.resultRevision).toBe(1)

    expect(() => executeContestCommandUseCase({ ...choose, participantMethodId: 'alternating' }, { role: 'gm' }, context.deps)).toThrow(/operation ID was reused with changed input/i)
    expect(() => executeContestCommandUseCase({ ...base(contestId, 'set-participant-method', 'method-stale', 0), participantMethodId: 'alternating' }, { role: 'gm' }, context.deps)).toThrow(/revision/i)
    expect(createSqliteContestRepository(context.database).get(contestId)!.document.participantMethodId).toBe('simultaneous')
  })

  it('rejects non-GM and ordinary-Contest method writes without revisions or operations', () => {
    const context = setup(), contestId = 'contest:v1:participant-method-auth'
    const created = executeContestCommandUseCase({ ...base(contestId, 'create-contest', 'method-auth-create', 0), settings: settings('alternating') }, { role: 'gm' }, context.deps)
    const unauthorized = { ...base(contestId, 'set-participant-method', 'method-auth-set', created.result.revision), participantMethodId: 'simultaneous' }
    expect(() => executeContestCommandUseCase(unauthorized, { role: 'player', playerProfile: { id: 'profile_method01' } as any }, context.deps)).toThrow(/Only the GM/)
    expect(createSqliteContestRepository(context.database).get(contestId)).toMatchObject({ revision: 0, document: { participantMethodId: 'alternating' } })
    expect(createSqliteContestRepository(context.database).findOperation(op('method-auth-set'))).toBeNull()

    const ordinaryId = 'contest:v1:ordinary-method-runtime'
    const { participantMethodId: _participantMethodId, ...ordinarySettings } = settings('alternating')
    const ordinary = executeContestCommandUseCase({ ...base(ordinaryId, 'create-contest', 'ordinary-create', 0), settings: { ...ordinarySettings, participantVariantId: null } }, { role: 'gm' }, context.deps)
    const invalid = { ...base(ordinaryId, 'set-participant-method', 'ordinary-set', ordinary.result.revision), participantMethodId: 'simultaneous' }
    expect(() => executeContestCommandUseCase(invalid, { role: 'gm' }, context.deps)).toThrow(/available only to Trainer Participant/)
    expect(createSqliteContestRepository(context.database).get(ordinaryId)).toMatchObject({ revision: 0, document: { participantMethodId: null } })
    expect(createSqliteContestRepository(context.database).findOperation(op('ordinary-set'))).toBeNull()
  })
})
