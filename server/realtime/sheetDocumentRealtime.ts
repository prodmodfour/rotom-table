import { normalizeRealtimeClientId, sheetChannel, sheetsChannel } from '#shared/realtime'
import { isSlug, SLUG_PATTERN_DESCRIPTION } from '#shared/paths'
import { isSheetKind, type SheetKind } from '#shared/sheets'
import {
  MAX_REALTIME_EVENT_CLIENT_ID_LENGTH,
  cloneRealtimeJsonValue,
  createRealtimeEventMaterial,
  stringifyCanonicalRealtimeJson,
} from '#shared/realtimeEventLog'
import type { AppendRealtimeEventInput } from '../storage/realtimeEventRepository'
import { projectSheetEquipmentContributions } from '../utils/sheetPrivacy'

export interface AuthoritativeSheetDocumentUpdate {
  readonly kind: SheetKind
  readonly slug: string
  readonly sheet: Record<string, unknown>
}

export type SheetDocumentRealtimeDestination = 'specific' | 'global'

export interface NormalizedAuthoritativeSheetDocumentUpdate extends AuthoritativeSheetDocumentUpdate {
  readonly canonicalSheet: string
}

export const normalizeRealtimeEventClientIdForEventLog = (value: unknown): string | undefined => {
  const clientId = normalizeRealtimeClientId(value)
  if (clientId === undefined) return undefined
  if (clientId.trim().length === 0) return undefined
  if (clientId.length > MAX_REALTIME_EVENT_CLIENT_ID_LENGTH) return undefined
  return clientId
}

const assertSheetSlug = (value: unknown, label: string): string => {
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
    throw new Error(`${label} must be a complete sheet object`)
  }
  return value as Record<string, unknown>
}

export const sheetDocumentIdentityKey = (kind: SheetKind, slug: string): string => `${kind}:${slug}`

export const normalizeAuthoritativeSheetDocumentUpdate = (
  update: AuthoritativeSheetDocumentUpdate,
  label = 'sheet update',
): NormalizedAuthoritativeSheetDocumentUpdate => {
  if (!isSheetKind(update.kind)) throw new Error(`${label}.kind must be a valid sheet kind`)
  const slug = assertSheetSlug(update.slug, `${label}.slug`)
  const detachedSheet = assertRecord(
    cloneRealtimeJsonValue(update.sheet, `${label}.sheet`),
    `${label}.sheet`,
  )
  if (detachedSheet.slug !== slug) throw new Error(`${label}.sheet.slug must match ${label}.slug`)
  assertSafeNonNegativeInteger(detachedSheet.revision, `${label}.sheet.revision`)
  assertSafeNonNegativeInteger(detachedSheet.updatedAt, `${label}.sheet.updatedAt`)
  const authoritativeSheet = projectSheetEquipmentContributions(update.kind, detachedSheet)
  const canonicalSheet = stringifyCanonicalRealtimeJson(authoritativeSheet, `${label}.sheet`)
  return {
    kind: update.kind,
    slug,
    sheet: authoritativeSheet,
    canonicalSheet,
  }
}

export const deduplicateAuthoritativeSheetDocumentUpdates = (
  updates: readonly AuthoritativeSheetDocumentUpdate[],
  options: { readonly divergentMessagePrefix?: string } = {},
): readonly NormalizedAuthoritativeSheetDocumentUpdate[] => {
  const byIdentity = new Map<string, NormalizedAuthoritativeSheetDocumentUpdate>()
  for (const [index, update] of updates.entries()) {
    const normalized = normalizeAuthoritativeSheetDocumentUpdate(update, `updates[${index}]`)
    const key = sheetDocumentIdentityKey(normalized.kind, normalized.slug)
    const existing = byIdentity.get(key)
    if (!existing) {
      byIdentity.set(key, normalized)
      continue
    }
    if (existing.canonicalSheet !== normalized.canonicalSheet) {
      const prefix = options.divergentMessagePrefix ?? 'Divergent authoritative sheet documents'
      throw new Error(`${prefix} for ${normalized.kind}/${normalized.slug}`)
    }
  }

  return [...byIdentity.values()].sort((left, right) => (
    left.kind === right.kind
      ? left.slug.localeCompare(right.slug)
      : left.kind.localeCompare(right.kind)
  ))
}

export const sheetDocumentUpdatedRealtimeAppendInput = (input: {
  readonly update: NormalizedAuthoritativeSheetDocumentUpdate
  readonly destination: SheetDocumentRealtimeDestination
  readonly clientId?: string
  readonly dedupeKey?: string
}): AppendRealtimeEventInput => {
  const data = {
    kind: input.update.kind,
    slug: input.update.slug,
    sheet: input.update.sheet,
  }
  const event = {
    channel: input.destination === 'specific'
      ? sheetChannel(input.update.kind, input.update.slug)
      : sheetsChannel,
    type: 'updated' as const,
    ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
    data,
  }
  const access = {
    kind: 'sheet-access' as const,
    sheetKind: input.update.kind,
    sheetSlug: input.update.slug,
  }
  const material = createRealtimeEventMaterial({
    event,
    access,
    ...(input.dedupeKey === undefined ? {} : { dedupeKey: input.dedupeKey }),
  })
  return {
    event: material.event,
    access: material.access,
    ...(material.dedupeKey === undefined ? {} : { dedupeKey: material.dedupeKey }),
  }
}
