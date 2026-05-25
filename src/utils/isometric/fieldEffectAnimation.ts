export interface FieldEffectAnimationState {
  /** Whether the field-effect render layer is currently visible. */
  visible: boolean
  /** Count of registered weather/field-effect animator callbacks. */
  activeAnimatorCount: number
}

export const createFieldEffectAnimationState = (
  visible: boolean,
  activeAnimatorCount: number,
): FieldEffectAnimationState => ({
  visible,
  activeAnimatorCount: Number.isFinite(activeAnimatorCount)
    ? Math.max(0, Math.floor(activeAnimatorCount))
    : 0,
})

export const fieldEffectAnimationStateNeedsFrame = (
  state: FieldEffectAnimationState | null | undefined,
): boolean => Boolean(state?.visible && state.activeAnimatorCount > 0)
