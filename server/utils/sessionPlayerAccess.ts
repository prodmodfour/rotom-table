import { getCookie, type H3Event } from 'h3'
import {
  SESSION_CLIENT_IDENTITY_COOKIE,
  deserializeSessionClientIdentityCookieHint,
  type PlayerSessionClientIdentityCookieHint,
} from '#shared/sessionClientIdentity'
import type { SheetKind } from '#shared/sheets'
import type { PlayerAssignmentRecord } from '#shared/sessionPermissions'
import type { AuthoritativeSessionState } from '#shared/sessionState'
import { getPlayerSessionStateUseCase } from '../useCases/getPlayerSessionState'

type SheetAccessKey = `${SheetKind}:${string}`

export interface PlayerSessionAccessGrant {
  readonly visibleMapSlugs: ReadonlySet<string>
  readonly sheetKeys: ReadonlySet<SheetAccessKey>
}

const sheetAccessKey = (kind: SheetKind, slug: string): SheetAccessKey => `${kind}:${slug}`

const isSheetKind = (value: unknown): value is SheetKind => value === 'pokemon' || value === 'trainer'

const nonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const readPlayerSessionCookieHint = (
  event: H3Event,
): PlayerSessionClientIdentityCookieHint | null => {
  const encoded = getCookie(event, SESSION_CLIENT_IDENTITY_COOKIE)
  if (!encoded) return null

  const result = deserializeSessionClientIdentityCookieHint(encoded)
  if (!result.ok || result.identity.role !== 'player') return null
  return result.identity
}

const addSheetKey = (keys: Set<SheetAccessKey>, kind: unknown, slug: unknown): void => {
  if (!isSheetKind(kind)) return
  const normalizedSlug = nonEmptyString(slug)
  if (normalizedSlug === null) return
  keys.add(sheetAccessKey(kind, normalizedSlug))
}

const addAssignmentSheetKeys = (
  keys: Set<SheetAccessKey>,
  assignment: PlayerAssignmentRecord,
): void => {
  for (const resource of [...assignment.visibleResources, ...assignment.controllableResources]) {
    if (resource.kind === 'sheet') {
      addSheetKey(keys, resource.sheetKind, resource.sheetSlug)
    } else if (resource.kind === 'token') {
      addSheetKey(keys, resource.sheetKind, resource.sheetSlug)
    }
  }
}

const addVisibleMapPlacementSheetKeys = <TMapDocument>(
  keys: Set<SheetAccessKey>,
  state: AuthoritativeSessionState<TMapDocument>,
  visibleMapSlugs: ReadonlySet<string>,
): void => {
  for (const mapState of state.maps) {
    if (!visibleMapSlugs.has(mapState.mapSlug)) continue

    const document = mapState.document as { placements?: unknown } | null | undefined
    const placements = Array.isArray(document?.placements) ? document.placements : []
    for (const placement of placements) {
      if (typeof placement !== 'object' || placement === null || Array.isArray(placement)) continue
      const record = placement as Record<string, unknown>
      addSheetKey(keys, record.sheetKind, record.sheetSlug)
    }
  }
}

export const getPlayerSessionAccessGrant = <TMapDocument = unknown>(
  event: H3Event,
): PlayerSessionAccessGrant | null => {
  const identity = readPlayerSessionCookieHint(event)
  if (identity === null) return null

  try {
    const result = getPlayerSessionStateUseCase<TMapDocument>({
      sessionId: identity.sessionId,
      playerId: identity.playerId,
      clientId: identity.clientId,
      displayName: identity.displayName,
    })

    const visibleMapSlugs = new Set(
      result.assignment.visibleResources
        .filter((resource) => resource.kind === 'map')
        .map((resource) => resource.mapSlug),
    )
    const sheetKeys = new Set<SheetAccessKey>()
    addAssignmentSheetKeys(sheetKeys, result.assignment)
    addVisibleMapPlacementSheetKeys(sheetKeys, result.state, visibleMapSlugs)

    return { visibleMapSlugs, sheetKeys }
  } catch {
    return null
  }
}

export const playerSessionCanAccessSheet = (
  grant: PlayerSessionAccessGrant | null,
  kind: SheetKind,
  slug: string,
): boolean => grant?.sheetKeys.has(sheetAccessKey(kind, slug)) === true
