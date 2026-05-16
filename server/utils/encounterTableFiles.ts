import type { EncounterTable } from '~/types/encounterTable'
import { safeEncounterTablePath } from './encounterGeneration'
import { UseCaseHttpError } from './useCaseErrors'

export class EncounterTableFileError extends UseCaseHttpError<number> {}

export interface ReadEncounterTableFileDependencies {
  encounterRoot: string
  pathExists: (path: string) => boolean
  readTextFile: (path: string) => string
}

export const encounterTableNotFoundMessage = (region: string, tableKey: string): string =>
  `Table ${region ? `${region}/` : ''}${tableKey} not found`

export const readEncounterTableFile = (
  region: string,
  tableKey: string,
  dependencies: ReadEncounterTableFileDependencies,
): EncounterTable => {
  const tablePath = safeEncounterTablePath(dependencies.encounterRoot, region, tableKey)
  if (!dependencies.pathExists(tablePath)) {
    throw new EncounterTableFileError(404, encounterTableNotFoundMessage(region, tableKey))
  }
  return JSON.parse(dependencies.readTextFile(tablePath)) as EncounterTable
}
