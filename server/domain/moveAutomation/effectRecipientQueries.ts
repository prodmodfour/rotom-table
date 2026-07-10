import type {
  MoveEffectRecipientSelectorKind,
} from '#shared/moveAutomation/effects'
import type { MoveAutomationAreaTemplate } from '~/types/moveAutomation'
import {
  buildMoveAutomationAreaTemplateCells,
  tokensInMoveAutomationArea,
} from '~/utils/moveAutomationAreaTemplates'
import type { AuthoritativeMoveRulesContext } from './context'

export interface MoveEffectCompoundRecipientState {
  readonly attackedTargetIds: readonly string[]
  readonly hitTargetIds: readonly string[]
}

const CARDINALLY_ADJACENT_TEMPLATE: MoveAutomationAreaTemplate = Object.freeze({
  kind: 'cardinally-adjacent',
  size: 1,
  label: 'Cardinally Adjacent Targets',
})

const placementOrder = (
  context: AuthoritativeMoveRulesContext,
  ids: ReadonlySet<string>,
): readonly string[] => context.queries.placements.all()
  .filter(placement => ids.has(placement.id))
  .map(placement => placement.id)

/**
 * Resolve the bounded compound/spatial recipient leaves that cannot be reduced
 * to one existing interpreter-owned set. Geometry and source sets are entirely
 * server-owned; no placement identity is carried by MoveSpec data.
 */
export const resolveMoveEffectCompoundRecipientIds = (
  context: AuthoritativeMoveRulesContext,
  state: MoveEffectCompoundRecipientState,
  kind: MoveEffectRecipientSelectorKind,
): readonly string[] | null => {
  if (kind === 'actor-and-attacked-targets') {
    return placementOrder(context, new Set([
      context.actor.placement.id,
      ...state.attackedTargetIds,
    ]))
  }
  if (kind !== 'cardinally-adjacent-to-hit-targets') return null
  if (state.hitTargetIds.length === 0) return []

  const tokens = context.queries.tokens.all()
  // Every footprint can affect spatial inclusion, including a non-recipient.
  // Record those sheet-derived dimensions before evaluating the geometry.
  for (const token of tokens) context.reads.recordToken(token)

  const recipientIds = new Set<string>()
  for (const sourceId of state.hitTargetIds) {
    const source = context.queries.tokens.get(sourceId)
    if (!source) continue
    const cells = buildMoveAutomationAreaTemplateCells({
      template: CARDINALLY_ADJACENT_TEMPLATE,
      user: source,
      bounds: context.map.dimensions,
    })
    for (const recipient of tokensInMoveAutomationArea({
      cells,
      tokens,
      excludeIds: [sourceId],
    })) {
      recipientIds.add(recipient.id)
    }
  }
  return placementOrder(context, recipientIds)
}
