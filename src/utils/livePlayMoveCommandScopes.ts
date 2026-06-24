import type { ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import { LIVE_PLAY_RESOLVE_MOVE_SCOPE_LIMIT } from '#shared/livePlayMoveState'
import type { LivePlayScope, LivePlaySheetScope, LivePlayTokenScope } from '#shared/livePlayCommands'
import type { SheetPlacement, TabletopMap } from '~/types/map'

export { LIVE_PLAY_RESOLVE_MOVE_SCOPE_LIMIT }

export interface BuildResolveMoveScopesInput {
  readonly map: TabletopMap
  readonly intent: ResolveMoveIntent
  readonly candidateScopePlacementIds?: readonly string[]
}

export type BuildResolveMoveScopesResult =
  | {
      readonly ok: true
      readonly scopes: readonly LivePlayScope[]
      readonly scopePlacementIds: readonly string[]
    }
  | {
      readonly ok: false
      readonly message: string
    }

const ACTOR_TOKEN_FIELDS = [
  'moveUsage',
  'hp',
  'combatStages',
  'conditions',
  'position',
  'facing',
] as const satisfies readonly LivePlayTokenScope['field'][]

const TARGET_TOKEN_FIELDS = [
  'hp',
  'combatStages',
  'conditions',
] as const satisfies readonly LivePlayTokenScope['field'][]

const ACTOR_SHEET_FIELDS = [
  'moveUsage',
  'hp',
  'combatStages',
  'conditions',
] as const

const TARGET_SHEET_FIELDS = [
  'hp',
  'combatStages',
  'conditions',
] as const

const placementById = (map: TabletopMap): Map<string, SheetPlacement> => {
  const byId = new Map<string, SheetPlacement>()
  for (const placement of map.placements) {
    if (!byId.has(placement.id)) byId.set(placement.id, placement)
  }
  return byId
}

const explicitTargetIdsForIntent = (intent: ResolveMoveIntent): readonly string[] => {
  if (intent.selection.kind === 'single-target') return [intent.selection.targetPlacementId]
  if (intent.selection.kind === 'target-count') return intent.selection.targetPlacementIds
  return []
}

const parseCandidateScopeIds = (
  candidateScopePlacementIds: readonly string[] | undefined,
): { readonly ok: true; readonly ids: readonly string[] } | { readonly ok: false; readonly message: string } => {
  const ids = candidateScopePlacementIds ?? []
  const normalized: string[] = []
  const seen = new Set<string>()

  for (const [index, value] of ids.entries()) {
    if (typeof value !== 'string') {
      return { ok: false, message: `Candidate scope placement ${index + 1} must be a non-empty string.` }
    }
    const id = value.trim()
    if (!id) {
      return { ok: false, message: `Candidate scope placement ${index + 1} must be a non-empty string.` }
    }
    if (seen.has(id)) {
      return { ok: false, message: `Candidate scope placement ${id} was supplied more than once.` }
    }
    seen.add(id)
    normalized.push(id)
  }

  return { ok: true, ids: normalized }
}

const scopeKey = (scope: LivePlayScope): string => {
  if (scope.kind === 'map') return `map:${scope.lane}`
  if (scope.kind === 'token') return `token:${scope.placementId}:${scope.field}`
  return `sheet:${scope.sheetKind}:${scope.sheetSlug}:${scope.field}`
}

const pushScope = (scopes: LivePlayScope[], seen: Set<string>, scope: LivePlayScope): void => {
  const key = scopeKey(scope)
  if (seen.has(key)) return
  seen.add(key)
  scopes.push(scope)
}

const tokenScope = (placementId: string, field: LivePlayTokenScope['field']): LivePlayTokenScope => ({
  kind: 'token',
  placementId,
  field,
})

const sheetScopesForPlacement = (
  placement: SheetPlacement,
  fields: readonly string[],
): LivePlaySheetScope[] => fields.map((field) => ({
  kind: 'sheet',
  sheetKind: placement.sheetKind,
  sheetSlug: placement.sheetSlug,
  field,
}))

const deterministicScopePlacementIds = (
  map: TabletopMap,
  actorPlacementId: string,
  placementIds: ReadonlySet<string>,
): readonly string[] => {
  const ordered = [actorPlacementId]
  const seen = new Set<string>(ordered)
  for (const placement of map.placements) {
    if (placement.id === actorPlacementId || !placementIds.has(placement.id) || seen.has(placement.id)) continue
    seen.add(placement.id)
    ordered.push(placement.id)
  }
  return ordered
}

export const buildResolveMoveScopes = ({
  map,
  intent,
  candidateScopePlacementIds,
}: BuildResolveMoveScopesInput): BuildResolveMoveScopesResult => {
  const placementsById = placementById(map)
  const actorPlacement = placementsById.get(intent.placementId)
  if (!actorPlacement) {
    return { ok: false, message: `Actor placement ${intent.placementId} was not found on the current map.` }
  }

  const explicitTargetIds = explicitTargetIdsForIntent(intent)
  for (const targetId of explicitTargetIds) {
    if (!placementsById.has(targetId)) {
      return { ok: false, message: `Target placement ${targetId} was not found on the current map.` }
    }
  }

  const candidateResult = parseCandidateScopeIds(candidateScopePlacementIds)
  if (!candidateResult.ok) return candidateResult

  for (const candidateId of candidateResult.ids) {
    if (!placementsById.has(candidateId)) {
      return { ok: false, message: `Candidate scope placement ${candidateId} was not found on the current map.` }
    }
  }

  if (intent.selection.kind !== 'area' && candidateResult.ids.length > 0) {
    const allowed = new Set<string>([intent.placementId, ...explicitTargetIds])
    const unrelated = candidateResult.ids.find((candidateId) => !allowed.has(candidateId))
    if (unrelated) {
      return {
        ok: false,
        message: `Candidate scope placement ${unrelated} is not related to the actor or explicitly selected targets.`,
      }
    }
  }

  const scopedPlacementSet = new Set<string>([
    intent.placementId,
    ...explicitTargetIds,
    ...candidateResult.ids,
  ])
  const scopePlacementIds = deterministicScopePlacementIds(map, intent.placementId, scopedPlacementSet)
  const targetPlacementIds = scopePlacementIds.filter((placementId) => placementId !== intent.placementId)

  const scopes: LivePlayScope[] = []
  const seenScopes = new Set<string>()

  pushScope(scopes, seenScopes, tokenScope(intent.placementId, 'action'))
  pushScope(scopes, seenScopes, { kind: 'map', lane: 'metadata' })
  pushScope(scopes, seenScopes, { kind: 'map', lane: 'hazards' })
  pushScope(scopes, seenScopes, { kind: 'map', lane: 'fieldEffects' })

  for (const field of ACTOR_TOKEN_FIELDS) pushScope(scopes, seenScopes, tokenScope(intent.placementId, field))

  for (const placementId of targetPlacementIds) {
    for (const field of TARGET_TOKEN_FIELDS) pushScope(scopes, seenScopes, tokenScope(placementId, field))
  }

  for (const scope of sheetScopesForPlacement(actorPlacement, ACTOR_SHEET_FIELDS)) pushScope(scopes, seenScopes, scope)

  for (const placementId of targetPlacementIds) {
    const placement = placementsById.get(placementId)
    if (!placement) continue
    for (const scope of sheetScopesForPlacement(placement, TARGET_SHEET_FIELDS)) pushScope(scopes, seenScopes, scope)
  }

  if (scopes.length > LIVE_PLAY_RESOLVE_MOVE_SCOPE_LIMIT) {
    return {
      ok: false,
      message: `Resolve-move command requires ${scopes.length} resource scopes, exceeding the limit of ${LIVE_PLAY_RESOLVE_MOVE_SCOPE_LIMIT}.`,
    }
  }

  return { ok: true, scopes, scopePlacementIds }
}
