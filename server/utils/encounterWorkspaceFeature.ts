import { createError, type H3Event } from 'h3'

const enabledValue = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return true
}

export const requireEncounterWorkspaceFeature = (event: H3Event): void => {
  const config = useRuntimeConfig(event)
  if (enabledValue(config.public.encounterWorkspaceEnabled)) return
  throw createError({ statusCode: 404, statusMessage: 'Encounter Workspace is not enabled.' })
}
