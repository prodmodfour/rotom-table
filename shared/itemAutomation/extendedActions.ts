import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'
import { SLUG_RE } from '../paths'
import { isSheetKind, type SheetKind } from '../sheets'
import { parseItemOperationResult, type ItemOperationResultV1 } from './operations'

export const ITEM_EXTENDED_ACTION_SCHEMA_VERSION = 1 as const
export const ITEM_EXTENDED_ACTION_ID_PATTERN = /^item-activity:v1:[a-f0-9]{32}$/
export const ITEM_EXTENDED_ACTION_OPERATION_ID_PATTERN = /^item-activity-operation:v1:[a-f0-9]{32}$/
export const ITEM_SETTLEMENT_OPERATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{7,199}$/
export const ITEM_EXTENDED_ACTION_INTERRUPT_REASONS = ['user-cancelled', 'gm-interrupted'] as const
export type ItemExtendedActionInterruptReason = typeof ITEM_EXTENDED_ACTION_INTERRUPT_REASONS[number]

export interface StartItemExtendedActionCommandV1 {
  readonly schemaVersion: typeof ITEM_EXTENDED_ACTION_SCHEMA_VERSION
  readonly kind: 'start'
  readonly operationId: string
  readonly activityId: string
  readonly settlementOperationId: string
  readonly trainerSlug: string
  readonly trainerRevision: number
  readonly offerId: string
  readonly targetIds: readonly string[]
  /** Omitted only by schema-v1 activities persisted before target-specific choices existed. */
  readonly choices?: readonly { readonly choiceId: string, readonly optionIds: readonly string[] }[]
}

export interface CompleteItemExtendedActionCommandV1 {
  readonly schemaVersion: typeof ITEM_EXTENDED_ACTION_SCHEMA_VERSION
  readonly kind: 'complete'
  readonly operationId: string
  readonly activityId: string
  readonly expectedRevision: number
}

export interface InterruptItemExtendedActionCommandV1 {
  readonly schemaVersion: typeof ITEM_EXTENDED_ACTION_SCHEMA_VERSION
  readonly kind: 'interrupt'
  readonly operationId: string
  readonly activityId: string
  readonly expectedRevision: number
  readonly reason: ItemExtendedActionInterruptReason
}

export type ItemExtendedActionCommandV1 =
  | StartItemExtendedActionCommandV1
  | CompleteItemExtendedActionCommandV1
  | InterruptItemExtendedActionCommandV1

export interface ItemExtendedActionProjectionV1 {
  readonly schemaVersion: typeof ITEM_EXTENDED_ACTION_SCHEMA_VERSION
  readonly activityId: string
  readonly revision: number
  readonly status: 'in-progress' | 'completed' | 'interrupted'
  readonly item: { readonly canonicalId: string, readonly label: string }
  readonly actor: {
    readonly sheetKind: 'trainer'
    readonly sheetSlug: string
    readonly label: string
    readonly href: string
  }
  readonly target: {
    readonly sheetKind: SheetKind
    readonly sheetSlug: string
    readonly label: string
    readonly href: string
    readonly summary: string | null
    readonly conditionLabels: readonly string[]
  }
  readonly startedAtCampaignMinute: number
  readonly updatedAtCampaignMinute: number
  readonly completion: {
    readonly costs: readonly string[]
    readonly sourceNotice: string
    readonly safePendingNotice: string
  }
  readonly permissions: {
    readonly canComplete: boolean
    readonly canInterrupt: boolean
    readonly unavailableReason: string | null
  }
  readonly terminal: {
    readonly kind: 'completed' | 'interrupted'
    readonly message: string
  } | null
}

export type ItemExtendedActionResultV1 =
  | {
      readonly schemaVersion: typeof ITEM_EXTENDED_ACTION_SCHEMA_VERSION
      readonly operationId: string
      readonly activityId: string
      readonly status: 'in-progress' | 'interrupted'
      readonly revision: number
      readonly exactReplay: boolean
      readonly itemResult: null
    }
  | {
      readonly schemaVersion: typeof ITEM_EXTENDED_ACTION_SCHEMA_VERSION
      readonly operationId: string
      readonly activityId: string
      readonly status: 'completed'
      readonly revision: number
      readonly exactReplay: boolean
      readonly itemResult: ItemOperationResultV1
    }

export class ItemExtendedActionValidationError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'ItemExtendedActionValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const INTERRUPT_REASON_SET = new Set<string>(ITEM_EXTENDED_ACTION_INTERRUPT_REASONS)
const STATUS_SET = new Set<string>(['in-progress', 'completed', 'interrupted'])

const fail = (path: string, detail: string): never => { throw new ItemExtendedActionValidationError(path, detail) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail(path, 'must be a plain object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(value, field))
    || Object.keys(value).some(field => !allowed.has(field))) fail(path, 'has an invalid shape.')
}
const text = (value: unknown, path: string, maximum = 500): string => {
  if (typeof value !== 'string' || value.trim() !== value || !value
    || value.length > maximum || CONTROL_CHARACTER_PATTERN.test(value)) fail(path, 'must be bounded safe text.')
  return value as string
}
const id = (value: unknown, path: string, pattern: RegExp): string => {
  const parsed = text(value, path, 200)
  return pattern.test(parsed) ? parsed : fail(path, 'has an invalid stable identity.')
}
const integer = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(path, 'must be a safe non-negative integer.')
  return Number(value)
}
const bool = (value: unknown, path: string): boolean => typeof value === 'boolean'
  ? value
  : fail(path, 'must be boolean.')
const nullableText = (value: unknown, path: string): string | null => value === null ? null : text(value, path)
const array = (value: unknown, path: string, maximum: number): readonly unknown[] => {
  if (!Array.isArray(value) || value.length > maximum) fail(path, `must be an array of at most ${maximum} entries.`)
  return value as readonly unknown[]
}
const uniqueTexts = (value: unknown, path: string, maximum: number): readonly string[] => {
  const values = array(value, path, maximum).map((entry, index) => text(entry, `${path}[${index}]`))
  if (new Set(values).size !== values.length) fail(path, 'must contain unique entries.')
  return values
}
const slug = (value: unknown, path: string): string => {
  const parsed = text(value, path, 200)
  return SLUG_RE.test(parsed) ? parsed : fail(path, 'must be a sheet slug.')
}
const href = (value: unknown, path: string): string => {
  const parsed = text(value, path, 1_024)
  return parsed.startsWith('/') && !parsed.startsWith('//') ? parsed : fail(path, 'must be an app-relative href.')
}
const clone = (value: unknown, label: string): unknown => cloneStrictJson(value, label, {
  limits: {
    depth: 12,
    nodes: 4_096,
    objectFields: 32,
    arrayEntries: 128,
    stringLength: 1_024,
    objectKeyLength: 100,
  },
  rootLabel: label,
  valueLabel: `${label} values`,
  failNotJson: (path, detail) => fail(path, detail),
  failLimit: (path, detail) => fail(path, detail),
})

export const parseItemExtendedActionCommand = (value: unknown): ItemExtendedActionCommandV1 => {
  const root = record(clone(value, 'itemExtendedActionCommand'), 'itemExtendedActionCommand')
  const rawKind = root.kind
  if (rawKind !== 'start' && rawKind !== 'complete' && rawKind !== 'interrupt') {
    fail('itemExtendedActionCommand.kind', 'must be start, complete, or interrupt.')
  }
  const kind = rawKind as ItemExtendedActionCommandV1['kind']
  const fields = kind === 'start'
    ? [
        'schemaVersion', 'kind', 'operationId', 'activityId', 'settlementOperationId',
        'trainerSlug', 'trainerRevision', 'offerId', 'targetIds',
        ...(Object.hasOwn(root, 'choices') ? ['choices'] : []),
      ]
    : kind === 'complete'
      ? ['schemaVersion', 'kind', 'operationId', 'activityId', 'expectedRevision']
      : ['schemaVersion', 'kind', 'operationId', 'activityId', 'expectedRevision', 'reason']
  exact(root, fields, 'itemExtendedActionCommand')
  if (root.schemaVersion !== ITEM_EXTENDED_ACTION_SCHEMA_VERSION) {
    fail('itemExtendedActionCommand.schemaVersion', `must be ${ITEM_EXTENDED_ACTION_SCHEMA_VERSION}.`)
  }
  const base = {
    schemaVersion: ITEM_EXTENDED_ACTION_SCHEMA_VERSION,
    kind,
    operationId: id(
      root.operationId,
      'itemExtendedActionCommand.operationId',
      ITEM_EXTENDED_ACTION_OPERATION_ID_PATTERN,
    ),
    activityId: id(root.activityId, 'itemExtendedActionCommand.activityId', ITEM_EXTENDED_ACTION_ID_PATTERN),
  }
  if (kind === 'start') {
    const choices = Object.hasOwn(root, 'choices')
      ? array(root.choices, 'itemExtendedActionCommand.choices', 32).map((entry, index) => {
          const path = `itemExtendedActionCommand.choices[${index}]`
          const choice = record(entry, path)
          exact(choice, ['choiceId', 'optionIds'], path)
          return {
            choiceId: text(choice.choiceId, `${path}.choiceId`, 200),
            optionIds: uniqueTexts(choice.optionIds, `${path}.optionIds`, 64),
          }
        })
      : null
    if (choices && new Set(choices.map(choice => choice.choiceId)).size !== choices.length) {
      fail('itemExtendedActionCommand.choices', 'must contain unique choice identities.')
    }
    return deepFreezeStrictJson({
      ...base,
      kind,
      settlementOperationId: id(
        root.settlementOperationId,
        'itemExtendedActionCommand.settlementOperationId',
        ITEM_SETTLEMENT_OPERATION_ID_PATTERN,
      ),
      trainerSlug: slug(root.trainerSlug, 'itemExtendedActionCommand.trainerSlug'),
      trainerRevision: integer(root.trainerRevision, 'itemExtendedActionCommand.trainerRevision'),
      offerId: text(root.offerId, 'itemExtendedActionCommand.offerId', 1_024),
      targetIds: uniqueTexts(root.targetIds, 'itemExtendedActionCommand.targetIds', 64),
      ...(choices ? { choices } : {}),
    })
  }
  const expectedRevision = integer(root.expectedRevision, 'itemExtendedActionCommand.expectedRevision')
  if (kind === 'complete') return deepFreezeStrictJson({ ...base, kind, expectedRevision })
  if (typeof root.reason !== 'string' || !INTERRUPT_REASON_SET.has(root.reason)) {
    fail('itemExtendedActionCommand.reason', 'contains an unsupported interruption reason.')
  }
  return deepFreezeStrictJson({
    ...base,
    kind,
    expectedRevision,
    reason: root.reason as ItemExtendedActionInterruptReason,
  })
}

const parseProjectionTarget = (value: unknown): ItemExtendedActionProjectionV1['target'] => {
  const target = record(value, 'itemExtendedActionProjection.target')
  exact(target, [
    'sheetKind', 'sheetSlug', 'label', 'href', 'summary', 'conditionLabels',
  ], 'itemExtendedActionProjection.target')
  if (!isSheetKind(target.sheetKind)) fail('itemExtendedActionProjection.target.sheetKind', 'must be pokemon or trainer.')
  return {
    sheetKind: target.sheetKind as SheetKind,
    sheetSlug: slug(target.sheetSlug, 'itemExtendedActionProjection.target.sheetSlug'),
    label: text(target.label, 'itemExtendedActionProjection.target.label'),
    href: href(target.href, 'itemExtendedActionProjection.target.href'),
    summary: nullableText(target.summary, 'itemExtendedActionProjection.target.summary'),
    conditionLabels: uniqueTexts(target.conditionLabels, 'itemExtendedActionProjection.target.conditionLabels', 32),
  }
}

export const parseItemExtendedActionProjection = (value: unknown): ItemExtendedActionProjectionV1 => {
  const root = record(clone(value, 'itemExtendedActionProjection'), 'itemExtendedActionProjection')
  exact(root, [
    'schemaVersion', 'activityId', 'revision', 'status', 'item', 'actor', 'target',
    'startedAtCampaignMinute', 'updatedAtCampaignMinute', 'completion', 'permissions', 'terminal',
  ], 'itemExtendedActionProjection')
  if (root.schemaVersion !== ITEM_EXTENDED_ACTION_SCHEMA_VERSION) {
    fail('itemExtendedActionProjection.schemaVersion', `must be ${ITEM_EXTENDED_ACTION_SCHEMA_VERSION}.`)
  }
  if (typeof root.status !== 'string' || !STATUS_SET.has(root.status)) {
    fail('itemExtendedActionProjection.status', 'contains an unsupported status.')
  }
  const item = record(root.item, 'itemExtendedActionProjection.item')
  exact(item, ['canonicalId', 'label'], 'itemExtendedActionProjection.item')
  const actor = record(root.actor, 'itemExtendedActionProjection.actor')
  exact(actor, ['sheetKind', 'sheetSlug', 'label', 'href'], 'itemExtendedActionProjection.actor')
  if (actor.sheetKind !== 'trainer') fail('itemExtendedActionProjection.actor.sheetKind', 'must be trainer.')
  const completion = record(root.completion, 'itemExtendedActionProjection.completion')
  exact(completion, ['costs', 'sourceNotice', 'safePendingNotice'], 'itemExtendedActionProjection.completion')
  const permissions = record(root.permissions, 'itemExtendedActionProjection.permissions')
  exact(permissions, ['canComplete', 'canInterrupt', 'unavailableReason'], 'itemExtendedActionProjection.permissions')
  const canComplete = bool(permissions.canComplete, 'itemExtendedActionProjection.permissions.canComplete')
  const canInterrupt = bool(permissions.canInterrupt, 'itemExtendedActionProjection.permissions.canInterrupt')
  const unavailableReason = nullableText(
    permissions.unavailableReason,
    'itemExtendedActionProjection.permissions.unavailableReason',
  )
  const status = root.status as ItemExtendedActionProjectionV1['status']
  if (status === 'in-progress' && !canComplete && unavailableReason === null) {
    fail('itemExtendedActionProjection.permissions', 'an unavailable active activity requires a reason.')
  }
  if (status !== 'in-progress' && (canComplete || canInterrupt || unavailableReason !== null)) {
    fail('itemExtendedActionProjection.permissions', 'terminal activities cannot expose active permissions.')
  }
  let terminal: ItemExtendedActionProjectionV1['terminal'] = null
  if (root.terminal !== null) {
    const value = record(root.terminal, 'itemExtendedActionProjection.terminal')
    exact(value, ['kind', 'message'], 'itemExtendedActionProjection.terminal')
    if (value.kind !== 'completed' && value.kind !== 'interrupted') {
      fail('itemExtendedActionProjection.terminal.kind', 'must be completed or interrupted.')
    }
    terminal = {
      kind: value.kind as 'completed' | 'interrupted',
      message: text(value.message, 'itemExtendedActionProjection.terminal.message'),
    }
  }
  if ((status === 'in-progress') !== (terminal === null)
    || (terminal && terminal.kind !== status)) {
    fail('itemExtendedActionProjection.terminal', 'must match activity status.')
  }
  const startedAtCampaignMinute = integer(
    root.startedAtCampaignMinute,
    'itemExtendedActionProjection.startedAtCampaignMinute',
  )
  const updatedAtCampaignMinute = integer(
    root.updatedAtCampaignMinute,
    'itemExtendedActionProjection.updatedAtCampaignMinute',
  )
  if (updatedAtCampaignMinute < startedAtCampaignMinute) {
    fail('itemExtendedActionProjection.updatedAtCampaignMinute', 'cannot precede activity start.')
  }
  return deepFreezeStrictJson({
    schemaVersion: ITEM_EXTENDED_ACTION_SCHEMA_VERSION,
    activityId: id(root.activityId, 'itemExtendedActionProjection.activityId', ITEM_EXTENDED_ACTION_ID_PATTERN),
    revision: integer(root.revision, 'itemExtendedActionProjection.revision'),
    status,
    item: {
      canonicalId: text(item.canonicalId, 'itemExtendedActionProjection.item.canonicalId'),
      label: text(item.label, 'itemExtendedActionProjection.item.label'),
    },
    actor: {
      sheetKind: 'trainer',
      sheetSlug: slug(actor.sheetSlug, 'itemExtendedActionProjection.actor.sheetSlug'),
      label: text(actor.label, 'itemExtendedActionProjection.actor.label'),
      href: href(actor.href, 'itemExtendedActionProjection.actor.href'),
    },
    target: parseProjectionTarget(root.target),
    startedAtCampaignMinute,
    updatedAtCampaignMinute,
    completion: {
      costs: uniqueTexts(completion.costs, 'itemExtendedActionProjection.completion.costs', 16),
      sourceNotice: text(completion.sourceNotice, 'itemExtendedActionProjection.completion.sourceNotice'),
      safePendingNotice: text(completion.safePendingNotice, 'itemExtendedActionProjection.completion.safePendingNotice'),
    },
    permissions: { canComplete, canInterrupt, unavailableReason },
    terminal,
  })
}

export const parseItemExtendedActionResult = (value: unknown): ItemExtendedActionResultV1 => {
  const root = record(clone(value, 'itemExtendedActionResult'), 'itemExtendedActionResult')
  exact(root, [
    'schemaVersion', 'operationId', 'activityId', 'status', 'revision', 'exactReplay', 'itemResult',
  ], 'itemExtendedActionResult')
  if (root.schemaVersion !== ITEM_EXTENDED_ACTION_SCHEMA_VERSION) {
    fail('itemExtendedActionResult.schemaVersion', `must be ${ITEM_EXTENDED_ACTION_SCHEMA_VERSION}.`)
  }
  if (root.status !== 'in-progress' && root.status !== 'completed' && root.status !== 'interrupted') {
    fail('itemExtendedActionResult.status', 'contains an unsupported status.')
  }
  const base = {
    schemaVersion: ITEM_EXTENDED_ACTION_SCHEMA_VERSION,
    operationId: id(
      root.operationId,
      'itemExtendedActionResult.operationId',
      ITEM_EXTENDED_ACTION_OPERATION_ID_PATTERN,
    ),
    activityId: id(root.activityId, 'itemExtendedActionResult.activityId', ITEM_EXTENDED_ACTION_ID_PATTERN),
    revision: integer(root.revision, 'itemExtendedActionResult.revision'),
    exactReplay: bool(root.exactReplay, 'itemExtendedActionResult.exactReplay'),
  }
  if (root.status === 'completed') {
    if (root.itemResult === null) fail('itemExtendedActionResult.itemResult', 'completed activity requires an item result.')
    return deepFreezeStrictJson({
      ...base,
      status: 'completed',
      itemResult: parseItemOperationResult(root.itemResult),
    })
  }
  if (root.itemResult !== null) fail('itemExtendedActionResult.itemResult', 'non-completed activity cannot carry an item result.')
  return deepFreezeStrictJson({
    ...base,
    status: root.status as 'in-progress' | 'interrupted',
    itemResult: null,
  })
}
