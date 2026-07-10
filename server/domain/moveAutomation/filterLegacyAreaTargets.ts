import type { MoveAutomationAreaTargetRelationship } from '~/types/moveAutomation'
import type {
  MoveAutomationRelationshipReasonCode,
  MoveAutomationRelationshipResolver,
} from './relationships'

export interface LegacyAreaRelationshipExclusion {
  readonly targetPlacementId: string
  readonly reasonCode: MoveAutomationRelationshipReasonCode
}

export interface LegacyAreaRelationshipTargetResult {
  readonly eligibleTargetPlacementIds: readonly string[]
  readonly exclusions: readonly LegacyAreaRelationshipExclusion[]
}

/**
 * Apply the reviewed v1 area-target relationship declaration to authoritative
 * placement IDs. Unknown allegiance always fails closed for ally-only effects.
 */
export const filterLegacyAreaTargetsByRelationship = (options: {
  readonly actorPlacementId: string
  readonly candidateTargetPlacementIds: readonly string[]
  readonly requiredRelationship?: MoveAutomationAreaTargetRelationship
  readonly relationships: MoveAutomationRelationshipResolver
}): LegacyAreaRelationshipTargetResult => {
  if (!options.requiredRelationship) {
    return {
      eligibleTargetPlacementIds: [...options.candidateTargetPlacementIds],
      exclusions: [],
    }
  }

  const eligibleTargetPlacementIds: string[] = []
  const exclusions: LegacyAreaRelationshipExclusion[] = []
  for (const targetPlacementId of options.candidateTargetPlacementIds) {
    const relationship = options.relationships.match(
      options.actorPlacementId,
      targetPlacementId,
      options.requiredRelationship,
    )
    if (relationship.matches) {
      eligibleTargetPlacementIds.push(targetPlacementId)
      continue
    }
    exclusions.push({
      targetPlacementId,
      reasonCode: relationship.reasonCode,
    })
  }

  return { eligibleTargetPlacementIds, exclusions }
}
