export const INVENTORY_CONTINUATION_ACTIONS = ['use', 'equip', 'give', 'transfer'] as const
export type InventoryContinuationAction = (typeof INVENTORY_CONTINUATION_ACTIONS)[number]

export interface InventoryContinuationRouteIntent {
  readonly action: InventoryContinuationAction
  readonly sourceSelectionId: string
  readonly itemActorSelectionId: string | null
}

const SOURCE_RE = /^inventory-source:v1:[a-f0-9]{32}$/u
const GROUP_ACTOR_RE = /^group-item-actor:v1:[a-f0-9]{32}$/u
const ACTIONS = new Set<string>(INVENTORY_CONTINUATION_ACTIONS)
const scalar = (value: unknown): string | null => typeof value === 'string' ? value : null

export const parseInventoryContinuationRouteIntent = (
  query: Readonly<Record<string, unknown>>,
): InventoryContinuationRouteIntent | null => {
  const action = scalar(query.inventoryAction)
  const sourceSelectionId = scalar(query.inventorySource)
  const itemActorSelectionId = query.itemActor === undefined ? null : scalar(query.itemActor)
  if (!action || !ACTIONS.has(action) || !sourceSelectionId || !SOURCE_RE.test(sourceSelectionId)) return null
  if (itemActorSelectionId !== null && !GROUP_ACTOR_RE.test(itemActorSelectionId)) return null
  return Object.freeze({
    action: action as InventoryContinuationAction,
    sourceSelectionId,
    itemActorSelectionId,
  })
}
