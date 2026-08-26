import type { EncounterBuilderHandoffProjectionV1 } from '#shared/encounterDocuments/builder'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  encounterBuilderHandoffRepositories,
  EncounterBuilderHandoffError,
  parseEncounterBuilderHandoffReference,
  resolveEncounterBuilderHandoff,
  type EncounterBuilderHandoffRepositories,
} from '../domain/gmToolkit/encounterBuilderHandoff'

export interface LoadEncounterBuilderHandoffDependencies {
  readonly database?: RotomDatabase
  readonly repositories?: EncounterBuilderHandoffRepositories
}

export const loadEncounterBuilderHandoffUseCase = (
  value: unknown,
  dependencies: LoadEncounterBuilderHandoffDependencies = {},
): { readonly schemaVersion: 1; readonly handoff: EncounterBuilderHandoffProjectionV1 } => {
  try {
    const reference = parseEncounterBuilderHandoffReference(value)
    const repositories = dependencies.repositories ?? encounterBuilderHandoffRepositories(dependencies.database ?? getRotomDatabase())
    return Object.freeze({ schemaVersion: 1, handoff: resolveEncounterBuilderHandoff(reference, repositories).projection })
  } catch (error) {
    if (error instanceof EncounterBuilderHandoffError) throw error
    const message = error instanceof Error ? error.message : 'Builder handoff could not be loaded.'
    if (/invalid|malformed/i.test(message)) throw new EncounterBuilderHandoffError(400, message)
    throw error
  }
}
