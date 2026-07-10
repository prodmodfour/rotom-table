import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayCommandAccepted,
  type LivePlayCommandResult,
} from '#shared/livePlayCommands'
import {
  LIVE_PLAY_RESOLVED_MOVE_RESULT_SCHEMA_VERSION,
  type LivePlayResolvedMoveResult,
} from '#shared/livePlayMoveResolution'
import { createLivePlayMovePresentationSummary } from '#shared/livePlayMovePresentation'
import { extractAcceptedMovePresentation } from '~/utils/livePlayAcceptedMovePresentation'
import { extractResolvedMoveResult } from '~/utils/livePlayResolvedMoveResponse'
import type { MoveAutomationScript } from '~/types/moveAutomation'

const script = (): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Thunderbolt',
  version: 1,
  targetMode: 'one-target',
  targetCount: null,
  damaging: true,
  requiresAccuracy: true,
  damageBase: 6,
  damageClass: 'Special',
  type: 'Electric',
  ac: 2,
  range: '6, 1 Target',
  effect: '',
  keywords: [],
  criticalRange: 20,
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
})

const resolvedMove = (overrides: Partial<LivePlayResolvedMoveResult> = {}): LivePlayResolvedMoveResult => ({
  schemaVersion: LIVE_PLAY_RESOLVED_MOVE_RESULT_SCHEMA_VERSION,
  actorPlacementId: 'actor',
  moveName: 'Thunderbolt',
  canonicalMoveName: 'Thunderbolt',
  moveKey: 'thunderbolt',
  frequency: 'At-Will',
  damageFormula: '2d6+8',
  selectedTargetIds: ['target-a'],
  script: script(),
  transaction: {
    userId: 'actor',
    userName: 'Pikachu',
    moveName: 'Thunderbolt',
    scriptKind: 'explicit',
    scriptVersion: 1,
    attackedTargetIds: ['target-a'],
    hitTargetIds: ['target-a'],
    hpUpdates: [{ id: 'target-a', currentHp: 12 }],
    conditionUpdates: [],
    combatStageUpdates: [],
    hazardsToAdd: [],
    fieldEffectsToApply: [],
    logLines: ['Pikachu used Thunderbolt!'],
  },
  feedback: {
    id: 'feedback-1',
    userId: 'actor',
    targetId: 'target-a',
    moveName: 'Thunderbolt',
    phase: 'outcome',
    naturalRoll: 17,
    modifiedRoll: 19,
    accuracyCheck: 2,
    userAccuracy: 2,
    targetEvasion: 0,
    targetEvasionLabel: '0',
    hit: true,
    crit: false,
    effectiveness: null,
    damageResolved: true,
    damageLoss: 18,
    conditions: [],
  },
  ...overrides,
  rollLedger: overrides.rollLedger ?? [],
})

const accepted = (move = resolvedMove(), patchesMove: unknown = move): LivePlayCommandAccepted => ({
  ok: true,
  opId: 'op_resolve001',
  mapSlug: 'arena-map',
  previousRevision: 4,
  revision: 5,
  patches: [
    {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      type: LIVE_PLAY_PATCH_TYPES.MOVE_STATE,
      mapSlug: 'arena-map',
      revision: 5,
      scopes: [{ kind: 'token', placementId: 'actor', field: 'action' }],
      payload: {
        command: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
        updatedAt: 1_000,
        move: patchesMove,
        ...(patchesMove === move ? {
          presentation: createLivePlayMovePresentationSummary({
            operationId: 'op_resolve001',
            move,
          }),
        } : {}),
        sheets: [],
        changes: {},
      },
    },
  ],
})

describe('extractResolvedMoveResult', () => {
  it('returns matching response and MOVE_STATE patch presentation data', () => {
    const move = resolvedMove()
    const response = { ...accepted(move), move }

    const result = extractResolvedMoveResult(response)

    expect(result).toMatchObject({ ok: true, source: 'both' })
    if (!result.ok) return
    expect(result.move).toEqual(move)
    expect(result.move).not.toBe(move)
  })

  it('recovers a valid move result from the MOVE_STATE patch when response.move is absent', () => {
    const move = resolvedMove()
    const result = extractResolvedMoveResult(accepted(move))

    expect(result).toMatchObject({ ok: true, source: 'patch', move })
  })

  it('recovers duplicate accepted responses from the original accepted result and top-level move', () => {
    const move = resolvedMove()
    const response: LivePlayCommandResult & { move: LivePlayResolvedMoveResult } = {
      ok: true,
      duplicate: true,
      opId: 'op_resolve001',
      original: accepted(move),
      move,
    }

    const result = extractResolvedMoveResult(response)

    expect(result).toMatchObject({ ok: true, source: 'both', move })
  })

  it('accepts response-only move data when no MOVE_STATE patch is present', () => {
    const move = resolvedMove()
    const response = { ...accepted(move), patches: [], move }

    const result = extractResolvedMoveResult(response)

    expect(result).toMatchObject({ ok: true, source: 'response', move })
  })

  it('reports mismatched response and patch results as an invariant error', () => {
    const response = {
      ...accepted(resolvedMove(), resolvedMove({ selectedTargetIds: ['target-b'] })),
      move: resolvedMove(),
    }

    const result = extractResolvedMoveResult(response)

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('do not match') })
  })

  it('rejects malformed or missing MOVE_STATE presentation data', () => {
    expect(extractResolvedMoveResult({ ...accepted(), move: { invalid: true } })).toMatchObject({
      ok: false,
      message: expect.stringContaining('response.move'),
    })

    expect(extractResolvedMoveResult({
      ...accepted(),
      patches: [
        {
          schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
          type: LIVE_PLAY_PATCH_TYPES.MOVE_STATE,
          mapSlug: 'arena-map',
          revision: 5,
          scopes: [{ kind: 'token', placementId: 'actor', field: 'action' }],
          payload: { command: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE },
        },
      ],
    })).toMatchObject({ ok: false, message: expect.stringContaining('did not contain') })

    expect(extractResolvedMoveResult({ ...accepted(), patches: [] })).toMatchObject({
      ok: false,
      message: expect.stringContaining('did not include usable presentation data'),
    })
  })

  it('rejects multiple MOVE_STATE patches and rejected command responses', () => {
    const move = resolvedMove()
    const base = accepted(move)
    expect(extractResolvedMoveResult({
      ...base,
      patches: [...base.patches, ...base.patches],
    })).toMatchObject({ ok: false, message: expect.stringContaining('exactly one') })

    expect(extractResolvedMoveResult({
      ok: false,
      opId: 'op_resolve001',
      mapSlug: 'arena-map',
      reason: 'invalid',
      message: 'Nope',
    })).toMatchObject({ ok: false, message: expect.stringContaining('not accepted') })
  })

  it('extracts the bounded accepted presentation from original and duplicate terminal results', () => {
    const move = resolvedMove()
    const original = accepted(move)
    const presentation = createLivePlayMovePresentationSummary({
      operationId: original.opId,
      move,
    })

    expect(extractAcceptedMovePresentation(original)).toEqual({ ok: true, presentation })
    expect(extractAcceptedMovePresentation({
      ok: true,
      duplicate: true,
      opId: original.opId,
      original,
    })).toEqual({ ok: true, presentation })
    expect(extractAcceptedMovePresentation({
      ...original,
      opId: 'op_resolve999',
    })).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('returns detached data without mutating the response or patch objects', () => {
    const move = resolvedMove()
    const response = { ...accepted(move), move }
    const before = JSON.stringify(response)

    const result = extractResolvedMoveResult(response)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    ;(result.move.selectedTargetIds as string[]).push('mutated')
    ;(result.move.transaction.logLines as string[]).push('mutated')

    expect(JSON.stringify(response)).toBe(before)
  })
})
