import type { EncounterSideId } from '#shared/moveAutomation/encounterState'
import type {
  EffectiveMovementProfile,
  MovementCapabilityKey,
  MovementGroundingState,
} from '~/types/movement'
import type { SheetPlacement } from '~/types/map'
import type {
  GravityFieldResolution,
  MoveAutomationRemainingGlobalFieldResolver,
} from './remainingGlobalFields'
import type { AuthoritativeRoomInstance } from './rooms'

export interface GravityFieldIdentity {
  readonly zoneId: string
  readonly source: AuthoritativeRoomInstance['source']
  readonly sourceSideId: EncounterSideId | null
  readonly duration: AuthoritativeRoomInstance['duration']
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

export interface GravityGroundingQuery {
  readonly placementId: string
  readonly base: MovementGroundingState
}

export interface GravityMovementQuery {
  readonly placementId: string
  readonly capabilityKeys: readonly MovementCapabilityKey[]
  readonly destinationAirHeight: number
}

export interface GravityGroundInteractionQuery {
  readonly placementId: string
  readonly moveType: string
}

export interface GravityMovementProfileQuery {
  readonly placementId: string
  readonly profile: EffectiveMovementProfile
}

export interface MoveAutomationGravityResolver {
  active(): GravityFieldIdentity | null
  grounding(input: GravityGroundingQuery): GravityGroundingResolution
  accuracy(): GravityAccuracyResolution
  movement(input: GravityMovementQuery): GravityMovementResolution
  groundInteraction(input: GravityGroundInteractionQuery): GravityGroundInteractionResolution
  projectMovementProfile(input: GravityMovementProfileQuery): EffectiveMovementProfile
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const identityFor = (field: GravityFieldResolution): GravityFieldIdentity | null => {
  const room = field.field.active ? field.field.instance : null
  return room
    ? deepFreeze({
        zoneId: room.zoneId,
        source: room.source,
        sourceSideId: room.sideId,
        duration: room.duration,
      })
    : null
}

/**
 * Apply the read-only Gravity overlay selected by the global-field query seam.
 * Its compatibility storage category is `room`, but consumers never inspect or
 * mutate that storage and every result retains Gravity-specific evidence.
 */
export const createMoveAutomationGravityResolver = (input: {
  readonly placements: readonly SheetPlacement[]
  readonly globalFields: MoveAutomationRemainingGlobalFieldResolver
}): MoveAutomationGravityResolver => {
  const placements = new Map(input.placements.map(placement => [placement.id, placement]))
  const field = input.globalFields.gravity()
  const gravity = identityFor(field)
  const overlay = field.overlay
  const affectedPokemon = (placementId: string): SheetPlacement | null => {
    const placement = placements.get(placementId) ?? null
    return placement?.sheetKind === 'pokemon' ? placement : null
  }

  const grounding = (query: GravityGroundingQuery): GravityGroundingResolution => {
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
          bonus: overlay.accuracyRollBonus,
          source: gravity,
          reasonCode: 'gravity.accuracy-bonus',
        }
      : { bonus: 0, source: null, reasonCode: 'gravity.inactive' }),
    movement: (query: GravityMovementQuery): GravityMovementResolution => {
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
      const maximumAerialEndAltitude = overlay.maximumAerialEndAltitudeMeters
      const allowed = !usesRestrictedCapability
        || maximumAerialEndAltitude === null
        || query.destinationAirHeight <= maximumAerialEndAltitude
      return deepFreeze({
        allowed,
        maximumAerialEndAltitude,
        source: gravity,
        reasonCode: allowed
          ? 'gravity.aerial-endpoint-allowed'
          : 'gravity.aerial-endpoint-blocked',
      })
    },
    groundInteraction: (query: GravityGroundInteractionQuery): GravityGroundInteractionResolution => {
      const applies = Boolean(
        gravity
        && affectedPokemon(query.placementId)
        && query.moveType.trim().toLowerCase() === 'ground',
      )
      return deepFreeze({
        applies,
        neutralizesFlyingResistance: applies && overlay.neutralizesFlyingGroundResistance,
        suppressesLevitateResistance: applies && overlay.suppressesLevitateGroundResistance,
        suppressesGroundsourceImmunity: applies && overlay.suppressesGroundsourceImmunity,
        source: applies ? gravity : null,
        reasonCode: applies
          ? 'gravity.ground-interaction-applied'
          : 'gravity.ground-interaction-not-applicable',
      })
    },
    projectMovementProfile: (query: GravityMovementProfileQuery): EffectiveMovementProfile => {
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
