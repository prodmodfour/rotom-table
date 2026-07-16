import type { EncounterSideId } from '#shared/moveAutomation/encounterState'
import type { EncounterZone } from '#shared/moveAutomation/encounterZones'
import type { MoveAutomationTargetGrounding } from './targetState'
import type { BattlefieldZoneEntryHandlerDefinition } from './battlefieldZoneDefinitions'

export interface BattlefieldZoneMovementSubject {
  readonly placementId: string
  readonly sideId: EncounterSideId | null
  readonly grounding: MoveAutomationTargetGrounding
  readonly typeIds: readonly string[]
}

export type BattlefieldZoneEntryEligibilityOutcome =
  | 'eligible'
  | 'source-immune'
  | 'relationship-unknown'
  | 'not-grounded'
  | 'type-immune'
  | 'absorbed'

export interface BattlefieldZoneEntryEligibility {
  readonly outcome: BattlefieldZoneEntryEligibilityOutcome
  readonly matchedTypeId: string | null
}

const sourcePlacementId = (zone: EncounterZone): string | null => (
  zone.source.kind === 'operation' ? zone.source.placementId : null
)

const firstMatchingType = (
  subject: BattlefieldZoneMovementSubject,
  typeIds: readonly string[],
): string | null => typeIds.find(typeId => subject.typeIds.includes(typeId)) ?? null

/**
 * Resolve source-side, grounding, and type gates from authoritative identities.
 * Enemy-owned mechanics fail closed when either side is unavailable.
 */
export const evaluateBattlefieldZoneEntryEligibility = (input: {
  readonly zone: EncounterZone
  readonly definition: BattlefieldZoneEntryHandlerDefinition
  readonly subject: BattlefieldZoneMovementSubject
}): BattlefieldZoneEntryEligibility => {
  const { zone, definition, subject } = input

  if (definition.targetPolicy === 'enemy') {
    if (sourcePlacementId(zone) === subject.placementId) {
      return { outcome: 'source-immune', matchedTypeId: null }
    }
    if (zone.sideId === null || subject.sideId === null) {
      return { outcome: 'relationship-unknown', matchedTypeId: null }
    }
    if (zone.sideId === subject.sideId) {
      return { outcome: 'source-immune', matchedTypeId: null }
    }
  }

  if (definition.grounding === 'grounded' && subject.grounding !== 'grounded') {
    return { outcome: 'not-grounded', matchedTypeId: null }
  }

  const absorbingTypeId = firstMatchingType(subject, definition.absorbingTypeIds)
  if (absorbingTypeId !== null) {
    return { outcome: 'absorbed', matchedTypeId: absorbingTypeId }
  }

  const immuneTypeId = firstMatchingType(subject, definition.immuneTypeIds)
  if (immuneTypeId !== null) {
    return { outcome: 'type-immune', matchedTypeId: immuneTypeId }
  }

  return { outcome: 'eligible', matchedTypeId: null }
}
