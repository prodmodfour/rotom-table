import {
  LIVE_PLAY_COMMAND_TYPES,
  type LivePlayPatch,
} from '#shared/livePlayCommands'
import { LIVE_PLAY_REALTIME_EVENT_TYPES } from '#shared/realtime'
import { isSheetKind } from '#shared/sheets'
import { redactResolveMovePatchesForObserver } from '../utils/moveResultPrivacy'
import { redactSheetRecordForPlayer } from '../utils/sheetPrivacy'
import { redactShopRecordForPlayer, redactUnknownShopRecordForPlayer } from '../utils/shopPrivacy'
import type {
  RealtimeDeliveryPrincipal,
  RealtimeEventAccessDependencies,
} from './realtimeEventAccessPolicy'
import { projectAbilityAutomationMapForPlayer } from '../domain/abilityAutomation/clientStateProjection'
import { projectCapabilityAutomationMapForPlayer } from '../domain/capabilityAutomation/clientStateProjection'
import { projectCapabilityAutomationJsonForPlayer } from '../domain/capabilityAutomation/realtimeProjection'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { reconcileCapabilityRuntimeSourceLoss } from '../domain/capabilityAutomation/sourceLoss'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const redactedSheetRealtimeEvent = (
  event: Record<string, unknown>,
  data: Record<string, unknown>,
): unknown => {
  if (!isSheetKind(data.kind) || !isRecord(data.sheet)) return null
  return {
    ...event,
    data: {
      ...data,
      sheet: redactSheetRecordForPlayer(data.kind, data.sheet),
    },
  }
}

const redactedShopRealtimeEvent = (
  event: Record<string, unknown>,
  data: Record<string, unknown>,
): unknown => {
  if (typeof data.slug !== 'string' || !isRecord(data.document)) return null
  if (data.document.slug !== data.slug || !Array.isArray(data.document.entries)) return null

  return {
    ...event,
    data: {
      ...data,
      document: redactShopRecordForPlayer(data.document),
    },
  }
}

const redactedMapRealtimeEvent = (
  event: Record<string, unknown>,
  data: Record<string, unknown>,
  dependencies?: RealtimeEventAccessDependencies,
): unknown => {
  if (typeof data.slug !== 'string' || !isRecord(data.document)
    || data.document.slug !== data.slug || !Array.isArray(data.document.placements)
    || !Array.isArray(data.document.voxels)) return null
  const rawMap = data.document as unknown as TabletopMap
  const pokemon = new Map<string, CharacterSheet>()
  const trainer = new Map<string, TrainerSheet>()
  const hasCompleteSheetContext = Boolean(dependencies) && rawMap.placements.every((placement) => {
    const persisted = dependencies?.getSheet(placement.sheetKind, placement.sheetSlug)
    if (!persisted || !isRecord(persisted.sheet)) return false
    const sheet = {
      ...persisted.sheet,
      slug: persisted.slug,
      ...(typeof persisted.revision === 'number' ? { revision: persisted.revision } : {}),
    }
    if (placement.sheetKind === 'pokemon') pokemon.set(placement.sheetSlug, sheet as CharacterSheet)
    else trainer.set(placement.sheetSlug, sheet as TrainerSheet)
    return true
  })
  // A coupled participant can be intentionally absent from the public map.
  // Without every placement sheet we cannot prove that a source-owned link is
  // still effective, so suppress this realtime document instead of either
  // exposing a carried participant or trusting stale raw runtime authority.
  if (!hasCompleteSheetContext) return null
  const sheets = { pokemon, trainer }
  const reconciledMap = reconcileCapabilityRuntimeSourceLoss({ map: rawMap, sheets })
  const document = projectCapabilityAutomationMapForPlayer(
    projectAbilityAutomationMapForPlayer(reconciledMap),
    sheets,
  )
  return { ...event, data: { ...data, document } }
}

const redactedShopCheckoutResultRealtimeEvent = (
  event: Record<string, unknown>,
  data: Record<string, unknown>,
): unknown => {
  if (data.commandType !== LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT || !isRecord(data.result)) return null

  const result = { ...data.result }
  if (result.ok === true && isRecord(result.documents)) {
    const documents = { ...result.documents }
    if (isRecord(documents.shop)) documents.shop = redactShopRecordForPlayer(documents.shop)
    delete documents.groupInventories
    delete documents.trainerSheets
    result.documents = documents
  } else if (result.ok === false && isRecord(result.currentState)) {
    result.currentState = redactUnknownShopRecordForPlayer(result.currentState)
  }

  return {
    ...event,
    data: {
      ...data,
      result,
    },
  }
}

const redactedResolveMoveRealtimeEvent = (
  event: Record<string, unknown>,
): Record<string, unknown> => {
  if (
    event.type !== LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED
    || !Array.isArray(event.patches)
  ) {
    return event
  }

  return {
    ...event,
    patches: redactResolveMovePatchesForObserver(event.patches as LivePlayPatch[]),
  }
}

export const redactRealtimeEventForPrincipal = (
  event: unknown,
  principal: RealtimeDeliveryPrincipal,
  dependencies?: RealtimeEventAccessDependencies,
): unknown => {
  if (principal.role !== 'player' || !isRecord(event)) return event

  const observerSafeEvent = redactedResolveMoveRealtimeEvent(event)
  const data = observerSafeEvent.data
  if (!isRecord(data)) return projectCapabilityAutomationJsonForPlayer(observerSafeEvent)

  const document = isRecord(data.document) ? data.document : null
  const isWrappedMapDocument = document !== null
    && (Object.hasOwn(document, 'placements') || Object.hasOwn(document, 'voxels'))
  if (isWrappedMapDocument) {
    const projected = redactedMapRealtimeEvent(observerSafeEvent, data, dependencies)
    return projected === null ? null : projectCapabilityAutomationJsonForPlayer(projected)
  }

  // Durable map update events carry the map directly in `data`; library
  // mutation events may wrap it as `data.document`. Normalize only for the
  // projection call, then restore the original event shape for clients.
  const isDirectMapDocument = typeof data.slug === 'string'
    && Array.isArray(data.placements)
    && Array.isArray(data.voxels)
  if (isDirectMapDocument) {
    const projected = redactedMapRealtimeEvent(observerSafeEvent, {
      slug: data.slug,
      document: data,
    }, dependencies)
    if (!isRecord(projected) || !isRecord(projected.data) || !isRecord(projected.data.document)) return null
    return projectCapabilityAutomationJsonForPlayer({ ...projected, data: projected.data.document })
  }

  const redacted = redactedSheetRealtimeEvent(observerSafeEvent, data)
    ?? redactedShopRealtimeEvent(observerSafeEvent, data)
    ?? redactedShopCheckoutResultRealtimeEvent(observerSafeEvent, data)
    ?? observerSafeEvent
  return projectCapabilityAutomationJsonForPlayer(redacted)
}
