import type { GridAnchor } from '~/types/map'
import type { MoveAutomationAreaDirection, MoveAutomationAreaTemplate } from '~/types/moveAutomation'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import {
  buildMoveAutomationAreaTemplateCells,
  tokensInMoveAutomationArea,
} from '~/utils/moveAutomationAreaTemplates'
import {
  parseAbilityTargetingPredicate,
  type AbilityTargetingPredicate,
} from '#shared/abilityAutomation/targeting'
import type { AbilityDeclarationDirection } from '#shared/abilityAutomation/declarationIntent'
import {
  evaluateMoveAutomationTargetPredicates,
  type MoveAutomationTargetPredicateEvaluation,
  type MoveAutomationTargetWillingnessDeclaration,
} from '../moveAutomation/predicates/target'
import { createMoveAutomationRelationshipResolver } from '../moveAutomation/relationships'
import { createMoveAutomationLineOfSightResolver } from '../moveAutomation/lineOfSight'
import { createMoveAutomationBarriersAndSmokeResolver } from '../moveAutomation/barriersAndSmoke'
import type { AuthoritativeAbilityContext } from './context'

export interface AbilityTargetGeometryEvaluation {
  readonly placementId: string
  readonly distance: number
  readonly inGeometry: boolean
  readonly visible: boolean
  readonly lineOfSight: boolean
  readonly reasonCode:
    | 'target-geometry-included'
    | 'target-geometry-out-of-range'
    | 'target-geometry-outside-shape'
    | 'target-geometry-not-visible'
    | 'target-geometry-line-of-sight-blocked'
}

export interface ResolveAbilityTargetsResult {
  readonly policy: AbilityTargetingPredicate
  readonly areaCells: readonly GridAnchor[]
  readonly authoritativeCandidatePlacementIds: readonly string[]
  readonly legalTargetPlacementIds: readonly string[]
  readonly eligibleTargetPlacementIds: readonly string[]
  readonly geometryEvaluations: readonly AbilityTargetGeometryEvaluation[]
  readonly predicateEvaluations: readonly MoveAutomationTargetPredicateEvaluation[]
}

export type AbilityTargetingResolutionErrorCode =
  | 'actor-missing'
  | 'visibility-unavailable'
  | 'invalid-visibility'
  | 'area-choice-missing'
  | 'area-center-out-of-range'
  | 'unsupported-geometry'

export class AbilityTargetingResolutionError extends Error {
  constructor(readonly code: AbilityTargetingResolutionErrorCode, detail: string) {
    super(detail)
    this.name = 'AbilityTargetingResolutionError'
  }
}

const fail = (code: AbilityTargetingResolutionErrorCode, detail: string): never => {
  throw new AbilityTargetingResolutionError(code, detail)
}
const directionMap: Readonly<Record<AbilityDeclarationDirection, MoveAutomationAreaDirection>> = Object.freeze({
  north: 'north', northeast: 'north-east', east: 'east', southeast: 'south-east',
  south: 'south', southwest: 'south-west', west: 'west', northwest: 'north-west',
  up: 'up', down: 'down',
})
const intervalOverlaps = (leftStart: number, leftSize: number, rightStart: number, rightSize: number): boolean => (
  leftStart <= rightStart + rightSize - 1 && rightStart <= leftStart + leftSize - 1
)
const cardinallyAdjacent = (
  left: { readonly position: GridAnchor; readonly base: number; readonly clearance: number },
  right: { readonly position: GridAnchor; readonly base: number; readonly clearance: number },
): boolean => {
  const axes = [
    {
      leftStart: left.position.x, leftSize: left.base,
      rightStart: right.position.x, rightSize: right.base,
      overlapsA: intervalOverlaps(left.position.y, left.clearance, right.position.y, right.clearance),
      overlapsB: intervalOverlaps(left.position.z, left.base, right.position.z, right.base),
    },
    {
      leftStart: left.position.y, leftSize: left.clearance,
      rightStart: right.position.y, rightSize: right.clearance,
      overlapsA: intervalOverlaps(left.position.x, left.base, right.position.x, right.base),
      overlapsB: intervalOverlaps(left.position.z, left.base, right.position.z, right.base),
    },
    {
      leftStart: left.position.z, leftSize: left.base,
      rightStart: right.position.z, rightSize: right.base,
      overlapsA: intervalOverlaps(left.position.x, left.base, right.position.x, right.base),
      overlapsB: intervalOverlaps(left.position.y, left.clearance, right.position.y, right.clearance),
    },
  ]
  return axes.some(axis => {
    const leftEnd = axis.leftStart + axis.leftSize - 1
    const rightEnd = axis.rightStart + axis.rightSize - 1
    return axis.overlapsA && axis.overlapsB
      && (Math.abs(leftEnd - axis.rightStart) === 1 || Math.abs(rightEnd - axis.leftStart) === 1)
  })
}
const areaTemplate = (policy: Extract<AbilityTargetingPredicate['geometry'], { kind: 'area' }>): MoveAutomationAreaTemplate => ({
  kind: policy.templateKind,
  size: policy.size,
  ...(policy.range === null ? {} : { range: policy.range }),
  label: `ability.${policy.templateKind}.${policy.size}`,
})
const footprintDistance = (
  left: AuthoritativeAbilityContext['actor']['token'],
  right: AuthoritativeAbilityContext['actor']['token'],
): number => ptuGridDistanceBetweenFootprints(left, right)

/**
 * Resolve ability targets from the frozen context. Requested IDs and area
 * choices can only narrow server-derived geometry and reviewed predicates.
 */
export const resolveAuthoritativeAbilityTargets = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly predicate: unknown
  readonly requestedPlacementIds: readonly string[]
  /** Server vision projection. Required only when the reviewed policy requires visibility. */
  readonly visiblePlacementIds?: readonly string[]
  /** Authorized declarations, never raw client willingness booleans. */
  readonly willingnessDeclarations?: readonly MoveAutomationTargetWillingnessDeclaration[]
  readonly direction?: AbilityDeclarationDirection
  readonly center?: GridAnchor
}): ResolveAbilityTargetsResult => {
  const policy = parseAbilityTargetingPredicate(input.predicate)
  const actor = input.context.tokens.find(token => token.id === input.context.actor.placement.id)
    ?? fail('actor-missing', 'Ability actor has no authoritative footprint.')
  let visible: ReadonlySet<string> | null = null
  if (policy.visibility === 'required') {
    const visiblePlacementIds = input.visiblePlacementIds
    if (!visiblePlacementIds) fail('visibility-unavailable', 'Reviewed targeting requires server vision.')
    if (visiblePlacementIds!.length > input.context.placements.length
      || new Set(visiblePlacementIds!).size !== visiblePlacementIds!.length
      || visiblePlacementIds!.some(id => !input.context.placements.some(placement => placement.id === id))) {
      fail('invalid-visibility', 'Server vision projection is invalid.')
    }
    visible = new Set(visiblePlacementIds!)
  }
  const relationships = createMoveAutomationRelationshipResolver({
    placements: input.context.placements,
    sides: input.context.sides,
  })
  const obscuration = createMoveAutomationBarriersAndSmokeResolver({
    map: input.context.map,
    placements: input.context.tokens.map(token => ({
      id: token.id, position: token.position, base: token.base, clearance: token.clearance,
    })),
  })
  const lineOfSight = createMoveAutomationLineOfSightResolver({
    voxels: input.context.map.voxels ?? [],
    placements: input.context.tokens.map(token => ({
      id: token.id, position: token.position, base: token.base, clearance: token.clearance,
    })),
    barrierCells: obscuration.barrierSightCells(),
  })
  let areaCells: readonly GridAnchor[] = []
  let geometryIds: ReadonlySet<string>
  if (policy.geometry.kind === 'area') {
    const requiresDirection = ['close-blast', 'cone', 'line'].includes(policy.geometry.templateKind)
    const requiresCenter = policy.geometry.templateKind === 'ranged-blast'
    if ((requiresDirection && input.direction === undefined)
      || (requiresCenter && input.center === undefined)) {
      fail('area-choice-missing', 'Reviewed area targeting requires an authoritative direction or center.')
    }
    if (requiresCenter && input.center && policy.geometry.range !== null) {
      const centerFootprint = { position: input.center, base: 1, clearance: 1 }
      if (ptuGridDistanceBetweenFootprints(actor, centerFootprint) > policy.geometry.range) {
        fail('area-center-out-of-range', 'Area center is outside reviewed range.')
      }
    }
    areaCells = Object.freeze(buildMoveAutomationAreaTemplateCells({
      template: areaTemplate(policy.geometry),
      user: actor,
      ...(input.direction ? { direction: directionMap[input.direction] } : {}),
      ...(input.center ? { center: input.center } : {}),
      bounds: input.context.map.dimensions,
    }))
    geometryIds = new Set(tokensInMoveAutomationArea({
      cells: areaCells,
      tokens: input.context.tokens,
    }).map(token => token.id))
  }
  else {
    geometryIds = new Set(input.context.tokens.filter(token => {
      const distance = footprintDistance(actor, token)
      if (distance < policy.minimumRange
        || (policy.maximumRange !== null && distance > policy.maximumRange)) return false
      if (policy.geometry.kind === 'adjacent') {
        return distance === 1 && (!policy.geometry.cardinalOnly || cardinallyAdjacent(actor, token))
      }
      return true
    }).map(token => token.id))
  }
  const lineCache = new Map<string, boolean>()
  const geometryEvaluations = input.context.tokens.map((token): AbilityTargetGeometryEvaluation => {
    const distance = footprintDistance(actor, token)
    const inRange = distance >= policy.minimumRange
      && (policy.maximumRange === null || distance <= policy.maximumRange)
    const inGeometry = geometryIds.has(token.id) && inRange
    const isVisible = visible === null || visible.has(token.id)
    const hasLine = policy.lineOfSight === 'ignored'
      || (lineCache.get(token.id) ?? (() => {
        const value = lineOfSight.resolve(actor.id, token.id).targetable
        lineCache.set(token.id, value)
        return value
      })())
    return Object.freeze({
      placementId: token.id,
      distance,
      inGeometry,
      visible: isVisible,
      lineOfSight: hasLine,
      reasonCode: !inRange
        ? 'target-geometry-out-of-range'
        : !geometryIds.has(token.id)
          ? 'target-geometry-outside-shape'
          : !isVisible
            ? 'target-geometry-not-visible'
            : !hasLine
              ? 'target-geometry-line-of-sight-blocked'
              : 'target-geometry-included',
    })
  })
  const authoritativeCandidatePlacementIds = geometryEvaluations
    .filter(evaluation => evaluation.reasonCode === 'target-geometry-included')
    .map(evaluation => evaluation.placementId)
  const predicates = evaluateMoveAutomationTargetPredicates({
    actorPlacementId: actor.id,
    authoritativeCandidatePlacementIds,
    requestedCandidatePlacementIds: input.requestedPlacementIds,
    predicate: {
      relationship: policy.relationship,
      willingness: policy.willingness,
      excludeActor: policy.excludeActor,
    },
    relationships,
    willingnessDeclarations: input.willingnessDeclarations,
  })
  return Object.freeze({
    policy,
    areaCells,
    authoritativeCandidatePlacementIds: Object.freeze(authoritativeCandidatePlacementIds),
    legalTargetPlacementIds: predicates.legalTargetPlacementIds,
    eligibleTargetPlacementIds: predicates.eligibleTargetPlacementIds,
    geometryEvaluations: Object.freeze(geometryEvaluations),
    predicateEvaluations: predicates.requestedTargetEvaluations,
  })
}
