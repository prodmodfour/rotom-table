import { createHash } from 'node:crypto'
import {
  DEFAULT_REALTIME_EVENT_READ_LIMIT,
  MAX_REALTIME_EVENT_READ_LIMIT,
  createRealtimeEventMaterial,
  parsePersistedRealtimeEvent,
  parseRealtimeEventAccess,
  parseRealtimeEventCursorState,
  parseRealtimeEventCursorValue,
  parseRealtimeEventDedupeKey,
  parseRealtimeEventDraft,
  parseRealtimeEventReadLimit,
  parseRealtimeEventSequence,
  parseRealtimeEventTimestamp,
  parseSequencedRealtimeEvent,
  stringifyCanonicalRealtimeJson,
  type PersistedRealtimeEvent,
  type RealtimeEventAccess,
  type RealtimeEventCursorState,
  type RealtimeEventCursorStatus,
  type RealtimeEventDraft,
} from '#shared/realtimeEventLog'
import {
  MAX_REALTIME_EVENT_MAX_ROWS,
  MAX_REALTIME_EVENT_PRUNE_INTERVAL_MS,
  MAX_REALTIME_EVENT_RETENTION_DAYS,
  MIN_REALTIME_EVENT_MAX_ROWS,
  MIN_REALTIME_EVENT_PRUNE_INTERVAL_MS,
  MIN_REALTIME_EVENT_RETENTION_DAYS,
  type RealtimeEventRetentionPolicy,
} from '../realtime/realtimeEventRetentionConfig'
import { getRotomDatabase, type RotomDatabase } from './database'

export {
  DEFAULT_REALTIME_EVENT_READ_LIMIT,
  MAX_REALTIME_EVENT_READ_LIMIT,
}

export type {
  PersistedRealtimeEvent,
  RealtimeEventAccess,
  RealtimeEventCursorState,
  RealtimeEventCursorStatus,
  RealtimeEventDraft,
}

export interface AppendRealtimeEventInput {
  readonly event: RealtimeEventDraft
  readonly access: RealtimeEventAccess
  readonly dedupeKey?: string
  readonly timestamp?: number
}

export interface ReadRealtimeEventsAfterInput {
  readonly afterSequence: number
  readonly limit?: number
}

export interface ReadRealtimeEventsAfterResult {
  readonly status: RealtimeEventCursorStatus
  readonly requestedAfterSequence: number
  readonly earliestAvailableSequence: number
  readonly latestSequence: number
  readonly events: readonly PersistedRealtimeEvent[]
  readonly hasMore: boolean
}

export interface RealtimeEventPruneResult {
  readonly deletedCount: number
  readonly previousCursorState: RealtimeEventCursorState
  readonly currentCursorState: RealtimeEventCursorState
}

export interface PlanRealtimeEventRetentionInput {
  readonly policy: RealtimeEventRetentionPolicy
  readonly now?: number
}

export interface RealtimeEventRetentionInspection {
  readonly rowCount: number
  readonly cursorState: RealtimeEventCursorState
  readonly oldestTimestamp: number | null
  readonly newestTimestamp: number | null
  readonly cutoffSequence: number
  readonly eligibleByAge: number
  readonly eligibleByCount: number
}

export type RealtimeEventRetentionCutoffReason = 'disabled' | 'none' | 'age' | 'row-count' | 'age-and-row-count'

export interface RealtimeEventRetentionPlan extends RealtimeEventRetentionInspection {
  readonly policy: RealtimeEventRetentionPolicy
  readonly now: number
  readonly ageCutoffTimestamp: number
  readonly ageCutoffSequence: number
  readonly rowCountCutoffSequence: number
  readonly estimatedDeleteCount: number
  readonly cutoffReason: RealtimeEventRetentionCutoffReason
}

export interface RealtimeEventRetentionPruneResult extends RealtimeEventRetentionPlan {
  readonly deletedCount: number
  readonly deletedThroughSequence: number
  readonly previousCursorState: RealtimeEventCursorState
  readonly currentCursorState: RealtimeEventCursorState
}

export interface RealtimeEventRepository {
  readonly database?: RotomDatabase
  append(input: AppendRealtimeEventInput): PersistedRealtimeEvent
  appendMany(inputs: readonly AppendRealtimeEventInput[]): readonly PersistedRealtimeEvent[]
  getBySequence(sequence: number): PersistedRealtimeEvent | null
  getByDedupeKey(dedupeKey: string): PersistedRealtimeEvent | null
  cursorState(): RealtimeEventCursorState
  readAfter(input: ReadRealtimeEventsAfterInput): ReadRealtimeEventsAfterResult
  inspectRetention(input: PlanRealtimeEventRetentionInput): RealtimeEventRetentionPlan
  planRetention(input: PlanRealtimeEventRetentionInput): RealtimeEventRetentionPlan
  /**
   * Deletes retained durable realtime rows through a sequence cursor.
   * Pruned dedupe keys intentionally become reusable because their unique rows no longer exist.
   */
  pruneThrough(sequence: number): RealtimeEventPruneResult
  pruneRetention(input: PlanRealtimeEventRetentionInput): RealtimeEventRetentionPruneResult
}

export interface CreateSqliteRealtimeEventRepositoryOptions {
  readonly database?: RotomDatabase
  readonly clock?: () => number
}

export interface RealtimeEventDedupeConflictErrorInput {
  readonly dedupeKey: string
  readonly existingSequence: number
  readonly existingMaterialHash: string
  readonly attemptedMaterialHash: string
}

export class RealtimeEventDedupeConflictError extends Error {
  readonly dedupeKey: string
  readonly existingSequence: number
  readonly existingMaterialHash: string
  readonly attemptedMaterialHash: string

  constructor(input: RealtimeEventDedupeConflictErrorInput) {
    super(`Realtime event dedupe key ${input.dedupeKey} already exists with different event material`)
    this.name = 'RealtimeEventDedupeConflictError'
    this.dedupeKey = input.dedupeKey
    this.existingSequence = input.existingSequence
    this.existingMaterialHash = input.existingMaterialHash
    this.attemptedMaterialHash = input.attemptedMaterialHash
  }
}

export const isRealtimeEventDedupeConflictError = (
  error: unknown,
): error is RealtimeEventDedupeConflictError => error instanceof RealtimeEventDedupeConflictError

interface RealtimeEventRow {
  readonly sequence: unknown
  readonly dedupe_key: unknown
  readonly material_hash: unknown
  readonly channel: unknown
  readonly event_type: unknown
  readonly access_json: unknown
  readonly event_json: unknown
  readonly created_at: unknown
}

interface RealtimeEventStateRow {
  readonly latest_sequence: unknown
  readonly earliest_available_sequence: unknown
}

interface RealtimeEventRetentionAggregateRow {
  readonly row_count: unknown
  readonly oldest_timestamp: unknown
  readonly newest_timestamp: unknown
}

interface RealtimeEventSequenceRow {
  readonly sequence: unknown
}

interface StoredRealtimeEvent {
  readonly materialHash: string
  readonly record: PersistedRealtimeEvent
}

interface NormalizedAppendRealtimeEventInput {
  readonly event: RealtimeEventDraft
  readonly access: RealtimeEventAccess
  readonly dedupeKey?: string
  readonly timestamp: number
  readonly materialHash: string
  readonly accessJson: string
}

const REALTIME_EVENT_COLUMNS = `
  sequence,
  dedupe_key,
  material_hash,
  channel,
  event_type,
  access_json,
  event_json,
  created_at
`

const MATERIAL_HASH_RE = /^[a-f0-9]{64}$/
const REALTIME_EVENT_RETENTION_DAY_MS = 24 * 60 * 60 * 1000

const sqliteIntegerToNumber = (value: unknown, label: string): number => {
  const numberValue = typeof value === 'bigint' ? Number(value) : value
  return parseRealtimeEventSequence(numberValue, label)
}

const nullableSqliteIntegerToNumber = (value: unknown, label: string): number | null => {
  if (value === null || value === undefined) return null
  return sqliteIntegerToNumber(value, label)
}

const parseBoundedRetentionInteger = (input: {
  readonly value: unknown
  readonly label: string
  readonly min: number
  readonly max: number
}): number => {
  if (typeof input.value !== 'number' || !Number.isSafeInteger(input.value)) {
    throw new Error(`${input.label} must be a safe integer`)
  }
  if (input.value < input.min || input.value > input.max) {
    throw new Error(`${input.label} must be between ${input.min} and ${input.max}`)
  }
  return input.value
}

const parseRetentionPolicy = (policy: RealtimeEventRetentionPolicy): RealtimeEventRetentionPolicy => {
  if (typeof policy.enabled !== 'boolean') throw new Error('realtime event retention enabled must be a boolean')
  return {
    enabled: policy.enabled,
    retentionDays: parseBoundedRetentionInteger({
      value: policy.retentionDays,
      label: 'realtime event retention days',
      min: MIN_REALTIME_EVENT_RETENTION_DAYS,
      max: MAX_REALTIME_EVENT_RETENTION_DAYS,
    }),
    maxRows: parseBoundedRetentionInteger({
      value: policy.maxRows,
      label: 'realtime event max retained rows',
      min: MIN_REALTIME_EVENT_MAX_ROWS,
      max: MAX_REALTIME_EVENT_MAX_ROWS,
    }),
    pruneIntervalMs: parseBoundedRetentionInteger({
      value: policy.pruneIntervalMs,
      label: 'realtime event prune interval ms',
      min: MIN_REALTIME_EVENT_PRUNE_INTERVAL_MS,
      max: MAX_REALTIME_EVENT_PRUNE_INTERVAL_MS,
    }),
  }
}

const parseRetentionNow = (value: unknown): number => parseRealtimeEventTimestamp(value, 'realtime event retention timestamp')

const parseMaterialHash = (value: unknown, label = 'material_hash'): string => {
  if (typeof value !== 'string' || !MATERIAL_HASH_RE.test(value)) {
    throw new Error(`${label} must be a SHA-256 hex digest`)
  }
  return value
}

const parseJsonColumn = (value: unknown, label: string): unknown => {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  try {
    return JSON.parse(value) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${label} could not be parsed: ${message}`)
  }
}

const hashRealtimeEventMaterial = (input: {
  readonly event: RealtimeEventDraft
  readonly access: RealtimeEventAccess
  readonly dedupeKey?: string
}): string => createHash('sha256')
  .update(stringifyCanonicalRealtimeJson(createRealtimeEventMaterial(input), 'realtime event material'))
  .digest('hex')

const normalizeAppendInput = (
  input: AppendRealtimeEventInput,
  defaultTimestamp: number | undefined,
): NormalizedAppendRealtimeEventInput => {
  const event = parseRealtimeEventDraft(input.event)
  const access = parseRealtimeEventAccess(input.access)
  const dedupeKey = parseRealtimeEventDedupeKey(input.dedupeKey)
  const timestamp = input.timestamp === undefined
    ? defaultTimestamp
    : parseRealtimeEventTimestamp(input.timestamp, 'realtime event timestamp')
  if (timestamp === undefined) throw new Error('realtime event timestamp default was not captured')

  return {
    event,
    access,
    ...(dedupeKey === undefined ? {} : { dedupeKey }),
    timestamp,
    materialHash: hashRealtimeEventMaterial({ event, access, ...(dedupeKey === undefined ? {} : { dedupeKey }) }),
    accessJson: stringifyCanonicalRealtimeJson(access, 'realtime event access'),
  }
}

const rowToStoredRealtimeEvent = (row: RealtimeEventRow): StoredRealtimeEvent => {
  const sequence = sqliteIntegerToNumber(row.sequence, 'realtime_events.sequence')
  const dedupeKey = parseRealtimeEventDedupeKey(row.dedupe_key, 'realtime_events.dedupe_key')
  const materialHash = parseMaterialHash(row.material_hash, 'realtime_events.material_hash')
  const access = parseRealtimeEventAccess(
    parseJsonColumn(row.access_json, `realtime event ${sequence} access_json`),
    `realtime event ${sequence} access`,
  )
  const event = parseSequencedRealtimeEvent(
    parseJsonColumn(row.event_json, `realtime event ${sequence} event_json`),
  )

  const channel = typeof row.channel === 'string' ? row.channel : null
  const eventType = typeof row.event_type === 'string' ? row.event_type : null
  const createdAt = sqliteIntegerToNumber(row.created_at, 'realtime_events.created_at')

  if (channel !== event.channel) throw new Error(`realtime event ${sequence} channel must match event_json.channel`)
  if (eventType !== event.type) throw new Error(`realtime event ${sequence} event_type must match event_json.type`)
  if (createdAt !== event.timestamp) throw new Error(`realtime event ${sequence} created_at must match event_json.timestamp`)

  return {
    materialHash,
    record: parsePersistedRealtimeEvent({
      sequence,
      ...(dedupeKey === undefined ? {} : { dedupeKey }),
      access,
      event,
    }),
  }
}

export const createSqliteRealtimeEventRepository = (
  options: CreateSqliteRealtimeEventRepositoryOptions = {},
): RealtimeEventRepository => {
  const database = options.database ?? getRotomDatabase()
  const clock = options.clock ?? Date.now

  const findBySequence = (sequence: number): StoredRealtimeEvent | null => {
    const parsedSequence = parseRealtimeEventCursorValue(sequence, 'realtime event sequence')
    const row = database.connection.prepare(`
      SELECT ${REALTIME_EVENT_COLUMNS}
      FROM realtime_events
      WHERE sequence = ?
    `).get(parsedSequence) as RealtimeEventRow | undefined
    return row ? rowToStoredRealtimeEvent(row) : null
  }

  const findByDedupeKey = (dedupeKey: string): StoredRealtimeEvent | null => {
    const parsedDedupeKey = parseRealtimeEventDedupeKey(dedupeKey)
    if (parsedDedupeKey === undefined) throw new Error('dedupeKey is required')
    const row = database.connection.prepare(`
      SELECT ${REALTIME_EVENT_COLUMNS}
      FROM realtime_events
      WHERE dedupe_key = ?
    `).get(parsedDedupeKey) as RealtimeEventRow | undefined
    return row ? rowToStoredRealtimeEvent(row) : null
  }

  const readCursorState = (): RealtimeEventCursorState => {
    const row = database.connection.prepare(`
      SELECT latest_sequence, earliest_available_sequence
      FROM realtime_event_log_state
      WHERE singleton = 1
    `).get() as RealtimeEventStateRow | undefined
    if (!row) throw new Error('realtime_event_log_state singleton row is missing')
    return parseRealtimeEventCursorState({
      latestSequence: sqliteIntegerToNumber(row.latest_sequence, 'realtime_event_log_state.latest_sequence'),
      earliestAvailableSequence: sqliteIntegerToNumber(
        row.earliest_available_sequence,
        'realtime_event_log_state.earliest_available_sequence',
      ),
    })
  }

  const updateLatestSequence = (sequence: number): void => {
    database.connection.prepare(`
      UPDATE realtime_event_log_state
      SET latest_sequence = ?,
          earliest_available_sequence = CASE
            WHEN earliest_available_sequence > ? THEN ?
            ELSE earliest_available_sequence
          END
      WHERE singleton = 1
    `).run(sequence, sequence, sequence)
  }

  const appendNormalized = (input: NormalizedAppendRealtimeEventInput): PersistedRealtimeEvent => {
    if (input.dedupeKey !== undefined) {
      const existing = findByDedupeKey(input.dedupeKey)
      if (existing) {
        if (existing.materialHash === input.materialHash) return existing.record
        throw new RealtimeEventDedupeConflictError({
          dedupeKey: input.dedupeKey,
          existingSequence: existing.record.sequence,
          existingMaterialHash: existing.materialHash,
          attemptedMaterialHash: input.materialHash,
        })
      }
    }

    const insert = database.connection.prepare(`
      INSERT INTO realtime_events (
        dedupe_key,
        material_hash,
        channel,
        event_type,
        access_json,
        event_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.dedupeKey ?? null,
      input.materialHash,
      input.event.channel,
      input.event.type,
      input.accessJson,
      '{}',
      input.timestamp,
    )

    const sequence = sqliteIntegerToNumber(insert.lastInsertRowid, 'inserted realtime event sequence')
    const sequencedEvent = parseSequencedRealtimeEvent({
      ...input.event,
      sequence,
      timestamp: input.timestamp,
    })
    database.connection.prepare(`
      UPDATE realtime_events
      SET event_json = ?
      WHERE sequence = ?
    `).run(stringifyCanonicalRealtimeJson(sequencedEvent, 'realtime event'), sequence)
    updateLatestSequence(sequence)

    const stored = findBySequence(sequence)
    if (!stored) throw new Error(`realtime event ${sequence} was not readable after insert`)
    return stored.record
  }

  const readMinimumRetainedSequence = (): number | null => {
    const row = database.connection.prepare(`
      SELECT MIN(sequence) AS sequence
      FROM realtime_events
    `).get() as { readonly sequence: unknown } | undefined
    if (!row || row.sequence === null || row.sequence === undefined) return null
    return sqliteIntegerToNumber(row.sequence, 'minimum retained realtime event sequence')
  }

  const readInSnapshot = <T>(work: () => T): T => {
    if (database.connection.isTransaction) return work()
    database.connection.exec('BEGIN')
    try {
      const result = work()
      database.connection.exec('COMMIT')
      return result
    } catch (error) {
      database.connection.exec('ROLLBACK')
      throw error
    }
  }

  const countRowsThroughSequence = (sequence: number): number => {
    if (sequence <= 0) return 0
    const row = database.connection.prepare(`
      SELECT COUNT(*) AS row_count
      FROM realtime_events
      WHERE sequence <= ?
    `).get(sequence) as { readonly row_count: unknown } | undefined
    return sqliteIntegerToNumber(row?.row_count ?? 0, 'retained realtime event delete count')
  }

  const readRetentionAggregate = (): {
    readonly rowCount: number
    readonly oldestTimestamp: number | null
    readonly newestTimestamp: number | null
  } => {
    const row = database.connection.prepare(`
      SELECT
        COUNT(*) AS row_count,
        MIN(created_at) AS oldest_timestamp,
        MAX(created_at) AS newest_timestamp
      FROM realtime_events
    `).get() as RealtimeEventRetentionAggregateRow | undefined
    return {
      rowCount: sqliteIntegerToNumber(row?.row_count ?? 0, 'retained realtime event row count'),
      oldestTimestamp: nullableSqliteIntegerToNumber(row?.oldest_timestamp, 'oldest retained realtime event timestamp'),
      newestTimestamp: nullableSqliteIntegerToNumber(row?.newest_timestamp, 'newest retained realtime event timestamp'),
    }
  }

  const readYoungestContiguousExpiredSequence = (ageCutoffTimestamp: number, latestSequence: number): number => {
    const expiredRow = database.connection.prepare(`
      SELECT sequence
      FROM realtime_events
      WHERE created_at < ?
      ORDER BY sequence ASC
      LIMIT 1
    `).get(ageCutoffTimestamp) as RealtimeEventSequenceRow | undefined
    if (!expiredRow) return 0

    const firstRetainedByAge = database.connection.prepare(`
      SELECT sequence
      FROM realtime_events
      WHERE created_at >= ?
      ORDER BY sequence ASC
      LIMIT 1
    `).get(ageCutoffTimestamp) as RealtimeEventSequenceRow | undefined
    if (!firstRetainedByAge) return latestSequence

    const firstYoungSequence = sqliteIntegerToNumber(
      firstRetainedByAge.sequence,
      'first retained realtime event sequence by age',
    )
    return Math.max(0, firstYoungSequence - 1)
  }

  const readRowCountCutoffSequence = (rowCount: number, maxRows: number): number => {
    if (rowCount <= maxRows) return 0
    const row = database.connection.prepare(`
      SELECT sequence
      FROM realtime_events
      ORDER BY sequence DESC
      LIMIT 1 OFFSET ?
    `).get(maxRows) as RealtimeEventSequenceRow | undefined
    if (!row) throw new Error('realtime event row-count cutoff could not be computed')
    return sqliteIntegerToNumber(row.sequence, 'row-count realtime event retention cutoff sequence')
  }

  const cutoffReason = (input: {
    readonly policy: RealtimeEventRetentionPolicy
    readonly cutoffSequence: number
    readonly ageCutoffSequence: number
    readonly rowCountCutoffSequence: number
  }): RealtimeEventRetentionCutoffReason => {
    if (!input.policy.enabled) return 'disabled'
    if (input.cutoffSequence <= 0) return 'none'
    const ageSelected = input.ageCutoffSequence === input.cutoffSequence
    const countSelected = input.rowCountCutoffSequence === input.cutoffSequence
    if (ageSelected && countSelected) return 'age-and-row-count'
    return ageSelected ? 'age' : 'row-count'
  }

  const planRetention = (input: PlanRealtimeEventRetentionInput): RealtimeEventRetentionPlan => readInSnapshot(() => {
    const policy = parseRetentionPolicy(input.policy)
    const now = parseRetentionNow(input.now ?? clock())
    const cursorState = readCursorState()
    const aggregate = readRetentionAggregate()
    const ageCutoffTimestamp = now - (policy.retentionDays * REALTIME_EVENT_RETENTION_DAY_MS)
    const ageCutoffSequence = policy.enabled
      ? readYoungestContiguousExpiredSequence(ageCutoffTimestamp, cursorState.latestSequence)
      : 0
    const rowCountCutoffSequence = policy.enabled
      ? readRowCountCutoffSequence(aggregate.rowCount, policy.maxRows)
      : 0
    const cutoffSequence = policy.enabled ? Math.max(ageCutoffSequence, rowCountCutoffSequence) : 0
    const eligibleByAge = countRowsThroughSequence(ageCutoffSequence)
    const eligibleByCount = Math.max(aggregate.rowCount - policy.maxRows, 0)
    const estimatedDeleteCount = countRowsThroughSequence(cutoffSequence)

    return {
      policy,
      now,
      ageCutoffTimestamp,
      rowCount: aggregate.rowCount,
      cursorState,
      oldestTimestamp: aggregate.oldestTimestamp,
      newestTimestamp: aggregate.newestTimestamp,
      ageCutoffSequence,
      rowCountCutoffSequence,
      cutoffSequence,
      eligibleByAge,
      eligibleByCount,
      estimatedDeleteCount,
      cutoffReason: cutoffReason({ policy, cutoffSequence, ageCutoffSequence, rowCountCutoffSequence }),
    }
  })

  const appendMany = (inputs: readonly AppendRealtimeEventInput[]): readonly PersistedRealtimeEvent[] => {
    if (inputs.length === 0) return []
    const defaultTimestamp = inputs.some((input) => input.timestamp === undefined)
      ? parseRealtimeEventTimestamp(clock(), 'realtime event timestamp')
      : undefined
    const normalized = inputs.map((input) => normalizeAppendInput(input, defaultTimestamp))
    return database.withTransaction(() => normalized.map(appendNormalized))
  }

  const append = (input: AppendRealtimeEventInput): PersistedRealtimeEvent => {
    const events = appendMany([input])
    const event = events[0]
    if (!event) throw new Error('realtime event append returned no event')
    return event
  }

  const pruneThroughSequence = (sequence: number): RealtimeEventPruneResult => {
    const requestedSequence = parseRealtimeEventCursorValue(sequence, 'prune sequence')
    return database.withTransaction(() => {
      const previousCursorState = readCursorState()
      const deleted = database.connection.prepare(`
        DELETE FROM realtime_events
        WHERE sequence <= ?
      `).run(requestedSequence)
      const retainedEarliest = readMinimumRetainedSequence()
      const earliestAvailableSequence = retainedEarliest ?? previousCursorState.latestSequence + 1
      database.connection.prepare(`
        UPDATE realtime_event_log_state
        SET earliest_available_sequence = ?
        WHERE singleton = 1
      `).run(earliestAvailableSequence)
      const currentCursorState = readCursorState()
      return {
        deletedCount: sqliteIntegerToNumber(deleted.changes, 'deleted realtime event count'),
        previousCursorState,
        currentCursorState,
      }
    })
  }

  const pruneRetention = (input: PlanRealtimeEventRetentionInput): RealtimeEventRetentionPruneResult => (
    database.withTransaction(() => {
      const plan = planRetention(input)
      const pruneResult = pruneThroughSequence(plan.cutoffSequence)
      return {
        ...plan,
        deletedCount: pruneResult.deletedCount,
        deletedThroughSequence: plan.cutoffSequence,
        previousCursorState: pruneResult.previousCursorState,
        currentCursorState: pruneResult.currentCursorState,
      }
    })
  )

  return {
    database,
    append,

    appendMany,

    getBySequence: (sequence: number): PersistedRealtimeEvent | null => findBySequence(sequence)?.record ?? null,

    getByDedupeKey: (dedupeKey: string): PersistedRealtimeEvent | null => findByDedupeKey(dedupeKey)?.record ?? null,

    cursorState: (): RealtimeEventCursorState => readCursorState(),

    readAfter: (input: ReadRealtimeEventsAfterInput): ReadRealtimeEventsAfterResult => readInSnapshot(() => {
      const afterSequence = parseRealtimeEventCursorValue(input.afterSequence, 'afterSequence')
      const limit = parseRealtimeEventReadLimit(input.limit)
      const state = readCursorState()

      if (afterSequence < state.earliestAvailableSequence - 1) {
        return {
          status: 'gap',
          requestedAfterSequence: afterSequence,
          earliestAvailableSequence: state.earliestAvailableSequence,
          latestSequence: state.latestSequence,
          events: [],
          hasMore: false,
        }
      }

      if (afterSequence > state.latestSequence) {
        return {
          status: 'ahead',
          requestedAfterSequence: afterSequence,
          earliestAvailableSequence: state.earliestAvailableSequence,
          latestSequence: state.latestSequence,
          events: [],
          hasMore: false,
        }
      }

      const rows = database.connection.prepare(`
        SELECT ${REALTIME_EVENT_COLUMNS}
        FROM realtime_events
        WHERE sequence > ?
        ORDER BY sequence ASC
        LIMIT ?
      `).all(afterSequence, limit + 1) as unknown as RealtimeEventRow[]
      const records = rows.map(rowToStoredRealtimeEvent).map((stored) => stored.record)
      return {
        status: 'ok',
        requestedAfterSequence: afterSequence,
        earliestAvailableSequence: state.earliestAvailableSequence,
        latestSequence: state.latestSequence,
        events: records.slice(0, limit),
        hasMore: records.length > limit,
      }
    }),

    inspectRetention: (input: PlanRealtimeEventRetentionInput): RealtimeEventRetentionPlan => planRetention(input),

    planRetention: (input: PlanRealtimeEventRetentionInput): RealtimeEventRetentionPlan => planRetention(input),

    pruneThrough: (sequence: number): RealtimeEventPruneResult => pruneThroughSequence(sequence),

    pruneRetention,
  }
}

const defaultRealtimeEventRepository = (): RealtimeEventRepository =>
  createSqliteRealtimeEventRepository({ database: getRotomDatabase() })

export const sqliteRealtimeEventRepository: RealtimeEventRepository = {
  append: (input) => defaultRealtimeEventRepository().append(input),
  appendMany: (inputs) => defaultRealtimeEventRepository().appendMany(inputs),
  getBySequence: (sequence) => defaultRealtimeEventRepository().getBySequence(sequence),
  getByDedupeKey: (dedupeKey) => defaultRealtimeEventRepository().getByDedupeKey(dedupeKey),
  cursorState: () => defaultRealtimeEventRepository().cursorState(),
  readAfter: (input) => defaultRealtimeEventRepository().readAfter(input),
  inspectRetention: (input) => defaultRealtimeEventRepository().inspectRetention(input),
  planRetention: (input) => defaultRealtimeEventRepository().planRetention(input),
  pruneThrough: (sequence) => defaultRealtimeEventRepository().pruneThrough(sequence),
  pruneRetention: (input) => defaultRealtimeEventRepository().pruneRetention(input),
}
