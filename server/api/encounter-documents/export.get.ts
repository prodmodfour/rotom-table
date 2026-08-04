import { defineEventHandler, getQuery, setHeader } from 'h3'
import { requireGm } from '../../utils/auth'
import { exportEncounterDocumentUseCase } from '../../useCases/encounterDocuments'

export default defineEventHandler((event) => {
  requireGm(event)
  const result = exportEncounterDocumentUseCase(getQuery(event).encounterId)
  setHeader(event, 'content-type', 'application/json; charset=utf-8')
  setHeader(event, 'content-disposition', `attachment; filename="${result.document.encounterId}.encounter.json"`)
  setHeader(event, 'cache-control', 'private, no-store')
  return result
})
