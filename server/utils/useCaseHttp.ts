import { createError } from 'h3'
import type { RealtimeEvent } from '~/shared/realtime'
import { publishRealtime } from './realtime'

export interface HttpUseCaseErrorLike extends Error {
  statusCode: number
}

export type UseCaseRealtimeEvent = Omit<RealtimeEvent, 'timestamp'>

export const isHttpUseCaseError = (error: unknown): error is HttpUseCaseErrorLike => (
  error instanceof Error
  && typeof (error as { statusCode?: unknown }).statusCode === 'number'
  && Number.isInteger((error as { statusCode: number }).statusCode)
  && (error as { statusCode: number }).statusCode >= 400
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
