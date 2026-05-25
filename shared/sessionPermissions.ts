import {
  isClientId,
  isPlayerId,
  isSessionDisplayName,
  type ClientId,
  type PlayerId,
  type SessionDisplayName,
} from './sessionIdentity'
import type { SheetKind } from './sheets'

export const SESSION_ROLES = ['gm', 'player'] as const
export type SessionRole = (typeof SESSION_ROLES)[number]
export type GmSessionRole = Extract<SessionRole, 'gm'>
export type PlayerSessionRole = Extract<SessionRole, 'player'>

const SESSION_ROLE_SET = new Set<unknown>(SESSION_ROLES)

export const isSessionRole = (value: unknown): value is SessionRole => SESSION_ROLE_SET.has(value)

export interface GmSessionActor {
  role: GmSessionRole
  clientId: ClientId
}

export interface PlayerSessionActor {
  role: PlayerSessionRole
  playerId: PlayerId
  clientId: ClientId
  displayName: SessionDisplayName
}

export type SessionActor = GmSessionActor | PlayerSessionActor

export const CONTROLLABLE_RESOURCE_KINDS = ['sheet', 'token'] as const
export type ControllableResourceKind = (typeof CONTROLLABLE_RESOURCE_KINDS)[number]

export const VISIBLE_RESOURCE_KINDS = ['map', 'sheet', 'token'] as const
export type VisibleResourceKind = (typeof VISIBLE_RESOURCE_KINDS)[number]

const CONTROLLABLE_RESOURCE_KIND_SET = new Set<unknown>(CONTROLLABLE_RESOURCE_KINDS)
const VISIBLE_RESOURCE_KIND_SET = new Set<unknown>(VISIBLE_RESOURCE_KINDS)

export const isControllableResourceKind = (value: unknown): value is ControllableResourceKind =>
  CONTROLLABLE_RESOURCE_KIND_SET.has(value)

export const isVisibleResourceKind = (value: unknown): value is VisibleResourceKind =>
  VISIBLE_RESOURCE_KIND_SET.has(value)

export interface SessionSheetResourceRef {
  kind: 'sheet'
  sheetKind: SheetKind
  sheetSlug: string
}

export interface SessionTokenResourceRef {
  kind: 'token'
  tokenId: string
  mapSlug?: string
  sheetKind?: SheetKind
  sheetSlug?: string
}

export interface SessionMapResourceRef {
  kind: 'map'
  mapSlug: string
}

export type SessionControllableResourceRef = SessionSheetResourceRef | SessionTokenResourceRef
export type SessionVisibleResourceRef =
  | SessionMapResourceRef
  | SessionSheetResourceRef
  | SessionTokenResourceRef
export type SessionResourceRef = SessionVisibleResourceRef

export interface PlayerAssignmentRecord {
  playerId: PlayerId
  displayName: SessionDisplayName
  controllableResources: readonly SessionControllableResourceRef[]
  visibleResources: readonly SessionVisibleResourceRef[]
  updatedAt: string
  updatedByClientId?: ClientId
}

export const PERMISSION_DENIED_REASONS = [
  'invalid-session-role',
  'missing-player-identity',
  'gm-required',
  'player-required',
  'resource-not-visible',
  'resource-not-assigned',
  'resource-not-controllable',
  'unknown-resource',
  'session-not-active',
] as const

export type PermissionDeniedReason = (typeof PERMISSION_DENIED_REASONS)[number]

const PERMISSION_DENIED_REASON_SET = new Set<unknown>(PERMISSION_DENIED_REASONS)

export const isPermissionDeniedReason = (value: unknown): value is PermissionDeniedReason =>
  PERMISSION_DENIED_REASON_SET.has(value)

export interface PermissionAllowed {
  allowed: true
  role: SessionRole
  resource?: SessionResourceRef
}

export interface PermissionDenied {
  allowed: false
  role?: SessionRole
  reason: PermissionDeniedReason
  message: string
  resource?: SessionResourceRef
}

export type PermissionResult = PermissionAllowed | PermissionDenied

type UnknownRecord = Record<string, unknown>

export type SessionSheetResourceIdentity = Pick<SessionSheetResourceRef, 'sheetKind' | 'sheetSlug'>
export type SessionTokenResourceIdentity = Pick<
  SessionTokenResourceRef,
  'tokenId' | 'mapSlug' | 'sheetKind' | 'sheetSlug'
>

const DEFAULT_PERMISSION_DENIAL_MESSAGES = {
  'invalid-session-role': 'The session actor must be a valid GM or player identity.',
  'missing-player-identity': 'The player identity does not match a joined session player.',
  'gm-required': 'This action requires GM authority.',
  'player-required': 'This action requires a player identity.',
  'resource-not-visible': 'This resource is not visible to the player.',
  'resource-not-assigned': 'This resource is not assigned to the player.',
  'resource-not-controllable': 'This resource is visible but cannot be controlled by players.',
  'unknown-resource': 'This resource is not known to the session.',
  'session-not-active': 'The session is not active.',
} as const satisfies Record<PermissionDeniedReason, string>

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const optionalValuesCompatible = <TValue extends string>(left?: TValue, right?: TValue): boolean =>
  left === undefined || right === undefined || left === right

export const getSessionActorRole = (actor: unknown): SessionRole | undefined =>
  isRecord(actor) && isSessionRole(actor.role) ? actor.role : undefined

export const isGmSessionActor = (actor: unknown): actor is GmSessionActor =>
  isRecord(actor) && actor.role === 'gm' && isClientId(actor.clientId)

export const isPlayerSessionActor = (actor: unknown): actor is PlayerSessionActor =>
  isRecord(actor) &&
  actor.role === 'player' &&
  isPlayerId(actor.playerId) &&
  isClientId(actor.clientId) &&
  isSessionDisplayName(actor.displayName)

export const allowPermission = (
  role: SessionRole,
  resource?: SessionResourceRef,
): PermissionAllowed => ({
  allowed: true,
  role,
  ...(resource === undefined ? {} : { resource }),
})

export const denyPermission = (
  reason: PermissionDeniedReason,
  message: string = DEFAULT_PERMISSION_DENIAL_MESSAGES[reason],
  role?: SessionRole,
  resource?: SessionResourceRef,
): PermissionDenied => ({
  allowed: false,
  reason,
  message,
  ...(role === undefined ? {} : { role }),
  ...(resource === undefined ? {} : { resource }),
})

const denyForInvalidActor = (actor: unknown, resource?: SessionResourceRef): PermissionDenied => {
  const role = getSessionActorRole(actor)
  if (role === 'player') {
    return denyPermission('missing-player-identity', undefined, role, resource)
  }

  return denyPermission('invalid-session-role', undefined, role, resource)
}

export const canUseGmAuthority = (actor: unknown): PermissionResult => {
  if (isGmSessionActor(actor)) return allowPermission('gm')
  if (isPlayerSessionActor(actor)) return denyPermission('gm-required', undefined, 'player')

  const role = getSessionActorRole(actor)
  return denyPermission('invalid-session-role', undefined, role)
}

export const canUsePlayerAuthority = (actor: unknown): PermissionResult => {
  if (isPlayerSessionActor(actor)) return allowPermission('player')
  if (isGmSessionActor(actor)) return denyPermission('player-required', undefined, 'gm')

  return denyForInvalidActor(actor)
}

export const findPlayerAssignment = (
  assignments: readonly PlayerAssignmentRecord[],
  playerId: PlayerId,
): PlayerAssignmentRecord | undefined =>
  assignments.find((assignment) => assignment.playerId === playerId)

export const sessionMapResourceRefsMatch = (
  granted: SessionMapResourceRef,
  requested: SessionMapResourceRef,
): boolean => granted.mapSlug === requested.mapSlug

export const sessionSheetResourceRefsMatch = (
  granted: SessionSheetResourceIdentity,
  requested: SessionSheetResourceIdentity,
): boolean =>
  granted.sheetKind === requested.sheetKind && granted.sheetSlug === requested.sheetSlug

export const sessionTokenResourceRefsMatch = (
  granted: SessionTokenResourceIdentity,
  requested: SessionTokenResourceIdentity,
): boolean =>
  granted.tokenId === requested.tokenId &&
  optionalValuesCompatible(granted.mapSlug, requested.mapSlug) &&
  optionalValuesCompatible(granted.sheetKind, requested.sheetKind) &&
  optionalValuesCompatible(granted.sheetSlug, requested.sheetSlug)

export const sessionResourceRefsMatch = (
  granted: SessionResourceRef,
  requested: SessionResourceRef,
): boolean => {
  if (granted.kind === 'map' && requested.kind === 'map') {
    return sessionMapResourceRefsMatch(granted, requested)
  }

  if (granted.kind === 'sheet' && requested.kind === 'sheet') {
    return sessionSheetResourceRefsMatch(granted, requested)
  }

  if (granted.kind === 'token' && requested.kind === 'token') {
    return sessionTokenResourceRefsMatch(granted, requested)
  }

  return false
}

export const getAssignedTokenIds = (
  assignment: Pick<PlayerAssignmentRecord, 'controllableResources'> | undefined,
): readonly string[] => {
  const tokenIds = new Set<string>()

  for (const resource of assignment?.controllableResources ?? []) {
    if (resource.kind === 'token') {
      tokenIds.add(resource.tokenId)
    }
  }

  return [...tokenIds]
}

export const isTokenIdAssignedToPlayer = (
  assignment: Pick<PlayerAssignmentRecord, 'controllableResources'> | undefined,
  tokenId: string,
): boolean =>
  assignment?.controllableResources.some(
    (resource) => resource.kind === 'token' && resource.tokenId === tokenId,
  ) ?? false

export const isMapVisibleToPlayer = (
  assignment: Pick<PlayerAssignmentRecord, 'visibleResources'> | undefined,
  mapSlug: string,
): boolean =>
  assignment?.visibleResources.some(
    (resource) => resource.kind === 'map' && resource.mapSlug === mapSlug,
  ) ?? false

export const isSheetVisibleToPlayer = (
  assignment: Pick<PlayerAssignmentRecord, 'visibleResources'> | undefined,
  sheet: SessionSheetResourceIdentity,
): boolean =>
  assignment?.visibleResources.some(
    (resource) => resource.kind === 'sheet' && sessionSheetResourceRefsMatch(resource, sheet),
  ) ?? false

export const isTokenVisibleToPlayer = (
  assignment: Pick<PlayerAssignmentRecord, 'visibleResources'> | undefined,
  token: SessionTokenResourceRef,
): boolean => {
  if (assignment === undefined) return false

  const tokenIsExplicitlyVisible = assignment.visibleResources.some(
    (resource) => resource.kind === 'token' && sessionTokenResourceRefsMatch(resource, token),
  )

  if (tokenIsExplicitlyVisible) return true

  return token.mapSlug === undefined ? false : isMapVisibleToPlayer(assignment, token.mapSlug)
}

export const isResourceVisibleToPlayer = (
  assignment: Pick<PlayerAssignmentRecord, 'visibleResources'> | undefined,
  resource: SessionResourceRef,
): boolean => {
  if (resource.kind === 'map') return isMapVisibleToPlayer(assignment, resource.mapSlug)
  if (resource.kind === 'sheet') return isSheetVisibleToPlayer(assignment, resource)
  return isTokenVisibleToPlayer(assignment, resource)
}

export const isSheetAssignedToPlayer = (
  assignment: Pick<PlayerAssignmentRecord, 'controllableResources'> | undefined,
  sheet: SessionSheetResourceIdentity,
): boolean =>
  assignment?.controllableResources.some(
    (resource) => resource.kind === 'sheet' && sessionSheetResourceRefsMatch(resource, sheet),
  ) ?? false

export const isTokenAssignedToPlayer = (
  assignment: Pick<PlayerAssignmentRecord, 'controllableResources'> | undefined,
  token: SessionTokenResourceRef,
): boolean =>
  assignment?.controllableResources.some(
    (resource) => resource.kind === 'token' && sessionTokenResourceRefsMatch(resource, token),
  ) ?? false

export const isResourceAssignedToPlayer = (
  assignment: Pick<PlayerAssignmentRecord, 'controllableResources'> | undefined,
  resource: SessionResourceRef,
): boolean => {
  if (resource.kind === 'map') return false
  if (resource.kind === 'sheet') return isSheetAssignedToPlayer(assignment, resource)
  return isTokenAssignedToPlayer(assignment, resource)
}

export const isResourceControllableByPlayer = (
  assignment: Pick<PlayerAssignmentRecord, 'controllableResources' | 'visibleResources'> | undefined,
  resource: SessionResourceRef,
): boolean =>
  resource.kind !== 'map' &&
  isResourceVisibleToPlayer(assignment, resource) &&
  isResourceAssignedToPlayer(assignment, resource)

export const canActorViewResource = (
  actor: unknown,
  assignments: readonly PlayerAssignmentRecord[],
  resource: SessionResourceRef,
): PermissionResult => {
  if (isGmSessionActor(actor)) return allowPermission('gm', resource)
  if (!isPlayerSessionActor(actor)) return denyForInvalidActor(actor, resource)

  const assignment = findPlayerAssignment(assignments, actor.playerId)
  if (assignment === undefined) {
    return denyPermission('missing-player-identity', undefined, 'player', resource)
  }

  if (isResourceVisibleToPlayer(assignment, resource)) {
    return allowPermission('player', resource)
  }

  return denyPermission('resource-not-visible', undefined, 'player', resource)
}

export const canActorControlResource = (
  actor: unknown,
  assignments: readonly PlayerAssignmentRecord[],
  resource: SessionResourceRef,
): PermissionResult => {
  if (isGmSessionActor(actor)) return allowPermission('gm', resource)
  if (!isPlayerSessionActor(actor)) return denyForInvalidActor(actor, resource)

  const assignment = findPlayerAssignment(assignments, actor.playerId)
  if (assignment === undefined) {
    return denyPermission('missing-player-identity', undefined, 'player', resource)
  }

  if (resource.kind === 'map') {
    return denyPermission('resource-not-controllable', undefined, 'player', resource)
  }

  if (!isResourceVisibleToPlayer(assignment, resource)) {
    return denyPermission('resource-not-visible', undefined, 'player', resource)
  }

  if (!isResourceAssignedToPlayer(assignment, resource)) {
    return denyPermission('resource-not-assigned', undefined, 'player', resource)
  }

  return allowPermission('player', resource)
}
