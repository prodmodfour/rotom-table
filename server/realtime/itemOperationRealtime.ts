import { createHash } from 'node:crypto'
import { mapChannel, mapsChannel } from '#shared/realtime'
import { ITEM_OPERATION_REALTIME_EVENT_TYPES } from '#shared/itemAutomation/realtime'
import {
  createRealtimeEventMaterial,
  stringifyCanonicalRealtimeJson,
} from '#shared/realtimeEventLog'
import type { TabletopMap } from '~/types/map'
import { summarizeMap } from '../utils/mapSummaries'
import { mapRevisionForRealtime } from '../utils/mapRealtimeEvents'
import type { AppendRealtimeEventInput } from '../storage/realtimeEventRepository'
import type { PersistedSheet } from '../storage/sheetRepository'
import {
  normalizeAuthoritativeSheetDocumentUpdate,
  normalizeRealtimeEventClientIdForEventLog,
  sheetDocumentUpdatedRealtimeAppendInput,
} from './sheetDocumentRealtime'

const hash = (value: unknown): string => createHash('sha256')
  .update(stringifyCanonicalRealtimeJson(value, 'item operation realtime identity'))
  .digest('hex')

const dedupeKey = (input: {
  readonly operationId: string
  readonly kind: 'map' | 'sheet' | 'presentation'
  readonly resource: string
  readonly revision: number
  readonly destination: string
}): string => `item-operation:${hash(input)}:${input.destination}`

export const itemOperationSheetUpdatedRealtimeAppendInputs = (input: {
  readonly operationId: string
  readonly sheet: PersistedSheet
  readonly clientId?: unknown
}): readonly AppendRealtimeEventInput[] => {
  const update = normalizeAuthoritativeSheetDocumentUpdate({
    kind: input.sheet.kind,
    slug: input.sheet.slug,
    sheet: input.sheet.sheet,
  })
  const clientId = normalizeRealtimeEventClientIdForEventLog(input.clientId)
  return (['specific', 'global'] as const).map(destination => sheetDocumentUpdatedRealtimeAppendInput({
    update,
    destination,
    clientId,
    dedupeKey: dedupeKey({
      operationId: input.operationId,
      kind: 'sheet',
      resource: `${input.sheet.kind}:${input.sheet.slug}`,
      revision: input.sheet.revision,
      destination,
    }),
  }))
}

export const itemOperationPresentationInvalidatedRealtimeAppendInput = (input: {
  readonly operationId: string
  readonly mapSlug: string
  readonly mapRevision: number
  readonly clientId?: unknown
}): AppendRealtimeEventInput => {
  const clientId = normalizeRealtimeEventClientIdForEventLog(input.clientId)
  const material = createRealtimeEventMaterial({
    event: {
      channel: mapChannel(input.mapSlug),
      type: ITEM_OPERATION_REALTIME_EVENT_TYPES.PRESENTATION_INVALIDATED,
      revision: input.mapRevision,
      ...(clientId === undefined ? {} : { clientId }),
      // Deliberately contains no item, inventory-row, actor, target, choice, or operation identity.
      data: { mapSlug: input.mapSlug },
    },
    access: { kind: 'map-access', mapSlug: input.mapSlug },
    dedupeKey: dedupeKey({
      operationId: input.operationId,
      kind: 'presentation',
      resource: input.mapSlug,
      revision: input.mapRevision,
      destination: 'specific',
    }),
  })
  return { event: material.event, access: material.access, dedupeKey: material.dedupeKey }
}

export const itemOperationMapUpdatedRealtimeAppendInputs = (input: {
  readonly operationId: string
  readonly map: TabletopMap
  readonly clientId?: unknown
}): readonly AppendRealtimeEventInput[] => {
  const revision = mapRevisionForRealtime(input.map)
  const clientId = normalizeRealtimeEventClientIdForEventLog(input.clientId)
  const access = { kind: 'map-access' as const, mapSlug: input.map.slug }
  return [
    { destination: 'specific', channel: mapChannel(input.map.slug), data: input.map },
    { destination: 'global', channel: mapsChannel, data: summarizeMap(input.map) },
  ].map((entry): AppendRealtimeEventInput => {
    const material = createRealtimeEventMaterial({
      event: {
        channel: entry.channel,
        type: 'updated',
        revision,
        ...(clientId === undefined ? {} : { clientId }),
        data: entry.data,
      },
      access,
      dedupeKey: dedupeKey({
        operationId: input.operationId,
        kind: 'map',
        resource: input.map.slug,
        revision,
        destination: entry.destination,
      }),
    })
    return { event: material.event, access: material.access, dedupeKey: material.dedupeKey }
  })
}
