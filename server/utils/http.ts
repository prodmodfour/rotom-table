import { createError, readBody, type H3Event } from 'h3'
import { isSheetKind, type SheetKind } from '#shared/sheets'
import { sanitizeFolderPath, validateSlug, type SanitizeFolderPathOptions } from '#shared/paths'

export const badRequest = (statusMessage: string): never => {
  throw createError({ statusCode: 400, statusMessage })
}

export const forbidden = (statusMessage: string): never => {
  throw createError({ statusCode: 403, statusMessage })
}

export const notFound = (statusMessage: string): never => {
  throw createError({ statusCode: 404, statusMessage })
}

export const conflict = (statusMessage: string): never => {
  throw createError({ statusCode: 409, statusMessage })
}

export const HOSTED_WRITES_FLAG = 'ROTOM_ENABLE_HOSTED_WRITES'

export const HOSTED_WRITES_DISABLED_MESSAGE =
  `Hosted campaign writes, including database-backed live-play commands, are disabled in production. Set ${HOSTED_WRITES_FLAG}=1 only for a private trusted-table host.`

type WritableCampaignEnv = Readonly<Record<string, string | undefined>>

export const areHostedWritesEnabled = (env: WritableCampaignEnv = process.env): boolean => (
  env[HOSTED_WRITES_FLAG] === '1'
)

export const isWritableCampaignMode = (env: WritableCampaignEnv = process.env): boolean => (
  env.NODE_ENV !== 'production' || areHostedWritesEnabled(env)
)

export const requireWritableCampaignMode = (env: WritableCampaignEnv = process.env): void => {
  if (!isWritableCampaignMode(env)) forbidden(HOSTED_WRITES_DISABLED_MESSAGE)
}


export const readObjectBody = async <T extends object = Record<string, unknown>>(
  event: H3Event,
): Promise<T> => {
  const body = await readBody<unknown>(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)) badRequest('request body must be an object')
  return body as T
}

export const expectString = (
  value: unknown,
  label: string,
  options: { trim?: boolean; required?: boolean; maxLength?: number } = {},
): string => {
  const { trim = true, required = true, maxLength } = options
  const out = trim ? String(value ?? '').trim() : String(value ?? '')
  if (required && !out) badRequest(`${label} is required`)
  if (maxLength !== undefined && out.length > maxLength) badRequest(`${label} too long (max ${maxLength} chars)`)
  return out
}

export const expectSlug = (value: unknown, label = 'slug'): string => {
  try {
    return validateSlug(value, label)
  } catch (err) {
    return badRequest((err as Error).message)
  }
}

export const expectSheetKind = (value: unknown): SheetKind => {
  if (!isSheetKind(value)) badRequest('kind must be "pokemon" or "trainer"')
  return value as SheetKind
}

export const expectFolderPath = (
  value: unknown,
  options: SanitizeFolderPathOptions = {},
): string => {
  try {
    return sanitizeFolderPath(String(value ?? ''), options)
  } catch (err) {
    return badRequest((err as Error).message)
  }
}

export const expectRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) badRequest(`${label} must be an object`)
  return value as Record<string, unknown>
}
