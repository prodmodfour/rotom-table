export interface MapPageTableActionDispatchResult {
  readonly dispatched: boolean
}

export interface MapPageAbilityActionEvent {
  readonly userId: string
  readonly abilityName: string
  readonly targetTokenId?: string
}

export interface MapPageManeuverActionEvent {
  readonly userId: string
  readonly maneuverName: string
  readonly targetTokenId?: string
}

export interface MapPageOrderActionEvent {
  readonly userId: string
  readonly orderName: string
  readonly targetTokenId?: string
}

export interface MapPageTableActionLiveCommands {
  readonly useAbility: (payload: {
    placementId: string
    abilityName: string
    targetPlacementId?: string
  }) => Promise<MapPageTableActionDispatchResult>
  readonly useManeuver: (payload: {
    placementId: string
    maneuverName: string
    targetPlacementId?: string
  }) => Promise<MapPageTableActionDispatchResult>
  readonly useOrder: (payload: {
    placementId: string
    orderName: string
    targetPlacementId?: string
  }) => Promise<MapPageTableActionDispatchResult>
}

export interface UseMapPageTableActionDispatchersOptions {
  readonly isSetupEditMode: () => boolean
  readonly livePlayCommands: MapPageTableActionLiveCommands
}

export interface UseMapPageTableActionDispatchersReturn {
  readonly dispatchAbilityUse: (event: MapPageAbilityActionEvent) => Promise<boolean> | undefined
  readonly dispatchManeuverUse: (event: MapPageManeuverActionEvent) => Promise<boolean> | undefined
  readonly dispatchOrderUse: (event: MapPageOrderActionEvent) => Promise<boolean> | undefined
}

const commandAccepted = async (command: Promise<MapPageTableActionDispatchResult>): Promise<boolean> => {
  try {
    const result = await command
    return result.dispatched === true
  } catch {
    return false
  }
}

export const useMapPageTableActionDispatchers = ({
  isSetupEditMode,
  livePlayCommands,
}: UseMapPageTableActionDispatchersOptions): UseMapPageTableActionDispatchersReturn => {
  const shouldUseLiveTableActionRoutes = (): boolean => !isSetupEditMode()

  const dispatchAbilityUse = (event: MapPageAbilityActionEvent): Promise<boolean> | undefined => {
    if (!shouldUseLiveTableActionRoutes()) return undefined
    return commandAccepted(livePlayCommands.useAbility({
      placementId: event.userId,
      abilityName: event.abilityName,
      ...(event.targetTokenId ? { targetPlacementId: event.targetTokenId } : {}),
    }))
  }

  const dispatchManeuverUse = (event: MapPageManeuverActionEvent): Promise<boolean> | undefined => {
    if (!shouldUseLiveTableActionRoutes()) return undefined
    return commandAccepted(livePlayCommands.useManeuver({
      placementId: event.userId,
      maneuverName: event.maneuverName,
      ...(event.targetTokenId ? { targetPlacementId: event.targetTokenId } : {}),
    }))
  }

  const dispatchOrderUse = (event: MapPageOrderActionEvent): Promise<boolean> | undefined => {
    if (!shouldUseLiveTableActionRoutes()) return undefined
    return commandAccepted(livePlayCommands.useOrder({
      placementId: event.userId,
      orderName: event.orderName,
      ...(event.targetTokenId ? { targetPlacementId: event.targetTokenId } : {}),
    }))
  }

  return {
    dispatchAbilityUse,
    dispatchManeuverUse,
    dispatchOrderUse,
  }
}
