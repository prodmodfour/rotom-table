import {
  worldSpriteStateNeedsAnimationFrame,
  type WorldSpriteAnimationState,
} from './worldSpriteAssets'

export interface MovementPreviewAnimationState {
  /** Whether any movement-preview visual is currently shown in the scene. */
  visible: boolean
  /** The ghost sprite that may need sprite-sheet animation while the preview is visible. */
  ghostSpriteState: WorldSpriteAnimationState | null
}

export const createMovementPreviewAnimationState = (
  visible: boolean,
  ghostSpriteState: WorldSpriteAnimationState | null | undefined,
): MovementPreviewAnimationState => ({
  visible: visible === true,
  ghostSpriteState: ghostSpriteState ?? null,
})

export const movementPreviewAnimationStateNeedsFrame = (
  state: MovementPreviewAnimationState | null | undefined,
): boolean => Boolean(
  state?.visible && worldSpriteStateNeedsAnimationFrame(state.ghostSpriteState),
)
