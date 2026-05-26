import {
  SESSION_HOST_ENABLE_ENV,
  SESSION_HOST_ENABLE_VALUE,
  isSessionHostFlagEnabled,
  type SessionSafetyRuntimeEnv,
} from '#shared/sessionSafety'
import { UseCaseHttpError } from './useCaseErrors'

export {
  SESSION_HOST_ENABLE_ENV,
  SESSION_HOST_ENABLE_VALUE,
} from '#shared/sessionSafety'

export type SessionHostRuntimeEnv = SessionSafetyRuntimeEnv

export class SessionHostDisabledError extends UseCaseHttpError<403> {
  constructor() {
    super(
      403,
      `Track 2 session hosting is disabled. Set ${SESSION_HOST_ENABLE_ENV}=${SESSION_HOST_ENABLE_VALUE} to enable session endpoints.`,
    )
  }
}

export const isSessionHostEnabled = (
  env: SessionHostRuntimeEnv = process.env,
): boolean => isSessionHostFlagEnabled(env)

export const assertSessionHostEnabled = (
  env: SessionHostRuntimeEnv = process.env,
): void => {
  if (!isSessionHostEnabled(env)) {
    throw new SessionHostDisabledError()
  }
}
