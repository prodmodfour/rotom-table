import { describe, expect, it } from 'vitest'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { pokemonHpSnapshot } from '~/utils/sheetSpawn'
import { applyCombatStagesToSheet } from '~/utils/sheetMutations'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveStateExecution,
} from '~~/server/domain/planAuthoritativeMoveState'
import { isAuthoritativePendingMoveResolution } from '~~/server/domain/resolveAuthoritativeMove'
import { planResumedMoveState } from '~~/server/domain/moveAutomation/planResumedMoveState'
import { resumeMoveSpec } from '~~/server/domain/moveAutomation/resumeSpec'
import {
  SWITCH_ACTOR_PLACEMENT_ID,
  SWITCH_TARGET_PLACEMENT_ID,
  SWITCH_TRAINER_PLACEMENT_ID,
  createSwitchChoiceMap,
  createSwitchChoiceRuntimeRegistry,
  createSwitchChoiceTrainerSheet,
  switchChoiceIntent,
  switchChoiceSheets,
} from '../fixtures/moveAutomation/switchChoices'
import {
  conditionEncounterEffectFixture,
  numericEncounterEffectFixture,
} from '../fixtures/moveAutomation/encounterEffects'

const declarationPlan = (
  sheets = switchChoiceSheets(),
  options: {
    readonly map?: ReturnType<typeof createSwitchChoiceMap>
    readonly runtimeRegistry?: ReturnType<typeof createSwitchChoiceRuntimeRegistry>
  } = {},
) => planAuthoritativeMoveStateExecution({
  map: options.map ?? createSwitchChoiceMap(),
  ...sheets,
  intent: switchChoiceIntent(),
  random: () => { throw new Error('switch fixture does not use randomness') },
  now: () => 1_000,
  operationId: 'op_switchdeclare01',
  pendingResolutionId: 'resolution-switch-choice-1',
  runtimeRegistry: options.runtimeRegistry ?? createSwitchChoiceRuntimeRegistry(),
})

describe('move-driven switch planning', () => {
  it('defers attack effects until a legal durable replacement is selected', () => {
    const resources = switchChoiceSheets()
    const declaration = declarationPlan(resources)
    expect(isAuthoritativePendingMoveStatePlan(declaration)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration)) return

    const pending = declaration.suspension.pendingResolution
    const window = pending.outstandingWindows[0]!
    expect(window).toMatchObject({
      kind: 'choice',
      windowId: 'switch-test.replacement-window',
      allowPass: false,
      ownership: [{ kind: 'actor', id: null }],
      options: [{
        id: expect.stringMatching(/^switch\.replacement\./),
        labelKey: 'move.switch.replacement.switch-replacement',
      }],
    })
    expect(pending.readSet).toEqual(expect.arrayContaining([
      { kind: 'sheet', sheetKind: 'trainer', slug: 'switch-owner', revision: 3 },
      { kind: 'sheet', sheetKind: 'pokemon', slug: 'switch-replacement', revision: 2 },
    ]))
    expect(declaration.nextMap.placements.some(
      placement => placement.id === SWITCH_ACTOR_PLACEMENT_ID,
    )).toBe(true)
    expect(declaration.nextMap.placements.some(
      placement => placement.sheetSlug === 'switch-replacement',
    )).toBe(false)
    expect(declaration.sheetWrites).toEqual([])

    const option = window.options[0]!
    const execution = resumeMoveSpec({
      pendingResolution: pending,
      map: declaration.nextMap,
      ...resources,
      response: { requestId: window.windowId, optionId: option.id },
      now: 2_000,
      random: () => { throw new Error('switch fixture does not use randomness') },
      runtimeRegistry: createSwitchChoiceRuntimeRegistry(),
    })
    expect(isAuthoritativePendingMoveResolution(execution)).toBe(false)
    if (isAuthoritativePendingMoveResolution(execution)) return
    expect(execution.switchTransition).toMatchObject({
      operationId: 'switch-test.choose-replacement',
      recalledPlacementId: SWITCH_ACTOR_PLACEMENT_ID,
      trainerPlacementId: SWITCH_TRAINER_PLACEMENT_ID,
      trainerSheetSlug: 'switch-owner',
      sentOutPlacement: {
        sheetSlug: 'switch-replacement',
        position: { x: 2, y: 0, z: 2 },
        sideId: 'heroes',
        initiative: 18,
      },
    })

    const completed = planResumedMoveState({
      pendingResolution: pending,
      declarationPlan: declaration.suspension.preWindowPlan,
      responseOpId: 'op_switchanswer001',
      responseWindowId: window.windowId,
      responseOptionId: option.id,
      chosenBy: { kind: 'gm', id: null },
      map: declaration.nextMap,
      ...resources,
      execution,
      plannedAt: 2_000,
      runtimeRegistry: createSwitchChoiceRuntimeRegistry(),
    })
    expect(isAuthoritativePendingMoveStatePlan(completed)).toBe(false)
    if (isAuthoritativePendingMoveStatePlan(completed)) return

    const replacement = completed.nextMap.placements.find(
      placement => placement.sheetSlug === 'switch-replacement',
    )!
    expect(completed.nextMap.placements.some(
      placement => placement.id === SWITCH_ACTOR_PLACEMENT_ID,
    )).toBe(false)
    expect(replacement).toMatchObject({
      position: { x: 2, y: 0, z: 2 },
      sideId: 'heroes',
      initiative: 18,
      facing: 'north-east',
    })
    expect(completed.nextMap.initiative).toEqual({
      activeId: replacement.id,
      round: 2,
      manualOrderIds: [
        replacement.id,
        SWITCH_TRAINER_PLACEMENT_ID,
        SWITCH_TARGET_PLACEMENT_ID,
      ],
    })
    expect(completed.nextMap.temporaryHitPoints).toBeUndefined()
    expect(completed.nextMap.encounterState?.history.switches).toEqual([
      expect.objectContaining({
        kind: 'switch',
        recalledPlacementId: SWITCH_ACTOR_PLACEMENT_ID,
        sentOutPlacementId: replacement.id,
      }),
    ])
    expect(completed.nextMap.encounterState?.pendingResolutionSummaries).toEqual([])

    const targetWrite = completed.sheetWrites.find(
      write => write.slug === 'switch-target-sheet',
    )!
    expect(pokemonHpSnapshot(targetWrite.previousSheet as never).currentHp).toBe(60)
    expect(pokemonHpSnapshot(targetWrite.nextSheet as never).currentHp).toBe(55)
    expect(completed.stateChanges.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'placement-state',
        scope: expect.objectContaining({ placementId: SWITCH_ACTOR_PLACEMENT_ID }),
        current: null,
      }),
      expect.objectContaining({
        kind: 'placement-state',
        scope: expect.objectContaining({ placementId: replacement.id }),
        previous: null,
      }),
      expect.objectContaining({
        kind: 'map-initiative',
        compensation: expect.objectContaining({ kind: 'unavailable' }),
      }),
      expect.objectContaining({ kind: 'encounter-state' }),
    ]))
  })

  it('transfers reviewed stages and effects without source-leave duplication', () => {
    const resources = switchChoiceSheets()
    const actorSheet = resources.pokemonSheets.get('switch-actor-sheet')!
    const replacementSheet = resources.pokemonSheets.get('switch-replacement')!
    resources.pokemonSheets.set(
      actorSheet.slug,
      applyCombatStagesToSheet('pokemon', actorSheet, {
        atk: 2,
        def: -1,
        satk: 0,
        sdef: 0,
        spd: 3,
        acc: 1,
      }) as typeof actorSheet,
    )
    resources.pokemonSheets.set(
      replacementSheet.slug,
      applyCombatStagesToSheet('pokemon', replacementSheet, {
        atk: 1,
        def: 0,
        satk: 0,
        sdef: 0,
        spd: 0,
        acc: 0,
      }) as typeof replacementSheet,
    )
    const passable = parseEncounterEffect({
      ...numericEncounterEffectFixture(),
      id: 'effect.baton-pass.coat',
      source: {
        ...numericEncounterEffectFixture().source,
        placementId: SWITCH_ACTOR_PLACEMENT_ID,
      },
      affected: {
        placementIds: [SWITCH_ACTOR_PLACEMENT_ID],
        sideIds: [],
        cells: [],
      },
      tags: ['coat'],
      transferPolicy: 'baton-pass',
    })
    const expiring = parseEncounterEffect({
      ...conditionEncounterEffectFixture(),
      id: 'effect.baton-pass.non-passable',
      source: {
        ...conditionEncounterEffectFixture().source,
        placementId: SWITCH_ACTOR_PLACEMENT_ID,
      },
      affected: {
        placementIds: [SWITCH_ACTOR_PLACEMENT_ID],
        sideIds: [],
        cells: [],
      },
      transferPolicy: 'expire',
    })
    const map = createSwitchChoiceMap()
    map.encounterState = {
      ...map.encounterState!,
      effects: [passable, expiring],
    }
    const runtimeRegistry = createSwitchChoiceRuntimeRegistry({
      stateTransferPolicy: 'baton-pass',
    })
    const declaration = declarationPlan(resources, { map, runtimeRegistry })
    if (!isAuthoritativePendingMoveStatePlan(declaration)) {
      throw new Error('Expected a pending Baton Pass-style switch.')
    }
    const pending = declaration.suspension.pendingResolution
    const window = pending.outstandingWindows[0]!
    const execution = resumeMoveSpec({
      pendingResolution: pending,
      map: declaration.nextMap,
      ...resources,
      response: { requestId: window.windowId, optionId: window.options[0]!.id },
      now: 2_000,
      random: () => { throw new Error('switch fixture does not use randomness') },
      runtimeRegistry,
    })
    if (isAuthoritativePendingMoveResolution(execution)) {
      throw new Error('Expected a completed Baton Pass-style switch.')
    }
    expect(execution.switchTransition?.stateTransferPolicy).toBe('baton-pass')

    const completed = planResumedMoveState({
      pendingResolution: pending,
      declarationPlan: declaration.suspension.preWindowPlan,
      responseOpId: 'op_batonpassanswer1',
      responseWindowId: window.windowId,
      responseOptionId: window.options[0]!.id,
      chosenBy: { kind: 'gm', id: null },
      map: declaration.nextMap,
      ...resources,
      execution,
      plannedAt: 2_000,
      runtimeRegistry,
    })
    if (isAuthoritativePendingMoveStatePlan(completed)) {
      throw new Error('Expected a completed Baton Pass-style plan.')
    }
    const replacement = completed.nextMap.placements.find(
      placement => placement.sheetSlug === 'switch-replacement',
    )!
    const effects = completed.nextMap.encounterState?.effects ?? []
    expect(effects).toHaveLength(1)
    expect(effects[0]).toMatchObject({
      id: passable.id,
      source: { placementId: replacement.id },
      affected: { placementIds: [replacement.id] },
      transferPolicy: 'baton-pass',
    })
    expect(effects.filter(effect => effect.id === passable.id)).toHaveLength(1)
    expect(effects.some(effect => effect.id === expiring.id)).toBe(false)

    const sourceWrite = completed.sheetWrites.find(
      write => write.slug === 'switch-actor-sheet',
    )!
    const replacementWrite = completed.sheetWrites.find(
      write => write.slug === 'switch-replacement',
    )!
    expect(pokemonHpSnapshot(sourceWrite.nextSheet as never).combatStages).toEqual({
      atk: 0,
      def: 0,
      satk: 0,
      sdef: 0,
      spd: 0,
      acc: 0,
    })
    expect(pokemonHpSnapshot(replacementWrite.nextSheet as never).combatStages).toEqual({
      atk: 3,
      def: -1,
      satk: 0,
      sdef: 0,
      spd: 3,
      acc: 1,
    })
    expect(replacementWrite.placementIds).toEqual([replacement.id])
  })

  it('fails closed before a mandatory switch can commit when the roster has no replacement', () => {
    const resources = switchChoiceSheets()
    resources.trainerSheets.set('switch-owner', {
      ...createSwitchChoiceTrainerSheet(),
      currentTeam: ['switch-actor-sheet'],
    })
    const map = createSwitchChoiceMap()
    const mapBefore = structuredClone(map)
    const targetBefore = structuredClone(resources.pokemonSheets.get('switch-target-sheet'))

    expect(() => planAuthoritativeMoveStateExecution({
      map,
      ...resources,
      intent: switchChoiceIntent(),
      random: () => 0,
      now: () => 1_000,
      operationId: 'op_switchnoreplace1',
      pendingResolutionId: 'resolution-switch-no-replacement',
      runtimeRegistry: createSwitchChoiceRuntimeRegistry(),
    })).toThrowError(/no legal authoritative replacement/i)
    expect(map).toEqual(mapBefore)
    expect(resources.pokemonSheets.get('switch-target-sheet')).toEqual(targetBefore)
  })
})
