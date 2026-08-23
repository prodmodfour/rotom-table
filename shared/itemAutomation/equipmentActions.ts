import type { GridAnchor } from '~/types/map'

export const EQUIPMENT_ACTION_COMMAND_SCHEMA_VERSION = 1 as const
export const EQUIPMENT_ACTION_RESULT_SCHEMA_VERSION = 1 as const

export const EQUIPMENT_ACTION_IDS = [
  'equipment.light-shield.ready',
  'equipment.heavy-shield.ready',
  'equipment.shock-collar.activate',
  'equipment.glue-cannon.attack',
  'equipment.hand-net.attack',
  'equipment.weighted-nets.throw',
  'equipment.weighted-nets.pull',
  'equipment.fishing.old-rod',
  'equipment.fishing.good-rod',
  'equipment.fishing.super-rod',
  'equipment.snag-machine.convert',
] as const
export type EquipmentActionId = (typeof EQUIPMENT_ACTION_IDS)[number]

export interface ExecuteEquipmentActionCommandV1 {
  readonly schemaVersion: typeof EQUIPMENT_ACTION_COMMAND_SCHEMA_VERSION
  readonly operationId: string
  readonly offerId: string
  readonly mapSlug: string
  readonly baseRevision: number
  readonly actorPlacementId: string
  readonly actionId: EquipmentActionId
  /** Private exact whole-item binding issued only after declaration authority. */
  readonly equipmentInstanceId: string
  readonly equipmentInstanceRevision: number
  /** Private exact paired/worn source for actions such as Shock Collar; null otherwise. */
  readonly targetEquipmentInstanceId: string | null
  readonly targetEquipmentInstanceRevision: number | null
  readonly targetPlacementIds: readonly string[]
  readonly cells: readonly GridAnchor[]
  readonly inventorySourceInstanceId: string | null
  readonly skillCheckId: string | null
  readonly gmAdjudication: {
    readonly accepted: boolean
    readonly note: string | null
    readonly hookSpeciesId: string | null
    readonly hookLevel: number | null
  } | null
}

export interface EquipmentActionRollV1 {
  readonly rollId: string
  readonly expression: '1d20'
  readonly naturalResult: number
  readonly modifier: number
  readonly total: number
}

export interface EquipmentActionReceiptV1 {
  readonly receiptId: string
  readonly kind: string
  readonly reasonCode: string
  readonly safeDetail: string | null
}

export interface EquipmentActionPublicResultV1 {
  readonly schemaVersion: typeof EQUIPMENT_ACTION_RESULT_SCHEMA_VERSION
  readonly operationId: string
  readonly mapSlug: string
  readonly mapRevision: number
  readonly actorPlacementId: string
  readonly actionId: EquipmentActionId
  readonly status: 'accepted' | 'guided-pending' | 'cancelled'
  readonly exactReplay: boolean
  readonly targetPlacementIds: readonly string[]
  readonly rolls: readonly EquipmentActionRollV1[]
  readonly receipts: readonly EquipmentActionReceiptV1[]
}

export class EquipmentActionValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EquipmentActionValidationError'
  }
}

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EquipmentActionValidationError(`${label} must be an object.`)
  return value as Record<string, unknown>
}
const text = (value: unknown, label: string, maximum = 180): string => {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > maximum) {
    throw new EquipmentActionValidationError(`${label} must be a stable bounded identifier.`)
  }
  return value
}
const integer = (value: unknown, label: string, minimum = 0): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new EquipmentActionValidationError(`${label} must be a bounded integer.`)
  return Number(value)
}
const optionalText = (value: unknown, label: string, maximum = 500): string | null => value === null
  ? null : text(value, label, maximum)
const ids = (value: unknown, label: string): readonly string[] => {
  if (!Array.isArray(value) || value.length > 32) throw new EquipmentActionValidationError(`${label} must be a bounded array.`)
  const parsed = value.map((entry, index) => text(entry, `${label}[${index}]`))
  if (new Set(parsed).size !== parsed.length) throw new EquipmentActionValidationError(`${label} must not contain duplicates.`)
  return Object.freeze(parsed)
}
const cells = (value: unknown): readonly GridAnchor[] => {
  if (!Array.isArray(value) || value.length > 4) throw new EquipmentActionValidationError('cells must be a bounded array.')
  const parsed = value.map((entry, index) => {
    const input = record(entry, `cells[${index}]`)
    if (Object.keys(input).sort().join(',') !== 'x,y,z') throw new EquipmentActionValidationError(`cells[${index}] has an invalid shape.`)
    return Object.freeze({
      x: integer(input.x, `cells[${index}].x`),
      y: integer(input.y, `cells[${index}].y`),
      z: integer(input.z, `cells[${index}].z`),
    })
  })
  return Object.freeze(parsed)
}

export const parseExecuteEquipmentActionCommand = (value: unknown): ExecuteEquipmentActionCommandV1 => {
  const input = record(value, 'equipmentActionCommand')
  const expected = [
    'schemaVersion', 'operationId', 'offerId', 'mapSlug', 'baseRevision', 'actorPlacementId',
    'actionId', 'equipmentInstanceId', 'equipmentInstanceRevision', 'targetEquipmentInstanceId',
    'targetEquipmentInstanceRevision', 'targetPlacementIds', 'cells',
    'inventorySourceInstanceId', 'skillCheckId', 'gmAdjudication',
  ].sort().join(',')
  if (Object.keys(input).sort().join(',') !== expected) throw new EquipmentActionValidationError('equipmentActionCommand has an invalid shape.')
  if (input.schemaVersion !== 1) throw new EquipmentActionValidationError('equipmentActionCommand has an unsupported schema version.')
  if (!EQUIPMENT_ACTION_IDS.includes(input.actionId as EquipmentActionId)) throw new EquipmentActionValidationError('actionId is not reviewed.')
  const adjudication = input.gmAdjudication === null ? null : (() => {
    const raw = record(input.gmAdjudication, 'gmAdjudication')
    if (Object.keys(raw).sort().join(',') !== 'accepted,hookLevel,hookSpeciesId,note') throw new EquipmentActionValidationError('gmAdjudication has an invalid shape.')
    if (typeof raw.accepted !== 'boolean') throw new EquipmentActionValidationError('gmAdjudication.accepted must be boolean.')
    return Object.freeze({
      accepted: raw.accepted,
      note: optionalText(raw.note, 'gmAdjudication.note'),
      hookSpeciesId: optionalText(raw.hookSpeciesId, 'gmAdjudication.hookSpeciesId'),
      hookLevel: raw.hookLevel === null ? null : integer(raw.hookLevel, 'gmAdjudication.hookLevel', 1),
    })
  })()
  if ((input.targetEquipmentInstanceId === null) !== (input.targetEquipmentInstanceRevision === null)) {
    throw new EquipmentActionValidationError('Paired equipment identity and revision must both be present or both be null.')
  }
  return Object.freeze({
    schemaVersion: 1,
    operationId: text(input.operationId, 'operationId'),
    offerId: text(input.offerId, 'offerId'),
    mapSlug: text(input.mapSlug, 'mapSlug'),
    baseRevision: integer(input.baseRevision, 'baseRevision'),
    actorPlacementId: text(input.actorPlacementId, 'actorPlacementId'),
    actionId: input.actionId as EquipmentActionId,
    equipmentInstanceId: text(input.equipmentInstanceId, 'equipmentInstanceId', 240),
    equipmentInstanceRevision: integer(input.equipmentInstanceRevision, 'equipmentInstanceRevision'),
    targetEquipmentInstanceId: optionalText(input.targetEquipmentInstanceId, 'targetEquipmentInstanceId', 240),
    targetEquipmentInstanceRevision: input.targetEquipmentInstanceRevision === null
      ? null : integer(input.targetEquipmentInstanceRevision, 'targetEquipmentInstanceRevision'),
    targetPlacementIds: ids(input.targetPlacementIds, 'targetPlacementIds'),
    cells: cells(input.cells),
    inventorySourceInstanceId: optionalText(input.inventorySourceInstanceId, 'inventorySourceInstanceId', 240),
    skillCheckId: optionalText(input.skillCheckId, 'skillCheckId'),
    gmAdjudication: adjudication,
  })
}

export const parseEquipmentActionPublicResult = (value: unknown): EquipmentActionPublicResultV1 => {
  const input = record(value, 'equipmentActionResult')
  const expected = [
    'schemaVersion', 'operationId', 'mapSlug', 'mapRevision', 'actorPlacementId', 'actionId',
    'status', 'exactReplay', 'targetPlacementIds', 'rolls', 'receipts',
  ].sort().join(',')
  if (Object.keys(input).sort().join(',') !== expected) throw new EquipmentActionValidationError('equipmentActionResult has an invalid shape.')
  if (input.schemaVersion !== 1) throw new EquipmentActionValidationError('equipmentActionResult has an unsupported schema version.')
  if (!EQUIPMENT_ACTION_IDS.includes(input.actionId as EquipmentActionId)) throw new EquipmentActionValidationError('equipmentActionResult.actionId is not reviewed.')
  if (!['accepted', 'guided-pending', 'cancelled'].includes(input.status as string)) throw new EquipmentActionValidationError('equipmentActionResult.status is invalid.')
  if (typeof input.exactReplay !== 'boolean') throw new EquipmentActionValidationError('equipmentActionResult.exactReplay must be boolean.')
  if (!Array.isArray(input.rolls) || input.rolls.length > 16) throw new EquipmentActionValidationError('equipmentActionResult.rolls must be bounded.')
  const parsedRolls = input.rolls.map((entry, index): EquipmentActionRollV1 => {
    const roll = record(entry, `equipmentActionResult.rolls[${index}]`)
    if (Object.keys(roll).sort().join(',') !== 'expression,modifier,naturalResult,rollId,total'
      || roll.expression !== '1d20') throw new EquipmentActionValidationError(`equipmentActionResult.rolls[${index}] is invalid.`)
    return Object.freeze({
      rollId: text(roll.rollId, `equipmentActionResult.rolls[${index}].rollId`),
      expression: '1d20',
      naturalResult: integer(roll.naturalResult, `equipmentActionResult.rolls[${index}].naturalResult`, 1),
      modifier: Number.isSafeInteger(roll.modifier) ? Number(roll.modifier) : (() => { throw new EquipmentActionValidationError('Equipment action roll modifier must be an integer.') })(),
      total: Number.isSafeInteger(roll.total) ? Number(roll.total) : (() => { throw new EquipmentActionValidationError('Equipment action roll total must be an integer.') })(),
    })
  })
  if (!Array.isArray(input.receipts) || input.receipts.length > 32) throw new EquipmentActionValidationError('equipmentActionResult.receipts must be bounded.')
  const parsedReceipts = input.receipts.map((entry, index): EquipmentActionReceiptV1 => {
    const raw = record(entry, `equipmentActionResult.receipts[${index}]`)
    if (Object.keys(raw).sort().join(',') !== 'kind,reasonCode,receiptId,safeDetail') {
      throw new EquipmentActionValidationError(`equipmentActionResult.receipts[${index}] is invalid.`)
    }
    return Object.freeze({
      receiptId: text(raw.receiptId, `equipmentActionResult.receipts[${index}].receiptId`, 240),
      kind: text(raw.kind, `equipmentActionResult.receipts[${index}].kind`),
      reasonCode: text(raw.reasonCode, `equipmentActionResult.receipts[${index}].reasonCode`),
      safeDetail: optionalText(raw.safeDetail, `equipmentActionResult.receipts[${index}].safeDetail`),
    })
  })
  return Object.freeze({
    schemaVersion: 1,
    operationId: text(input.operationId, 'equipmentActionResult.operationId'),
    mapSlug: text(input.mapSlug, 'equipmentActionResult.mapSlug'),
    mapRevision: integer(input.mapRevision, 'equipmentActionResult.mapRevision'),
    actorPlacementId: text(input.actorPlacementId, 'equipmentActionResult.actorPlacementId'),
    actionId: input.actionId as EquipmentActionId,
    status: input.status as EquipmentActionPublicResultV1['status'],
    exactReplay: input.exactReplay,
    targetPlacementIds: ids(input.targetPlacementIds, 'equipmentActionResult.targetPlacementIds'),
    rolls: Object.freeze(parsedRolls),
    receipts: Object.freeze(parsedReceipts),
  })
}

export const equipmentActionCommandFromAuthorizedOffer = (input: {
  readonly command: ExecuteEquipmentActionCommandV1
  readonly operationId: string
}): ExecuteEquipmentActionCommandV1 => parseExecuteEquipmentActionCommand({
  ...input.command,
  operationId: input.operationId,
})
