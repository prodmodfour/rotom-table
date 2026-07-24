import { createHash } from 'node:crypto'
import {
  createEmptyEncounterState,
  parseEncounterState,
} from '#shared/moveAutomation/encounterState'
import type {
  EncounterCapabilityEffect,
  EncounterEffect,
} from '#shared/moveAutomation/encounterEffects'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import { applyEncounterEffectLifecycleEvent } from './effectLifecycle'

export const DIGESTION_BUFF_TRADED_CAPABILITY_ID =
  'digestion-buff-traded-this-scene' as const

const sheetIdentity = (
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
): string => `${placement.sheetKind}:${placement.sheetSlug}`

const sheetIdentityDigest = (
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
): string => createHash('sha256')
  .update(sheetIdentity(placement), 'utf8')
  .digest('hex')

/** Opaque sheet-bound tag lets a scene marker survive recall/send-out placement replacement. */
export const digestionBuffTradeSheetTag = (
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
): string => `digestion-buff-trade.sheet.${sheetIdentityDigest(placement)}`

export const digestionBuffTradeEffectId = (
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
): string => `effect.digestion-buff-trade.${sheetIdentityDigest(placement)}`

export const createDigestionBuffTradeEffect = (input: {
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly operationId: string
  readonly moveId: string
}): EncounterCapabilityEffect => ({
  id: digestionBuffTradeEffectId(input.placement),
  kind: 'capability',
  source: {
    operationId: input.operationId,
    moveId: input.moveId,
    placementId: input.placement.id,
  },
  affected: {
    placementIds: [input.placement.id],
    sideIds: [],
    cells: [],
  },
  createdRound: Math.max(1, input.map.initiative?.round ?? 1),
  createdTurn: Math.max(0, input.map.encounterState?.history.currentTurn?.turn ?? 0),
  duration: { kind: 'scene', remaining: null },
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'add-stack', maxStacks: 64 },
  chargePolicy: { kind: 'none', amount: null },
  tags: [
    'digestion-buff-trade',
    digestionBuffTradeSheetTag(input.placement),
  ],
  payload: {
    capabilityId: DIGESTION_BUFF_TRADED_CAPABILITY_ID,
    action: 'grant',
  },
  dispel: { policy: 'none', tags: [] },
  transferPolicy: 'retain',
  suppression: { sources: [] },
})

/** Add one bounded Scene usage stack for this authoritative sheet identity. */
export const recordDigestionBuffTrade = (input: {
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly operationId: string
  readonly moveId: string
}): TabletopMap => {
  const effect = createDigestionBuffTradeEffect(input)
  const encounter = parseEncounterState(
    input.map.encounterState ?? createEmptyEncounterState(),
  )
  const existingIndex = encounter.effects.findIndex(existing => existing.id === effect.id)
  const effects = existingIndex < 0
    ? applyEncounterEffectLifecycleEvent(
        { effects: encounter.effects },
        { kind: 'effect-applied', effect },
      ).effects
    : (() => {
        const existing = encounter.effects[existingIndex]!
        if (existing.kind !== 'capability'
          || existing.payload.action !== 'grant'
          || existing.payload.capabilityId !== DIGESTION_BUFF_TRADED_CAPABILITY_ID
          || !existing.tags.includes(digestionBuffTradeSheetTag(input.placement))
          || (existing.stackPolicy.kind !== 'replace' && existing.stackPolicy.kind !== 'add-stack')) {
          // Preserve the shared lifecycle kernel's fail-closed incompatible-ID behavior.
          return applyEncounterEffectLifecycleEvent(
            { effects: encounter.effects },
            { kind: 'effect-applied', effect },
          ).effects
        }
        const next = [...encounter.effects]
        next[existingIndex] = {
          ...existing,
          source: effect.source,
          affected: effect.affected,
          stacks: Math.min(64, existing.stacks + 1),
          stackPolicy: { kind: 'add-stack', maxStacks: 64 },
        }
        return next
      })()
  return {
    ...input.map,
    encounterState: parseEncounterState({ ...encounter, effects }),
  }
}

/** Count bounded Scene usage stacks across recall/send-out placement replacement. */
export const digestionBuffTradeCount = (input: {
  readonly effects: readonly EncounterEffect[]
  readonly placement: Pick<SheetPlacement, 'id' | 'sheetKind' | 'sheetSlug'>
}): number => {
  const sheetTag = digestionBuffTradeSheetTag(input.placement)
  return input.effects.reduce((total, effect) => (
    effect.kind === 'capability'
    && effect.payload.action === 'grant'
    && effect.payload.capabilityId === DIGESTION_BUFF_TRADED_CAPABILITY_ID
    && (effect.duration.remaining === null || effect.duration.remaining > 0)
    && (effect.affected.placementIds.includes(input.placement.id) || effect.tags.includes(sheetTag))
      ? total + effect.stacks
      : total
  ), 0)
}

/** Match direct placement effects and opaque sheet-bound markers from an immutable snapshot. */
export const hasSheetBoundCapabilityEffect = (input: {
  readonly effects: readonly EncounterEffect[]
  readonly placement: Pick<SheetPlacement, 'id' | 'sheetKind' | 'sheetSlug'>
  readonly capabilityId: string
}): boolean => {
  const sheetTag = digestionBuffTradeSheetTag(input.placement)
  return input.effects.some(effect => (
    effect.kind === 'capability'
    && effect.payload.action === 'grant'
    && effect.payload.capabilityId === input.capabilityId
    && effect.suppression.sources.length === 0
    && (
      effect.affected.placementIds.includes(input.placement.id)
      || effect.tags.includes(sheetTag)
    )
  ))
}
