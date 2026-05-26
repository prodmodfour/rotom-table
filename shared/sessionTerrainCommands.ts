import type { SessionCommandValidationIssue } from './sessionCommandResults'
import {
  type SessionCommandEnvelope,
  type SessionCommandScope,
} from './sessionCommands'
import {
  isRecord,
  validateSessionCommandEnvelope,
} from './sessionCommandValidation'
import {
  canUseGmAuthority,
  type PermissionDenied,
  type PermissionResult,
  type SessionActor,
} from './sessionPermissions'
import type { SessionRevision } from './sessionRevisions'

export const BUILD_TERRAIN_VOXEL_COMMAND_TYPE = 'buildTerrainVoxel' as const
export const REMOVE_TERRAIN_VOXEL_COMMAND_TYPE = 'removeTerrainVoxel' as const
export const TERRAIN_COMMAND_TYPES = [
  BUILD_TERRAIN_VOXEL_COMMAND_TYPE,
  REMOVE_TERRAIN_VOXEL_COMMAND_TYPE,
] as const

export type TerrainCommandType = (typeof TERRAIN_COMMAND_TYPES)[number]

export const TERRAIN_VOXEL_SCOPE_FIELD_PREFIX = 'voxel' as const
export const TERRAIN_VOXEL_SCOPE_FIELD_SEPARATOR = ':' as const

export interface SessionTerrainCell {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface SessionTerrainVoxel extends SessionTerrainCell {
  readonly materialId: string
  /** Optional `#rrggbb`-style colour override; the renderer still applies its normal fallback rules. */
  readonly color?: string
  /** Marks a voxel for optional ghost-opacity rendering. */
  readonly ghost?: boolean
  readonly blocksMovement?: boolean
  readonly blocksSight?: boolean
  readonly tags?: readonly string[]
}

export interface BuildTerrainVoxelCommandPayload {
  /** Optional map target. When omitted, the server uses the terrain scope map or selected session map. */
  readonly mapSlug?: string
  readonly voxel: SessionTerrainVoxel
}

export interface RemoveTerrainVoxelCommandPayload {
  /** Optional map target. When omitted, the server uses the terrain scope map or selected session map. */
  readonly mapSlug?: string
  readonly cell: SessionTerrainCell
}

export type BuildTerrainVoxelCommand<
  TActor extends SessionActor = SessionActor,
> = SessionCommandEnvelope<
  typeof BUILD_TERRAIN_VOXEL_COMMAND_TYPE,
  BuildTerrainVoxelCommandPayload,
  TActor,
  SessionRevision
>

export type RemoveTerrainVoxelCommand<
  TActor extends SessionActor = SessionActor,
> = SessionCommandEnvelope<
  typeof REMOVE_TERRAIN_VOXEL_COMMAND_TYPE,
  RemoveTerrainVoxelCommandPayload,
  TActor,
  SessionRevision
>

export type TerrainCommand<TActor extends SessionActor = SessionActor> =
  | BuildTerrainVoxelCommand<TActor>
  | RemoveTerrainVoxelCommand<TActor>

export type TerrainCommandPayload =
  | BuildTerrainVoxelCommandPayload
  | RemoveTerrainVoxelCommandPayload

export const TERRAIN_COMMAND_VALIDATION_CODES = [
  'invalid-command-type',
  'invalid-payload',
  'invalid-map-slug',
  'invalid-cell',
  'invalid-voxel',
  'invalid-material-id',
  'invalid-color',
  'invalid-ghost',
  'invalid-blocking-flag',
  'invalid-tags',
  'invalid-terrain-scope',
  'permission-denied',
] as const

export type TerrainCommandValidationCode =
  (typeof TERRAIN_COMMAND_VALIDATION_CODES)[number]

export interface TerrainCommandValidationContext {
  /** Terrain voxel editing is GM-only in Live session; this context is reserved for future table policy. */
  readonly assignments?: readonly unknown[]
}

export interface TerrainCommandValidationSuccess<
  TCommand extends TerrainCommand = TerrainCommand,
> {
  readonly valid: true
  readonly command: TCommand
  readonly payload: TCommand['payload']
  readonly mapSlug?: string
  readonly cell: SessionTerrainCell
  readonly permission: Extract<PermissionResult, { readonly allowed: true }>
  readonly issues: readonly []
}

export interface TerrainCommandValidationFailure {
  readonly valid: false
  readonly issues: readonly SessionCommandValidationIssue[]
  readonly permission?: PermissionDenied
}

export type TerrainCommandValidationResult<
  TCommand extends TerrainCommand = TerrainCommand,
> = TerrainCommandValidationSuccess<TCommand> | TerrainCommandValidationFailure

type MutableIssueList = SessionCommandValidationIssue[]
type UnknownRecord = Record<string, unknown>

const EXPECTED_OBJECT = 'object'
const EXPECTED_NON_EMPTY_STRING = 'non-empty string'
const EXPECTED_GRID_COORDINATE = 'safe non-negative integer grid coordinate'
const EXPECTED_BOOLEAN = 'boolean'
const EXPECTED_TAGS = 'array of non-empty strings'

const hasOwn = (record: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const describeReceived = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

const addIssue = (
  issues: MutableIssueList,
  path: string,
  code: TerrainCommandValidationCode,
  message: string,
  expected?: string,
  received?: unknown,
): void => {
  issues.push({
    path,
    code,
    message,
    ...(expected === undefined ? {} : { expected }),
    ...(received === undefined ? {} : { received: describeReceived(received) }),
  })
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const isGridCoordinate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export const isTerrainCommandType = (value: unknown): value is TerrainCommandType =>
  (TERRAIN_COMMAND_TYPES as readonly unknown[]).includes(value)

export const isTerrainCommandValidationCode = (
  value: unknown,
): value is TerrainCommandValidationCode =>
  (TERRAIN_COMMAND_VALIDATION_CODES as readonly unknown[]).includes(value)

export const formatTerrainVoxelScopeField = (cell: SessionTerrainCell): string =>
  `${TERRAIN_VOXEL_SCOPE_FIELD_PREFIX}${TERRAIN_VOXEL_SCOPE_FIELD_SEPARATOR}${cell.x},${cell.y},${cell.z}`

export const parseTerrainVoxelScopeField = (value: unknown): SessionTerrainCell | undefined => {
  if (typeof value !== 'string') return undefined
  const prefix = `${TERRAIN_VOXEL_SCOPE_FIELD_PREFIX}${TERRAIN_VOXEL_SCOPE_FIELD_SEPARATOR}`
  if (!value.startsWith(prefix)) return undefined
  const parts = value.slice(prefix.length).split(',')
  if (parts.length !== 3) return undefined
  const [x, y, z] = parts.map((part) => Number(part))
  if (!isGridCoordinate(x) || !isGridCoordinate(y) || !isGridCoordinate(z)) return undefined
  return { x, y, z }
}

export const terrainCellsEqual = (
  left: SessionTerrainCell,
  right: SessionTerrainCell,
): boolean => left.x === right.x && left.y === right.y && left.z === right.z

export const createTerrainVoxelCommandScope = (
  cell: SessionTerrainCell,
  mapSlug?: string,
): SessionCommandScope => ({
  lane: 'terrain',
  field: formatTerrainVoxelScopeField(cell),
  ...(mapSlug === undefined ? {} : { mapSlug }),
})

const cloneCell = (cell: SessionTerrainCell): SessionTerrainCell => ({
  x: cell.x,
  y: cell.y,
  z: cell.z,
})

const cloneVoxel = (voxel: SessionTerrainVoxel): SessionTerrainVoxel => ({
  x: voxel.x,
  y: voxel.y,
  z: voxel.z,
  materialId: voxel.materialId,
  ...(voxel.color === undefined ? {} : { color: voxel.color }),
  ...(voxel.ghost === undefined ? {} : { ghost: voxel.ghost }),
  ...(voxel.blocksMovement === undefined ? {} : { blocksMovement: voxel.blocksMovement }),
  ...(voxel.blocksSight === undefined ? {} : { blocksSight: voxel.blocksSight }),
  ...(voxel.tags === undefined ? {} : { tags: [...voxel.tags] }),
})

const cloneBuildPayload = (payload: BuildTerrainVoxelCommandPayload): BuildTerrainVoxelCommandPayload => ({
  ...(payload.mapSlug === undefined ? {} : { mapSlug: payload.mapSlug }),
  voxel: cloneVoxel(payload.voxel),
})

const cloneRemovePayload = (payload: RemoveTerrainVoxelCommandPayload): RemoveTerrainVoxelCommandPayload => ({
  ...(payload.mapSlug === undefined ? {} : { mapSlug: payload.mapSlug }),
  cell: cloneCell(payload.cell),
})

const collectPayloadMapSlugIssue = (
  payload: UnknownRecord,
  issues: MutableIssueList,
): string | undefined => {
  if (!hasOwn(payload, 'mapSlug')) return undefined
  if (!isNonEmptyString(payload.mapSlug)) {
    addIssue(
      issues,
      'payload.mapSlug',
      'invalid-map-slug',
      'terrain payload.mapSlug must be a non-empty string when provided.',
      EXPECTED_NON_EMPTY_STRING,
      payload.mapSlug,
    )
    return undefined
  }
  return payload.mapSlug.trim()
}

const collectTerrainCellIssues = (
  cell: unknown,
  path: string,
  issues: MutableIssueList,
): SessionTerrainCell | undefined => {
  if (!isRecord(cell)) {
    addIssue(
      issues,
      path,
      'invalid-cell',
      'terrain cell must be an object.',
      EXPECTED_OBJECT,
      cell,
    )
    return undefined
  }

  if (!isGridCoordinate(cell.x)) {
    addIssue(
      issues,
      `${path}.x`,
      'invalid-cell',
      'terrain cell x must be a safe non-negative integer.',
      EXPECTED_GRID_COORDINATE,
      cell.x,
    )
  }
  if (!isGridCoordinate(cell.y)) {
    addIssue(
      issues,
      `${path}.y`,
      'invalid-cell',
      'terrain cell y must be a safe non-negative integer.',
      EXPECTED_GRID_COORDINATE,
      cell.y,
    )
  }
  if (!isGridCoordinate(cell.z)) {
    addIssue(
      issues,
      `${path}.z`,
      'invalid-cell',
      'terrain cell z must be a safe non-negative integer.',
      EXPECTED_GRID_COORDINATE,
      cell.z,
    )
  }

  if (issues.some((issue) => issue.path.startsWith(path))) return undefined
  return { x: cell.x as number, y: cell.y as number, z: cell.z as number }
}

const collectTags = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): readonly string[] | undefined => {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    addIssue(
      issues,
      path,
      'invalid-tags',
      'terrain voxel tags must be an array of non-empty strings when provided.',
      EXPECTED_TAGS,
      value,
    )
    return undefined
  }

  const tags: string[] = []
  value.forEach((tag, index) => {
    if (!isNonEmptyString(tag)) {
      addIssue(
        issues,
        `${path}[${index}]`,
        'invalid-tags',
        'terrain voxel tags must be non-empty strings.',
        EXPECTED_NON_EMPTY_STRING,
        tag,
      )
      return
    }
    tags.push(tag.trim())
  })

  return tags
}

const collectBuildTerrainVoxelPayloadIssues = (
  payload: unknown,
  issues: MutableIssueList,
): BuildTerrainVoxelCommandPayload | undefined => {
  if (!isRecord(payload)) {
    addIssue(
      issues,
      'payload',
      'invalid-payload',
      'buildTerrainVoxel payload must be an object.',
      EXPECTED_OBJECT,
      payload,
    )
    return undefined
  }

  const mapSlug = collectPayloadMapSlugIssue(payload, issues)
  const voxel = payload.voxel
  if (!isRecord(voxel)) {
    addIssue(
      issues,
      'payload.voxel',
      'invalid-voxel',
      'buildTerrainVoxel payload.voxel must be an object.',
      EXPECTED_OBJECT,
      voxel,
    )
    return undefined
  }

  const cell = collectTerrainCellIssues(voxel, 'payload.voxel', issues)

  if (!isNonEmptyString(voxel.materialId)) {
    addIssue(
      issues,
      'payload.voxel.materialId',
      'invalid-material-id',
      'buildTerrainVoxel payload.voxel.materialId must be a non-empty string.',
      EXPECTED_NON_EMPTY_STRING,
      voxel.materialId,
    )
  }

  if (hasOwn(voxel, 'color') && voxel.color !== undefined && !isNonEmptyString(voxel.color)) {
    addIssue(
      issues,
      'payload.voxel.color',
      'invalid-color',
      'buildTerrainVoxel payload.voxel.color must be a non-empty string when provided.',
      EXPECTED_NON_EMPTY_STRING,
      voxel.color,
    )
  }

  if (hasOwn(voxel, 'ghost') && voxel.ghost !== undefined && typeof voxel.ghost !== 'boolean') {
    addIssue(
      issues,
      'payload.voxel.ghost',
      'invalid-ghost',
      'buildTerrainVoxel payload.voxel.ghost must be a boolean when provided.',
      EXPECTED_BOOLEAN,
      voxel.ghost,
    )
  }

  if (hasOwn(voxel, 'blocksMovement') && voxel.blocksMovement !== undefined && typeof voxel.blocksMovement !== 'boolean') {
    addIssue(
      issues,
      'payload.voxel.blocksMovement',
      'invalid-blocking-flag',
      'buildTerrainVoxel payload.voxel.blocksMovement must be a boolean when provided.',
      EXPECTED_BOOLEAN,
      voxel.blocksMovement,
    )
  }

  if (hasOwn(voxel, 'blocksSight') && voxel.blocksSight !== undefined && typeof voxel.blocksSight !== 'boolean') {
    addIssue(
      issues,
      'payload.voxel.blocksSight',
      'invalid-blocking-flag',
      'buildTerrainVoxel payload.voxel.blocksSight must be a boolean when provided.',
      EXPECTED_BOOLEAN,
      voxel.blocksSight,
    )
  }

  const tags = collectTags(voxel.tags, 'payload.voxel.tags', issues)

  if (issues.some((issue) => issue.path.startsWith('payload'))) return undefined

  const normalizedVoxel: SessionTerrainVoxel = {
    ...(cell as SessionTerrainCell),
    materialId: (voxel.materialId as string).trim(),
    ...(voxel.color === undefined ? {} : { color: (voxel.color as string).trim() }),
    ...(voxel.ghost === undefined ? {} : { ghost: voxel.ghost as boolean }),
    ...(voxel.blocksMovement === undefined ? {} : { blocksMovement: voxel.blocksMovement as boolean }),
    ...(voxel.blocksSight === undefined ? {} : { blocksSight: voxel.blocksSight as boolean }),
    ...(tags === undefined ? {} : { tags }),
  }

  return cloneBuildPayload({
    ...(mapSlug === undefined ? {} : { mapSlug }),
    voxel: normalizedVoxel,
  })
}

const collectRemoveTerrainVoxelPayloadIssues = (
  payload: unknown,
  issues: MutableIssueList,
): RemoveTerrainVoxelCommandPayload | undefined => {
  if (!isRecord(payload)) {
    addIssue(
      issues,
      'payload',
      'invalid-payload',
      'removeTerrainVoxel payload must be an object.',
      EXPECTED_OBJECT,
      payload,
    )
    return undefined
  }

  const mapSlug = collectPayloadMapSlugIssue(payload, issues)
  const cell = collectTerrainCellIssues(payload.cell, 'payload.cell', issues)

  if (issues.some((issue) => issue.path.startsWith('payload'))) return undefined

  return cloneRemovePayload({
    ...(mapSlug === undefined ? {} : { mapSlug }),
    cell: cell as SessionTerrainCell,
  })
}

const findTerrainScopeMapSlug = (
  command: Pick<TerrainCommand, 'scopes' | 'payload' | 'type'>,
  payload: TerrainCommandPayload | undefined,
  cell: SessionTerrainCell | undefined,
  issues: MutableIssueList,
): string | undefined => {
  const terrainScopes = command.scopes.filter((scope) => scope.lane === 'terrain')

  if (terrainScopes.length === 0) {
    addIssue(
      issues,
      'scopes',
      'invalid-terrain-scope',
      `${command.type} commands must include a terrain scope for the target voxel cell.`,
      'terrain voxel scope',
      command.scopes,
    )
    return payload?.mapSlug
  }

  const matchingCellScopes = cell === undefined
    ? []
    : terrainScopes.filter((scope) => {
        const scopedCell = parseTerrainVoxelScopeField(scope.field)
        return scopedCell !== undefined && terrainCellsEqual(scopedCell, cell)
      })

  if (cell !== undefined && matchingCellScopes.length === 0) {
    addIssue(
      issues,
      'scopes',
      'invalid-terrain-scope',
      `${command.type} commands must include a terrain scope field of ${formatTerrainVoxelScopeField(cell)} for the target cell.`,
      formatTerrainVoxelScopeField(cell),
      command.scopes,
    )
  }

  const invalidScope = terrainScopes.find((scope) => parseTerrainVoxelScopeField(scope.field) === undefined)
  if (invalidScope !== undefined) {
    addIssue(
      issues,
      'scopes',
      'invalid-terrain-scope',
      `${command.type} terrain scopes must use field "voxel:x,y,z" for the target cell.`,
      'voxel:x,y,z',
      invalidScope.field,
    )
  }

  const mapSlugs = new Set(
    terrainScopes
      .map((scope) => scope.mapSlug)
      .filter((mapSlug): mapSlug is string => mapSlug !== undefined),
  )
  if (mapSlugs.size > 1) {
    addIssue(
      issues,
      'scopes',
      'invalid-terrain-scope',
      `${command.type} terrain scopes must not target multiple maps.`,
      'same mapSlug or omitted mapSlug',
      command.scopes,
    )
  }

  const scopeMapSlug = [...mapSlugs][0]
  if (payload?.mapSlug !== undefined && scopeMapSlug !== undefined && payload.mapSlug !== scopeMapSlug) {
    addIssue(
      issues,
      'payload.mapSlug',
      'invalid-map-slug',
      `${command.type} payload.mapSlug must match the terrain scope mapSlug when both are provided.`,
      scopeMapSlug,
      payload.mapSlug,
    )
  }

  return payload?.mapSlug ?? scopeMapSlug
}

const createValidationFailure = (
  issues: readonly SessionCommandValidationIssue[],
  permission: PermissionResult,
): TerrainCommandValidationFailure => ({
  valid: false,
  issues,
  ...(permission.allowed ? {} : { permission }),
})

const validatePermission = (
  command: TerrainCommand,
  issues: MutableIssueList,
): PermissionResult => {
  const permission = canUseGmAuthority(command.actor)
  if (!permission.allowed) {
    addIssue(
      issues,
      'actor',
      'permission-denied',
      permission.message,
      'GM actor',
      command.actor,
    )
  }
  return permission
}

export const validateBuildTerrainVoxelCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  _context: TerrainCommandValidationContext = {},
): TerrainCommandValidationResult<BuildTerrainVoxelCommand<TActor>> => {
  const envelopeResult = validateSessionCommandEnvelope<BuildTerrainVoxelCommand<TActor>>(value)
  if (!envelopeResult.valid) return { valid: false, issues: envelopeResult.issues }

  const command = envelopeResult.command
  const issues: MutableIssueList = []

  if (command.type !== BUILD_TERRAIN_VOXEL_COMMAND_TYPE) {
    addIssue(
      issues,
      'type',
      'invalid-command-type',
      'buildTerrainVoxel validators only accept command envelopes with type "buildTerrainVoxel".',
      BUILD_TERRAIN_VOXEL_COMMAND_TYPE,
      command.type,
    )
  }

  const payload = collectBuildTerrainVoxelPayloadIssues(command.payload, issues)
  const cell = payload?.voxel
  const mapSlug = findTerrainScopeMapSlug(command, payload, cell, issues)
  const permission = validatePermission(command, issues)

  if (issues.length > 0) return createValidationFailure(issues, permission)

  return {
    valid: true,
    command,
    payload: payload as BuildTerrainVoxelCommandPayload,
    ...(mapSlug === undefined ? {} : { mapSlug }),
    cell: cloneCell(cell as SessionTerrainCell),
    permission: permission as Extract<PermissionResult, { readonly allowed: true }>,
    issues: [],
  }
}

export const validateRemoveTerrainVoxelCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  _context: TerrainCommandValidationContext = {},
): TerrainCommandValidationResult<RemoveTerrainVoxelCommand<TActor>> => {
  const envelopeResult = validateSessionCommandEnvelope<RemoveTerrainVoxelCommand<TActor>>(value)
  if (!envelopeResult.valid) return { valid: false, issues: envelopeResult.issues }

  const command = envelopeResult.command
  const issues: MutableIssueList = []

  if (command.type !== REMOVE_TERRAIN_VOXEL_COMMAND_TYPE) {
    addIssue(
      issues,
      'type',
      'invalid-command-type',
      'removeTerrainVoxel validators only accept command envelopes with type "removeTerrainVoxel".',
      REMOVE_TERRAIN_VOXEL_COMMAND_TYPE,
      command.type,
    )
  }

  const payload = collectRemoveTerrainVoxelPayloadIssues(command.payload, issues)
  const cell = payload?.cell
  const mapSlug = findTerrainScopeMapSlug(command, payload, cell, issues)
  const permission = validatePermission(command, issues)

  if (issues.length > 0) return createValidationFailure(issues, permission)

  return {
    valid: true,
    command,
    payload: payload as RemoveTerrainVoxelCommandPayload,
    ...(mapSlug === undefined ? {} : { mapSlug }),
    cell: cloneCell(cell as SessionTerrainCell),
    permission: permission as Extract<PermissionResult, { readonly allowed: true }>,
    issues: [],
  }
}

export const validateTerrainCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: TerrainCommandValidationContext = {},
): TerrainCommandValidationResult<TerrainCommand<TActor>> => {
  const envelopeResult = validateSessionCommandEnvelope<TerrainCommand<TActor>>(value)
  if (!envelopeResult.valid) return { valid: false, issues: envelopeResult.issues }

  if (envelopeResult.command.type === BUILD_TERRAIN_VOXEL_COMMAND_TYPE) {
    return validateBuildTerrainVoxelCommand<TActor>(value, context) as TerrainCommandValidationResult<TerrainCommand<TActor>>
  }
  if (envelopeResult.command.type === REMOVE_TERRAIN_VOXEL_COMMAND_TYPE) {
    return validateRemoveTerrainVoxelCommand<TActor>(value, context) as TerrainCommandValidationResult<TerrainCommand<TActor>>
  }

  return {
    valid: false,
    issues: [
      {
        path: 'type',
        code: 'invalid-command-type',
        message: 'terrain validators only accept buildTerrainVoxel or removeTerrainVoxel command envelopes.',
        expected: TERRAIN_COMMAND_TYPES.join(' | '),
        received: describeReceived(isRecord(value) ? value.type : undefined),
      },
    ],
  }
}

export const assertValidTerrainCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: TerrainCommandValidationContext = {},
  label = 'terrain command',
): TerrainCommand<TActor> => {
  const result = validateTerrainCommand<TActor>(value, context)
  if (result.valid) return result.command

  const summary = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  throw new Error(`${label} is invalid: ${summary}`)
}
