import type { MoveEffectRecipientSelectorKind } from '#shared/moveAutomation/effects'
import type {
  AuthoritativeMoveRulesContext,
  AuthoritativeMoveSheetRead,
} from '../context'
import { failMoveCoreTokenEffectReduction } from './coreTokenEffectError'
import type {
  MoveCoreTokenDynamicRecipientSets,
  MoveCoreTokenEffectOperation,
  MoveCoreTokenEffectRecipient,
} from './coreTokenEffectTypes'

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

export type ResolvedMoveCoreTokenDynamicRecipients = Readonly<
  Record<DynamicRecipientKind, readonly string[]>
>

export const moveCoreTokenRecipientIdsEqual = (
  left: readonly string[],
  right: readonly string[],
): boolean => left.length === right.length
  && left.every((value, index) => value === right[index])

export const canonicalMoveCoreTokenPlacementIds = (
  context: AuthoritativeMoveRulesContext,
  ids: readonly string[],
  label: string,
): readonly string[] => {
  if (!Array.isArray(ids)) {
    return failMoveCoreTokenEffectReduction('invalid-recipient-set', `${label} must be an array.`)
  }
  const requested = new Set<string>()
  for (const id of ids) {
    if (typeof id !== 'string' || !id.trim()) {
      return failMoveCoreTokenEffectReduction(
        'invalid-recipient-set',
        `${label} contains an invalid placement ID.`,
      )
    }
    if (requested.has(id)) {
      return failMoveCoreTokenEffectReduction(
        'invalid-recipient-set',
        `${label} duplicates placement ${id}.`,
      )
    }
    requested.add(id)
  }

  const ordered: string[] = []
  for (const placement of context.queries.placements.all()) {
    if (!requested.delete(placement.id)) continue
    ordered.push(placement.id)
  }
  if (requested.size > 0) {
    return failMoveCoreTokenEffectReduction(
      'recipient-not-found',
      `${label} references missing placement ${[...requested].sort()[0]}.`,
    )
  }
  return ordered
}

export const resolveMoveCoreTokenDynamicRecipients = (
  context: AuthoritativeMoveRulesContext,
  source: MoveCoreTokenDynamicRecipientSets,
): ResolvedMoveCoreTokenDynamicRecipients => ({
  'attacked-targets': canonicalMoveCoreTokenPlacementIds(
    context,
    source.attackedTargetIds,
    'attackedTargetIds',
  ),
  'hit-targets': canonicalMoveCoreTokenPlacementIds(
    context,
    source.hitTargetIds,
    'hitTargetIds',
  ),
  'missed-targets': canonicalMoveCoreTokenPlacementIds(
    context,
    source.missedTargetIds,
    'missedTargetIds',
  ),
  'damaged-targets': canonicalMoveCoreTokenPlacementIds(
    context,
    source.damagedTargetIds,
    'damagedTargetIds',
  ),
  'fainted-targets': canonicalMoveCoreTokenPlacementIds(
    context,
    source.faintedTargetIds,
    'faintedTargetIds',
  ),
})

export const expectedMoveCoreTokenRecipientIds = (
  context: AuthoritativeMoveRulesContext,
  operation: MoveCoreTokenEffectOperation,
  dynamic: ResolvedMoveCoreTokenDynamicRecipients,
): readonly string[] => {
  const kind = operation.recipients.kind
  if (DYNAMIC_RECIPIENT_KINDS.has(kind)) return dynamic[kind as DynamicRecipientKind]
  if (kind === 'none') return []
  if (kind === 'actor' || kind === 'source-placement') return [context.actor.placement.id]
  if (kind === 'selected-targets') {
    return canonicalMoveCoreTokenPlacementIds(
      context,
      context.selectedPlacements.map(({ id }) => id),
      'selected targets',
    )
  }
  if (kind === 'area-targets') {
    return canonicalMoveCoreTokenPlacementIds(
      context,
      context.candidatePlacements.map(({ id }) => id),
      'area targets',
    )
  }
  return failMoveCoreTokenEffectReduction(
    'invalid-recipient-set',
    `Recipient selector ${kind} is unsupported.`,
  )
}

export const resolveMoveCoreTokenRecipient = (
  context: AuthoritativeMoveRulesContext,
  recipientId: string,
): MoveCoreTokenEffectRecipient => {
  const placement = context.queries.placements.get(recipientId)
    ?? failMoveCoreTokenEffectReduction(
      'recipient-not-found',
      `Core effect recipient ${recipientId} was not found.`,
    )
  const token = context.queries.tokens.get(recipientId)
    ?? failMoveCoreTokenEffectReduction(
      'recipient-sheet-missing',
      `Core effect recipient ${recipientId} has no resolved token.`,
    )
  const sheet = context.queries.sheets.forPlacement(placement)
    ?? failMoveCoreTokenEffectReduction(
      'recipient-sheet-missing',
      `Core effect recipient ${recipientId} has no resolved ${placement.sheetKind}/${placement.sheetSlug} sheet.`,
    )
  return { placement, token, sheet }
}

export const recordMoveCoreTokenRecipientRead = (
  reads: AuthoritativeMoveSheetRead[],
  readsByKey: Map<string, AuthoritativeMoveSheetRead>,
  recipient: MoveCoreTokenEffectRecipient,
): void => {
  const read = {
    kind: recipient.sheet.kind,
    slug: recipient.sheet.slug,
    revision: recipient.sheet.revision,
  }
  const key = `${read.kind}:${read.slug}`
  const existing = readsByKey.get(key)
  if (existing) {
    if (existing.revision !== read.revision) {
      failMoveCoreTokenEffectReduction(
        'recipient-sheet-missing',
        `Core effect observed ${read.kind}/${read.slug} at conflicting revisions.`,
      )
    }
    return
  }
  readsByKey.set(key, read)
  reads.push(read)
}
