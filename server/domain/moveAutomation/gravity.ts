import {
  GRAVITY_ACCURACY_ROLL_BONUS,
  GRAVITY_MAX_AERIAL_END_ALTITUDE_METERS,
} from '#shared/moveAutomation/globalFields'
import type { EncounterSideId } from '#shared/moveAutomation/encounterState'
import type {
  EffectiveMovementProfile,
  MovementCapabilityKey,
  MovementGroundingState,
} from '~/types/movement'
import type { SheetPlacement } from '~/types/map'
import type { AuthoritativeRoomInstance, MoveAutomationRoomResolver } from './rooms'

export interface GravityFieldIdentity {
  readonly zoneId: string
  readonly source: AuthoritativeRoomInstance['source']
  readonly sourceSideId: EncounterSideId | null
}

export interface GravityGroundingResolution {
  readonly placementId: string
  readonly grounding: MovementGroundingState
  readonly changed: boolean
  readonly source: GravityFieldIdentity | null
  readonly reasonCode:
    | 'gravity.grounding-applied'
    | 'gravity.grounding-already-grounded'
    | 'gravity.grounding-not-applicable'
    | 'gravity.inactive'
}

export interface GravityAccuracyResolution {
  readonly bonus: number
  readonly source: GravityFieldIdentity | null
  readonly reasonCode: 'gravity.accuracy-bonus' | 'gravity.inactive'
}

export interface GravityMovementResolution {
  readonly allowed: boolean
  readonly maximumAerialEndAltitude: number | null
  readonly source: GravityFieldIdentity | null
  readonly reasonCode:
    | 'gravity.aerial-endpoint-blocked'
    | 'gravity.aerial-endpoint-allowed'
    | 'gravity.movement-not-applicable'
    | 'gravity.inactive'
}

export interface GravityGroundInteractionResolution {
  readonly applies: boolean
  readonly neutralizesFlyingResistance: boolean
  readonly suppressesLevitateResistance: boolean
  readonly suppressesGroundsourceImmunity: boolean
  readonly source: GravityFieldIdentity | null
  readonly reasonCode: 'gravity.ground-interaction-applied' | 'gravity.ground-interaction-not-applicable'
}

export interface MoveAutomationGravityResolver {
  active(): GravityFieldIdentity | null
  grounding(input: {
    readonly placementId: string
    readonly base: MovementGroundingState
  }): GravityGroundingResolution
  accuracy(): GravityAccuracyResolution
  movement(input: {
    readonly placementId: string
    readonly capabilityKeys: readonly MovementCapabilityKey[]
    readonly destinationAirHeight: number
  }): GravityMovementResolution
  groundInteraction(input: {
    readonly placementId: string
    readonly moveType: string
  }): GravityGroundInteractionResolution
  projectMovementProfile(input: {
    readonly placementId: string
    readonly profile: EffectiveMovementProfile
  }): EffectiveMovementProfile
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const identityFor = (room: AuthoritativeRoomInstance | null): GravityFieldIdentity | null => (
  room
    ? deepFreeze({
        zoneId: room.zoneId,
        source: room.source,
        sourceSideId: room.sideId,
      })
    : null
)

/**
 * Resolve Gravity from the same active global-field projection as Rooms. Its
 * compatibility storage category is `room`, but every mechanic retains Gravity
 * reason codes and never treats it as Trick/Wonder/Magic Room behavior.
 */
export const createMoveAutomationGravityResolver = (input: {
  readonly placements: readonly SheetPlacement[]
  readonly rooms: MoveAutomationRoomResolver
}): MoveAutomationGravityResolver => {
  const placements = new Map(input.placements.map(placement => [placement.id, placement]))
  const gravity = identityFor(input.rooms.active().find(room => room.kind === 'gravity') ?? null)
  const affectedPokemon = (placementId: string): SheetPlacement | null => {
    const placement = placements.get(placementId) ?? null
    return placement?.sheetKind === 'pokemon' ? placement : null
  }

  const grounding = (query: {
    readonly placementId: string
    readonly base: MovementGroundingState
  }): GravityGroundingResolution => {
    if (!gravity) {
      return deepFreeze({
        placementId: query.placementId,
        grounding: query.base,
        changed: false,
        source: null,
        reasonCode: 'gravity.inactive',
      })
    }
    if (!affectedPokemon(query.placementId)) {
      return deepFreeze({
        placementId: query.placementId,
        grounding: query.base,
        changed: false,
        source: gravity,
        reasonCode: 'gravity.grounding-not-applicable',
      })
    }
    return deepFreeze({
      placementId: query.placementId,
      grounding: 'grounded',
      changed: query.base !== 'grounded',
      source: gravity,
      reasonCode: query.base === 'grounded'
        ? 'gravity.grounding-already-grounded'
        : 'gravity.grounding-applied',
    })
  }

  return Object.freeze({
    active: () => gravity,
    grounding,
    accuracy: (): GravityAccuracyResolution => deepFreeze(gravity
      ? {
          bonus: GRAVITY_ACCURACY_ROLL_BONUS,
          source: gravity,
          reasonCode: 'gravity.accuracy-bonus',
        }
      : { bonus: 0, source: null, reasonCode: 'gravity.inactive' }),
    movement: (query): GravityMovementResolution => {
      if (!gravity) {
        return deepFreeze({
          allowed: true,
          maximumAerialEndAltitude: null,
          source: null,
          reasonCode: 'gravity.inactive',
        })
      }
      if (!affectedPokemon(query.placementId)) {
        return deepFreeze({
          allowed: true,
          maximumAerialEndAltitude: null,
          source: gravity,
          reasonCode: 'gravity.movement-not-applicable',
        })
      }
      const usesRestrictedCapability = query.capabilityKeys.some(
        capability => capability === 'sky' || capability === 'levitate',
      )
      const allowed = !usesRestrictedCapability
        || query.destinationAirHeight <= GRAVITY_MAX_AERIAL_END_ALTITUDE_METERS
      return deepFreeze({
        allowed,
        maximumAerialEndAltitude: GRAVITY_MAX_AERIAL_END_ALTITUDE_METERS,
        source: gravity,
        reasonCode: allowed
          ? 'gravity.aerial-endpoint-allowed'
          : 'gravity.aerial-endpoint-blocked',
      })
    },
    groundInteraction: (query): GravityGroundInteractionResolution => {
      const applies = Boolean(
        gravity
        && affectedPokemon(query.placementId)
        && query.moveType.trim().toLowerCase() === 'ground',
      )
      return deepFreeze({
        applies,
        neutralizesFlyingResistance: applies,
        suppressesLevitateResistance: applies,
        suppressesGroundsourceImmunity: applies,
        source: applies ? gravity : null,
        reasonCode: applies
          ? 'gravity.ground-interaction-applied'
          : 'gravity.ground-interaction-not-applicable',
      })
    },
    projectMovementProfile: (query): EffectiveMovementProfile => {
      const resolved = grounding({
        placementId: query.placementId,
        base: query.profile.state.grounding,
      })
      if (!resolved.changed) return query.profile
      return deepFreeze({
        ...query.profile,
        speeds: { ...query.profile.speeds },
        traits: {
          ...query.profile.traits,
          jump: { ...query.profile.traits.jump },
        },
        state: { ...query.profile.state, grounding: resolved.grounding },
        modes: query.profile.modes.map(mode => ({ ...mode })),
        sourceEffectIds: [...query.profile.sourceEffectIds],
      })
    },
  })
}
