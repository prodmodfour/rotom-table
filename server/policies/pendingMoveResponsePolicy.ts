import type { AuthRole } from '#shared/auth'
import type {
  PendingMoveResolution,
  PendingMoveResponseOwner,
  PendingMoveResponseWindow,
} from '#shared/moveAutomation/pendingResolution'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import {
  actorCanControlMapPlacement,
  playerProfileControlsMapSide,
  type ServerTokenControlLinkedTrainerSheet,
} from './playerProfileTokenControlPolicy'

export interface PendingMoveResponseViewer {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly linkedTrainerSheets?: readonly ServerTokenControlLinkedTrainerSheet[]
}

export interface PendingMoveResponseAuthorizationGrant {
  /** Stable principal recorded as the responder when a later resume is accepted. */
  readonly chosenBy: PendingMoveResponseOwner
  readonly source: 'gm-authority' | 'window-owner'
}

const placementById = (
  map: TabletopMap,
  placementId: string,
): SheetPlacement | null => map.placements.find(placement => placement.id === placementId) ?? null

const playerControlsPlacement = (input: {
  readonly placementId: string
  readonly map: TabletopMap
  readonly viewer: PendingMoveResponseViewer
}): boolean => {
  const placement = placementById(input.map, input.placementId)
  if (!placement || input.viewer.role !== 'player') return false
  return actorCanControlMapPlacement({
    role: input.viewer.role,
    profile: input.viewer.playerProfile,
    placement,
    linkedTrainerSheets: input.viewer.linkedTrainerSheets,
  })
}

const playerMatchesOwner = (input: {
  readonly owner: PendingMoveResponseOwner
  readonly resolution: PendingMoveResolution
  readonly map: TabletopMap
  readonly viewer: PendingMoveResponseViewer
}): boolean => {
  const { owner, resolution, map, viewer } = input
  if (viewer.role !== 'player' || !viewer.playerProfile) return false

  if (owner.kind === 'actor') {
    return playerControlsPlacement({
      placementId: resolution.actorPlacementId,
      map,
      viewer,
    })
  }
  if (owner.kind === 'target' || owner.kind === 'placement') {
    return owner.id !== null && playerControlsPlacement({
      placementId: owner.id,
      map,
      viewer,
    })
  }
  if (owner.kind === 'profile') return owner.id === viewer.playerProfile.id
  if (owner.kind === 'side') {
    return owner.id !== null && playerProfileControlsMapSide({
      profile: viewer.playerProfile,
      sideId: owner.id,
      placements: map.placements,
      linkedTrainerSheets: viewer.linkedTrainerSheets,
    })
  }
  return false
}

/**
 * Resolve one current viewer against server-authored window ownership. GMs are
 * authoritative supervisors; players must match a concrete owner through their
 * selected profile and current map token-control projection.
 */
export const pendingMoveResponseAuthorizationGrant = (input: {
  readonly resolution: PendingMoveResolution
  readonly window: PendingMoveResponseWindow
  readonly map: TabletopMap
  readonly viewer: PendingMoveResponseViewer
}): PendingMoveResponseAuthorizationGrant | null => {
  if (
    input.resolution.originMapSlug !== input.map.slug
    || input.resolution.status !== 'pending'
    || !input.resolution.outstandingWindows.some(
      candidate => candidate.windowId === input.window.windowId,
    )
  ) return null

  if (input.viewer.role === 'gm') {
    return Object.freeze({
      chosenBy: Object.freeze({ kind: 'gm', id: null }),
      source: 'gm-authority',
    })
  }

  const owner = input.window.ownership.find(candidate => playerMatchesOwner({
    owner: candidate,
    resolution: input.resolution,
    map: input.map,
    viewer: input.viewer,
  }))
  if (!owner) return null
  return Object.freeze({
    chosenBy: Object.freeze({ ...owner }),
    source: 'window-owner',
  })
}

export const canInspectPendingMoveResponseWindow = (input: {
  readonly resolution: PendingMoveResolution
  readonly window: PendingMoveResponseWindow
  readonly map: TabletopMap
  readonly viewer: PendingMoveResponseViewer
}): boolean => pendingMoveResponseAuthorizationGrant(input) !== null
