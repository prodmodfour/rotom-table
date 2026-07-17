import type { MoveAutomationItemEffectTiming } from './globalFields'

export const MOVE_ITEM_RULE_FAMILIES = [
  'berry',
  'plate',
  'drive',
  'memory',
  'other',
] as const

export const MOVE_ITEM_RULE_SOURCES = [
  'equipped',
  'digestion-buff',
] as const

export const MOVE_ITEM_POSSESSION_QUERIES = [
  'holding-nothing',
  'holding-item',
] as const

export const MOVE_ITEM_RULE_QUERY_LIMITS = Object.freeze({
  identifierChars: 200,
  families: MOVE_ITEM_RULE_FAMILIES.length,
})

export const MOVE_ITEM_CONTRIBUTION_QUERIES = [
  'eligible',
  'family',
  'category',
  'power',
  'move-type',
  'damage-base',
  'effect',
] as const

export type MoveItemRuleFamily = (typeof MOVE_ITEM_RULE_FAMILIES)[number]
export type MoveItemRuleSource = (typeof MOVE_ITEM_RULE_SOURCES)[number]
export type MoveItemPossessionQuery = (typeof MOVE_ITEM_POSSESSION_QUERIES)[number]
export type MoveItemContributionQuery = (typeof MOVE_ITEM_CONTRIBUTION_QUERIES)[number]
export type MoveItemRuleQuery = MoveItemPossessionQuery | MoveItemContributionQuery

export interface MoveItemContributionQueryDeclaration {
  readonly query: MoveItemContributionQuery
  readonly source: MoveItemRuleSource
  /** Non-empty reviewed filter; it never expands the server-loaded item scope. */
  readonly families: readonly MoveItemRuleFamily[]
  /** Required for equipped items and forbidden for a stored digestion buff. */
  readonly requirementId: string | null
  /** Determines benefit/use suppression policy at the authoritative overlay seam. */
  readonly timing: MoveAutomationItemEffectTiming
}
