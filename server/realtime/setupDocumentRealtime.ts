import { createHash } from 'node:crypto'
import { isSlug, SLUG_PATTERN_DESCRIPTION } from '#shared/paths'
import {
  MAX_REALTIME_EVENT_DEDUPE_KEY_LENGTH,
  cloneRealtimeJsonValue,
  createRealtimeEventMaterial,
  stringifyCanonicalRealtimeJson,
  type RealtimeEventDraft,
} from '#shared/realtimeEventLog'
import { isSheetKind, type SheetKind } from '#shared/sheets'
import type { TabletopMap } from '~/types/map'
import type { AppendRealtimeEventInput } from '../storage/realtimeEventRepository'
import { mapDocumentUpdatedRealtimeEvents } from '../utils/mapRealtimeEvents'
import {
  normalizeAuthoritativeSheetDocumentUpdate,
  normalizeRealtimeEventClientIdForEventLog,
  sheetDocumentUpdatedRealtimeAppendInput,
  type NormalizedAuthoritativeSheetDocumentUpdate,
  type SheetDocumentRealtimeDestination,
} from './sheetDocumentRealtime'

export type SetupMapSaveRealtimeDestination = 'map' | 'summary'
export type SetupSheetSaveRealtimeDestination = SheetDocumentRealtimeDestination

export interface SetupSheetSaveRealtimeAppendInputsOptions {
  readonly kind: SheetKind
  readonly slug: string
  readonly sheet: Record<string, unknown>
  readonly clientId?: unknown
}

interface NormalizedAuthoritativeSetupMap {
  readonly slug: string
  readonly revision: number
  readonly updatedAt: number
  readonly map: TabletopMap
}

const assertSlug = (value: unknown, label: string): string => {
  if (!isSlug(value)) throw new Error(`${label} must match ${SLUG_PATTERN_DESCRIPTION}`)
  return value
}

const assertSheetKind = (value: unknown, label: string): SheetKind => {
  if (!isSheetKind(value)) throw new Error(`${label} must be a valid sheet kind`)
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

const dedupeHash = (identity: unknown): string => createHash('sha256')
  .update(stringifyCanonicalRealtimeJson(identity, 'setup save realtime dedupe identity'))
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

const stripUndefinedEventFields = (event: Record<string, unknown>): RealtimeEventDraft => {
  const stripped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(event)) {
    if (value !== undefined) stripped[key] = value
  }
  return stripped as RealtimeEventDraft
}

export const setupMapSaveRealtimeDedupeKey = (input: {
  readonly mapSlug: string
  readonly revision: number
  readonly destination: SetupMapSaveRealtimeDestination
}): string => {
  const mapSlug = assertSlug(input.mapSlug, 'map slug')
  const revision = assertSafeNonNegativeInteger(input.revision, 'map revision')
  const raw = `setup-map:${mapSlug}:${revision}:${input.destination}`
  return boundedDedupeKey({
    raw,
    prefix: 'setup-map',
    destination: input.destination,
    identity: { kind: 'setup-map', mapSlug, revision, destination: input.destination },
  })
}

export const setupSheetSaveRealtimeDedupeKey = (input: {
  readonly kind: SheetKind
  readonly slug: string
  readonly revision: number
  readonly destination: SetupSheetSaveRealtimeDestination
}): string => {
  const kind = assertSheetKind(input.kind, 'sheet kind')
  const slug = assertSlug(input.slug, 'sheet slug')
  const revision = assertSafeNonNegativeInteger(input.revision, 'sheet revision')
  const raw = `setup-sheet:${kind}:${slug}:${revision}:${input.destination}`
  return boundedDedupeKey({
    raw,
    prefix: 'setup-sheet',
    destination: input.destination,
    identity: { kind: 'setup-sheet', sheetKind: kind, sheetSlug: slug, revision, destination: input.destination },
  })
}

export const normalizeAuthoritativeSetupMap = (map: TabletopMap): NormalizedAuthoritativeSetupMap => {
  const detachedMap = assertRecord(cloneRealtimeJsonValue(map, 'map'), 'map')
  const slug = assertSlug(detachedMap.slug, 'map.slug')
  const revision = assertSafeNonNegativeInteger(detachedMap.revision, 'map.revision')
  const updatedAt = assertSafeNonNegativeInteger(detachedMap.updatedAt, 'map.updatedAt')
  return {
    slug,
    revision,
    updatedAt,
    map: detachedMap as unknown as TabletopMap,
  }
}

const setupMapAppendInputFor = (input: {
  readonly map: NormalizedAuthoritativeSetupMap
  readonly event: RealtimeEventDraft
  readonly destination: SetupMapSaveRealtimeDestination
}): AppendRealtimeEventInput => {
  const access = {
    kind: 'map-access' as const,
    mapSlug: input.map.slug,
  }
  const dedupeKey = setupMapSaveRealtimeDedupeKey({
    mapSlug: input.map.slug,
    revision: input.map.revision,
    destination: input.destination,
  })
  const material = createRealtimeEventMaterial({ event: input.event, access, dedupeKey })
  return {
    event: material.event,
    access: material.access,
    ...(material.dedupeKey === undefined ? {} : { dedupeKey: material.dedupeKey }),
  }
}

export const setupMapSaveRealtimeAppendInputs = (
  map: TabletopMap,
  clientId?: unknown,
): readonly AppendRealtimeEventInput[] => {
  const normalizedMap = normalizeAuthoritativeSetupMap(map)
  const normalizedClientId = normalizeRealtimeEventClientIdForEventLog(clientId)
  const [mapEvent, summaryEvent] = mapDocumentUpdatedRealtimeEvents(normalizedMap.map, normalizedClientId)
  if (!mapEvent || !summaryEvent) throw new Error('setup map save realtime events could not be constructed')
  return [
    setupMapAppendInputFor({
      map: normalizedMap,
      event: stripUndefinedEventFields(mapEvent as unknown as Record<string, unknown>),
      destination: 'map',
    }),
    setupMapAppendInputFor({
      map: normalizedMap,
      event: stripUndefinedEventFields(summaryEvent as unknown as Record<string, unknown>),
      destination: 'summary',
    }),
  ]
}

const normalizeSetupSheet = (
  options: SetupSheetSaveRealtimeAppendInputsOptions,
): NormalizedAuthoritativeSheetDocumentUpdate => normalizeAuthoritativeSheetDocumentUpdate({
  kind: options.kind,
  slug: options.slug,
  sheet: options.sheet,
}, 'sheet')

export const setupSheetSaveRealtimeAppendInputs = (
  options: SetupSheetSaveRealtimeAppendInputsOptions,
): readonly AppendRealtimeEventInput[] => {
  const update = normalizeSetupSheet(options)
  const normalizedClientId = normalizeRealtimeEventClientIdForEventLog(options.clientId)
  return [
    sheetDocumentUpdatedRealtimeAppendInput({
      update,
      destination: 'specific',
      clientId: normalizedClientId,
      dedupeKey: setupSheetSaveRealtimeDedupeKey({
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
      dedupeKey: setupSheetSaveRealtimeDedupeKey({
        kind: update.kind,
        slug: update.slug,
        revision: update.sheet.revision as number,
        destination: 'global',
      }),
    }),
  ]
}
