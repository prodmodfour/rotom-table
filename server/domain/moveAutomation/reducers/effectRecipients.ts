import type {
  MoveEffectOperation,
  MoveEffectRecipientSelectorKind,
} from '#shared/moveAutomation/effects'
import type { AuthoritativeMoveRulesContext } from '../context'
import { resolveMoveEffectCompoundRecipientIds } from '../effectRecipientQueries'

export interface MoveEffectDynamicRecipientSets {
  readonly attackedTargetIds: readonly string[]
  readonly hitTargetIds: readonly string[]
  readonly missedTargetIds: readonly string[]
  readonly damagedTargetIds: readonly string[]
  readonly faintedTargetIds: readonly string[]
}

const DYNAMIC_RECIPIENT_KINDS = new Set<MoveEffectRecipientSelectorKind>([
  'attacked-targets',
  'hit-targets',
  'missed-targets',
  'damaged-targets',
  'fainted-targets',
])

type DynamicRecipientKind = Extract<MoveEffectRecipientSelectorKind,
  | 'attacked-targets'
  | 'hit-targets'
  | 'missed-targets'
  | 'damaged-targets'
  | 'fainted-targets'
>

export type ResolvedMoveEffectDynamicRecipients = Readonly<
  Record<DynamicRecipientKind, readonly string[]>
>

export type MoveEffectRecipientFailureCode =
  | 'invalid-recipient-set'
  | 'recipient-not-found'

export type FailMoveEffectRecipientResolution = (
  code: MoveEffectRecipientFailureCode,
  message: string,
) => never

export const moveEffectRecipientIdsEqual = (
  left: readonly string[],
  right: readonly string[],
): boolean => left.length === right.length
  && left.every((value, index) => value === right[index])

export const canonicalMoveEffectPlacementIds = (
  context: AuthoritativeMoveRulesContext,
  ids: readonly string[],
  label: string,
  fail: FailMoveEffectRecipientResolution,
): readonly string[] => {
  if (!Array.isArray(ids)) return fail('invalid-recipient-set', `${label} must be an array.`)

  const requested = new Set<string>()
  for (const id of ids) {
    if (typeof id !== 'string' || !id.trim()) {
      return fail('invalid-recipient-set', `${label} contains an invalid placement ID.`)
    }
    if (requested.has(id)) {
      return fail('invalid-recipient-set', `${label} duplicates placement ${id}.`)
    }
    requested.add(id)
  }

  const ordered: string[] = []
  for (const placement of context.queries.placements.all()) {
    if (!requested.delete(placement.id)) continue
    ordered.push(placement.id)
  }
  if (requested.size > 0) {
    return fail(
      'recipient-not-found',
      `${label} references missing placement ${[...requested].sort()[0]}.`,
    )
  }
  return ordered
}

export const resolveMoveEffectDynamicRecipients = (
  context: AuthoritativeMoveRulesContext,
  source: MoveEffectDynamicRecipientSets,
  fail: FailMoveEffectRecipientResolution,
): ResolvedMoveEffectDynamicRecipients => ({
  'attacked-targets': canonicalMoveEffectPlacementIds(
    context,
    source.attackedTargetIds,
    'attackedTargetIds',
    fail,
  ),
  'hit-targets': canonicalMoveEffectPlacementIds(
    context,
    source.hitTargetIds,
    'hitTargetIds',
    fail,
  ),
  'missed-targets': canonicalMoveEffectPlacementIds(
    context,
    source.missedTargetIds,
    'missedTargetIds',
    fail,
  ),
  'damaged-targets': canonicalMoveEffectPlacementIds(
    context,
    source.damagedTargetIds,
    'damagedTargetIds',
    fail,
  ),
  'fainted-targets': canonicalMoveEffectPlacementIds(
    context,
    source.faintedTargetIds,
    'faintedTargetIds',
    fail,
  ),
})

export const expectedMoveEffectRecipientIds = (
  context: AuthoritativeMoveRulesContext,
  operation: Pick<MoveEffectOperation, 'recipients'>,
  dynamic: ResolvedMoveEffectDynamicRecipients,
  fail: FailMoveEffectRecipientResolution,
): readonly string[] => {
  const kind = operation.recipients.kind
  const compoundIds = resolveMoveEffectCompoundRecipientIds(context, {
    attackedTargetIds: dynamic['attacked-targets'],
    hitTargetIds: dynamic['hit-targets'],
  }, kind)
  if (compoundIds !== null) return compoundIds
  if (DYNAMIC_RECIPIENT_KINDS.has(kind)) return dynamic[kind as DynamicRecipientKind]
  if (kind === 'none') return []
  if (kind === 'actor' || kind === 'source-placement') return [context.actor.placement.id]
  if (kind === 'selected-targets') {
    return canonicalMoveEffectPlacementIds(
      context,
      context.selectedPlacements.map(({ id }) => id),
      'selected targets',
      fail,
    )
  }
  if (kind === 'area-targets') {
    // Geometry, reviewed predicates, and explicit Friendly exclusions have
    // already produced the interpreter-owned attacked set. The broader scope
    // candidates must never be reintroduced during reduction.
    return dynamic['attacked-targets']
  }
  if (kind === 'all-placements') {
    return context.queries.placements.all().map(({ id }) => id)
  }
  return fail('invalid-recipient-set', `Recipient selector ${kind} is unsupported.`)
}
