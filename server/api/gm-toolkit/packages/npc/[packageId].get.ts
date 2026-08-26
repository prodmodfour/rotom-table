import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireGm } from '../../../../utils/auth'
import { createSqliteGmNpcGenerationRepository } from '../../../../storage/gmNpcGenerationRepository'

export default defineEventHandler((event) => {
  requireGm(event)
  const packageId = getRouterParam(event, 'packageId') ?? ''
  const record = createSqliteGmNpcGenerationRepository().getByPackageId(packageId)
  if (!record) throw createError({ statusCode: 404, statusMessage: 'NPC package not found.' })
  return { schemaVersion: 1, package: { ...record.result, exactRetry: false } }
})
