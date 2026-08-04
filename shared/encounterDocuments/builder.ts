import { ENCOUNTER_RECIPE_IDS, type EncounterRecipeId } from './model'

export const ENCOUNTER_BUILDER_SCHEMA_VERSION = 1 as const
export const ENCOUNTER_BUILDER_MAX_CAST = 30 as const

export interface EncounterBuilderCastMember {
  readonly castId: string
  readonly species: string
  readonly level: number
  readonly roll: number
  readonly sideId: string | null
  readonly role: 'boss' | 'leader' | 'standard' | 'minion' | 'support'
  readonly hidden: boolean
}

export interface LaunchEncounterBuilderRequest {
  readonly schemaVersion: typeof ENCOUNTER_BUILDER_SCHEMA_VERSION
  readonly launchId: string
  readonly encounterId: string
  readonly name: string
  readonly recipe: EncounterRecipeId
  readonly mapSlug: string
  readonly clientId: string | null
  readonly startInitiative: boolean
  readonly presentation: {
    readonly stage: 'standard' | 'boss' | 'chase'
    readonly tactical: 'on-demand' | 'split'
  }
  readonly source: {
    readonly region: string
    readonly table: string
    readonly outRoot: string
  }
  readonly cast: readonly EncounterBuilderCastMember[]
  readonly publicStakes: string | null
  readonly gmStakes: string | null
  readonly notes: string | null
}

export interface LaunchEncounterBuilderResult {
  readonly ok: true
  readonly launchId: string
  readonly encounterId: string
  readonly encounterRevision: number
  readonly mapSlug: string
  readonly mapRevision: number
  readonly spawned: number
}

export class EncounterBuilderValidationError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'EncounterBuilderValidationError'
  }
}
const fail = (path: string, message: string): never => { throw new EncounterBuilderValidationError(path, message) }
const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(path, 'must be an object')
  return value as Record<string, unknown>
}
const exact = (value: Record<string, unknown>, keys: readonly string[], path: string): void => {
  const expected = new Set(keys)
  if (Object.keys(value).length !== expected.size || Object.keys(value).some(key => !expected.has(key))) fail(path, 'has unsupported or missing fields')
}
const id = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(value)) return fail(path, 'must be a stable ID')
  return value
}
const text = (value: unknown, path: string, maximum: number, nullable = false): string | null => {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) return fail(path, `must be bounded text of at most ${maximum} characters`)
  return value.trim()
}
const integer = (value: unknown, path: string, minimum: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) return fail(path, `must be an integer from ${minimum} to ${maximum}`)
  return Number(value)
}

export const parseLaunchEncounterBuilderResult = (value: unknown): LaunchEncounterBuilderResult => {
  const root = record(value, 'builderResult')
  exact(root, ['ok', 'launchId', 'encounterId', 'encounterRevision', 'mapSlug', 'mapRevision', 'spawned'], 'builderResult')
  if (root.ok !== true) fail('builderResult.ok', 'must be true')
  return Object.freeze({
    ok: true,
    launchId: id(root.launchId, 'builderResult.launchId'),
    encounterId: id(root.encounterId, 'builderResult.encounterId'),
    encounterRevision: integer(root.encounterRevision, 'builderResult.encounterRevision', 0, Number.MAX_SAFE_INTEGER),
    mapSlug: id(root.mapSlug, 'builderResult.mapSlug'),
    mapRevision: integer(root.mapRevision, 'builderResult.mapRevision', 0, Number.MAX_SAFE_INTEGER),
    spawned: integer(root.spawned, 'builderResult.spawned', 0, ENCOUNTER_BUILDER_MAX_CAST),
  })
}

export const parseLaunchEncounterBuilderRequest = (value: unknown): LaunchEncounterBuilderRequest => {
  const root = record(value, 'builder')
  exact(root, ['schemaVersion', 'launchId', 'encounterId', 'name', 'recipe', 'mapSlug', 'clientId', 'startInitiative', 'presentation', 'source', 'cast', 'publicStakes', 'gmStakes', 'notes'], 'builder')
  if (root.schemaVersion !== ENCOUNTER_BUILDER_SCHEMA_VERSION) fail('builder.schemaVersion', 'is unsupported')
  if (typeof root.recipe !== 'string' || !ENCOUNTER_RECIPE_IDS.includes(root.recipe as EncounterRecipeId)) fail('builder.recipe', 'is unknown')
  if (typeof root.startInitiative !== 'boolean') fail('builder.startInitiative', 'must be a boolean')
  const presentation = record(root.presentation, 'builder.presentation')
  exact(presentation, ['stage', 'tactical'], 'builder.presentation')
  if (!['standard', 'boss', 'chase'].includes(String(presentation.stage))) fail('builder.presentation.stage', 'is unknown')
  if (!['on-demand', 'split'].includes(String(presentation.tactical))) fail('builder.presentation.tactical', 'is unknown')
  const source = record(root.source, 'builder.source')
  exact(source, ['region', 'table', 'outRoot'], 'builder.source')
  const castInput = root.cast
  if (!Array.isArray(castInput)) fail('builder.cast', 'must be an array')
  const castArray = castInput as unknown[]
  if (castArray.length < 1 || castArray.length > ENCOUNTER_BUILDER_MAX_CAST) fail('builder.cast', `must contain 1 to ${ENCOUNTER_BUILDER_MAX_CAST} members`)
  const cast: EncounterBuilderCastMember[] = castArray.map((entry: unknown, index: number): EncounterBuilderCastMember => {
    const row = record(entry, `builder.cast[${index}]`)
    exact(row, ['castId', 'species', 'level', 'roll', 'sideId', 'role', 'hidden'], `builder.cast[${index}]`)
    if (!['boss', 'leader', 'standard', 'minion', 'support'].includes(String(row.role))) fail(`builder.cast[${index}].role`, 'is unknown')
    if (typeof row.hidden !== 'boolean') fail(`builder.cast[${index}].hidden`, 'must be a boolean')
    return Object.freeze({
      castId: id(row.castId, `builder.cast[${index}].castId`),
      species: text(row.species, `builder.cast[${index}].species`, 200)!,
      level: integer(row.level, `builder.cast[${index}].level`, 1, 100),
      roll: integer(row.roll, `builder.cast[${index}].roll`, 1, Number.MAX_SAFE_INTEGER),
      sideId: row.sideId === null ? null : id(row.sideId, `builder.cast[${index}].sideId`),
      role: row.role as EncounterBuilderCastMember['role'],
      hidden: row.hidden as boolean,
    })
  })
  if (new Set(cast.map((member: EncounterBuilderCastMember) => member.castId)).size !== cast.length) fail('builder.cast', 'contains duplicate cast IDs')
  return Object.freeze({
    schemaVersion: ENCOUNTER_BUILDER_SCHEMA_VERSION,
    launchId: id(root.launchId, 'builder.launchId'),
    encounterId: id(root.encounterId, 'builder.encounterId'),
    name: text(root.name, 'builder.name', 200)!,
    recipe: root.recipe as EncounterRecipeId,
    mapSlug: id(root.mapSlug, 'builder.mapSlug'),
    clientId: root.clientId === null ? null : id(root.clientId, 'builder.clientId'),
    startInitiative: root.startInitiative as boolean,
    presentation: Object.freeze({
      stage: presentation.stage as LaunchEncounterBuilderRequest['presentation']['stage'],
      tactical: presentation.tactical as LaunchEncounterBuilderRequest['presentation']['tactical'],
    }),
    source: Object.freeze({
      region: text(source.region, 'builder.source.region', 200)!,
      table: id(source.table, 'builder.source.table'),
      outRoot: text(source.outRoot, 'builder.source.outRoot', 500)!,
    }),
    cast: Object.freeze(cast),
    publicStakes: text(root.publicStakes, 'builder.publicStakes', 4_000, true),
    gmStakes: text(root.gmStakes, 'builder.gmStakes', 4_000, true),
    notes: text(root.notes, 'builder.notes', 20_000, true),
  })
}
