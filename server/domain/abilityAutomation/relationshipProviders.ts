import {
  parseAbilityRelationshipProviders,
  resolveAbilityRelationshipProviders,
  type AbilityRelationshipFact,
  type AbilityRelationshipResolution,
} from '#shared/abilityAutomation/relationshipProviders'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { createMoveAutomationLineOfSightResolver } from '../moveAutomation/lineOfSight'
import { createMoveAutomationBarriersAndSmokeResolver } from '../moveAutomation/barriersAndSmoke'
import type { AuthoritativeAbilityContext } from './context'

export class AuthoritativeAbilityRelationshipProviderError extends Error {
  constructor(readonly code:
    | 'source-placement-missing' | 'source-token-missing' | 'source-ability-inactive'
    | 'actor-mismatch' | 'target-unavailable', detail: string) {
    super(detail)
    this.name = 'AuthoritativeAbilityRelationshipProviderError'
  }
}
const fail = (code: AuthoritativeAbilityRelationshipProviderError['code'], detail: string): never => {
  throw new AuthoritativeAbilityRelationshipProviderError(code, detail)
}
const intervalOverlaps = (leftStart: number, leftSize: number, rightStart: number, rightSize: number): boolean => (
  leftStart <= rightStart + rightSize - 1 && rightStart <= leftStart + leftSize - 1
)
const cardinallyAdjacent = (left: AuthoritativeAbilityContext['tokens'][number], right: AuthoritativeAbilityContext['tokens'][number]): boolean => {
  const axes = [
    [left.position.x, left.base, right.position.x, right.base,
      intervalOverlaps(left.position.y, left.clearance, right.position.y, right.clearance),
      intervalOverlaps(left.position.z, left.base, right.position.z, right.base)],
    [left.position.y, left.clearance, right.position.y, right.clearance,
      intervalOverlaps(left.position.x, left.base, right.position.x, right.base),
      intervalOverlaps(left.position.z, left.base, right.position.z, right.base)],
    [left.position.z, left.base, right.position.z, right.base,
      intervalOverlaps(left.position.x, left.base, right.position.x, right.base),
      intervalOverlaps(left.position.y, left.clearance, right.position.y, right.clearance)],
  ] as const
  return axes.some(([leftStart, leftSize, rightStart, rightSize, overlapA, overlapB]) => {
    const leftEnd = leftStart + leftSize - 1
    const rightEnd = rightStart + rightSize - 1
    return overlapA && overlapB
      && (Math.abs(leftEnd - rightStart) === 1 || Math.abs(rightEnd - leftStart) === 1)
  })
}

/** Build all relation, distance, cardinal adjacency, and LOS facts from the frozen map. */
export const resolveAuthoritativeAbilityRelationshipProviders = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly providers: unknown
  readonly fact: AbilityRelationshipFact
}): AbilityRelationshipResolution => {
  const providers = parseAbilityRelationshipProviders(input.providers)
  if (input.fact.actorPlacementId !== input.context.actor.placement.id) {
    fail('actor-mismatch', 'Relationship provider actor differs from the selected actor.')
  }
  if (input.fact.targetPlacementIds.some(id => !input.context.targets.some(target => target.placement.id === id))) {
    fail('target-unavailable', 'Relationship provider target was not selected.')
  }
  for (const provider of providers) {
    if (!input.context.queries.placements.get(provider.sourcePlacementId)) {
      fail('source-placement-missing', `Relationship provider ${provider.providerId} source is missing.`)
    }
    if (!input.context.queries.tokens.get(provider.sourcePlacementId)) {
      fail('source-token-missing', `Relationship provider ${provider.providerId} source token is missing.`)
    }
    if (!input.context.queries.effectiveAbilities.activeForPlacement(provider.sourcePlacementId)
      .some(ability => ability.instanceId === provider.abilityInstanceId
        && ability.canonicalId === provider.canonicalId)) {
      fail('source-ability-inactive', `Relationship provider ${provider.providerId} source ability is inactive.`)
    }
  }
  const tokens = new Map(input.context.tokens.map(token => [token.id, token]))
  const obscuration = createMoveAutomationBarriersAndSmokeResolver({
    map: input.context.map,
    placements: input.context.tokens.map(token => ({
      id: token.id, position: token.position, base: token.base, clearance: token.clearance,
    })),
  })
  const lineOfSight = createMoveAutomationLineOfSightResolver({
    voxels: input.context.map.voxels ?? [],
    placements: input.context.tokens.map(token => ({
      id: token.id, position: token.position, base: token.base, clearance: token.clearance,
    })),
    barrierCells: obscuration.barrierSightCells(),
  })
  const tokenPair = (leftId: string, rightId: string) => {
    const left = tokens.get(leftId)
    const right = tokens.get(rightId)
    return left && right ? [left, right] as const : null
  }
  return resolveAbilityRelationshipProviders({
    providers,
    fact: input.fact,
    placementIds: input.context.placements.map(placement => placement.id),
    sideId: placementId => input.context.queries.relationships.sideId(placementId),
    relation: (left, right) => input.context.queries.relationships.relation(left, right),
    distance: (left, right) => {
      const pair = tokenPair(left, right)
      return pair ? ptuGridDistanceBetweenFootprints(pair[0], pair[1]) : null
    },
    cardinallyAdjacent: (left, right) => {
      const pair = tokenPair(left, right)
      return pair ? cardinallyAdjacent(pair[0], pair[1]) : false
    },
    lineOfSight: (left, right) => lineOfSight.resolve(left, right).targetable,
  })
}
