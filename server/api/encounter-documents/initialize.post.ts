import { defineEventHandler, readBody } from 'h3'
import { requireGm } from '../../utils/auth'
import { requireWritableCampaignMode } from '../../utils/http'
import { initializeEncounterDocumentUseCase } from '../../useCases/encounterDocuments'

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()
  return initializeEncounterDocumentUseCase(await readBody<unknown>(event))
})
