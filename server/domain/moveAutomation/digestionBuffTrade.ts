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
  stackPolicy: { kind: 'replace', maxStacks: null },
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

/** Apply or refresh the one scene marker for this authoritative sheet identity. */
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
  const lifecycle = applyEncounterEffectLifecycleEvent(
    { effects: encounter.effects },
    { kind: 'effect-applied', effect },
  )
  return {
    ...input.map,
    encounterState: {
      ...encounter,
      effects: lifecycle.effects,
    },
  }
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
