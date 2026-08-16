import { createHash } from 'node:crypto'
import {
  ENCOUNTER_SETTLEMENT_REALTIME_EVENT_TYPES,
  encounterSettlementChannel,
} from '#shared/realtime'
import { createRealtimeEventMaterial } from '#shared/realtimeEventLog'
import type { EncounterSettlementDocument } from '#shared/encounterSettlement/document'
import {
  encounterSettlementDestinationProjectionKey,
  type EncounterSettlementProjectionContext,
} from '#shared/encounterSettlement/projection'
import type { AppendRealtimeEventInput } from '../storage/realtimeEventRepository'
import {
  gmEncounterSettlementProjectionContext,
  projectEncounterSettlement,
  projectEncounterSettlementHistory,
  publicEncounterSettlementProjectionContext,
  type EncounterSettlementHistoryProjectionSource,
} from '../domain/encounterSettlement/projection'

export type EncounterSettlementRealtimeKind = 'updated' | 'corrected'

const historySubjectsForSheet = (kind: 'trainer' | 'pokemon', slug: string): ReadonlySet<string> => new Set([
  slug,
  `${kind}:${slug}`,
  `${kind === 'trainer' ? 'trainer-inventory' : 'pokemon-sheet'}:${slug}`,
])

const ownerContextForParticipant = (
  settlement: EncounterSettlementDocument,
  participantId: string,
): EncounterSettlementProjectionContext => {
  const participant = settlement.participants.find(row => row.participantId === participantId)
  if (!participant) throw new Error('Settlement realtime participant authority is unavailable.')
  return {
    audience: 'owner',
    ownedParticipantIds: new Set([participantId]),
    ownedDestinationKeys: new Set([
      encounterSettlementDestinationProjectionKey('participant', participantId),
      encounterSettlementDestinationProjectionKey(
        participant.sheetKind === 'trainer' ? 'trainer-inventory' : 'pokemon-sheet',
        participant.sheetSlug,
      ),
    ]),
    ownedHistorySubjectIds: historySubjectsForSheet(participant.sheetKind, participant.sheetSlug),
  }
}

const ownerContextForGroup = (slug: string): EncounterSettlementProjectionContext => ({
  audience: 'owner',
  ownedParticipantIds: new Set(),
  ownedDestinationKeys: new Set([
    encounterSettlementDestinationProjectionKey('group', slug),
    encounterSettlementDestinationProjectionKey('group-inventory', slug),
  ]),
  ownedHistorySubjectIds: new Set([slug, `group:${slug}`, `group-inventory:${slug}`]),
})

const appendInput = (input: {
  readonly settlement: EncounterSettlementDocument
  readonly history: readonly EncounterSettlementHistoryProjectionSource[]
  readonly context: EncounterSettlementProjectionContext
  readonly access: AppendRealtimeEventInput['access']
  readonly audienceKey: string
  readonly kind: EncounterSettlementRealtimeKind
  readonly timestamp: number
}): AppendRealtimeEventInput => {
  const eventType = input.kind === 'corrected'
    ? ENCOUNTER_SETTLEMENT_REALTIME_EVENT_TYPES.CORRECTED
    : ENCOUNTER_SETTLEMENT_REALTIME_EVENT_TYPES.UPDATED
  const dedupeKey = `encounter-settlement:${createHash('sha256').update([
    input.settlement.encounter.encounterId,
    String(input.settlement.revision),
    input.kind,
    input.audienceKey,
  ].join('\u0000')).digest('hex')}`
  const material = createRealtimeEventMaterial({
    access: input.access,
    dedupeKey,
    event: {
      channel: encounterSettlementChannel(input.settlement.encounter.encounterId),
      type: eventType,
      revision: input.settlement.revision,
      previousRevision: input.settlement.revision - 1,
      data: {
        settlement: projectEncounterSettlement({
          settlement: input.settlement,
          context: input.context,
        }),
        history: projectEncounterSettlementHistory({
          facts: input.history,
          context: input.context,
          limit: 50,
        }),
      },
    },
  })
  return {
    event: material.event,
    access: material.access,
    dedupeKey: material.dedupeKey,
    timestamp: input.timestamp,
  }
}

export const encounterSettlementRealtimeAppendInputs = (input: {
  readonly settlement: EncounterSettlementDocument
  readonly history: readonly EncounterSettlementHistoryProjectionSource[]
  readonly kind: EncounterSettlementRealtimeKind
  readonly timestamp: number
}): readonly AppendRealtimeEventInput[] => {
  if (input.settlement.revision < 1) throw new Error('Settlement realtime requires an accepted revision step.')
  const mapSlug = input.settlement.encounter.linkedMapSlug
  const rows: AppendRealtimeEventInput[] = [
    appendInput({
      ...input,
      context: publicEncounterSettlementProjectionContext(),
      access: { kind: 'map-access', mapSlug },
      audienceKey: 'public',
    }),
    appendInput({
      ...input,
      context: gmEncounterSettlementProjectionContext(),
      access: { kind: 'gm-only' },
      audienceKey: 'gm',
    }),
  ]
  const participantKeys = new Set<string>()
  for (const participant of input.settlement.participants) {
    const accessKey = `${participant.sheetKind}:${participant.sheetSlug}`
    if (participantKeys.has(accessKey)) continue
    participantKeys.add(accessKey)
    const ownedIds = input.settlement.participants
      .filter(row => row.sheetKind === participant.sheetKind && row.sheetSlug === participant.sheetSlug)
      .map(row => row.participantId)
    const contexts = ownedIds.map(id => ownerContextForParticipant(input.settlement, id))
    const context: EncounterSettlementProjectionContext = {
      audience: 'owner',
      ownedParticipantIds: new Set(contexts.flatMap(row => [...row.ownedParticipantIds])),
      ownedDestinationKeys: new Set(contexts.flatMap(row => [...row.ownedDestinationKeys])),
      ownedHistorySubjectIds: new Set(contexts.flatMap(row => [...row.ownedHistorySubjectIds])),
    }
    rows.push(appendInput({
      ...input,
      context,
      access: {
        kind: 'sheet-access',
        sheetKind: participant.sheetKind,
        sheetSlug: participant.sheetSlug,
      },
      audienceKey: `sheet-${participant.sheetKind}-${participant.sheetSlug}`,
    }))
  }
  const groups = new Set(input.settlement.allocations.flatMap((allocation) => (
    allocation.destination.kind === 'group' || allocation.destination.kind === 'group-inventory'
      ? [allocation.destination.id]
      : []
  )))
  for (const groupSlug of [...groups].sort()) {
    rows.push(appendInput({
      ...input,
      context: ownerContextForGroup(groupSlug),
      access: { kind: 'group-inventory-access', groupSlug },
      audienceKey: `group-${groupSlug}`,
    }))
  }
  return Object.freeze(rows)
}
