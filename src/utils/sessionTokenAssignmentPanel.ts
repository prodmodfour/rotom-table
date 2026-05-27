import {
  sessionResourceRefsMatch,
  type PlayerAssignmentRecord,
  type SessionTokenResourceRef,
} from '#shared/sessionPermissions'
import type { PlayerId, SessionDisplayName } from '#shared/sessionIdentity'
import {
  normalizeSessionMapTokenResources,
  normalizeSessionTokenAssignmentText,
  sessionTokenResourceKey,
  type SessionMapTokenResourceInput,
} from '~/utils/sessionTokenAssignmentResources'

export type SessionTokenAssignmentRememberedRole = 'gm' | 'player' | null
export type SessionTokenAssignmentAction = 'assign' | 'unassign'
export type SessionTokenAssignmentStatusKind = 'ready' | 'blocked' | 'busy' | 'empty'

export type SessionTokenAssignmentTokenInput = SessionMapTokenResourceInput

export interface SessionTokenAssignmentPlayerInput {
  readonly playerId: PlayerId
  readonly displayName: SessionDisplayName
}

export interface BuildSessionTokenAssignmentPanelModelOptions {
  readonly mapSlug?: string | null
  readonly selectedMapSlug?: string | null
  readonly selectedMapAttached?: boolean
  readonly sessionMapAvailable?: boolean
  readonly localRoleIsGm?: boolean
  readonly rememberedRole?: SessionTokenAssignmentRememberedRole
  readonly busy?: boolean
  readonly players?: readonly SessionTokenAssignmentPlayerInput[]
  readonly assignments?: readonly PlayerAssignmentRecord[]
  readonly tokens?: readonly SessionTokenAssignmentTokenInput[]
}

export interface SessionTokenAssignmentControlModel {
  readonly key: string
  readonly tokenId: string
  readonly label: string
  readonly description: string
  readonly resource: SessionTokenResourceRef
  readonly assigned: boolean
  readonly action: SessionTokenAssignmentAction
  readonly buttonLabel: string
  readonly disabled: boolean
  readonly disabledReason: string | null
}

export interface SessionTokenAssignmentPlayerModel {
  readonly playerId: PlayerId
  readonly displayName: SessionDisplayName
  readonly summary: string
  readonly assignedTokenCount: number
  readonly tokens: readonly SessionTokenAssignmentControlModel[]
}

export interface SessionTokenAssignmentPanelModel {
  readonly heading: string
  readonly summary: string
  readonly statusKind: SessionTokenAssignmentStatusKind
  readonly canManage: boolean
  readonly disabledReason: string | null
  readonly mapSlug: string | null
  readonly selectedMapSlug: string | null
  readonly playerCount: number
  readonly tokenCount: number
  readonly players: readonly SessionTokenAssignmentPlayerModel[]
}

const normalizeText = normalizeSessionTokenAssignmentText

const assignmentForPlayer = (
  assignments: readonly PlayerAssignmentRecord[],
  playerId: PlayerId,
): PlayerAssignmentRecord | undefined => assignments.find((assignment) => assignment.playerId === playerId)

const isTokenAssigned = (
  assignment: PlayerAssignmentRecord | undefined,
  resource: SessionTokenResourceRef,
): boolean => assignment?.controllableResources.some((candidate) => (
  candidate.kind === 'token' && sessionResourceRefsMatch(candidate, resource)
)) ?? false

const kindLabel = (resource: SessionTokenResourceRef): string => {
  if (resource.sheetKind === 'pokemon') return 'Pokémon token'
  if (resource.sheetKind === 'trainer') return 'Trainer token'
  return 'Map token'
}

const tokenDisplaySlug = (resource: SessionTokenResourceRef): string =>
  resource.sheetSlug ?? resource.tokenId

const tokenDescription = (resource: SessionTokenResourceRef): string => {
  const parts = [resource.tokenId, `map ${resource.mapSlug ?? 'current map'}`]
  if (resource.sheetSlug) parts.push(`sheet ${resource.sheetSlug}`)
  return parts.join(' · ')
}

const getPanelDisabledReason = (
  options: BuildSessionTokenAssignmentPanelModelOptions,
  mapSlug: string | null,
  selectedMapSlug: string | null,
): string | null => {
  if (mapSlug === null) return 'Open a saved map before assigning live session token control.'
  if (options.localRoleIsGm !== true) return 'GM login is required before assigning live session token control.'
  if ((options.rememberedRole ?? null) === 'player') {
    return 'This browser remembers a player live session. Use the lobby to switch to a GM live session before assigning tokens.'
  }
  if ((options.rememberedRole ?? null) !== 'gm') {
    return 'Start or load a GM live session in this browser before assigning tokens.'
  }
  if (options.selectedMapAttached !== true || options.sessionMapAvailable !== true || selectedMapSlug === null) {
    return 'Select an available session map before assigning player token control.'
  }
  if (selectedMapSlug !== mapSlug) {
    return `The active session map is ${selectedMapSlug}. Open ${mapSlug} or select it before assigning its tokens.`
  }
  if (options.busy === true) return 'Updating live session token assignments…'
  return null
}

export const buildSessionTokenAssignmentPanelModel = (
  options: BuildSessionTokenAssignmentPanelModelOptions = {},
): SessionTokenAssignmentPanelModel => {
  const mapSlug = normalizeText(options.mapSlug)
  const selectedMapSlug = normalizeText(options.selectedMapSlug)
  const players = options.players ?? []
  const assignments = options.assignments ?? []
  const resources = normalizeSessionMapTokenResources(options.tokens ?? [], mapSlug)
  const disabledReason = getPanelDisabledReason(options, mapSlug, selectedMapSlug)
  const canManage = disabledReason === null

  const playerModels = players.map((player): SessionTokenAssignmentPlayerModel => {
    const assignment = assignmentForPlayer(assignments, player.playerId)
    const tokenControls = resources.map((resource): SessionTokenAssignmentControlModel => {
      const assigned = isTokenAssigned(assignment, resource)
      const action: SessionTokenAssignmentAction = assigned ? 'unassign' : 'assign'
      const disabled = !canManage
      return {
        key: `${player.playerId}::${sessionTokenResourceKey(resource)}`,
        tokenId: resource.tokenId,
        label: `${kindLabel(resource)} ${tokenDisplaySlug(resource)}`,
        description: tokenDescription(resource),
        resource,
        assigned,
        action,
        buttonLabel: assigned ? 'Unassign control' : 'Assign control',
        disabled,
        disabledReason: disabled ? disabledReason : null,
      }
    })
    const assignedTokenCount = tokenControls.filter((token) => token.assigned).length

    return {
      playerId: player.playerId,
      displayName: player.displayName,
      summary: resources.length === 0
        ? 'No current map tokens are available to assign.'
        : `${assignedTokenCount} of ${resources.length} current map tokens assigned`,
      assignedTokenCount,
      tokens: tokenControls,
    }
  })

  const statusKind: SessionTokenAssignmentStatusKind = disabledReason !== null
    ? options.busy === true ? 'busy' : 'blocked'
    : players.length === 0 || resources.length === 0
      ? 'empty'
      : 'ready'

  const summary = (() => {
    if (disabledReason !== null) return disabledReason
    if (players.length === 0) return 'Joined players will appear here after they enter the live session.'
    if (resources.length === 0) return 'No current map tokens are available yet. Place Pokémon or trainer tokens on the map before assigning control.'
    return 'Choose which joined players can control each current map token. Existing map visibility stays in place.'
  })()

  return {
    heading: 'Assign map tokens',
    summary,
    statusKind,
    canManage,
    disabledReason,
    mapSlug,
    selectedMapSlug,
    playerCount: players.length,
    tokenCount: resources.length,
    players: playerModels,
  }
}
