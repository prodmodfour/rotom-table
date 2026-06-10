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

    const reticle = scene.children.find((child) => child instanceof THREE.Object3D && child.visible) as (THREE.Object3D & { element?: HTMLElement }) | undefined
    expect(reticle?.element?.style.pointerEvents).toBe('none')
    expect(reticle?.element?.style.zIndex).toBe('20')

    expect(renderer.update({ ...updateOptions, show: false })).toBe(true)
    expect(renderer.update({ ...updateOptions, show: false })).toBe(false)

    renderer.dispose()
  })

  it('reports move feedback CSS changes and anchors roll/result phases correctly', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveAutomationFeedbackRenderer(scene)
    const user = makeRenderObject({ id: 'user-1', accentColor: '#33aaff' })
    const target = makeRenderObject({
      id: 'target-1',
      currentCenter: new THREE.Vector3(6, 4, 8),
      targetCenter: new THREE.Vector3(6, 4, 8),
      height: 1.8,
      clearance: 1.4,
    })
    const renderObjects = new Map([
      ['user-1', user],
      ['target-1', target],
    ])
    const feedback = feedbackState({ phase: 'rolling' })

    const updateOptions = {
      feedback,
      renderObjects,
      show: true,
    }

    expect(renderer.update(updateOptions)).toBe(true)
    expect(renderer.update(updateOptions)).toBe(false)

    const feedbackSprite = scene.children.find((child) => child instanceof THREE.Object3D && child.visible) as (THREE.Object3D & { element?: HTMLElement }) | undefined
    const rollBody = feedbackSprite?.element?.querySelector<HTMLElement>('.move-automation-roll')
    expect(rollBody?.innerHTML).toContain('move-automation-roll__d20')
    expect(rollBody?.className).toContain('is-rolling')
    expect((feedbackSprite?.element?.style as unknown as Record<string, string>)?.['--accent']).toBe('#33aaff')
    expect(feedbackSprite?.position.x).toBe(user.currentCenter.x)
    expect(feedbackSprite?.position.y).toBeCloseTo(user.currentCenter.y + Math.max(user.height, user.clearance) + 0.95)
    expect(feedbackSprite?.position.z).toBe(user.currentCenter.z)

    user.currentCenter.set(1, 3, 3)
    expect(renderer.update(updateOptions)).toBe(true)
    expect(renderer.update(updateOptions)).toBe(false)
    expect(feedbackSprite?.position.x).toBe(user.currentCenter.x)
    expect(feedbackSprite?.position.y).toBeCloseTo(user.currentCenter.y + Math.max(user.height, user.clearance) + 0.95)
    expect(feedbackSprite?.position.z).toBe(user.currentCenter.z)

    expect(renderer.update({
      ...updateOptions,
      feedback: feedbackState({ phase: 'hit-roll' }),
    })).toBe(true)
    expect(feedbackSprite?.position.x).toBe(user.currentCenter.x)
    expect(feedbackSprite?.position.y).toBeCloseTo(user.currentCenter.y + Math.max(user.height, user.clearance) + 0.95)
    expect(feedbackSprite?.position.z).toBe(user.currentCenter.z)

    expect(renderer.update({
      ...updateOptions,
      feedback: feedbackState({ phase: 'outcome' }),
    })).toBe(true)
    expect(feedbackSprite?.position.x).toBe(target.currentCenter.x)
    expect(feedbackSprite?.position.y).toBeCloseTo(target.currentCenter.y + Math.max(target.height, target.clearance) + 0.95)
    expect(feedbackSprite?.position.z).toBe(target.currentCenter.z)

    expect(renderer.update({
      ...updateOptions,
      feedback: feedbackState({ phase: 'damage', damageResolved: true, damageLoss: 9 }),
    })).toBe(true)
    expect(feedbackSprite?.position.x).toBe(target.currentCenter.x)
    expect(feedbackSprite?.position.y).toBeCloseTo(target.currentCenter.y + Math.max(target.height, target.clearance) + 0.95)
    expect(feedbackSprite?.position.z).toBe(target.currentCenter.z)
    expect(feedbackSprite?.element?.style.pointerEvents).toBe('none')
    expect(feedbackSprite?.element?.style.zIndex).toBe('30')

    expect(renderer.update({ ...updateOptions, show: false })).toBe(true)
    expect(renderer.update({ ...updateOptions, show: false })).toBe(false)

    renderer.dispose()
  })
})
