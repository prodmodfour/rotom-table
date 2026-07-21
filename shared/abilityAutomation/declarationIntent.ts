import { POKEMON_TYPE_IDS, type PokemonTypeId } from '../pokemonTypes'
import { ABILITY_SPEC_TARGETING_KINDS, type AbilitySpecTargetingKind } from './spec'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_DECLARATION_SCHEMA_VERSION = 1 as const
export const ABILITY_DECLARATION_DIRECTIONS = [
  'north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest',
  'up', 'down',
] as const
export const ABILITY_DECLARATION_STAT_IDS = [
  'hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed', 'accuracy', 'evasion',
] as const
export const ABILITY_DECLARATION_LIMITS = Object.freeze({
  identifierLength: 200,
  canonicalIdLength: 160,
  declarations: 64,
  optionsPerDeclaration: 512,
  selections: 64,
  selectedOptions: 32,
  areaCells: 512,
  coordinate: 1_000_000,
  maximumLifetimeMs: 300_000,
})

export type AbilityDeclarationDirection = (typeof ABILITY_DECLARATION_DIRECTIONS)[number]
export type AbilityDeclarationStatId = (typeof ABILITY_DECLARATION_STAT_IDS)[number]
export interface AbilityDeclarationCell { readonly x: number; readonly y: number; readonly z: number }

export type AbilityDeclarationOptionValue =
  | { readonly kind: 'none' }
  | { readonly kind: 'self' | 'token'; readonly placementId: string }
  | { readonly kind: 'side'; readonly sideId: string }
  | { readonly kind: 'field'; readonly fieldId: string }
  | { readonly kind: 'cell'; readonly cellId: string; readonly cell: AbilityDeclarationCell }
  | { readonly kind: 'area'; readonly areaId: string; readonly cells: readonly AbilityDeclarationCell[] }
  | { readonly kind: 'direction'; readonly directionId: AbilityDeclarationDirection }
  | { readonly kind: 'type'; readonly typeId: PokemonTypeId }
  | { readonly kind: 'stat'; readonly statId: AbilityDeclarationStatId }
  | { readonly kind: 'move'; readonly canonicalMoveId: string }
  | { readonly kind: 'ability'; readonly canonicalAbilityId: string; readonly abilityInstanceId: string | null }
  | { readonly kind: 'item'; readonly itemId: string; readonly itemResourceId: string }
  | { readonly kind: 'branch'; readonly branchId: string }

export interface AbilityDeclarationOption {
  readonly id: string
  readonly presentationKey: string
  readonly value: AbilityDeclarationOptionValue
}

export interface AbilityDeclarationOfferTargeting {
  readonly id: string
  readonly kind: AbilitySpecTargetingKind
  readonly minSelections: number
  readonly maxSelections: number
  readonly options: readonly AbilityDeclarationOption[]
}

export interface AbilityDeclarationOffer {
  readonly schemaVersion: typeof ABILITY_DECLARATION_SCHEMA_VERSION
  readonly offerId: string
  readonly offerSha256: string
  readonly mapSlug: string
  readonly mapRevision: number
  readonly createdAt: number
  readonly expiresAt: number
  readonly actorPlacementId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly modeId: string
  readonly runtimeVersion: number
  readonly definitionHash: string
  readonly declarations: readonly AbilityDeclarationOfferTargeting[]
}

export interface AbilityDeclarationSelection {
  readonly declarationId: string
  readonly kind: AbilitySpecTargetingKind
  readonly optionIds: readonly string[]
}

export interface AbilityDeclarationIntent {
  readonly schemaVersion: typeof ABILITY_DECLARATION_SCHEMA_VERSION
  readonly intentId: string
  readonly offerId: string
  readonly offerSha256: string
  readonly mapSlug: string
  readonly baseRevision: number
  readonly actorPlacementId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly modeId: string
  readonly selections: readonly AbilityDeclarationSelection[]
}

export type AbilityDeclarationValidationCode =
  | 'invalid-declaration'
  | 'unsupported-schema-version'
  | 'limit-exceeded'
  | 'duplicate-id'
  | 'not-json'

export class AbilityDeclarationValidationError extends Error {
  constructor(readonly code: AbilityDeclarationValidationCode, readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityDeclarationValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const OFFER_FIELDS = [
  'schemaVersion', 'offerId', 'offerSha256', 'mapSlug', 'mapRevision', 'createdAt', 'expiresAt',
  'actorPlacementId', 'abilityInstanceId', 'canonicalId', 'modeId', 'runtimeVersion',
  'definitionHash', 'declarations',
] as const
const INTENT_FIELDS = [
  'schemaVersion', 'intentId', 'offerId', 'offerSha256', 'mapSlug', 'baseRevision',
  'actorPlacementId', 'abilityInstanceId', 'canonicalId', 'modeId', 'selections',
] as const
const DECLARATION_FIELDS = ['id', 'kind', 'minSelections', 'maxSelections', 'options'] as const
const OPTION_FIELDS = ['id', 'presentationKey', 'value'] as const
const SELECTION_FIELDS = ['declarationId', 'kind', 'optionIds'] as const
const VALUE_FIELDS: Readonly<Record<AbilitySpecTargetingKind, readonly string[]>> = {
  none: ['kind'], self: ['kind', 'placementId'], token: ['kind', 'placementId'],
  side: ['kind', 'sideId'], field: ['kind', 'fieldId'], cell: ['kind', 'cellId', 'cell'],
  area: ['kind', 'areaId', 'cells'], direction: ['kind', 'directionId'],
  type: ['kind', 'typeId'], stat: ['kind', 'statId'], move: ['kind', 'canonicalMoveId'],
  ability: ['kind', 'canonicalAbilityId', 'abilityInstanceId'],
  item: ['kind', 'itemId', 'itemResourceId'], branch: ['kind', 'branchId'],
}
const CELL_FIELDS = ['x', 'y', 'z'] as const
const TARGETING_SET = new Set<string>(ABILITY_SPEC_TARGETING_KINDS)
const TYPE_SET = new Set<string>(POKEMON_TYPE_IDS)
const DIRECTION_SET = new Set<string>(ABILITY_DECLARATION_DIRECTIONS)
const STAT_SET = new Set<string>(ABILITY_DECLARATION_STAT_IDS)
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/

const fail = (code: AbilityDeclarationValidationCode, path: string, detail: string): never => {
  throw new AbilityDeclarationValidationError(code, path, detail)
}
const clone = (value: unknown, path: string): unknown => cloneStrictJson(value, path, {
  limits: {
    depth: 9, nodes: 65_536, objectFields: 32,
    arrayEntries: ABILITY_DECLARATION_LIMITS.optionsPerDeclaration,
    stringLength: ABILITY_DECLARATION_LIMITS.identifierLength,
    objectKeyLength: ABILITY_DECLARATION_LIMITS.identifierLength,
  },
  rootLabel: 'ability declaration data', valueLabel: 'ability declaration values',
  failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
  failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
})
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail('invalid-declaration', path, 'must be an object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))
    || Object.keys(value).some(field => !expected.has(field))) {
    fail('invalid-declaration', path, 'has an invalid shape.')
  }
}
const stableId = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0
    || value.length > ABILITY_DECLARATION_LIMITS.identifierLength
    || !STABLE_ID_PATTERN.test(value)) fail('invalid-declaration', path, 'must be a stable ID.')
  return value as string
}
const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0
    || value.length > ABILITY_DECLARATION_LIMITS.canonicalIdLength
    || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    fail('invalid-declaration', path, 'must be bounded trimmed text.')
  }
  return value as string
}
const integer = (value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    fail('invalid-declaration', path, `must be an integer from 0 through ${maximum}.`)
  }
  return Number(value)
}
const targetingKind = (value: unknown, path: string): AbilitySpecTargetingKind => {
  if (typeof value !== 'string' || !TARGETING_SET.has(value)) {
    fail('invalid-declaration', path, 'is not a supported targeting kind.')
  }
  return value as AbilitySpecTargetingKind
}
const parseCell = (value: unknown, path: string): AbilityDeclarationCell => {
  const input = record(value, path)
  exact(input, CELL_FIELDS, path)
  return Object.freeze({
    x: integer(input.x, `${path}.x`, ABILITY_DECLARATION_LIMITS.coordinate),
    y: integer(input.y, `${path}.y`, ABILITY_DECLARATION_LIMITS.coordinate),
    z: integer(input.z, `${path}.z`, ABILITY_DECLARATION_LIMITS.coordinate),
  })
}
const parseOptionValue = (value: unknown, expectedKind: AbilitySpecTargetingKind, path: string): AbilityDeclarationOptionValue => {
  const input = record(value, path)
  exact(input, VALUE_FIELDS[expectedKind], path)
  if (input.kind !== expectedKind) fail('invalid-declaration', `${path}.kind`, 'must match its declaration.')
  if (expectedKind === 'none') return Object.freeze({ kind: 'none' })
  if (expectedKind === 'self' || expectedKind === 'token') return Object.freeze({
    kind: expectedKind,
    placementId: stableId(input.placementId, `${path}.placementId`),
  })
  if (expectedKind === 'side') return Object.freeze({ kind: 'side', sideId: stableId(input.sideId, `${path}.sideId`) })
  if (expectedKind === 'field') return Object.freeze({ kind: 'field', fieldId: stableId(input.fieldId, `${path}.fieldId`) })
  if (expectedKind === 'cell') return Object.freeze({
    kind: 'cell', cellId: stableId(input.cellId, `${path}.cellId`), cell: parseCell(input.cell, `${path}.cell`),
  })
  if (expectedKind === 'area') {
    const rawCells = input.cells
    if (!Array.isArray(rawCells) || rawCells.length === 0
      || rawCells.length > ABILITY_DECLARATION_LIMITS.areaCells) {
      fail('limit-exceeded', `${path}.cells`, 'must be a bounded non-empty cell array.')
    }
    const cells = (rawCells as readonly unknown[]).map((cell, index) => parseCell(cell, `${path}.cells[${index}]`))
    const keys = cells.map(cell => `${cell.x}:${cell.y}:${cell.z}`)
    if (new Set(keys).size !== keys.length) fail('duplicate-id', `${path}.cells`, 'must not repeat cells.')
    return Object.freeze({ kind: 'area', areaId: stableId(input.areaId, `${path}.areaId`), cells: Object.freeze(cells) })
  }
  if (expectedKind === 'direction') {
    if (typeof input.directionId !== 'string' || !DIRECTION_SET.has(input.directionId)) {
      fail('invalid-declaration', `${path}.directionId`, 'is unsupported.')
    }
    return Object.freeze({ kind: 'direction', directionId: input.directionId as AbilityDeclarationDirection })
  }
  if (expectedKind === 'type') {
    if (typeof input.typeId !== 'string' || !TYPE_SET.has(input.typeId)) fail('invalid-declaration', `${path}.typeId`, 'is unsupported.')
    return Object.freeze({ kind: 'type', typeId: input.typeId as PokemonTypeId })
  }
  if (expectedKind === 'stat') {
    if (typeof input.statId !== 'string' || !STAT_SET.has(input.statId)) fail('invalid-declaration', `${path}.statId`, 'is unsupported.')
    return Object.freeze({ kind: 'stat', statId: input.statId as AbilityDeclarationStatId })
  }
  if (expectedKind === 'move') return Object.freeze({ kind: 'move', canonicalMoveId: text(input.canonicalMoveId, `${path}.canonicalMoveId`) })
  if (expectedKind === 'ability') return Object.freeze({
    kind: 'ability',
    canonicalAbilityId: text(input.canonicalAbilityId, `${path}.canonicalAbilityId`),
    abilityInstanceId: input.abilityInstanceId === null ? null : stableId(input.abilityInstanceId, `${path}.abilityInstanceId`),
  })
  if (expectedKind === 'item') return Object.freeze({
    kind: 'item', itemId: stableId(input.itemId, `${path}.itemId`),
    itemResourceId: stableId(input.itemResourceId, `${path}.itemResourceId`),
  })
  return Object.freeze({ kind: 'branch', branchId: stableId(input.branchId, `${path}.branchId`) })
}

const parseDeclarations = (value: unknown, path: string): readonly AbilityDeclarationOfferTargeting[] => {
  if (!Array.isArray(value) || value.length > ABILITY_DECLARATION_LIMITS.declarations) {
    fail('limit-exceeded', path, 'must be a bounded declaration array.')
  }
  const declarations = (value as readonly unknown[]).map((entry, index): AbilityDeclarationOfferTargeting => {
    const entryPath = `${path}[${index}]`
    const input = record(entry, entryPath)
    exact(input, DECLARATION_FIELDS, entryPath)
    const kind = targetingKind(input.kind, `${entryPath}.kind`)
    const minSelections = integer(input.minSelections, `${entryPath}.minSelections`, ABILITY_DECLARATION_LIMITS.selectedOptions)
    const maxSelections = integer(input.maxSelections, `${entryPath}.maxSelections`, ABILITY_DECLARATION_LIMITS.selectedOptions)
    if (minSelections > maxSelections) fail('invalid-declaration', entryPath, 'selection bounds are inverted.')
    if (!Array.isArray(input.options) || input.options.length > ABILITY_DECLARATION_LIMITS.optionsPerDeclaration) {
      fail('limit-exceeded', `${entryPath}.options`, 'must be a bounded option array.')
    }
    const rawOptions = input.options as readonly unknown[]
    const options = rawOptions.map((option, optionIndex): AbilityDeclarationOption => {
      const optionPath = `${entryPath}.options[${optionIndex}]`
      const optionInput = record(option, optionPath)
      exact(optionInput, OPTION_FIELDS, optionPath)
      return Object.freeze({
        id: stableId(optionInput.id, `${optionPath}.id`),
        presentationKey: stableId(optionInput.presentationKey, `${optionPath}.presentationKey`),
        value: parseOptionValue(optionInput.value, kind, `${optionPath}.value`),
      })
    })
    if (new Set(options.map(option => option.id)).size !== options.length) {
      fail('duplicate-id', `${entryPath}.options`, 'must not repeat option IDs.')
    }
    if (maxSelections > options.length || (kind === 'none' && (minSelections !== 0 || maxSelections !== 0 || options.length !== 0))) {
      fail('invalid-declaration', entryPath, 'selection bounds do not match available options.')
    }
    return Object.freeze({
      id: stableId(input.id, `${entryPath}.id`), kind, minSelections, maxSelections,
      options: Object.freeze(options),
    })
  })
  if (new Set(declarations.map(declaration => declaration.id)).size !== declarations.length) {
    fail('duplicate-id', path, 'must not repeat declaration IDs.')
  }
  return Object.freeze(declarations)
}

export const parseAbilityDeclarationOffer = (value: unknown): AbilityDeclarationOffer => {
  const input = record(clone(value, 'abilityDeclarationOffer'), 'abilityDeclarationOffer')
  exact(input, OFFER_FIELDS, 'abilityDeclarationOffer')
  if (input.schemaVersion !== ABILITY_DECLARATION_SCHEMA_VERSION) {
    fail('unsupported-schema-version', 'abilityDeclarationOffer.schemaVersion', 'is unsupported.')
  }
  if (typeof input.offerSha256 !== 'string' || !SHA256_PATTERN.test(input.offerSha256)) {
    fail('invalid-declaration', 'abilityDeclarationOffer.offerSha256', 'must be SHA-256.')
  }
  if (typeof input.definitionHash !== 'string' || !SHA256_PATTERN.test(input.definitionHash)) {
    fail('invalid-declaration', 'abilityDeclarationOffer.definitionHash', 'must be SHA-256.')
  }
  const createdAt = integer(input.createdAt, 'abilityDeclarationOffer.createdAt')
  const expiresAt = integer(input.expiresAt, 'abilityDeclarationOffer.expiresAt')
  if (expiresAt <= createdAt || expiresAt - createdAt > ABILITY_DECLARATION_LIMITS.maximumLifetimeMs) {
    fail('invalid-declaration', 'abilityDeclarationOffer.expiresAt', 'has an invalid lifetime.')
  }
  return deepFreezeStrictJson({
    schemaVersion: ABILITY_DECLARATION_SCHEMA_VERSION,
    offerId: stableId(input.offerId, 'abilityDeclarationOffer.offerId'),
    offerSha256: input.offerSha256,
    mapSlug: text(input.mapSlug, 'abilityDeclarationOffer.mapSlug'),
    mapRevision: integer(input.mapRevision, 'abilityDeclarationOffer.mapRevision'),
    createdAt,
    expiresAt,
    actorPlacementId: stableId(input.actorPlacementId, 'abilityDeclarationOffer.actorPlacementId'),
    abilityInstanceId: stableId(input.abilityInstanceId, 'abilityDeclarationOffer.abilityInstanceId'),
    canonicalId: text(input.canonicalId, 'abilityDeclarationOffer.canonicalId'),
    modeId: stableId(input.modeId, 'abilityDeclarationOffer.modeId'),
    runtimeVersion: (() => {
      const version = integer(input.runtimeVersion, 'abilityDeclarationOffer.runtimeVersion', 1_000_000)
      if (version < 1) fail('invalid-declaration', 'abilityDeclarationOffer.runtimeVersion', 'must be positive.')
      return version
    })(),
    definitionHash: input.definitionHash,
    declarations: parseDeclarations(input.declarations, 'abilityDeclarationOffer.declarations'),
  }) as AbilityDeclarationOffer
}

export const parseAbilityDeclarationIntent = (value: unknown): AbilityDeclarationIntent => {
  const input = record(clone(value, 'abilityDeclarationIntent'), 'abilityDeclarationIntent')
  exact(input, INTENT_FIELDS, 'abilityDeclarationIntent')
  if (input.schemaVersion !== ABILITY_DECLARATION_SCHEMA_VERSION) {
    fail('unsupported-schema-version', 'abilityDeclarationIntent.schemaVersion', 'is unsupported.')
  }
  if (typeof input.offerSha256 !== 'string' || !SHA256_PATTERN.test(input.offerSha256)) {
    fail('invalid-declaration', 'abilityDeclarationIntent.offerSha256', 'must be SHA-256.')
  }
  if (!Array.isArray(input.selections) || input.selections.length > ABILITY_DECLARATION_LIMITS.selections) {
    fail('limit-exceeded', 'abilityDeclarationIntent.selections', 'must be bounded.')
  }
  const rawSelections = input.selections as readonly unknown[]
  const selections = rawSelections.map((entry, index): AbilityDeclarationSelection => {
    const entryPath = `abilityDeclarationIntent.selections[${index}]`
    const selection = record(entry, entryPath)
    exact(selection, SELECTION_FIELDS, entryPath)
    if (!Array.isArray(selection.optionIds)
      || selection.optionIds.length > ABILITY_DECLARATION_LIMITS.selectedOptions) {
      fail('limit-exceeded', `${entryPath}.optionIds`, 'must be bounded.')
    }
    const rawOptionIds = selection.optionIds as readonly unknown[]
    const optionIds = rawOptionIds.map((id, optionIndex) => (
      stableId(id, `${entryPath}.optionIds[${optionIndex}]`)
    ))
    if (new Set(optionIds).size !== optionIds.length) {
      fail('duplicate-id', `${entryPath}.optionIds`, 'must not repeat option IDs.')
    }
    return Object.freeze({
      declarationId: stableId(selection.declarationId, `${entryPath}.declarationId`),
      kind: targetingKind(selection.kind, `${entryPath}.kind`),
      optionIds: Object.freeze(optionIds),
    })
  })
  if (new Set(selections.map(selection => selection.declarationId)).size !== selections.length) {
    fail('duplicate-id', 'abilityDeclarationIntent.selections', 'must not repeat declarations.')
  }
  return deepFreezeStrictJson({
    schemaVersion: ABILITY_DECLARATION_SCHEMA_VERSION,
    intentId: stableId(input.intentId, 'abilityDeclarationIntent.intentId'),
    offerId: stableId(input.offerId, 'abilityDeclarationIntent.offerId'),
    offerSha256: input.offerSha256,
    mapSlug: text(input.mapSlug, 'abilityDeclarationIntent.mapSlug'),
    baseRevision: integer(input.baseRevision, 'abilityDeclarationIntent.baseRevision'),
    actorPlacementId: stableId(input.actorPlacementId, 'abilityDeclarationIntent.actorPlacementId'),
    abilityInstanceId: stableId(input.abilityInstanceId, 'abilityDeclarationIntent.abilityInstanceId'),
    canonicalId: text(input.canonicalId, 'abilityDeclarationIntent.canonicalId'),
    modeId: stableId(input.modeId, 'abilityDeclarationIntent.modeId'),
    selections: Object.freeze(selections),
  }) as AbilityDeclarationIntent
}
