import { computed, ref, type Ref } from 'vue'
import {
  type SessionClientIdentity,
} from '#shared/sessionClientIdentity'
import {
  SESSION_COMMAND_ENVELOPE_VERSION,
  createOpId as defaultCreateOpId,
  type OpId,
} from '#shared/sessionCommands'
import {
  SESSION_MESSAGE_SCHEMA_VERSION,
  type SessionClientMessage,
  type SessionCommandMessage,
  type SessionServerMessage,
} from '#shared/sessionMessages'
import type { SessionActor } from '#shared/sessionPermissions'
import { INITIAL_SESSION_REVISION, type SessionRevision } from '#shared/sessionRevisions'
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
  readonly placement: Pick<SheetPlacement, 'id' | 'sheetKind' | 'sheetSlug'> | null | undefined
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

export interface SessionMoveTokenDispatcher {
  readonly enabled: BooleanRef
  readonly identity: Ref<SessionClientIdentity | null>
  readonly lastError: Ref<string | null>
  dispatchMoveToken(input: DispatchSessionMoveTokenInput): SessionMoveTokenDispatchResult
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

    const commandMessage = createMoveTokenCommandMessage({
      identity: currentIdentity,
      mapSlug: readMaybeRef(options.mapSlug),
      placement: input.placement,
      to: input.to,
      baseRevision: socket.lastKnownRevision.value
        ?? currentIdentity.lastSeenRevision
        ?? INITIAL_SESSION_REVISION,
      opId: createOpId(),
      now,
    })

    const sendResult = socket.send(commandMessage)
    if (!sendResult.ok) return fail('send-failed', sendResult.message)

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
    socket,
    loadRememberedIdentity,
    dispatchMoveToken,
  }
}
