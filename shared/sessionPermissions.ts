import type { ClientId, PlayerId, SessionDisplayName } from './sessionIdentity'
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
