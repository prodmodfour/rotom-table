import abilitiesJson from '../../data/reference/abilities.json'
import movesJson from '../../data/reference/moves.json'
import pokedexJson from '../../data/reference/pokedex.json'
import { isCanonicalFeatureId, normalizedFeatureIdentityKey, parseFeatureLabel } from './catalog'
import { isCanonicalEdgeId } from '../edgeAutomation/catalog'
import { FEATURE_AUTOMATION_MANIFEST_BY_ID, type FeatureChoiceDefinition } from './manifest'

export const FEATURE_INSTANCE_SCHEMA_VERSION = 1 as const
export const FEATURE_DEFINITION_VERSION = 1 as const
export const FEATURE_INSTANCE_LIMIT_PER_SHEET = 256 as const

export type FeatureAcquisitionSourceKind = 'sheet' | 'class' | 'feature-grant' | 'edge-grant' | 'gm' | 'migration' | 'training' | 'orders'
export interface FeatureChoiceSelection { readonly choiceId: string, readonly values: readonly string[] }
export interface FeaturePrerequisiteOverride {
  readonly overrideId: string
  readonly reason: string
  readonly authorizedBy: string
  readonly createdAt: number
  readonly prerequisiteHash: string
}
export interface FeatureInstanceData {
  readonly schemaVersion: 1
  readonly instanceId: string
  readonly canonicalId: string
  readonly definitionVersion: 1
  readonly rank: number
  readonly choices: readonly FeatureChoiceSelection[]
  readonly acquisition: { readonly kind: FeatureAcquisitionSourceKind, readonly sourceId: string }
  readonly prerequisiteOverride: FeaturePrerequisiteOverride | null
}
export type FeatureInstanceParameterStatus = 'ready' | 'missing-required-data' | 'unresolved-identity' | 'malformed'
export interface ResolvedFeatureInstance {
  readonly status: FeatureInstanceParameterStatus
  readonly data: FeatureInstanceData | null
  readonly diagnostics: readonly string[]
}

export class FeatureInstanceValidationError extends Error {
  constructor(readonly path: string, detail: string) { super(`${path}: ${detail}`); this.name = 'FeatureInstanceValidationError' }
}
type UnknownRecord = Record<string, unknown>
const fail = (path: string, detail: string): never => { throw new FeatureInstanceValidationError(path, detail) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object.')
  return value as UnknownRecord
}
const text = (value: unknown, path: string, maximum = 200): string => {
  if (typeof value !== 'string' || value.trim() !== value || !value || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) fail(path, 'must be bounded trimmed text.')
  return value as string
}
const stableId = (value: unknown, path: string): string => {
  const parsed = text(value, path)
  if (!/^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/.test(parsed)) fail(path, 'must be a stable ID.')
  return parsed
}

const TYPE_IDS = ['Bug', 'Dark', 'Dragon', 'Electric', 'Fairy', 'Fighting', 'Fire', 'Flying', 'Ghost', 'Grass', 'Ground', 'Ice', 'Normal', 'Poison', 'Psychic', 'Rock', 'Steel', 'Water'] as const
const canonicalNames = (value: unknown): readonly string[] => Object.values(value as Record<string, { name?: unknown }>).flatMap(row => typeof row?.name === 'string' ? [row.name] : [])
const ABILITY_NAMES = canonicalNames(abilitiesJson)
const MOVE_NAMES = canonicalNames(movesJson)
const SPECIES_NAMES = (pokedexJson as readonly { species?: unknown }[]).flatMap(row => typeof row.species === 'string' ? [row.species] : [])
const canonicalChoice = (values: readonly string[], value: string): string | null => values.find(candidate => normalizedFeatureIdentityKey(candidate) === normalizedFeatureIdentityKey(value)) ?? null
type FeatureChoiceStatId = 'hp' | 'atk' | 'def' | 'satk' | 'sdef' | 'spd'
const normalizeChoice = (definition: FeatureChoiceDefinition, raw: string): string | null => {
  const value = raw.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (!value || value.length > 160 || /[\u0000-\u001f\u007f]/.test(value)) return null
  if (definition.options?.length) return definition.options.find(option => normalizedFeatureIdentityKey(option) === normalizedFeatureIdentityKey(value)) ?? null
  if (definition.kind === 'type') return TYPE_IDS.find(type => normalizedFeatureIdentityKey(type) === normalizedFeatureIdentityKey(value)) ?? null
  if (definition.kind === 'ability') return canonicalChoice(ABILITY_NAMES, value)
  if (definition.kind === 'move') return canonicalChoice(MOVE_NAMES, value)
  if (definition.kind === 'feature' || definition.kind === 'training-feature') return isCanonicalFeatureId(value) ? value : null
  if (definition.kind === 'edge') return isCanonicalEdgeId('trainer', value) || isCanonicalEdgeId('poke', value) ? value : null
  if (definition.kind === 'feature-or-edge') return isCanonicalFeatureId(value) || isCanonicalEdgeId('trainer', value) || isCanonicalEdgeId('poke', value) ? value : null
  if (definition.kind === 'species') return canonicalChoice(SPECIES_NAMES, value)
  if (definition.kind === 'skill') return ['acrobatics', 'athletics', 'charm', 'combat', 'command', 'focus', 'guile', 'intimidate', 'intuition', 'perception', 'stealth', 'survival', 'generalEd', 'medicineEd', 'occultEd', 'pokeEd', 'techEd'].includes(value) ? value : null
  if (definition.kind === 'stat') {
    const key = value.toLowerCase().replace(/[^a-z]/g, '')
    const aliases: Record<string, FeatureChoiceStatId> = { hp: 'hp', hitpoints: 'hp', attack: 'atk', atk: 'atk', defense: 'def', def: 'def', specialattack: 'satk', spatk: 'satk', satk: 'satk', specialdefense: 'sdef', spdef: 'sdef', sdef: 'sdef', speed: 'spd', spd: 'spd' }
    return aliases[key] ?? null
  }
  return value
}

const firstRawChoiceValue = (value: unknown): string | null => {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' ? first : null
}

const expandChoiceDefinitions = (
  base: readonly FeatureChoiceDefinition[],
  selectedValue: (choiceId: string) => string | null,
): readonly FeatureChoiceDefinition[] => {
  const definitions = [...base]
  for (let depth = 0; depth < 6; depth += 1) {
    let changed = false
    for (const definition of [...definitions]) {
      if (!['feature', 'feature-or-edge', 'training-feature'].includes(definition.kind)) continue
      const selected = selectedValue(definition.id)
      const child = selected ? FEATURE_AUTOMATION_MANIFEST_BY_ID.get(selected) : null
      if (!child) continue
      for (const nested of child.choices) {
        const id = `${definition.id}.${nested.id}`
        if (definitions.some(candidate => candidate.id === id)) continue
        definitions.push(Object.freeze({ ...nested, id, ...(nested.distinctGroup ? { distinctGroup: `${definition.id}.${nested.distinctGroup}` } : {}) }))
        changed = true
      }
    }
    if (!changed) break
  }
  return Object.freeze(definitions)
}

const typedChoiceDefinitions = (value: unknown, base: readonly FeatureChoiceDefinition[]): readonly FeatureChoiceDefinition[] => {
  if (!Array.isArray(value)) return base
  const selected = new Map<string, string>()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const row = candidate as Record<string, unknown>
    if (typeof row.choiceId === 'string') {
      const first = firstRawChoiceValue(row.values)
      if (first) selected.set(row.choiceId, first)
    }
  }
  return expandChoiceDefinitions(base, choiceId => selected.get(choiceId) ?? null)
}

const choiceCardinality = (definition: FeatureChoiceDefinition, rank: number): { minimum: number, maximum: number } => definition.perRank
  ? { minimum: definition.minimum * rank, maximum: definition.maximum * rank }
  : { minimum: definition.minimum, maximum: definition.maximum }

const parseChoices = (value: unknown, definitions: readonly FeatureChoiceDefinition[], rank: number, path: string): readonly FeatureChoiceSelection[] => {
  if (!Array.isArray(value) || value.length > 16) fail(path, 'must be a bounded array.')
  const candidates = value as unknown[]
  const byId = new Map(definitions.map(definition => [definition.id, definition]))
  const seen = new Set<string>()
  const choices = candidates.map((candidate: unknown, index: number): FeatureChoiceSelection => {
    const row = record(candidate, `${path}[${index}]`)
    const choiceId = stableId(row.choiceId, `${path}[${index}].choiceId`)
    const definition = byId.get(choiceId) ?? fail(`${path}[${index}].choiceId`, 'is unknown.')
    if (seen.has(choiceId)) fail(`${path}[${index}].choiceId`, 'is duplicated.')
    seen.add(choiceId)
    const cardinality = choiceCardinality(definition, rank)
    if (!Array.isArray(row.values) || row.values.length < cardinality.minimum || row.values.length > cardinality.maximum) fail(`${path}[${index}].values`, 'has invalid cardinality.')
    const rawValues = row.values as unknown[]
    const values = rawValues.map((item: unknown, valueIndex: number) => normalizeChoice(definition, text(item, `${path}[${index}].values[${valueIndex}]`, 160))
      ?? fail(`${path}[${index}].values[${valueIndex}]`, `is invalid for ${definition.kind}.`))
    if (new Set(values.map(normalizedFeatureIdentityKey)).size !== values.length) fail(`${path}[${index}].values`, 'contains duplicates.')
    return Object.freeze({ choiceId, values: Object.freeze(values) })
  })
  for (const definition of definitions) if (choiceCardinality(definition, rank).minimum > 0 && !choices.some((choice: FeatureChoiceSelection) => choice.choiceId === definition.id)) fail(path, `is missing ${definition.id}.`)
  for (const group of new Set(definitions.flatMap(definition => definition.distinctGroup ? [definition.distinctGroup] : []))) {
    const ids = new Set(definitions.filter(definition => definition.distinctGroup === group).map(definition => definition.id))
    const values = choices.filter(choice => ids.has(choice.choiceId)).flatMap(choice => choice.values.map(normalizedFeatureIdentityKey))
    if (new Set(values).size !== values.length) fail(path, `contains duplicate values in ${group}.`)
  }
  return Object.freeze(choices)
}

const parseOverride = (value: unknown, path: string): FeaturePrerequisiteOverride | null => {
  if (value === null) return null
  const row = record(value, path); const createdAt = Number(row.createdAt)
  const prerequisiteHash = text(row.prerequisiteHash, `${path}.prerequisiteHash`, 64)
  if (!Number.isSafeInteger(createdAt) || createdAt < 0 || !/^[0-9a-f]{64}$/.test(prerequisiteHash)) fail(path, 'has invalid override evidence.')
  return Object.freeze({ overrideId: stableId(row.overrideId, `${path}.overrideId`), reason: text(row.reason, `${path}.reason`, 500), authorizedBy: stableId(row.authorizedBy, `${path}.authorizedBy`), createdAt, prerequisiteHash })
}

export const parseFeatureInstanceData = (value: unknown, expectedCanonicalId?: string): FeatureInstanceData => {
  const root = record(value, 'featureInstance')
  if (root.schemaVersion !== 1 || root.definitionVersion !== 1) fail('featureInstance', 'has unsupported versions.')
  const canonicalId = text(root.canonicalId, 'featureInstance.canonicalId')
  const manifest = FEATURE_AUTOMATION_MANIFEST_BY_ID.get(canonicalId) ?? fail('featureInstance.canonicalId', 'is not canonical.')
  if (expectedCanonicalId && canonicalId !== expectedCanonicalId) fail('featureInstance.canonicalId', 'does not match its row.')
  const rank = Number(root.rank)
  if (!Number.isSafeInteger(rank) || rank < 1 || rank > 16) fail('featureInstance.rank', 'must be 1–16.')
  const acquisition = record(root.acquisition, 'featureInstance.acquisition')
  const kind = String(acquisition.kind) as FeatureAcquisitionSourceKind
  if (!['sheet', 'class', 'feature-grant', 'edge-grant', 'gm', 'migration', 'training', 'orders'].includes(kind)) fail('featureInstance.acquisition.kind', 'is invalid.')
  return Object.freeze({
    schemaVersion: 1, instanceId: stableId(root.instanceId, 'featureInstance.instanceId'), canonicalId,
    definitionVersion: 1, rank, choices: parseChoices(root.choices, typedChoiceDefinitions(root.choices, manifest.choices), rank, 'featureInstance.choices'),
    acquisition: Object.freeze({ kind, sourceId: stableId(acquisition.sourceId, 'featureInstance.acquisition.sourceId') }),
    prerequisiteOverride: parseOverride(root.prerequisiteOverride, 'featureInstance.prerequisiteOverride'),
  })
}

export interface LegacyFeatureEntrySource { readonly name?: unknown, readonly choices?: unknown, readonly automation?: unknown }
const safe = (value: string): string => value.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'feature'
const legacyChoices = (entry: LegacyFeatureEntrySource, definitions: readonly FeatureChoiceDefinition[], hints: readonly string[]): { readonly choices: readonly FeatureChoiceSelection[], readonly definitions: readonly FeatureChoiceDefinition[] } => {
  const source = entry.choices && typeof entry.choices === 'object' && !Array.isArray(entry.choices) ? entry.choices as Record<string, unknown> : {}
  let hintIndex = 0
  const initial = new Map<string, string>()
  for (const definition of definitions) {
    const raw = source[definition.id] ?? hints[hintIndex++]
    const value = firstRawChoiceValue(raw)
    if (value) initial.set(definition.id, value)
  }
  const expanded = expandChoiceDefinitions(definitions, choiceId => firstRawChoiceValue(source[choiceId]) ?? initial.get(choiceId) ?? null)
  const choices = expanded.flatMap((definition): FeatureChoiceSelection[] => {
    const raw = source[definition.id] ?? initial.get(definition.id)
    const values = (Array.isArray(raw) ? raw : [raw]).flatMap(item => typeof item === 'string' ? [normalizeChoice(definition, item)] : []).filter((item): item is string => Boolean(item)).slice(0, definition.maximum)
    return values.length ? [Object.freeze({ choiceId: definition.id, values: Object.freeze(values) })] : []
  })
  return Object.freeze({ choices: Object.freeze(choices), definitions: expanded })
}

export const resolveFeatureInstance = (input: { readonly entry: LegacyFeatureEntrySource, readonly ownerId: string, readonly index: number, readonly acquisitionKind?: FeatureAcquisitionSourceKind }): ResolvedFeatureInstance => {
  const label = parseFeatureLabel(input.entry.name)
  if (!label.canonicalId) return Object.freeze({ status: 'unresolved-identity', data: null, diagnostics: Object.freeze(['Unknown Feature identity.']) })
  if (input.entry.automation !== undefined) {
    try { return Object.freeze({ status: 'ready', data: parseFeatureInstanceData(input.entry.automation, label.canonicalId), diagnostics: Object.freeze([]) }) }
    catch (error) { return Object.freeze({ status: 'malformed', data: null, diagnostics: Object.freeze([error instanceof Error ? error.message : 'Malformed Feature instance.']) }) }
  }
  const manifest = FEATURE_AUTOMATION_MANIFEST_BY_ID.get(label.canonicalId)!
  const legacy = legacyChoices(input.entry, manifest.choices, label.selectionHints)
  const choices = legacy.choices
  const missing = legacy.definitions.filter(definition => definition.minimum > 0 && !choices.some(choice => choice.choiceId === definition.id))
  const kind = input.acquisitionKind ?? 'migration'
  const data: FeatureInstanceData = Object.freeze({
    schemaVersion: 1, instanceId: `feature:${safe(input.ownerId)}:${input.index}:${safe(label.canonicalId)}`,
    canonicalId: label.canonicalId, definitionVersion: 1, rank: 1, choices,
    acquisition: Object.freeze({ kind, sourceId: `${kind}:${safe(input.ownerId)}:${input.index}` }), prerequisiteOverride: null,
  })
  if (!missing.length) {
    try { return Object.freeze({ status: 'ready', data: parseFeatureInstanceData(data, label.canonicalId), diagnostics: Object.freeze([]) }) }
    catch (error) { return Object.freeze({ status: 'malformed', data: null, diagnostics: Object.freeze([error instanceof Error ? error.message : 'Malformed Feature choices.']) }) }
  }
  return Object.freeze({ status: 'missing-required-data', data, diagnostics: Object.freeze(missing.map(definition => `Missing required ${definition.kind} choice (${definition.id}).`)) })
}

export const featureChoiceValues = (instance: FeatureInstanceData, choiceId: string): readonly string[] => instance.choices.find(choice => choice.choiceId === choiceId)?.values ?? []
