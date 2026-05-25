import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MoveAutomationFeedbackState, MoveAutomationTargetHitChance } from '~/types/moveAutomation'
import type { PokemonRenderObject } from '~/utils/isometric/types'
import {
  createMoveAutomationFeedbackRenderer,
  createMoveTargetingReticleRenderer,
} from '~/utils/isometric/moveAutomationOverlays'
import { installFakeDom } from './fakeDom'

const makeRenderObject = (overrides: Partial<PokemonRenderObject> = {}): PokemonRenderObject => ({
  id: 'target-1',
  currentCenter: new THREE.Vector3(1, 2, 3),
  targetCenter: new THREE.Vector3(1, 2, 3),
  base: 1,
  height: 1.2,
  clearance: 1.1,
  ...overrides,
}) as PokemonRenderObject

const hitChance = (overrides: Partial<MoveAutomationTargetHitChance> = {}): MoveAutomationTargetHitChance => ({
  targetId: 'target-1',
  percent: 75,
  label: '75%',
  tone: 'high',
  title: '75% to hit',
  ...overrides,
})

const feedbackState = (overrides: Partial<MoveAutomationFeedbackState> = {}): MoveAutomationFeedbackState => ({
  id: 'feedback-1',
  userId: 'user-1',
  targetId: 'target-1',
  moveName: 'Tackle',
  phase: 'hit-roll',
  naturalRoll: 12,
  modifiedRoll: 14,
  accuracyCheck: 2,
  userAccuracy: 1,
  targetEvasion: 0,
  targetEvasionLabel: 'Physical Evasion',
  hit: true,
  crit: false,
  effectiveness: null,
  damageResolved: false,
  damageLoss: 0,
  conditions: [],
  ...overrides,
})

beforeEach(() => {
  installFakeDom()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('move automation CSS overlay renderers', () => {
  it('reports move-target reticle CSS changes and skips repeated identical output', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveTargetingReticleRenderer(scene)
    const target = makeRenderObject()
    const renderObjects = new Map([['target-1', target]])

    const updateOptions = {
      candidateIds: ['target-1'],
      hitChances: { 'target-1': hitChance() },
      selectedIds: ['target-1'],
      renderObjects,
      show: true,
    }

    expect(renderer.update(updateOptions)).toBe(true)
    expect(renderer.update(updateOptions)).toBe(false)

    target.currentCenter.set(2, 2, 3)
    expect(renderer.update(updateOptions)).toBe(true)
    expect(renderer.update(updateOptions)).toBe(false)

    expect(renderer.update({
      ...updateOptions,
      selectedIds: [],
      hitChances: { 'target-1': hitChance({ tone: 'medium', label: '50%', percent: 50, title: '50% to hit' }) },
    })).toBe(true)

    expect(renderer.update({ ...updateOptions, show: false })).toBe(true)
    expect(renderer.update({ ...updateOptions, show: false })).toBe(false)

    renderer.dispose()
  })

  it('reports move feedback CSS changes and skips repeated identical output', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveAutomationFeedbackRenderer(scene)
    const user = makeRenderObject({ id: 'user-1' })
    const renderObjects = new Map([['user-1', user]])
    const feedback = feedbackState()

    const updateOptions = {
      feedback,
      renderObjects,
      show: true,
    }

    expect(renderer.update(updateOptions)).toBe(true)
    expect(renderer.update(updateOptions)).toBe(false)

    user.currentCenter.set(1, 3, 3)
    expect(renderer.update(updateOptions)).toBe(true)
    expect(renderer.update(updateOptions)).toBe(false)

    expect(renderer.update({
      ...updateOptions,
      feedback: feedbackState({ phase: 'damage', damageResolved: true, damageLoss: 9 }),
    })).toBe(true)

    expect(renderer.update({ ...updateOptions, show: false })).toBe(true)
    expect(renderer.update({ ...updateOptions, show: false })).toBe(false)

    renderer.dispose()
  })
})
