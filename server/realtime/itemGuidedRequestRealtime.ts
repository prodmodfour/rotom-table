import { createHash } from 'node:crypto'
import { ITEM_OPERATION_REALTIME_EVENT_TYPES } from '#shared/itemAutomation/realtime'
import { createRealtimeEventMaterial, stringifyCanonicalRealtimeJson } from '#shared/realtimeEventLog'
import type { AppendRealtimeEventInput } from '../storage/realtimeEventRepository'
import type { StoredItemGuidedRequestRecord } from '../storage/itemGuidedRequestRepository'
import { normalizeRealtimeEventClientIdForEventLog } from './sheetDocumentRealtime'

export const ITEM_GUIDED_GM_CHANNEL = 'item-guided:gm' as const

const hash = (value: unknown): string => createHash('sha256')
  .update(stringifyCanonicalRealtimeJson(value, 'guided item realtime identity'))
  .digest('hex')

const dataFor = (record: StoredItemGuidedRequestRecord) => ({
  schemaVersion: 1,
  requestId: record.requestId,
  revision: record.revision,
  status: record.status,
})

export const itemGuidedRequestRealtimeAppendInputs = (input: {
  readonly operationId: string
  readonly record: StoredItemGuidedRequestRecord
  readonly clientId?: unknown
}): readonly AppendRealtimeEventInput[] => {
  const clientId = normalizeRealtimeEventClientIdForEventLog(input.clientId)
  const data = dataFor(input.record)
  const common = {
    type: ITEM_OPERATION_REALTIME_EVENT_TYPES.GUIDED_REQUEST_UPDATED,
    revision: input.record.revision,
    ...(clientId === undefined ? {} : { clientId }),
    data,
  }
  const gm = createRealtimeEventMaterial({
    event: { ...common, channel: ITEM_GUIDED_GM_CHANNEL },
    access: { kind: 'gm-only' },
    dedupeKey: `item-guided-gm:${hash({
      operationId: input.operationId,
      requestId: input.record.requestId,
      revision: input.record.revision,
      status: input.record.status,
    })}`,
  })
  const ownerChannel = `item-guided:${input.record.actorKind}:${input.record.actorSlug}`
  const owner = createRealtimeEventMaterial({
    event: { ...common, channel: ownerChannel },
    access: {
      kind: 'sheet-access',
      sheetKind: input.record.actorKind,
      sheetSlug: input.record.actorSlug,
    },
    dedupeKey: `item-guided-owner:${hash({
      operationId: input.operationId,
      requestId: input.record.requestId,
      revision: input.record.revision,
      status: input.record.status,
      ownerChannel,
    })}`,
  })
  return Object.freeze([
    { event: gm.event, access: gm.access, dedupeKey: gm.dedupeKey },
    { event: owner.event, access: owner.access, dedupeKey: owner.dedupeKey },
  ])
}
