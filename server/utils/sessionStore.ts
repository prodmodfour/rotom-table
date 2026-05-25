import type { GmKey, JoinCode, SessionId } from '#shared/sessionIdentity'
import { INITIAL_SESSION_REVISION, type SessionRevision } from '#shared/sessionRevisions'

export const SESSION_STORE_STATUSES = ['active', 'ended'] as const
export type SessionStoreStatus = (typeof SESSION_STORE_STATUSES)[number]

export type SessionStoreClock = () => string

export interface SessionStoreRecord<TState = unknown> {
  readonly sessionId: SessionId
  readonly joinCode: JoinCode
  readonly gmKey: GmKey
  readonly revision: SessionRevision
  readonly status: SessionStoreStatus
  readonly createdAt: string
  readonly updatedAt: string
  readonly endedAt?: string
  /**
   * Opaque authoritative state placeholder. Ticket 021 defines the concrete
   * per-session map/player/assignment model that will be stored here.
   */
  readonly state?: TState
}

export interface CreateSessionStoreRecordInput<TState = unknown> {
  readonly sessionId: SessionId
  readonly joinCode: JoinCode
  readonly gmKey: GmKey
  readonly revision?: SessionRevision
  readonly createdAt?: string
  readonly updatedAt?: string
  readonly state?: TState
}

export interface SetSessionStoreStateOptions {
  readonly revision?: SessionRevision
  readonly updatedAt?: string
}

export interface TouchSessionStoreRecordOptions {
  readonly updatedAt?: string
}

export interface EndSessionStoreRecordOptions {
  readonly endedAt?: string
}

export interface InMemorySessionStore<TState = unknown> {
  readonly size: number
  create(input: CreateSessionStoreRecordInput<TState>): SessionStoreRecord<TState>
  get(sessionId: SessionId): SessionStoreRecord<TState> | undefined
  getByJoinCode(joinCode: JoinCode): SessionStoreRecord<TState> | undefined
  findActiveByJoinCode(joinCode: JoinCode): SessionStoreRecord<TState> | undefined
  has(sessionId: SessionId): boolean
  list(): readonly SessionStoreRecord<TState>[]
  listActive(): readonly SessionStoreRecord<TState>[]
  setState(
    sessionId: SessionId,
    state: TState,
    options?: SetSessionStoreStateOptions,
  ): SessionStoreRecord<TState> | undefined
  touch(
    sessionId: SessionId,
    options?: TouchSessionStoreRecordOptions,
  ): SessionStoreRecord<TState> | undefined
  end(
    sessionId: SessionId,
    options?: EndSessionStoreRecordOptions,
  ): SessionStoreRecord<TState> | undefined
  delete(sessionId: SessionId): boolean
  clear(): void
}

type MutableSessionStoreRecord<TState> = {
  -readonly [TKey in keyof SessionStoreRecord<TState>]: SessionStoreRecord<TState>[TKey]
}

const defaultSessionStoreClock: SessionStoreClock = () => new Date().toISOString()

const cloneSessionRecord = <TState>(
  record: MutableSessionStoreRecord<TState>,
): SessionStoreRecord<TState> => ({ ...record })

const hasOwn = <TKey extends PropertyKey>(
  value: object,
  key: TKey,
): value is object & Record<TKey, unknown> => Object.prototype.hasOwnProperty.call(value, key)

const sortSessionRecords = <TState>(
  records: Iterable<MutableSessionStoreRecord<TState>>,
): SessionStoreRecord<TState>[] =>
  [...records]
    .sort((left, right) => {
      const createdComparison = left.createdAt.localeCompare(right.createdAt)
      return createdComparison === 0
        ? left.sessionId.localeCompare(right.sessionId)
        : createdComparison
    })
    .map(cloneSessionRecord)

export const createInMemorySessionStore = <TState = unknown>(
  clock: SessionStoreClock = defaultSessionStoreClock,
): InMemorySessionStore<TState> => {
  const recordsBySessionId = new Map<SessionId, MutableSessionStoreRecord<TState>>()
  const sessionIdsByJoinCode = new Map<JoinCode, SessionId>()

  const getMutableByJoinCode = (
    joinCode: JoinCode,
  ): MutableSessionStoreRecord<TState> | undefined => {
    const sessionId = sessionIdsByJoinCode.get(joinCode)
    return sessionId === undefined ? undefined : recordsBySessionId.get(sessionId)
  }

  const create = (input: CreateSessionStoreRecordInput<TState>): SessionStoreRecord<TState> => {
    if (recordsBySessionId.has(input.sessionId)) {
      throw new Error(`Session ${input.sessionId} already exists`)
    }

    if (sessionIdsByJoinCode.has(input.joinCode)) {
      throw new Error(`Join code ${input.joinCode} is already assigned to a session`)
    }

    const timestamp = input.createdAt ?? clock()
    const record: MutableSessionStoreRecord<TState> = {
      sessionId: input.sessionId,
      joinCode: input.joinCode,
      gmKey: input.gmKey,
      revision: input.revision ?? INITIAL_SESSION_REVISION,
      status: 'active',
      createdAt: timestamp,
      updatedAt: input.updatedAt ?? timestamp,
    }

    if (hasOwn(input, 'state')) {
      record.state = input.state
    }

    recordsBySessionId.set(record.sessionId, record)
    sessionIdsByJoinCode.set(record.joinCode, record.sessionId)

    return cloneSessionRecord(record)
  }

  const get = (sessionId: SessionId): SessionStoreRecord<TState> | undefined => {
    const record = recordsBySessionId.get(sessionId)
    return record === undefined ? undefined : cloneSessionRecord(record)
  }

  const getByJoinCode = (joinCode: JoinCode): SessionStoreRecord<TState> | undefined => {
    const record = getMutableByJoinCode(joinCode)
    return record === undefined ? undefined : cloneSessionRecord(record)
  }

  const findActiveByJoinCode = (joinCode: JoinCode): SessionStoreRecord<TState> | undefined => {
    const record = getMutableByJoinCode(joinCode)
    return record?.status === 'active' ? cloneSessionRecord(record) : undefined
  }

  const setState = (
    sessionId: SessionId,
    state: TState,
    options: SetSessionStoreStateOptions = {},
  ): SessionStoreRecord<TState> | undefined => {
    const record = recordsBySessionId.get(sessionId)
    if (record === undefined) return undefined

    record.state = state
    if (options.revision !== undefined) {
      record.revision = options.revision
    }
    record.updatedAt = options.updatedAt ?? clock()

    return cloneSessionRecord(record)
  }

  const touch = (
    sessionId: SessionId,
    options: TouchSessionStoreRecordOptions = {},
  ): SessionStoreRecord<TState> | undefined => {
    const record = recordsBySessionId.get(sessionId)
    if (record === undefined) return undefined

    record.updatedAt = options.updatedAt ?? clock()
    return cloneSessionRecord(record)
  }

  const end = (
    sessionId: SessionId,
    options: EndSessionStoreRecordOptions = {},
  ): SessionStoreRecord<TState> | undefined => {
    const record = recordsBySessionId.get(sessionId)
    if (record === undefined) return undefined

    const endedAt = options.endedAt ?? clock()
    record.status = 'ended'
    record.endedAt = endedAt
    record.updatedAt = endedAt

    return cloneSessionRecord(record)
  }

  const remove = (sessionId: SessionId): boolean => {
    const record = recordsBySessionId.get(sessionId)
    if (record === undefined) return false

    recordsBySessionId.delete(sessionId)
    sessionIdsByJoinCode.delete(record.joinCode)
    return true
  }

  return {
    get size() {
      return recordsBySessionId.size
    },
    create,
    get,
    getByJoinCode,
    findActiveByJoinCode,
    has: (sessionId) => recordsBySessionId.has(sessionId),
    list: () => sortSessionRecords(recordsBySessionId.values()),
    listActive: () =>
      sortSessionRecords(
        [...recordsBySessionId.values()].filter((record) => record.status === 'active'),
      ),
    setState,
    touch,
    end,
    delete: remove,
    clear: () => {
      recordsBySessionId.clear()
      sessionIdsByJoinCode.clear()
    },
  }
}

export const sessionStore = createInMemorySessionStore()
