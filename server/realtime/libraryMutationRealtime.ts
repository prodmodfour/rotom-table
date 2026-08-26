import { createHash } from 'node:crypto'
import {
  MAX_REALTIME_EVENT_DEDUPE_KEY_LENGTH,
  cloneRealtimeJsonValue,
  createRealtimeEventMaterial,
  stringifyCanonicalRealtimeJson,
  type PersistedRealtimeEvent,
  type RealtimeEventAccess,
  type RealtimeEventDraft,
} from '#shared/realtimeEventLog'
import { isSlug, SLUG_PATTERN_DESCRIPTION } from '#shared/paths'
import { isSheetKind, type SheetKind } from '#shared/sheets'
import { mapChannel, mapsChannel, sheetChannel, sheetsChannel } from '#shared/realtime'
import type { MapInteractionMode } from '#shared/mapInteractionMode'
import { MAP_INTERACTION_MODE_REALTIME_EVENT_TYPE } from '#shared/mapInteractionMode'
import type { TabletopMap } from '~/types/map'
import { summarizeMap } from '../utils/mapSummaries'
import { mapRevisionForRealtime } from '../utils/mapRealtimeEvents'
import type { RetargetMapSheetPlacementsResult } from '../storage/mapRepository'
import type { PersistedSheet } from '../storage/sheetRepository'
import type { AppendRealtimeEventInput } from '../storage/realtimeEventRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { publishSequencedRealtime } from '../utils/realtime'
import {
  normalizeAuthoritativeSheetDocumentUpdate,
  normalizeRealtimeEventClientIdForEventLog,
} from './sheetDocumentRealtime'

export type LibraryMapUpdateOperation =
  | 'move'
  | 'folder-move'
  | 'sheet-rename-retarget'
  | 'sheet-delete-cleanup'
  | 'encounter-settlement'

export interface LibraryRealtimePublicationFailureContext {
  readonly event: PersistedRealtimeEvent
  readonly sequence: number
  readonly channel: string
  readonly type: string
  readonly error: unknown
}

export type PersistedLibraryRealtimeEventPublisher = (event: PersistedRealtimeEvent) => void

export type LibraryRealtimePublicationFailureReporter = (
  context: LibraryRealtimePublicationFailureContext,
) => void

export interface DatabaseBackedLibraryMutationDependency {
  readonly database?: RotomDatabase
}

const gmOnlyAccess: RealtimeEventAccess = { kind: 'gm-only' }

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

const normalizeFolder = (value: unknown, label: string): string => {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value
}

const stripUndefinedEventFields = (event: Record<string, unknown>): RealtimeEventDraft => {
  const stripped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(event)) {
    if (value !== undefined) stripped[key] = value
  }
  return stripped as RealtimeEventDraft
}

const stripUndefinedJsonFields = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripUndefinedJsonFields)
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return value
    const stripped: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry !== undefined) stripped[key] = stripUndefinedJsonFields(entry)
    }
    return stripped
  }
  return value
}

const cloneData = <T>(value: T, label: string): T =>
  cloneRealtimeJsonValue(stripUndefinedJsonFields(value), label) as unknown as T

const mapAccess = (mapSlug: string): RealtimeEventAccess => ({
  kind: 'map-access',
  mapSlug: assertSlug(mapSlug, 'map access slug'),
})

const sheetAccess = (sheetKind: SheetKind, sheetSlug: string): RealtimeEventAccess => ({
  kind: 'sheet-access',
  sheetKind: assertSheetKind(sheetKind, 'sheet access kind'),
  sheetSlug: assertSlug(sheetSlug, 'sheet access slug'),
})

const dedupeHash = (identity: unknown): string => createHash('sha256')
  .update(stringifyCanonicalRealtimeJson(identity, 'library realtime dedupe identity'))
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

const libraryDedupeKey = (input: {
  readonly family: 'map' | 'sheet' | 'interaction-mode'
  readonly operation: string
  readonly resource: string
  readonly revision?: number
  readonly destination: string
  readonly extra?: unknown
}): string => {
  const revision = input.revision === undefined
    ? undefined
    : assertSafeNonNegativeInteger(input.revision, 'library realtime revision')
  const identity = {
    family: input.family,
    operation: input.operation,
    resource: input.resource,
    ...(revision === undefined ? {} : { revision }),
    destination: input.destination,
    ...(input.extra === undefined ? {} : { extra: input.extra }),
  }
  const raw = [
    'library',
    input.family,
    input.operation,
    input.resource,
    ...(revision === undefined ? [] : [String(revision)]),
    input.destination,
  ].join(':')
  return boundedDedupeKey({
    raw,
    prefix: `library:${input.family}:${input.operation}`,
    destination: input.destination,
    identity,
  })
}

const appendInput = (input: {
  readonly event: RealtimeEventDraft
  readonly access: RealtimeEventAccess
  readonly dedupeKey?: string
}): AppendRealtimeEventInput => {
  const material = createRealtimeEventMaterial({
    event: input.event,
    access: input.access,
    ...(input.dedupeKey === undefined ? {} : { dedupeKey: input.dedupeKey }),
  })
  return {
    event: material.event,
    access: material.access,
    ...(material.dedupeKey === undefined ? {} : { dedupeKey: material.dedupeKey }),
  }
}

const draftEvent = (input: {
  readonly channel: string
  readonly type: string
  readonly revision?: number
  readonly clientId?: string
  readonly data: unknown
}): RealtimeEventDraft => stripUndefinedEventFields({
  channel: input.channel,
  type: input.type,
  ...(input.revision === undefined ? {} : { revision: input.revision }),
  ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
  data: cloneData(input.data, `${input.type} realtime data`),
})

const normalizeAuthoritativeMap = (map: TabletopMap): TabletopMap => {
  const detached = assertRecord(cloneRealtimeJsonValue(stripUndefinedJsonFields(map), 'map'), 'map')
  const slug = assertSlug(detached.slug, 'map.slug')
  const revision = assertSafeNonNegativeInteger(detached.revision, 'map.revision')
  assertSafeNonNegativeInteger(detached.updatedAt, 'map.updatedAt')
  return { ...detached, slug, revision } as unknown as TabletopMap
}

const normalizePersistedSheet = (sheet: PersistedSheet): PersistedSheet => {
  const kind = assertSheetKind(sheet.kind, 'sheet.kind')
  const slug = assertSlug(sheet.slug, 'sheet.slug')
  const update = normalizeAuthoritativeSheetDocumentUpdate({ kind, slug, sheet: sheet.sheet }, 'sheet')
  const revision = assertSafeNonNegativeInteger(sheet.revision, 'sheet.revision')
  const updatedAt = assertSafeNonNegativeInteger(sheet.updatedAt, 'sheet.updatedAt')
  if (update.sheet.revision !== revision) throw new Error('sheet.sheet.revision must match sheet.revision')
  if (update.sheet.updatedAt !== updatedAt) throw new Error('sheet.sheet.updatedAt must match sheet.updatedAt')
  return {
    kind,
    slug,
    sheet: update.sheet,
    revision,
    updatedAt,
  }
}

const normalizedClientId = (clientId: unknown): string | undefined =>
  normalizeRealtimeEventClientIdForEventLog(clientId)

const mapUpdatedAppendInputs = (input: {
  readonly map: TabletopMap
  readonly clientId?: string
  readonly operation: LibraryMapUpdateOperation | 'rename'
  readonly summaryType: 'updated' | 'moved'
}): readonly AppendRealtimeEventInput[] => {
  const map = normalizeAuthoritativeMap(input.map)
  const revision = mapRevisionForRealtime(map)
  const access = mapAccess(map.slug)
  return [
    appendInput({
      event: draftEvent({
        channel: mapChannel(map.slug),
        type: 'updated',
        revision,
        clientId: input.clientId,
        data: map,
      }),
      access,
      dedupeKey: libraryDedupeKey({
        family: 'map',
        operation: input.operation,
        resource: map.slug,
        revision,
        destination: mapChannel(map.slug),
      }),
    }),
    appendInput({
      event: draftEvent({
        channel: mapsChannel,
        type: input.summaryType,
        revision,
        clientId: input.clientId,
        data: summarizeMap(map),
      }),
      access,
      dedupeKey: libraryDedupeKey({
        family: 'map',
        operation: input.operation,
        resource: map.slug,
        revision,
        destination: mapsChannel,
      }),
    }),
  ]
}

const sheetDocumentUpdatedAppendInputs = (input: {
  readonly sheet: PersistedSheet
  readonly clientId?: string
  readonly operation: string
}): readonly AppendRealtimeEventInput[] => {
  const sheet = normalizePersistedSheet(input.sheet)
  const data = { kind: sheet.kind, slug: sheet.slug, sheet: sheet.sheet }
  const access = sheetAccess(sheet.kind, sheet.slug)
  return [
    appendInput({
      event: draftEvent({
        channel: sheetChannel(sheet.kind, sheet.slug),
        type: 'updated',
        clientId: input.clientId,
        data,
      }),
      access,
      dedupeKey: libraryDedupeKey({
        family: 'sheet',
        operation: input.operation,
        resource: `${sheet.kind}:${sheet.slug}`,
        revision: sheet.revision,
        destination: sheetChannel(sheet.kind, sheet.slug),
      }),
    }),
    appendInput({
      event: draftEvent({
        channel: sheetsChannel,
        type: 'updated',
        clientId: input.clientId,
        data,
      }),
      access,
      dedupeKey: libraryDedupeKey({
        family: 'sheet',
        operation: input.operation,
        resource: `${sheet.kind}:${sheet.slug}`,
        revision: sheet.revision,
        destination: sheetsChannel,
      }),
    }),
  ]
}

export const mapLibraryCreatedRealtimeAppendInputs = (
  mapInput: TabletopMap,
  clientId?: unknown,
): readonly AppendRealtimeEventInput[] => {
  const map = normalizeAuthoritativeMap(mapInput)
  const revision = mapRevisionForRealtime(map)
  const access = mapAccess(map.slug)
  const client = normalizedClientId(clientId)
  return [appendInput({
    event: draftEvent({
      channel: mapsChannel,
      type: 'created',
      revision,
      clientId: client,
      data: summarizeMap(map),
    }),
    access,
    dedupeKey: libraryDedupeKey({
      family: 'map',
      operation: 'create',
      resource: map.slug,
      revision,
      destination: mapsChannel,
    }),
  })]
}

export const mapLibraryMovedRealtimeAppendInputs = (
  mapInput: TabletopMap,
  clientId?: unknown,
  operation: LibraryMapUpdateOperation = 'move',
): readonly AppendRealtimeEventInput[] => mapUpdatedAppendInputs({
  map: mapInput,
  clientId: normalizedClientId(clientId),
  operation,
  summaryType: 'moved',
})

export const mapLibraryUpdatedRealtimeAppendInputs = (
  mapInput: TabletopMap,
  clientId?: unknown,
  operation: LibraryMapUpdateOperation = 'sheet-rename-retarget',
): readonly AppendRealtimeEventInput[] => mapUpdatedAppendInputs({
  map: mapInput,
  clientId: normalizedClientId(clientId),
  operation,
  summaryType: 'updated',
})

export const mapLibraryRenamedRealtimeAppendInputs = (input: {
  readonly oldSlug: string
  readonly map: TabletopMap
  readonly renamed: boolean
  readonly clientId?: unknown
}): readonly AppendRealtimeEventInput[] => {
  const oldSlug = assertSlug(input.oldSlug, 'old map slug')
  const map = normalizeAuthoritativeMap(input.map)
  const revision = mapRevisionForRealtime(map)
  const access = mapAccess(map.slug)
  const client = normalizedClientId(input.clientId)

  if (!input.renamed) {
    return mapUpdatedAppendInputs({ map, clientId: client, operation: 'rename', summaryType: 'updated' })
  }

  return [
    appendInput({
      event: draftEvent({
        channel: mapChannel(oldSlug),
        type: 'renamed',
        revision,
        clientId: client,
        data: { oldSlug, newSlug: map.slug, map },
      }),
      access,
      dedupeKey: libraryDedupeKey({
        family: 'map',
        operation: 'rename',
        resource: map.slug,
        revision,
        destination: mapChannel(oldSlug),
        extra: { oldSlug },
      }),
    }),
    appendInput({
      event: draftEvent({
        channel: mapChannel(map.slug),
        type: 'updated',
        revision,
        clientId: client,
        data: map,
      }),
      access,
      dedupeKey: libraryDedupeKey({
        family: 'map',
        operation: 'rename',
        resource: map.slug,
        revision,
        destination: mapChannel(map.slug),
        extra: { oldSlug },
      }),
    }),
    appendInput({
      event: draftEvent({
        channel: mapsChannel,
        type: 'renamed',
        revision,
        clientId: client,
        data: { oldSlug, summary: summarizeMap(map) },
      }),
      access,
      dedupeKey: libraryDedupeKey({
        family: 'map',
        operation: 'rename',
        resource: map.slug,
        revision,
        destination: mapsChannel,
        extra: { oldSlug },
      }),
    }),
  ]
}

export const mapLibraryDeletedRealtimeAppendInputs = (input: {
  readonly slug: string
  readonly revision?: number
  readonly clientId?: unknown
  readonly operation?: string
}): readonly AppendRealtimeEventInput[] => {
  const slug = assertSlug(input.slug, 'deleted map slug')
  const revision = input.revision === undefined ? undefined : assertSafeNonNegativeInteger(input.revision, 'deleted map revision')
  const client = normalizedClientId(input.clientId)
  const operation = input.operation ?? 'delete'
  return [
    appendInput({
      event: draftEvent({ channel: mapChannel(slug), type: 'deleted', clientId: client, data: { slug } }),
      access: gmOnlyAccess,
      ...(revision === undefined ? {} : {
        dedupeKey: libraryDedupeKey({
          family: 'map',
          operation,
          resource: slug,
          revision,
          destination: mapChannel(slug),
        }),
      }),
    }),
    appendInput({
      event: draftEvent({ channel: mapsChannel, type: 'deleted', clientId: client, data: { slug } }),
      access: gmOnlyAccess,
      ...(revision === undefined ? {} : {
        dedupeKey: libraryDedupeKey({
          family: 'map',
          operation,
          resource: slug,
          revision,
          destination: mapsChannel,
        }),
      }),
    }),
  ]
}

export const mapFolderCreatedRealtimeAppendInputs = (
  folderInput: string,
  clientId?: unknown,
): readonly AppendRealtimeEventInput[] => {
  const folder = normalizeFolder(folderInput, 'map folder')
  return [appendInput({
    event: draftEvent({
      channel: mapsChannel,
      type: 'folder-created',
      clientId: normalizedClientId(clientId),
      data: { folder },
    }),
    access: gmOnlyAccess,
  })]
}

export const mapFolderMovedRealtimeAppendInputs = (input: {
  readonly from: string
  readonly to: string
  readonly affectedMaps?: readonly TabletopMap[]
  readonly clientId?: unknown
}): readonly AppendRealtimeEventInput[] => {
  const from = normalizeFolder(input.from, 'from map folder')
  const to = normalizeFolder(input.to, 'to map folder')
  const client = normalizedClientId(input.clientId)
  return [
    appendInput({
      event: draftEvent({ channel: mapsChannel, type: 'folder-moved', clientId: client, data: { from, to } }),
      access: gmOnlyAccess,
    }),
    ...(input.affectedMaps ?? []).flatMap((map) => mapLibraryMovedRealtimeAppendInputs(map, client, 'folder-move')),
  ]
}

export const mapFolderDeletedRealtimeAppendInputs = (input: {
  readonly folder: string
  readonly deletedMaps?: readonly TabletopMap[]
  readonly clientId?: unknown
}): readonly AppendRealtimeEventInput[] => {
  const folder = normalizeFolder(input.folder, 'map folder')
  const client = normalizedClientId(input.clientId)
  return [
    appendInput({
      event: draftEvent({ channel: mapsChannel, type: 'folder-deleted', clientId: client, data: { folder } }),
      access: gmOnlyAccess,
    }),
    ...(input.deletedMaps ?? []).flatMap((map) => {
      const normalized = normalizeAuthoritativeMap(map)
      return mapLibraryDeletedRealtimeAppendInputs({
        slug: normalized.slug,
        revision: mapRevisionForRealtime(normalized),
        clientId: client,
        operation: 'folder-delete',
      })
    }),
  ]
}

/**
 * Generated-package commits announce only sheet identity and revision to GM clients.
 * Full generated documents (including GM provenance) must never enter realtime rows.
 */
export const sheetLibraryGeneratedIdentityRealtimeAppendInputs = (
  sheetInput: PersistedSheet,
): readonly AppendRealtimeEventInput[] => {
  const sheet = normalizePersistedSheet(sheetInput)
  return [appendInput({
    event: draftEvent({
      channel: sheetsChannel,
      type: 'updated',
      revision: sheet.revision,
      data: { kind: sheet.kind, slug: sheet.slug, revision: sheet.revision },
    }),
    access: gmOnlyAccess,
    dedupeKey: libraryDedupeKey({
      family: 'sheet',
      operation: 'generated-package-create',
      resource: `${sheet.kind}:${sheet.slug}`,
      revision: sheet.revision,
      destination: sheetsChannel,
    }),
  })]
}

export const sheetLibraryCreatedRealtimeAppendInputs = (
  sheetInput: PersistedSheet,
  clientId?: unknown,
): readonly AppendRealtimeEventInput[] => {
  const sheet = normalizePersistedSheet(sheetInput)
  const client = normalizedClientId(clientId)
  const access = sheetAccess(sheet.kind, sheet.slug)
  return [appendInput({
    event: draftEvent({
      channel: sheetsChannel,
      type: 'updated',
      clientId: client,
      data: { kind: sheet.kind, slug: sheet.slug, sheet: sheet.sheet },
    }),
    access,
    dedupeKey: libraryDedupeKey({
      family: 'sheet',
      operation: 'create',
      resource: `${sheet.kind}:${sheet.slug}`,
      revision: sheet.revision,
      destination: sheetsChannel,
    }),
  })]
}

export const sheetLibraryMovedRealtimeAppendInputs = (
  sheetInput: PersistedSheet,
  folderInput: string,
  clientId?: unknown,
): readonly AppendRealtimeEventInput[] => {
  const sheet = normalizePersistedSheet(sheetInput)
  const folder = normalizeFolder(folderInput, 'sheet folder')
  const client = normalizedClientId(clientId)
  return [appendInput({
    event: draftEvent({
      channel: sheetsChannel,
      type: 'moved',
      clientId: client,
      data: { kind: sheet.kind, slug: sheet.slug, folder },
    }),
    access: sheetAccess(sheet.kind, sheet.slug),
    dedupeKey: libraryDedupeKey({
      family: 'sheet',
      operation: 'move',
      resource: `${sheet.kind}:${sheet.slug}`,
      revision: sheet.revision,
      destination: sheetsChannel,
    }),
  })]
}

export const sheetLibraryRenamedRealtimeAppendInputs = (input: {
  readonly oldSlug: string
  readonly sheet: PersistedSheet
  readonly renamed: boolean
  readonly clientId?: unknown
}): readonly AppendRealtimeEventInput[] => {
  const oldSlug = assertSlug(input.oldSlug, 'old sheet slug')
  const sheet = normalizePersistedSheet(input.sheet)
  const client = normalizedClientId(input.clientId)
  const access = sheetAccess(sheet.kind, sheet.slug)
  const data = { kind: sheet.kind, slug: sheet.slug, sheet: sheet.sheet }
  const renameData = {
    kind: sheet.kind,
    slug: sheet.slug,
    oldSlug,
    newSlug: sheet.slug,
    sheet: sheet.sheet,
  }

  if (!input.renamed) {
    return sheetDocumentUpdatedAppendInputs({ sheet, clientId: client, operation: 'rename' })
  }

  return [
    appendInput({
      event: draftEvent({ channel: sheetChannel(sheet.kind, oldSlug), type: 'renamed', clientId: client, data: renameData }),
      access,
      dedupeKey: libraryDedupeKey({
        family: 'sheet',
        operation: 'rename',
        resource: `${sheet.kind}:${sheet.slug}`,
        revision: sheet.revision,
        destination: sheetChannel(sheet.kind, oldSlug),
        extra: { oldSlug },
      }),
    }),
    appendInput({
      event: draftEvent({ channel: sheetChannel(sheet.kind, sheet.slug), type: 'updated', clientId: client, data }),
      access,
      dedupeKey: libraryDedupeKey({
        family: 'sheet',
        operation: 'rename',
        resource: `${sheet.kind}:${sheet.slug}`,
        revision: sheet.revision,
        destination: sheetChannel(sheet.kind, sheet.slug),
        extra: { oldSlug },
      }),
    }),
    appendInput({
      event: draftEvent({ channel: sheetsChannel, type: 'renamed', clientId: client, data: renameData }),
      access,
      dedupeKey: libraryDedupeKey({
        family: 'sheet',
        operation: 'rename',
        resource: `${sheet.kind}:${sheet.slug}`,
        revision: sheet.revision,
        destination: sheetsChannel,
        extra: { oldSlug },
      }),
    }),
  ]
}

export const sheetLibraryDeletedRealtimeAppendInputs = (input: {
  readonly kind: SheetKind
  readonly slug: string
  readonly revision?: number
  readonly clientId?: unknown
  readonly operation?: string
}): readonly AppendRealtimeEventInput[] => {
  const kind = assertSheetKind(input.kind, 'deleted sheet kind')
  const slug = assertSlug(input.slug, 'deleted sheet slug')
  const revision = input.revision === undefined ? undefined : assertSafeNonNegativeInteger(input.revision, 'deleted sheet revision')
  const client = normalizedClientId(input.clientId)
  const operation = input.operation ?? 'delete'
  const data = { kind, slug }
  return [
    appendInput({
      event: draftEvent({ channel: sheetChannel(kind, slug), type: 'deleted', clientId: client, data }),
      access: gmOnlyAccess,
      ...(revision === undefined ? {} : {
        dedupeKey: libraryDedupeKey({
          family: 'sheet',
          operation,
          resource: `${kind}:${slug}`,
          revision,
          destination: sheetChannel(kind, slug),
        }),
      }),
    }),
    appendInput({
      event: draftEvent({ channel: sheetsChannel, type: 'deleted', clientId: client, data }),
      access: gmOnlyAccess,
      ...(revision === undefined ? {} : {
        dedupeKey: libraryDedupeKey({
          family: 'sheet',
          operation,
          resource: `${kind}:${slug}`,
          revision,
          destination: sheetsChannel,
        }),
      }),
    }),
  ]
}

export const sheetFolderCreatedRealtimeAppendInputs = (
  folderInput: string,
  clientId?: unknown,
): readonly AppendRealtimeEventInput[] => {
  const folder = normalizeFolder(folderInput, 'sheet folder')
  return [appendInput({
    event: draftEvent({
      channel: sheetsChannel,
      type: 'folder-created',
      clientId: normalizedClientId(clientId),
      data: { folder },
    }),
    access: gmOnlyAccess,
  })]
}

export const sheetFolderMovedRealtimeAppendInputs = (input: {
  readonly from: string
  readonly to: string
  readonly affectedSheets?: readonly PersistedSheet[]
  readonly clientId?: unknown
}): readonly AppendRealtimeEventInput[] => {
  const from = normalizeFolder(input.from, 'from sheet folder')
  const to = normalizeFolder(input.to, 'to sheet folder')
  const client = normalizedClientId(input.clientId)
  return [
    appendInput({
      event: draftEvent({ channel: sheetsChannel, type: 'folder-moved', clientId: client, data: { from, to } }),
      access: gmOnlyAccess,
    }),
    ...(input.affectedSheets ?? []).flatMap((sheet) => sheetDocumentUpdatedAppendInputs({
      sheet,
      clientId: client,
      operation: 'folder-move',
    })),
  ]
}

export const sheetFolderDeletedRealtimeAppendInputs = (input: {
  readonly folder: string
  readonly deletedSheets?: readonly PersistedSheet[]
  readonly clientId?: unknown
}): readonly AppendRealtimeEventInput[] => {
  const folder = normalizeFolder(input.folder, 'sheet folder')
  const client = normalizedClientId(input.clientId)
  return [
    appendInput({
      event: draftEvent({ channel: sheetsChannel, type: 'folder-deleted', clientId: client, data: { folder } }),
      access: gmOnlyAccess,
    }),
    ...(input.deletedSheets ?? []).flatMap((sheet) => {
      const normalized = normalizePersistedSheet(sheet)
      return sheetLibraryDeletedRealtimeAppendInputs({
        kind: normalized.kind,
        slug: normalized.slug,
        revision: normalized.revision,
        clientId: client,
        operation: 'folder-delete',
      })
    }),
  ]
}

export const sheetRenameMapRetargetRealtimeAppendInputs = (
  mapUpdates: readonly RetargetMapSheetPlacementsResult[],
  clientId?: unknown,
): readonly AppendRealtimeEventInput[] => mapUpdates.flatMap(({ map }) =>
  mapLibraryUpdatedRealtimeAppendInputs(map, clientId, 'sheet-rename-retarget'),
)

export const sheetDeleteMapCleanupRealtimeAppendInputs = (
  mapUpdates: readonly RetargetMapSheetPlacementsResult[],
  clientId?: unknown,
): readonly AppendRealtimeEventInput[] => mapUpdates.flatMap(({ map }) =>
  mapLibraryUpdatedRealtimeAppendInputs(map, clientId, 'sheet-delete-cleanup'),
)

export const interactionModeRealtimeAppendInputs = (input: {
  readonly slug: string
  readonly interactionMode: MapInteractionMode
  readonly updatedAt: number
  readonly clientId?: unknown
}): readonly AppendRealtimeEventInput[] => {
  const slug = assertSlug(input.slug, 'map interaction mode slug')
  const updatedAt = assertSafeNonNegativeInteger(input.updatedAt, 'map interaction mode updatedAt')
  const client = normalizedClientId(input.clientId)
  return [appendInput({
    event: draftEvent({
      channel: mapChannel(slug),
      type: MAP_INTERACTION_MODE_REALTIME_EVENT_TYPE,
      clientId: client,
      data: { slug, interactionMode: input.interactionMode, updatedAt },
    }),
    access: mapAccess(slug),
    dedupeKey: libraryDedupeKey({
      family: 'interaction-mode',
      operation: 'set',
      resource: slug,
      revision: updatedAt,
      destination: mapChannel(slug),
      extra: { interactionMode: input.interactionMode, updatedAt },
    }),
  })]
}

export const resolveLibraryMutationDatabase = (input: {
  readonly database?: RotomDatabase
  readonly dependencies: readonly {
    readonly label: string
    readonly dependency?: DatabaseBackedLibraryMutationDependency
  }[]
}): RotomDatabase => {
  const database = input.database
    ?? input.dependencies.map((entry) => entry.dependency?.database).find((candidate): candidate is RotomDatabase => Boolean(candidate))
    ?? getRotomDatabase()

  for (const entry of input.dependencies) {
    const dependencyDatabase = entry.dependency?.database
    if (dependencyDatabase && dependencyDatabase !== database) {
      throw new Error(`${entry.label} must use the same RotomDatabase as the durable library mutation transaction`)
    }
  }

  return database
}

export const defaultPersistedLibraryRealtimeEventPublisher: PersistedLibraryRealtimeEventPublisher = (record) => {
  publishSequencedRealtime(record.event)
}

export const defaultLibraryRealtimePublicationFailureReporter: LibraryRealtimePublicationFailureReporter = (context) => {
  console.error('[realtime] library persisted event publication failed', {
    sequence: context.sequence,
    channel: context.channel,
    type: context.type,
    error: context.error,
  })
}

export const publishPersistedLibraryRealtimeEventsAfterCommit = (input: {
  readonly events: readonly PersistedRealtimeEvent[]
  readonly publish: PersistedLibraryRealtimeEventPublisher
  readonly reportFailure: LibraryRealtimePublicationFailureReporter
}): void => {
  const events = [...input.events].sort((left, right) => left.sequence - right.sequence)
  for (const event of events) {
    try {
      input.publish(event)
    } catch (error) {
      input.reportFailure({
        event,
        sequence: event.sequence,
        channel: event.event.channel,
        type: event.event.type,
        error,
      })
    }
  }
}
