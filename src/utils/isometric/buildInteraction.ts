import type { MapVoxelV2, VoxelMaterial } from '~/types/map'
import type { BuildTool } from '#shared/mapEditor'
import type { BuildTarget } from '~/utils/isometric/types'
import {
  createBuildVoxelPlacement,
  resolveBuildVoxelRenderStyle,
} from '~/utils/isometric/buildVoxels'

export type BuildPointerEvent = MouseEvent | PointerEvent
export type BuildPointerCoords = Pick<BuildPointerEvent, 'clientX' | 'clientY'>

export interface BuildInteractionState {
  buildMode: boolean
  buildTool: BuildTool
  buildMaterial: VoxelMaterial
  buildColor: string | null
  buildGhostVoxel: boolean
}

export interface BuildInteractionGhostOptions {
  buildMode: boolean
  styleForCell: (cell?: { x: number; y: number; z: number }) => ReturnType<typeof resolveBuildVoxelRenderStyle>
}

export interface BuildInteractionDependencies {
  getState: () => BuildInteractionState
  pickTarget: (event: BuildPointerEvent, tool: BuildTool) => BuildTarget | null
  updateGhost: (target: BuildTarget | null, options: BuildInteractionGhostOptions) => void
  hideGhost: () => void
  placeVoxel: (voxel: MapVoxelV2) => void
  removeVoxel: (cell: { x: number; y: number; z: number }) => void
}

export const createIsometricBuildInteractionController = (
  dependencies: BuildInteractionDependencies,
) => {
  const styleForCell = (cell?: { x: number; y: number; z: number }) => {
    const state = dependencies.getState()
    return resolveBuildVoxelRenderStyle({
      material: state.buildMaterial,
      color: state.buildColor,
      cell,
    })
  }

  const updateGhost = (target: BuildTarget | null) => {
    dependencies.updateGhost(target, {
      buildMode: dependencies.getState().buildMode,
      styleForCell,
    })
  }

  const updatePreviewFromPointer = (event: BuildPointerEvent) => {
    const state = dependencies.getState()
    if (!state.buildMode) {
      dependencies.hideGhost()
      return
    }

    updateGhost(dependencies.pickTarget(event, state.buildTool))
  }

  const replayPreview = (coords: BuildPointerCoords | null) => {
    if (!dependencies.getState().buildMode || !coords) return
    updatePreviewFromPointer(coords as BuildPointerEvent)
  }

  const performAction = (event: BuildPointerEvent, tool: BuildTool) => {
    const target = dependencies.pickTarget(event, tool)
    if (!target) return

    if (target.action === 'remove') {
      dependencies.removeVoxel(target.cell)
      return
    }

    if (!target.valid) return

    const state = dependencies.getState()
    dependencies.placeVoxel(createBuildVoxelPlacement({
      material: state.buildMaterial,
      color: state.buildColor,
      cell: target.cell,
      ghost: state.buildGhostVoxel,
    }))
  }

  return {
    styleForCell,
    updateGhost,
    updatePreviewFromPointer,
    replayPreview,
    performAction,
  }
}
