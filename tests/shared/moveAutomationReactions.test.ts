import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_EVENT_KINDS,
  encounterEventReactionTiming,
  type EncounterEventKind,
} from '#shared/moveAutomation/events'
import {
  MOVE_REACTION_INFORMATION_KINDS,
  MOVE_REACTION_LIMITS,
  MOVE_REACTION_PASS_SEMANTICS,
  MOVE_REACTION_TIMINGS,
  compareMoveReactionOrder,
  moveReactionTimingDefinition,
} from '#shared/moveAutomation/reactions'

describe('canonical move reaction contract', () => {
  it('defines each checkpoint, owning interpreter phase, and bounded disclosure progression', () => {
    expect(MOVE_REACTION_TIMINGS).toEqual([
      'declare',
      'pre-cost',
      'target',
      'pre-hit',
      'post-hit',
      'pre-damage',
      'post-damage',
      'ko',
      'movement-step',
      'switch',
      'cleanup',
    ])
    expect(MOVE_REACTION_TIMINGS.map(timing => moveReactionTimingDefinition(timing).phase))
      .toEqual([
        'declare',
        'pay',
        'target',
        'pre-hit',
        'hit',
        'damage',
        'after-damage',
        'ko',
        'movement',
        'movement',
        'cleanup',
      ])

    const knownInformation = new Set(MOVE_REACTION_INFORMATION_KINDS)
    for (const timing of MOVE_REACTION_TIMINGS) {
      const definition = moveReactionTimingDefinition(timing)
      expect(definition.timing).toBe(timing)
      expect(definition.revealedInformation.length).toBeGreaterThan(0)
      expect(definition.revealedInformation.every(kind => knownInformation.has(kind))).toBe(true)
      expect(Object.isFrozen(definition)).toBe(true)
      expect(Object.isFrozen(definition.revealedInformation)).toBe(true)
    }
    expect(moveReactionTimingDefinition('pre-hit').revealedInformation)
      .not.toContain('hit-outcomes')
    expect(moveReactionTimingDefinition('post-hit').revealedInformation)
      .toContain('hit-outcomes')
    expect(moveReactionTimingDefinition('pre-damage').revealedInformation)
      .not.toContain('damage-outcomes')
    expect(moveReactionTimingDefinition('post-damage').revealedInformation)
      .toContain('damage-outcomes')
  })

  it('binds post-fact checkpoints to authoritative encounter events only', () => {
    const expected = new Map<EncounterEventKind, string>([
      ['move-declared', 'declare'],
      ['move-hit', 'post-hit'],
      ['move-damaged', 'post-damage'],
      ['move-ko', 'ko'],
      ['placement-moving', 'movement-step'],
      ['switch', 'switch'],
      ['move-completed', 'cleanup'],
    ])

    for (const kind of ENCOUNTER_EVENT_KINDS) {
      expect(encounterEventReactionTiming({ kind })).toBe(expected.get(kind) ?? null)
    }
  })

  it('defines stable simultaneous priority, pass, and nesting semantics', () => {
    const windows = [
      { operationId: 'operation.low', timing: 'pre-hit' as const, priority: 1 },
      { operationId: 'operation.z-high', timing: 'pre-hit' as const, priority: 5 },
      { operationId: 'operation.a-high', timing: 'pre-hit' as const, priority: 5 },
    ]
    expect([...windows].sort(compareMoveReactionOrder).map(window => window.operationId))
      .toEqual(['operation.a-high', 'operation.z-high', 'operation.low'])
    expect(MOVE_REACTION_PASS_SEMANTICS).toEqual({
      outcome: 'decline-current-window',
      closesCurrentWindow: true,
      consumesReactionResource: false,
      resumesAtNextPriority: true,
      sameCheckpointReopen: 'new-causal-fact-only',
    })
    expect(MOVE_REACTION_LIMITS).toEqual({
      priorityMagnitude: 1_000,
      nestedWindowDepth: 8,
    })
  })
})
