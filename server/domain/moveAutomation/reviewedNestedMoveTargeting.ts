import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { GridAnchor, SpawnedPokemon } from '~/types/pokemon'
import { gridFootprintCells } from '~/utils/gridGeometry'
import {
  buildMoveAutomationAreaTemplateCells,
  buildMoveAutomationAreaTemplatePlacementAtCenter,
  buildMoveAutomationCloseBlastPlacementAtAimCell,
  MOVE_AUTOMATION_AREA_DIRECTIONS,
  tokensInMoveAutomationArea,
} from '~/utils/moveAutomationAreaTemplates'
import {
  moveAutomationTargetsInRange,
  parseExplicitMultiTargetMoveRangeMeters,
  parseSingleTargetMoveRangeMeters,
} from '~/utils/moveAutomationRange'
import { buildAllVoxelOccupancy } from '~/utils/voxelOccupancy'
import type { AuthoritativeMoveRulesContext } from './context'
import type { MoveSpecV2Runtime } from './registry'
import {
  DEFAULT_MOVE_AUTOMATION_AREA_TARGET_PREDICATE,
  resolveMoveAutomationAreaTargets,
  type MoveAutomationAreaTargetEvaluation,
} from './areaTargets'
import { evaluateMoveAutomationTargetPredicates } from './predicates/target'

export interface ReviewedNestedAreaTargetingResolution {
  readonly targetIds: readonly string[]
  readonly evaluations: readonly MoveAutomationAreaTargetEvaluation[]
}

const canonicalPlacementIds = (
  context: AuthoritativeMoveRulesContext,
  ids: Iterable<string>,
): readonly string[] => {
  const selected = new Set(ids)
  return Object.freeze(context.queries.placements.all()
    .filter(placement => selected.has(placement.id))
    .map(placement => placement.id))
}

const actorToken = (
  context: AuthoritativeMoveRulesContext,
  actorPlacementId: string,
): SpawnedPokemon | null => context.queries.tokens.get(actorPlacementId) ?? null

const directTargeting = (
  runtime: MoveSpecV2Runtime,
): boolean => runtime.definition.spec.targeting.kind === 'single-target'
  || runtime.definition.spec.targeting.kind === 'multi-target'

/** Enumerate exact range, relationship, targetability, and sight-legal direct targets. */
export const reviewedNestedMoveLegalTargetIds = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly actorPlacementId: string
  readonly runtime: MoveSpecV2Runtime
  readonly script: MoveAutomationScript
}): readonly string[] => {
  const targeting = input.runtime.definition.spec.targeting
  const actor = actorToken(input.context, input.actorPlacementId)
  if (!actor) return Object.freeze([])
  if (targeting.kind === 'self') return Object.freeze([input.actorPlacementId])
  if (!directTargeting(input.runtime)) return Object.freeze([])

  const parsedRange = targeting.maxTargets > 1
    ? parseExplicitMultiTargetMoveRangeMeters(input.script.range)
    : parseSingleTargetMoveRangeMeters(input.script.range, {
        focusSkillRankValue: actor.focusSkillRankValue,
      })
  const unrestricted = /(?:^|,)\s*Any(?:\s|,|$)/i.test(input.script.range)
    || (parsedRange === null && /\bTrigger\b/i.test(input.script.range))
  if (parsedRange === null && !unrestricted) return Object.freeze([])

  const tokens = input.context.queries.tokens.all()
  const inRange = unrestricted
    ? tokens.filter(token => token.id !== actor.id)
    : moveAutomationTargetsInRange({ user: actor, tokens, rangeMeters: parsedRange! })
  const candidateIds = inRange.filter((token) => {
    const targetability = input.context.queries.targetability.resolve({
      actorPlacementId: actor.id,
      targetPlacementId: token.id,
      attackingMoveId: input.runtime.canonicalId,
    })
    if (!targetability.targetable) return false
    const rangeLegal = unrestricted || moveAutomationTargetsInRange({
      user: actor, tokens: [token], rangeMeters: parsedRange!,
    }).length === 1 || targetability.exception?.ignoresRange === true
    return rangeLegal && input.context.queries.lineOfSight.resolve(actor.id, token.id).targetable
  }).map(token => token.id)
  const predicate = targeting.predicate ?? {
    relationship: 'any' as const,
    willingness: 'any' as const,
    excludeActor: true,
  }
  const evaluated = evaluateMoveAutomationTargetPredicates({
    actorPlacementId: actor.id,
    authoritativeCandidatePlacementIds: candidateIds,
    requestedCandidatePlacementIds: candidateIds,
    predicate,
    relationships: input.context.queries.relationships,
    states: input.context.queries.targetStates,
    targetability: input.context.queries.targetability,
    attackingMoveId: input.runtime.canonicalId,
  })
  return canonicalPlacementIds(input.context, evaluated.legalTargetPlacementIds)
}

const anchorCellsFor = (token: SpawnedPokemon): readonly GridAnchor[] => gridFootprintCells(
  token.position,
  token,
)

const uniqueCells = (values: readonly GridAnchor[]): readonly GridAnchor[] => Object.freeze([
  ...new Map(values.map(cell => [`${cell.x},${cell.y},${cell.z}`, { ...cell }])).values(),
])

/**
 * Resolve one deterministic reviewed area placement. When an anchor target is
 * supplied, the chosen geometry must legally affect that exact target. This is
 * used by Ability-invoked Moves that name a triggering combatant rather than
 * accepting client-authored geometry.
 */
export const resolveReviewedNestedMoveAreaTargeting = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly actorPlacementId: string
  readonly runtime: MoveSpecV2Runtime
  readonly script: MoveAutomationScript
  readonly anchorTargetPlacementId?: string | null
  /** Steam Engine explicitly centers its granted Smokescreen on the user. */
  readonly centerRangedBlastOnActor?: boolean
}): ReviewedNestedAreaTargetingResolution | null => {
  const targeting = input.runtime.definition.spec.targeting
  if (targeting.kind !== 'area') return null
  const actor = actorToken(input.context, input.actorPlacementId)
  if (!actor) return null
  const anchor = input.anchorTargetPlacementId
    ? input.context.queries.tokens.get(input.anchorTargetPlacementId) ?? null
    : null
  if (input.anchorTargetPlacementId && !anchor) return null
  const tokens = input.context.queries.tokens.all()
  const constraints = {
    bounds: input.context.map.dimensions,
    blockedCells: buildAllVoxelOccupancy(input.context.map.voxels),
  }
  const actorCenter = {
    x: actor.position.x + Math.floor((actor.base - 1) / 2),
    y: actor.position.y,
    z: actor.position.z + Math.floor((actor.base - 1) / 2),
  }
  const ordinaryAimCells = anchor
    ? anchorCellsFor(anchor)
    : uniqueCells(tokens.flatMap(token => anchorCellsFor(token)))
  const placements: Array<{
    readonly cells: readonly GridAnchor[]
    readonly center?: GridAnchor
    readonly acceptsActorAnchor: boolean
  }> = []
  for (const template of input.script.areaTemplates ?? []) {
    if (template.kind === 'burst' || template.kind === 'cardinally-adjacent') {
      const cells = buildMoveAutomationAreaTemplateCells({ template, user: actor, ...constraints })
      if (cells.length > 0) placements.push({ cells, acceptsActorAnchor: true })
      continue
    }
    if (template.kind === 'cone' || template.kind === 'line') {
      for (const direction of MOVE_AUTOMATION_AREA_DIRECTIONS) {
        const cells = buildMoveAutomationAreaTemplateCells({
          template, user: actor, direction, ...constraints,
        })
        if (cells.length > 0) placements.push({ cells, acceptsActorAnchor: false })
      }
      continue
    }
    if (template.kind === 'ranged-blast') {
      if (input.centerRangedBlastOnActor) {
        const cells = buildMoveAutomationAreaTemplateCells({
          template, user: actor, center: actorCenter, ...constraints,
        })
        if (cells.length > 0) placements.push({
          cells,
          center: actorCenter,
          acceptsActorAnchor: true,
        })
        continue
      }
      for (const center of ordinaryAimCells) {
        const placement = buildMoveAutomationAreaTemplatePlacementAtCenter({
          template, user: actor, tokens, center, includeEmpty: true, ...constraints,
        })
        if (placement?.cells.length) placements.push({
          cells: placement.cells,
          center,
          acceptsActorAnchor: false,
        })
      }
      continue
    }
    if (template.kind === 'close-blast') {
      for (const aimCell of ordinaryAimCells) {
        const placement = buildMoveAutomationCloseBlastPlacementAtAimCell({
          template, user: actor, tokens, aimCell, includeEmpty: true, ...constraints,
        })
        if (placement?.cells.length) placements.push({
          cells: placement.cells,
          acceptsActorAnchor: false,
        })
      }
    }
    // Pass children require an explicit movement selection and are not exposed
    // until the nested-movement saga can preserve that choice.
  }

  for (const placement of placements) {
    const geometricIds = tokensInMoveAutomationArea({
      cells: placement.cells,
      tokens,
      excludeIds: [actor.id],
    }).map(token => token.id)
    const centralCellAffectedPlacementIds = placement.center
      ? tokensInMoveAutomationArea({
          cells: [placement.center], tokens, excludeIds: [actor.id],
        }).map(token => token.id)
      : undefined
    const resolved = resolveMoveAutomationAreaTargets({
      actorPlacementId: actor.id,
      geometricallyAffectedPlacementIds: geometricIds,
      predicate: targeting.predicate ?? DEFAULT_MOVE_AUTOMATION_AREA_TARGET_PREDICATE,
      relationships: input.context.queries.relationships,
      states: input.context.queries.targetStates,
      targetability: input.context.queries.targetability,
      lineOfSight: input.context.queries.lineOfSight,
      attackingMoveId: input.runtime.canonicalId,
      ...(centralCellAffectedPlacementIds ? { centralCellAffectedPlacementIds } : {}),
    })
    const eligible = canonicalPlacementIds(input.context, resolved.eligibleTargetPlacementIds)
    if (anchor && (anchor.id === actor.id
      ? !placement.acceptsActorAnchor
      : !eligible.includes(anchor.id))) continue
    if (!anchor && input.script.damaging && eligible.length === 0) continue
    return Object.freeze({
      targetIds: eligible,
      evaluations: Object.freeze(resolved.evaluations.map(evaluation => Object.freeze({ ...evaluation }))),
    })
  }
  return null
}

/** Fail-closed availability used before an Ability response option is issued. */
export const reviewedNestedMoveInvocationAvailable = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly actorPlacementId: string
  readonly canonicalId: string
  readonly requiredTargetPlacementId?: string | null
}): boolean => {
  const runtime = input.context.queries.rules.runtimeFor(input.canonicalId)
  const script = input.context.queries.rules.reviewedScriptFor(input.canonicalId)
  if (!runtime || runtime.kind !== 'movespec-v2' || !script) return false
  const targeting = runtime.definition.spec.targeting
  if (targeting.kind === 'none' || targeting.kind === 'field' || targeting.kind === 'hazard') {
    return input.requiredTargetPlacementId == null
  }
  if (targeting.kind === 'self') {
    return input.requiredTargetPlacementId == null
      || input.requiredTargetPlacementId === input.actorPlacementId
  }
  if (targeting.kind === 'area') {
    return resolveReviewedNestedMoveAreaTargeting({
      ...input,
      runtime,
      script,
      anchorTargetPlacementId: input.requiredTargetPlacementId,
    }) !== null
  }
  const legal = reviewedNestedMoveLegalTargetIds({ ...input, runtime, script })
  return input.requiredTargetPlacementId
    ? legal.includes(input.requiredTargetPlacementId)
    : legal.length > 0
}
