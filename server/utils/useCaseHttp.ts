import { createError } from 'h3'
import type { RealtimeEvent } from '#shared/realtime'
import { publishRealtime } from './realtime'
import { isUseCaseHttpErrorLike, type HttpUseCaseErrorLike } from './useCaseErrors'

export type UseCaseRealtimeEvent = Omit<RealtimeEvent, 'timestamp'>

export const isHttpUseCaseError = (error: unknown): error is HttpUseCaseErrorLike => (
  isUseCaseHttpErrorLike(error)
)

export const throwUseCaseHttpError = (error: unknown): never => {
  if (isHttpUseCaseError(error)) {
    throw createError({ statusCode: error.statusCode, statusMessage: error.message })
  }
  throw error
}

export const publishUseCaseRealtimeEvents = (events: Iterable<UseCaseRealtimeEvent>): void => {
  for (const event of events) publishRealtime(event)
}
