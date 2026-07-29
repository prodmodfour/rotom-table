import { isCanonicalCapabilityId } from './catalog'

export const CAPABILITY_ACTION_COMMAND_SCHEMA_VERSION = 1 as const

export interface CapabilityActionCell {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface CapabilityActionSelections {
  readonly targetPlacementIds: readonly string[]
  readonly cells: readonly CapabilityActionCell[]
  /** Reviewed branch identity such as rough, slow, disarm, or a form ID. */
  readonly optionId: string | null
  readonly recipientTrainerSlug: string | null
  readonly canonicalItemId: string | null
  /** Bounded narrative input is presentation/adjudication data, never executable rules. */
  readonly description: string | null
  readonly gmConfirmed: boolean
}

export interface ExecuteCapabilityActionCommand {
  readonly schemaVersion: typeof CAPABILITY_ACTION_COMMAND_SCHEMA_VERSION
  readonly operationId: string
  readonly mapSlug: string
  readonly baseRevision: number
  readonly offerId: string
  readonly actorPlacementId: string
  readonly capabilityInstanceId: string
  readonly canonicalId: string
  readonly actionId: string
  readonly selections: CapabilityActionSelections
}

export type CapabilityActionOutcome = 'applied' | 'no-op' | 'adjudication-required'

export interface CapabilityServerRoll {
  readonly rollId: string
  readonly expression: string
  readonly dice: readonly number[]
  readonly modifier: number
  readonly total: number
}

export interface CapabilityProducedResource {
  readonly kind: 'item' | 'money' | 'summoned-creature' | 'hatch-time-reduction' | 'campaign-resource'
  readonly canonicalId: string
  readonly quantity: number
  readonly recipientSheetSlug: string | null
}

export interface CapabilityActionPublicResult {
  readonly schemaVersion: typeof CAPABILITY_ACTION_COMMAND_SCHEMA_VERSION
  readonly operationId: string
  readonly mapSlug: string
  readonly mapRevision: number
  readonly actorPlacementId: string
  readonly canonicalId: string
  readonly actionId: string
  readonly outcome: CapabilityActionOutcome
  readonly reasonCode: string
  readonly rolls: readonly CapabilityServerRoll[]
  readonly produced: readonly CapabilityProducedResource[]
  readonly changedMap: boolean
  readonly changedSheetSlugs: readonly string[]
  readonly adjudicationNote: string | null
}

export class CapabilityActionCommandValidationError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'CapabilityActionCommandValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const fail = (path: string, detail: string): never => { throw new CapabilityActionCommandValidationError(path, detail) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'must be a plain object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.hasOwn(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length || unknown.length) fail(path, `has invalid fields (missing ${missing.join(', ') || 'none'}; unknown ${unknown.join(', ') || 'none'}).`)
}
const text = (value: unknown, path: string, max = 240): string => {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) fail(path, `must be trimmed text of at most ${max} characters.`)
  return value as string
}
const nullableText = (value: unknown, path: string, max = 240): string | null => value === null ? null : text(value, path, max)
const identifier = (value: unknown, path: string): string => {
  const parsed = text(value, path)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/%-]*$/.test(parsed)) fail(path, 'must be a stable identifier.')
  return parsed
}
const coordinate = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Math.abs(value as number) > 1_000_000) fail(path, 'must be a bounded integer coordinate.')
  return value as number
}

export const parseExecuteCapabilityActionCommand = (value: unknown): ExecuteCapabilityActionCommand => {
  const root = record(value, 'command')
  exact(root, ['schemaVersion', 'operationId', 'mapSlug', 'baseRevision', 'offerId', 'actorPlacementId', 'capabilityInstanceId', 'canonicalId', 'actionId', 'selections'], 'command')
  if (root.schemaVersion !== 1) fail('command.schemaVersion', 'must be 1.')
  if (!Number.isSafeInteger(root.baseRevision) || (root.baseRevision as number) < 0) fail('command.baseRevision', 'must be a non-negative revision.')
  if (!isCanonicalCapabilityId(root.canonicalId)) fail('command.canonicalId', 'must be canonical.')
  const selections = record(root.selections, 'command.selections')
  exact(selections, ['targetPlacementIds', 'cells', 'optionId', 'recipientTrainerSlug', 'canonicalItemId', 'description', 'gmConfirmed'], 'command.selections')
  if (!Array.isArray(selections.targetPlacementIds) || selections.targetPlacementIds.length > 16) fail('command.selections.targetPlacementIds', 'must contain at most 16 IDs.')
  const rawTargetPlacementIds = selections.targetPlacementIds as unknown[]
  const targetPlacementIds = rawTargetPlacementIds.map((candidate, index) => identifier(candidate, `command.selections.targetPlacementIds[${index}]`))
  if (new Set(targetPlacementIds).size !== targetPlacementIds.length) fail('command.selections.targetPlacementIds', 'must not contain duplicates.')
  if (!Array.isArray(selections.cells) || selections.cells.length > 32) fail('command.selections.cells', 'must contain at most 32 cells.')
  const rawCells = selections.cells as unknown[]
  const cells = rawCells.map((candidate, index): CapabilityActionCell => {
    const path = `command.selections.cells[${index}]`
    const cell = record(candidate, path)
    exact(cell, ['x', 'y', 'z'], path)
    return Object.freeze({ x: coordinate(cell.x, `${path}.x`), y: coordinate(cell.y, `${path}.y`), z: coordinate(cell.z, `${path}.z`) })
  })
  if (new Set(cells.map(cell => `${cell.x}:${cell.y}:${cell.z}`)).size !== cells.length) fail('command.selections.cells', 'must not contain duplicate cells.')
  if (typeof selections.gmConfirmed !== 'boolean') fail('command.selections.gmConfirmed', 'must be boolean.')
  return Object.freeze({
    schemaVersion: 1,
    operationId: identifier(root.operationId, 'command.operationId'),
    mapSlug: identifier(root.mapSlug, 'command.mapSlug'),
    baseRevision: root.baseRevision as number,
    offerId: identifier(root.offerId, 'command.offerId'),
    actorPlacementId: identifier(root.actorPlacementId, 'command.actorPlacementId'),
    capabilityInstanceId: identifier(root.capabilityInstanceId, 'command.capabilityInstanceId'),
    canonicalId: root.canonicalId as string,
    actionId: identifier(root.actionId, 'command.actionId'),
    selections: Object.freeze({
      targetPlacementIds: Object.freeze(targetPlacementIds),
      cells: Object.freeze(cells),
      optionId: nullableText(selections.optionId, 'command.selections.optionId'),
      recipientTrainerSlug: nullableText(selections.recipientTrainerSlug, 'command.selections.recipientTrainerSlug'),
      canonicalItemId: nullableText(selections.canonicalItemId, 'command.selections.canonicalItemId'),
      description: nullableText(selections.description, 'command.selections.description', 500),
      gmConfirmed: selections.gmConfirmed as boolean,
    }),
  })
}

export const parseCapabilityActionPublicResult = (value: unknown): CapabilityActionPublicResult => {
  const root = record(value, 'result')
  exact(root, ['schemaVersion', 'operationId', 'mapSlug', 'mapRevision', 'actorPlacementId', 'canonicalId', 'actionId', 'outcome', 'reasonCode', 'rolls', 'produced', 'changedMap', 'changedSheetSlugs', 'adjudicationNote'], 'result')
  if (root.schemaVersion !== 1) fail('result.schemaVersion', 'must be 1.')
  if (!Number.isSafeInteger(root.mapRevision) || (root.mapRevision as number) < 0) fail('result.mapRevision', 'must be a non-negative revision.')
  if (!isCanonicalCapabilityId(root.canonicalId)) fail('result.canonicalId', 'must be canonical.')
  if (root.outcome !== 'applied' && root.outcome !== 'no-op' && root.outcome !== 'adjudication-required') fail('result.outcome', 'is unsupported.')
  if (!Array.isArray(root.rolls) || root.rolls.length > 16) fail('result.rolls', 'must contain at most 16 rolls.')
  const rawRolls = root.rolls as unknown[]
  const rolls = rawRolls.map((candidate, index): CapabilityServerRoll => {
    const path = `result.rolls[${index}]`
    const roll = record(candidate, path)
    exact(roll, ['rollId', 'expression', 'dice', 'modifier', 'total'], path)
    if (!Array.isArray(roll.dice) || roll.dice.length > 100 || roll.dice.some(die => !Number.isSafeInteger(die) || die < 1 || die > 1_000_000)) fail(`${path}.dice`, 'must contain bounded positive dice.')
    if (!Number.isSafeInteger(roll.modifier) || !Number.isSafeInteger(roll.total)) fail(path, 'modifier and total must be safe integers.')
    return Object.freeze({
      rollId: identifier(roll.rollId, `${path}.rollId`),
      expression: text(roll.expression, `${path}.expression`, 100),
      dice: Object.freeze(roll.dice as number[]),
      modifier: roll.modifier as number,
      total: roll.total as number,
    })
  })
  if (!Array.isArray(root.produced) || root.produced.length > 16) fail('result.produced', 'must contain at most 16 resources.')
  const rawProduced = root.produced as unknown[]
  const produced = rawProduced.map((candidate, index): CapabilityProducedResource => {
    const path = `result.produced[${index}]`
    const resource = record(candidate, path)
    exact(resource, ['kind', 'canonicalId', 'quantity', 'recipientSheetSlug'], path)
    if (!['item', 'money', 'summoned-creature', 'hatch-time-reduction', 'campaign-resource'].includes(String(resource.kind))) fail(`${path}.kind`, 'is unsupported.')
    if (!Number.isSafeInteger(resource.quantity) || (resource.quantity as number) < 0) fail(`${path}.quantity`, 'must be a non-negative safe integer.')
    return Object.freeze({
      kind: resource.kind as CapabilityProducedResource['kind'],
      canonicalId: text(resource.canonicalId, `${path}.canonicalId`),
      quantity: resource.quantity as number,
      recipientSheetSlug: nullableText(resource.recipientSheetSlug, `${path}.recipientSheetSlug`),
    })
  })
  if (typeof root.changedMap !== 'boolean' || !Array.isArray(root.changedSheetSlugs) || root.changedSheetSlugs.length > 16) fail('result', 'has invalid change summary.')
  const changedSheetSlugs = (root.changedSheetSlugs as unknown[]).map((slug, index) => identifier(slug, `result.changedSheetSlugs[${index}]`))
  if (new Set(changedSheetSlugs).size !== changedSheetSlugs.length) fail('result.changedSheetSlugs', 'must be unique.')
  return Object.freeze({
    schemaVersion: 1,
    operationId: identifier(root.operationId, 'result.operationId'),
    mapSlug: identifier(root.mapSlug, 'result.mapSlug'),
    mapRevision: root.mapRevision as number,
    actorPlacementId: identifier(root.actorPlacementId, 'result.actorPlacementId'),
    canonicalId: root.canonicalId as string,
    actionId: identifier(root.actionId, 'result.actionId'),
    outcome: root.outcome as CapabilityActionOutcome,
    reasonCode: identifier(root.reasonCode, 'result.reasonCode'),
    rolls: Object.freeze(rolls),
    produced: Object.freeze(produced),
    changedMap: root.changedMap as boolean,
    changedSheetSlugs: Object.freeze(changedSheetSlugs),
    adjudicationNote: nullableText(root.adjudicationNote, 'result.adjudicationNote', 500),
  })
}
