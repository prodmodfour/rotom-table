import type {
  EncounterEffectDuration,
  EncounterEffectSource,
} from '#shared/moveAutomation/encounterEffects'
import {
  GRAVITY_ACCURACY_ROLL_BONUS,
  GRAVITY_MAX_AERIAL_END_ALTITUDE_METERS,
  MOVE_AUTOMATION_ITEM_EFFECT_SCOPES,
  MOVE_AUTOMATION_ITEM_EFFECT_TIMINGS,
  TAILWIND_INITIATIVE_BONUS,
  isTailwindInitiativeEffect,
  magicRoomSuppressesItemEffect,
  type MoveAutomationItemEffectScope,
  type MoveAutomationItemEffectTiming,
} from '#shared/moveAutomation/globalFields'
import {
  createEmptyEncounterState,
  isEncounterSideId,
  parseEncounterState,
  type EncounterSideId,
} from '#shared/moveAutomation/encounterState'
import type { TabletopMap } from '~/types/map'
import {
  createMoveAutomationRoomResolver,
  type AuthoritativeRoomState,
  type MoveAutomationRoomResolver,
} from './rooms'

export interface MagicRoomItemSuppressionQuery {
  readonly scope: MoveAutomationItemEffectScope
  readonly timing: MoveAutomationItemEffectTiming
}

export interface MagicRoomItemSuppressionResolution {
  readonly field: AuthoritativeRoomState
  readonly scope: MoveAutomationItemEffectScope
  readonly timing: MoveAutomationItemEffectTiming
  readonly suppressed: boolean
  readonly reasonCode:
    | 'magic-room.inactive'
    | 'magic-room.item-effect-suppressed'
    | 'magic-room.scope-exempt'
    | 'magic-room.timing-exempt'
}

/** Read-only values consumed later by movement, grounding, accuracy, and immunity seams. */
export interface GravityOverlayContract {
  readonly treatsPokemonAsGrounded: boolean
  readonly accuracyRollBonus: number
  readonly maximumAerialEndAltitudeMeters: number | null
  readonly neutralizesFlyingGroundResistance: boolean
  readonly suppressesLevitateGroundResistance: boolean
  readonly suppressesGroundsourceImmunity: boolean
}

export interface GravityFieldResolution {
  readonly field: AuthoritativeRoomState
  readonly overlay: GravityOverlayContract
  readonly reasonCode: 'gravity.active' | 'gravity.inactive'
}

export type TailwindFieldActivity = 'active' | 'suppressed'

export interface AuthoritativeTailwindField {
  readonly effectId: string
  readonly source: EncounterEffectSource
  readonly ownerSideId: EncounterSideId
  readonly duration: EncounterEffectDuration
  readonly createdRound: number
  readonly createdTurn: number
  readonly active: boolean
  readonly activity: TailwindFieldActivity
  readonly suppressionSourceEffectIds: readonly string[]
}

export interface TailwindInitiativeResolution {
  readonly queriedSideId: EncounterSideId
  readonly field: AuthoritativeTailwindField | null
  readonly active: boolean
  readonly initiativeBonus: number
  readonly modifier: {
    readonly attribute: 'initiative'
    readonly operation: 'add'
    readonly value: typeof TAILWIND_INITIATIVE_BONUS
  } | null
  readonly reasonCode:
    | 'tailwind.active'
    | 'tailwind.suppressed'
    | 'tailwind.wrong-side'
    | 'tailwind.inactive'
}

export interface MoveAutomationRemainingGlobalFieldResolver {
  /** Query whether one typed item contribution is suppressed by active Magic Room. */
  magicRoom(input: MagicRoomItemSuppressionQuery): MagicRoomItemSuppressionResolution
  /** Query Gravity's immutable overlay contract without applying it to a consumer. */
  gravity(): GravityFieldResolution
  /** Every recognized side-owned Tailwind instance in encounter-state order. */
  tailwinds(): readonly AuthoritativeTailwindField[]
  /** Query only the Initiative modifier owned by one exact authoritative side. */
  tailwind(sideId: EncounterSideId): TailwindInitiativeResolution
}

export type RemainingGlobalFieldQueryErrorCode =
  | 'invalid-item-effect-scope'
  | 'invalid-item-effect-timing'
  | 'invalid-side-id'

export class RemainingGlobalFieldQueryError extends Error {
  readonly code: RemainingGlobalFieldQueryErrorCode

  constructor(code: RemainingGlobalFieldQueryErrorCode, message: string) {
    super(message)
    this.name = 'RemainingGlobalFieldQueryError'
    this.code = code
  }
}

const ITEM_EFFECT_SCOPE_SET = new Set<unknown>(MOVE_AUTOMATION_ITEM_EFFECT_SCOPES)
const ITEM_EFFECT_TIMING_SET = new Set<unknown>(MOVE_AUTOMATION_ITEM_EFFECT_TIMINGS)

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const assertMagicRoomQuery = (input: MagicRoomItemSuppressionQuery): void => {
  if (typeof input !== 'object' || input === null || !ITEM_EFFECT_SCOPE_SET.has(input.scope)) {
    throw new RemainingGlobalFieldQueryError(
      'invalid-item-effect-scope',
      'Magic Room item-effect scope is unsupported.',
    )
  }
  if (!ITEM_EFFECT_TIMING_SET.has(input.timing)) {
    throw new RemainingGlobalFieldQueryError(
      'invalid-item-effect-timing',
      'Magic Room item-effect timing is unsupported.',
    )
  }
}

const tailwindFields = (
  state: ReturnType<typeof parseEncounterState>,
): readonly AuthoritativeTailwindField[] => deepFreeze(state.effects.flatMap((effect) => {
  if (effect.kind !== 'numeric-modifier' || !isTailwindInitiativeEffect(effect)) return []
  const ownerSideId = effect.affected.sideIds[0]!
  const active = effect.suppression.sources.length === 0
  return [{
    effectId: effect.id,
    source: effect.source,
    ownerSideId,
    duration: effect.duration,
    createdRound: effect.createdRound,
    createdTurn: effect.createdTurn,
    active,
    activity: active ? 'active' as const : 'suppressed' as const,
    suppressionSourceEffectIds: effect.suppression.sources.map(source => source.effectId),
  }]
}))

/**
 * Build one detached query snapshot for Magic Room, Gravity, and Tailwind.
 * Results expose source, side ownership, and lifecycle duration but never edit
 * a sheet, item, movement profile, Initiative score, or encounter container.
 */
export const createMoveAutomationRemainingGlobalFieldResolver = (
  map: Pick<TabletopMap, 'dimensions' | 'hazards' | 'fieldEffects' | 'encounterState'>,
  roomResolver?: MoveAutomationRoomResolver,
): MoveAutomationRemainingGlobalFieldResolver => {
  const rooms = roomResolver ?? createMoveAutomationRoomResolver(map)
  const magicRoom = rooms.state('magic')
  const gravityField = rooms.state('gravity')
  const state = parseEncounterState(map.encounterState ?? createEmptyEncounterState())
  const tailwinds = tailwindFields(state)
  const tailwindBySide = new Map(tailwinds.map(field => [field.ownerSideId, field]))

  const gravity: GravityFieldResolution = deepFreeze({
    field: gravityField,
    overlay: gravityField.active
      ? {
          treatsPokemonAsGrounded: true,
          accuracyRollBonus: GRAVITY_ACCURACY_ROLL_BONUS,
          maximumAerialEndAltitudeMeters: GRAVITY_MAX_AERIAL_END_ALTITUDE_METERS,
          neutralizesFlyingGroundResistance: true,
          suppressesLevitateGroundResistance: true,
          suppressesGroundsourceImmunity: true,
        }
      : {
          treatsPokemonAsGrounded: false,
          accuracyRollBonus: 0,
          maximumAerialEndAltitudeMeters: null,
          neutralizesFlyingGroundResistance: false,
          suppressesLevitateGroundResistance: false,
          suppressesGroundsourceImmunity: false,
        },
    reasonCode: gravityField.active ? 'gravity.active' : 'gravity.inactive',
  })

  return Object.freeze({
    magicRoom: (input: MagicRoomItemSuppressionQuery): MagicRoomItemSuppressionResolution => {
      assertMagicRoomQuery(input)
      const suppressible = magicRoomSuppressesItemEffect(input.scope, input.timing)
      const suppressed = magicRoom.active && suppressible
      const reasonCode: MagicRoomItemSuppressionResolution['reasonCode'] = !magicRoom.active
        ? 'magic-room.inactive'
        : suppressed
          ? 'magic-room.item-effect-suppressed'
          : input.scope === 'trainer-other-equipment'
            ? 'magic-room.scope-exempt'
            : 'magic-room.timing-exempt'
      return deepFreeze({
        field: magicRoom,
        scope: input.scope,
        timing: input.timing,
        suppressed,
        reasonCode,
      })
    },
    gravity: () => gravity,
    tailwinds: () => tailwinds,
    tailwind: (sideId: EncounterSideId): TailwindInitiativeResolution => {
      if (!isEncounterSideId(sideId)) {
        throw new RemainingGlobalFieldQueryError(
          'invalid-side-id',
          'Tailwind query requires a valid authoritative encounter side ID.',
        )
      }
      const field = tailwindBySide.get(sideId) ?? null
      const active = field?.active === true
      const reasonCode: TailwindInitiativeResolution['reasonCode'] = active
        ? 'tailwind.active'
        : field
          ? 'tailwind.suppressed'
          : tailwinds.length > 0
            ? 'tailwind.wrong-side'
            : 'tailwind.inactive'
      return deepFreeze({
        queriedSideId: sideId,
        field,
        active,
        initiativeBonus: active ? TAILWIND_INITIATIVE_BONUS : 0,
        modifier: active
          ? {
              attribute: 'initiative',
              operation: 'add',
              value: TAILWIND_INITIATIVE_BONUS,
            }
          : null,
        reasonCode,
      })
    },
  })
}
