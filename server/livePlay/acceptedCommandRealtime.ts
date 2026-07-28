/**
 * Durable realtime journaling for accepted live-play map command events.
 *
 * Accepted map command events are appended to the SQLite realtime event log in
 * the same transaction as the authoritative map/sheet and operation-result
 * writes. Full sheet update events produced by accepted live-play commands are
 * also journaled transactionally by the sheet-update realtime helper; reconnect
 * still relies on aggregate snapshot reconciliation until SSE replay migrates.
 */

import type { LivePlayCommandAccepted, LivePlayCommandEnvelope } from '#shared/livePlayCommands'
import { acceptedEncounterPresentationFromLivePlayCommand } from '../domain/encounterPresentation/acceptedAdapters'
import { normalizeRealtimeClientId } from '#shared/realtime'
import {
  MAX_REALTIME_EVENT_CLIENT_ID_LENGTH,
  createRealtimeEventMaterial,
} from '#shared/realtimeEventLog'
import type { AppendRealtimeEventInput } from '../storage/realtimeEventRepository'
import { livePlayCommandAcceptedRealtimeEvent } from '../utils/mapRealtimeEvents'

export interface AcceptedCommandRealtimeDedupeKeyInput {
  readonly mapSlug: string
  readonly opId: string
}

export interface AcceptedCommandRealtimeAppendInputOptions {
  readonly command: LivePlayCommandEnvelope & { readonly clientId?: unknown }
  readonly result: LivePlayCommandAccepted
  readonly clientId?: unknown
}

const normalizeAcceptedCommandClientId = (value: unknown): string | undefined => {
  const clientId = normalizeRealtimeClientId(value)
  if (clientId === undefined) return undefined
  if (clientId.trim().length === 0) return undefined
  if (clientId.length > MAX_REALTIME_EVENT_CLIENT_ID_LENGTH) return undefined
  return clientId
}

export const acceptedCommandRealtimeDedupeKey = ({
  mapSlug,
  opId,
}: AcceptedCommandRealtimeDedupeKeyInput): string => `live-play-command:${mapSlug}:${opId}:accepted`

export const acceptedCommandRealtimeAppendInput = ({
  command,
  result,
  clientId,
}: AcceptedCommandRealtimeAppendInputOptions): AppendRealtimeEventInput => {
  const normalizedClientId = normalizeAcceptedCommandClientId(clientId ?? command.clientId)
  const presentation = result.presentation ?? acceptedEncounterPresentationFromLivePlayCommand({
    command,
    result,
    occurredAt: result.revision,
  })
  const event = livePlayCommandAcceptedRealtimeEvent(
    { ...result, presentation },
    normalizedClientId,
  )
  const access = {
    kind: 'map-access' as const,
    mapSlug: result.mapSlug,
  }
  const dedupeKey = acceptedCommandRealtimeDedupeKey({
    mapSlug: result.mapSlug,
    opId: result.opId,
  })

  const material = createRealtimeEventMaterial({ event, access, dedupeKey })
  return {
    event: material.event,
    access: material.access,
    ...(material.dedupeKey === undefined ? {} : { dedupeKey: material.dedupeKey }),
  }
}
