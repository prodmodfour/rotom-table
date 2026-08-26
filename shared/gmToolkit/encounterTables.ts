import pokedexJson from '../../data/reference/pokedex.json'
import {
  ENCOUNTER_NOTHING_SPECIES,
  type EncounterTableRollEntryObject,
} from '../encounterTables'

export const ENCOUNTER_TABLE_SCHEMA_VERSION = 1 as const
export const ENCOUNTER_TABLE_DOCUMENT_KIND = 'encounter-table' as const
export const ENCOUNTER_TABLE_STATUS_VALUES = ['active', 'archived'] as const
export const ENCOUNTER_TIME_OF_DAY_VALUES = ['dawn', 'day', 'dusk', 'night'] as const
export const ENCOUNTER_WEATHER_VALUES = ['sunny', 'rainy', 'hail', 'sandstorm'] as const
export const ENCOUNTER_GROUP_SIZE_KINDS = ['fixed', 'party-scale'] as const
export const ENCOUNTER_TABLE_PROVENANCE_KINDS = [
  'campaign-authored',
  'legacy-migration',
  'imported',
  'copied',
] as const

export type EncounterTableStatus = typeof ENCOUNTER_TABLE_STATUS_VALUES[number]
export type EncounterTimeOfDay = typeof ENCOUNTER_TIME_OF_DAY_VALUES[number]
export type EncounterWeather = typeof ENCOUNTER_WEATHER_VALUES[number]
export type EncounterGroupSizeKind = typeof ENCOUNTER_GROUP_SIZE_KINDS[number]
export type EncounterTableProvenanceKind = typeof ENCOUNTER_TABLE_PROVENANCE_KINDS[number]

export interface EncounterTablePredicatesV1 {
  readonly timeOfDay: readonly EncounterTimeOfDay[]
  readonly weather: readonly EncounterWeather[]
}

export interface EncounterTableSpeciesRowV1 {
  readonly rowId: string
  readonly kind: 'species'
  readonly speciesId: string
  readonly weight: number
  readonly minLevel: number
  readonly maxLevel: number
  readonly predicates: EncounterTablePredicatesV1
}

export interface EncounterTableNothingRowV1 {
  readonly rowId: string
  readonly kind: 'nothing'
  readonly weight: number
  readonly predicates: EncounterTablePredicatesV1
}

export type EncounterTableRowV1 = EncounterTableSpeciesRowV1 | EncounterTableNothingRowV1

export interface EncounterTableGroupSizePolicyV1 {
  readonly kind: EncounterGroupSizeKind
  readonly minimum: number
  readonly maximum: number
  /** Added to the minimum for each trainer after the first when kind is party-scale. */
  readonly perAdditionalTrainer: number
}

export interface EncounterTableProvenanceV1 {
  readonly kind: EncounterTableProvenanceKind
  readonly sourceLabel: string | null
  readonly sourceSha256: string | null
  readonly sourceTableId: string | null
  readonly sourceRevision: number | null
}

export interface EncounterTableDocumentV1 {
  readonly schemaVersion: typeof ENCOUNTER_TABLE_SCHEMA_VERSION
  readonly documentKind: typeof ENCOUNTER_TABLE_DOCUMENT_KIND
  readonly tableId: string
  readonly revision: number
  readonly status: EncounterTableStatus
  readonly name: string
  readonly environmentTags: readonly string[]
  readonly predicates: EncounterTablePredicatesV1
  readonly rows: readonly EncounterTableRowV1[]
  readonly groupSizePolicy: EncounterTableGroupSizePolicyV1
  readonly notes: string
  readonly provenance: EncounterTableProvenanceV1
  readonly createdAt: string
  readonly updatedAt: string
  readonly archivedAt: string | null
}

export interface EncounterTableLibraryProjectionV1 {
  readonly schemaVersion: 1
  readonly tableId: string
  readonly revision: number
  readonly status: EncounterTableStatus
  readonly name: string
  readonly environmentTags: readonly string[]
  readonly speciesRowCount: number
  readonly nothingWeight: number
  readonly levelRange: { readonly minimum: number; readonly maximum: number }
  readonly updatedAt: string
}

export interface EncounterTableExportV1 {
  readonly exportSchemaVersion: 1
  readonly exportedAt: string
  readonly table: EncounterTableDocumentV1
}

export interface EncounterTableValidationIssue {
  readonly path: string
  readonly code: string
  readonly message: string
}

export class EncounterTableSchemaError extends Error {
  readonly issues: readonly EncounterTableValidationIssue[]

  constructor(issues: readonly EncounterTableValidationIssue[]) {
    super(issues[0]?.message ?? 'Encounter table is invalid')
    this.name = 'EncounterTableSchemaError'
    this.issues = issues
  }
}

const MAX_TABLE_NAME_LENGTH = 80
const MAX_NOTES_LENGTH = 4_000
const MAX_ROWS = 50
const MAX_WEIGHT = 1_000_000
const ID_RE = /^encounter-table:v1:[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/
const ROW_ID_RE = /^encounter-row:v1:[a-z0-9](?:[a-z0-9-]{0,110}[a-z0-9])?$/
const SHA256_RE = /^[a-f0-9]{64}$/

const CANONICAL_SPECIES = new Set<string>(
  (pokedexJson as readonly { readonly species?: unknown }[])
    .map(row => row.species)
    .filter((species): species is string => typeof species === 'string' && species.length > 0),
)

export const CANONICAL_ENCOUNTER_HABITATS = Object.freeze([...new Set(
  (pokedexJson as readonly { readonly habitat?: unknown }[])
    .flatMap(row => Array.isArray(row.habitat) ? row.habitat : [])
    .filter((habitat): habitat is string => typeof habitat === 'string' && habitat.length > 0),
)].sort((left, right) => left.localeCompare(right)))
const CANONICAL_HABITAT_SET = new Set<string>(CANONICAL_ENCOUNTER_HABITATS)

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const hasExactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
  issues: EncounterTableValidationIssue[],
): void => {
  const expected = new Set(keys)
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) issues.push({ path: `${path}.${key}`, code: 'unknown-field', message: `${path}.${key} is not allowed` })
  }
  for (const key of keys) {
    if (!(key in value)) issues.push({ path: `${path}.${key}`, code: 'missing-field', message: `${path}.${key} is required` })
  }
}

const exactString = (
  value: unknown,
  path: string,
  issues: EncounterTableValidationIssue[],
  options: { minimum?: number; maximum?: number; pattern?: RegExp } = {},
): string => {
  if (typeof value !== 'string') {
    issues.push({ path, code: 'invalid-string', message: `${path} must be a string` })
    return ''
  }
  if (value !== value.trim()) issues.push({ path, code: 'untrimmed-string', message: `${path} must not have surrounding whitespace` })
  if (value.length < (options.minimum ?? 0)) issues.push({ path, code: 'string-too-short', message: `${path} is too short` })
  if (value.length > (options.maximum ?? Number.MAX_SAFE_INTEGER)) issues.push({ path, code: 'string-too-long', message: `${path} is too long` })
  if (options.pattern && !options.pattern.test(value)) issues.push({ path, code: 'invalid-format', message: `${path} has an invalid format` })
  return value
}

const exactInteger = (
  value: unknown,
  path: string,
  issues: EncounterTableValidationIssue[],
  minimum: number,
  maximum: number,
): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    issues.push({ path, code: 'invalid-integer', message: `${path} must be an integer from ${minimum} to ${maximum}` })
    return minimum
  }
  return value as number
}

const exactIsoInstant = (value: unknown, path: string, issues: EncounterTableValidationIssue[]): string => {
  const result = exactString(value, path, issues, { minimum: 20, maximum: 30 })
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) {
    issues.push({ path, code: 'invalid-instant', message: `${path} must be a normalized ISO-8601 instant` })
  }
  return result
}

const enumValue = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  issues: EncounterTableValidationIssue[],
): T => {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    issues.push({ path, code: 'invalid-enum', message: `${path} must be one of: ${allowed.join(', ')}` })
    return allowed[0]!
  }
  return value as T
}

const enumArray = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  issues: EncounterTableValidationIssue[],
): T[] => {
  if (!Array.isArray(value)) {
    issues.push({ path, code: 'invalid-array', message: `${path} must be an array` })
    return []
  }
  const result = value.map((entry, index) => enumValue(entry, allowed, `${path}[${index}]`, issues))
  if (new Set(result).size !== result.length) issues.push({ path, code: 'duplicate-value', message: `${path} must not contain duplicates` })
  return result
}

const parsePredicates = (
  value: unknown,
  path: string,
  issues: EncounterTableValidationIssue[],
): EncounterTablePredicatesV1 => {
  if (!isRecord(value)) {
    issues.push({ path, code: 'invalid-object', message: `${path} must be an object` })
    return { timeOfDay: [], weather: [] }
  }
  hasExactKeys(value, ['timeOfDay', 'weather'], path, issues)
  return {
    timeOfDay: enumArray(value.timeOfDay, ENCOUNTER_TIME_OF_DAY_VALUES, `${path}.timeOfDay`, issues),
    weather: enumArray(value.weather, ENCOUNTER_WEATHER_VALUES, `${path}.weather`, issues),
  }
}

const parseRow = (
  value: unknown,
  index: number,
  issues: EncounterTableValidationIssue[],
): EncounterTableRowV1 => {
  const path = `table.rows[${index}]`
  if (!isRecord(value)) {
    issues.push({ path, code: 'invalid-object', message: `${path} must be an object` })
    return { rowId: `encounter-row:v1:invalid-${index}`, kind: 'nothing', weight: 1, predicates: { timeOfDay: [], weather: [] } }
  }
  const kind = enumValue(value.kind, ['species', 'nothing'] as const, `${path}.kind`, issues)
  hasExactKeys(
    value,
    kind === 'species'
      ? ['rowId', 'kind', 'speciesId', 'weight', 'minLevel', 'maxLevel', 'predicates']
      : ['rowId', 'kind', 'weight', 'predicates'],
    path,
    issues,
  )
  const common = {
    rowId: exactString(value.rowId, `${path}.rowId`, issues, { pattern: ROW_ID_RE }),
    weight: exactInteger(value.weight, `${path}.weight`, issues, 1, MAX_WEIGHT),
    predicates: parsePredicates(value.predicates, `${path}.predicates`, issues),
  }
  if (kind === 'nothing') return { ...common, kind }
  const speciesId = exactString(value.speciesId, `${path}.speciesId`, issues, { minimum: 1, maximum: 100 })
  if (!CANONICAL_SPECIES.has(speciesId)) {
    issues.push({ path: `${path}.speciesId`, code: 'unknown-species', message: `${speciesId || 'Species'} is not present in the canonical Pokédex` })
  }
  const minLevel = exactInteger(value.minLevel, `${path}.minLevel`, issues, 1, 100)
  const maxLevel = exactInteger(value.maxLevel, `${path}.maxLevel`, issues, 1, 100)
  if (minLevel > maxLevel) issues.push({ path, code: 'inverted-level-range', message: `${path} minimum level must not exceed maximum level` })
  return { ...common, kind, speciesId, minLevel, maxLevel }
}

const parseGroupSizePolicy = (
  value: unknown,
  issues: EncounterTableValidationIssue[],
): EncounterTableGroupSizePolicyV1 => {
  const path = 'table.groupSizePolicy'
  if (!isRecord(value)) {
    issues.push({ path, code: 'invalid-object', message: `${path} must be an object` })
    return { kind: 'fixed', minimum: 1, maximum: 1, perAdditionalTrainer: 0 }
  }
  hasExactKeys(value, ['kind', 'minimum', 'maximum', 'perAdditionalTrainer'], path, issues)
  const kind = enumValue(value.kind, ENCOUNTER_GROUP_SIZE_KINDS, `${path}.kind`, issues)
  const minimum = exactInteger(value.minimum, `${path}.minimum`, issues, 1, 30)
  const maximum = exactInteger(value.maximum, `${path}.maximum`, issues, 1, 30)
  const perAdditionalTrainer = exactInteger(value.perAdditionalTrainer, `${path}.perAdditionalTrainer`, issues, 0, 30)
  if (minimum > maximum) issues.push({ path, code: 'inverted-group-range', message: `${path} minimum must not exceed maximum` })
  if (kind === 'fixed' && (minimum !== maximum || perAdditionalTrainer !== 0)) {
    issues.push({ path, code: 'invalid-fixed-policy', message: 'Fixed group-size policy requires equal bounds and zero scaling' })
  }
  return { kind, minimum, maximum, perAdditionalTrainer }
}

const parseProvenance = (
  value: unknown,
  issues: EncounterTableValidationIssue[],
): EncounterTableProvenanceV1 => {
  const path = 'table.provenance'
  if (!isRecord(value)) {
    issues.push({ path, code: 'invalid-object', message: `${path} must be an object` })
    return { kind: 'campaign-authored', sourceLabel: null, sourceSha256: null, sourceTableId: null, sourceRevision: null }
  }
  hasExactKeys(value, ['kind', 'sourceLabel', 'sourceSha256', 'sourceTableId', 'sourceRevision'], path, issues)
  const nullableString = (candidate: unknown, field: string, maximum: number): string | null => {
    if (candidate === null) return null
    return exactString(candidate, `${path}.${field}`, issues, { minimum: 1, maximum })
  }
  const sourceSha256 = value.sourceSha256 === null
    ? null
    : exactString(value.sourceSha256, `${path}.sourceSha256`, issues, { pattern: SHA256_RE })
  const sourceTableId = value.sourceTableId === null
    ? null
    : exactString(value.sourceTableId, `${path}.sourceTableId`, issues, { pattern: ID_RE })
  const sourceRevision = value.sourceRevision === null
    ? null
    : exactInteger(value.sourceRevision, `${path}.sourceRevision`, issues, 0, Number.MAX_SAFE_INTEGER)
  if ((sourceTableId === null) !== (sourceRevision === null)) {
    issues.push({ path, code: 'incomplete-source-revision', message: 'sourceTableId and sourceRevision must be present together' })
  }
  return {
    kind: enumValue(value.kind, ENCOUNTER_TABLE_PROVENANCE_KINDS, `${path}.kind`, issues),
    sourceLabel: nullableString(value.sourceLabel, 'sourceLabel', 200),
    sourceSha256,
    sourceTableId,
    sourceRevision,
  }
}

export const parseEncounterTableDocumentV1 = (value: unknown): EncounterTableDocumentV1 => {
  const issues: EncounterTableValidationIssue[] = []
  if (!isRecord(value)) throw new EncounterTableSchemaError([{ path: 'table', code: 'invalid-object', message: 'table must be an object' }])
  hasExactKeys(value, [
    'schemaVersion', 'documentKind', 'tableId', 'revision', 'status', 'name', 'environmentTags',
    'predicates', 'rows', 'groupSizePolicy', 'notes', 'provenance', 'createdAt', 'updatedAt', 'archivedAt',
  ], 'table', issues)
  if (value.schemaVersion !== 1) issues.push({ path: 'table.schemaVersion', code: 'unsupported-version', message: 'table.schemaVersion must be 1' })
  if (value.documentKind !== ENCOUNTER_TABLE_DOCUMENT_KIND) issues.push({ path: 'table.documentKind', code: 'invalid-kind', message: 'table.documentKind must be encounter-table' })

  let environmentTags: string[] = []
  if (!Array.isArray(value.environmentTags)) {
    issues.push({ path: 'table.environmentTags', code: 'invalid-array', message: 'table.environmentTags must be an array' })
  } else {
    environmentTags = value.environmentTags.map((tag, index) => exactString(tag, `table.environmentTags[${index}]`, issues, { minimum: 1, maximum: 40 }))
    for (const tag of environmentTags) {
      if (!CANONICAL_HABITAT_SET.has(tag)) issues.push({ path: 'table.environmentTags', code: 'unknown-habitat', message: `${tag} is not in the canonical Pokédex habitat vocabulary` })
    }
    if (new Set(environmentTags).size !== environmentTags.length) issues.push({ path: 'table.environmentTags', code: 'duplicate-value', message: 'table.environmentTags must not contain duplicates' })
  }

  let rows: EncounterTableRowV1[] = []
  if (!Array.isArray(value.rows) || value.rows.length < 1 || value.rows.length > MAX_ROWS) {
    issues.push({ path: 'table.rows', code: 'invalid-row-count', message: `table.rows must contain from 1 to ${MAX_ROWS} rows` })
  } else {
    rows = value.rows.map((row, index) => parseRow(row, index, issues))
    const rowIds = rows.map(row => row.rowId)
    if (new Set(rowIds).size !== rowIds.length) issues.push({ path: 'table.rows', code: 'duplicate-row-id', message: 'table row IDs must be unique' })
    if (!rows.some(row => row.kind === 'species')) issues.push({ path: 'table.rows', code: 'missing-species-row', message: 'table must contain at least one species row' })
    if (rows.filter(row => row.kind === 'nothing').length > 1) issues.push({ path: 'table.rows', code: 'duplicate-nothing-row', message: 'table may contain at most one Nothing row' })
  }

  const status = enumValue(value.status, ENCOUNTER_TABLE_STATUS_VALUES, 'table.status', issues)
  const createdAt = exactIsoInstant(value.createdAt, 'table.createdAt', issues)
  const updatedAt = exactIsoInstant(value.updatedAt, 'table.updatedAt', issues)
  let archivedAt: string | null = null
  if (value.archivedAt !== null) archivedAt = exactIsoInstant(value.archivedAt, 'table.archivedAt', issues)
  if ((status === 'archived') !== (archivedAt !== null)) {
    issues.push({ path: 'table.archivedAt', code: 'archive-state-mismatch', message: 'archivedAt must be present exactly when status is archived' })
  }
  if (Date.parse(updatedAt) < Date.parse(createdAt)) issues.push({ path: 'table.updatedAt', code: 'invalid-timeline', message: 'updatedAt must not precede createdAt' })

  const parsed: EncounterTableDocumentV1 = {
    schemaVersion: 1,
    documentKind: ENCOUNTER_TABLE_DOCUMENT_KIND,
    tableId: exactString(value.tableId, 'table.tableId', issues, { pattern: ID_RE }),
    revision: exactInteger(value.revision, 'table.revision', issues, 0, Number.MAX_SAFE_INTEGER),
    status,
    name: exactString(value.name, 'table.name', issues, { minimum: 1, maximum: MAX_TABLE_NAME_LENGTH }),
    environmentTags,
    predicates: parsePredicates(value.predicates, 'table.predicates', issues),
    rows,
    groupSizePolicy: parseGroupSizePolicy(value.groupSizePolicy, issues),
    notes: exactString(value.notes, 'table.notes', issues, { maximum: MAX_NOTES_LENGTH }),
    provenance: parseProvenance(value.provenance, issues),
    createdAt,
    updatedAt,
    archivedAt,
  }
  if (issues.length > 0) throw new EncounterTableSchemaError(issues)
  return parsed
}

export const projectEncounterTableForLibrary = (
  table: EncounterTableDocumentV1,
): EncounterTableLibraryProjectionV1 => {
  const speciesRows = table.rows.filter((row): row is EncounterTableSpeciesRowV1 => row.kind === 'species')
  return {
    schemaVersion: 1,
    tableId: table.tableId,
    revision: table.revision,
    status: table.status,
    name: table.name,
    environmentTags: table.environmentTags,
    speciesRowCount: speciesRows.length,
    nothingWeight: table.rows.find(row => row.kind === 'nothing')?.weight ?? 0,
    levelRange: {
      minimum: Math.min(...speciesRows.map(row => row.minLevel)),
      maximum: Math.max(...speciesRows.map(row => row.maxLevel)),
    },
    updatedAt: table.updatedAt,
  }
}

export const encounterTableDocumentToLegacyTable = (
  table: EncounterTableDocumentV1,
): { readonly name: string; readonly min_level: number; readonly max_level: number; readonly entries: readonly EncounterTableRollEntryObject[] } => {
  const speciesRows = table.rows.filter((row): row is EncounterTableSpeciesRowV1 => row.kind === 'species')
  return {
    name: table.name,
    min_level: Math.min(...speciesRows.map(row => row.minLevel)),
    max_level: Math.max(...speciesRows.map(row => row.maxLevel)),
    entries: table.rows.map(row => row.kind === 'nothing'
      ? { weight: row.weight, species: ENCOUNTER_NOTHING_SPECIES }
      : { weight: row.weight, species: row.speciesId, min_level: row.minLevel, max_level: row.maxLevel }),
  }
}

export const stableEncounterTableExport = (
  table: EncounterTableDocumentV1,
  exportedAt: string,
): EncounterTableExportV1 => ({ exportSchemaVersion: 1, exportedAt, table })

export const parseEncounterTableExportV1 = (value: unknown): EncounterTableExportV1 => {
  if (!isRecord(value)) throw new EncounterTableSchemaError([{ path: 'export', code: 'invalid-object', message: 'export must be an object' }])
  const issues: EncounterTableValidationIssue[] = []
  hasExactKeys(value, ['exportSchemaVersion', 'exportedAt', 'table'], 'export', issues)
  if (value.exportSchemaVersion !== 1) issues.push({ path: 'export.exportSchemaVersion', code: 'unsupported-version', message: 'export.exportSchemaVersion must be 1' })
  const exportedAt = exactIsoInstant(value.exportedAt, 'export.exportedAt', issues)
  let table: EncounterTableDocumentV1 | null = null
  try {
    table = parseEncounterTableDocumentV1(value.table)
  } catch (error) {
    if (error instanceof EncounterTableSchemaError) issues.push(...error.issues.map(issue => ({ ...issue, path: `export.${issue.path}` })))
    else throw error
  }
  if (issues.length > 0 || !table) throw new EncounterTableSchemaError(issues)
  return { exportSchemaVersion: 1, exportedAt, table }
}
