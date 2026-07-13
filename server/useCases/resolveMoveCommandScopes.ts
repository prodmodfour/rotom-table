import {
  type LivePlayMapScope,
  type LivePlayScope,
  type LivePlaySheetScope,
  type LivePlayTokenScope,
  type ResolveMoveLivePlayCommand,
} from '#shared/livePlayCommands'
import { LIVE_PLAY_RESOLVE_MOVE_SCOPE_LIMIT } from '#shared/livePlayMoveState'
import type { ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import type { SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import { sameJsonValue } from '~/utils/serialization'
import { tokenFacingForPlacement } from '~/utils/tokenFacing'
import { rejectLivePlayCommand } from '../livePlay/commandExecutor'
import type {
  AuthoritativeMoveStatePlan,
  AuthoritativePendingMoveStatePlan,
} from '../domain/planAuthoritativeMoveState'

const ALLOWED_MAP_LANES = new Set<LivePlayMapScope['lane']>([
  'metadata',
  'hazards',
  'fieldEffects',
  'placements',
  'initiative',
])
const ACTOR_TOKEN_FIELDS = new Set<LivePlayTokenScope['field']>([
  'action',
  'moveUsage',
  'hp',
  'combatStages',
  'conditions',
  'position',
  'facing',
])
const RELATED_TOKEN_FIELDS = new Set<LivePlayTokenScope['field']>(['hp', 'combatStages', 'conditions'])
const ACTOR_SHEET_FIELDS = new Set(['moveUsage', 'hp', 'combatStages', 'conditions'])
const RELATED_SHEET_FIELDS = new Set(['hp', 'combatStages', 'conditions'])

const scopeKey = (scope: LivePlayScope): string => {
  if (scope.kind === 'map') return `map:${scope.lane}`
  if (scope.kind === 'token') return `token:${scope.placementId}:${scope.field}`
  return `sheet:${scope.sheetKind}:${scope.sheetSlug}:${scope.field}`
}

const tokenScope = (placementId: string, field: LivePlayTokenScope['field']): LivePlayTokenScope => ({
  kind: 'token',
  placementId,
  field,
})

const mapScope = (lane: LivePlayMapScope['lane']): LivePlayMapScope => ({ kind: 'map', lane })

const sheetScope = (sheetKind: SheetKind, sheetSlug: string, field: string): LivePlaySheetScope => ({
  kind: 'sheet',
  sheetKind,
  sheetSlug,
  field,
})

const pushScope = (scopes: LivePlayScope[], seen: Set<string>, scope: LivePlayScope): void => {
  const key = scopeKey(scope)
  if (seen.has(key)) return
  seen.add(key)
  scopes.push(scope)
}

const placementById = (map: TabletopMap): ReadonlyMap<string, SheetPlacement> => {
  const placements = new Map<string, SheetPlacement>()
  for (const placement of map.placements) placements.set(placement.id, placement)
  return placements
}

const relatedPlacementIdsForPlan = (
  intent: ResolveMoveIntent,
  plan: AuthoritativeMoveStatePlan,
): ReadonlySet<string> => {
  const related = new Set<string>([plan.resolution.actorPlacementId])
  if (intent.selection.kind === 'area' || plan.resolution.movement?.kind === 'pass') {
    for (const placementId of plan.resolution.area?.candidateTargetIds ?? []) related.add(placementId)
  } else {
    for (const placementId of plan.resolution.selectedTargetIds) related.add(placementId)
  }

  const readSheetRefs = new Set(plan.sheetReads.map((read) => `${read.kind}:${read.slug}`))
  for (const placement of plan.previousMap.placements) {
    if (readSheetRefs.has(`${placement.sheetKind}:${placement.sheetSlug}`)) related.add(placement.id)
  }
  return related
}

const matchingRelatedPlacements = (
  placementsById: ReadonlyMap<string, SheetPlacement>,
  relatedPlacementIds: ReadonlySet<string>,
  sheetKind: SheetKind,
  sheetSlug: string,
): readonly SheetPlacement[] => {
  const placements: SheetPlacement[] = []
  for (const placementId of relatedPlacementIds) {
    const placement = placementsById.get(placementId)
    if (placement?.sheetKind === sheetKind && placement.sheetSlug === sheetSlug) placements.push(placement)
  }
  return placements
}

const assertNoDuplicateScopes = (scopes: readonly LivePlayScope[]): void => {
  const seen = new Set<string>()
  for (const scope of scopes) {
    const key = scopeKey(scope)
    if (seen.has(key)) rejectLivePlayCommand('invalid', `resolveMove scope ${key} was supplied more than once`)
    seen.add(key)
  }
}

const assertSubmittedScopeAllowed = (
  scope: LivePlayScope,
  actorPlacementId: string,
  relatedPlacementIds: ReadonlySet<string>,
  placementsById: ReadonlyMap<string, SheetPlacement>,
): void => {
  if (scope.kind === 'map') {
    if (!ALLOWED_MAP_LANES.has(scope.lane)) {
      rejectLivePlayCommand('invalid', 'resolveMove map scopes may only cover metadata, hazards, or fieldEffects')
    }
    return
  }

  if (scope.kind === 'token') {
    if (!relatedPlacementIds.has(scope.placementId)) {
      rejectLivePlayCommand('invalid', `resolveMove token scope ${scope.placementId}:${scope.field} is not related to the resolved move`)
    }
    if (!placementsById.has(scope.placementId)) {
      rejectLivePlayCommand('invalid', `resolveMove token scope references missing placement ${scope.placementId}`)
    }
    const allowedFields = scope.placementId === actorPlacementId ? ACTOR_TOKEN_FIELDS : RELATED_TOKEN_FIELDS
    if (!allowedFields.has(scope.field)) {
      rejectLivePlayCommand('invalid', `resolveMove token scope ${scope.placementId}:${scope.field} is not allowed for this placement`)
    }
    return
  }

  const placements = matchingRelatedPlacements(placementsById, relatedPlacementIds, scope.sheetKind, scope.sheetSlug)
  if (placements.length === 0) {
    rejectLivePlayCommand(
      'invalid',
      `resolveMove sheet scope ${scope.sheetKind}/${scope.sheetSlug}:${scope.field} does not match a related authoritative placement`,
    )
  }

  const allowed = placements.some((placement) => (
    placement.id === actorPlacementId
      ? ACTOR_SHEET_FIELDS.has(scope.field)
      : RELATED_SHEET_FIELDS.has(scope.field)
  ))
  if (!allowed) {
    rejectLivePlayCommand('invalid', `resolveMove sheet scope ${scope.sheetKind}/${scope.sheetSlug}:${scope.field} is not allowed for this move`)
  }
}

const assertRequiredConservativeScopes = (
  command: ResolveMoveLivePlayCommand,
  actorPlacementId: string,
): void => {
  const keys = new Set(command.scopes.map(scopeKey))
  if (!keys.has(scopeKey(tokenScope(actorPlacementId, 'action')))) {
    rejectLivePlayCommand('invalid', 'resolveMove scopes must include the actor token action scope')
  }
  if (!keys.has(scopeKey(mapScope('metadata')))) {
    rejectLivePlayCommand('invalid', 'resolveMove scopes must include the map metadata scope')
  }
}

const temporaryHpChangedPlacementIds = (
  plan: Pick<AuthoritativeMoveStatePlan | AuthoritativePendingMoveStatePlan, 'mapChanges'>,
): readonly string[] => {
  const change = plan.mapChanges.temporaryHitPoints
  if (!change) return []
  const ids = new Set<string>([
    ...Object.keys(change.previous?.byPlacementId ?? {}),
    ...Object.keys(change.current?.byPlacementId ?? {}),
  ])
  return [...ids].filter((id) => (
    (change.previous?.byPlacementId[id] ?? 0) !== (change.current?.byPlacementId[id] ?? 0)
  ))
}

const actorPlacementPair = (plan: AuthoritativeMoveStatePlan): {
  readonly previous: SheetPlacement | null
  readonly current: SheetPlacement | null
} => {
  const actorId = plan.resolution.actorPlacementId
  return {
    previous: plan.previousMap.placements.find((placement) => placement.id === actorId) ?? null,
    current: plan.nextMap.placements.find((placement) => placement.id === actorId) ?? null,
  }
}

const actorPositionChanged = (plan: AuthoritativeMoveStatePlan): boolean => {
  if (plan.resolution.movement?.kind !== 'pass') return false
  const placements = actorPlacementPair(plan)
  return !!placements.previous && !!placements.current && !sameJsonValue(placements.previous.position, placements.current.position)
}

const actorFacingChanged = (plan: AuthoritativeMoveStatePlan): boolean => {
  const placements = actorPlacementPair(plan)
  if (!placements.previous || !placements.current) return false
  return tokenFacingForPlacement(placements.previous) !== tokenFacingForPlacement(placements.current)
    || placements.previous.turned !== placements.current.turned
}

const pushSheetWriteScopes = (
  scopes: LivePlayScope[],
  seen: Set<string>,
  writes: AuthoritativeMoveStatePlan['sheetWrites'],
): void => {
  for (const write of writes) {
    for (const field of write.changedFields) {
      pushScope(scopes, seen, sheetScope(write.kind, write.slug, field))
      if (field === 'hp') {
        for (const placementId of write.placementIds) pushScope(scopes, seen, tokenScope(placementId, 'hp'))
      } else if (field === 'combatStages') {
        for (const placementId of write.placementIds) pushScope(scopes, seen, tokenScope(placementId, 'combatStages'))
      } else if (field === 'conditions') {
        for (const placementId of write.placementIds) pushScope(scopes, seen, tokenScope(placementId, 'conditions'))
      }
    }
  }
}

export const actualResolveMoveWriteScopes = (plan: AuthoritativeMoveStatePlan): readonly LivePlayScope[] => {
  const scopes: LivePlayScope[] = []
  const seen = new Set<string>()
  const actorId = plan.resolution.actorPlacementId

  pushScope(scopes, seen, tokenScope(actorId, 'action'))
  pushScope(scopes, seen, mapScope('metadata'))

  if (plan.mapChanges.hazards) pushScope(scopes, seen, mapScope('hazards'))
  if (plan.mapChanges.fieldEffects) pushScope(scopes, seen, mapScope('fieldEffects'))
  if (plan.resolution.switchTransition && plan.mapChanges.placements) {
    pushScope(scopes, seen, mapScope('placements'))
    pushScope(scopes, seen, tokenScope(plan.resolution.switchTransition.recalledPlacementId, 'delete'))
    pushScope(scopes, seen, tokenScope(plan.resolution.switchTransition.sentOutPlacement.id, 'sendOut'))
  }
  if (plan.mapChanges.initiative) pushScope(scopes, seen, mapScope('initiative'))
  if (plan.mapChanges.moveUsage) pushScope(scopes, seen, tokenScope(actorId, 'moveUsage'))
  if (actorPositionChanged(plan)) pushScope(scopes, seen, tokenScope(actorId, 'position'))
  if (actorFacingChanged(plan)) pushScope(scopes, seen, tokenScope(actorId, 'facing'))

  for (const placementId of temporaryHpChangedPlacementIds(plan)) pushScope(scopes, seen, tokenScope(placementId, 'hp'))
  pushSheetWriteScopes(scopes, seen, plan.sheetWrites)

  return scopes
}

const actualPendingResolveMoveWriteScopes = (
  plan: AuthoritativePendingMoveStatePlan,
): readonly LivePlayScope[] => {
  const scopes: LivePlayScope[] = []
  const seen = new Set<string>()
  const actorId = plan.execution.actorPlacementId

  pushScope(scopes, seen, tokenScope(actorId, 'action'))
  // Encounter-state pending summaries currently share the map metadata lane.
  pushScope(scopes, seen, mapScope('metadata'))
  for (const placementId of temporaryHpChangedPlacementIds(plan)) {
    pushScope(scopes, seen, tokenScope(placementId, 'hp'))
  }
  pushSheetWriteScopes(scopes, seen, plan.sheetWrites)
  return scopes
}

const assertActualScopesWereSubmitted = (
  submittedScopes: readonly LivePlayScope[],
  actualScopes: readonly LivePlayScope[],
): void => {
  const submitted = new Set(submittedScopes.map(scopeKey))
  for (const scope of actualScopes) {
    const key = scopeKey(scope)
    if (!submitted.has(key)) rejectLivePlayCommand('invalid', `resolveMove scopes are missing required write scope ${key}`)
  }
}

export const validateResolveMoveScopes = (input: {
  readonly command: ResolveMoveLivePlayCommand
  readonly intent: ResolveMoveIntent
  readonly map: TabletopMap
  readonly plan: AuthoritativeMoveStatePlan
}): readonly LivePlayScope[] => {
  if (input.command.scopes.length > LIVE_PLAY_RESOLVE_MOVE_SCOPE_LIMIT) {
    rejectLivePlayCommand(
      'invalid',
      `resolveMove scopes must contain at most ${LIVE_PLAY_RESOLVE_MOVE_SCOPE_LIMIT} entries`,
    )
  }

  assertNoDuplicateScopes(input.command.scopes)

  const actorPlacementId = input.plan.resolution.actorPlacementId
  const relatedPlacementIds = relatedPlacementIdsForPlan(input.intent, input.plan)
  const placementsById = placementById(input.map)

  assertRequiredConservativeScopes(input.command, actorPlacementId)
  for (const scope of input.command.scopes) {
    assertSubmittedScopeAllowed(scope, actorPlacementId, relatedPlacementIds, placementsById)
  }

  const actualScopes = actualResolveMoveWriteScopes(input.plan)
  assertActualScopesWereSubmitted(input.command.scopes, actualScopes)
  return actualScopes
}

/** Validate declaration scopes against the summary and approved pre-window writes. */
export const validatePendingResolveMoveScopes = (input: {
  readonly command: ResolveMoveLivePlayCommand
  readonly map: TabletopMap
  readonly plan: AuthoritativePendingMoveStatePlan
}): readonly LivePlayScope[] => {
  if (input.command.scopes.length > LIVE_PLAY_RESOLVE_MOVE_SCOPE_LIMIT) {
    rejectLivePlayCommand(
      'invalid',
      `resolveMove scopes must contain at most ${LIVE_PLAY_RESOLVE_MOVE_SCOPE_LIMIT} entries`,
    )
  }
  assertNoDuplicateScopes(input.command.scopes)

  const actorPlacementId = input.plan.execution.actorPlacementId
  const relatedPlacementIds = new Set<string>([
    actorPlacementId,
    ...input.plan.execution.selectedTargetIds,
  ])
  const readSheetRefs = new Set(
    input.plan.sheetReads.map(read => `${read.kind}:${read.slug}`),
  )
  for (const placement of input.map.placements) {
    if (readSheetRefs.has(`${placement.sheetKind}:${placement.sheetSlug}`)) {
      relatedPlacementIds.add(placement.id)
    }
  }
  const placementsById = placementById(input.map)

  assertRequiredConservativeScopes(input.command, actorPlacementId)
  for (const scope of input.command.scopes) {
    assertSubmittedScopeAllowed(
      scope,
      actorPlacementId,
      relatedPlacementIds,
      placementsById,
    )
  }

  const actualScopes = actualPendingResolveMoveWriteScopes(input.plan)
  assertActualScopesWereSubmitted(input.command.scopes, actualScopes)
  return actualScopes
}
