import type * as THREE from 'three'
import type { PokemonRenderObject } from '~/utils/isometric/types'
import { updateElevationBadge } from '~/utils/isometric/tokenHud'

export interface HoverBadgeRenderObject {
  elevationBadge: { visible: boolean }
}

export interface TokenHoverControllerDependencies<TRenderObject extends HoverBadgeRenderObject> {
  getRenderObject: (id: string) => TRenderObject | undefined
  updateHoveredRenderObject: (renderObject: TRenderObject) => void
  onHoverChange?: (nextId: string | null, previousId: string | null) => void
}

export const updateHoveredPokemonElevationBadge = (
  renderObject: PokemonRenderObject,
  options: {
    groundLevelY: number
    camera: THREE.Camera | null
    show: boolean
  },
) => updateElevationBadge({
  badge: renderObject.elevationBadge,
  center: renderObject.currentCenter,
  base: renderObject.base,
  elevation: renderObject.elevation,
  groundLevelY: options.groundLevelY,
  camera: options.camera,
  show: options.show,
})

export const createIsometricTokenHoverController = <TRenderObject extends HoverBadgeRenderObject>(
  dependencies: TokenHoverControllerDependencies<TRenderObject>,
) => {
  let hoveredId: string | null = null

  const id = () => hoveredId

  const set = (nextId: string | null) => {
    if (hoveredId === nextId) return

    const previousId = hoveredId
    hoveredId = nextId

    if (previousId && previousId !== nextId) {
      const previous = dependencies.getRenderObject(previousId)
      if (previous) previous.elevationBadge.visible = false
    }

    if (nextId) {
      const next = dependencies.getRenderObject(nextId)
      if (next) dependencies.updateHoveredRenderObject(next)
    }

    dependencies.onHoverChange?.(nextId, previousId)
  }

  const clear = () => set(null)

  const clearIfHovered = (idToClear: string) => {
    if (hoveredId === idToClear) clear()
  }

  return {
    id,
    set,
    clear,
    clearIfHovered,
  }
}
