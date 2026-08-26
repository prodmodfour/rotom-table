import { defineEventHandler, getQuery } from 'h3'
import { requireGm } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { loadEncounterBuilderHandoffUseCase } from '../../useCases/loadEncounterBuilderHandoff'

export default defineEventHandler((event) => {
  requireGm(event)
  const query = getQuery(event)
  try {
    return loadEncounterBuilderHandoffUseCase({
      kind: query.kind,
      documentId: query.documentId,
      expectedRevision: typeof query.expectedRevision === 'string' && /^\d+$/.test(query.expectedRevision) ? Number(query.expectedRevision) : query.expectedRevision,
      sceneId: query.sceneId ?? null,
    })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
