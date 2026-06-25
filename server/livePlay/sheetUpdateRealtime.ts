import { createHash } from 'node:crypto'
import { parseLivePlayMapSlug, parseLivePlayOpId, type LivePlayCommandEnvelope } from '#shared/livePlayCommands'
import { stringifyCanonicalRealtimeJson } from '#shared/realtimeEventLog'
import type { AppendRealtimeEventInput } from '../storage/realtimeEventRepository'
import {
  deduplicateAuthoritativeSheetDocumentUpdates,
  normalizeRealtimeEventClientIdForEventLog,
  sheetDocumentUpdatedRealtimeAppendInput,
  type AuthoritativeSheetDocumentUpdate,
} from '../realtime/sheetDocumentRealtime'

export type AuthoritativeLivePlaySheetUpdate = AuthoritativeSheetDocumentUpdate

export interface LivePlaySheetUpdateRealtimeAppendInputsOptions {
  readonly command: LivePlayCommandEnvelope & { readonly clientId?: unknown }
  readonly updates: readonly AuthoritativeLivePlaySheetUpdate[]
  readonly clientId?: unknown
}

export type LivePlaySheetUpdateRealtimeDestination = 'specific' | 'global'

const dedupeHash = (input: {
  readonly mapSlug: string
  readonly opId: string
  readonly kind: AuthoritativeLivePlaySheetUpdate['kind']
  readonly slug: string
  readonly destination: LivePlaySheetUpdateRealtimeDestination
}): string => createHash('sha256')
  .update(stringifyCanonicalRealtimeJson(input, 'live-play sheet realtime dedupe identity'))
  .digest('hex')

export const livePlaySheetUpdateRealtimeDedupeKey = (input: {
  readonly mapSlug: string
  readonly opId: string
  readonly kind: AuthoritativeLivePlaySheetUpdate['kind']
  readonly slug: string
  readonly destination: LivePlaySheetUpdateRealtimeDestination
}): string => `live-play-sheet:${dedupeHash(input)}:${input.destination}`

export const livePlaySheetUpdateRealtimeAppendInputs = ({
  command,
  updates,
  clientId,
}: LivePlaySheetUpdateRealtimeAppendInputsOptions): readonly AppendRealtimeEventInput[] => {
  parseLivePlayMapSlug(command.mapSlug, 'command.mapSlug')
  parseLivePlayOpId(command.opId, 'command.opId')
  const normalizedClientId = normalizeRealtimeEventClientIdForEventLog(clientId ?? command.clientId)
  return deduplicateAuthoritativeSheetDocumentUpdates(updates, {
    divergentMessagePrefix: 'Divergent authoritative live-play sheet documents',
  }).flatMap((update) => [
    sheetDocumentUpdatedRealtimeAppendInput({
      update,
      destination: 'specific',
      clientId: normalizedClientId,
      dedupeKey: livePlaySheetUpdateRealtimeDedupeKey({
        mapSlug: command.mapSlug,
        opId: command.opId,
        kind: update.kind,
        slug: update.slug,
        destination: 'specific',
      }),
    }),
    sheetDocumentUpdatedRealtimeAppendInput({
      update,
      destination: 'global',
      clientId: normalizedClientId,
      dedupeKey: livePlaySheetUpdateRealtimeDedupeKey({
        mapSlug: command.mapSlug,
        opId: command.opId,
        kind: update.kind,
        slug: update.slug,
        destination: 'global',
      }),
    }),
  ])
}
