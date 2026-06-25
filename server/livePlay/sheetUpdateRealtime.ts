import { createHash } from 'node:crypto'
import { parseLivePlayMapSlug, parseLivePlayOpId, type LivePlayCommandEnvelope } from '#shared/livePlayCommands'
import { normalizeRealtimeClientId, sheetChannel, sheetsChannel } from '#shared/realtime'
import { isSheetKind, type SheetKind } from '#shared/sheets'
import { isSlug, SLUG_PATTERN_DESCRIPTION } from '#shared/paths'
import {
  MAX_REALTIME_EVENT_CLIENT_ID_LENGTH,
  cloneRealtimeJsonValue,
  createRealtimeEventMaterial,
  stringifyCanonicalRealtimeJson,
} from '#shared/realtimeEventLog'
import type { AppendRealtimeEventInput } from '../storage/realtimeEventRepository'

export interface AuthoritativeLivePlaySheetUpdate {
  readonly kind: SheetKind
  readonly slug: string
  readonly sheet: Record<string, unknown>
}

export interface LivePlaySheetUpdateRealtimeAppendInputsOptions {
  readonly command: LivePlayCommandEnvelope & { readonly clientId?: unknown }
  readonly updates: readonly AuthoritativeLivePlaySheetUpdate[]
  readonly clientId?: unknown
}

export type LivePlaySheetUpdateRealtimeDestination = 'specific' | 'global'

type NormalizedSheetUpdate = AuthoritativeLivePlaySheetUpdate & {
  readonly canonicalSheet: string
}

const normalizeClientId = (value: unknown): string | undefined => {
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

const sheetIdentityKey = (kind: SheetKind, slug: string): string => `${kind}:${slug}`

const normalizedSheetUpdate = (
  update: AuthoritativeLivePlaySheetUpdate,
  index: number,
): NormalizedSheetUpdate => {
  const label = `updates[${index}]`
  if (!isSheetKind(update.kind)) throw new Error(`${label}.kind must be a valid sheet kind`)
  const slug = assertSheetSlug(update.slug, `${label}.slug`)
  const detachedSheet = assertRecord(
    cloneRealtimeJsonValue(update.sheet, `${label}.sheet`),
    `${label}.sheet`,
  )
  if (detachedSheet.slug !== slug) throw new Error(`${label}.sheet.slug must match ${label}.slug`)
  assertSafeNonNegativeInteger(detachedSheet.revision, `${label}.sheet.revision`)
  assertSafeNonNegativeInteger(detachedSheet.updatedAt, `${label}.sheet.updatedAt`)
  const canonicalSheet = stringifyCanonicalRealtimeJson(detachedSheet, `${label}.sheet`)
  return {
    kind: update.kind,
    slug,
    sheet: detachedSheet,
    canonicalSheet,
  }
}

const deduplicateUpdates = (
  updates: readonly AuthoritativeLivePlaySheetUpdate[],
): readonly NormalizedSheetUpdate[] => {
  const byIdentity = new Map<string, NormalizedSheetUpdate>()
  for (const [index, update] of updates.entries()) {
    const normalized = normalizedSheetUpdate(update, index)
    const key = sheetIdentityKey(normalized.kind, normalized.slug)
    const existing = byIdentity.get(key)
    if (!existing) {
      byIdentity.set(key, normalized)
      continue
    }
    if (existing.canonicalSheet !== normalized.canonicalSheet) {
      throw new Error(`Divergent authoritative live-play sheet documents for ${normalized.kind}/${normalized.slug}`)
    }
  }

  return [...byIdentity.values()].sort((left, right) => (
    left.kind === right.kind
      ? left.slug.localeCompare(right.slug)
      : left.kind.localeCompare(right.kind)
  ))
}

const dedupeHash = (input: {
  readonly mapSlug: string
  readonly opId: string
  readonly kind: SheetKind
  readonly slug: string
  readonly destination: LivePlaySheetUpdateRealtimeDestination
}): string => createHash('sha256')
  .update(stringifyCanonicalRealtimeJson(input, 'live-play sheet realtime dedupe identity'))
  .digest('hex')

export const livePlaySheetUpdateRealtimeDedupeKey = (input: {
  readonly mapSlug: string
  readonly opId: string
  readonly kind: SheetKind
  readonly slug: string
  readonly destination: LivePlaySheetUpdateRealtimeDestination
}): string => `live-play-sheet:${dedupeHash(input)}:${input.destination}`

const appendInputFor = (input: {
  readonly command: LivePlayCommandEnvelope
  readonly update: NormalizedSheetUpdate
  readonly destination: LivePlaySheetUpdateRealtimeDestination
  readonly clientId?: string
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
  const dedupeKey = livePlaySheetUpdateRealtimeDedupeKey({
    mapSlug: input.command.mapSlug,
    opId: input.command.opId,
    kind: input.update.kind,
    slug: input.update.slug,
    destination: input.destination,
  })
  const material = createRealtimeEventMaterial({ event, access, dedupeKey })
  return {
    event: material.event,
    access: material.access,
    ...(material.dedupeKey === undefined ? {} : { dedupeKey: material.dedupeKey }),
  }
}

export const livePlaySheetUpdateRealtimeAppendInputs = ({
  command,
  updates,
  clientId,
}: LivePlaySheetUpdateRealtimeAppendInputsOptions): readonly AppendRealtimeEventInput[] => {
  parseLivePlayMapSlug(command.mapSlug, 'command.mapSlug')
  parseLivePlayOpId(command.opId, 'command.opId')
  const normalizedClientId = normalizeClientId(clientId ?? command.clientId)
  return deduplicateUpdates(updates).flatMap((update) => [
    appendInputFor({ command, update, destination: 'specific', clientId: normalizedClientId }),
    appendInputFor({ command, update, destination: 'global', clientId: normalizedClientId }),
  ])
}
