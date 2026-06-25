import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { RealtimeEventAccess, PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import type { SheetKind } from '#shared/sheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { canAccessMapForRole } from '../policies/mapPolicy'
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
}

export interface RealtimeEventAccessDependencies {
  readonly getMap: (slug: string) => TabletopMap | null
  readonly getSheet: (
    kind: SheetKind,
    slug: string,
  ) => RealtimePolicyPersistedSheet | null
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
        | 'invalid-access'
    }

export interface RealtimeEventAccessEvaluationInput {
  readonly access: RealtimeEventAccess
  readonly principal: RealtimeDeliveryPrincipal
  readonly dependencies: RealtimeEventAccessDependencies
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

/**
 * Evaluates durable event-log records only. Replay control messages are
 * connection metadata without RealtimeEventAccess and must be delivered outside
 * this resource policy path.
 */
export const evaluateRealtimeEventAccess = (
  input: RealtimeEventAccessEvaluationInput,
): RealtimeEventAccessDecision => {
  if (input.access.kind === 'gm-only') {
    return input.principal.role === 'gm' ? allowed() : denied('gm-only')
  }
  if (input.access.kind === 'map-access') {
    return evaluateMapAccess(input.access, input.principal, input.dependencies)
  }
  if (input.access.kind === 'sheet-access') {
    return evaluateSheetAccess(input.access, input.principal, input.dependencies)
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
    const decision = evaluator({ access: event.access, principal: input.principal })
    if (decision.allowed) {
      allowedEvents.push(event)
    } else {
      deniedEvents.push({ event, decision })
    }
  }

  return {
    allowed: allowedEvents,
    denied: deniedEvents,
  }
}
