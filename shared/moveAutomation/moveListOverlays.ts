import {
  parseEncounterEffects,
  type EncounterEffect,
  type EncounterEffectMoveListAction,
  type EncounterMoveListOverlayEffect,
  type EncounterMoveListOverlayEffectPayload,
} from './encounterEffects'
import type { EncounterSideId } from './encounterState'
import { activeEncounterTransformation } from './transformationEffects'

export const ENCOUNTER_MOVE_LIST_BLOCK_REASONS = [
  'move-list-disabled',
  'move-list-restricted',
] as const

export type EncounterMoveListBlockReason =
  (typeof ENCOUNTER_MOVE_LIST_BLOCK_REASONS)[number]

export type EncounterMoveListEntrySource =
  | {
      readonly kind: 'placement'
      readonly placementId: string
    }
  | {
      readonly kind: 'encounter-overlay'
      readonly placementId: string
      readonly effectId: string
      readonly sourcePlacementId: string
      readonly copiedSpecHash: string
    }

/** One canonical move after every active encounter-local list mutation is applied. */
export interface EncounterMoveListProjectionEntry {
  readonly canonicalMoveId: string
  /** Original input position, or null for a temporary added/replacement move. */
  readonly baseIndex: number | null
  readonly source: EncounterMoveListEntrySource
  readonly available: boolean
  readonly blockReason: EncounterMoveListBlockReason | null
  /** Exact active effects responsible for the unavailable result, in encounter order. */
  readonly blockingEffectIds: readonly string[]
}

export interface ProjectEncounterMoveListInput {
  readonly placementId: string
  readonly sideId?: EncounterSideId
  /** Canonicalized sheet/automatic move identities in their existing menu order. */
  readonly baseCanonicalMoveIds: readonly string[]
  readonly effects?: readonly EncounterEffect[]
}

interface MutableProjectionEntry {
  canonicalMoveId: string
  baseIndex: number | null
  source: EncounterMoveListEntrySource
}

type MoveListOverlayEffectFor<Action extends EncounterEffectMoveListAction> =
  Omit<EncounterMoveListOverlayEffect, 'payload'> & {
    readonly payload: Extract<EncounterMoveListOverlayEffectPayload, { readonly action: Action }>
  }

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const moveKey = (value: string): string => value.trim().toLowerCase()

const appliesTo = (
  effect: EncounterMoveListOverlayEffect,
  placementId: string,
  sideId: EncounterSideId | undefined,
): boolean => effect.suppression.sources.length === 0 && (
  effect.affected.placementIds.includes(placementId)
  || (sideId !== undefined && effect.affected.sideIds.includes(sideId))
)

const overlaySource = (
  effect: MoveListOverlayEffectFor<'add'> | MoveListOverlayEffectFor<'replace'>,
  placementId: string,
): EncounterMoveListEntrySource => ({
  kind: 'encounter-overlay',
  placementId,
  effectId: effect.id,
  sourcePlacementId: effect.source.placementId,
  copiedSpecHash: effect.payload.copiedSpecHash,
})

const addMove = (
  entries: MutableProjectionEntry[],
  effect: MoveListOverlayEffectFor<'add'>,
  placementId: string,
): void => {
  const addedKey = moveKey(effect.payload.canonicalMoveId)
  if (entries.some(entry => moveKey(entry.canonicalMoveId) === addedKey)) return
  entries.push({
    canonicalMoveId: effect.payload.canonicalMoveId,
    baseIndex: null,
    source: overlaySource(effect, placementId),
  })
}

const replaceMove = (
  entries: MutableProjectionEntry[],
  effect: MoveListOverlayEffectFor<'replace'>,
  placementId: string,
): void => {
  const replacedKey = moveKey(effect.payload.replacedCanonicalMoveId)
  const replacementKey = moveKey(effect.payload.canonicalMoveId)
  const firstReplacedIndex = entries.findIndex(
    entry => moveKey(entry.canonicalMoveId) === replacedKey,
  )
  if (firstReplacedIndex < 0) return

  const replacementAlreadyExists = entries.some(
    entry => moveKey(entry.canonicalMoveId) === replacementKey,
  )
  if (replacementAlreadyExists) {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      if (moveKey(entries[index]!.canonicalMoveId) === replacedKey) entries.splice(index, 1)
    }
    return
  }

  entries[firstReplacedIndex] = {
    canonicalMoveId: effect.payload.canonicalMoveId,
    baseIndex: null,
    source: overlaySource(effect, placementId),
  }
  for (let index = entries.length - 1; index > firstReplacedIndex; index -= 1) {
    if (moveKey(entries[index]!.canonicalMoveId) === replacedKey) entries.splice(index, 1)
  }
}

const hasOverlayAction = <Action extends EncounterEffectMoveListAction>(
  effect: EncounterMoveListOverlayEffect,
  action: Action,
): effect is MoveListOverlayEffectFor<Action> => effect.payload.action === action

const filterEffectIds = (
  effects: readonly EncounterMoveListOverlayEffect[],
  canonicalMoveId: string,
  action: 'disable' | 'restrict',
): readonly string[] => {
  const key = moveKey(canonicalMoveId)
  return effects.flatMap((effect) => {
    if (effect.payload.action !== action) return []
    const listed = effect.payload.canonicalMoveIds.some(moveId => moveKey(moveId) === key)
    const blocks = action === 'disable' ? listed : !listed
    return blocks ? [effect.id] : []
  })
}

/**
 * Project one placement's encounter-local move list from immutable map state.
 *
 * Mutation effects run in encounter order. Disable effects form a union and
 * restriction effects form an intersection. Unavailable moves remain in the
 * projection so the browser can explain the same decision the server enforces.
 */
export const projectEncounterMoveList = (
  input: ProjectEncounterMoveListInput,
): readonly EncounterMoveListProjectionEntry[] => {
  const parsedEffects = parseEncounterEffects(input.effects ?? [], 'moveListOverlay.effects')
  const effects = parsedEffects.filter((effect): effect is EncounterMoveListOverlayEffect => (
    effect.kind === 'move-list-overlay'
    && appliesTo(effect, input.placementId, input.sideId)
  ))
  const transformation = activeEncounterTransformation({
    placementId: input.placementId,
    effects: parsedEffects,
  })
  const entries: MutableProjectionEntry[] = transformation
    ? transformation.payload.moves.map(move => ({
        canonicalMoveId: move.canonicalMoveId,
        baseIndex: null,
        source: {
          kind: 'encounter-overlay' as const,
          placementId: input.placementId,
          effectId: transformation.id,
          sourcePlacementId: transformation.source.placementId,
          copiedSpecHash: move.copiedSpecHash,
        },
      }))
    : input.baseCanonicalMoveIds.flatMap(
        (canonicalMoveId, baseIndex) => canonicalMoveId.trim()
          ? [{
              canonicalMoveId,
              baseIndex,
              source: {
                kind: 'placement' as const,
                placementId: input.placementId,
              },
            }]
          : [],
      )

  for (const effect of effects) {
    if (hasOverlayAction(effect, 'add')) addMove(entries, effect, input.placementId)
    else if (hasOverlayAction(effect, 'replace')) replaceMove(entries, effect, input.placementId)
  }

  return deepFreeze(entries.map((entry): EncounterMoveListProjectionEntry => {
    const disabledBy = filterEffectIds(effects, entry.canonicalMoveId, 'disable')
    const restrictedBy = filterEffectIds(effects, entry.canonicalMoveId, 'restrict')
    const blockingEffectIds = [...disabledBy, ...restrictedBy]
    return {
      canonicalMoveId: entry.canonicalMoveId,
      baseIndex: entry.baseIndex,
      source: entry.source,
      available: blockingEffectIds.length === 0,
      blockReason: disabledBy.length > 0
        ? 'move-list-disabled'
        : restrictedBy.length > 0
          ? 'move-list-restricted'
          : null,
      blockingEffectIds,
    }
  }))
}
