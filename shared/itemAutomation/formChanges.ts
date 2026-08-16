import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ITEM_FORM_CHANGE_SCHEMA_VERSION = 1 as const
export const ITEM_FORM_CHANGE_ACTION_ID = 'item.form-change.mega-evolve' as const
export const ITEM_FORM_CHANGE_TARGET_CHOICE_ID = 'target' as const
export const ITEM_FORM_CHANGE_ABILITY_CHOICE_ID = 'mega-ability' as const
export const ITEM_FORM_CHANGE_LIMITS = Object.freeze({ entries: 128, text: 200, hash: 64 })

export type ItemFormChangeDurationV1 =
  | { readonly kind: 'scene'; readonly sceneStartedAt: number }
  | { readonly kind: 'persistent'; readonly sceneStartedAt: null }

export interface ItemFormChangeEntryV1 {
  readonly entryId: string
  readonly placementId: string
  readonly pokemonSheetSlug: string
  readonly trainerSheetSlug: string
  readonly formId: string
  readonly ruleRecordSha256: string
  readonly formRecordSha256: string
  readonly baseSpeciesRecordSha256: string
  readonly abilityRecordSha256: string
  readonly abilityId: string
  readonly duration: ItemFormChangeDurationV1
  readonly sourceKind: 'mega-ring-and-stone' | 'mega-ring-delta-evolution'
  readonly ringInstanceId: string
  readonly ringInstanceRevision: number
  readonly ringCanonicalRecordSha256: string
  readonly ringEquipmentDefinitionSha256: string
  readonly stoneInstanceId: string | null
  readonly stoneInstanceRevision: number | null
  readonly stoneCanonicalRecordSha256: string | null
  readonly stoneEquipmentDefinitionSha256: string | null
  readonly sourceOperationId: string
  readonly acceptedAt: number
}

export interface ItemFormChangeStateV1 {
  readonly schemaVersion: typeof ITEM_FORM_CHANGE_SCHEMA_VERSION
  readonly entries: readonly ItemFormChangeEntryV1[]
}

export interface ItemFormChangeReadRefV1 {
  readonly kind: 'map' | 'sheet'
  readonly sheetKind: 'pokemon' | 'trainer' | null
  readonly id: string
  readonly revision: number
}

export interface ExecuteItemFormChangeCommandV1 {
  readonly schemaVersion: typeof ITEM_FORM_CHANGE_SCHEMA_VERSION
  readonly operationId: string
  readonly offerId: string
  readonly mapSlug: string
  readonly baseRevision: number
  readonly actorPlacementId: string
  readonly targetPlacementId: string
  readonly abilityOptionId: string | null
  readonly readSet: readonly ItemFormChangeReadRefV1[]
}

export interface ItemFormChangePublicResultV1 {
  readonly schemaVersion: typeof ITEM_FORM_CHANGE_SCHEMA_VERSION
  readonly operationId: string
  readonly mapSlug: string
  readonly mapRevision: number
  readonly actorPlacementId: string
  readonly targetPlacementId: string
  readonly formName: string
  readonly abilityName: string
  readonly durationLabel: 'Scene'
  readonly status: 'accepted'
  readonly exactReplay: boolean
  readonly message: string
}

export class ItemFormChangeValidationError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'ItemFormChangeValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[a-f0-9]{64}$/
const STABLE_ID = /^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/
const fail = (path: string, detail: string): never => { throw new ItemFormChangeValidationError(path, detail) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail(path, 'must be a plain object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.hasOwn(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length || unknown.length) fail(path, `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`)
}
const text = (value: unknown, path: string, maximum: number = ITEM_FORM_CHANGE_LIMITS.text): string => {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(value)) fail(path, `must be trimmed text of at most ${maximum} characters.`)
  return value as string
}
const stableId = (value: unknown, path: string): string => {
  const id = text(value, path)
  if (!STABLE_ID.test(id)) fail(path, 'must be a stable identity.')
  return id
}
const hash = (value: unknown, path: string): string => {
  const digest = text(value, path, 64)
  if (!SHA256.test(digest)) fail(path, 'must be a lowercase SHA-256 digest.')
  return digest
}
const integer = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(path, 'must be a non-negative safe integer.')
  return Number(value)
}
const array = (value: unknown, path: string, maximum: number): readonly unknown[] => {
  if (!Array.isArray(value) || value.length > maximum) fail(path, `must be an array with at most ${maximum} entries.`)
  return value as readonly unknown[]
}
const nullableText = (value: unknown, path: string): string | null => value === null ? null : stableId(value, path)
const nullableHash = (value: unknown, path: string): string | null => value === null ? null : hash(value, path)
const nullableInteger = (value: unknown, path: string): number | null => value === null ? null : integer(value, path)

const parseDuration = (value: unknown, path: string): ItemFormChangeDurationV1 => {
  const input = record(value, path)
  exact(input, ['kind', 'sceneStartedAt'], path)
  if (input.kind === 'scene') return { kind: 'scene', sceneStartedAt: integer(input.sceneStartedAt, `${path}.sceneStartedAt`) }
  if (input.kind === 'persistent' && input.sceneStartedAt === null) return { kind: 'persistent', sceneStartedAt: null }
  return fail(path, 'must be a supported duration with a matching Scene identity.')
}

const parseEntry = (value: unknown, path: string): ItemFormChangeEntryV1 => {
  const input = record(value, path)
  exact(input, [
    'entryId', 'placementId', 'pokemonSheetSlug', 'trainerSheetSlug', 'formId',
    'ruleRecordSha256', 'formRecordSha256', 'baseSpeciesRecordSha256', 'abilityRecordSha256', 'abilityId',
    'duration', 'sourceKind', 'ringInstanceId', 'ringInstanceRevision',
    'ringCanonicalRecordSha256', 'ringEquipmentDefinitionSha256',
    'stoneInstanceId', 'stoneInstanceRevision', 'stoneCanonicalRecordSha256',
    'stoneEquipmentDefinitionSha256', 'sourceOperationId', 'acceptedAt',
  ], path)
  if (input.sourceKind !== 'mega-ring-and-stone' && input.sourceKind !== 'mega-ring-delta-evolution') {
    fail(`${path}.sourceKind`, 'is unsupported.')
  }
  const stoneInstanceId = nullableText(input.stoneInstanceId, `${path}.stoneInstanceId`)
  const stoneInstanceRevision = nullableInteger(input.stoneInstanceRevision, `${path}.stoneInstanceRevision`)
  const stoneCanonicalRecordSha256 = nullableHash(input.stoneCanonicalRecordSha256, `${path}.stoneCanonicalRecordSha256`)
  const stoneEquipmentDefinitionSha256 = nullableHash(input.stoneEquipmentDefinitionSha256, `${path}.stoneEquipmentDefinitionSha256`)
  if ((stoneInstanceId === null) !== (stoneInstanceRevision === null)
    || (stoneInstanceId === null) !== (stoneCanonicalRecordSha256 === null)
    || (stoneInstanceId === null) !== (stoneEquipmentDefinitionSha256 === null)
    || (input.sourceKind === 'mega-ring-and-stone') !== (stoneInstanceId !== null)) {
    fail(path, 'stone identity must match the reviewed source kind.')
  }
  return {
    entryId: stableId(input.entryId, `${path}.entryId`),
    placementId: text(input.placementId, `${path}.placementId`),
    pokemonSheetSlug: stableId(input.pokemonSheetSlug, `${path}.pokemonSheetSlug`),
    trainerSheetSlug: stableId(input.trainerSheetSlug, `${path}.trainerSheetSlug`),
    formId: stableId(input.formId, `${path}.formId`),
    ruleRecordSha256: hash(input.ruleRecordSha256, `${path}.ruleRecordSha256`),
    formRecordSha256: hash(input.formRecordSha256, `${path}.formRecordSha256`),
    baseSpeciesRecordSha256: hash(input.baseSpeciesRecordSha256, `${path}.baseSpeciesRecordSha256`),
    abilityRecordSha256: hash(input.abilityRecordSha256, `${path}.abilityRecordSha256`),
    abilityId: text(input.abilityId, `${path}.abilityId`),
    duration: parseDuration(input.duration, `${path}.duration`),
    sourceKind: input.sourceKind as ItemFormChangeEntryV1['sourceKind'],
    ringInstanceId: stableId(input.ringInstanceId, `${path}.ringInstanceId`),
    ringInstanceRevision: integer(input.ringInstanceRevision, `${path}.ringInstanceRevision`),
    ringCanonicalRecordSha256: hash(input.ringCanonicalRecordSha256, `${path}.ringCanonicalRecordSha256`),
    ringEquipmentDefinitionSha256: hash(input.ringEquipmentDefinitionSha256, `${path}.ringEquipmentDefinitionSha256`),
    stoneInstanceId,
    stoneInstanceRevision,
    stoneCanonicalRecordSha256,
    stoneEquipmentDefinitionSha256,
    sourceOperationId: stableId(input.sourceOperationId, `${path}.sourceOperationId`),
    acceptedAt: integer(input.acceptedAt, `${path}.acceptedAt`),
  }
}

export const createEmptyItemFormChangeState = (): ItemFormChangeStateV1 => ({ schemaVersion: 1, entries: [] })

export const parseItemFormChangeState = (value: unknown): ItemFormChangeStateV1 => {
  if (value === undefined || value === null) return createEmptyItemFormChangeState()
  const cloned = cloneStrictJson(value, 'itemFormChanges', {
    limits: { depth: 8, nodes: 8_000, objectFields: 32, arrayEntries: 256, stringLength: 500, objectKeyLength: 100 },
    rootLabel: 'item form-change state', valueLabel: 'item form-change state values',
    failNotJson: (path, detail) => fail(path, detail), failLimit: (path, detail) => fail(path, detail),
  })
  const input = record(cloned, 'itemFormChanges')
  exact(input, ['schemaVersion', 'entries'], 'itemFormChanges')
  if (input.schemaVersion !== 1) fail('itemFormChanges.schemaVersion', 'is unsupported.')
  const entries = array(input.entries, 'itemFormChanges.entries', ITEM_FORM_CHANGE_LIMITS.entries)
    .map((entry, index) => parseEntry(entry, `itemFormChanges.entries[${index}]`))
  const identities = entries.map(entry => entry.entryId)
  if (new Set(identities).size !== identities.length) fail('itemFormChanges.entries', 'contains duplicate entry identities.')
  const placements = entries.map(entry => entry.placementId)
  if (new Set(placements).size !== placements.length) fail('itemFormChanges.entries', 'contains more than one active form per placement.')
  return deepFreezeStrictJson({ schemaVersion: 1, entries })
}

const parseReadRef = (value: unknown, path: string): ItemFormChangeReadRefV1 => {
  const input = record(value, path)
  exact(input, ['kind', 'sheetKind', 'id', 'revision'], path)
  if (input.kind === 'map' && input.sheetKind !== null) fail(path, 'map reads cannot declare a sheet kind.')
  if (input.kind === 'sheet' && input.sheetKind !== 'pokemon' && input.sheetKind !== 'trainer') fail(path, 'sheet reads require a supported sheet kind.')
  if (input.kind !== 'map' && input.kind !== 'sheet') fail(`${path}.kind`, 'is unsupported.')
  return {
    kind: input.kind as ItemFormChangeReadRefV1['kind'],
    sheetKind: input.sheetKind as 'pokemon' | 'trainer' | null,
    id: stableId(input.id, `${path}.id`),
    revision: integer(input.revision, `${path}.revision`),
  }
}

export const parseExecuteItemFormChangeCommand = (value: unknown): ExecuteItemFormChangeCommandV1 => {
  const input = record(cloneStrictJson(value, 'itemFormChangeCommand', {
    limits: { depth: 6, nodes: 2_000, objectFields: 24, arrayEntries: 512, stringLength: 500, objectKeyLength: 100 },
    rootLabel: 'item form-change command', valueLabel: 'item form-change command values',
    failNotJson: (path, detail) => fail(path, detail), failLimit: (path, detail) => fail(path, detail),
  }), 'itemFormChangeCommand')
  exact(input, [
    'schemaVersion', 'operationId', 'offerId', 'mapSlug', 'baseRevision',
    'actorPlacementId', 'targetPlacementId', 'abilityOptionId', 'readSet',
  ], 'itemFormChangeCommand')
  if (input.schemaVersion !== 1) fail('itemFormChangeCommand.schemaVersion', 'is unsupported.')
  const readSet = array(input.readSet, 'itemFormChangeCommand.readSet', 512)
    .map((entry, index) => parseReadRef(entry, `itemFormChangeCommand.readSet[${index}]`))
  const readIds = readSet.map(entry => `${entry.kind}:${entry.sheetKind ?? ''}:${entry.id}`)
  if (new Set(readIds).size !== readIds.length) fail('itemFormChangeCommand.readSet', 'contains duplicate resource identities.')
  return deepFreezeStrictJson({
    schemaVersion: 1,
    operationId: stableId(input.operationId, 'itemFormChangeCommand.operationId'),
    offerId: stableId(input.offerId, 'itemFormChangeCommand.offerId'),
    mapSlug: stableId(input.mapSlug, 'itemFormChangeCommand.mapSlug'),
    baseRevision: integer(input.baseRevision, 'itemFormChangeCommand.baseRevision'),
    actorPlacementId: text(input.actorPlacementId, 'itemFormChangeCommand.actorPlacementId'),
    targetPlacementId: text(input.targetPlacementId, 'itemFormChangeCommand.targetPlacementId'),
    abilityOptionId: nullableText(input.abilityOptionId, 'itemFormChangeCommand.abilityOptionId'),
    readSet,
  })
}

export const parseItemFormChangePublicResult = (value: unknown): ItemFormChangePublicResultV1 => {
  const input = record(value, 'itemFormChangeResult')
  exact(input, [
    'schemaVersion', 'operationId', 'mapSlug', 'mapRevision', 'actorPlacementId',
    'targetPlacementId', 'formName', 'abilityName', 'durationLabel', 'status',
    'exactReplay', 'message',
  ], 'itemFormChangeResult')
  if (input.schemaVersion !== 1 || input.durationLabel !== 'Scene' || input.status !== 'accepted'
    || typeof input.exactReplay !== 'boolean') fail('itemFormChangeResult', 'has unsupported result semantics.')
  return deepFreezeStrictJson({
    schemaVersion: 1,
    operationId: stableId(input.operationId, 'itemFormChangeResult.operationId'),
    mapSlug: stableId(input.mapSlug, 'itemFormChangeResult.mapSlug'),
    mapRevision: integer(input.mapRevision, 'itemFormChangeResult.mapRevision'),
    actorPlacementId: text(input.actorPlacementId, 'itemFormChangeResult.actorPlacementId'),
    targetPlacementId: text(input.targetPlacementId, 'itemFormChangeResult.targetPlacementId'),
    formName: text(input.formName, 'itemFormChangeResult.formName'),
    abilityName: text(input.abilityName, 'itemFormChangeResult.abilityName'),
    durationLabel: 'Scene', status: 'accepted', exactReplay: input.exactReplay as boolean,
    message: text(input.message, 'itemFormChangeResult.message', 500),
  })
}

export const appendItemFormChangeEntry = (
  state: unknown,
  entry: ItemFormChangeEntryV1,
): ItemFormChangeStateV1 => parseItemFormChangeState({
  ...parseItemFormChangeState(state),
  entries: [...parseItemFormChangeState(state).entries, entry],
})

export const activeItemFormChangeForPlacement = (input: {
  readonly state: unknown
  readonly placementId: string
  readonly activeSceneStartedAt: number | null
}): ItemFormChangeEntryV1 | null => parseItemFormChangeState(input.state).entries.find(entry => (
  entry.placementId === input.placementId
  && (entry.duration.kind === 'persistent' || entry.duration.sceneStartedAt === input.activeSceneStartedAt)
)) ?? null

export const clearSceneItemFormChanges = (state: unknown): ItemFormChangeStateV1 => {
  const parsed = parseItemFormChangeState(state)
  return parseItemFormChangeState({
    ...parsed,
    entries: parsed.entries.filter(entry => entry.duration.kind === 'persistent'),
  })
}
