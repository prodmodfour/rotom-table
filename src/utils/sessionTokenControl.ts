import type { SessionClientIdentity } from '#shared/sessionClientIdentity'
import type { PlayerAssignmentRecord, SessionTokenResourceRef } from '#shared/sessionPermissions'
import {
  findPlayerAssignment,
  isMapVisibleToPlayer,
  isResourceControllableByPlayer,
  isTokenVisibleToPlayer,
} from '#shared/sessionPermissions'
import type { SheetPlacement } from '~/types/map'

export type SessionTokenControlStatus =
  | 'local-mode'
  | 'missing-identity'
  | 'waiting-for-snapshot'
  | 'gm-authority'
  | 'assigned'
  | 'visible-only'
  | 'unassigned'

export interface BuildSessionTokenControlModelInput {
  readonly enabled: boolean
  readonly identity: SessionClientIdentity | null
  readonly mapSlug: string
  readonly placements: readonly Pick<SheetPlacement, 'id' | 'sheetKind' | 'sheetSlug'>[]
  readonly assignments?: readonly PlayerAssignmentRecord[]
  readonly hasSnapshot?: boolean
}

export interface SessionTokenControlModel {
  readonly enabled: boolean
  readonly status: SessionTokenControlStatus
  readonly controllablePlacementIds: readonly string[]
  readonly notice: string | null
  readonly assignment: PlayerAssignmentRecord | null
}

const tokenResourceForPlacement = (
  placement: Pick<SheetPlacement, 'id' | 'sheetKind' | 'sheetSlug'>,
  mapSlug: string,
): SessionTokenResourceRef => ({
  kind: 'token',
  tokenId: placement.id,
  mapSlug,
  sheetKind: placement.sheetKind,
  sheetSlug: placement.sheetSlug,
})

const uniquePlacementIds = (
  placements: readonly Pick<SheetPlacement, 'id'>[],
): readonly string[] => [...new Set(placements.map((placement) => placement.id))]

const visibleTokenCount = (
  assignment: PlayerAssignmentRecord,
  placements: readonly Pick<SheetPlacement, 'id' | 'sheetKind' | 'sheetSlug'>[],
  mapSlug: string,
): number => placements.filter((placement) => isTokenVisibleToPlayer(
  assignment,
  tokenResourceForPlacement(placement, mapSlug),
)).length

export const buildSessionTokenControlModel = (
  input: BuildSessionTokenControlModelInput,
): SessionTokenControlModel => {
  if (!input.enabled) {
    return {
      enabled: false,
      status: 'local-mode',
      controllablePlacementIds: [],
      notice: null,
      assignment: null,
    }
  }

  if (input.identity === null) {
    return {
      enabled: true,
      status: 'missing-identity',
      controllablePlacementIds: [],
      notice: 'Open the session lobby and start or join a live session before using session map token controls.',
      assignment: null,
    }
  }

  if (input.identity.role === 'gm') {
    return {
      enabled: true,
      status: 'gm-authority',
      controllablePlacementIds: uniquePlacementIds(input.placements),
      notice: null,
      assignment: null,
    }
  }

  if (input.hasSnapshot === false || input.assignments === undefined) {
    return {
      enabled: true,
      status: 'waiting-for-snapshot',
      controllablePlacementIds: [],
      notice: 'Waiting for the live session snapshot before enabling player token controls.',
      assignment: null,
    }
  }

  const assignment = findPlayerAssignment(input.assignments, input.identity.playerId) ?? null
  if (assignment === null) {
    return {
      enabled: true,
      status: 'unassigned',
      controllablePlacementIds: [],
      notice: 'This live session map is visible, but your player does not have an assignment yet. Ask the GM to assign a token before moving or using token actions.',
      assignment: null,
    }
  }

  const controllablePlacementIds = uniquePlacementIds(input.placements.filter((placement) => (
    isResourceControllableByPlayer(assignment, tokenResourceForPlacement(placement, input.mapSlug))
  )))

  if (controllablePlacementIds.length > 0) {
    return {
      enabled: true,
      status: 'assigned',
      controllablePlacementIds,
      notice: null,
      assignment,
    }
  }

  const canSeeMap = isMapVisibleToPlayer(assignment, input.mapSlug)
  const visibleTokens = visibleTokenCount(assignment, input.placements, input.mapSlug)
  const status: SessionTokenControlStatus = canSeeMap || visibleTokens > 0 ? 'visible-only' : 'unassigned'
  const notice = status === 'visible-only'
    ? 'You can view this live session map, but none of its tokens are assigned to you. Ask the GM to assign a token before moving or using token actions.'
    : 'This live session map is not assigned to your player yet. Ask the GM to make the map visible and assign a token before using token actions.'

  return {
    enabled: true,
    status,
    controllablePlacementIds,
    notice,
    assignment,
  }
}
