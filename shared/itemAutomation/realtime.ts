export const ITEM_OPERATION_REALTIME_EVENT_TYPES = Object.freeze({
  PRESENTATION_INVALIDATED: 'item-operation-presentation-invalidated',
  EXTENDED_ACTION_UPDATED: 'item-extended-action-updated',
  GUIDED_REQUEST_UPDATED: 'item-guided-request-updated',
} as const)

export type ItemOperationRealtimeEventType = typeof ITEM_OPERATION_REALTIME_EVENT_TYPES[keyof typeof ITEM_OPERATION_REALTIME_EVENT_TYPES]
