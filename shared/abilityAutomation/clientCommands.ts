import { ABILITY_SPEC_TARGETING_KINDS, type AbilitySpecTargetingKind } from './spec'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_CLIENT_COMMAND_SCHEMA_VERSION = 1 as const
export type AbilityClientOptionHint =
  | { readonly kind: 'none' }
  | { readonly kind: 'placement'; readonly placementId: string }
  | { readonly kind: 'side'; readonly sideId: string }
  | { readonly kind: 'cell'; readonly x: number; readonly y: number; readonly z: number }
  | { readonly kind: 'field' | 'direction' | 'type' | 'stat' | 'move' | 'ability' | 'item' | 'branch'; readonly valueId: string }
export interface AbilityClientDeclarationOption {
  readonly optionId: string
  readonly presentationKey: string
  readonly hint: AbilityClientOptionHint
}
export interface AbilityClientDeclaration {
  readonly declarationId: string
  readonly kind: AbilitySpecTargetingKind
  readonly minSelections: number
  readonly maxSelections: number
  readonly options: readonly AbilityClientDeclarationOption[]
}
export interface AbilityClientDeclarationOffer {
  readonly schemaVersion: typeof ABILITY_CLIENT_COMMAND_SCHEMA_VERSION
  readonly offerId: string
  readonly offerSha256: string
  readonly mapSlug: string
  readonly mapRevision: number
  readonly expiresAt: number
  readonly actorPlacementId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly modeId: string
  readonly declarations: readonly AbilityClientDeclaration[]
}
export interface BeginAbilityClientDeclarationCommand {
  readonly schemaVersion: typeof ABILITY_CLIENT_COMMAND_SCHEMA_VERSION
  readonly requestId: string
  readonly mapSlug: string
  readonly baseRevision: number
  readonly actorPlacementId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly modeId: string
}
export const ABILITY_CLIENT_COMMAND_LIMITS = Object.freeze({
  declarations: 64, options: 512, selected: 32, identifier: 200, coordinate: 1_000_000,
})
export class AbilityClientCommandValidationError extends Error {
  constructor(readonly code: 'invalid-command' | 'limit-exceeded' | 'duplicate-id' | 'not-json', readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityClientCommandValidationError'
  }
}
type UnknownRecord = Record<string, unknown>
const BEGIN_FIELDS = ['schemaVersion', 'requestId', 'mapSlug', 'baseRevision', 'actorPlacementId', 'abilityInstanceId', 'canonicalId', 'modeId'] as const
const OFFER_FIELDS = ['schemaVersion', 'offerId', 'offerSha256', 'mapSlug', 'mapRevision', 'expiresAt', 'actorPlacementId', 'abilityInstanceId', 'canonicalId', 'modeId', 'declarations'] as const
const DECLARATION_FIELDS = ['declarationId', 'kind', 'minSelections', 'maxSelections', 'options'] as const
const OPTION_FIELDS = ['optionId', 'presentationKey', 'hint'] as const
const TARGETING_SET = new Set<string>(ABILITY_SPEC_TARGETING_KINDS)
const ID = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SHA256 = /^[a-f0-9]{64}$/
const fail = (code: AbilityClientCommandValidationError['code'], path: string, detail: string): never => { throw new AbilityClientCommandValidationError(code, path, detail) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail('invalid-command', path, 'must be an object.')
  return value as UnknownRecord
}
const exact = (input: UnknownRecord, fields: readonly string[], path: string): void => {
  const set = new Set(fields)
  if (fields.some(field => !Object.prototype.hasOwnProperty.call(input, field))
    || Object.keys(input).some(field => !set.has(field))) fail('invalid-command', path, 'has invalid shape.')
}
const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > ABILITY_CLIENT_COMMAND_LIMITS.identifier
    || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) fail('invalid-command', path, 'must be bounded text.')
  return value as string
}
const stableId = (value: unknown, path: string): string => {
  const id = text(value, path)
  if (!ID.test(id)) fail('invalid-command', path, 'must be a stable ID.')
  return id
}
const integer = (value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) fail('invalid-command', path, 'must be a bounded non-negative integer.')
  return Number(value)
}
const targetingKind = (value: unknown, path: string): AbilitySpecTargetingKind => (
  typeof value === 'string' && TARGETING_SET.has(value) ? value as AbilitySpecTargetingKind : fail('invalid-command', path, 'is unsupported.')
)
const clone = (value: unknown, path: string): unknown => cloneStrictJson(value, path, {
  limits: { depth: 8, nodes: 131_072, objectFields: 20, arrayEntries: 1_024, stringLength: 500, objectKeyLength: 200 },
  rootLabel: 'ability client command', valueLabel: 'ability client command values',
  failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
  failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
})
const parseHint = (value: unknown, path: string): AbilityClientOptionHint => {
  const input = record(value, path)
  const kind = input.kind
  if (kind === 'none') { exact(input, ['kind'], path); return Object.freeze({ kind }) }
  if (kind === 'placement') { exact(input, ['kind', 'placementId'], path); return Object.freeze({ kind, placementId: stableId(input.placementId, `${path}.placementId`) }) }
  if (kind === 'side') { exact(input, ['kind', 'sideId'], path); return Object.freeze({ kind, sideId: stableId(input.sideId, `${path}.sideId`) }) }
  if (kind === 'cell') {
    exact(input, ['kind', 'x', 'y', 'z'], path)
    return Object.freeze({ kind, x: integer(input.x, `${path}.x`, ABILITY_CLIENT_COMMAND_LIMITS.coordinate), y: integer(input.y, `${path}.y`, ABILITY_CLIENT_COMMAND_LIMITS.coordinate), z: integer(input.z, `${path}.z`, ABILITY_CLIENT_COMMAND_LIMITS.coordinate) })
  }
  if (typeof kind === 'string' && ['field', 'direction', 'type', 'stat', 'move', 'ability', 'item', 'branch'].includes(kind)) {
    exact(input, ['kind', 'valueId'], path)
    return Object.freeze({ kind, valueId: stableId(input.valueId, `${path}.valueId`) }) as AbilityClientOptionHint
  }
  return fail('invalid-command', `${path}.kind`, 'is unsupported.')
}
export const parseBeginAbilityClientDeclarationCommand = (value: unknown): BeginAbilityClientDeclarationCommand => {
  const input = record(clone(value, 'beginAbilityDeclaration'), 'beginAbilityDeclaration')
  exact(input, BEGIN_FIELDS, 'beginAbilityDeclaration')
  if (input.schemaVersion !== 1) fail('invalid-command', 'beginAbilityDeclaration.schemaVersion', 'is unsupported.')
  return deepFreezeStrictJson({
    schemaVersion: 1, requestId: stableId(input.requestId, 'beginAbilityDeclaration.requestId'),
    mapSlug: text(input.mapSlug, 'beginAbilityDeclaration.mapSlug'), baseRevision: integer(input.baseRevision, 'beginAbilityDeclaration.baseRevision'),
    actorPlacementId: stableId(input.actorPlacementId, 'beginAbilityDeclaration.actorPlacementId'),
    abilityInstanceId: stableId(input.abilityInstanceId, 'beginAbilityDeclaration.abilityInstanceId'),
    canonicalId: text(input.canonicalId, 'beginAbilityDeclaration.canonicalId'), modeId: stableId(input.modeId, 'beginAbilityDeclaration.modeId'),
  })
}
export const parseAbilityClientDeclarationOffer = (value: unknown): AbilityClientDeclarationOffer => {
  const input = record(clone(value, 'abilityDeclarationClientOffer'), 'abilityDeclarationClientOffer')
  exact(input, OFFER_FIELDS, 'abilityDeclarationClientOffer')
  if (input.schemaVersion !== 1 || typeof input.offerSha256 !== 'string' || !SHA256.test(input.offerSha256)) {
    fail('invalid-command', 'abilityDeclarationClientOffer', 'has invalid version or hash.')
  }
  if (!Array.isArray(input.declarations) || input.declarations.length > ABILITY_CLIENT_COMMAND_LIMITS.declarations) fail('limit-exceeded', 'abilityDeclarationClientOffer.declarations', 'must be bounded.')
  const declarations = (input.declarations as unknown[]).map((entry, index): AbilityClientDeclaration => {
    const path = `abilityDeclarationClientOffer.declarations[${index}]`
    const item = record(entry, path); exact(item, DECLARATION_FIELDS, path)
    const minSelections = integer(item.minSelections, `${path}.minSelections`, ABILITY_CLIENT_COMMAND_LIMITS.selected)
    const maxSelections = integer(item.maxSelections, `${path}.maxSelections`, ABILITY_CLIENT_COMMAND_LIMITS.selected)
    if (!Array.isArray(item.options) || item.options.length > ABILITY_CLIENT_COMMAND_LIMITS.options || minSelections > maxSelections || maxSelections > item.options.length) fail('invalid-command', path, 'has invalid selection bounds or options.')
    const options = (item.options as unknown[]).map((option, optionIndex): AbilityClientDeclarationOption => {
      const optionPath = `${path}.options[${optionIndex}]`; const optionInput = record(option, optionPath); exact(optionInput, OPTION_FIELDS, optionPath)
      return Object.freeze({ optionId: stableId(optionInput.optionId, `${optionPath}.optionId`), presentationKey: stableId(optionInput.presentationKey, `${optionPath}.presentationKey`), hint: parseHint(optionInput.hint, `${optionPath}.hint`) })
    })
    if (new Set(options.map(option => option.optionId)).size !== options.length) fail('duplicate-id', `${path}.options`, 'must not repeat IDs.')
    return Object.freeze({ declarationId: stableId(item.declarationId, `${path}.declarationId`), kind: targetingKind(item.kind, `${path}.kind`), minSelections, maxSelections, options: Object.freeze(options) })
  })
  if (new Set(declarations.map(entry => entry.declarationId)).size !== declarations.length) fail('duplicate-id', 'abilityDeclarationClientOffer.declarations', 'must not repeat IDs.')
  return deepFreezeStrictJson({
    schemaVersion: 1, offerId: stableId(input.offerId, 'abilityDeclarationClientOffer.offerId'), offerSha256: input.offerSha256 as string,
    mapSlug: text(input.mapSlug, 'abilityDeclarationClientOffer.mapSlug'), mapRevision: integer(input.mapRevision, 'abilityDeclarationClientOffer.mapRevision'), expiresAt: integer(input.expiresAt, 'abilityDeclarationClientOffer.expiresAt'),
    actorPlacementId: stableId(input.actorPlacementId, 'abilityDeclarationClientOffer.actorPlacementId'), abilityInstanceId: stableId(input.abilityInstanceId, 'abilityDeclarationClientOffer.abilityInstanceId'),
    canonicalId: text(input.canonicalId, 'abilityDeclarationClientOffer.canonicalId'), modeId: stableId(input.modeId, 'abilityDeclarationClientOffer.modeId'), declarations: Object.freeze(declarations),
  })
}
