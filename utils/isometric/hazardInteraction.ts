import type { MapHazardKind, MapHazardV2 } from '~/types/map'
import type { BuildTool } from '~/shared/mapEditor'
import { createHazardPlacement, DEFAULT_ISOMETRIC_HAZARD_KIND } from '~/utils/isometric/hazardPlacement'
import type { HazardTarget } from '~/utils/isometric/types'

export type HazardPointerEvent = MouseEvent | PointerEvent
export type HazardPointerCoords = Pick<HazardPointerEvent, 'clientX' | 'clientY'>

export interface HazardInteractionState {
  hazardMode: boolean
  hazardTool: BuildTool
  hazardKind?: MapHazardKind | null
}

export interface HazardInteractionGhostOptions {
  hazardMode: boolean
  kind: MapHazardKind
}

export interface HazardInteractionDependencies {
  getState: () => HazardInteractionState
  pickTarget: (event: HazardPointerEvent, tool: BuildTool) => HazardTarget | null
  updateGhost: (target: HazardTarget | null, options: HazardInteractionGhostOptions) => void
  hideGhost: () => void
  placeHazard: (hazard: MapHazardV2) => void
  removeHazard: (cell: { x: number; y: number; z: number; kind?: MapHazardKind }) => void
}

const resolveHazardKind = (kind: MapHazardKind | null | undefined): MapHazardKind =>
  kind ?? DEFAULT_ISOMETRIC_HAZARD_KIND

export const createIsometricHazardInteractionController = (
  dependencies: HazardInteractionDependencies,
) => {
  const updateGhost = (target: HazardTarget | null) => {
    const state = dependencies.getState()
    dependencies.updateGhost(target, {
      hazardMode: state.hazardMode,
      kind: resolveHazardKind(state.hazardKind),
    })
  }

  const updatePreviewFromPointer = (event: HazardPointerEvent) => {
    const state = dependencies.getState()
    if (!state.hazardMode) {
      dependencies.hideGhost()
      return
    }

    updateGhost(dependencies.pickTarget(event, state.hazardTool))
  }

  const replayPreview = (coords: HazardPointerCoords | null) => {
    if (!dependencies.getState().hazardMode || !coords) return
    updatePreviewFromPointer(coords as HazardPointerEvent)
  }

  const performAction = (event: HazardPointerEvent, tool: BuildTool) => {
    const target = dependencies.pickTarget(event, tool)
    if (!target || !target.valid) return

    if (target.action === 'remove') {
      dependencies.removeHazard(target.cell)
      return
    }

    dependencies.placeHazard(createHazardPlacement({
      kind: dependencies.getState().hazardKind,
      cell: target.cell,
    }))
  }

  return {
    updateGhost,
    updatePreviewFromPointer,
    replayPreview,
    performAction,
  }
}
