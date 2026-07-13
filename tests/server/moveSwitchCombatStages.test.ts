import { describe, expect, it } from 'vitest'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import { pokemonHpSnapshot } from '~/utils/sheetSpawn'
import {
  applyCombatStagesToSheet,
  applyHpToSheet,
} from '~/utils/sheetMutations'
import { deepCloneJson } from '~/utils/serialization'
import {
  planMoveSwitchCombatStageTransfer,
} from '~~/server/domain/moveAutomation/planSwitchCombatStages'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveSheetDocument,
  type MoveStateChangeInput,
} from '~~/server/domain/moveAutomation/plan'
import {
  SWITCH_ACTOR_PLACEMENT_ID,
  createSwitchChoiceMap,
  switchChoiceSheets,
} from '../fixtures/moveAutomation/switchChoices'

const stagedSheets = () => {
  const resources = switchChoiceSheets()
  const source = resources.pokemonSheets.get('switch-actor-sheet')!
  const replacement = resources.pokemonSheets.get('switch-replacement')!
  resources.pokemonSheets.set('switch-actor-sheet', applyCombatStagesToSheet('pokemon', source, {
    atk: 4,
    def: -2,
    satk: 0,
    sdef: 1,
    spd: 6,
    acc: -1,
  }) as typeof source)
  resources.pokemonSheets.set('switch-replacement', applyCombatStagesToSheet('pokemon', replacement, {
    atk: 3,
    def: -5,
    satk: 0,
    sdef: 6,
    spd: 1,
    acc: 2,
  }) as typeof replacement)
  return resources
}

const placements = () => {
  const map = createSwitchChoiceMap()
  return {
    recalled: map.placements.find(placement => placement.id === SWITCH_ACTOR_PLACEMENT_ID)!,
    sentOut: {
      id: 'switch-new-placement',
      sheetKind: 'pokemon' as const,
      sheetSlug: 'switch-replacement',
      position: { x: 2, y: 0, z: 2 },
    },
  }
}

const stagesFor = (sheet: MoveSheetDocument) => pokemonHpSnapshot(sheet as never).combatStages

describe('Baton Pass combat-stage planning', () => {
  it('clears the source and atomically adds every bounded stage to the replacement', () => {
    const resources = stagedSheets()
    const before = structuredClone([...resources.pokemonSheets.entries()])
    const placement = placements()

    const plan = planMoveSwitchCombatStageTransfer({
      stateChanges: [],
      recalledPlacement: placement.recalled,
      sentOutPlacement: placement.sentOut,
      pokemonSheets: resources.pokemonSheets,
      operationId: 'operation.baton-pass.switch',
      plannedAt: 2_000,
      stateTransferPolicy: 'baton-pass',
    })

    expect(plan.previousRecalledStages).toEqual({
      atk: 4,
      def: -2,
      satk: 0,
      sdef: 1,
      spd: 6,
      acc: -1,
    })
    expect(plan.currentRecalledStages).toEqual({
      atk: 0,
      def: 0,
      satk: 0,
      sdef: 0,
      spd: 0,
      acc: 0,
    })
    expect(plan.currentSentOutStages).toEqual({
      atk: 6,
      def: -6,
      satk: 0,
      sdef: 6,
      spd: 6,
      acc: 1,
    })
    expect(plan.stateChanges).toHaveLength(2)
    expect(plan.stateChanges.map(change => change.kind === 'sheet-state'
      ? `${change.scope.sheetSlug}:${change.changedFields.join(',')}`
      : change.kind)).toEqual([
      'switch-actor-sheet:combatStages',
      'switch-replacement:combatStages',
    ])
    for (const change of plan.stateChanges) {
      if (change.kind !== 'sheet-state') throw new Error('Expected sheet stage change.')
      expect(change.current.revision).toBe(nextRevision(change.expectedRevision))
    }
    expect([...resources.pokemonSheets.entries()]).toEqual(before)
  })

  it('folds stage transfer into an existing source write without a second revision', () => {
    const resources = stagedSheets()
    const placement = placements()
    const source = resources.pokemonSheets.get('switch-actor-sheet')!
    const expectedRevision = normalizeRevision(source.revision)
    const previous = {
      ...deepCloneJson(source),
      revision: expectedRevision,
    }
    const hpCurrent = applyHpToSheet(
      'pokemon',
      previous,
      pokemonHpSnapshot(source).currentHp - 1,
    ) as MoveSheetDocument
    const existing: MoveStateChangeInput = {
      kind: 'sheet-state',
      scope: {
        kind: 'sheet',
        sheetKind: 'pokemon',
        sheetSlug: source.slug,
      },
      expectedRevision,
      sourceOperationId: 'operation.baton-pass.hp-cost',
      reasonCode: 'move.baton-pass.hp-cost',
      previous,
      current: {
        ...hpCurrent,
        revision: nextRevision(expectedRevision),
        updatedAt: 2_000,
      } as unknown as MoveSheetDocument,
      changedFields: ['hp'],
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    }

    const plan = planMoveSwitchCombatStageTransfer({
      stateChanges: [existing],
      recalledPlacement: placement.recalled,
      sentOutPlacement: placement.sentOut,
      pokemonSheets: resources.pokemonSheets,
      operationId: 'operation.baton-pass.switch',
      plannedAt: 2_000,
      stateTransferPolicy: 'baton-pass',
    })
    const sourceChange = plan.stateChanges.find(change => (
      change.kind === 'sheet-state' && change.scope.sheetSlug === source.slug
    ))
    if (!sourceChange || sourceChange.kind !== 'sheet-state') {
      throw new Error('Expected one folded source sheet change.')
    }

    expect(plan.stateChanges).toHaveLength(2)
    expect(sourceChange.changedFields).toEqual(['hp', 'combatStages'])
    expect(sourceChange.current.revision).toBe(nextRevision(expectedRevision))
    expect(pokemonHpSnapshot(sourceChange.current as never).currentHp)
      .toBe(pokemonHpSnapshot(source).currentHp - 1)
    expect(stagesFor(sourceChange.current)).toEqual(plan.currentRecalledStages)
  })

  it('leaves both sheets unchanged for an ordinary switch policy', () => {
    const resources = stagedSheets()
    const placement = placements()
    const plan = planMoveSwitchCombatStageTransfer({
      stateChanges: [],
      recalledPlacement: placement.recalled,
      sentOutPlacement: placement.sentOut,
      pokemonSheets: resources.pokemonSheets,
      operationId: 'operation.u-turn.switch',
      plannedAt: 2_000,
      stateTransferPolicy: 'none',
    })

    expect(plan.stateChanges).toEqual([])
    expect(plan.currentRecalledStages).toEqual(plan.previousRecalledStages)
    expect(plan.currentSentOutStages).toEqual(plan.previousSentOutStages)
  })
})
