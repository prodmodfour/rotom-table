import type { CanonicalAbilityCatalog } from './ruleset'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_PARAMETER_DEFINITION_SCHEMA_VERSION = 1 as const
export const ABILITY_INSTANCE_DATA_SCHEMA_VERSION = 1 as const
export const ABILITY_PARAMETER_ACQUISITION_KINDS = [
  'sheet-choice',
  'server-roll',
  'inherited-or-server-roll',
] as const
export type AbilityParameterAcquisition = (typeof ABILITY_PARAMETER_ACQUISITION_KINDS)[number]

export interface AbilityParameterDefinition {
  readonly id: string
  readonly acquisition: AbilityParameterAcquisition
  readonly minSelections: number
  readonly maxSelections: number
  readonly optionIds: readonly string[]
}

export interface AbilityParameterDefinitionEntry {
  readonly canonicalId: string
  readonly definitionVersion: number
  readonly sourceField: 'effect' | 'trigger'
  readonly sourcePhrase: string
  readonly parameters: readonly AbilityParameterDefinition[]
}

export interface AbilityParameterDefinitionCatalog {
  readonly schemaVersion: typeof ABILITY_PARAMETER_DEFINITION_SCHEMA_VERSION
  readonly sourceDataSha256: string
  readonly entries: readonly AbilityParameterDefinitionEntry[]
}

export interface AbilityInstanceParameterSelection {
  readonly parameterId: string
  readonly optionIds: readonly string[]
}

/** Lasting sheet-owned identity and canonical choices; display labels are absent by design. */
export interface AbilityInstanceData {
  readonly schemaVersion: typeof ABILITY_INSTANCE_DATA_SCHEMA_VERSION
  readonly instanceId: string
  readonly canonicalId: string
  readonly definitionVersion: number | null
  readonly selections: readonly AbilityInstanceParameterSelection[]
}

export type AbilityInstanceParameterStatus = 'ready' | 'missing-required-data' | 'not-parameterized'

export interface ResolvedAbilityInstanceData {
  readonly status: AbilityInstanceParameterStatus
  readonly data: AbilityInstanceData | null
}

export type AbilityParameterValidationCode =
  | 'invalid-definition-catalog'
  | 'invalid-instance-data'
  | 'source-mismatch'
  | 'unknown-ability'
  | 'duplicate-id'
  | 'missing-parameter'
  | 'unknown-option'
  | 'version-mismatch'
  | 'limit-exceeded'
  | 'not-json'

export class AbilityParameterValidationError extends Error {
  readonly code: AbilityParameterValidationCode
  readonly path: string

  constructor(code: AbilityParameterValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityParameterValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const ROOT_FIELDS = ['schemaVersion', 'sourceDataSha256', 'entries'] as const
const ENTRY_FIELDS = [
  'canonicalId', 'definitionVersion', 'sourceField', 'sourcePhrase', 'parameters',
] as const
const DEFINITION_FIELDS = [
  'id', 'acquisition', 'minSelections', 'maxSelections', 'optionIds',
] as const
const INSTANCE_FIELDS = [
  'schemaVersion', 'instanceId', 'canonicalId', 'definitionVersion', 'selections',
] as const
const SELECTION_FIELDS = ['parameterId', 'optionIds'] as const
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const ACQUISITION_SET = new Set<string>(ABILITY_PARAMETER_ACQUISITION_KINDS)

const fail = (code: AbilityParameterValidationCode, path: string, detail: string): never => {
  throw new AbilityParameterValidationError(code, path, detail)
}

const clone = (value: unknown, path: string) => cloneStrictJson(value, path, {
  limits: {
    depth: 7,
    nodes: 8_192,
    objectFields: 12,
    arrayEntries: 256,
    stringLength: 1_000,
    objectKeyLength: 160,
  },
  rootLabel: 'ability parameter data',
  valueLabel: 'ability parameter data',
  failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
  failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
})

const record = (value: unknown, path: string, code: AbilityParameterValidationCode): UnknownRecord => {
  if (!isPlainJsonObject(value)) return fail(code, path, 'must be an object.')
  return value
}

const exact = (
  value: UnknownRecord,
  fields: readonly string[],
  path: string,
  code: AbilityParameterValidationCode,
): void => {
  const expected = new Set(fields)
  if (
    fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))
    || Object.keys(value).some(field => !expected.has(field))
  ) fail(code, path, 'has an invalid shape.')
}

const text = (value: unknown, path: string, maximum: number): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) return fail('invalid-instance-data', path, 'must be bounded trimmed text.')
  return value
}

const stableId = (value: unknown, path: string): string => {
  const id = text(value, path, 160)
  if (!STABLE_ID_PATTERN.test(id)) fail('invalid-instance-data', path, 'must be a stable ID.')
  return id
}

const positiveVersion = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 1_000) {
    return fail('invalid-definition-catalog', path, 'must be a bounded positive version.')
  }
  return Number(value)
}

const selectionCount = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 64) {
    return fail('invalid-definition-catalog', path, 'must be an integer from 0 through 64.')
  }
  return Number(value)
}

const parseDefinition = (value: unknown, path: string): AbilityParameterDefinition => {
  const input = record(value, path, 'invalid-definition-catalog')
  exact(input, DEFINITION_FIELDS, path, 'invalid-definition-catalog')
  if (typeof input.acquisition !== 'string' || !ACQUISITION_SET.has(input.acquisition)) {
    fail('invalid-definition-catalog', `${path}.acquisition`, 'is unsupported.')
  }
  const minSelections = selectionCount(input.minSelections, `${path}.minSelections`)
  const maxSelections = selectionCount(input.maxSelections, `${path}.maxSelections`)
  if (minSelections > maxSelections || maxSelections === 0) {
    fail('invalid-definition-catalog', path, 'selection bounds are invalid.')
  }
  if (!Array.isArray(input.optionIds) || input.optionIds.length < maxSelections || input.optionIds.length > 128) {
    fail('limit-exceeded', `${path}.optionIds`, 'must contain enough bounded options.')
  }
  const optionIds = (input.optionIds as readonly unknown[]).map((option, index) => (
    stableId(option, `${path}.optionIds[${index}]`)
  ))
  if (new Set(optionIds).size !== optionIds.length) {
    fail('duplicate-id', `${path}.optionIds`, 'must not repeat options.')
  }
  return Object.freeze({
    id: stableId(input.id, `${path}.id`),
    acquisition: input.acquisition as AbilityParameterAcquisition,
    minSelections,
    maxSelections,
    optionIds: Object.freeze(optionIds),
  })
}

export const parseAbilityParameterDefinitionCatalog = (
  value: unknown,
  canonical: CanonicalAbilityCatalog,
): AbilityParameterDefinitionCatalog => {
  const input = record(clone(value, 'parameterDefinitions'), 'parameterDefinitions', 'invalid-definition-catalog')
  exact(input, ROOT_FIELDS, 'parameterDefinitions', 'invalid-definition-catalog')
  if (input.schemaVersion !== ABILITY_PARAMETER_DEFINITION_SCHEMA_VERSION) {
    fail('invalid-definition-catalog', 'parameterDefinitions.schemaVersion', 'is unsupported.')
  }
  if (
    typeof input.sourceDataSha256 !== 'string'
    || !SHA256_PATTERN.test(input.sourceDataSha256)
    || input.sourceDataSha256 !== canonical.sourceDataSha256
  ) fail('source-mismatch', 'parameterDefinitions.sourceDataSha256', 'must match canonical data.')
  if (!Array.isArray(input.entries) || input.entries.length > 128) {
    fail('limit-exceeded', 'parameterDefinitions.entries', 'must be a bounded array.')
  }
  const canonicalById = new Map(canonical.abilities.map((ability, index) => [
    ability.canonicalId,
    { ability, index },
  ]))
  const entries = (input.entries as readonly unknown[]).map((value, index): AbilityParameterDefinitionEntry => {
    const path = `parameterDefinitions.entries[${index}]`
    const row = record(value, path, 'invalid-definition-catalog')
    exact(row, ENTRY_FIELDS, path, 'invalid-definition-catalog')
    const canonicalId = text(row.canonicalId, `${path}.canonicalId`, 160)
    const source = canonicalById.get(canonicalId)
      ?? fail('unknown-ability', `${path}.canonicalId`, 'is not canonical.')
    if (row.sourceField !== 'effect' && row.sourceField !== 'trigger') {
      fail('invalid-definition-catalog', `${path}.sourceField`, 'must be effect or trigger.')
    }
    const sourceField = row.sourceField as 'effect' | 'trigger'
    const sourcePhrase = text(row.sourcePhrase, `${path}.sourcePhrase`, 1_000)
    if (!source.ability.source[sourceField]?.includes(sourcePhrase)) {
      fail('source-mismatch', `${path}.sourcePhrase`, 'must occur in canonical source text.')
    }
    if (!Array.isArray(row.parameters) || row.parameters.length === 0 || row.parameters.length > 32) {
      fail('limit-exceeded', `${path}.parameters`, 'must be a bounded non-empty array.')
    }
    const parameters = (row.parameters as readonly unknown[]).map((parameter, parameterIndex) => (
      parseDefinition(parameter, `${path}.parameters[${parameterIndex}]`)
    ))
    const ids = parameters.map(parameter => parameter.id)
    if (new Set(ids).size !== ids.length) {
      fail('duplicate-id', `${path}.parameters`, 'must not repeat parameter IDs.')
    }
    if (ids.some((id, idIndex) => idIndex > 0 && id <= ids[idIndex - 1]!)) {
      fail('invalid-definition-catalog', `${path}.parameters`, 'must use code-point parameter order.')
    }
    return Object.freeze({
      canonicalId,
      definitionVersion: positiveVersion(row.definitionVersion, `${path}.definitionVersion`),
      sourceField,
      sourcePhrase,
      parameters: Object.freeze(parameters),
    })
  })
  if (new Set(entries.map(entry => entry.canonicalId)).size !== entries.length) {
    fail('duplicate-id', 'parameterDefinitions.entries', 'must not repeat abilities.')
  }
  if (entries.some((entry, index) => index > 0 && (
    canonicalById.get(entry.canonicalId)!.index
      <= canonicalById.get(entries[index - 1]!.canonicalId)!.index
  ))) fail('invalid-definition-catalog', 'parameterDefinitions.entries', 'must use canonical order.')
  return deepFreezeStrictJson({
    schemaVersion: ABILITY_PARAMETER_DEFINITION_SCHEMA_VERSION,
    sourceDataSha256: input.sourceDataSha256 as string,
    entries,
  })
}

export const abilityParameterDefinitionFor = (
  catalog: AbilityParameterDefinitionCatalog,
  canonicalId: string,
): AbilityParameterDefinitionEntry | null => (
  catalog.entries.find(entry => entry.canonicalId === canonicalId) ?? null
)

export const parseAbilityInstanceData = (
  value: unknown,
  canonicalId: string,
  catalog: AbilityParameterDefinitionCatalog,
): AbilityInstanceData => {
  const path = `abilityInstance.${canonicalId}`
  const input = record(clone(value, path), path, 'invalid-instance-data')
  exact(input, INSTANCE_FIELDS, path, 'invalid-instance-data')
  if (input.schemaVersion !== ABILITY_INSTANCE_DATA_SCHEMA_VERSION || input.canonicalId !== canonicalId) {
    fail('invalid-instance-data', path, 'schema or canonical identity does not match.')
  }
  const definition = abilityParameterDefinitionFor(catalog, canonicalId)
  if (!definition) {
    if (input.definitionVersion !== null || !Array.isArray(input.selections) || input.selections.length > 0) {
      fail('invalid-instance-data', path, 'unparameterized ability must have no definition or selections.')
    }
  }
  else if (input.definitionVersion !== definition.definitionVersion) {
    fail('version-mismatch', `${path}.definitionVersion`, 'does not match the reviewed definition.')
  }
  if (!Array.isArray(input.selections) || input.selections.length > 32) {
    fail('limit-exceeded', `${path}.selections`, 'must be a bounded array.')
  }
  const selections = (input.selections as readonly unknown[]).map((value, index): AbilityInstanceParameterSelection => {
    const selectionPath = `${path}.selections[${index}]`
    const row = record(value, selectionPath, 'invalid-instance-data')
    exact(row, SELECTION_FIELDS, selectionPath, 'invalid-instance-data')
    const parameterId = stableId(row.parameterId, `${selectionPath}.parameterId`)
    const parameter = definition?.parameters.find(candidate => candidate.id === parameterId)
      ?? fail('missing-parameter', `${selectionPath}.parameterId`, 'is not in the reviewed definition.')
    if (!Array.isArray(row.optionIds)
      || row.optionIds.length < parameter.minSelections
      || row.optionIds.length > parameter.maxSelections) {
      fail('invalid-instance-data', `${selectionPath}.optionIds`, 'does not satisfy selection bounds.')
    }
    const optionIds = (row.optionIds as readonly unknown[]).map((option, optionIndex) => (
      stableId(option, `${selectionPath}.optionIds[${optionIndex}]`)
    ))
    if (new Set(optionIds).size !== optionIds.length) {
      fail('duplicate-id', `${selectionPath}.optionIds`, 'must not repeat options.')
    }
    const optionIndexes = optionIds.map(optionId => {
      const optionIndex = parameter.optionIds.indexOf(optionId)
      if (optionIndex < 0) fail('unknown-option', `${selectionPath}.optionIds`, `unknown option ${optionId}.`)
      return optionIndex
    })
    if (optionIndexes.some((optionIndex, index) => index > 0 && optionIndex <= optionIndexes[index - 1]!)) {
      fail('invalid-instance-data', `${selectionPath}.optionIds`, 'must use reviewed option order.')
    }
    return Object.freeze({ parameterId, optionIds: Object.freeze(optionIds) })
  })
  if (definition) {
    const expectedIds = definition.parameters.map(parameter => parameter.id)
    if (
      selections.length !== expectedIds.length
      || selections.some((selection, index) => selection.parameterId !== expectedIds[index])
    ) fail('missing-parameter', `${path}.selections`, 'must contain every parameter in definition order.')
  }
  return deepFreezeStrictJson({
    schemaVersion: ABILITY_INSTANCE_DATA_SCHEMA_VERSION,
    instanceId: stableId(input.instanceId, `${path}.instanceId`),
    canonicalId,
    definitionVersion: definition?.definitionVersion ?? null,
    selections,
  })
}

export const resolveAbilityInstanceData = (
  value: unknown,
  canonicalId: string,
  catalog: AbilityParameterDefinitionCatalog,
): ResolvedAbilityInstanceData => {
  const definition = abilityParameterDefinitionFor(catalog, canonicalId)
  if (value === undefined || value === null) {
    return Object.freeze({
      status: definition ? 'missing-required-data' : 'not-parameterized',
      data: null,
    })
  }
  const data = parseAbilityInstanceData(value, canonicalId, catalog)
  return Object.freeze({
    status: definition ? 'ready' : 'not-parameterized',
    data,
  })
}

export const abilityInstanceParameterValues = (
  data: AbilityInstanceData,
  parameterId: string,
): readonly string[] => data.selections.find(selection => (
  selection.parameterId === parameterId
))?.optionIds ?? Object.freeze([])
