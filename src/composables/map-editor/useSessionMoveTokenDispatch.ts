import { computed, getCurrentScope, onScopeDispose, ref, type ComputedRef, type Ref } from 'vue'
import {
  type SessionClientIdentity,
} from '#shared/sessionClientIdentity'
import {
  SESSION_COMMAND_ENVELOPE_VERSION,
  createOpId as defaultCreateOpId,
  isOpId,
  type OpId,
} from '#shared/sessionCommands'
import {
  SESSION_MESSAGE_SCHEMA_VERSION,
  type SessionClientMessage,
  type SessionCommandMessage,
  type SessionServerMessage,
} from '#shared/sessionMessages'
import { isRecord } from '#shared/sessionCommandValidation'
import type { SessionActor } from '#shared/sessionPermissions'
import { INITIAL_SESSION_REVISION, isSessionRevision, type SessionRevision } from '#shared/sessionRevisions'
import {
  MOVE_TOKEN_COMMAND_TYPE,
  createMoveTokenCommandScope,
  type MoveTokenCommand,
  type MoveTokenPosition,
} from '#shared/sessionTokenCommands'
import type { GridAnchor, SheetPlacement } from '~/types/map'
import {
  sessionClientIdentityStorage,
  type SessionClientIdentityStorage,
} from '~/utils/sessionClientIdentityStorage'
import {
  useSessionSocket,
  type SessionSocketHelloStatus,
  type SessionSocketMessageHandler,
  type SessionSocketSendResult,
  type SessionSocketStatus,
} from '~/composables/useSessionSocket'

interface BooleanRef {
  readonly value: boolean
}

type MaybeRef<TValue> = TValue | Ref<TValue>

export interface SessionMoveTokenSocket {
  readonly status: Ref<SessionSocketStatus>
  readonly helloStatus: Ref<SessionSocketHelloStatus>
  readonly lastKnownRevision: Ref<SessionRevision | null>
  connect(): boolean
  sendHello(
    identity: SessionClientIdentity,
  ): SessionSocketSendResult<SessionClientMessage<MoveTokenCommand>>
  send(
    message: SessionClientMessage<MoveTokenCommand>,
  ): SessionSocketSendResult<SessionClientMessage<MoveTokenCommand>>
  addMessageHandler?: (handler: SessionSocketMessageHandler<SessionServerMessage>) => () => void
}

export interface CreateMoveTokenCommandMessageInput {
  readonly identity: SessionClientIdentity
  readonly mapSlug: string
  readonly placement: Pick<SheetPlacement, 'id' | 'sheetKind' | 'sheetSlug'>
  readonly to: GridAnchor | MoveTokenPosition
  readonly baseRevision: SessionRevision
  readonly opId?: OpId
  readonly now?: () => string
}

export interface DispatchSessionMoveTokenInput {
  readonly placement: Pick<SheetPlacement, 'id' | 'sheetKind' | 'sheetSlug' | 'position'> | null | undefined
  readonly to: GridAnchor | MoveTokenPosition
}

export type SessionMoveTokenDispatchFailureReason =
  | 'not-session-mode'
  | 'missing-session-identity'
  | 'missing-placement'
  | 'socket-unavailable'
  | 'hello-failed'
  | 'send-failed'

export type SessionMoveTokenDispatchResult =
  | {
      readonly dispatched: true
      readonly command: MoveTokenCommand
      readonly message: SessionCommandMessage<MoveTokenCommand>
      readonly sendResult: Extract<SessionSocketSendResult<SessionClientMessage<MoveTokenCommand>>, { readonly ok: true }>
    }
  | {
      readonly dispatched: false
      readonly reason: SessionMoveTokenDispatchFailureReason
      readonly message: string
    }

export type SessionMoveTokenOptimisticStatus = 'pending' | 'confirmed' | 'reconciled'

export interface SessionMoveTokenOptimisticMove {
  readonly opId: OpId
  readonly tokenId: string
  readonly mapSlug: string
  readonly from: MoveTokenPosition
  readonly to: MoveTokenPosition
  readonly position: MoveTokenPosition
  readonly status: SessionMoveTokenOptimisticStatus
  readonly baseRevision: SessionRevision
  readonly currentRevision?: SessionRevision
  readonly issuedAt: string
  readonly updatedAt: string
  readonly message?: string
}

export interface SessionMoveTokenPositionOverride {
  readonly tokenId: string
  readonly mapSlug: string
  readonly position: MoveTokenPosition
  readonly status: SessionMoveTokenOptimisticStatus
  readonly opId: OpId
  readonly revision?: SessionRevision
  readonly message?: string
}

export interface SessionMoveTokenOptimisticRejection {
  readonly opId: OpId
  readonly tokenId?: string
  readonly mapSlug?: string
  readonly reason: string
  readonly message: string
  readonly currentRevision: SessionRevision
  readonly currentState?: SessionMoveTokenPositionOverride
}

export interface SessionMoveTokenDispatcher {
  readonly enabled: BooleanRef
  readonly identity: Ref<SessionClientIdentity | null>
  readonly lastError: Ref<string | null>
  readonly optimisticMoves: Ref<readonly SessionMoveTokenOptimisticMove[]>
  readonly tokenPositionOverrides: ComputedRef<readonly SessionMoveTokenPositionOverride[]>
  readonly lastRejection: Ref<SessionMoveTokenOptimisticRejection | null>
  dispatchMoveToken(input: DispatchSessionMoveTokenInput): SessionMoveTokenDispatchResult
  handleServerMessage(message: SessionServerMessage): void
  rollbackOptimisticMove(opId: OpId, message?: string): boolean
}

export interface UseSessionMoveTokenDispatchOptions {
  readonly enabled: BooleanRef
  readonly mapSlug: MaybeRef<string>
  readonly identityStorage?: SessionClientIdentityStorage
  readonly socket?: SessionMoveTokenSocket
  readonly now?: () => string
  readonly createOpId?: () => OpId
}

const defaultClock = (): string => new Date().toISOString()

const readMaybeRef = <TValue>(value: MaybeRef<TValue>): TValue => {
  if (typeof value === 'object' && value !== null && 'value' in value) {
    return (value as Ref<TValue>).value
  }
  return value as TValue
}

export const isSessionModeQueryEnabled = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(isSessionModeQueryEnabled)
  if (typeof value !== 'string') return false

  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

export const sessionActorFromClientIdentity = (identity: SessionClientIdentity): SessionActor => {
  if (identity.role === 'gm') {
    return {
      role: 'gm',
      clientId: identity.clientId,
    }
  }

  return {
    role: 'player',
    playerId: identity.playerId,
    clientId: identity.clientId,
    displayName: identity.displayName,
  }
}

const clonePosition = (position: GridAnchor | MoveTokenPosition): MoveTokenPosition => ({
  x: position.x,
  y: position.y,
  z: position.z,
})

const TOKEN_MOVED_PATCH_EVENT_TYPE = 'tokenMoved' as const

interface MoveTokenPatchPayloadLike {
  readonly tokenId: string
  readonly mapSlug: string
  readonly from?: MoveTokenPosition
  readonly to: MoveTokenPosition
}

interface MoveTokenPatchEventLike {
  readonly eventType: typeof TOKEN_MOVED_PATCH_EVENT_TYPE
  readonly revision: SessionRevision
  readonly opId?: OpId
  readonly payload: MoveTokenPatchPayloadLike
}

interface MoveTokenCurrentStateLike {
  readonly tokenId: string
  readonly mapSlug: string
  readonly position: MoveTokenPosition
  readonly revision?: SessionRevision
}

const isGridCoordinate = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
)

const isMoveTokenPosition = (value: unknown): value is MoveTokenPosition => (
  isRecord(value) &&
  isGridCoordinate(value.x) &&
  isGridCoordinate(value.y) &&
  isGridCoordinate(value.z)
)

const isMoveTokenPatchPayloadLike = (value: unknown): value is MoveTokenPatchPayloadLike => (
  isRecord(value) &&
  typeof value.tokenId === 'string' &&
  value.tokenId.trim().length > 0 &&
  typeof value.mapSlug === 'string' &&
  value.mapSlug.trim().length > 0 &&
  isMoveTokenPosition(value.to) &&
  (value.from === undefined || isMoveTokenPosition(value.from))
)

const isMoveTokenPatchEventLike = (value: unknown): value is MoveTokenPatchEventLike => (
  isRecord(value) &&
  value.eventType === TOKEN_MOVED_PATCH_EVENT_TYPE &&
  isSessionRevision(value.revision) &&
  (value.opId === undefined || isOpId(value.opId)) &&
  isMoveTokenPatchPayloadLike(value.payload)
)

const isMoveTokenCurrentStateLike = (value: unknown): value is MoveTokenCurrentStateLike => (
  isRecord(value) &&
  typeof value.tokenId === 'string' &&
  value.tokenId.trim().length > 0 &&
  typeof value.mapSlug === 'string' &&
  value.mapSlug.trim().length > 0 &&
  isMoveTokenPosition(value.position) &&
  (value.revision === undefined || isSessionRevision(value.revision))
)

const sameSessionId = (left: unknown, right: unknown): boolean => left === right

const tokenOverrideKey = (mapSlug: string, tokenId: string): string => `${mapSlug}\u0000${tokenId}`

export const createMoveTokenCommandMessage = (
  input: CreateMoveTokenCommandMessageInput,
): SessionCommandMessage<MoveTokenCommand> => {
  const issuedAt = input.now?.() ?? defaultClock()
  const tokenResource = {
    kind: 'token',
    tokenId: input.placement.id,
    mapSlug: input.mapSlug,
    sheetKind: input.placement.sheetKind,
    sheetSlug: input.placement.sheetSlug,
  } as const

  const command: MoveTokenCommand = {
    schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
    type: MOVE_TOKEN_COMMAND_TYPE,
    sessionId: input.identity.sessionId,
    actor: sessionActorFromClientIdentity(input.identity),
    opId: input.opId ?? defaultCreateOpId(),
    baseRevision: input.baseRevision,
    scopes: [createMoveTokenCommandScope(tokenResource)],
    payload: {
      tokenId: input.placement.id,
      to: clonePosition(input.to),
    },
    metadata: {
      clientIssuedAt: issuedAt,
      attributes: {
        source: 'map-scene-token-move',
        mapSlug: input.mapSlug,
      },
    },
  }

  return {
    schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
    type: 'command',
    direction: 'client',
    sessionId: input.identity.sessionId,
    command,
  }
}

const defaultSocket = (): SessionMoveTokenSocket => useSessionSocket<
  SessionClientMessage<MoveTokenCommand>,
  SessionServerMessage
>()

const isHelloPendingOnActiveSocket = (
  status: SessionSocketStatus,
  helloStatus: SessionSocketHelloStatus,
): boolean => (
  (status === 'open' || status === 'connecting') &&
  (helloStatus === 'queued' || helloStatus === 'sent')
)

const isHelloAcceptedOnOpenSocket = (
  status: SessionSocketStatus,
  helloStatus: SessionSocketHelloStatus,
): boolean => status === 'open' && helloStatus === 'accepted'

export const useSessionMoveTokenDispatch = (
  options: UseSessionMoveTokenDispatchOptions,
): SessionMoveTokenDispatcher & {
  readonly socket: SessionMoveTokenSocket
  readonly loadRememberedIdentity: () => SessionClientIdentity | null
} => {
  const identityStorage = options.identityStorage ?? sessionClientIdentityStorage
  const socket = options.socket ?? defaultSocket()
  const createOpId = options.createOpId ?? defaultCreateOpId
  const now = options.now ?? defaultClock

  const identity = ref<SessionClientIdentity | null>(identityStorage.load())
  const lastError = ref<string | null>(null)
  const enabled = computed(() => options.enabled.value)
  const optimisticMoves = ref<SessionMoveTokenOptimisticMove[]>([])
  const lastRejection = ref<SessionMoveTokenOptimisticRejection | null>(null)

  const tokenPositionOverrides = computed<readonly SessionMoveTokenPositionOverride[]>(() => {
    const latestByToken = new Map<string, SessionMoveTokenPositionOverride>()
    for (const move of optimisticMoves.value) {
      latestByToken.set(tokenOverrideKey(move.mapSlug, move.tokenId), {
        tokenId: move.tokenId,
        mapSlug: move.mapSlug,
        position: clonePosition(move.position),
        status: move.status,
        opId: move.opId,
        ...(move.currentRevision === undefined ? {} : { revision: move.currentRevision }),
        ...(move.message === undefined ? {} : { message: move.message }),
      })
    }
    return Array.from(latestByToken.values())
  })

  const replaceOptimisticMove = (nextMove: SessionMoveTokenOptimisticMove): void => {
    optimisticMoves.value = [
      ...optimisticMoves.value.filter((move) => move.opId !== nextMove.opId),
      nextMove,
    ]
  }

  const updateOptimisticMove = (
    opId: OpId,
    update: (move: SessionMoveTokenOptimisticMove) => SessionMoveTokenOptimisticMove,
  ): boolean => {
    let updated = false
    optimisticMoves.value = optimisticMoves.value.map((move) => {
      if (move.opId !== opId) return move
      updated = true
      return update(move)
    })
    return updated
  }

  const removeOptimisticMove = (opId: OpId): boolean => {
    const before = optimisticMoves.value.length
    optimisticMoves.value = optimisticMoves.value.filter((move) => move.opId !== opId)
    return optimisticMoves.value.length !== before
  }

  const rollbackOptimisticMove = (opId: OpId, message?: string): boolean => {
    const removed = removeOptimisticMove(opId)
    if (removed && message !== undefined) lastError.value = message
    return removed
  }

  const recordPendingMove = (command: MoveTokenCommand, from: MoveTokenPosition, issuedAt: string): void => {
    replaceOptimisticMove({
      opId: command.opId,
      tokenId: command.payload.tokenId,
      mapSlug: readMaybeRef(options.mapSlug),
      from: clonePosition(from),
      to: clonePosition(command.payload.to),
      position: clonePosition(command.payload.to),
      status: 'pending',
      baseRevision: command.baseRevision,
      issuedAt,
      updatedAt: issuedAt,
    })
  }

  const upsertMoveFromPatchEvent = (
    event: MoveTokenPatchEventLike,
    status: SessionMoveTokenOptimisticStatus,
    message?: string,
  ): boolean => {
    if (event.opId === undefined) return false

    const existing = optimisticMoves.value.find((move) => move.opId === event.opId)
    const updatedAt = now()
    const nextMove: SessionMoveTokenOptimisticMove = {
      opId: event.opId,
      tokenId: event.payload.tokenId,
      mapSlug: event.payload.mapSlug,
      from: existing?.from ?? clonePosition(event.payload.from ?? event.payload.to),
      to: clonePosition(event.payload.to),
      position: clonePosition(event.payload.to),
      status,
      baseRevision: existing?.baseRevision ?? event.revision,
      currentRevision: event.revision,
      issuedAt: existing?.issuedAt ?? updatedAt,
      updatedAt,
      ...(message === undefined ? {} : { message }),
    }
    replaceOptimisticMove(nextMove)
    return true
  }

  const confirmOptimisticMove = (opId: OpId, revision: SessionRevision): boolean => updateOptimisticMove(
    opId,
    (move) => ({
      ...move,
      status: 'confirmed',
      currentRevision: revision,
      position: clonePosition(move.to),
      updatedAt: now(),
    }),
  )

  const reconcileOptimisticMove = (
    opId: OpId,
    state: MoveTokenCurrentStateLike,
    message: string,
    fallbackRevision: SessionRevision,
  ): void => {
    const updatedAt = now()
    const currentRevision = state.revision ?? fallbackRevision
    const reconciled: SessionMoveTokenPositionOverride = {
      tokenId: state.tokenId,
      mapSlug: state.mapSlug,
      position: clonePosition(state.position),
      status: 'reconciled',
      opId,
      revision: currentRevision,
      message,
    }
    const updatedExisting = updateOptimisticMove(opId, (move) => ({
      ...move,
      tokenId: state.tokenId,
      mapSlug: state.mapSlug,
      to: clonePosition(state.position),
      position: clonePosition(state.position),
      status: 'reconciled',
      currentRevision,
      updatedAt,
      message,
    }))

    if (!updatedExisting) {
      replaceOptimisticMove({
        opId,
        tokenId: state.tokenId,
        mapSlug: state.mapSlug,
        from: clonePosition(state.position),
        to: clonePosition(state.position),
        position: clonePosition(state.position),
        status: 'reconciled',
        baseRevision: currentRevision,
        currentRevision,
        issuedAt: updatedAt,
        updatedAt,
        message,
      })
    }

    lastRejection.value = {
      opId,
      tokenId: state.tokenId,
      mapSlug: state.mapSlug,
      reason: 'rejected',
      message,
      currentRevision,
      currentState: reconciled,
    }
  }

  const loadRememberedIdentity = (): SessionClientIdentity | null => {
    identity.value = identityStorage.load()
    return identity.value
  }

  const fail = (
    reason: SessionMoveTokenDispatchFailureReason,
    message: string,
  ): Extract<SessionMoveTokenDispatchResult, { readonly dispatched: false }> => {
    lastError.value = message
    return { dispatched: false, reason, message }
  }

  const ensureSocketHello = (currentIdentity: SessionClientIdentity): SessionMoveTokenDispatchResult | null => {
    if (!socket.connect()) {
      return fail('socket-unavailable', 'Track 2 session WebSocket is not available for moveToken dispatch.')
    }

    const status = socket.status.value
    const helloStatus = socket.helloStatus.value
    if (
      isHelloAcceptedOnOpenSocket(status, helloStatus) ||
      isHelloPendingOnActiveSocket(status, helloStatus)
    ) {
      return null
    }

    const helloResult = socket.sendHello(currentIdentity)
    if (!helloResult.ok) {
      return fail('hello-failed', helloResult.message)
    }

    return null
  }

  const shouldProcessServerMessage = (message: SessionServerMessage): boolean => {
    const currentIdentity = identity.value
    if (currentIdentity === null) return true
    if (!isRecord(message) || !('sessionId' in message)) return true
    return sameSessionId(message.sessionId, currentIdentity.sessionId)
  }

  const handleCommandAck = (message: Extract<SessionServerMessage, { readonly type: 'commandAck' }>): void => {
    const result = message.result
    if (result.commandType !== MOVE_TOKEN_COMMAND_TYPE || !isSessionRevision(result.currentRevision)) return

    const currentRevision = result.currentRevision
    if (result.status === 'accepted') {
      if (!isMoveTokenPatchEventLike(result.event) || !upsertMoveFromPatchEvent(result.event, 'confirmed')) {
        confirmOptimisticMove(result.opId, currentRevision)
      }
      lastError.value = null
      return
    }

    if (result.original.status === 'accepted') {
      confirmOptimisticMove(result.opId, currentRevision)
      lastError.value = null
      return
    }

    rollbackOptimisticMove(
      result.opId,
      `moveToken operation ${result.opId} was already rejected as ${result.original.reason}.`,
    )
  }

  const handleCommandReject = (
    message: Extract<SessionServerMessage, { readonly type: 'commandReject' }>,
  ): void => {
    const result = message.result
    if (result.commandType !== MOVE_TOKEN_COMMAND_TYPE || !isSessionRevision(result.currentRevision)) return

    const currentRevision = result.currentRevision
    lastError.value = result.message
    if ('currentState' in result && isMoveTokenCurrentStateLike(result.currentState)) {
      reconcileOptimisticMove(result.opId, result.currentState, result.message, currentRevision)
      lastRejection.value = {
        opId: result.opId,
        tokenId: result.currentState.tokenId,
        mapSlug: result.currentState.mapSlug,
        reason: result.reason,
        message: result.message,
        currentRevision,
        currentState: tokenPositionOverrides.value.find(
          (override) => override.opId === result.opId,
        ),
      }
      return
    }

    removeOptimisticMove(result.opId)
    lastRejection.value = {
      opId: result.opId,
      reason: result.reason,
      message: result.message,
      currentRevision,
    }
  }

  const handlePatch = (message: Extract<SessionServerMessage, { readonly type: 'patch' }>): void => {
    if (isMoveTokenPatchEventLike(message.event)) {
      upsertMoveFromPatchEvent(message.event, 'confirmed')
    }
  }

  const handleServerMessage = (message: SessionServerMessage): void => {
    if (!shouldProcessServerMessage(message)) return
    if (message.type === 'commandAck') handleCommandAck(message)
    else if (message.type === 'commandReject') handleCommandReject(message)
    else if (message.type === 'patch') handlePatch(message)
  }

  const removeSocketMessageHandler = socket.addMessageHandler?.(handleServerMessage)
  if (getCurrentScope() !== undefined && removeSocketMessageHandler !== undefined) {
    onScopeDispose(removeSocketMessageHandler)
  }

  const dispatchMoveToken = (input: DispatchSessionMoveTokenInput): SessionMoveTokenDispatchResult => {
    if (!enabled.value) {
      lastError.value = null
      return {
        dispatched: false,
        reason: 'not-session-mode',
        message: 'Track 2 session command dispatch is not enabled for this map view.',
      }
    }

    const currentIdentity = identity.value ?? loadRememberedIdentity()
    if (currentIdentity === null) {
      return fail(
        'missing-session-identity',
        'No remembered Track 2 session identity was found; open the session lobby and start or join a session first.',
      )
    }

    if (input.placement === null || input.placement === undefined) {
      return fail('missing-placement', 'Cannot dispatch moveToken because the selected token is no longer on the map.')
    }

    const helloFailure = ensureSocketHello(currentIdentity)
    if (helloFailure !== null) return helloFailure

    const issuedAt = now()
    const commandMessage = createMoveTokenCommandMessage({
      identity: currentIdentity,
      mapSlug: readMaybeRef(options.mapSlug),
      placement: input.placement,
      to: input.to,
      baseRevision: socket.lastKnownRevision.value
        ?? currentIdentity.lastSeenRevision
        ?? INITIAL_SESSION_REVISION,
      opId: createOpId(),
      now: () => issuedAt,
    })

    const sendResult = socket.send(commandMessage)
    if (!sendResult.ok) return fail('send-failed', sendResult.message)

    recordPendingMove(commandMessage.command, input.placement.position, issuedAt)
    lastRejection.value = null
    lastError.value = null
    return {
      dispatched: true,
      command: commandMessage.command,
      message: commandMessage,
      sendResult,
    }
  }

  return {
    enabled,
    identity,
    lastError,
    optimisticMoves,
    tokenPositionOverrides,
    lastRejection,
    socket,
    loadRememberedIdentity,
    dispatchMoveToken,
    handleServerMessage,
    rollbackOptimisticMove,
  }
}
