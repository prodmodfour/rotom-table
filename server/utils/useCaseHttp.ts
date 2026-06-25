import { createError } from 'h3'
import type { RealtimeEvent } from '#shared/realtime'
import type { RealtimeEventAccess } from '#shared/realtimeEventLog'
import { publishTransientRealtime } from './realtime'
import { isUseCaseHttpErrorLike, type HttpUseCaseErrorLike } from './useCaseErrors'

export type UseCaseRealtimeEvent = Omit<RealtimeEvent, 'timestamp'>

export interface ScopedUseCaseRealtimeEvent {
  readonly event: UseCaseRealtimeEvent
  readonly access: RealtimeEventAccess
}

export const isHttpUseCaseError = (error: unknown): error is HttpUseCaseErrorLike => (
  isUseCaseHttpErrorLike(error)
)

export const throwUseCaseHttpError = (error: unknown): never => {
  if (isHttpUseCaseError(error)) {
    throw createError({ statusCode: error.statusCode, statusMessage: error.message })
  }
  throw error
}

export const publishUseCaseRealtimeEvents = (events: Iterable<ScopedUseCaseRealtimeEvent>): void => {
  for (const publication of events) publishTransientRealtime(publication)
}
