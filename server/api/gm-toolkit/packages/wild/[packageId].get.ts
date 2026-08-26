import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireGm } from '../../../../utils/auth'
import { createSqliteGmWildGenerationRepository } from '../../../../storage/gmWildGenerationRepository'

export default defineEventHandler((event) => {
  requireGm(event)
  const packageId = getRouterParam(event, 'packageId') ?? ''
  const record = createSqliteGmWildGenerationRepository().getByPackageId(packageId)
  if (!record) throw createError({ statusCode: 404, statusMessage: 'Generated package not found.' })
  return {
    schemaVersion: 1,
    package: { ...record.result, exactRetry: false },
  }
})
