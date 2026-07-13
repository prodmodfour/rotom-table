import { describe, expect, it } from 'vitest'
import {
  pendingMoveMovementOptionId,
  pendingMoveMovementOptionLabelKey,
  type PendingMoveMovementSelection,
} from '#shared/moveAutomation/responseOptions'
import {
  parsePendingMoveResponseWindowList,
} from '#shared/moveAutomation/responseViews'

const responseList = () => ({
  schemaVersion: 1,
  mapSlug: 'pending-arena',
  windows: [{
    schemaVersion: 1,
    resolution: {
      schemaVersion: 1,
      resolutionId: 'resolution-pending-1',
      actorPlacementId: 'actor-token',
      canonicalMoveId: 'Pending Test',
      phase: 'hit',
      status: 'pending',
      outstandingWindowCount: 1,
      createdAt: 1_000,
      updatedAt: 1_000,
    },
    window: {
      windowId: 'window.branch',
      kind: 'choice',
      phase: 'hit',
      reasonCode: 'move.pending-test.choose',
      promptKey: 'move.pending-test.choose',
      options: [
        { id: 'option.attack', labelKey: 'move.pending-test.attack' },
        { id: 'option.support', labelKey: 'move.pending-test.support' },
      ],
      allowPass: true,
      priority: null,
    },
  }],
})

describe('pending move response views', () => {
  it('strictly parses, detaches, and freezes authorized prompt lists', () => {
    const source = responseList()
    const parsed = parsePendingMoveResponseWindowList(source)

    source.windows[0]!.window.options[0]!.id = 'option.changed'
    expect(parsed.windows[0]?.window.options[0]?.id).toBe('option.attack')
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.windows)).toBe(true)
    expect(Object.isFrozen(parsed.windows[0]?.window.options)).toBe(true)
  })

  it('projects typed movement cells and directions for the authorized targeting overlay', () => {
    const movementOption = (selection: PendingMoveMovementSelection) => ({
      id: pendingMoveMovementOptionId(selection),
      labelKey: pendingMoveMovementOptionLabelKey(selection),
      selection,
    })
    const movement = responseList() as Record<string, any>
    movement.windows[0].window.options = [movementOption({
      kind: 'movement-destination',
      setId: 'movement.destinations',
      destination: { x: 2, y: 0, z: 1 },
    })]

    const parsed = parsePendingMoveResponseWindowList(movement)
    expect(parsed.windows[0]?.window.options).toEqual(movement.windows[0].window.options)
    expect('ownership' in parsed.windows[0]!.window).toBe(false)
    expect('operationId' in parsed.windows[0]!.window).toBe(false)

    const direction = responseList() as Record<string, any>
    direction.windows[0].window.options = [movementOption({
      kind: 'movement-direction',
      setId: 'movement.directions',
      direction: 'east',
      destination: { x: 3, y: 0, z: 1 },
    })]
    expect(parsePendingMoveResponseWindowList(direction).windows[0]?.window.options).toEqual(
      direction.windows[0].window.options,
    )

    movement.windows[0].window.options[0].selection.destination.x = -1
    expect(() => parsePendingMoveResponseWindowList(movement)).toThrow(/destination.x/)
  })

  it('parses authorized canonical reaction timing without private mechanics', () => {
    const reaction = responseList() as Record<string, any>
    reaction.windows[0].window = {
      ...reaction.windows[0].window,
      kind: 'reaction',
      timing: 'post-hit',
      priority: 5,
      depth: 0,
    }
    const parsed = parsePendingMoveResponseWindowList(reaction)

    expect(parsed.windows[0]?.window).toMatchObject({
      kind: 'reaction',
      phase: 'hit',
      timing: 'post-hit',
      priority: 5,
      depth: 0,
      allowPass: true,
    })
    expect('operationId' in parsed.windows[0]!.window).toBe(false)

    reaction.windows[0].window.timing = 'pre-hit'
    expect(() => parsePendingMoveResponseWindowList(reaction)).toThrow(/does not match/)
  })

  it('rejects unknown fields, duplicate windows/options, unsupported phases, and terminal summaries', () => {
    expect(() => parsePendingMoveResponseWindowList({
      ...responseList(),
      privateRolls: [],
    })).toThrow(/exactly/)

    const duplicateOption = responseList()
    duplicateOption.windows[0]!.window.options.push({
      id: 'option.attack',
      labelKey: 'move.pending-test.other',
    })
    expect(() => parsePendingMoveResponseWindowList(duplicateOption)).toThrow(/duplicate IDs/)

    const duplicateWindow = responseList()
    duplicateWindow.windows.push(structuredClone(duplicateWindow.windows[0]!))
    expect(() => parsePendingMoveResponseWindowList(duplicateWindow)).toThrow(/duplicate resolution\/window/)

    const unsupportedPhase = responseList()
    unsupportedPhase.windows[0]!.window.phase = 'browser-phase' as 'hit'
    expect(() => parsePendingMoveResponseWindowList(unsupportedPhase)).toThrow(/phase is unsupported/)

    const terminal = responseList()
    terminal.windows[0]!.resolution.status = 'committed' as 'pending'
    terminal.windows[0]!.resolution.outstandingWindowCount = 0
    expect(() => parsePendingMoveResponseWindowList(terminal)).toThrow(/must be pending/)
  })
})
