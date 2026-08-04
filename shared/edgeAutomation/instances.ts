import {
  normalizedEdgeIdentityKey,
  parseEdgeLabel,
  type EdgeFamily,
} from './catalog'
import {
  EDGE_AUTOMATION_MANIFEST_BY_KEY,
  type EdgeChoiceDefinition,
  type EdgeChoiceKind,
} from './manifest'
import { canonicalEdgeKey } from './catalog'

export const EDGE_INSTANCE_SCHEMA_VERSION = 1 as const
export const EDGE_DEFINITION_VERSION = 1 as const
export const EDGE_INSTANCE_LIMIT_PER_SHEET = 128 as const

export const EDGE_SKILL_IDS = [
  'acrobatics', 'athletics', 'charm', 'combat', 'command', 'generalEd',
  'medicineEd', 'occultEd', 'pokeEd', 'techEd', 'focus', 'guile',
  'intimidate', 'intuition', 'perception', 'stealth', 'survival',
] as const
export const EDGE_TYPE_IDS = [
  'Bug', 'Dark', 'Dragon', 'Electric', 'Fairy', 'Fighting', 'Fire', 'Flying',
  'Ghost', 'Grass', 'Ground', 'Ice', 'Normal', 'Poison', 'Psychic', 'Rock',
  'Steel', 'Water',
] as const

export type EdgeAcquisitionSourceKind = 'sheet' | 'feature-grant' | 'edge-grant' | 'gm' | 'migration'

export interface EdgeChoiceSelection {
  readonly choiceId: string
  readonly values: readonly string[]
}

export interface EdgePrerequisiteOverride {
  readonly overrideId: string
  readonly reason: string
  readonly authorizedBy: string
  readonly createdAt: number
  readonly prerequisiteHash: string
}

export interface EdgeInstanceData {
  readonly schemaVersion: typeof EDGE_INSTANCE_SCHEMA_VERSION
  readonly instanceId: string
  readonly family: EdgeFamily
  readonly canonicalId: string
  readonly definitionVersion: typeof EDGE_DEFINITION_VERSION
  readonly rank: number
  readonly choices: readonly EdgeChoiceSelection[]
  readonly acquisition: {
    readonly kind: EdgeAcquisitionSourceKind
    readonly sourceId: string
  }
  readonly prerequisiteOverride: EdgePrerequisiteOverride | null
}

export type TrainerEdgeInstanceData = EdgeInstanceData & { readonly family: 'trainer' }
export type PokeEdgeInstanceData = EdgeInstanceData & { readonly family: 'poke' }

export type EdgeInstanceParameterStatus = 'ready' | 'missing-required-data' | 'unresolved-identity' | 'malformed'

export interface ResolvedEdgeInstance {
  readonly status: EdgeInstanceParameterStatus
  readonly data: EdgeInstanceData | null
  readonly diagnostics: readonly string[]
}

export class EdgeInstanceValidationError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'EdgeInstanceValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const fail = (path: string, detail: string): never => { throw new EdgeInstanceValidationError(path, detail) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object.')
  return value as UnknownRecord
}
const text = (value: unknown, path: string, max = 200): string => {
  if (typeof value !== 'string' || value.trim() !== value || !value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) fail(path, 'must be bounded trimmed text.')
  return value as string
}
const stableId = (value: unknown, path: string): string => {
  const parsed = text(value, path)
  if (!/^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/.test(parsed)) fail(path, 'must be a stable ID.')
  return parsed
}

const normalizedSkill = (value: string): string | null => {
  const key = normalizedEdgeIdentityKey(value).replace(/[^a-z0-9]/g, '')
  const aliases: Readonly<Record<string, string>> = {
    acrobatics: 'acrobatics', athletics: 'athletics', charm: 'charm', combat: 'combat', command: 'command',
    generaled: 'generalEd', generaleducation: 'generalEd', medicineed: 'medicineEd', medicineeducation: 'medicineEd',
    occulted: 'occultEd', occulteducation: 'occultEd', pokeed: 'pokeEd', pokemoned: 'pokeEd', pokemoneducation: 'pokeEd',
    teched: 'techEd', technologyed: 'techEd', technologyeducation: 'techEd', focus: 'focus', guile: 'guile',
    intimidate: 'intimidate', intuition: 'intuition', perception: 'perception', stealth: 'stealth', survival: 'survival',
  }
  return aliases[key] ?? null
}

const normalizeChoiceValue = (kind: EdgeChoiceKind, value: string): string | null => {
  const trimmed = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (!trimmed || trimmed.length > 160 || /[\u0000-\u001f\u007f]/.test(trimmed)) return null
  if (kind === 'skill') return normalizedSkill(trimmed)
  if (kind === 'skill-category') {
    const category = trimmed.toLocaleLowerCase('en-US')
    return category === 'body' || category === 'mind' || category === 'spirit'
      ? `${category[0]!.toUpperCase()}${category.slice(1)}` : null
  }
  if (kind === 'type') return EDGE_TYPE_IDS.find(type => normalizedEdgeIdentityKey(type) === normalizedEdgeIdentityKey(trimmed)) ?? null
  if (kind === 'attack-stat') {
    const key = normalizedEdgeIdentityKey(trimmed).replace(/[^a-z]/g, '')
    return key === 'attack' || key === 'atk' ? 'Attack'
      : key === 'specialattack' || key === 'spatk' || key === 'satk' ? 'Special Attack' : null
  }
  if (kind === 'movement-capability') {
    const value = ['Overland', 'Sky', 'Swim', 'Levitate', 'Burrow', 'Teleporter']
      .find(candidate => normalizedEdgeIdentityKey(candidate) === normalizedEdgeIdentityKey(trimmed))
    return value ?? null
  }
  if (kind === 'power-or-jump-capability') {
    const key = normalizedEdgeIdentityKey(trimmed).replace(/[^a-z]/g, '')
    if (key === 'power') return 'Power'
    if (key === 'highjump' || key === 'jumphigh' || key === 'high') return 'High Jump'
    if (key === 'longjump' || key === 'jumplong' || key === 'long') return 'Long Jump'
    return null
  }
  if (kind === 'elemental-struggle-capability') {
    return ['Firestarter', 'Fountain', 'Freezer', 'Guster', 'Materializer', 'Zapper']
      .find(candidate => normalizedEdgeIdentityKey(candidate) === normalizedEdgeIdentityKey(trimmed)) ?? null
  }
  // Canonical reference identity choices are validated against their owning
  // registries by acquisition workflows; this boundary only rejects unsafe text.
  return trimmed
}

const parseSelections = (
  value: unknown,
  definitions: readonly EdgeChoiceDefinition[],
  path: string,
): readonly EdgeChoiceSelection[] => {
  const candidates: unknown[] = Array.isArray(value)
    ? value as unknown[]
    : fail(path, 'must be an array of selections.')
  if (candidates.length > 8) fail(path, 'must contain at most eight selections.')
  const definitionById = new Map(definitions.map(definition => [definition.id, definition]))
  const seen = new Set<string>()
  const selections = candidates.map((candidate: unknown, index: number): EdgeChoiceSelection => {
    const selectionPath = `${path}[${index}]`
    const row = record(candidate, selectionPath)
    const choiceId = stableId(row.choiceId, `${selectionPath}.choiceId`)
    const definition = definitionById.get(choiceId)
      ?? fail(`${selectionPath}.choiceId`, 'is unknown.')
    if (seen.has(choiceId)) fail(`${selectionPath}.choiceId`, 'is duplicated.')
    seen.add(choiceId)
    const rawValues: unknown[] = Array.isArray(row.values)
      ? row.values as unknown[]
      : fail(`${selectionPath}.values`, 'must be an array.')
    if (rawValues.length < definition.minimum || rawValues.length > definition.maximum) fail(`${selectionPath}.values`, 'has invalid cardinality.')
    const values = rawValues.map((raw: unknown, valueIndex: number) => {
      const parsed = normalizeChoiceValue(definition.kind, text(raw, `${selectionPath}.values[${valueIndex}]`, 160))
      return parsed ?? fail(`${selectionPath}.values[${valueIndex}]`, `is invalid for ${definition.kind}.`)
    })
    if (new Set(values.map(normalizedEdgeIdentityKey)).size !== values.length) fail(`${selectionPath}.values`, 'must not contain duplicates.')
    return Object.freeze({ choiceId, values: Object.freeze(values) })
  })
  for (const definition of definitions) {
    const selection = selections.find(candidate => candidate.choiceId === definition.id)
    if (!selection && definition.minimum > 0) fail(path, `is missing required choice ${definition.id}.`)
  }
  return Object.freeze(selections)
}

const parseOverride = (value: unknown, path: string): EdgePrerequisiteOverride | null => {
  if (value === null) return null
  const row = record(value, path)
  const createdAt = Number(row.createdAt)
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) fail(`${path}.createdAt`, 'must be a non-negative timestamp.')
  const prerequisiteHash = text(row.prerequisiteHash, `${path}.prerequisiteHash`, 64)
  if (!/^[0-9a-f]{64}$/.test(prerequisiteHash)) fail(`${path}.prerequisiteHash`, 'must be SHA-256.')
  return Object.freeze({
    overrideId: stableId(row.overrideId, `${path}.overrideId`),
    reason: text(row.reason, `${path}.reason`, 500),
    authorizedBy: stableId(row.authorizedBy, `${path}.authorizedBy`),
    createdAt,
    prerequisiteHash,
  })
}

export const parseEdgeInstanceData = (
  value: unknown,
  expectedFamily?: EdgeFamily,
  expectedCanonicalId?: string,
): EdgeInstanceData => {
  const root = record(value, 'edgeInstance')
  if (root.schemaVersion !== 1 || root.definitionVersion !== 1) fail('edgeInstance', 'has an unsupported version.')
  const family = root.family === 'trainer' || root.family === 'poke' ? root.family : fail('edgeInstance.family', 'is invalid.')
  if (expectedFamily && family !== expectedFamily) fail('edgeInstance.family', 'does not match its sheet owner.')
  const canonicalId = text(root.canonicalId, 'edgeInstance.canonicalId')
  const manifest = EDGE_AUTOMATION_MANIFEST_BY_KEY.get(canonicalEdgeKey(family, canonicalId))
    ?? fail('edgeInstance.canonicalId', 'is not canonical.')
  if (expectedCanonicalId && canonicalId !== expectedCanonicalId) fail('edgeInstance.canonicalId', 'is not the expected canonical identity.')
  const rank = Number(root.rank)
  if (!Number.isSafeInteger(rank) || rank < 1 || rank > 16) fail('edgeInstance.rank', 'must be 1–16.')
  const acquisition = record(root.acquisition, 'edgeInstance.acquisition')
  const kind = acquisition.kind
  if (!['sheet', 'feature-grant', 'edge-grant', 'gm', 'migration'].includes(String(kind))) fail('edgeInstance.acquisition.kind', 'is invalid.')
  return Object.freeze({
    schemaVersion: 1,
    instanceId: stableId(root.instanceId, 'edgeInstance.instanceId'),
    family,
    canonicalId,
    definitionVersion: 1,
    rank,
    choices: parseSelections(root.choices, manifest.choices, 'edgeInstance.choices'),
    acquisition: Object.freeze({ kind: kind as EdgeAcquisitionSourceKind, sourceId: stableId(acquisition.sourceId, 'edgeInstance.acquisition.sourceId') }),
    prerequisiteOverride: parseOverride(root.prerequisiteOverride, 'edgeInstance.prerequisiteOverride'),
  })
}

export interface LegacyEdgeEntrySource {
  readonly name?: unknown
  readonly basicSkill?: unknown
  readonly choices?: unknown
  readonly automation?: unknown
}

const legacyChoiceValues = (
  entry: LegacyEdgeEntrySource,
  family: EdgeFamily,
  canonicalId: string,
  hints: readonly string[],
): readonly EdgeChoiceSelection[] => {
  const manifest = EDGE_AUTOMATION_MANIFEST_BY_KEY.get(canonicalEdgeKey(family, canonicalId))!
  const choices = entry.choices && typeof entry.choices === 'object' && !Array.isArray(entry.choices)
    ? entry.choices as Record<string, unknown> : {}
  let hintIndex = 0
  return manifest.choices.flatMap((definition): readonly EdgeChoiceSelection[] => {
    const candidates: unknown[] = []
    const direct = choices[definition.id]
    if (Array.isArray(direct)) candidates.push(...direct)
    else if (direct !== undefined) candidates.push(direct)
    if (definition.id === 'skills') candidates.push(choices.skill, choices.skill2)
    if (definition.id === 'skill') candidates.push(entry.basicSkill, choices.skill)
    if (definition.id === 'category') candidates.push(choices.category)
    if (definition.id === 'type') candidates.push(choices.type)
    if (definition.id === 'weapon') candidates.push(choices.weapon, choices.weaponType)
    while (candidates.filter(value => value !== undefined && value !== null && value !== '').length < definition.minimum
      && hintIndex < hints.length) candidates.push(hints[hintIndex++])
    const values = candidates.flatMap(raw => typeof raw === 'string' ? [normalizeChoiceValue(definition.kind, raw)] : [])
      .filter((value): value is string => Boolean(value))
      .filter((value, index, all) => all.findIndex(candidate => normalizedEdgeIdentityKey(candidate) === normalizedEdgeIdentityKey(value)) === index)
      .slice(0, definition.maximum)
    return values.length > 0 ? [Object.freeze({ choiceId: definition.id, values: Object.freeze(values) })] : []
  })
}

const safeInstancePart = (value: string): string => value.normalize('NFKD').toLocaleLowerCase('en-US')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'edge'

/** Compatibility reader. Accepted writes should persist the returned typed data. */
export const resolveEdgeInstance = (input: {
  readonly family: EdgeFamily
  readonly entry: LegacyEdgeEntrySource
  readonly ownerId: string
  readonly index: number
}): ResolvedEdgeInstance => {
  const parsedLabel = parseEdgeLabel(input.family, input.entry.name)
  if (!parsedLabel.canonicalId) return Object.freeze({ status: 'unresolved-identity', data: null, diagnostics: Object.freeze(['Unknown Edge identity.']) })
  if (input.entry.automation !== undefined) {
    try {
      const data = parseEdgeInstanceData(input.entry.automation, input.family, parsedLabel.canonicalId)
      return Object.freeze({ status: 'ready', data, diagnostics: Object.freeze([]) })
    }
    catch (error) {
      return Object.freeze({ status: 'malformed', data: null, diagnostics: Object.freeze([error instanceof Error ? error.message : 'Malformed Edge automation data.']) })
    }
  }
  const manifest = EDGE_AUTOMATION_MANIFEST_BY_KEY.get(canonicalEdgeKey(input.family, parsedLabel.canonicalId))!
  const choices = legacyChoiceValues(input.entry, input.family, parsedLabel.canonicalId, parsedLabel.selectionHints)
  const missing = manifest.choices.filter(definition => {
    const selection = choices.find(candidate => candidate.choiceId === definition.id)
    return !selection || selection.values.length < definition.minimum
  })
  const data: EdgeInstanceData = Object.freeze({
    schemaVersion: 1,
    instanceId: `edge:${input.family}:${safeInstancePart(input.ownerId)}:${input.index}:${safeInstancePart(parsedLabel.canonicalId)}`,
    family: input.family,
    canonicalId: parsedLabel.canonicalId,
    definitionVersion: 1,
    rank: 1,
    choices,
    acquisition: Object.freeze({ kind: 'migration', sourceId: `sheet:${safeInstancePart(input.ownerId)}:${input.index}` }),
    prerequisiteOverride: null,
  })
  return Object.freeze({
    status: missing.length > 0 ? 'missing-required-data' : 'ready',
    data,
    diagnostics: Object.freeze(missing.map(definition => `Missing required ${definition.kind} choice (${definition.id}).`)),
  })
}

export const edgeChoiceValues = (instance: EdgeInstanceData, choiceId: string): readonly string[] => (
  instance.choices.find(choice => choice.choiceId === choiceId)?.values ?? []
)
