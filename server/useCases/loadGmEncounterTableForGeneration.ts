import { encounterTableDocumentToLegacyTable } from '#shared/gmToolkit/encounterTables'
import { createSqliteGmEncounterTableRepository } from '../storage/gmEncounterTableRepository'
import type { RotomDatabase } from '../storage/database'
import type { EncounterTable } from '~/types/encounterTable'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export const loadGmEncounterTableForGeneration = (
  tableId: string,
  database: RotomDatabase,
): EncounterTable => {
  const table = createSqliteGmEncounterTableRepository(database).get(tableId)
  if (!table || table.status !== 'active') {
    throw new UseCaseHttpError(404, 'The campaign encounter table is unavailable or archived.')
  }
  const legacy = encounterTableDocumentToLegacyTable(table)
  return { ...legacy, entries: [...legacy.entries] }
}
