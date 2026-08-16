import { createHash } from 'node:crypto'
import { sheetChannel } from '#shared/realtime'
import { ITEM_OPERATION_REALTIME_EVENT_TYPES } from '#shared/itemAutomation/realtime'
import { createRealtimeEventMaterial, stringifyCanonicalRealtimeJson } from '#shared/realtimeEventLog'
import type { StoredItemExtendedActionRecord } from '../storage/itemExtendedActionRepository'
import type { AppendRealtimeEventInput } from '../storage/realtimeEventRepository'
import { normalizeRealtimeEventClientIdForEventLog } from './sheetDocumentRealtime'

const hash = (value: unknown): string => createHash('sha256')
  .update(stringifyCanonicalRealtimeJson(value, 'item Extended Action realtime identity'))
  .digest('hex')

export const itemExtendedActionUpdatedRealtimeAppendInput = (input: {
  readonly operationId: string
  readonly record: StoredItemExtendedActionRecord
  readonly clientId?: unknown
}): AppendRealtimeEventInput => {
  const trainerSlug = input.record.initialItemCommand.actorSheet.slug
  const clientId = normalizeRealtimeEventClientIdForEventLog(input.clientId)
  const data = {
    schemaVersion: 1,
    activityId: input.record.activityId,
    status: input.record.status,
    revision: input.record.revision,
  }
  const material = createRealtimeEventMaterial({
    event: {
      channel: sheetChannel('trainer', trainerSlug),
      type: ITEM_OPERATION_REALTIME_EVENT_TYPES.EXTENDED_ACTION_UPDATED,
      revision: input.record.revision,
      ...(clientId === undefined ? {} : { clientId }),
      data,
    },
    access: { kind: 'sheet-access', sheetKind: 'trainer', sheetSlug: trainerSlug },
    dedupeKey: `item-extended-action:${hash({
      operationId: input.operationId,
      activityId: input.record.activityId,
      revision: input.record.revision,
      status: input.record.status,
      trainerSlug,
    })}`,
  })
  return { event: material.event, access: material.access, dedupeKey: material.dedupeKey }
}
