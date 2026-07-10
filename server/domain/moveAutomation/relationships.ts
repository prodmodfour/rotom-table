import {
  encounterStateHasSide,
  type EncounterSideDirectory,
  type EncounterSideId,
} from '#shared/moveAutomation/encounterState'

export const MOVE_AUTOMATION_RELATIONSHIP_KINDS = [
  'self',
  'ally',
  'enemy',
  'unknown',
] as const

export const MOVE_AUTOMATION_RELATIONSHIP_PREDICATES = [
  'self',
  'ally',
  'enemy',
  'same-side',
  'other',
  'unknown',
] as const

export type MoveAutomationRelationshipKind =
  (typeof MOVE_AUTOMATION_RELATIONSHIP_KINDS)[number]

export type MoveAutomationRelationshipPredicate =
  (typeof MOVE_AUTOMATION_RELATIONSHIP_PREDICATES)[number]

export type MoveAutomationRelationshipReasonCode =
  | 'relationship-self'
  | 'relationship-ally'
  | 'relationship-enemy'
  | 'relationship-unknown-side'
  | 'relationship-placement-missing'

export interface MoveAutomationRelationshipPlacement {
  /** Stable authoritative map-placement identity. */
  readonly id: string
  /** Explicit map-local side identity. Omission means unknown/unaffiliated. */
  readonly sideId?: EncounterSideId
}

export interface MoveAutomationRelationshipState {
  readonly placements: readonly MoveAutomationRelationshipPlacement[]
  readonly sides: EncounterSideDirectory
}

/**
 * A reviewed targeting policy may opt broad `other`/`unknown` predicates into
 * accepting placed tokens without allegiance. It never turns unknown tokens
 * into allies or enemies, and it never permits a missing placement.
 */
export interface MoveAutomationRelationshipPolicy {
  readonly allowUnknown: boolean
}

export const DEFAULT_MOVE_AUTOMATION_RELATIONSHIP_POLICY = Object.freeze<MoveAutomationRelationshipPolicy>({
  allowUnknown: false,
})

export interface MoveAutomationRelationshipResult {
  readonly sourcePlacementId: string
  readonly targetPlacementId: string
  readonly sourceSideId: EncounterSideId | null
  readonly targetSideId: EncounterSideId | null
  readonly relationship: MoveAutomationRelationshipKind
  readonly reasonCode: MoveAutomationRelationshipReasonCode
}

export interface MoveAutomationRelationshipMatchResult
  extends MoveAutomationRelationshipResult {
  readonly predicate: MoveAutomationRelationshipPredicate
  readonly matches: boolean
}

export interface MoveAutomationRelationshipResolver {
  resolve(
    sourcePlacementId: string,
    targetPlacementId: string,
  ): MoveAutomationRelationshipResult
  match(
    sourcePlacementId: string,
    targetPlacementId: string,
    predicate: MoveAutomationRelationshipPredicate,
    policy?: MoveAutomationRelationshipPolicy,
  ): MoveAutomationRelationshipMatchResult
}

type PlacementSnapshot = Readonly<{
  id: string
  sideId: EncounterSideId | null
}>

const explicitSideId = (
  placement: MoveAutomationRelationshipPlacement,
  sides: EncounterSideDirectory,
): EncounterSideId | null => {
  const sideId = placement.sideId
  return encounterStateHasSide({ sides }, sideId) ? sideId : null
}

const frozenResult = (
  sourcePlacementId: string,
  targetPlacementId: string,
  sourceSideId: EncounterSideId | null,
  targetSideId: EncounterSideId | null,
  relationship: MoveAutomationRelationshipKind,
  reasonCode: MoveAutomationRelationshipReasonCode,
): MoveAutomationRelationshipResult => Object.freeze({
  sourcePlacementId,
  targetPlacementId,
  sourceSideId,
  targetSideId,
  relationship,
  reasonCode,
})

const resolveRelationship = (
  placements: ReadonlyMap<string, PlacementSnapshot>,
  sourcePlacementId: string,
  targetPlacementId: string,
): MoveAutomationRelationshipResult => {
  const source = placements.get(sourcePlacementId)
  const target = placements.get(targetPlacementId)

  if (!source || !target) {
    return frozenResult(
      sourcePlacementId,
      targetPlacementId,
      source?.sideId ?? null,
      target?.sideId ?? null,
      'unknown',
      'relationship-placement-missing',
    )
  }

  if (source.id === target.id) {
    return frozenResult(
      sourcePlacementId,
      targetPlacementId,
      source.sideId,
      target.sideId,
      'self',
      'relationship-self',
    )
  }

  if (source.sideId === null || target.sideId === null) {
    return frozenResult(
      sourcePlacementId,
      targetPlacementId,
      source.sideId,
      target.sideId,
      'unknown',
      'relationship-unknown-side',
    )
  }

  const relationship = source.sideId === target.sideId ? 'ally' : 'enemy'
  return frozenResult(
    sourcePlacementId,
    targetPlacementId,
    source.sideId,
    target.sideId,
    relationship,
    relationship === 'ally' ? 'relationship-ally' : 'relationship-enemy',
  )
}

const predicateMatches = (
  result: MoveAutomationRelationshipResult,
  predicate: MoveAutomationRelationshipPredicate,
  policy: MoveAutomationRelationshipPolicy,
): boolean => {
  if (predicate === 'self') return result.relationship === 'self'
  if (predicate === 'ally') return result.relationship === 'ally'
  if (predicate === 'enemy') return result.relationship === 'enemy'
  if (predicate === 'same-side') {
    return result.sourceSideId !== null
      && result.targetSideId !== null
      && result.sourceSideId === result.targetSideId
  }

  const isAllowedUnknown = policy.allowUnknown === true
    && result.relationship === 'unknown'
    && result.reasonCode === 'relationship-unknown-side'
  if (predicate === 'other') {
    return result.relationship === 'ally'
      || result.relationship === 'enemy'
      || isAllowedUnknown
  }
  if (predicate === 'unknown') return isAllowedUnknown
  return false
}

/**
 * Snapshot an authoritative placement/side directory and expose one canonical
 * relationship classification plus predicate matcher. Callers provide only
 * placement IDs; caller-authored side-bearing participant objects cannot alter
 * allegiance decisions.
 */
export const createMoveAutomationRelationshipResolver = (
  state: MoveAutomationRelationshipState,
): MoveAutomationRelationshipResolver => {
  const placements = new Map<string, PlacementSnapshot>()
  for (const placement of state.placements) {
    if (placements.has(placement.id)) continue
    placements.set(placement.id, Object.freeze({
      id: placement.id,
      sideId: explicitSideId(placement, state.sides),
    }))
  }

  const resolve = (
    sourcePlacementId: string,
    targetPlacementId: string,
  ): MoveAutomationRelationshipResult => resolveRelationship(
    placements,
    sourcePlacementId,
    targetPlacementId,
  )

  return Object.freeze({
    resolve,
    match: (
      sourcePlacementId: string,
      targetPlacementId: string,
      predicate: MoveAutomationRelationshipPredicate,
      policy: MoveAutomationRelationshipPolicy = DEFAULT_MOVE_AUTOMATION_RELATIONSHIP_POLICY,
    ): MoveAutomationRelationshipMatchResult => {
      const result = resolve(sourcePlacementId, targetPlacementId)
      return Object.freeze({
        ...result,
        predicate,
        matches: predicateMatches(result, predicate, policy),
      })
    },
  })
}
