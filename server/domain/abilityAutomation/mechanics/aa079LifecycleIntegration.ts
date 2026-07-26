import { createHash } from 'node:crypto'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import { parseMoveEffectOperation, type MoveDirectHpEffectOperation } from '#shared/moveAutomation/effects'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import { computeTickValue } from '~/utils/ptuHp'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { moveAutomationConditionImmunitySource } from '~/utils/moveAutomationConditionImmunity'
import type {
  EncounterLifecycleTrigger,
  EncounterLifecycleTriggerContext,
  EncounterLifecycleTriggerHandler,
} from '../../moveAutomation/reduceLifecycle'
import { effectiveRuntimeAbilityIds } from '../effectiveRuntimeAbilities'

export const AA079_MAGMA_ARMOR_GRAPPLE_TAG = 'aa079.magma-armor-grapple' as const
export const AA079_MAGMA_ARMOR_GRAPPLE_REASON = 'ability.magma-armor.grapple-turn-end-hit-point-loss' as const

const digest = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

/** Persist only a server-accepted Grapple whose target has exact effective Magma Armor. */
export const applyAa079MagmaArmorGrappleTrigger = (input: {
  readonly map: TabletopMap
  readonly actorPlacement: SheetPlacement
  readonly actorToken: Pick<SpawnedPokemon, 'id' | 'position' | 'base' | 'clearance'>
  readonly targetPlacement: SheetPlacement
  readonly targetToken: Pick<SpawnedPokemon, 'id' | 'position' | 'base' | 'clearance'>
  readonly targetSheet: AnyLiveSheet
  readonly operationId: string
}): TabletopMap => {
  if (input.targetPlacement.sheetKind !== 'pokemon'
    || input.actorPlacement.id === input.targetPlacement.id
    || ptuGridDistanceBetweenFootprints(input.actorToken, input.targetToken) > 1
    || !effectiveRuntimeAbilityIds({
      map: input.map,
      placement: input.targetPlacement,
      sheet: input.targetSheet,
    }).includes('Magma Armor')) return input.map
  const encounter = parseEncounterState(input.map.encounterState ?? createEmptyEncounterState())
  const effect = parseEncounterEffect({
    id: `ability.magma-armor.grapple.${digest(input.operationId, input.actorPlacement.id, input.targetPlacement.id)}`,
    kind: 'capability',
    source: {
      operationId: input.operationId,
      moveId: 'maneuver.grapple',
      placementId: input.actorPlacement.id,
    },
    affected: { placementIds: [input.targetPlacement.id], sideIds: [], cells: [] },
    createdRound: Math.max(1, input.map.initiative?.round ?? 1),
    createdTurn: Math.max(0, encounter.history.currentTurn?.turn ?? 0),
    duration: { kind: 'scene', remaining: null },
    stacks: 1,
    charges: null,
    stackPolicy: { kind: 'replace', maxStacks: null },
    chargePolicy: { kind: 'none', amount: null },
    tags: ['ability', 'aa079', 'grapple', AA079_MAGMA_ARMOR_GRAPPLE_TAG],
    payload: { capabilityId: 'combat.grapple.magma-armor', action: 'grant' },
    dispel: { policy: 'matching-tags', tags: ['grapple', AA079_MAGMA_ARMOR_GRAPPLE_TAG] },
    transferPolicy: 'expire',
    suppression: { sources: [] },
  })
  return {
    ...input.map,
    encounterState: parseEncounterState({
      ...encounter,
      effects: [
        ...encounter.effects.filter(candidate => !(
          candidate.tags.includes(AA079_MAGMA_ARMOR_GRAPPLE_TAG)
          && candidate.source.placementId === input.actorPlacement.id
        )),
        effect,
      ],
    }),
  }
}

const grappleTick = (input: {
  readonly eventId: string
  readonly effectId: string
  readonly amount: number
}): MoveDirectHpEffectOperation => parseMoveEffectOperation({
  id: `ability.magma-armor.grapple-tick.${digest(input.eventId, input.effectId)}`,
  kind: 'direct-hp',
  source: { kind: 'encounter-effect', id: input.effectId },
  recipients: { kind: 'source-placement' },
  phase: 'cleanup',
  reasonCode: AA079_MAGMA_ARMOR_GRAPPLE_REASON,
  payload: {
    mode: 'lose', pool: 'hit-points',
    calculation: { kind: 'fixed', value: input.amount },
    copySource: null,
    bounds: { minimum: null, maximum: null },
    rounding: 'floor',
    applyTypeImmunity: false,
    cost: null,
    injury: { hitPointMarkers: 'apply-after-operation', massiveDamage: 'never' },
  },
}) as MoveDirectHpEffectOperation

export interface Aa079MagmaArmorGrappleLifecycleEntry {
  readonly effectId: string
  readonly sourcePlacementId: string
  readonly tickValue: number
}

/** End-turn recoil for still-adjacent, burn-vulnerable authoritative grapplers. */
export const createAa079MagmaArmorGrappleLifecycleHandler = (input: {
  readonly entries: readonly Aa079MagmaArmorGrappleLifecycleEntry[]
}): EncounterLifecycleTriggerHandler => Object.freeze({
  id: 'aa079.magma-armor.grapple-lifecycle',
  resolve: (context: EncounterLifecycleTriggerContext): readonly EncounterLifecycleTrigger[] => {
    const event = context.event
    if (event.kind !== 'turn-end') return Object.freeze([])
    return Object.freeze(input.entries.flatMap(entry => entry.sourcePlacementId === event.placementId
      && context.effectsAtEventStart.some(effect => effect.id === entry.effectId)
      ? [{
          effectId: null,
          reasonCode: AA079_MAGMA_ARMOR_GRAPPLE_REASON,
          operations: [grappleTick({
            eventId: event.eventId,
            effectId: entry.effectId,
            amount: entry.tickValue,
          })],
          emittedEvents: [],
        }]
      : []))
  },
})

/** Build lifecycle entries from current geometry, exact abilities, and Burn immunity. */
export const aa079MagmaArmorGrappleLifecycleEntries = (input: {
  readonly map: TabletopMap
  readonly tokens: readonly SpawnedPokemon[]
  readonly effectiveAbilityIds: (placementId: string) => readonly string[]
}): readonly Aa079MagmaArmorGrappleLifecycleEntry[] => Object.freeze(
  (input.map.encounterState?.effects ?? []).flatMap(effect => {
    if (effect.kind !== 'capability'
      || effect.suppression.sources.length > 0
      || !effect.tags.includes(AA079_MAGMA_ARMOR_GRAPPLE_TAG)
      || effect.payload.capabilityId !== 'combat.grapple.magma-armor'
      || effect.payload.action !== 'grant'
      || !effect.source.placementId) return []
    const source = input.tokens.find(token => token.id === effect.source.placementId)
    const targetId = effect.affected.placementIds[0]
    const target = targetId ? input.tokens.find(token => token.id === targetId) : null
    if (!source || !target || !targetId
      || ptuGridDistanceBetweenFootprints(source, target) > 1
      || !input.effectiveAbilityIds(targetId).includes('Magma Armor')) return []
    const effectiveSource = {
      ...source,
      abilityNames: [...input.effectiveAbilityIds(source.id)],
    }
    if (moveAutomationConditionImmunitySource('Burned', effectiveSource) !== null) return []
    return [{
      effectId: effect.id,
      sourcePlacementId: source.id,
      tickValue: computeTickValue(source.fullMaxHp ?? source.maxHp),
    }]
  }),
)
