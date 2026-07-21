import type { AbilityInstanceData, AbilityInstanceParameterStatus } from './parameters'
import { parseAbilityEffectDuration, type AbilityEffectDuration } from './durations'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_TRANSFORMATION_STATE_SCHEMA_VERSION = 1 as const
export const ABILITY_TRANSFORMATION_KINDS = ['form', 'disguise', 'illusion', 'copy', 'transformation'] as const
export const ABILITY_TRANSFORMATION_ABILITY_POLICIES = ['preserve', 'add', 'replace'] as const
export const ABILITY_TRANSFORMATION_LIMITS = Object.freeze({
  entries: 128, receipts: 1_024, identifiers: 200, text: 200,
  abilities: 32, moves: 64, types: 8, tags: 64, footprint: 32, revision: 1_000_000,
})
export type AbilityTransformationKind = (typeof ABILITY_TRANSFORMATION_KINDS)[number]
export type AbilityTransformationAbilityPolicy = (typeof ABILITY_TRANSFORMATION_ABILITY_POLICIES)[number]

export interface AbilityTransformationAbilitySnapshot {
  readonly instanceId: string
  readonly canonicalId: string
  readonly definitionHash: string | null
  readonly sourcePlacementId: string | null
  readonly parameterStatus: AbilityInstanceParameterStatus
  readonly parameterData: AbilityInstanceData | null
}
export interface AbilityTransformationMoveSnapshot {
  readonly canonicalMoveId: string
  readonly runtimeVersion: number
  readonly definitionHash: string
}
export interface AbilityTransformationMechanics {
  readonly formId: string | null
  readonly abilityPolicy: AbilityTransformationAbilityPolicy
  readonly abilities: readonly AbilityTransformationAbilitySnapshot[]
  readonly moves: readonly AbilityTransformationMoveSnapshot[]
  readonly typeIds: readonly string[]
  readonly footprint: { readonly base: number; readonly clearance: number } | null
  readonly weightClass: number | null
  readonly capabilityTags: readonly string[]
}
export interface AbilityTransformationCopyBase {
  readonly sourcePlacementId: string
  readonly sourceRevision: number
  readonly sourceReadSha256: string
}
export interface AbilityTransformationPublicPresentation {
  readonly presentationId: string
  readonly labelKey: string
  readonly formId: string | null
  readonly assetId: string | null
}
export interface AbilityTransformationPrivatePresentation {
  readonly truePresentationId: string
  readonly copiedFromPlacementId: string | null
  readonly revealPolicy: 'owner-and-gm' | 'gm-only'
}
export interface AbilityTransformationPresentation {
  readonly public: AbilityTransformationPublicPresentation
  readonly private: AbilityTransformationPrivatePresentation | null
}
export interface AbilityTransformationSnapshot {
  readonly snapshotId: string
  readonly version: 1
  readonly kind: AbilityTransformationKind
  readonly placementId: string
  readonly ownerPlacementId: string
  readonly sourceAbilityInstanceId: string
  readonly canonicalId: string
  readonly sourceOperationId: string
  readonly duration: AbilityEffectDuration
  readonly mechanics: AbilityTransformationMechanics
  readonly copyBase: AbilityTransformationCopyBase | null
  readonly copyBaseSha256: string | null
  readonly presentation: AbilityTransformationPresentation
  readonly createdOperationId: string
}
export interface AbilityTransformationReceipt {
  readonly operationId: string
  readonly snapshotId: string
  readonly requestSha256: string
  readonly outcome: 'created' | 'removed'
}
export interface AbilityTransformationState {
  readonly schemaVersion: typeof ABILITY_TRANSFORMATION_STATE_SCHEMA_VERSION
  readonly entries: readonly AbilityTransformationSnapshot[]
  readonly receipts: readonly AbilityTransformationReceipt[]
}

export class AbilityTransformationValidationError extends Error {
  constructor(readonly code: 'invalid-transformation' | 'limit-exceeded' | 'duplicate-id' | 'not-json', readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityTransformationValidationError'
  }
}
type UnknownRecord = Record<string, unknown>
const ROOT_FIELDS = ['schemaVersion', 'entries', 'receipts'] as const
const ENTRY_FIELDS = [
  'snapshotId', 'version', 'kind', 'placementId', 'ownerPlacementId', 'sourceAbilityInstanceId',
  'canonicalId', 'sourceOperationId', 'duration', 'mechanics', 'copyBase', 'copyBaseSha256',
  'presentation', 'createdOperationId',
] as const
const MECHANICS_FIELDS = ['formId', 'abilityPolicy', 'abilities', 'moves', 'typeIds', 'footprint', 'weightClass', 'capabilityTags'] as const
const ABILITY_FIELDS = ['instanceId', 'canonicalId', 'definitionHash', 'sourcePlacementId', 'parameterStatus', 'parameterData'] as const
const MOVE_FIELDS = ['canonicalMoveId', 'runtimeVersion', 'definitionHash'] as const
const FOOTPRINT_FIELDS = ['base', 'clearance'] as const
const COPY_FIELDS = ['sourcePlacementId', 'sourceRevision', 'sourceReadSha256'] as const
const PRESENTATION_FIELDS = ['public', 'private'] as const
const PUBLIC_FIELDS = ['presentationId', 'labelKey', 'formId', 'assetId'] as const
const PRIVATE_FIELDS = ['truePresentationId', 'copiedFromPlacementId', 'revealPolicy'] as const
const RECEIPT_FIELDS = ['operationId', 'snapshotId', 'requestSha256', 'outcome'] as const
const INSTANCE_FIELDS = ['schemaVersion', 'instanceId', 'canonicalId', 'definitionVersion', 'selections'] as const
const KIND_SET = new Set<string>(ABILITY_TRANSFORMATION_KINDS)
const POLICY_SET = new Set<string>(ABILITY_TRANSFORMATION_ABILITY_POLICIES)
const PARAMETER_STATUS_SET = new Set<string>(['ready', 'missing-required-data', 'not-parameterized'])
const HASH = /^[a-f0-9]{64}$/
const ID = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const fail = (code: AbilityTransformationValidationError['code'], path: string, detail: string): never => {
  throw new AbilityTransformationValidationError(code, path, detail)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail('invalid-transformation', path, 'must be an object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const supported = new Set(fields)
  if (fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))
    || Object.keys(value).some(field => !supported.has(field))) fail('invalid-transformation', path, 'has invalid shape.')
}
const id = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > ABILITY_TRANSFORMATION_LIMITS.identifiers || !ID.test(value)) {
    fail('invalid-transformation', path, 'must be a bounded stable ID.')
  }
  return value as string
}
const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > ABILITY_TRANSFORMATION_LIMITS.text
    || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) fail('invalid-transformation', path, 'must be bounded text.')
  return value as string
}
const nullableId = (value: unknown, path: string): string | null => value === null ? null : id(value, path)
const integer = (value: unknown, path: string, minimum: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail('invalid-transformation', path, `must be an integer from ${minimum} through ${maximum}.`)
  }
  return Number(value)
}
const hash = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !HASH.test(value)) fail('invalid-transformation', path, 'must be SHA-256.')
  return value as string
}
const optionalHash = (value: unknown, path: string): string | null => value === null ? null : hash(value, path)
const orderedIds = (value: unknown, path: string, maximum: number): readonly string[] => {
  if (!Array.isArray(value) || value.length > maximum) fail('limit-exceeded', path, 'must be a bounded array.')
  const values = (value as unknown[]).map((entry, index) => id(entry, `${path}[${index}]`))
  if (new Set(values).size !== values.length || values.some((entry, index) => index > 0 && entry <= values[index - 1]!)) {
    fail('duplicate-id', path, 'must be unique in code-point order.')
  }
  return Object.freeze(values)
}
const parseParameterData = (
  value: unknown,
  instanceId: string,
  canonicalId: string,
  path: string,
): AbilityInstanceData | null => {
  if (value === null) return null
  const input = record(value, path)
  exact(input, INSTANCE_FIELDS, path)
  if (input.schemaVersion !== 1 || input.instanceId !== instanceId || input.canonicalId !== canonicalId
    || !(input.definitionVersion === null || Number.isSafeInteger(input.definitionVersion))
    || !Array.isArray(input.selections)) fail('invalid-transformation', path, 'does not match its copied ability identity.')
  return input as unknown as AbilityInstanceData
}
const parseMechanics = (value: unknown, path: string): AbilityTransformationMechanics => {
  const input = record(value, path)
  exact(input, MECHANICS_FIELDS, path)
  if (typeof input.abilityPolicy !== 'string' || !POLICY_SET.has(input.abilityPolicy)) {
    fail('invalid-transformation', `${path}.abilityPolicy`, 'is unsupported.')
  }
  if (!Array.isArray(input.abilities) || input.abilities.length > ABILITY_TRANSFORMATION_LIMITS.abilities) {
    fail('limit-exceeded', `${path}.abilities`, 'must be bounded.')
  }
  const abilities = (input.abilities as unknown[]).map((entry, index): AbilityTransformationAbilitySnapshot => {
    const itemPath = `${path}.abilities[${index}]`
    const item = record(entry, itemPath)
    exact(item, ABILITY_FIELDS, itemPath)
    const instanceId = id(item.instanceId, `${itemPath}.instanceId`)
    const canonicalId = text(item.canonicalId, `${itemPath}.canonicalId`)
    if (typeof item.parameterStatus !== 'string' || !PARAMETER_STATUS_SET.has(item.parameterStatus)) {
      fail('invalid-transformation', `${itemPath}.parameterStatus`, 'is unsupported.')
    }
    const parameterStatus = item.parameterStatus as AbilityInstanceParameterStatus
    const parameterData = parseParameterData(item.parameterData, instanceId, canonicalId, `${itemPath}.parameterData`)
    if ((parameterStatus === 'ready') !== (parameterData !== null)) {
      fail('invalid-transformation', itemPath, 'ready status must carry parameter data and other statuses must not.')
    }
    return Object.freeze({
      instanceId, canonicalId,
      definitionHash: optionalHash(item.definitionHash, `${itemPath}.definitionHash`),
      sourcePlacementId: nullableId(item.sourcePlacementId, `${itemPath}.sourcePlacementId`),
      parameterStatus, parameterData,
    })
  })
  if (new Set(abilities.map(entry => entry.instanceId)).size !== abilities.length) {
    fail('duplicate-id', `${path}.abilities`, 'must not repeat instance IDs.')
  }
  if (!Array.isArray(input.moves) || input.moves.length > ABILITY_TRANSFORMATION_LIMITS.moves) {
    fail('limit-exceeded', `${path}.moves`, 'must be bounded.')
  }
  const moves = (input.moves as unknown[]).map((entry, index): AbilityTransformationMoveSnapshot => {
    const itemPath = `${path}.moves[${index}]`
    const item = record(entry, itemPath)
    exact(item, MOVE_FIELDS, itemPath)
    return Object.freeze({
      canonicalMoveId: text(item.canonicalMoveId, `${itemPath}.canonicalMoveId`),
      runtimeVersion: integer(item.runtimeVersion, `${itemPath}.runtimeVersion`, 1, 1_000_000),
      definitionHash: hash(item.definitionHash, `${itemPath}.definitionHash`),
    })
  })
  if (new Set(moves.map(entry => entry.canonicalMoveId)).size !== moves.length) {
    fail('duplicate-id', `${path}.moves`, 'must not repeat canonical moves.')
  }
  let footprint: AbilityTransformationMechanics['footprint'] = null
  if (input.footprint !== null) {
    const item = record(input.footprint, `${path}.footprint`)
    exact(item, FOOTPRINT_FIELDS, `${path}.footprint`)
    footprint = Object.freeze({
      base: integer(item.base, `${path}.footprint.base`, 1, ABILITY_TRANSFORMATION_LIMITS.footprint),
      clearance: integer(item.clearance, `${path}.footprint.clearance`, 1, ABILITY_TRANSFORMATION_LIMITS.footprint),
    })
  }
  return Object.freeze({
    formId: nullableId(input.formId, `${path}.formId`),
    abilityPolicy: input.abilityPolicy as AbilityTransformationAbilityPolicy,
    abilities: Object.freeze(abilities), moves: Object.freeze(moves),
    typeIds: orderedIds(input.typeIds, `${path}.typeIds`, ABILITY_TRANSFORMATION_LIMITS.types),
    footprint,
    weightClass: input.weightClass === null ? null : integer(input.weightClass, `${path}.weightClass`, 1, 1_000_000),
    capabilityTags: orderedIds(input.capabilityTags, `${path}.capabilityTags`, ABILITY_TRANSFORMATION_LIMITS.tags),
  })
}
const neutralMechanics = (value: AbilityTransformationMechanics): boolean => value.formId === null
  && value.abilityPolicy === 'preserve' && value.abilities.length === 0 && value.moves.length === 0
  && value.typeIds.length === 0 && value.footprint === null && value.weightClass === null
  && value.capabilityTags.length === 0
const parseCopyBase = (value: unknown, path: string): AbilityTransformationCopyBase | null => {
  if (value === null) return null
  const input = record(value, path)
  exact(input, COPY_FIELDS, path)
  return Object.freeze({
    sourcePlacementId: id(input.sourcePlacementId, `${path}.sourcePlacementId`),
    sourceRevision: integer(input.sourceRevision, `${path}.sourceRevision`, 0, ABILITY_TRANSFORMATION_LIMITS.revision),
    sourceReadSha256: hash(input.sourceReadSha256, `${path}.sourceReadSha256`),
  })
}
const parsePresentation = (value: unknown, path: string): AbilityTransformationPresentation => {
  const input = record(value, path)
  exact(input, PRESENTATION_FIELDS, path)
  const publicInput = record(input.public, `${path}.public`)
  exact(publicInput, PUBLIC_FIELDS, `${path}.public`)
  const publicPresentation = Object.freeze({
    presentationId: id(publicInput.presentationId, `${path}.public.presentationId`),
    labelKey: id(publicInput.labelKey, `${path}.public.labelKey`),
    formId: nullableId(publicInput.formId, `${path}.public.formId`),
    assetId: nullableId(publicInput.assetId, `${path}.public.assetId`),
  })
  if (input.private === null) return Object.freeze({ public: publicPresentation, private: null })
  const privateInput = record(input.private, `${path}.private`)
  exact(privateInput, PRIVATE_FIELDS, `${path}.private`)
  if (privateInput.revealPolicy !== 'owner-and-gm' && privateInput.revealPolicy !== 'gm-only') {
    fail('invalid-transformation', `${path}.private.revealPolicy`, 'is unsupported.')
  }
  return Object.freeze({
    public: publicPresentation,
    private: Object.freeze({
      truePresentationId: id(privateInput.truePresentationId, `${path}.private.truePresentationId`),
      copiedFromPlacementId: nullableId(privateInput.copiedFromPlacementId, `${path}.private.copiedFromPlacementId`),
      revealPolicy: privateInput.revealPolicy as 'owner-and-gm' | 'gm-only',
    }),
  })
}
export const createEmptyAbilityTransformationState = (): AbilityTransformationState => deepFreezeStrictJson({
  schemaVersion: ABILITY_TRANSFORMATION_STATE_SCHEMA_VERSION, entries: [], receipts: [],
})
export const parseAbilityTransformationState = (
  value: unknown,
  path = 'abilityTransformations',
): AbilityTransformationState => {
  const cloned = cloneStrictJson(value, path, {
    limits: { depth: 14, nodes: 65_536, objectFields: 32, arrayEntries: ABILITY_TRANSFORMATION_LIMITS.receipts, stringLength: 500, objectKeyLength: 200 },
    rootLabel: 'ability transformation state', valueLabel: 'ability transformation values',
    failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
    failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
  })
  const input = record(cloned, path)
  exact(input, ROOT_FIELDS, path)
  if (input.schemaVersion !== ABILITY_TRANSFORMATION_STATE_SCHEMA_VERSION) fail('invalid-transformation', `${path}.schemaVersion`, 'is unsupported.')
  if (!Array.isArray(input.entries) || input.entries.length > ABILITY_TRANSFORMATION_LIMITS.entries) fail('limit-exceeded', `${path}.entries`, 'must be bounded.')
  const entries = (input.entries as unknown[]).map((entry, index): AbilityTransformationSnapshot => {
    const entryPath = `${path}.entries[${index}]`
    const item = record(entry, entryPath)
    exact(item, ENTRY_FIELDS, entryPath)
    if (typeof item.kind !== 'string' || !KIND_SET.has(item.kind)) fail('invalid-transformation', `${entryPath}.kind`, 'is unsupported.')
    const kind = item.kind as AbilityTransformationKind
    const mechanics = parseMechanics(item.mechanics, `${entryPath}.mechanics`)
    const copyBase = parseCopyBase(item.copyBase, `${entryPath}.copyBase`)
    const copyBaseSha256 = optionalHash(item.copyBaseSha256, `${entryPath}.copyBaseSha256`)
    if ((kind === 'copy' || kind === 'transformation') !== (copyBase !== null && copyBaseSha256 !== null)) {
      fail('invalid-transformation', entryPath, 'copy and transformation alone require a copy base and hash.')
    }
    if ((kind === 'disguise' || kind === 'illusion') && !neutralMechanics(mechanics)) {
      fail('invalid-transformation', `${entryPath}.mechanics`, 'disguise and illusion presentation cannot mutate mechanics.')
    }
    if (kind === 'transformation' && mechanics.abilityPolicy !== 'replace') {
      fail('invalid-transformation', `${entryPath}.mechanics.abilityPolicy`, 'full transformation must replace abilities.')
    }
    const presentation = parsePresentation(item.presentation, `${entryPath}.presentation`)
    if ((kind === 'disguise' || kind === 'illusion') && presentation.private === null) {
      fail('invalid-transformation', `${entryPath}.presentation.private`, 'concealed presentation requires a private truth.')
    }
    return Object.freeze({
      snapshotId: id(item.snapshotId, `${entryPath}.snapshotId`), version: item.version === 1 ? 1 : fail('invalid-transformation', `${entryPath}.version`, 'must be 1.'),
      kind, placementId: id(item.placementId, `${entryPath}.placementId`),
      ownerPlacementId: id(item.ownerPlacementId, `${entryPath}.ownerPlacementId`),
      sourceAbilityInstanceId: id(item.sourceAbilityInstanceId, `${entryPath}.sourceAbilityInstanceId`),
      canonicalId: text(item.canonicalId, `${entryPath}.canonicalId`),
      sourceOperationId: id(item.sourceOperationId, `${entryPath}.sourceOperationId`),
      duration: parseAbilityEffectDuration(item.duration, `${entryPath}.duration`),
      mechanics, copyBase, copyBaseSha256, presentation,
      createdOperationId: id(item.createdOperationId, `${entryPath}.createdOperationId`),
    })
  })
  if (new Set(entries.map(entry => entry.snapshotId)).size !== entries.length) fail('duplicate-id', `${path}.entries`, 'must not repeat snapshot IDs.')
  if (!Array.isArray(input.receipts) || input.receipts.length > ABILITY_TRANSFORMATION_LIMITS.receipts) fail('limit-exceeded', `${path}.receipts`, 'must be bounded.')
  const receipts = (input.receipts as unknown[]).map((entry, index): AbilityTransformationReceipt => {
    const receiptPath = `${path}.receipts[${index}]`
    const item = record(entry, receiptPath)
    exact(item, RECEIPT_FIELDS, receiptPath)
    if (item.outcome !== 'created' && item.outcome !== 'removed') fail('invalid-transformation', `${receiptPath}.outcome`, 'is unsupported.')
    return Object.freeze({
      operationId: id(item.operationId, `${receiptPath}.operationId`),
      snapshotId: id(item.snapshotId, `${receiptPath}.snapshotId`),
      requestSha256: hash(item.requestSha256, `${receiptPath}.requestSha256`),
      outcome: item.outcome as 'created' | 'removed',
    })
  })
  if (new Set(receipts.map(entry => entry.operationId)).size !== receipts.length) fail('duplicate-id', `${path}.receipts`, 'must not repeat operation IDs.')
  return deepFreezeStrictJson({ schemaVersion: 1, entries: Object.freeze(entries), receipts: Object.freeze(receipts) })
}

export interface AbilityTransformationPublicView {
  readonly snapshotId: string
  readonly placementId: string
  readonly publicPresentation: AbilityTransformationPublicPresentation
}
export interface AbilityTransformationAuthorizedView extends AbilityTransformationPublicView {
  readonly kind: AbilityTransformationKind
  readonly ownerPlacementId: string
  readonly canonicalId: string
  readonly sourceAbilityInstanceId: string
  readonly privatePresentation: AbilityTransformationPrivatePresentation | null
}
/** Default-deny presentation projection; public viewers never receive mechanic/source/private truth. */
export const projectAbilityTransformationView = (input: {
  readonly snapshot: AbilityTransformationSnapshot
  readonly authorization: 'public' | 'owner' | 'gm'
  readonly viewerPlacementId?: string | null
}): AbilityTransformationPublicView | AbilityTransformationAuthorizedView => {
  const base = {
    snapshotId: input.snapshot.snapshotId,
    placementId: input.snapshot.placementId,
    publicPresentation: input.snapshot.presentation.public,
  }
  const ownerAllowed = input.authorization === 'owner'
    && input.viewerPlacementId === input.snapshot.ownerPlacementId
    && input.snapshot.presentation.private?.revealPolicy === 'owner-and-gm'
  const authorized = input.authorization === 'gm' || ownerAllowed
  return deepFreezeStrictJson(authorized ? {
    ...base,
    kind: input.snapshot.kind,
    ownerPlacementId: input.snapshot.ownerPlacementId,
    canonicalId: input.snapshot.canonicalId,
    sourceAbilityInstanceId: input.snapshot.sourceAbilityInstanceId,
    privatePresentation: input.snapshot.presentation.private,
  } : base)
}
