import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'
import { isSheetKind, type SheetKind } from '../sheets'

export const ITEM_NON_ENCOUNTER_CONTEXT_SCHEMA_VERSION = 1 as const
export const ITEM_NON_ENCOUNTER_CONTEXTS = [
  'sheet', 'campaign', 'workshop', 'extended-action',
] as const
export type ItemNonEncounterContextKind = typeof ITEM_NON_ENCOUNTER_CONTEXTS[number]
export type ItemExecutableContextKind = 'encounter' | ItemNonEncounterContextKind

export const ITEM_NON_ENCOUNTER_TARGET_AUTHORITIES = [
  'actor', 'actor-roster', 'profile-control', 'gm-override',
] as const
export type ItemNonEncounterTargetAuthorityKind = typeof ITEM_NON_ENCOUNTER_TARGET_AUTHORITIES[number]

export interface ItemNonEncounterTargetAuthorityV1 {
  readonly targetId: string
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly sheetRevision: number
  /** Exact roster owner when one unambiguous Trainer owns the Pokémon. */
  readonly ownerTrainerSlug: string | null
  readonly authority: ItemNonEncounterTargetAuthorityKind
}

export type ItemNonEncounterExtendedActionV1 =
  | {
      readonly mode: 'immediate'
      readonly phase: 'completion'
      readonly activityId: null
      readonly activityRevision: null
      readonly startedAtCampaignMinute: null
    }
  | {
      readonly mode: 'extended'
      /** Declaration is non-executable until the extended-action runtime supplies a completion boundary. */
      readonly phase: 'declaration' | 'in-progress' | 'completion'
      readonly activityId: string | null
      readonly activityRevision: number | null
      readonly startedAtCampaignMinute: number | null
    }

export interface ItemNonEncounterGmConfirmationV1 {
  readonly required: boolean
  readonly status: 'not-required' | 'required' | 'confirmed'
  /** Opaque immutable evidence identity. It never carries a profile or private note. */
  readonly evidenceId: string | null
}

/**
 * Immutable server-authored evidence for an item operation that does not use
 * encounter geometry or turn state. It is stored with the deterministic plan,
 * never accepted as browser authority.
 */
export interface ItemNonEncounterExecutionSnapshotV1 {
  readonly schemaVersion: typeof ITEM_NON_ENCOUNTER_CONTEXT_SCHEMA_VERSION
  readonly context: ItemNonEncounterContextKind
  readonly campaignTime: {
    readonly clockRevision: number
    readonly campaignMinute: number
  }
  readonly actor: {
    readonly sheetKind: SheetKind
    readonly sheetSlug: string
    readonly sheetRevision: number
  }
  readonly targetAuthorities: readonly ItemNonEncounterTargetAuthorityV1[]
  readonly extendedAction: ItemNonEncounterExtendedActionV1
  readonly gmConfirmation: ItemNonEncounterGmConfirmationV1
}

export class ItemNonEncounterContextValidationError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'ItemNonEncounterContextValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const CONTEXT_SET = new Set<string>(ITEM_NON_ENCOUNTER_CONTEXTS)
const TARGET_AUTHORITY_SET = new Set<string>(ITEM_NON_ENCOUNTER_TARGET_AUTHORITIES)
const PHASE_SET = new Set<string>(['declaration', 'in-progress', 'completion'])
const CONFIRMATION_STATUS_SET = new Set<string>(['not-required', 'required', 'confirmed'])
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,399}$/

const fail = (path: string, detail: string): never => {
  throw new ItemNonEncounterContextValidationError(path, detail)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail(path, 'must be a plain object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(value, field))
    || Object.keys(value).some(field => !allowed.has(field))) fail(path, 'has an invalid shape.')
}
const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim() !== value || !value
    || value.length > 400 || CONTROL_CHARACTER_PATTERN.test(value) || !ID_PATTERN.test(value)) {
    fail(path, 'must be a bounded stable identifier.')
  }
  return value as string
}
const integer = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(path, 'must be a safe non-negative integer.')
  return Number(value)
}
const nullableInteger = (value: unknown, path: string): number | null => value === null ? null : integer(value, path)
const nullableText = (value: unknown, path: string): string | null => value === null ? null : text(value, path)

export const parseItemNonEncounterExecutionSnapshot = (
  value: unknown,
): ItemNonEncounterExecutionSnapshotV1 => {
  const root = record(cloneStrictJson(value, 'itemNonEncounterContext', {
    limits: {
      depth: 8,
      nodes: 1_024,
      objectFields: 16,
      arrayEntries: 64,
      stringLength: 400,
      objectKeyLength: 100,
    },
    rootLabel: 'item non-encounter context',
    valueLabel: 'item non-encounter contexts',
    failNotJson: (path, detail) => fail(path, detail),
    failLimit: (path, detail) => fail(path, detail),
  }), 'itemNonEncounterContext')
  exact(root, [
    'schemaVersion', 'context', 'campaignTime', 'actor', 'targetAuthorities',
    'extendedAction', 'gmConfirmation',
  ], 'itemNonEncounterContext')
  if (root.schemaVersion !== ITEM_NON_ENCOUNTER_CONTEXT_SCHEMA_VERSION) {
    fail('itemNonEncounterContext.schemaVersion', `must be ${ITEM_NON_ENCOUNTER_CONTEXT_SCHEMA_VERSION}.`)
  }
  if (typeof root.context !== 'string' || !CONTEXT_SET.has(root.context)) {
    fail('itemNonEncounterContext.context', 'contains an unsupported context.')
  }
  const campaignTime = record(root.campaignTime, 'itemNonEncounterContext.campaignTime')
  exact(campaignTime, ['clockRevision', 'campaignMinute'], 'itemNonEncounterContext.campaignTime')
  const actor = record(root.actor, 'itemNonEncounterContext.actor')
  exact(actor, ['sheetKind', 'sheetSlug', 'sheetRevision'], 'itemNonEncounterContext.actor')
  if (!isSheetKind(actor.sheetKind)) fail('itemNonEncounterContext.actor.sheetKind', 'must be pokemon or trainer.')
  const targetInput = Array.isArray(root.targetAuthorities)
    ? root.targetAuthorities
    : fail('itemNonEncounterContext.targetAuthorities', 'must be an array.')
  if (targetInput.length > 64) fail('itemNonEncounterContext.targetAuthorities', 'supports at most 64 entries.')
  const targetAuthorities = targetInput.map((entry, index): ItemNonEncounterTargetAuthorityV1 => {
    const path = `itemNonEncounterContext.targetAuthorities[${index}]`
    const row = record(entry, path)
    exact(row, [
      'targetId', 'sheetKind', 'sheetSlug', 'sheetRevision', 'ownerTrainerSlug', 'authority',
    ], path)
    if (!isSheetKind(row.sheetKind)) fail(`${path}.sheetKind`, 'must be pokemon or trainer.')
    if (typeof row.authority !== 'string' || !TARGET_AUTHORITY_SET.has(row.authority)) {
      fail(`${path}.authority`, 'contains an unsupported target authority.')
    }
    return {
      targetId: text(row.targetId, `${path}.targetId`),
      sheetKind: row.sheetKind as SheetKind,
      sheetSlug: text(row.sheetSlug, `${path}.sheetSlug`),
      sheetRevision: integer(row.sheetRevision, `${path}.sheetRevision`),
      ownerTrainerSlug: nullableText(row.ownerTrainerSlug, `${path}.ownerTrainerSlug`),
      authority: row.authority as ItemNonEncounterTargetAuthorityKind,
    }
  })
  if (new Set(targetAuthorities.map(row => row.targetId)).size !== targetAuthorities.length
    || new Set(targetAuthorities.map(row => `${row.sheetKind}:${row.sheetSlug}`)).size !== targetAuthorities.length) {
    fail('itemNonEncounterContext.targetAuthorities', 'must contain unique target and sheet identities.')
  }
  const extended = record(root.extendedAction, 'itemNonEncounterContext.extendedAction')
  exact(extended, [
    'mode', 'phase', 'activityId', 'activityRevision', 'startedAtCampaignMinute',
  ], 'itemNonEncounterContext.extendedAction')
  let extendedAction: ItemNonEncounterExtendedActionV1 | null = null
  if (extended.mode === 'immediate') {
    if (extended.phase !== 'completion' || extended.activityId !== null
      || extended.activityRevision !== null || extended.startedAtCampaignMinute !== null) {
      fail('itemNonEncounterContext.extendedAction', 'immediate execution must be an activity-free completion.')
    }
    extendedAction = {
      mode: 'immediate', phase: 'completion', activityId: null,
      activityRevision: null, startedAtCampaignMinute: null,
    }
  }
  else if (extended.mode === 'extended') {
    if (typeof extended.phase !== 'string' || !PHASE_SET.has(extended.phase)) {
      fail('itemNonEncounterContext.extendedAction.phase', 'contains an unsupported extended-action phase.')
    }
    const activityId = nullableText(extended.activityId, 'itemNonEncounterContext.extendedAction.activityId')
    const activityRevision = nullableInteger(extended.activityRevision, 'itemNonEncounterContext.extendedAction.activityRevision')
    const startedAtCampaignMinute = nullableInteger(
      extended.startedAtCampaignMinute,
      'itemNonEncounterContext.extendedAction.startedAtCampaignMinute',
    )
    const declaration = extended.phase === 'declaration'
    if (declaration !== (activityId === null && activityRevision === null && startedAtCampaignMinute === null)) {
      fail('itemNonEncounterContext.extendedAction', 'only declaration may omit all activity authority.')
    }
    if (!declaration && (activityId === null || activityRevision === null || startedAtCampaignMinute === null)) {
      fail('itemNonEncounterContext.extendedAction', 'progress and completion require exact activity authority.')
    }
    extendedAction = {
      mode: 'extended',
      phase: extended.phase as 'declaration' | 'in-progress' | 'completion',
      activityId,
      activityRevision,
      startedAtCampaignMinute,
    }
  }
  else fail('itemNonEncounterContext.extendedAction.mode', 'must be immediate or extended.')
  const confirmation = record(root.gmConfirmation, 'itemNonEncounterContext.gmConfirmation')
  exact(confirmation, ['required', 'status', 'evidenceId'], 'itemNonEncounterContext.gmConfirmation')
  if (typeof confirmation.required !== 'boolean') fail('itemNonEncounterContext.gmConfirmation.required', 'must be boolean.')
  if (typeof confirmation.status !== 'string' || !CONFIRMATION_STATUS_SET.has(confirmation.status)) {
    fail('itemNonEncounterContext.gmConfirmation.status', 'contains an unsupported status.')
  }
  const evidenceId = nullableText(confirmation.evidenceId, 'itemNonEncounterContext.gmConfirmation.evidenceId')
  if (!confirmation.required && (confirmation.status !== 'not-required' || evidenceId !== null)) {
    fail('itemNonEncounterContext.gmConfirmation', 'an optional confirmation must be not-required without evidence.')
  }
  if (confirmation.required && confirmation.status === 'not-required') {
    fail('itemNonEncounterContext.gmConfirmation.status', 'a required confirmation cannot be not-required.')
  }
  if ((confirmation.status === 'confirmed') !== (evidenceId !== null)) {
    fail('itemNonEncounterContext.gmConfirmation', 'confirmed status must carry exactly one evidence identity.')
  }
  return deepFreezeStrictJson({
    schemaVersion: ITEM_NON_ENCOUNTER_CONTEXT_SCHEMA_VERSION,
    context: root.context as ItemNonEncounterContextKind,
    campaignTime: {
      clockRevision: integer(campaignTime.clockRevision, 'itemNonEncounterContext.campaignTime.clockRevision'),
      campaignMinute: integer(campaignTime.campaignMinute, 'itemNonEncounterContext.campaignTime.campaignMinute'),
    },
    actor: {
      sheetKind: actor.sheetKind as SheetKind,
      sheetSlug: text(actor.sheetSlug, 'itemNonEncounterContext.actor.sheetSlug'),
      sheetRevision: integer(actor.sheetRevision, 'itemNonEncounterContext.actor.sheetRevision'),
    },
    targetAuthorities,
    extendedAction: extendedAction
      ?? fail('itemNonEncounterContext.extendedAction', 'could not be resolved.'),
    gmConfirmation: {
      required: confirmation.required as boolean,
      status: confirmation.status as ItemNonEncounterGmConfirmationV1['status'],
      evidenceId,
    },
  })
}
