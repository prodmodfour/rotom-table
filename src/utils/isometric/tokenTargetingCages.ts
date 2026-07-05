import type {
  MoveAutomationFeedbackState,
  MoveAutomationTargetingOverlayState,
} from '~/types/moveAutomation'
import type {
  PokemonTacticalCageTargetingRole,
  PokemonTacticalCageTargetingState,
} from '~/utils/isometric/types'

export type TokenTargetingCageStateResolver = (tokenId: string) => PokemonTacticalCageTargetingState | null

const emptyTokenTargetingCageStateResolver: TokenTargetingCageStateResolver = () => null

const tokenTargetingCageState = (
  role: PokemonTacticalCageTargetingRole,
  accentColor: string | undefined,
): PokemonTacticalCageTargetingState => (
  accentColor ? { role, accentColor } : { role }
)

const selectedTargetIdsForTargetingOverlay = (
  targeting: MoveAutomationTargetingOverlayState,
): Set<string> => {
  if (targeting.mode === 'area-confirmation') {
    return new Set(targeting.affectedIds ?? targeting.candidateIds)
  }

  if (targeting.mode === 'target-count') {
    return new Set(targeting.selectedTargetIds ?? [])
  }

  return new Set()
}

export const createMoveTargetingTokenCageStateResolver = (
  targeting: MoveAutomationTargetingOverlayState | null | undefined,
  accentColor?: string,
): TokenTargetingCageStateResolver => {
  if (!targeting || targeting.candidateIds.length === 0) return emptyTokenTargetingCageStateResolver

  const candidateIds = new Set(targeting.candidateIds)
  const selectedIds = selectedTargetIdsForTargetingOverlay(targeting)

  return (tokenId) => {
    if (!candidateIds.has(tokenId)) return null
    const role = selectedIds.has(tokenId) ? 'selected' : 'candidate'
    return tokenTargetingCageState(role, accentColor)
  }
}

export const createMoveFeedbackTokenCageStateResolver = (
  feedback: MoveAutomationFeedbackState | null | undefined,
  accentColor?: string,
): TokenTargetingCageStateResolver => {
  if (!feedback?.targetId) return emptyTokenTargetingCageStateResolver

  return (tokenId) => (
    tokenId === feedback.targetId
      ? tokenTargetingCageState('selected', accentColor)
      : null
  )
}
