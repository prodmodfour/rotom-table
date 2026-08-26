import type {
  EncounterTableDocumentV1,
  EncounterTableExportV1,
  EncounterTableLibraryProjectionV1,
} from '#shared/gmToolkit/encounterTables'

export type {
  EncounterTableDocumentV1,
  EncounterTableExportV1,
  EncounterTableGroupSizePolicyV1,
  EncounterTableLibraryProjectionV1,
  EncounterTablePredicatesV1,
  EncounterTableRowV1,
  EncounterTableSpeciesRowV1,
} from '#shared/gmToolkit/encounterTables'

export interface GmEncounterTableListResponseV1 {
  readonly schemaVersion: 1
  readonly tables: readonly EncounterTableLibraryProjectionV1[]
}

export interface GmEncounterTableDetailResponseV1 {
  readonly schemaVersion: 1
  readonly table: EncounterTableDocumentV1
  readonly sourceReview: {
    readonly state: 'not-applicable' | 'migration-bound' | 'current' | 'source-changed' | 'source-missing'
    readonly sourceName: string | null
    readonly sourceRevision: number | null
  }
}

export interface GmEncounterTableMutationResponseV1 {
  readonly schemaVersion: 1
  readonly operationId: string
  readonly commandSha256: string
  readonly commandKind: 'create' | 'update' | 'archive' | 'restore' | 'copy' | 'import'
  readonly table: EncounterTableDocumentV1
  readonly exactRetry: boolean
}

export interface GmEncounterTableDraftV1 {
  name: string
  environmentTags: string[]
  predicates: { timeOfDay: string[]; weather: string[] }
  rows: Array<{
    rowId?: string
    kind: 'species' | 'nothing'
    speciesId?: string
    weight: number
    minLevel?: number
    maxLevel?: number
    predicates: { timeOfDay: string[]; weather: string[] }
  }>
  groupSizePolicy: { kind: 'fixed' | 'party-scale'; minimum: number; maximum: number; perAdditionalTrainer: number }
  notes: string
}

export const gmEncounterTableDocumentToDraft = (table: EncounterTableDocumentV1): GmEncounterTableDraftV1 => ({
  name: table.name,
  environmentTags: [...table.environmentTags],
  predicates: { timeOfDay: [...table.predicates.timeOfDay], weather: [...table.predicates.weather] },
  rows: table.rows.map(row => row.kind === 'nothing'
    ? { rowId: row.rowId, kind: row.kind, weight: row.weight, predicates: { timeOfDay: [...row.predicates.timeOfDay], weather: [...row.predicates.weather] } }
    : {
        rowId: row.rowId,
        kind: row.kind,
        speciesId: row.speciesId,
        weight: row.weight,
        minLevel: row.minLevel,
        maxLevel: row.maxLevel,
        predicates: { timeOfDay: [...row.predicates.timeOfDay], weather: [...row.predicates.weather] },
      }),
  groupSizePolicy: { ...table.groupSizePolicy },
  notes: table.notes,
})

export const gmEncounterTableExportToText = (value: EncounterTableExportV1): string => JSON.stringify(value, null, 2)
