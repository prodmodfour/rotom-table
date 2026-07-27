import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { CombatStageMap } from '~/types/combatStages'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import { effectiveRuntimeAbilityIds } from '../effectiveRuntimeAbilities'
import type { AbilityAutomationRuntimeRegistry } from '../registry'

/** Take a Breather ends Defense Curl's scene state without touching unrelated effects. */
export const cleanupAa085to100CurledUpForBreather = (
  map: TabletopMap,
  placementId: string,
): TabletopMap => {
  const encounter = map.encounterState ? parseEncounterState(map.encounterState) : null
  if (!encounter) return map
  const effects = encounter.effects.filter(effect => !(
    effect.tags.includes('curled-up')
    && effect.affected.placementIds.includes(placementId)
  ))
  return effects.length === encounter.effects.length ? map : {
    ...map,
    encounterState: parseEncounterState({ ...encounter, effects }),
  }
}

export interface Aa091SprintTriggerResult {
  readonly map: TabletopMap
  readonly sheet: AnyLiveSheet
  readonly applied: boolean
}

/**
 * Record the accepted Sprint maneuver as private, server-owned trigger evidence.
 * Sprint's optional Swift Action is declared and paid separately through the
 * ability declaration pipeline; merely using Sprint never spends the optional
 * action/frequency or applies its stages.
 */
export const applyAa091SprintTrigger = (input: {
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: AnyLiveSheet
  readonly combatStages: CombatStageMap
  readonly operationId: string
  /** Test/recovery seam; production callers use the manifest-selected registry. */
  readonly abilityRuntimeRegistry?: AbilityAutomationRuntimeRegistry
}): Aa091SprintTriggerResult => {
  const sceneId = input.map.encounterState?.history.sceneId ?? null
  if (!sceneId || !effectiveRuntimeAbilityIds({
    map: input.map,
    placement: input.placement,
    sheet: input.sheet,
    abilityRuntimeRegistry: input.abilityRuntimeRegistry,
  }).includes('Sprint')) return { map: input.map, sheet: input.sheet, applied: false }

  const encounter = parseEncounterState(input.map.encounterState)
  const effectId = `ability.sprint.trigger.${input.operationId}`
  if (encounter.effects.some(effect => effect.id === effectId)) {
    return { map: input.map, sheet: input.sheet, applied: false }
  }
  const effect = parseEncounterEffect({
    id: effectId,
    kind: 'capability',
    source: {
      operationId: input.operationId,
      moveId: 'maneuver.sprint',
      placementId: input.placement.id,
    },
    affected: {
      placementIds: [input.placement.id],
      sideIds: [],
      cells: [{ ...input.placement.position }],
    },
    createdRound: Math.max(1, input.map.initiative?.round ?? encounter.history.currentRound ?? 1),
    createdTurn: Math.max(0, encounter.history.currentTurn?.turn ?? 0),
    duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 },
    stacks: 1,
    charges: 1,
    stackPolicy: { kind: 'replace', maxStacks: null },
    chargePolicy: { kind: 'consume-on-trigger', amount: 1 },
    tags: ['ability', 'aa091-sprint-trigger', 'maneuver-sprint'],
    payload: { capabilityId: 'aa091.sprint.maneuver-trigger', action: 'grant' },
    dispel: { policy: 'matching-tags', tags: ['aa091-sprint-trigger'] },
    transferPolicy: 'expire',
    suppression: { sources: [] },
  }, 'ability.sprint.trigger')
  return {
    map: {
      ...input.map,
      encounterState: parseEncounterState({
        ...encounter,
        effects: [...encounter.effects, effect],
      }),
    },
    sheet: input.sheet,
    applied: true,
  }
}
