import { createHash } from 'node:crypto'
import { groupInventoryChannel } from '#shared/realtime'
import { isSlug, SLUG_PATTERN_DESCRIPTION } from '#shared/paths'
import {
  MAX_REALTIME_EVENT_DEDUPE_KEY_LENGTH,
  cloneRealtimeJsonValue,
  createRealtimeEventMaterial,
  stringifyCanonicalRealtimeJson,
  type RealtimeEventDraft,
} from '#shared/realtimeEventLog'
import type { SheetKind } from '#shared/sheets'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { AppendRealtimeEventInput } from '../storage/realtimeEventRepository'
import {
  normalizeAuthoritativeSheetDocumentUpdate,
  normalizeRealtimeEventClientIdForEventLog,
  sheetDocumentUpdatedRealtimeAppendInput,
  type NormalizedAuthoritativeSheetDocumentUpdate,
  type SheetDocumentRealtimeDestination,
} from './sheetDocumentRealtime'

export type GroupInventoryRealtimeDestination = 'specific'
export type GroupInventoryAffectedSheetRealtimeDestination = SheetDocumentRealtimeDestination
export type GroupInventoryRealtimeOperation = 'save' | 'transfer-to-trainer' | 'transfer-to-group' | 'shop-checkout'

export interface GroupInventoryAffectedSheetUpdate {
  readonly kind: SheetKind
  readonly slug: string
  readonly sheet: Record<string, unknown>
}

interface NormalizedAuthoritativeGroupInventoryUpdate {
  readonly slug: string
  readonly revision: number
  readonly updatedAt: number
  readonly document: GroupInventoryDocument
}

const assertSlug = (value: unknown, label: string): string => {
  if (!isSlug(value)) throw new Error(`${label} must match ${SLUG_PATTERN_DESCRIPTION}`)
  return value
}

const assertSafeNonNegativeInteger = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a safe non-negative integer`)
  }
  return value
}

const assertRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a complete JSON-safe object`)
  }
  return value as Record<string, unknown>
}

const stripUndefinedEventFields = (event: Record<string, unknown>): RealtimeEventDraft => {
  const stripped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(event)) {
    if (value !== undefined) stripped[key] = value
  }
  return stripped as RealtimeEventDraft
}

const dedupeHash = (identity: unknown): string => createHash('sha256')
  .update(stringifyCanonicalRealtimeJson(identity, 'group inventory realtime dedupe identity'))
  .digest('hex')

const boundedDedupeKey = (input: {
  readonly raw: string
  readonly prefix: string
  readonly destination: string
  readonly identity: unknown
}): string => {
  if (input.raw.length <= MAX_REALTIME_EVENT_DEDUPE_KEY_LENGTH) return input.raw
  return `${input.prefix}:${dedupeHash(input.identity)}:${input.destination}`
}

export const groupInventoryUpdatedRealtimeDedupeKey = (input: {
  readonly groupSlug: string
  readonly revision: number
  readonly destination: GroupInventoryRealtimeDestination
  readonly operation: GroupInventoryRealtimeOperation
}): string => {
  const groupSlug = assertSlug(input.groupSlug, 'group inventory slug')
  const revision = assertSafeNonNegativeInteger(input.revision, 'group inventory revision')
  const raw = `group-inventory:${input.operation}:${groupSlug}:${revision}:${input.destination}`
  return boundedDedupeKey({
    raw,
    prefix: `group-inventory:${input.operation}`,
    destination: input.destination,
    identity: {
      kind: 'group-inventory',
      operation: input.operation,
      groupSlug,
      revision,
      destination: input.destination,
    },
  })
}

export const groupInventoryAffectedSheetRealtimeDedupeKey = (input: {
  readonly operation: Extract<GroupInventoryRealtimeOperation, 'transfer-to-trainer' | 'transfer-to-group'>
  readonly kind: SheetKind
  readonly slug: string
  readonly revision: number
  readonly destination: GroupInventoryAffectedSheetRealtimeDestination
}): string => {
  const slug = assertSlug(input.slug, 'sheet slug')
  const revision = assertSafeNonNegativeInteger(input.revision, 'sheet revision')
  const raw = `group-inventory-sheet:${input.operation}:${input.kind}:${slug}:${revision}:${input.destination}`
  return boundedDedupeKey({
    raw,
    prefix: `group-inventory-sheet:${input.operation}`,
    destination: input.destination,
    identity: {
      kind: 'group-inventory-sheet',
      operation: input.operation,
      sheetKind: input.kind,
      sheetSlug: slug,
      revision,
      destination: input.destination,
    },
  })
}

export const normalizeAuthoritativeGroupInventoryUpdate = (
  document: GroupInventoryDocument,
  label = 'group inventory',
): NormalizedAuthoritativeGroupInventoryUpdate => {
  const detachedDocument = assertRecord(cloneRealtimeJsonValue(document, label), label)
  const slug = assertSlug(detachedDocument.slug, `${label}.slug`)
  const revision = assertSafeNonNegativeInteger(detachedDocument.revision, `${label}.revision`)
  const updatedAt = assertSafeNonNegativeInteger(detachedDocument.updatedAt, `${label}.updatedAt`)
  return {
    slug,
    revision,
    updatedAt,
    document: detachedDocument as unknown as GroupInventoryDocument,
  }
}

export const groupInventoryUpdatedRealtimeAppendInputs = (
  document: GroupInventoryDocument,
  clientId?: unknown,
  operation: GroupInventoryRealtimeOperation = 'save',
): readonly AppendRealtimeEventInput[] => {
  const update = normalizeAuthoritativeGroupInventoryUpdate(document)
  const normalizedClientId = normalizeRealtimeEventClientIdForEventLog(clientId)
  const event = stripUndefinedEventFields({
    channel: groupInventoryChannel(update.slug),
    type: 'updated',
    revision: update.revision,
    ...(normalizedClientId === undefined ? {} : { clientId: normalizedClientId }),
    data: {
      slug: update.slug,
      document: update.document,
    },
  })
  const access = {
    kind: 'group-inventory-access' as const,
    groupSlug: update.slug,
  }
  const dedupeKey = groupInventoryUpdatedRealtimeDedupeKey({
    groupSlug: update.slug,
    revision: update.revision,
    destination: 'specific',
    operation,
  })
  const material = createRealtimeEventMaterial({ event, access, dedupeKey })
  return [{
    event: material.event,
    access: material.access,
    ...(material.dedupeKey === undefined ? {} : { dedupeKey: material.dedupeKey }),
  }]
}

const normalizeAffectedSheetUpdate = (
  update: GroupInventoryAffectedSheetUpdate,
): NormalizedAuthoritativeSheetDocumentUpdate => normalizeAuthoritativeSheetDocumentUpdate(update, 'group inventory affected sheet')

export const groupInventoryAffectedSheetUpdatedRealtimeAppendInputs = (input: {
  readonly update: GroupInventoryAffectedSheetUpdate
  readonly clientId?: unknown
  readonly operation: Extract<GroupInventoryRealtimeOperation, 'transfer-to-trainer' | 'transfer-to-group'>
}): readonly AppendRealtimeEventInput[] => {
  const update = normalizeAffectedSheetUpdate(input.update)
  const normalizedClientId = normalizeRealtimeEventClientIdForEventLog(input.clientId)
  return [
    sheetDocumentUpdatedRealtimeAppendInput({
      update,
      destination: 'specific',
      clientId: normalizedClientId,
      dedupeKey: groupInventoryAffectedSheetRealtimeDedupeKey({
        operation: input.operation,
        kind: update.kind,
        slug: update.slug,
        revision: update.sheet.revision as number,
        destination: 'specific',
      }),
    }),
    sheetDocumentUpdatedRealtimeAppendInput({
      update,
      destination: 'global',
      clientId: normalizedClientId,
      dedupeKey: groupInventoryAffectedSheetRealtimeDedupeKey({
        operation: input.operation,
        kind: update.kind,
        slug: update.slug,
        revision: update.sheet.revision as number,
        destination: 'global',
      }),
    }),
  ]
}
