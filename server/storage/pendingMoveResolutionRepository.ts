import {
  PENDING_MOVE_RESOLUTION_LIMITS,
  PENDING_MOVE_RESOLUTION_STATUSES,
  PENDING_MOVE_RESOLUTION_TERMINAL_STATUSES,
  parsePendingMoveResolution,
  type PendingMoveResolution,
  type PendingMoveResolutionStatus,
} from '#shared/moveAutomation/pendingResolution'
import {
  parseLivePlayMapSlug,
  parseLivePlayOpId,
  type LivePlayOpId,
} from '#shared/livePlayCommands'
import { nextRevision } from '#shared/sessionRevisions'
import { stableJsonStringify } from '../domain/moveAutomation/stableJson'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  parseStoredDocumentJson,
  parseStoredRevision,
  parseStoredTimestamp,
} from './documentJson'

export const PENDING_MOVE_RESOLUTION_STORE_SCHEMA_VERSION = 1 as const

export interface StoredPendingMoveResolution {
  readonly schemaVersion: typeof PENDING_MOVE_RESOLUTION_STORE_SCHEMA_VERSION
  readonly resolutionId: string
  readonly originMapSlug: string
  readonly originOpId: LivePlayOpId
  readonly status: PendingMoveResolutionStatus
  readonly resolution: PendingMoveResolution
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly terminalOpId: LivePlayOpId | null
}

export interface CreatePendingMoveResolutionInput {
  readonly resolution: PendingMoveResolution
  readonly terminalOpId?: string | null
}

export interface UpdatePendingMoveResolutionInput {
  readonly resolution: PendingMoveResolution
  readonly expectedRevision: number
  /** Omit to preserve the current link. A durable terminal link cannot be replaced or cleared. */
  readonly terminalOpId?: string | null
}

export interface PendingMoveResolutionRepository {
  readonly database?: RotomDatabase
  getById(resolutionId: string): StoredPendingMoveResolution | null
  getByOrigin(mapSlug: string, originOpId: string): StoredPendingMoveResolution | null
  getByTerminalOpId(terminalOpId: string): StoredPendingMoveResolution | null
  listByMap(mapSlug: string): readonly StoredPendingMoveResolution[]
  create(input: CreatePendingMoveResolutionInput): StoredPendingMoveResolution
  update(input: UpdatePendingMoveResolutionInput): StoredPendingMoveResolution
}

export interface PendingMoveResolutionIdentityConflictInput {
  readonly resolutionId: string
  readonly originMapSlug: string
  readonly originOpId: string
}

export class PendingMoveResolutionIdentityConflictError extends Error {
  readonly resolutionId: string
  readonly originMapSlug: string
  readonly originOpId: string

  constructor(input: PendingMoveResolutionIdentityConflictInput) {
    super(
      `Pending move resolution identity ${input.resolutionId} / ${input.originMapSlug}:${input.originOpId} is already assigned to different durable state`,
    )
    this.name = 'PendingMoveResolutionIdentityConflictError'
    this.resolutionId = input.resolutionId
    this.originMapSlug = input.originMapSlug
    this.originOpId = input.originOpId
  }
}

export interface PendingMoveResolutionRevisionConflictInput {
  readonly resolutionId: string
  readonly expectedRevision: number
  readonly currentRevision: number | null
}

export class PendingMoveResolutionRevisionConflictError extends Error {
  readonly resolutionId: string
  readonly expectedRevision: number
  readonly currentRevision: number | null

  constructor(input: PendingMoveResolutionRevisionConflictInput) {
    super(
      `Pending move resolution ${input.resolutionId} revision ${input.expectedRevision} is stale; current revision is ${input.currentRevision ?? 'missing'}`,
    )
    this.name = 'PendingMoveResolutionRevisionConflictError'
    this.resolutionId = input.resolutionId
    this.expectedRevision = input.expectedRevision
    this.currentRevision = input.currentRevision
  }
}

export class PendingMoveResolutionTerminalOperationConflictError extends Error {
  readonly resolutionId: string
  readonly terminalOpId: string | null

  constructor(resolutionId: string, terminalOpId: string | null, detail: string) {
    super(`Pending move resolution ${resolutionId} terminal operation link is invalid: ${detail}`)
    this.name = 'PendingMoveResolutionTerminalOperationConflictError'
    this.resolutionId = resolutionId
    this.terminalOpId = terminalOpId
  }
}

interface PendingMoveResolutionRow {
  readonly resolution_id: unknown
  readonly map_slug: unknown
  readonly origin_op_id: unknown
  readonly resolution_json: unknown
  readonly status: unknown
  readonly revision: unknown
  readonly created_at: unknown
  readonly updated_at: unknown
  readonly terminal_op_id: unknown
  readonly terminal_map_slug: unknown
}

interface LivePlayOperationIdentityRow {
  readonly op_id: unknown
  readonly map_slug: unknown
}

const PENDING_MOVE_RESOLUTION_COLUMNS = `
  pending.resolution_id,
  pending.map_slug,
  pending.origin_op_id,
  pending.resolution_json,
  pending.status,
  pending.revision,
  pending.created_at,
  pending.updated_at,
  pending.terminal_op_id,
  terminal.map_slug AS terminal_map_slug
`

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const STATUS_SET = new Set<string>(PENDING_MOVE_RESOLUTION_STATUSES)
const TERMINAL_STATUS_SET = new Set<string>(PENDING_MOVE_RESOLUTION_TERMINAL_STATUSES)

const parseResolutionId = (value: unknown, label = 'pending move resolution ID'): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > PENDING_MOVE_RESOLUTION_LIMITS.identifierChars
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new Error(
      `${label} must be a non-empty, trimmed identifier of at most ${PENDING_MOVE_RESOLUTION_LIMITS.identifierChars} characters`,
    )
  }
  return value
}

const parseStoredStatus = (value: unknown): PendingMoveResolutionStatus => {
  if (typeof value !== 'string' || !STATUS_SET.has(value)) {
    throw new Error(
      `pending_move_resolutions.status must be one of ${PENDING_MOVE_RESOLUTION_STATUSES.join(', ')}`,
    )
  }
  return value as PendingMoveResolutionStatus
}

const parseNullableTerminalOpId = (value: unknown, label: string): LivePlayOpId | null => {
  if (value === null || value === undefined) return null
  return parseLivePlayOpId(value, label)
}

const serializeResolution = (resolution: PendingMoveResolution): string => stableJsonStringify(
  resolution,
  {
    path: 'pendingResolution',
    limits: {
      maxDepth: PENDING_MOVE_RESOLUTION_LIMITS.jsonDepth,
      maxNodes: PENDING_MOVE_RESOLUTION_LIMITS.jsonNodes,
      maxObjectFields: PENDING_MOVE_RESOLUTION_LIMITS.jsonObjectFields,
      maxArrayEntries: PENDING_MOVE_RESOLUTION_LIMITS.jsonArrayEntries,
      maxStringLength: PENDING_MOVE_RESOLUTION_LIMITS.jsonStringChars,
    },
  },
)

const parseResolutionJson = (value: unknown, resolutionId: string): {
  readonly resolution: PendingMoveResolution
  readonly canonicalJson: string
} => {
  if (typeof value !== 'string') {
    throw new Error('pending_move_resolutions.resolution_json must be a string')
  }
  const resolution = parsePendingMoveResolution(
    parseStoredDocumentJson<unknown>(value, `pending move resolution ${resolutionId}`),
    `pendingMoveResolution(${resolutionId})`,
  )
  const canonicalJson = serializeResolution(resolution)
  if (value !== canonicalJson) {
    throw new Error(`pending move resolution ${resolutionId} resolution_json must use canonical JSON`)
  }
  return { resolution, canonicalJson }
}

const rowToStoredResolution = (
  row: PendingMoveResolutionRow,
): StoredPendingMoveResolution => {
  const resolutionId = parseResolutionId(
    row.resolution_id,
    'pending_move_resolutions.resolution_id',
  )
  const originMapSlug = parseLivePlayMapSlug(
    row.map_slug,
    'pending_move_resolutions.map_slug',
  )
  const originOpId = parseLivePlayOpId(
    row.origin_op_id,
    'pending_move_resolutions.origin_op_id',
  )
  const status = parseStoredStatus(row.status)
  const revision = parseStoredRevision(
    row.revision,
    `pending move resolution ${resolutionId} revision`,
  )
  const createdAt = parseStoredTimestamp(
    row.created_at,
    `pending move resolution ${resolutionId} created_at`,
  )
  const updatedAt = parseStoredTimestamp(
    row.updated_at,
    `pending move resolution ${resolutionId} updated_at`,
  )
  if (updatedAt < createdAt) {
    throw new Error(`pending move resolution ${resolutionId} updated_at cannot precede created_at`)
  }

  const terminalOpId = parseNullableTerminalOpId(
    row.terminal_op_id,
    'pending_move_resolutions.terminal_op_id',
  )
  if (terminalOpId === null) {
    if (row.terminal_map_slug !== null && row.terminal_map_slug !== undefined) {
      throw new Error(`pending move resolution ${resolutionId} has terminal map data without a terminal operation`)
    }
  }
  else {
    if (row.terminal_map_slug === null || row.terminal_map_slug === undefined) {
      throw new Error(`pending move resolution ${resolutionId} references a missing terminal operation`)
    }
    const terminalMapSlug = parseLivePlayMapSlug(
      row.terminal_map_slug,
      `pending move resolution ${resolutionId} terminal map slug`,
    )
    if (terminalMapSlug !== originMapSlug) {
      throw new Error(`pending move resolution ${resolutionId} terminal operation belongs to another map`)
    }
    if (!TERMINAL_STATUS_SET.has(status)) {
      throw new Error(`pending move resolution ${resolutionId} cannot link a terminal operation while ${status}`)
    }
  }

  const { resolution } = parseResolutionJson(row.resolution_json, resolutionId)
  if (
    resolution.resolutionId !== resolutionId
    || resolution.originMapSlug !== originMapSlug
    || resolution.originOpId !== originOpId
    || resolution.status !== status
    || resolution.createdAt !== createdAt
    || resolution.updatedAt !== updatedAt
  ) {
    throw new Error(
      `pending move resolution ${resolutionId} JSON identity, status, and timestamps must match its indexed columns`,
    )
  }

  return {
    schemaVersion: PENDING_MOVE_RESOLUTION_STORE_SCHEMA_VERSION,
    resolutionId,
    originMapSlug,
    originOpId,
    status,
    resolution,
    revision,
    createdAt,
    updatedAt,
    terminalOpId,
  }
}

const normalizeResolution = (value: PendingMoveResolution): PendingMoveResolution => (
  parsePendingMoveResolution(value)
)

const identityConflict = (
  resolution: PendingMoveResolution,
): PendingMoveResolutionIdentityConflictError => new PendingMoveResolutionIdentityConflictError({
  resolutionId: resolution.resolutionId,
  originMapSlug: resolution.originMapSlug,
  originOpId: resolution.originOpId,
})

export const createSqlitePendingMoveResolutionRepository = (
  database: RotomDatabase = getRotomDatabase(),
): PendingMoveResolutionRepository => {
  const rowsByClause = (
    clause: string,
    ...parameters: readonly (string | number | null)[]
  ): PendingMoveResolutionRow[] => (
    database.connection.prepare(`
      SELECT ${PENDING_MOVE_RESOLUTION_COLUMNS}
      FROM pending_move_resolutions AS pending
      LEFT JOIN live_play_ops AS terminal
        ON terminal.op_id = pending.terminal_op_id
      ${clause}
    `).all(...parameters) as unknown as PendingMoveResolutionRow[]
  )

  const firstByClause = (
    clause: string,
    ...parameters: readonly (string | number | null)[]
  ): StoredPendingMoveResolution | null => {
    const row = rowsByClause(clause, ...parameters)[0]
    return row ? rowToStoredResolution(row) : null
  }

  const getById = (resolutionIdInput: string): StoredPendingMoveResolution | null => {
    const resolutionId = parseResolutionId(resolutionIdInput)
    return firstByClause('WHERE pending.resolution_id = ?', resolutionId)
  }

  const getByOrigin = (
    mapSlugInput: string,
    originOpIdInput: string,
  ): StoredPendingMoveResolution | null => {
    const mapSlug = parseLivePlayMapSlug(mapSlugInput, 'pending move resolution map slug')
    const originOpId = parseLivePlayOpId(originOpIdInput, 'pending move resolution origin opId')
    return firstByClause(
      'WHERE pending.map_slug = ? AND pending.origin_op_id = ?',
      mapSlug,
      originOpId,
    )
  }

  const getByTerminalOpId = (
    terminalOpIdInput: string,
  ): StoredPendingMoveResolution | null => {
    const terminalOpId = parseLivePlayOpId(
      terminalOpIdInput,
      'pending move resolution terminal opId',
    )
    return firstByClause('WHERE pending.terminal_op_id = ?', terminalOpId)
  }

  const listByMap = (mapSlugInput: string): readonly StoredPendingMoveResolution[] => {
    const mapSlug = parseLivePlayMapSlug(mapSlugInput, 'pending move resolution map slug')
    return rowsByClause(
      `WHERE pending.map_slug = ?
       ORDER BY pending.updated_at ASC, pending.resolution_id ASC`,
      mapSlug,
    ).map(rowToStoredResolution)
  }

  const findLivePlayOperation = (opId: string): {
    readonly opId: LivePlayOpId
    readonly mapSlug: string
  } | null => {
    const parsedOpId = parseLivePlayOpId(opId, 'pending move resolution terminal opId')
    const row = database.connection.prepare(`
      SELECT op_id, map_slug
      FROM live_play_ops
      WHERE op_id = ?
    `).get(parsedOpId) as LivePlayOperationIdentityRow | undefined
    if (!row) return null
    return {
      opId: parseLivePlayOpId(row.op_id, 'live_play_ops.op_id'),
      mapSlug: parseLivePlayMapSlug(row.map_slug, 'live_play_ops.map_slug'),
    }
  }

  const assertTerminalLink = (
    resolution: PendingMoveResolution,
    terminalOpId: LivePlayOpId | null,
  ): void => {
    if (terminalOpId === null) return
    if (!TERMINAL_STATUS_SET.has(resolution.status)) {
      throw new PendingMoveResolutionTerminalOperationConflictError(
        resolution.resolutionId,
        terminalOpId,
        `status ${resolution.status} is not terminal`,
      )
    }
    const terminal = findLivePlayOperation(terminalOpId)
    if (!terminal) {
      throw new PendingMoveResolutionTerminalOperationConflictError(
        resolution.resolutionId,
        terminalOpId,
        'the linked live_play_ops row does not exist',
      )
    }
    if (terminal.mapSlug !== resolution.originMapSlug) {
      throw new PendingMoveResolutionTerminalOperationConflictError(
        resolution.resolutionId,
        terminalOpId,
        `the linked operation belongs to map ${terminal.mapSlug}`,
      )
    }
    const linkedResolution = getByTerminalOpId(terminalOpId)
    if (linkedResolution && linkedResolution.resolutionId !== resolution.resolutionId) {
      throw new PendingMoveResolutionTerminalOperationConflictError(
        resolution.resolutionId,
        terminalOpId,
        `the linked operation already terminates resolution ${linkedResolution.resolutionId}`,
      )
    }
  }

  const assertOriginDoesNotMasqueradeAsTerminal = (
    resolution: PendingMoveResolution,
    terminalOpId: LivePlayOpId | null,
  ): void => {
    const terminalAtOrigin = findLivePlayOperation(resolution.originOpId)
    if (!terminalAtOrigin) return
    if (
      terminalAtOrigin.mapSlug === resolution.originMapSlug
      && terminalOpId === resolution.originOpId
      && TERMINAL_STATUS_SET.has(resolution.status)
    ) return
    throw new PendingMoveResolutionTerminalOperationConflictError(
      resolution.resolutionId,
      terminalOpId,
      `origin ${resolution.originMapSlug}:${resolution.originOpId} is already a terminal live-play operation`,
    )
  }

  const create = (
    input: CreatePendingMoveResolutionInput,
  ): StoredPendingMoveResolution => database.withTransaction(() => {
    const resolution = normalizeResolution(input.resolution)
    const terminalOpId = parseNullableTerminalOpId(
      input.terminalOpId,
      'pending move resolution terminalOpId',
    )
    const canonicalJson = serializeResolution(resolution)
    const existingById = getById(resolution.resolutionId)
    const existingByOrigin = getByOrigin(resolution.originMapSlug, resolution.originOpId)
    const existing = existingById ?? existingByOrigin

    if (existing) {
      if (
        existingById?.resolutionId === existingByOrigin?.resolutionId
        && serializeResolution(existing.resolution) === canonicalJson
        && existing.terminalOpId === terminalOpId
      ) {
        assertTerminalLink(resolution, terminalOpId)
        assertOriginDoesNotMasqueradeAsTerminal(resolution, terminalOpId)
        return existing
      }
      throw identityConflict(resolution)
    }

    assertTerminalLink(resolution, terminalOpId)
    assertOriginDoesNotMasqueradeAsTerminal(resolution, terminalOpId)

    database.connection.prepare(`
      INSERT INTO pending_move_resolutions (
        resolution_id,
        map_slug,
        origin_op_id,
        resolution_json,
        status,
        revision,
        created_at,
        updated_at,
        terminal_op_id
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(
      resolution.resolutionId,
      resolution.originMapSlug,
      resolution.originOpId,
      canonicalJson,
      resolution.status,
      resolution.createdAt,
      resolution.updatedAt,
      terminalOpId,
    )

    const stored = getById(resolution.resolutionId)
    if (!stored) {
      throw new Error(`Pending move resolution ${resolution.resolutionId} was not readable after insert`)
    }
    return stored
  })

  const update = (
    input: UpdatePendingMoveResolutionInput,
  ): StoredPendingMoveResolution => database.withTransaction(() => {
    const resolution = normalizeResolution(input.resolution)
    const expectedRevision = parseStoredRevision(
      input.expectedRevision,
      'pending move resolution expectedRevision',
    )
    const existing = getById(resolution.resolutionId)
    if (!existing || existing.revision !== expectedRevision) {
      throw new PendingMoveResolutionRevisionConflictError({
        resolutionId: resolution.resolutionId,
        expectedRevision,
        currentRevision: existing?.revision ?? null,
      })
    }
    if (
      resolution.originMapSlug !== existing.originMapSlug
      || resolution.originOpId !== existing.originOpId
      || resolution.createdAt !== existing.createdAt
    ) {
      throw identityConflict(resolution)
    }
    const originRecord = getByOrigin(resolution.originMapSlug, resolution.originOpId)
    if (originRecord?.resolutionId !== resolution.resolutionId) {
      throw identityConflict(resolution)
    }
    if (resolution.updatedAt < existing.updatedAt) {
      throw new Error(
        `Pending move resolution ${resolution.resolutionId} updatedAt cannot move backwards`,
      )
    }

    const requestedTerminalOpId = input.terminalOpId === undefined
      ? existing.terminalOpId
      : parseNullableTerminalOpId(
          input.terminalOpId,
          'pending move resolution terminalOpId',
        )
    if (
      existing.terminalOpId !== null
      && requestedTerminalOpId !== existing.terminalOpId
    ) {
      throw new PendingMoveResolutionTerminalOperationConflictError(
        resolution.resolutionId,
        requestedTerminalOpId,
        `existing link ${existing.terminalOpId} cannot be replaced or cleared`,
      )
    }

    assertTerminalLink(resolution, requestedTerminalOpId)
    assertOriginDoesNotMasqueradeAsTerminal(resolution, requestedTerminalOpId)

    const next = nextRevision(expectedRevision)
    const result = database.connection.prepare(`
      UPDATE pending_move_resolutions
      SET resolution_json = ?,
          status = ?,
          revision = ?,
          updated_at = ?,
          terminal_op_id = ?
      WHERE resolution_id = ? AND revision = ?
    `).run(
      serializeResolution(resolution),
      resolution.status,
      next,
      resolution.updatedAt,
      requestedTerminalOpId,
      resolution.resolutionId,
      expectedRevision,
    )
    if (Number(result.changes) !== 1) {
      const current = getById(resolution.resolutionId)
      throw new PendingMoveResolutionRevisionConflictError({
        resolutionId: resolution.resolutionId,
        expectedRevision,
        currentRevision: current?.revision ?? null,
      })
    }

    const stored = getById(resolution.resolutionId)
    if (!stored) {
      throw new Error(`Pending move resolution ${resolution.resolutionId} was not readable after update`)
    }
    return stored
  })

  return {
    database,
    getById,
    getByOrigin,
    getByTerminalOpId,
    listByMap,
    create,
    update,
  }
}

const defaultPendingMoveResolutionRepository = (): PendingMoveResolutionRepository => (
  createSqlitePendingMoveResolutionRepository(getRotomDatabase())
)

export const sqlitePendingMoveResolutionRepository: PendingMoveResolutionRepository = {
  getById: (resolutionId) => defaultPendingMoveResolutionRepository().getById(resolutionId),
  getByOrigin: (mapSlug, originOpId) => (
    defaultPendingMoveResolutionRepository().getByOrigin(mapSlug, originOpId)
  ),
  getByTerminalOpId: (terminalOpId) => (
    defaultPendingMoveResolutionRepository().getByTerminalOpId(terminalOpId)
  ),
  listByMap: (mapSlug) => defaultPendingMoveResolutionRepository().listByMap(mapSlug),
  create: (input) => defaultPendingMoveResolutionRepository().create(input),
  update: (input) => defaultPendingMoveResolutionRepository().update(input),
}
