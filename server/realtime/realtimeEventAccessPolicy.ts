import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import { parseBreedingRealtimeRefreshEventV1 } from '#shared/breeding/realtime'
import { ENCOUNTER_SETTLEMENT_REALTIME_EVENT_TYPES } from '#shared/realtime'
import type { RealtimeEventAccess, PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import type { SheetKind } from '#shared/sheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { ShopTableDocument } from '~/types/shop'
import type { PendingMoveResolution } from '#shared/moveAutomation/pendingResolution'
import { canAccessGroupInventoryForRole } from '../policies/groupInventoryAccessPolicy'
import { canAccessMapForRole } from '../policies/mapPolicy'
import { pendingMoveResponseAuthorizationGrant } from '../policies/pendingMoveResponsePolicy'
import { playerProfileCanAccessSheet } from '../policies/playerProfilePolicy'
import { projectAbilityAutomationRealtimeEventForPlayer } from '../domain/abilityAutomation/realtimeProjection'
import { projectCapabilityAutomationRealtimeEventForPlayer } from '../domain/capabilityAutomation/realtimeProjection'
import { authorizeSheetList, playerSheetAccessContextFromKeys } from '../useCases/authorizeSheetList'

export type RealtimePlayerSheetAccessKey = `${SheetKind}:${string}`

export interface RealtimeSessionAccessGrant {
  readonly sheetKeys: ReadonlySet<RealtimePlayerSheetAccessKey>
}

export interface RealtimePolicyPersistedSheet {
  readonly kind: SheetKind
  readonly slug: string
  readonly sheet: Record<string, unknown>
  readonly revision?: number
  readonly updatedAt?: number
}

export interface RealtimeDeliveryPrincipal {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly sessionAccess?: RealtimeSessionAccessGrant | null
  /** Set only by authenticated operator policy; ordinary GM sessions omit it. */
  readonly breedingDiagnosticAccess?: true
}

export interface RealtimeEventAccessDependencies {
  readonly getMap: (slug: string) => TabletopMap | null
  readonly getSheet: (
    kind: SheetKind,
    slug: string,
  ) => RealtimePolicyPersistedSheet | null
  readonly getGroupInventory?: (slug: string) => Pick<GroupInventoryDocument, 'slug'> | null
  readonly getShop?: (slug: string) => Pick<ShopTableDocument, 'slug' | 'playerVisible' | 'open'> | null
  readonly getPendingMoveResolution?: (resolutionId: string) => PendingMoveResolution | null
  readonly listTrainerSheets: () => readonly TrainerSheet[]
  readonly playerVisibleMapSheetAccessKeys: () => ReadonlySet<RealtimePlayerSheetAccessKey>
}

export type RealtimeEventAccessDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false
      readonly reason:
        | 'gm-only'
        | 'map-not-found'
        | 'map-not-accessible'
        | 'sheet-not-found'
        | 'sheet-not-accessible'
        | 'group-inventory-not-found'
        | 'settlement-audience-not-accessible'
        | 'shop-not-found'
        | 'shop-not-accessible'
        | 'pending-move-response-not-accessible'
        | 'player-profile-not-accessible'
        | 'contest-not-accessible'
        | 'breeding-not-accessible'
        | 'invalid-access'
    }

export interface RealtimeEventAccessEvaluationInput {
  readonly access: RealtimeEventAccess
  readonly principal: RealtimeDeliveryPrincipal
  readonly dependencies: RealtimeEventAccessDependencies
  /** Required for breeding-access so descriptor and refresh audience are inseparable. */
  readonly event?: unknown
}

export type RealtimeEventAccessEvaluator = (
  input: Omit<RealtimeEventAccessEvaluationInput, 'dependencies'>,
) => RealtimeEventAccessDecision

export interface RealtimeEventAccessFilterInput {
  readonly events: readonly PersistedRealtimeEvent[]
  readonly principal: RealtimeDeliveryPrincipal
  readonly dependencies: RealtimeEventAccessDependencies
}

export interface DeniedRealtimeEventAccess {
  /** Diagnostic-only record. SSE adapters must not serialize denied event contents to clients. */
  readonly event: PersistedRealtimeEvent
  readonly decision: Exclude<RealtimeEventAccessDecision, { readonly allowed: true }>
}

export interface RealtimeEventAccessFilterResult {
  readonly allowed: readonly PersistedRealtimeEvent[]
  readonly denied: readonly DeniedRealtimeEventAccess[]
}

const allowed = (): RealtimeEventAccessDecision => ({ allowed: true })

const denied = (
  reason: Exclude<RealtimeEventAccessDecision, { readonly allowed: true }>['reason'],
): RealtimeEventAccessDecision => ({ allowed: false, reason })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const persistedSheetDocument = <TSheet extends CharacterSheet | TrainerSheet>(
  persisted: RealtimePolicyPersistedSheet,
): TSheet | null => {
  if (!isRecord(persisted.sheet)) return null

  return {
    ...persisted.sheet,
    slug: persisted.slug,
    ...(typeof persisted.revision === 'number' ? { revision: persisted.revision } : {}),
    folder: typeof persisted.sheet.folder === 'string' ? persisted.sheet.folder : '',
  } as TSheet
}

const playerSheetAccessContext = (input: {
  readonly principal: RealtimeDeliveryPrincipal
  readonly dependencies: RealtimeEventAccessDependencies
}) => playerSheetAccessContextFromKeys({
  sessionAccessKeys: input.principal.sessionAccess?.sheetKeys ?? null,
  mapSheetAccessKeys: input.dependencies.playerVisibleMapSheetAccessKeys(),
})

const playerCanCurrentlyAccessSheet = (
  access: Extract<RealtimeEventAccess, { readonly kind: 'sheet-access' }>,
  persisted: RealtimePolicyPersistedSheet,
  principal: RealtimeDeliveryPrincipal,
  dependencies: RealtimeEventAccessDependencies,
): boolean => {
  const context = playerSheetAccessContext({ principal, dependencies })

  if (access.sheetKind === 'pokemon') {
    const pokemon = persistedSheetDocument<CharacterSheet>(persisted)
    if (pokemon === null) return false

    const authorized = authorizeSheetList({
      role: 'player',
      playerProfile: principal.playerProfile ?? null,
      ...context,
      pokemonSheets: [pokemon],
      trainerSheets: [...dependencies.listTrainerSheets()],
    })
    return authorized.pokemonSheets.some((sheet) => sheet.slug === access.sheetSlug)
  }

  const trainer = persistedSheetDocument<TrainerSheet>(persisted)
  if (trainer === null) return false

  const authorized = authorizeSheetList({
    role: 'player',
    playerProfile: principal.playerProfile ?? null,
    ...context,
    pokemonSheets: [],
    trainerSheets: [trainer],
  })
  return authorized.trainerSheets.some((sheet) => sheet.slug === access.sheetSlug)
}

const evaluateMapAccess = (
  access: Extract<RealtimeEventAccess, { readonly kind: 'map-access' }>,
  principal: RealtimeDeliveryPrincipal,
  dependencies: RealtimeEventAccessDependencies,
): RealtimeEventAccessDecision => {
  const map = dependencies.getMap(access.mapSlug)
  if (map === null) return denied('map-not-found')
  if (map.slug !== access.mapSlug) return denied('invalid-access')
  return canAccessMapForRole(principal.role, map) ? allowed() : denied('map-not-accessible')
}

const evaluateSheetAccess = (
  access: Extract<RealtimeEventAccess, { readonly kind: 'sheet-access' }>,
  principal: RealtimeDeliveryPrincipal,
  dependencies: RealtimeEventAccessDependencies,
): RealtimeEventAccessDecision => {
  const sheet = dependencies.getSheet(access.sheetKind, access.sheetSlug)
  if (sheet === null) return denied('sheet-not-found')
  if (sheet.kind !== access.sheetKind || sheet.slug !== access.sheetSlug) return denied('invalid-access')
  if (principal.role === 'gm') return allowed()
  return playerCanCurrentlyAccessSheet(access, sheet, principal, dependencies)
    ? allowed()
    : denied('sheet-not-accessible')
}

const evaluateGroupInventoryAccess = (
  access: Extract<RealtimeEventAccess, { readonly kind: 'group-inventory-access' }>,
  principal: RealtimeDeliveryPrincipal,
  dependencies: RealtimeEventAccessDependencies,
): RealtimeEventAccessDecision => {
  if (!canAccessGroupInventoryForRole(principal.role, access.groupSlug)) {
    return denied('group-inventory-not-found')
  }
  const getGroupInventory = dependencies.getGroupInventory
  if (!getGroupInventory) return allowed()

  const groupInventory = getGroupInventory(access.groupSlug)
  if (groupInventory === null) return denied('group-inventory-not-found')
  if (groupInventory.slug !== access.groupSlug) return denied('invalid-access')
  return allowed()
}

const evaluateShopAccess = (
  access: Extract<RealtimeEventAccess, { readonly kind: 'shop-access' }>,
  principal: RealtimeDeliveryPrincipal,
  dependencies: RealtimeEventAccessDependencies,
): RealtimeEventAccessDecision => {
  const shop = dependencies.getShop?.(access.shopSlug) ?? null
  if (shop === null) return denied('shop-not-found')
  if (shop.slug !== access.shopSlug) return denied('invalid-access')
  if (principal.role === 'gm') return allowed()
  return shop.playerVisible === true && shop.open === true
    ? allowed()
    : denied('shop-not-accessible')
}

const evaluatePendingMoveResponseAccess = (
  access: Extract<RealtimeEventAccess, { readonly kind: 'pending-move-response-access' }>,
  principal: RealtimeDeliveryPrincipal,
  dependencies: RealtimeEventAccessDependencies,
): RealtimeEventAccessDecision => {
  const mapDecision = evaluateMapAccess(
    { kind: 'map-access', mapSlug: access.mapSlug },
    principal,
    dependencies,
  )
  if (!mapDecision.allowed) return mapDecision

  const resolution = dependencies.getPendingMoveResolution?.(access.resolutionId) ?? null
  const map = dependencies.getMap(access.mapSlug)
  const window = resolution?.outstandingWindows.find(
    candidate => candidate.windowId === access.windowId,
  ) ?? null
  if (
    !resolution
    || !map
    || resolution.originMapSlug !== access.mapSlug
    || resolution.status !== 'pending'
    || !window
  ) return denied('pending-move-response-not-accessible')

  const grant = pendingMoveResponseAuthorizationGrant({
    resolution,
    window,
    map,
    viewer: {
      role: principal.role,
      playerProfile: principal.playerProfile ?? null,
      linkedTrainerSheets: dependencies.listTrainerSheets(),
    },
  })
  return grant ? allowed() : denied('pending-move-response-not-accessible')
}

const playerProfileDirectlyControlsTrainer = (
  principal: RealtimeDeliveryPrincipal,
  trainerSheetSlug: string,
): boolean => principal.playerProfile?.linkedCharacters.some(ref => (
  ref.sheetKind === 'trainer' && ref.sheetSlug === trainerSheetSlug
)) === true

const evaluateBreedingAccess = (
  access: Extract<RealtimeEventAccess, { readonly kind: 'breeding-access' }>,
  principal: RealtimeDeliveryPrincipal,
  dependencies: RealtimeEventAccessDependencies,
  event: unknown,
): RealtimeEventAccessDecision => {
  let refresh
  try {
    refresh = parseBreedingRealtimeRefreshEventV1(event)
  } catch {
    return denied('invalid-access')
  }
  if (refresh.data.audienceRefreshScope !== access.audience) return denied('invalid-access')

  if (access.audience === 'public') return allowed()
  if (access.audience === 'gm') {
    return principal.role === 'gm' ? allowed() : denied('breeding-not-accessible')
  }
  if (access.audience === 'diagnostic') {
    return principal.role === 'gm' && principal.breedingDiagnosticAccess === true
      ? allowed()
      : denied('breeding-not-accessible')
  }
  const trainerSheetSlug = access.trainerSheetSlug
  if (typeof trainerSheetSlug !== 'string'
    || principal.role !== 'player'
    || !playerProfileDirectlyControlsTrainer(principal, trainerSheetSlug)) {
    return denied('breeding-not-accessible')
  }
  const trainer = dependencies.getSheet('trainer', trainerSheetSlug)
  if (!trainer) return denied('sheet-not-found')
  if (trainer.kind !== 'trainer' || trainer.slug !== trainerSheetSlug) {
    return denied('invalid-access')
  }
  return allowed()
}

const SETTLEMENT_EVENT_TYPES = new Set<string>(Object.values(ENCOUNTER_SETTLEMENT_REALTIME_EVENT_TYPES))

const evaluateSettlementProjectionAudience = (input: {
  readonly access: RealtimeEventAccess
  readonly principal: RealtimeDeliveryPrincipal
  readonly event: unknown
}): RealtimeEventAccessDecision | null => {
  if (!isRecord(input.event) || typeof input.event.type !== 'string'
    || !SETTLEMENT_EVENT_TYPES.has(input.event.type)) return null
  const data = isRecord(input.event.data) ? input.event.data : null
  const settlement = data && isRecord(data.settlement) ? data.settlement : null
  const audience = settlement?.audience
  if (audience !== 'public' && audience !== 'owner' && audience !== 'gm') {
    return denied('invalid-access')
  }
  const descriptorMatches = audience === 'gm'
    ? input.access.kind === 'gm-only'
    : audience === 'public'
      ? input.access.kind === 'map-access'
      : input.access.kind === 'sheet-access' || input.access.kind === 'group-inventory-access'
  if (!descriptorMatches) return denied('invalid-access')
  if (input.principal.role === 'gm') {
    return audience === 'gm' ? allowed() : denied('settlement-audience-not-accessible')
  }
  return audience === 'gm'
    ? denied('settlement-audience-not-accessible')
    : null
}

/**
 * Evaluates durable event-log records only. Replay control messages are
 * connection metadata without RealtimeEventAccess and must be delivered outside
 * this resource policy path.
 */
export const evaluateRealtimeEventAccess = (
  input: RealtimeEventAccessEvaluationInput,
): RealtimeEventAccessDecision => {
  const settlementAudienceDecision = evaluateSettlementProjectionAudience({
    access: input.access,
    principal: input.principal,
    event: input.event,
  })
  if (settlementAudienceDecision) return settlementAudienceDecision
  if (input.access.kind === 'gm-only') {
    return input.principal.role === 'gm' ? allowed() : denied('gm-only')
  }
  if (input.access.kind === 'map-access') {
    return evaluateMapAccess(input.access, input.principal, input.dependencies)
  }
  if (input.access.kind === 'sheet-access') {
    return evaluateSheetAccess(input.access, input.principal, input.dependencies)
  }
  if (input.access.kind === 'group-inventory-access') {
    return evaluateGroupInventoryAccess(input.access, input.principal, input.dependencies)
  }
  if (input.access.kind === 'shop-access') {
    return evaluateShopAccess(input.access, input.principal, input.dependencies)
  }
  if (input.access.kind === 'pending-move-response-access') {
    return evaluatePendingMoveResponseAccess(input.access, input.principal, input.dependencies)
  }
  if (input.access.kind === 'player-profile-access') {
    return input.principal.role === 'player'
      && input.principal.playerProfile?.id === input.access.profileId
      ? allowed()
      : denied('player-profile-not-accessible')
  }
  if (input.access.kind === 'contest-access') {
    if (input.access.audience === 'public') return allowed()
    if (input.access.audience === 'gm') {
      return input.principal.role === 'gm' ? allowed() : denied('contest-not-accessible')
    }
    return input.principal.role === 'player'
      && input.access.profileId !== null
      && input.principal.playerProfile?.id === input.access.profileId
      ? allowed()
      : denied('contest-not-accessible')
  }
  if (input.access.kind === 'breeding-access') {
    return evaluateBreedingAccess(input.access, input.principal, input.dependencies, input.event)
  }

  return denied('invalid-access')
}

export const createRealtimeEventAccessEvaluator = (
  dependencies: RealtimeEventAccessDependencies,
): RealtimeEventAccessEvaluator => (input) => evaluateRealtimeEventAccess({
  ...input,
  dependencies,
})

export const filterRealtimeEventsForPrincipal = (
  input: RealtimeEventAccessFilterInput,
): RealtimeEventAccessFilterResult => {
  const evaluator = createRealtimeEventAccessEvaluator(input.dependencies)
  const allowedEvents: PersistedRealtimeEvent[] = []
  const deniedEvents: DeniedRealtimeEventAccess[] = []

  for (const event of input.events) {
    const decision = evaluator({
      access: event.access,
      principal: input.principal,
      event: event.event,
    })
    if (decision.allowed) {
      const sourceControllerCanInspectSheet = event.access.kind === 'sheet-access'
        ? playerProfileCanAccessSheet(
            input.principal.playerProfile ?? null,
            event.access.sheetKind,
            event.access.sheetSlug,
            { linkedTrainerSheets: input.dependencies.listTrainerSheets() },
          )
        : false
      allowedEvents.push(input.principal.role === 'player'
        ? projectCapabilityAutomationRealtimeEventForPlayer(
            projectAbilityAutomationRealtimeEventForPlayer({
              event,
              sourceControllerCanInspectSheet,
            }),
          )
        : event)
    } else {
      deniedEvents.push({ event, decision })
    }
  }

  return {
    allowed: allowedEvents,
    denied: deniedEvents,
  }
}
