import type { EncounterDocument } from '#shared/encounterDocuments/model'
import {
  ENCOUNTER_DOCUMENT_REALTIME_EVENT_TYPES,
  encounterChannel,
  encountersChannel,
} from '#shared/realtime'
import { createRealtimeEventMaterial } from '#shared/realtimeEventLog'
import type { AppendRealtimeEventInput } from '../storage/realtimeEventRepository'

export type EncounterDocumentRealtimeKind = 'created' | 'updated'

export const encounterDocumentRealtimeAppendInputs = (input: {
  readonly document: EncounterDocument
  readonly kind: EncounterDocumentRealtimeKind
  readonly previousRevision: number | null
  readonly operationId: string | null
  readonly timestamp: number
}): readonly AppendRealtimeEventInput[] => {
  const { document } = input
  if (input.kind === 'created' && (document.revision !== 0 || input.previousRevision !== null)) {
    throw new Error('Created encounter realtime events require initial revision 0.')
  }
  if (input.kind === 'updated' && (input.previousRevision === null || document.revision !== input.previousRevision + 1)) {
    throw new Error('Updated encounter realtime events require an exact revision step.')
  }
  const type = input.kind === 'created'
    ? ENCOUNTER_DOCUMENT_REALTIME_EVENT_TYPES.CREATED
    : ENCOUNTER_DOCUMENT_REALTIME_EVENT_TYPES.UPDATED
  const data = {
    encounterId: document.encounterId,
    mapSlug: document.linkedMapSlug,
    operationId: input.operationId,
  }
  const access = { kind: 'map-access' as const, mapSlug: document.linkedMapSlug }
  return [encounterChannel(document.encounterId), encountersChannel].map((channel) => {
    const dedupeKey = `encounter-document:${document.encounterId}:${document.revision}:${channel === encountersChannel ? 'library' : 'specific'}`
    const material = createRealtimeEventMaterial({
      access,
      dedupeKey,
      event: {
        channel,
        type,
        revision: document.revision,
        ...(input.previousRevision === null ? {} : { previousRevision: input.previousRevision }),
        data,
      },
    })
    return {
      event: material.event,
      access: material.access,
      dedupeKey: material.dedupeKey,
      timestamp: input.timestamp,
    }
  })
}
