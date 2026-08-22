import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { getRotomDatabase } from '../../storage/database'
import { isContestUxMetricId } from '#shared/contests/metrics'
import { createContestUxMetricRepository } from '../../storage/contestUxMetricRepository'

export default defineEventHandler(async (event) => {
  requireAuthRole(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<Record<string, unknown>>(event)
  if (Object.keys(body).some(key => key !== 'schemaVersion' && key !== 'metricId' && key !== 'value') || body.schemaVersion !== 1 || !isContestUxMetricId(body.metricId) || !Number.isSafeInteger(body.value) || Number(body.value) < 0 || Number(body.value) > 3_600_000) {
    throw createError({ statusCode: 400, statusMessage: 'Contest UX metric must contain only one allowed aggregate ID and bounded integer value.' })
  }
  createContestUxMetricRepository(getRotomDatabase()).record({ metricId: body.metricId, value: Number(body.value) })
  return { ok: true }
})
