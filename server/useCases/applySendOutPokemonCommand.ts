import {
  SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  type SessionCommandConflictRejection,
  type SessionCommandDuplicateResult,
  type SessionCommandInvalidRejection,
  type SessionCommandRejectedResult,
  type SessionCommandResultMetadata,
  type SessionCommandUnauthorizedRejection,
  type SessionCommandValidationIssue,
} from '#shared/sessionCommandResults'
import { validateSessionCommandEnvelope } from '#shared/sessionCommandValidation'
import type { SessionId } from '#shared/sessionIdentity'
import type { PermissionDenied } from '#shared/sessionPermissions'
import type { MapRevision, SessionRevision } from '#shared/sessionRevisions'
import {
  getSessionMapState,
  type AuthoritativeSessionMapState,
  type AuthoritativeSessionState,
  type SessionMapSlug,
} from '#shared/sessionState'
import {
  SEND_OUT_POKEMON_COMMAND_TYPE,
  validateSendOutPokemonCommand,
  type MoveTokenPosition,
  type SendOutPokemonCommand,
  type SendOutPokemonCommandPayload,
  type SessionTokenFacingDirection,
} from '#shared/sessionTokenCommands'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMapV2 } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { canPlacePokemon } from '~/utils/gridPlacement'
import type { GridFootprint, PositionedGridFootprint } from '~/utils/gridGeometry'
import {
  isSendOutPositionWithinThrowRange,
  POKEBALL_THROW_RANGE_SQUARES,
} from '~/utils/mapTokenSendOut'
import { placementToSpawned, type SheetLookup } from '~/utils/placement'
import { DEFAULT_TOKEN_FACING_DIRECTION, tokenFacingStoresLegacyTurned } from '~/utils/tokenFacing'
import { buildVoxelOccupancy } from '~/utils/voxelOccupancy'
import { assertSessionHostEnabled, type SessionHostRuntimeEnv } from '../utils/sessionHosting'
import {
  sessionOperationTracker,
  type InMemorySessionOperationTracker,
} from '../utils/sessionOperationTracker'
import {
  applyAcceptedSessionCommandEffect,
  type AcceptedSessionCommandPatchEvent,
  type ApplyAcceptedSessionCommandEffectResult,
} from '../utils/sessionRevisionApplication'
import {
  writeSessionSnapshot,
  type WriteSessionSnapshotOptions,
  type WriteSessionSnapshotResult,
} from '../utils/sessionSnapshots'
import {
  sessionStore,
  type InMemorySessionStore,
  type SessionStoreRecord,
  type SessionStoreStatus,
} from '../utils/sessionStore'
import { readRuntimeSheet } from '../utils/sqliteSheetRuntimeHelpers'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class ApplySendOutPokemonCommandUseCaseError<
  TStatusCode extends number = number,
> extends UseCaseHttpError<TStatusCode> {}

export const SEND_OUT_POKEMON_PATCH_EVENT_TYPE = 'pokemonSentOut' as const

export interface SendOutPokemonCurrentState {
  readonly trainerTokenId: string
  readonly tokenId: string
  readonly mapSlug: SessionMapSlug
  readonly trainerPlacement: SheetPlacement
  readonly placement?: SheetPlacement
  readonly position?: MoveTokenPosition
  readonly revision: SessionRevision
  readonly mapRevision: MapRevision
  readonly trainerSheetSlug: string
  readonly pokemonSlug: string
}

export interface SendOutPokemonPatchPayload {
  readonly trainerTokenId: string
  readonly tokenId: string
  readonly mapSlug: SessionMapSlug
  readonly trainerSheetSlug: string
  readonly pokemonSlug: string
  readonly placement: SheetPlacement
  readonly position: MoveTokenPosition
}

export type SendOutPokemonPatchEvent = AcceptedSessionCommandPatchEvent<
  typeof SEND_OUT_POKEMON_PATCH_EVENT_TYPE,
  SendOutPokemonPatchPayload
>

export type SendOutPokemonAcceptedApplication = ApplyAcceptedSessionCommandEffectResult<
  typeof SEND_OUT_POKEMON_COMMAND_TYPE,
  SendOutPokemonCommandPayload,
  TabletopMapV2,
  typeof SEND_OUT_POKEMON_PATCH_EVENT_TYPE,
  SendOutPokemonPatchPayload
>

export type SendOutPokemonRejectedResult = SessionCommandRejectedResult<
  typeof SEND_OUT_POKEMON_COMMAND_TYPE,
  SendOutPokemonCurrentState | null,
  SessionRevision
>

export type SendOutPokemonDuplicateResult = SessionCommandDuplicateResult<
  typeof SEND_OUT_POKEMON_COMMAND_TYPE,
  SessionRevision
>

export interface ApplySendOutPokemonCommandInput {
  readonly command?: unknown
}

export type ApplySendOutPokemonCommandClock = () => string
export type ApplySendOutPokemonCommandSnapshotWriter = (
  state: AuthoritativeSessionState<TabletopMapV2>,
  options?: WriteSessionSnapshotOptions<TabletopMapV2>,
) => WriteSessionSnapshotResult<TabletopMapV2>

export interface SendOutPokemonResolvedSheets {
  readonly trainerSheet: TrainerSheet
  readonly pokemonSheet: CharacterSheet
}

export type SendOutPokemonSheetResolver = (input: {
  readonly trainerSheetSlug: string
  readonly pokemonSlug: string
  readonly trainerPlacement: SheetPlacement
  readonly command: SendOutPokemonCommand
}) => SendOutPokemonResolvedSheets | null

export type SendOutPokemonFootprintResolver = (input: {
  readonly placement: SheetPlacement
  readonly sheets: SheetLookup
  readonly map: TabletopMapV2
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}) => GridFootprint | null

export interface ApplySendOutPokemonCommandDependencies {
  readonly env?: SessionHostRuntimeEnv
  readonly store?: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>
  readonly operationTracker?: InMemorySessionOperationTracker | false
  readonly clock?: ApplySendOutPokemonCommandClock
  readonly writeSnapshot?: ApplySendOutPokemonCommandSnapshotWriter
  readonly resolveSheets?: SendOutPokemonSheetResolver
  readonly resolveFootprint?: SendOutPokemonFootprintResolver
  readonly throwRange?: number
}

export interface AppliedSendOutPokemonSessionDetails {
  readonly sessionId: SessionId
  readonly status: SessionStoreStatus
  readonly revision: SessionRevision
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AppliedSendOutPokemonSnapshotDetails {
  readonly writtenAt: string
  readonly revision: SessionRevision
}

export interface ApplySendOutPokemonAcceptedResult {
  readonly status: 'accepted'
  readonly session: AppliedSendOutPokemonSessionDetails
  readonly command: SendOutPokemonCommand
  readonly result: SendOutPokemonAcceptedApplication['result']
  readonly patchEvent: SendOutPokemonPatchEvent
  readonly eventLogEntry: SendOutPokemonAcceptedApplication['eventLogEntry']
  readonly token: SendOutPokemonCurrentState
  readonly snapshot: AppliedSendOutPokemonSnapshotDetails
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
  readonly mapRevisionChanges: SendOutPokemonAcceptedApplication['mapRevisionChanges']
}

export interface ApplySendOutPokemonRejectedResult {
  readonly status: 'rejected'
  readonly session: AppliedSendOutPokemonSessionDetails
  readonly command: SendOutPokemonCommand
  readonly result: SendOutPokemonRejectedResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export interface ApplySendOutPokemonDuplicateResult {
  readonly status: 'duplicate'
  readonly session: AppliedSendOutPokemonSessionDetails
  readonly command: SendOutPokemonCommand
  readonly result: SendOutPokemonDuplicateResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export type ApplySendOutPokemonCommandUseCaseResult =
  | ApplySendOutPokemonAcceptedResult
  | ApplySendOutPokemonRejectedResult
  | ApplySendOutPokemonDuplicateResult

type SendOutPokemonSessionRecord = SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>> & {
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

type ResolvedSendOutPokemonTarget = {
  readonly mapSlug: SessionMapSlug
  readonly mapState: AuthoritativeSessionMapState<TabletopMapV2>
  readonly trainerPlacement: SheetPlacement
  readonly placement: SheetPlacement
}

const defaultClock: ApplySendOutPokemonCommandClock = () => new Date().toISOString()

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const clonePosition = (position: MoveTokenPosition): MoveTokenPosition => ({
  x: position.x,
  y: position.y,
  z: position.z,
})

const clonePlacement = (placement: SheetPlacement): SheetPlacement => ({
  ...placement,
  position: clonePosition(placement.position),
})

const metadataForResult = (
  command: SendOutPokemonCommand,
  processedAt: string,
): SessionCommandResultMetadata => ({
  serverProcessedAt: processedAt,
  ...(command.metadata?.traceId === undefined ? {} : { traceId: command.metadata.traceId }),
})

const issueSummary = (issues: readonly SessionCommandValidationIssue[]): string =>
  issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')

const defaultResolveSheets: SendOutPokemonSheetResolver = ({ trainerSheetSlug, pokemonSlug }) => {
  try {
    const trainer = readRuntimeSheet<TrainerSheet>('trainer', trainerSheetSlug)
    const pokemon = readRuntimeSheet<CharacterSheet>('pokemon', pokemonSlug)
    if (trainer === null || pokemon === null) return null
    return {
      trainerSheet: trainer.sheet,
      pokemonSheet: pokemon.sheet,
    }
  } catch {
    return null
  }
}

const defaultResolveFootprint: SendOutPokemonFootprintResolver = ({ placement, sheets }) => {
  const spawned = placementToSpawned(placement, sheets)
  if (spawned === null) return null
  return {
    id: spawned.id,
    base: spawned.base,
    clearance: spawned.clearance,
  }
}

const fallbackFootprintForPlacement = (placement: SheetPlacement): GridFootprint => ({
  id: placement.id,
  base: 1,
  clearance: 1,
})

const assertValidFootprint = (
  footprint: GridFootprint,
  placement: SheetPlacement,
): GridFootprint => {
  if (!Number.isSafeInteger(footprint.base) || footprint.base < 1) {
    throw new ApplySendOutPokemonCommandUseCaseError(
      500,
      `Resolved footprint for token ${placement.id} must have a positive safe-integer base`,
    )
  }

  if (
    footprint.clearance !== undefined &&
    (!Number.isSafeInteger(footprint.clearance) || footprint.clearance < 1)
  ) {
    throw new ApplySendOutPokemonCommandUseCaseError(
      500,
      `Resolved footprint for token ${placement.id} must have a positive safe-integer clearance`,
    )
  }

  return footprint
}

const positionedFootprintForPlacement = (
  placement: SheetPlacement,
  sheets: SheetLookup,
  map: TabletopMapV2,
  state: AuthoritativeSessionState<TabletopMapV2>,
  resolveFootprint: SendOutPokemonFootprintResolver,
  options: { readonly allowFallback: boolean },
): PositionedGridFootprint | null => {
  const resolved = resolveFootprint({ placement, sheets, map, state })
  if (resolved === null && !options.allowFallback) return null

  const footprint = assertValidFootprint(resolved ?? fallbackFootprintForPlacement(placement), placement)
  return {
    ...footprint,
    id: footprint.id ?? placement.id,
    position: clonePosition(placement.position),
  }
}

const sheetLookupFor = (
  target: ResolvedSendOutPokemonTarget,
  sheets: SendOutPokemonResolvedSheets,
): SheetLookup => ({
  pokemon: new Map([[target.placement.sheetSlug, sheets.pokemonSheet]]),
  trainer: new Map([[target.trainerPlacement.sheetSlug, sheets.trainerSheet]]),
})

const trainerOwnsPokemon = (trainerSheet: TrainerSheet, pokemonSlug: string): boolean =>
  (trainerSheet.currentTeam ?? []).some((slug) => slug.trim() === pokemonSlug)

const tokenStateFromPlacement = (
  mapSlug: SessionMapSlug,
  mapRevision: MapRevision,
  sessionRevision: SessionRevision,
  trainerPlacement: SheetPlacement,
  placement: SheetPlacement | undefined,
  payload: SendOutPokemonCommandPayload,
): SendOutPokemonCurrentState => ({
  trainerTokenId: payload.trainerTokenId,
  tokenId: payload.tokenId,
  mapSlug,
  trainerPlacement: clonePlacement(trainerPlacement),
  ...(placement === undefined ? {} : { placement: clonePlacement(placement) }),
  ...(placement === undefined ? {} : { position: clonePosition(placement.position) }),
  revision: sessionRevision,
  mapRevision,
  trainerSheetSlug: trainerPlacement.sheetSlug,
  pokemonSlug: payload.pokemonSlug,
})

const getActiveSendOutPokemonRecord = (
  store: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>,
  command: Pick<SendOutPokemonCommand, 'sessionId'>,
): SendOutPokemonSessionRecord => {
  const record = store.get(command.sessionId)
  if (record === undefined) {
    throw new ApplySendOutPokemonCommandUseCaseError(
      404,
      'No live session was found for the supplied sendOutPokemon command',
    )
  }

  if (record.status !== 'active') {
    throw new ApplySendOutPokemonCommandUseCaseError(
      409,
      'The live session must be active before sendOutPokemon commands can apply',
    )
  }

  if (record.state === undefined) {
    throw new ApplySendOutPokemonCommandUseCaseError(
      500,
      'The live session has no authoritative state available for sendOutPokemon commands',
    )
  }

  return record as SendOutPokemonSessionRecord
}

const sessionDetailsFor = (
  record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>,
): AppliedSendOutPokemonSessionDetails => ({
  sessionId: record.sessionId,
  status: record.status,
  revision: record.revision,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
})

const createInvalidRejection = (
  command: SendOutPokemonCommand,
  record: SendOutPokemonSessionRecord,
  issues: readonly SessionCommandValidationIssue[],
  processedAt: string,
): SessionCommandInvalidRejection<typeof SEND_OUT_POKEMON_COMMAND_TYPE, SessionRevision> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'invalid',
  message: issueSummary(issues) || 'sendOutPokemon command is invalid.',
  retryable: false,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: SEND_OUT_POKEMON_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  issues,
  metadata: metadataForResult(command, processedAt),
})

const createUnauthorizedRejection = (
  command: SendOutPokemonCommand,
  record: SendOutPokemonSessionRecord,
  permission: PermissionDenied | undefined,
  processedAt: string,
): SessionCommandUnauthorizedRejection<
  typeof SEND_OUT_POKEMON_COMMAND_TYPE,
  SendOutPokemonCurrentState | null,
  SessionRevision
> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'unauthorized',
  message: permission?.message ?? 'Only the GM or a player assigned to the trainer token can send out that trainer\'s Pokémon in a live session.',
  retryable: false,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: SEND_OUT_POKEMON_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  ...(permission === undefined ? {} : { permission }),
  metadata: metadataForResult(command, processedAt),
})

const createConflictRejection = (
  command: SendOutPokemonCommand,
  record: SendOutPokemonSessionRecord,
  message: string,
  processedAt: string,
  options: {
    readonly retryable?: boolean
    readonly currentState?: SendOutPokemonCurrentState | null
  } = {},
): SessionCommandConflictRejection<
  typeof SEND_OUT_POKEMON_COMMAND_TYPE,
  SendOutPokemonCurrentState | null,
  SessionRevision
> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'conflict',
  message,
  retryable: options.retryable ?? true,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: SEND_OUT_POKEMON_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  conflictingScopes: command.scopes,
  ...(options.currentState === undefined ? {} : { currentState: options.currentState }),
  metadata: metadataForResult(command, processedAt),
})

const rejectionOutcome = (
  command: SendOutPokemonCommand,
  record: SendOutPokemonSessionRecord,
  state: AuthoritativeSessionState<TabletopMapV2>,
  result: SendOutPokemonRejectedResult,
): ApplySendOutPokemonRejectedResult => ({
  status: 'rejected',
  session: sessionDetailsFor(record),
  command,
  result,
  record,
  state,
})

const resolveMapSlug = (
  state: AuthoritativeSessionState<TabletopMapV2>,
  trainerMapSlug: string | undefined,
  pokemonMapSlug: string | undefined,
): SessionMapSlug | undefined => trainerMapSlug ?? pokemonMapSlug ?? state.selectedMapSlug ?? undefined

const findTokenPlacement = (
  mapState: AuthoritativeSessionMapState<TabletopMapV2>,
  tokenId: string,
): SheetPlacement | undefined => mapState.document.placements.find((placement) => placement.id === tokenId)

const normalizedSentOutPlacement = (
  payload: SendOutPokemonCommandPayload,
): SheetPlacement => {
  const facing = payload.facing ?? DEFAULT_TOKEN_FACING_DIRECTION
  return {
    id: payload.tokenId,
    sheetKind: 'pokemon',
    sheetSlug: payload.pokemonSlug,
    position: clonePosition(payload.position),
    facing,
    turned: tokenFacingStoresLegacyTurned(facing),
  }
}

const resolveSendOutPokemonTarget = (
  command: SendOutPokemonCommand,
  record: SendOutPokemonSessionRecord,
  trainerMapSlugInput: string | undefined,
  pokemonMapSlugInput: string | undefined,
  processedAt: string,
):
  | { readonly ok: true; readonly target: ResolvedSendOutPokemonTarget }
  | { readonly ok: false; readonly result: SendOutPokemonRejectedResult } => {
  const mapSlug = resolveMapSlug(record.state, trainerMapSlugInput, pokemonMapSlugInput)
  if (mapSlug === undefined) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        'sendOutPokemon commands must identify a map or the session must have a selected map.',
        processedAt,
        { retryable: false },
      ),
    }
  }

  const mapState = getSessionMapState(record.state, mapSlug)
  if (mapState === undefined) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Map ${mapSlug} is not available in the authoritative session state.`,
        processedAt,
        { retryable: true },
      ),
    }
  }

  const trainerPlacement = findTokenPlacement(mapState, command.payload.trainerTokenId)
  if (trainerPlacement === undefined) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Trainer token ${command.payload.trainerTokenId} is not present on map ${mapSlug}.`,
        processedAt,
        { retryable: true, currentState: null },
      ),
    }
  }

  if (trainerPlacement.sheetKind !== 'trainer') {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Token ${command.payload.trainerTokenId} is a ${trainerPlacement.sheetKind} token, not a trainer token that can send out Pokémon.`,
        processedAt,
        {
          retryable: false,
          currentState: tokenStateFromPlacement(
            mapSlug,
            mapState.revision,
            record.revision,
            trainerPlacement,
            undefined,
            command.payload,
          ),
        },
      ),
    }
  }

  const trainerScopeResource = command.scopes
    .map((scope) => scope.resource)
    .find((resource) => resource?.kind === 'token' && resource.tokenId === command.payload.trainerTokenId)
  const trainerScopeSheetSlug = trainerScopeResource?.kind === 'token'
    ? trainerScopeResource.sheetSlug
    : undefined
  if (trainerScopeSheetSlug !== undefined && trainerScopeSheetSlug !== trainerPlacement.sheetSlug) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Trainer token ${command.payload.trainerTokenId} references sheet ${trainerPlacement.sheetSlug}, not scoped sheet ${trainerScopeSheetSlug}.`,
        processedAt,
        {
          retryable: false,
          currentState: tokenStateFromPlacement(
            mapSlug,
            mapState.revision,
            record.revision,
            trainerPlacement,
            undefined,
            command.payload,
          ),
        },
      ),
    }
  }

  const existingPlacement = findTokenPlacement(mapState, command.payload.tokenId)
  if (existingPlacement !== undefined) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Token ${command.payload.tokenId} is already present on map ${mapSlug}.`,
        processedAt,
        {
          retryable: false,
          currentState: tokenStateFromPlacement(
            mapSlug,
            mapState.revision,
            record.revision,
            trainerPlacement,
            existingPlacement,
            command.payload,
          ),
        },
      ),
    }
  }

  return {
    ok: true,
    target: {
      mapSlug,
      mapState,
      trainerPlacement,
      placement: normalizedSentOutPlacement(command.payload),
    },
  }
}

const validateTrainerOwnership = (
  command: SendOutPokemonCommand,
  record: SendOutPokemonSessionRecord,
  target: ResolvedSendOutPokemonTarget,
  processedAt: string,
  resolveSheets: SendOutPokemonSheetResolver,
):
  | { readonly ok: true; readonly sheets: SendOutPokemonResolvedSheets }
  | { readonly ok: false; readonly result: SendOutPokemonRejectedResult } => {
  const sheets = resolveSheets({
    trainerSheetSlug: target.trainerPlacement.sheetSlug,
    pokemonSlug: command.payload.pokemonSlug,
    trainerPlacement: target.trainerPlacement,
    command,
  })

  if (sheets === null) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Trainer sheet ${target.trainerPlacement.sheetSlug} or Pokémon sheet ${command.payload.pokemonSlug} could not be loaded for sendOutPokemon.`,
        processedAt,
        {
          retryable: true,
          currentState: tokenStateFromPlacement(
            target.mapSlug,
            target.mapState.revision,
            record.revision,
            target.trainerPlacement,
            undefined,
            command.payload,
          ),
        },
      ),
    }
  }

  if (!trainerOwnsPokemon(sheets.trainerSheet, command.payload.pokemonSlug)) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Trainer ${target.trainerPlacement.sheetSlug} does not have Pokémon ${command.payload.pokemonSlug} on their current team.`,
        processedAt,
        {
          retryable: false,
          currentState: tokenStateFromPlacement(
            target.mapSlug,
            target.mapState.revision,
            record.revision,
            target.trainerPlacement,
            undefined,
            command.payload,
          ),
        },
      ),
    }
  }

  return { ok: true, sheets }
}

const validateSendOutDestination = (
  command: SendOutPokemonCommand,
  record: SendOutPokemonSessionRecord,
  target: ResolvedSendOutPokemonTarget,
  sheets: SendOutPokemonResolvedSheets,
  processedAt: string,
  resolveFootprint: SendOutPokemonFootprintResolver,
  throwRange: number,
): SendOutPokemonRejectedResult | undefined => {
  const lookup = sheetLookupFor(target, sheets)
  const trainerFootprint = positionedFootprintForPlacement(
    target.trainerPlacement,
    lookup,
    target.mapState.document,
    record.state,
    resolveFootprint,
    { allowFallback: false },
  )
  const pokemonFootprint = positionedFootprintForPlacement(
    target.placement,
    lookup,
    target.mapState.document,
    record.state,
    resolveFootprint,
    { allowFallback: false },
  )

  if (trainerFootprint === null || pokemonFootprint === null) {
    return createConflictRejection(
      command,
      record,
      `Trainer ${target.trainerPlacement.sheetSlug} or Pokémon ${command.payload.pokemonSlug} could not resolve a map footprint for sendOutPokemon.`,
      processedAt,
      {
        retryable: true,
        currentState: tokenStateFromPlacement(
          target.mapSlug,
          target.mapState.revision,
          record.revision,
          target.trainerPlacement,
          undefined,
          command.payload,
        ),
      },
    )
  }

  const otherFootprints = target.mapState.document.placements.map((placement) => positionedFootprintForPlacement(
    placement,
    lookup,
    target.mapState.document,
    record.state,
    resolveFootprint,
    { allowFallback: true },
  )).filter((footprint): footprint is PositionedGridFootprint => footprint !== null)
  const occupiedVoxels = buildVoxelOccupancy(target.mapState.document.voxels)

  const canPlace = canPlacePokemon(
    pokemonFootprint,
    target.placement.position,
    otherFootprints,
    target.mapState.document.dimensions,
    target.placement.id,
    occupiedVoxels,
  )
  if (!canPlace) {
    return createConflictRejection(
      command,
      record,
      `Pokémon ${command.payload.pokemonSlug} cannot be sent out at ${target.placement.position.x},${target.placement.position.y},${target.placement.position.z}; the destination is out of bounds, blocked, or occupied.`,
      processedAt,
      { retryable: true, currentState: null },
    )
  }

  const withinRange = isSendOutPositionWithinThrowRange({
    trainer: { ...trainerFootprint, clearance: trainerFootprint.clearance ?? 1 },
    pokemon: { ...pokemonFootprint, clearance: pokemonFootprint.clearance ?? 1 },
    position: target.placement.position,
    range: throwRange,
  })
  if (!withinRange) {
    return createConflictRejection(
      command,
      record,
      `Pokémon ${command.payload.pokemonSlug} cannot be sent out at ${target.placement.position.x},${target.placement.position.y},${target.placement.position.z}; the destination is outside the trainer's Poké Ball throw range.`,
      processedAt,
      {
        retryable: true,
        currentState: tokenStateFromPlacement(
          target.mapSlug,
          target.mapState.revision,
          record.revision,
          target.trainerPlacement,
          undefined,
          command.payload,
        ),
      },
    )
  }

  return undefined
}

const sentOutMapDocument = (
  map: TabletopMapV2,
  placement: SheetPlacement,
  processedAt: string,
): TabletopMapV2 => {
  const updatedAtMs = Date.parse(processedAt)
  return {
    ...map,
    placements: [...map.placements, clonePlacement(placement)],
    ...(Number.isFinite(updatedAtMs) ? { updatedAt: updatedAtMs } : {}),
  }
}

const rememberRejectedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: SendOutPokemonCommand,
  result: SendOutPokemonRejectedResult,
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const rememberAcceptedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: SendOutPokemonCommand,
  result: SendOutPokemonAcceptedApplication['result'],
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const validateEnvelopeForSendOutPokemon = (commandInput: unknown): SendOutPokemonCommand => {
  const envelopeValidation = validateSessionCommandEnvelope<SendOutPokemonCommand>(commandInput)
  if (envelopeValidation.valid) {
    if (envelopeValidation.command.type !== SEND_OUT_POKEMON_COMMAND_TYPE) {
      throw new ApplySendOutPokemonCommandUseCaseError(
        400,
        'applySendOutPokemonCommandUseCase only handles sendOutPokemon command envelopes',
      )
    }

    return envelopeValidation.command
  }

  throw new ApplySendOutPokemonCommandUseCaseError(
    400,
    `sendOutPokemon command envelope is malformed: ${issueSummary(envelopeValidation.issues)}`,
  )
}

const normalizedThrowRange = (range: number | undefined): number => {
  if (range === undefined) return POKEBALL_THROW_RANGE_SQUARES
  if (!Number.isSafeInteger(range) || range < 0) {
    throw new ApplySendOutPokemonCommandUseCaseError(
      500,
      'sendOutPokemon throwRange dependency must be a safe non-negative integer',
    )
  }
  return range
}

export const applySendOutPokemonCommandUseCase = (
  input: ApplySendOutPokemonCommandInput = {},
  dependencies: ApplySendOutPokemonCommandDependencies = {},
): ApplySendOutPokemonCommandUseCaseResult => {
  assertSessionHostEnabled(dependencies.env)

  const activeStore = dependencies.store ?? (sessionStore as InMemorySessionStore<
    AuthoritativeSessionState<TabletopMapV2>
  >)
  const tracker = dependencies.operationTracker ?? sessionOperationTracker
  const clock = dependencies.clock ?? defaultClock
  const snapshotWriter = dependencies.writeSnapshot ?? writeSessionSnapshot
  const resolveSheets = dependencies.resolveSheets ?? defaultResolveSheets
  const resolveFootprint = dependencies.resolveFootprint ?? defaultResolveFootprint
  const throwRange = normalizedThrowRange(dependencies.throwRange)

  const envelope = validateEnvelopeForSendOutPokemon(input.command)
  const record = getActiveSendOutPokemonRecord(activeStore, envelope)
  const processedAt = clock()

  if (tracker !== false) {
    const duplicateCheck = tracker.check(envelope, {
      currentRevision: record.revision,
      processedAt,
    })

    if (duplicateCheck.status === 'duplicate') {
      return {
        status: 'duplicate',
        session: sessionDetailsFor(record),
        command: envelope,
        result: duplicateCheck.result as SendOutPokemonDuplicateResult,
        record,
        state: record.state,
      }
    }

    if (duplicateCheck.status === 'mismatched-opId') {
      const result = createConflictRejection(
        envelope,
        record,
        duplicateCheck.message,
        processedAt,
        { retryable: false },
      )
      return rejectionOutcome(envelope, record, record.state, result)
    }
  }

  const commandValidation = validateSendOutPokemonCommand(envelope, {
    assignments: record.state.assignments,
  })

  if (!commandValidation.valid) {
    const result = commandValidation.permission?.allowed === false
      ? createUnauthorizedRejection(envelope, record, commandValidation.permission, processedAt)
      : createInvalidRejection(envelope, record, commandValidation.issues, processedAt)

    rememberRejectedResult(tracker, envelope, result, processedAt)
    return rejectionOutcome(envelope, record, record.state, result)
  }

  const targetResult = resolveSendOutPokemonTarget(
    commandValidation.command,
    record,
    commandValidation.trainerResource.mapSlug,
    commandValidation.pokemonResource.mapSlug,
    processedAt,
  )
  if (!targetResult.ok) {
    rememberRejectedResult(tracker, envelope, targetResult.result, processedAt)
    return rejectionOutcome(envelope, record, record.state, targetResult.result)
  }

  const ownershipResult = validateTrainerOwnership(
    commandValidation.command,
    record,
    targetResult.target,
    processedAt,
    resolveSheets,
  )
  if (!ownershipResult.ok) {
    rememberRejectedResult(tracker, envelope, ownershipResult.result, processedAt)
    return rejectionOutcome(envelope, record, record.state, ownershipResult.result)
  }

  const destinationRejection = validateSendOutDestination(
    commandValidation.command,
    record,
    targetResult.target,
    ownershipResult.sheets,
    processedAt,
    resolveFootprint,
    throwRange,
  )
  if (destinationRejection !== undefined) {
    rememberRejectedResult(tracker, envelope, destinationRejection, processedAt)
    return rejectionOutcome(envelope, record, record.state, destinationRejection)
  }

  const nextDocument = sentOutMapDocument(
    targetResult.target.mapState.document,
    targetResult.target.placement,
    processedAt,
  )
  const applied = applyAcceptedSessionCommandEffect({
    state: record.state,
    command: commandValidation.command,
    eventType: SEND_OUT_POKEMON_PATCH_EVENT_TYPE,
    eventPayload: {
      trainerTokenId: targetResult.target.trainerPlacement.id,
      tokenId: targetResult.target.placement.id,
      mapSlug: targetResult.target.mapSlug,
      trainerSheetSlug: targetResult.target.trainerPlacement.sheetSlug,
      pokemonSlug: targetResult.target.placement.sheetSlug,
      placement: clonePlacement(targetResult.target.placement),
      position: clonePosition(targetResult.target.placement.position),
    },
    mapEffects: [
      {
        mapSlug: targetResult.target.mapSlug,
        document: nextDocument,
      },
    ],
  }, {
    processedAt,
  })

  const updatedRecord = activeStore.setState(record.sessionId, applied.state, {
    revision: applied.currentRevision,
    updatedAt: applied.processedAt,
  })
  if (updatedRecord === undefined) {
    throw new ApplySendOutPokemonCommandUseCaseError(
      409,
      'The live session ended before sendOutPokemon could apply',
    )
  }

  let snapshot: WriteSessionSnapshotResult<TabletopMapV2>
  try {
    snapshot = snapshotWriter(applied.state, { clock: () => applied.processedAt })
  } catch (error) {
    activeStore.setState(record.sessionId, record.state, {
      revision: record.revision,
      updatedAt: record.updatedAt,
    })
    throw new ApplySendOutPokemonCommandUseCaseError(
      500,
      `Failed to write sendOutPokemon session snapshot: ${messageFromError(error)}`,
    )
  }

  rememberAcceptedResult(tracker, commandValidation.command, applied.result, applied.processedAt)

  const currentMapState = getSessionMapState(applied.state, targetResult.target.mapSlug)
  const currentPlacement = currentMapState?.document.placements.find(
    (placement) => placement.id === commandValidation.payload.tokenId,
  )
  const currentTrainerPlacement = currentMapState?.document.placements.find(
    (placement) => placement.id === commandValidation.payload.trainerTokenId,
  )
  if (currentMapState === undefined || currentPlacement === undefined || currentTrainerPlacement === undefined) {
    throw new ApplySendOutPokemonCommandUseCaseError(
      500,
      'sendOutPokemon applied but the trainer or spawned token could not be found in next authoritative state',
    )
  }

  return {
    status: 'accepted',
    session: sessionDetailsFor(updatedRecord),
    command: commandValidation.command,
    result: applied.result,
    patchEvent: applied.patchEvent,
    eventLogEntry: applied.eventLogEntry,
    token: tokenStateFromPlacement(
      targetResult.target.mapSlug,
      currentMapState.revision,
      applied.currentRevision,
      currentTrainerPlacement,
      currentPlacement,
      commandValidation.payload,
    ),
    snapshot: {
      writtenAt: snapshot.snapshot.writtenAt,
      revision: snapshot.snapshot.revision,
    },
    record: updatedRecord,
    state: applied.state,
    mapRevisionChanges: applied.mapRevisionChanges,
  }
}
