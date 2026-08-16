import { isSlug } from '#shared/paths'
import { sheetChannel } from '#shared/realtime'
import { createRealtimeEventMaterial, type RealtimeEventDraft } from '#shared/realtimeEventLog'
import {
  ITEM_EXPLORATION_CLOCK_REALTIME_EVENT_TYPE,
  parseItemExplorationState,
} from '#shared/itemAutomation/exploration'
import type { AppendRealtimeEventInput } from '../storage/realtimeEventRepository'

export const itemExplorationClockRealtimeAppendInput = (input: {
  readonly trainerSlug: string
  readonly state: unknown
  readonly campaignClockRevision: number
  readonly campaignMinute: number
  readonly timestamp: number
  readonly clientId?: string
}): AppendRealtimeEventInput | null => {
  if (!isSlug(input.trainerSlug)) throw new Error('Exploration clock realtime Trainer slug is invalid.')
  if (!Number.isSafeInteger(input.campaignClockRevision) || input.campaignClockRevision < 0
    || !Number.isSafeInteger(input.campaignMinute) || input.campaignMinute < 0
    || !Number.isSafeInteger(input.timestamp) || input.timestamp < 0) {
    throw new Error('Exploration clock realtime authority is invalid.')
  }
  const state = parseItemExplorationState(input.state)
  if (state.routeLures.length === 0 && state.repels.length === 0 && state.dowsingUses.length === 0) return null
  const event: RealtimeEventDraft = {
    channel: sheetChannel('trainer', input.trainerSlug),
    type: ITEM_EXPLORATION_CLOCK_REALTIME_EVENT_TYPE,
    data: {
      schemaVersion: 1,
      trainerSlug: input.trainerSlug,
      campaignClockRevision: input.campaignClockRevision,
      campaignMinute: input.campaignMinute,
    },
    ...(input.clientId ? { clientId: input.clientId } : {}),
  }
  const material = createRealtimeEventMaterial({
    event,
    access: { kind: 'sheet-access', sheetKind: 'trainer', sheetSlug: input.trainerSlug },
    dedupeKey: `item-exploration-clock:v1:${input.trainerSlug}:${input.campaignClockRevision}`,
  })
  return {
    event: material.event,
    access: material.access,
    dedupeKey: material.dedupeKey,
    timestamp: input.timestamp,
  }
}
