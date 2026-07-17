import { describe, expect, it } from 'vitest'
import { projectEncounterMoveList } from '#shared/moveAutomation/moveListOverlays'
import { applyEncounterEffectLifecycleEvent } from '~~/server/domain/moveAutomation/effectLifecycle'
import {
  capabilityEncounterEffectFixture,
  moveListOverlayEncounterEffectFixture,
} from '../fixtures/moveAutomation/encounterEffects'

const overlay = (
  id: string,
  payload: ReturnType<typeof moveListOverlayEncounterEffectFixture>['payload'],
  overrides: Partial<ReturnType<typeof moveListOverlayEncounterEffectFixture>> = {},
) => ({
  ...moveListOverlayEncounterEffectFixture(payload),
  id,
  ...overrides,
})

describe('encounter-local move-list projection', () => {
  it('applies add and replace mutations before disable and restriction gates', () => {
    const effects = [
      overlay('effect.move-list.replace', {
        action: 'replace',
        replacedCanonicalMoveId: 'Mimic',
        canonicalMoveId: 'Scratch',
        copiedSpecHash: '1'.repeat(64),
      }),
      overlay('effect.move-list.add', {
        action: 'add',
        canonicalMoveId: 'Swords Dance',
        copiedSpecHash: '2'.repeat(64),
      }),
      overlay('effect.move-list.disable', {
        action: 'disable',
        canonicalMoveIds: ['Tackle'],
      }),
      overlay('effect.move-list.restrict', {
        action: 'restrict',
        canonicalMoveIds: ['Tackle', 'Scratch', 'Swords Dance'],
      }),
    ]
    const input = {
      placementId: 'target-token',
      baseCanonicalMoveIds: ['Tackle', 'Mimic', 'Growl'],
      effects,
    }
    const before = structuredClone(input)

    const projected = projectEncounterMoveList(input)

    expect(input).toEqual(before)
    expect(projected.map(entry => entry.canonicalMoveId)).toEqual([
      'Tackle',
      'Scratch',
      'Growl',
      'Swords Dance',
    ])
    expect(projected[0]).toMatchObject({
      source: { kind: 'placement', placementId: 'target-token' },
      available: false,
      blockReason: 'move-list-disabled',
      blockingEffectIds: ['effect.move-list.disable'],
    })
    expect(projected[1]).toMatchObject({
      baseIndex: null,
      source: {
        kind: 'encounter-overlay',
        effectId: 'effect.move-list.replace',
        sourcePlacementId: 'actor-token',
        copiedSpecHash: '1'.repeat(64),
      },
      available: true,
    })
    expect(projected[2]).toMatchObject({
      available: false,
      blockReason: 'move-list-restricted',
      blockingEffectIds: ['effect.move-list.restrict'],
    })
    expect(projected[3]).toMatchObject({
      source: {
        kind: 'encounter-overlay',
        effectId: 'effect.move-list.add',
        copiedSpecHash: '2'.repeat(64),
      },
      available: true,
    })
    expect(Object.isFrozen(projected)).toBe(true)
    expect(Object.isFrozen(projected[1]?.source)).toBe(true)
  })

  it('applies side-owned overlays, intersects restrictions, and ignores other or suppressed targets', () => {
    const suppressor = {
      ...capabilityEncounterEffectFixture(),
      id: 'effect.move-list.suppressor',
    }
    const effects = [
      overlay('effect.move-list.side-restrict', {
        action: 'restrict',
        canonicalMoveIds: ['Tackle', 'Ember'],
      }, {
        affected: { placementIds: [], sideIds: ['red'], cells: [] },
      }),
      overlay('effect.move-list.direct-restrict', {
        action: 'restrict',
        canonicalMoveIds: ['Ember', 'Growl'],
      }),
      suppressor,
      overlay('effect.move-list.suppressed-disable', {
        action: 'disable',
        canonicalMoveIds: ['Ember'],
      }, {
        suppression: {
          sources: [{
            effectId: suppressor.id,
            reasonCode: 'move-list.test-suppressed',
          }],
        },
      }),
      overlay('effect.move-list.other-target', {
        action: 'disable',
        canonicalMoveIds: ['Ember'],
      }, {
        affected: { placementIds: ['other-token'], sideIds: [], cells: [] },
      }),
    ]

    const projected = projectEncounterMoveList({
      placementId: 'target-token',
      sideId: 'red',
      baseCanonicalMoveIds: ['Tackle', 'Ember', 'Growl'],
      effects,
    })

    expect(projected.map(entry => ({
      move: entry.canonicalMoveId,
      available: entry.available,
      reason: entry.blockReason,
    }))).toEqual([
      { move: 'Tackle', available: false, reason: 'move-list-restricted' },
      { move: 'Ember', available: true, reason: null },
      { move: 'Growl', available: false, reason: 'move-list-restricted' },
    ])
  })

  it('restores the underlying move list when lifecycle expiry removes an overlay', () => {
    const temporary = overlay('effect.move-list.one-turn-copy', {
      action: 'add',
      canonicalMoveId: 'Scratch',
      copiedSpecHash: '3'.repeat(64),
    }, {
      duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 1 },
    })
    const active = projectEncounterMoveList({
      placementId: 'target-token',
      baseCanonicalMoveIds: ['Tackle'],
      effects: [temporary],
    })
    const expired = applyEncounterEffectLifecycleEvent(
      { effects: [temporary] },
      { kind: 'turn-end', placementId: 'target-token' },
    )
    const restored = projectEncounterMoveList({
      placementId: 'target-token',
      baseCanonicalMoveIds: ['Tackle'],
      effects: expired.effects,
    })

    expect(active.map(entry => entry.canonicalMoveId)).toEqual(['Tackle', 'Scratch'])
    expect(expired.effects).toEqual([])
    expect(restored.map(entry => entry.canonicalMoveId)).toEqual(['Tackle'])
  })
})
