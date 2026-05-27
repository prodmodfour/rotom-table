import type {
  PlayerId,
  SessionDisplayName,
  SessionId,
} from '#shared/sessionIdentity'
import type { SessionRevision } from '#shared/sessionRevisions'
import type {
  AuthoritativeSessionState,
  SessionPlayerRecord,
} from '#shared/sessionState'
import { assertSessionHostEnabled, type SessionHostRuntimeEnv } from '../utils/sessionHosting'
import {
  sessionStore,
  type InMemorySessionStore,
  type SessionStoreRecord,
  type SessionStoreStatus,
} from '../utils/sessionStore'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class GetPlayerSessionProfilesUseCaseError<
  TStatusCode extends number = number,
> extends UseCaseHttpError<TStatusCode> {}

export interface GetPlayerSessionProfilesDependencies<TMapDocument = unknown> {
  readonly env?: SessionHostRuntimeEnv
  readonly store?: InMemorySessionStore<AuthoritativeSessionState<TMapDocument>>
}

export interface PlayerSessionProfilesSessionDetails {
  readonly sessionId: SessionId
  readonly status: SessionStoreStatus
  readonly revision: SessionRevision
  readonly createdAt: string
  readonly updatedAt: string
}

export interface PlayerSessionProfileSummary {
  readonly playerId: PlayerId
  readonly displayName: SessionDisplayName
  readonly joinedAt: string
  readonly updatedAt: string
}

export interface GetPlayerSessionProfilesUseCaseResult {
  readonly session: PlayerSessionProfilesSessionDetails | null
  readonly profiles: readonly PlayerSessionProfileSummary[]
}

type ProfileReadableSessionRecord<TMapDocument> = SessionStoreRecord<
  AuthoritativeSessionState<TMapDocument>
> & {
  readonly state: AuthoritativeSessionState<TMapDocument>
}

const getCurrentProfileReadableRecord = <TMapDocument>(
  store: InMemorySessionStore<AuthoritativeSessionState<TMapDocument>>,
): ProfileReadableSessionRecord<TMapDocument> | null => {
  const activeRecords = store.listActive()
  const record = activeRecords[activeRecords.length - 1]
  if (record === undefined) return null

  if (record.state === undefined) {
    throw new GetPlayerSessionProfilesUseCaseError(
      500,
      'The currently running live session has no authoritative state available for player profiles',
    )
  }

  return record as ProfileReadableSessionRecord<TMapDocument>
}

const cloneProfile = (profile: SessionPlayerRecord): PlayerSessionProfileSummary => ({
  playerId: profile.playerId,
  displayName: profile.displayName,
  joinedAt: profile.joinedAt,
  updatedAt: profile.updatedAt,
})

export const getPlayerSessionProfilesUseCase = <TMapDocument = unknown>(
  dependencies: GetPlayerSessionProfilesDependencies<TMapDocument> = {},
): GetPlayerSessionProfilesUseCaseResult => {
  assertSessionHostEnabled(dependencies.env)

  const activeStore = dependencies.store ?? (sessionStore as InMemorySessionStore<
    AuthoritativeSessionState<TMapDocument>
  >)
  const record = getCurrentProfileReadableRecord(activeStore)
  if (record === null) {
    return {
      session: null,
      profiles: [],
    }
  }

  return {
    session: {
      sessionId: record.sessionId,
      status: record.status,
      revision: record.revision,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
    profiles: record.state.players.map(cloneProfile),
  }
}
