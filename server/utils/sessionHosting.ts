import { UseCaseHttpError } from './useCaseErrors'

export const SESSION_HOST_ENABLE_ENV = 'ROTOM_ENABLE_SESSION_HOST' as const
export const SESSION_HOST_ENABLE_VALUE = '1' as const

export type SessionHostRuntimeEnv = Record<string, string | undefined>

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
): boolean => env[SESSION_HOST_ENABLE_ENV] === SESSION_HOST_ENABLE_VALUE

export const assertSessionHostEnabled = (
  env: SessionHostRuntimeEnv = process.env,
): void => {
  if (!isSessionHostEnabled(env)) {
    throw new SessionHostDisabledError()
  }
}
