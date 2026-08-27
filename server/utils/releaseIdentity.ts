import type { H3Event } from 'h3'
import { createError } from 'h3'
import { parseReleaseIdentity, type ReleaseIdentity } from '#shared/release/identity'

interface ReleaseRuntimeContext {
  readonly nitro?: {
    readonly runtimeConfig?: {
      readonly public?: { readonly releaseIdentity?: unknown }
    }
  }
}

export const runtimeReleaseIdentity = (event?: H3Event): ReleaseIdentity => {
  const eventConfig = (event?.context as ReleaseRuntimeContext | undefined)?.nitro?.runtimeConfig
  const configured = eventConfig?.public?.releaseIdentity ?? useRuntimeConfig(event).public.releaseIdentity
  const identity = parseReleaseIdentity(configured)
  if (!identity) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Rotom Table release identity is unavailable or inconsistent.',
    })
  }
  return identity
}

export const publicReleaseIdentity = (identity: ReleaseIdentity) => ({
  version: identity.version,
  storageSchemaVersion: identity.storageSchemaVersion,
  build: identity.build,
})
