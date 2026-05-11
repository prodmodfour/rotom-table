import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { normalizeCombatStages } from '~/utils/combatStages'
import {
  activeCombatStageEntries,
  formatCombatStage,
  formatElevationDelta,
  formatTokenLevel,
  getElevationBadgeOffset,
  hpTierForRatio,
  mapSpecificY,
  tokenStatusCssHeight,
  tokenStatusNameWords,
} from '~/utils/isometric/tokenHudMetrics'

describe('token HUD metrics', () => {
  it('formats elevation and level labels with existing token HUD semantics', () => {
    expect(mapSpecificY(4.6, 2)).toBe(3)
    expect(formatElevationDelta(2)).toBe('+2 ↑')
    expect(formatElevationDelta(0)).toBe('0 ↓')
    expect(formatElevationDelta(-1)).toBe('-1 ↓')
    expect(formatTokenLevel(17.9)).toBe('17')
    expect(formatTokenLevel(0)).toBe('1')
    expect(formatTokenLevel(Number.NaN)).toBe('?')
  })

  it('positions elevation badges toward the camera-facing footprint corner', () => {
    const center = new THREE.Vector3(5, 0, 5)
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(2, 10, 8)

    expect(getElevationBadgeOffset(center, 2, null).x).toBeCloseTo(0.82)
    expect(getElevationBadgeOffset(center, 2, null).z).toBeCloseTo(0.82)
    expect(getElevationBadgeOffset(center, 2, camera).x).toBeCloseTo(-0.82)
    expect(getElevationBadgeOffset(center, 2, camera).z).toBeCloseTo(0.82)
    expect(getElevationBadgeOffset(center, 0.4, null)).toEqual({ x: 0.1, z: 0.1 })
  })

  it('normalizes name words and active combat stage presentation', () => {
    expect(tokenStatusNameWords('  Mega  Gengar  ')).toEqual(['Mega', 'Gengar'])
    expect(tokenStatusNameWords('   ')).toEqual(['Unknown'])
    expect(formatCombatStage(3)).toBe('+3')
    expect(formatCombatStage('-9')).toBe('-6')

    expect(activeCombatStageEntries(normalizeCombatStages({ atk: 2, def: 0, acc: -1 }))).toEqual([
      { key: 'atk', value: 2 },
      { key: 'acc', value: -1 },
    ])
  })

  it('derives compact status HUD heights from labels, stages, conditions, and turn state', () => {
    const stages = normalizeCombatStages({ atk: 1, def: -1, spd: 2 })

    expect(tokenStatusCssHeight('Pikachu', normalizeCombatStages(), [], false)).toBe(18)
    expect(tokenStatusCssHeight('Mega Gengar', stages, ['Burned', 'Poisoned', 'Burned'], true)).toBe(85)
  })

  it('classifies HP ratios into existing token HUD tiers', () => {
    expect(hpTierForRatio(0.25)).toBe('critical')
    expect(hpTierForRatio(0.5)).toBe('wounded')
    expect(hpTierForRatio(0.51)).toBe('healthy')
  })
})
