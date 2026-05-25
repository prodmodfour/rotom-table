import { describe, expect, it } from 'vitest'
import { parseGmKey, parseJoinCode, parseSessionId } from '#shared/sessionIdentity'
import { INITIAL_SESSION_REVISION, parseSessionRevision } from '#shared/sessionRevisions'
import {
  SESSION_STORE_STATUSES,
  createInMemorySessionStore,
  type CreateSessionStoreRecordInput,
  type SessionStoreRecord,
  type SessionStoreStatus,
} from '~~/server/utils/sessionStore'

interface SessionStateFixture {
  readonly selectedMapSlug: string
  readonly tokenCount: number
}

const sessionId = parseSessionId('session_store00000001')
const otherSessionId = parseSessionId('session_store00000002')
const thirdSessionId = parseSessionId('session_store00000003')
const joinCode = parseJoinCode('ABC234')
const otherJoinCode = parseJoinCode('DEF567')
const gmKey = parseGmKey('gmkey_abcdefghijklmnopqrstuvwxyzAB')
const otherGmKey = parseGmKey('gmkey_abcdefghijklmnopqrstuvwxyzCD')

const createClock = (timestamps: readonly string[]) => {
  let index = 0
  return () => timestamps[Math.min(index++, timestamps.length - 1)]
}

const createSessionInput = (
  overrides: Partial<CreateSessionStoreRecordInput<SessionStateFixture>> = {},
): CreateSessionStoreRecordInput<SessionStateFixture> => ({
  sessionId,
  joinCode,
  gmKey,
  ...overrides,
})

const expectRecordIdentity = (record: SessionStoreRecord<SessionStateFixture> | undefined) => {
  expect(record).toMatchObject({
    sessionId,
    joinCode,
    gmKey,
    status: 'active',
  })
}

describe('server in-memory session store', () => {
  it('defines the initial lifecycle statuses', () => {
    expect(SESSION_STORE_STATUSES).toEqual(['active', 'ended'])
    const status: SessionStoreStatus = 'active'
    expect(status).toBe('active')
  })

  it('creates active sessions keyed by session ID and join code', () => {
    const store = createInMemorySessionStore<SessionStateFixture>(
      createClock(['2026-05-25T01:00:00.000Z']),
    )
    const state = { selectedMapSlug: 'viridian-gym', tokenCount: 2 }

    const created = store.create(createSessionInput({ state }))

    expect(store.size).toBe(1)
    expect(created).toEqual({
      sessionId,
      joinCode,
      gmKey,
      revision: INITIAL_SESSION_REVISION,
      status: 'active',
      createdAt: '2026-05-25T01:00:00.000Z',
      updatedAt: '2026-05-25T01:00:00.000Z',
      state,
    })
    expect(store.has(sessionId)).toBe(true)
    expect(store.get(sessionId)).toEqual(created)
    expect(store.getByJoinCode(joinCode)).toEqual(created)
    expect(store.findActiveByJoinCode(joinCode)).toEqual(created)
    expect(store.get(otherSessionId)).toBeUndefined()
    expect(store.getByJoinCode(otherJoinCode)).toBeUndefined()
  })

  it('rejects duplicate session IDs and duplicate join codes', () => {
    const store = createInMemorySessionStore<SessionStateFixture>()
    store.create(createSessionInput())

    expect(() => store.create(createSessionInput({ joinCode: otherJoinCode }))).toThrow(
      'Session session_store00000001 already exists',
    )
    expect(() =>
      store.create(
        createSessionInput({
          sessionId: otherSessionId,
          gmKey: otherGmKey,
        }),
      ),
    ).toThrow('Join code ABC234 is already assigned to a session')
  })

  it('lists sessions deterministically and filters active sessions', () => {
    const store = createInMemorySessionStore<SessionStateFixture>()
    const first = store.create(
      createSessionInput({
        sessionId: otherSessionId,
        joinCode: otherJoinCode,
        createdAt: '2026-05-25T01:01:00.000Z',
      }),
    )
    const second = store.create(
      createSessionInput({
        createdAt: '2026-05-25T01:00:00.000Z',
      }),
    )
    const ended = store.end(otherSessionId, { endedAt: '2026-05-25T01:02:00.000Z' })

    expect(store.list().map((record) => record.sessionId)).toEqual([
      second.sessionId,
      first.sessionId,
    ])
    expect(store.listActive()).toEqual([second])
    expect(ended?.status).toBe('ended')
  })

  it('updates opaque authoritative state and revisions without replacing the session key', () => {
    const store = createInMemorySessionStore<SessionStateFixture>(
      createClock(['2026-05-25T01:00:00.000Z', '2026-05-25T01:05:00.000Z']),
    )
    store.create(createSessionInput({ state: { selectedMapSlug: 'viridian-gym', tokenCount: 1 } }))

    const updated = store.setState(
      sessionId,
      { selectedMapSlug: 'pewter-gym', tokenCount: 3 },
      { revision: parseSessionRevision(2) },
    )

    expect(updated).toMatchObject({
      sessionId,
      joinCode,
      revision: parseSessionRevision(2),
      status: 'active',
      createdAt: '2026-05-25T01:00:00.000Z',
      updatedAt: '2026-05-25T01:05:00.000Z',
      state: { selectedMapSlug: 'pewter-gym', tokenCount: 3 },
    })
    expect(
      store.setState(otherSessionId, { selectedMapSlug: 'missing', tokenCount: 0 }),
    ).toBeUndefined()
  })

  it('touches active records and ends sessions while keeping ended records queryable by ID', () => {
    const store = createInMemorySessionStore<SessionStateFixture>()
    store.create(createSessionInput({ createdAt: '2026-05-25T01:00:00.000Z' }))

    const touched = store.touch(sessionId, { updatedAt: '2026-05-25T01:10:00.000Z' })
    expectRecordIdentity(touched)
    expect(touched?.updatedAt).toBe('2026-05-25T01:10:00.000Z')

    const ended = store.end(sessionId, { endedAt: '2026-05-25T01:20:00.000Z' })
    expect(ended).toMatchObject({
      sessionId,
      status: 'ended',
      updatedAt: '2026-05-25T01:20:00.000Z',
      endedAt: '2026-05-25T01:20:00.000Z',
    })
    expect(store.get(sessionId)).toEqual(ended)
    expect(store.getByJoinCode(joinCode)).toEqual(ended)
    expect(store.findActiveByJoinCode(joinCode)).toBeUndefined()
    expect(store.listActive()).toEqual([])
    expect(store.touch(thirdSessionId)).toBeUndefined()
    expect(store.end(thirdSessionId)).toBeUndefined()
  })

  it('deletes sessions, clears indexes, and reports missing deletes safely', () => {
    const store = createInMemorySessionStore<SessionStateFixture>()
    store.create(createSessionInput())
    store.create(
      createSessionInput({
        sessionId: otherSessionId,
        joinCode: otherJoinCode,
        gmKey: otherGmKey,
      }),
    )

    expect(store.delete(sessionId)).toBe(true)
    expect(store.delete(sessionId)).toBe(false)
    expect(store.get(sessionId)).toBeUndefined()
    expect(store.getByJoinCode(joinCode)).toBeUndefined()
    expect(store.size).toBe(1)

    store.clear()
    expect(store.size).toBe(0)
    expect(store.list()).toEqual([])
    expect(store.getByJoinCode(otherJoinCode)).toBeUndefined()
  })
})
