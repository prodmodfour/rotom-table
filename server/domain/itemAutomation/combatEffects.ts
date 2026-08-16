import { createHash } from 'node:crypto'
import type {
  EncounterCapabilityEffect,
  EncounterEffect,
} from '#shared/moveAutomation/encounterEffects'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type {
  ItemCombatStageStat,
  ItemDurationSpec,
  ItemTemporaryEffectFamily,
} from '#shared/itemAutomation/spec'
import type { SheetKind } from '#shared/sheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { CombatStageMap } from '~/types/combatStages'
import type { TabletopMap } from '~/types/map'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import { clampCombatStage, normalizeCombatStages } from '~/utils/combatStages'
import { resolveStats } from '~/utils/sheets/pokemonDerived'
import { resolveItemEncounterEffectDuration } from './durations'

export const ITEM_COMBAT_EFFECT_TAG = 'item-combat-effect' as const
export const ITEM_DIRE_HIT_CAPABILITY_ID = 'item.dire-hit.critical-range' as const
export const ITEM_GUARD_SPEC_CAPABILITY_ID = 'item.guard-spec.move-stage-reduction-immunity' as const

export interface ItemCombatStageResolution {
  readonly stat: ItemCombatStageStat
  readonly previous: number
  readonly requestedDelta: number
  readonly appliedDelta: number
  readonly current: number
  readonly minimum: -6
  readonly maximum: 6
  readonly capped: boolean
}

const currentStages = (kind: SheetKind, sheet: AnyLiveSheet): CombatStageMap => {
  if (kind === 'pokemon') {
    const pokemon = sheet as CharacterSheet
    const stats = resolveStats(pokemon)
    const stage = (key: Exclude<ItemCombatStageStat, 'acc'>): number => (
      stats.find(value => value.key === key)?.stage ?? 0
    )
    return normalizeCombatStages({
      atk: stage('atk'), def: stage('def'), satk: stage('satk'),
      sdef: stage('sdef'), spd: stage('spd'), acc: pokemon.combatStages?.acc,
    })
  }
  const trainer = sheet as TrainerSheet
  return normalizeCombatStages({
    atk: trainer.stats?.atk?.stage ?? trainer.combatStages?.atk,
    def: trainer.stats?.def?.stage ?? trainer.combatStages?.def,
    satk: trainer.stats?.satk?.stage ?? trainer.combatStages?.satk,
    sdef: trainer.stats?.sdef?.stage ?? trainer.combatStages?.sdef,
    spd: trainer.stats?.spd?.stage ?? trainer.combatStages?.spd,
    acc: trainer.combatStages?.acc,
  })
}

/** Resolve one bounded stage change from the detached authoritative sheet snapshot. */
export const resolveItemCombatStageModification = (input: {
  readonly sheetKind: SheetKind
  readonly sheet: AnyLiveSheet
  readonly stat: ItemCombatStageStat
  readonly amount: number
}): ItemCombatStageResolution => {
  if (!Number.isSafeInteger(input.amount) || input.amount === 0 || input.amount < -6 || input.amount > 6) {
    throw new Error('Item combat-stage amount must be a non-zero integer from -6 through +6.')
  }
  const previous = currentStages(input.sheetKind, input.sheet)[input.stat]
  const current = clampCombatStage(previous + input.amount)
  const appliedDelta = current - previous
  return Object.freeze({
    stat: input.stat,
    previous,
    requestedDelta: input.amount,
    appliedDelta,
    current,
    minimum: -6,
    maximum: 6,
    capped: appliedDelta !== input.amount,
  })
}

export const itemCombatStagePreviewDescription = (resolution: ItemCombatStageResolution): string => {
  const stat = resolution.stat === 'acc' ? 'Accuracy' : ({
    atk: 'Attack', def: 'Defense', satk: 'Special Attack', sdef: 'Special Defense', spd: 'Speed',
  } as const)[resolution.stat]
  const sign = (value: number): string => value >= 0 ? `+${value}` : String(value)
  return `${stat} ${sign(resolution.previous)} → ${sign(resolution.current)} (${sign(resolution.appliedDelta)} stage${Math.abs(resolution.appliedDelta) === 1 ? '' : 's'}${resolution.capped ? '; capped' : ''})`
}

export const itemTemporaryEffectCapabilityId = (
  family: ItemTemporaryEffectFamily,
): typeof ITEM_DIRE_HIT_CAPABILITY_ID | typeof ITEM_GUARD_SPEC_CAPABILITY_ID => family === 'critical-range'
  ? ITEM_DIRE_HIT_CAPABILITY_ID
  : ITEM_GUARD_SPEC_CAPABILITY_ID

const familyFromCapabilityId = (
  capabilityId: string,
): ItemTemporaryEffectFamily | null => capabilityId === ITEM_DIRE_HIT_CAPABILITY_ID
  ? 'critical-range'
  : capabilityId === ITEM_GUARD_SPEC_CAPABILITY_ID
    ? 'move-stage-reduction-immunity'
    : null

export const isItemTemporaryCombatEffect = (
  effect: EncounterEffect,
): effect is EncounterCapabilityEffect => effect.kind === 'capability'
  && effect.payload.action === 'grant'
  && familyFromCapabilityId(effect.payload.capabilityId) !== null
  && effect.tags.includes(ITEM_COMBAT_EFFECT_TAG)

export const activeItemTemporaryCombatEffects = (input: {
  readonly effects: readonly EncounterEffect[] | null | undefined
  readonly placementId: string
  readonly family?: ItemTemporaryEffectFamily
}): readonly EncounterCapabilityEffect[] => Object.freeze((input.effects ?? []).filter(
  (effect): effect is EncounterCapabilityEffect => isItemTemporaryCombatEffect(effect)
    && effect.affected.placementIds.includes(input.placementId)
    && effect.suppression.sources.length === 0
    && (effect.duration.remaining === null || effect.duration.remaining > 0)
    && (input.family === undefined || familyFromCapabilityId(effect.payload.capabilityId) === input.family),
))

export const itemCriticalRangeBonus = (input: {
  readonly effects: readonly EncounterEffect[] | null | undefined
  readonly placementId: string
}): number => activeItemTemporaryCombatEffects({
  effects: input.effects,
  placementId: input.placementId,
  family: 'critical-range',
}).reduce((maximum, effect) => Math.max(maximum, effect.payload.value ?? 0), 0)

/** Guard Spec blocks only reductions authored by a Move operation, not self/system/item changes. */
export const itemMoveCombatStageReductionBlocker = (input: {
  readonly effects: readonly EncounterEffect[] | null | undefined
  readonly placementId: string
  readonly delta: number
  readonly operationSourceKind: string
}): string | null => input.delta < 0
  // Every operation in the ordinary move reducer is causally owned by the
  // declared Move, even when its immediate source is another operation. By
  // contrast lifecycle-event/encounter-effect sources remain distinguishable
  // and cannot accidentally acquire Guard Spec protection.
  && (input.operationSourceKind === 'move' || input.operationSourceKind === 'operation')
  && activeItemTemporaryCombatEffects({
    effects: input.effects,
    placementId: input.placementId,
    family: 'move-stage-reduction-immunity',
  }).length > 0
  ? 'Guard Spec'
  : null

const effectIdFor = (family: ItemTemporaryEffectFamily, targetPlacementId: string): string => (
  `item.effect.${family}.${createHash('sha256').update(targetPlacementId).digest('hex').slice(0, 24)}`
)

/** Materialize one source-attributed, switch-expiring, deterministic temporary item effect. */
export const createItemTemporaryCombatEffect = (input: {
  readonly operationId: string
  readonly canonicalItemId: string
  readonly sourcePlacementId: string
  readonly targetPlacementId: string
  readonly family: ItemTemporaryEffectFamily
  readonly amount: number
  readonly duration: ItemDurationSpec
  readonly stackPolicy: 'replace' | 'refresh'
  /** Required only for reviewed campaign-day durations; never inferred from ambient time. */
  readonly campaignMinute?: number
  readonly map: Pick<TabletopMap, 'initiative' | 'encounterState'>
}): EncounterCapabilityEffect => parseEncounterEffect({
  id: effectIdFor(input.family, input.targetPlacementId),
  kind: 'capability',
  source: {
    operationId: `item.use.${createHash('sha256').update(input.operationId).digest('hex').slice(0, 24)}`,
    moveId: `item.${input.canonicalItemId.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    placementId: input.sourcePlacementId,
  },
  affected: { placementIds: [input.targetPlacementId], sideIds: [], cells: [] },
  createdRound: Math.max(1, input.map.initiative?.round ?? 1),
  createdTurn: Math.max(0, input.map.encounterState?.history.currentTurn?.turn ?? 0),
  duration: resolveItemEncounterEffectDuration({
    duration: input.duration,
    ...(input.campaignMinute === undefined ? {} : { campaignMinute: input.campaignMinute }),
  }),
  stacks: 1,
  charges: null,
  stackPolicy: { kind: input.stackPolicy, maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: [ITEM_COMBAT_EFFECT_TAG, `item-family.${input.family}`],
  payload: {
    capabilityId: itemTemporaryEffectCapabilityId(input.family),
    action: 'grant',
    value: input.amount,
  },
  dispel: { policy: 'matching-tags', tags: [ITEM_COMBAT_EFFECT_TAG] },
  transferPolicy: 'expire',
  suppression: { sources: [] },
}, `itemTemporaryCombatEffect.${input.family}`) as EncounterCapabilityEffect

export const itemTemporaryEffectPreviewDescription = (input: {
  readonly family: ItemTemporaryEffectFamily
  readonly amount: number
  readonly duration: ItemDurationSpec
}): string => input.family === 'critical-range'
  ? `Critical Hit Range +${input.amount} until the encounter ends; re-use replaces this source.`
  : `Move-caused Combat Stage and Accuracy reductions are prevented for ${input.duration.amount} target turns; re-use refreshes the duration.`
