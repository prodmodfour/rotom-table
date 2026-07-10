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
import {
  canonicalMoveEffectPlacementIds,
  expectedMoveEffectRecipientIds,
  moveEffectRecipientIdsEqual,
  resolveMoveEffectDynamicRecipients,
  type ResolvedMoveEffectDynamicRecipients,
} from './effectRecipients'

export type ResolvedMoveCoreTokenDynamicRecipients = ResolvedMoveEffectDynamicRecipients

export const moveCoreTokenRecipientIdsEqual = moveEffectRecipientIdsEqual

export const canonicalMoveCoreTokenPlacementIds = (
  context: AuthoritativeMoveRulesContext,
  ids: readonly string[],
  label: string,
): readonly string[] => canonicalMoveEffectPlacementIds(
  context,
  ids,
  label,
  failMoveCoreTokenEffectReduction,
)

export const resolveMoveCoreTokenDynamicRecipients = (
  context: AuthoritativeMoveRulesContext,
  source: MoveCoreTokenDynamicRecipientSets,
): ResolvedMoveCoreTokenDynamicRecipients => resolveMoveEffectDynamicRecipients(
  context,
  source,
  failMoveCoreTokenEffectReduction,
)

export const expectedMoveCoreTokenRecipientIds = (
  context: AuthoritativeMoveRulesContext,
  operation: MoveCoreTokenEffectOperation,
  dynamic: ResolvedMoveCoreTokenDynamicRecipients,
): readonly string[] => expectedMoveEffectRecipientIds(
  context,
  operation,
  dynamic,
  failMoveCoreTokenEffectReduction,
)

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
