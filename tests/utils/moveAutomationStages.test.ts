import { describe, expect, it } from 'vitest'
import {
  moveAutomationStageKeyLabel,
  moveAutomationStatNameToKey,
  parseMoveAutomationStageSuggestions,
  parseMoveAutomationStatsList,
} from '~/utils/moveAutomationStages'
import {
  effectThresholdNear,
  normalizeMoveAutomationWhitespace,
  splitMoveRangeKeywords,
  textIncludes,
} from '~/utils/moveAutomationText'

describe('move automation text and stage helpers', () => {
  it('normalizes shared move text primitives', () => {
    expect(normalizeMoveAutomationWhitespace('  Melee,\n  1 Target  ')).toBe('Melee, 1 Target')
    expect(splitMoveRangeKeywords('Melee, 1 Target; Set-Up')).toEqual(['Melee', '1 Target', 'Set-Up'])
    expect(textIncludes('Hazard, Burst 1', 'hazard')).toBe(true)
    expect(textIncludes('Hazard, Burst 1', /Burst\s+1/)).toBe(true)
    expect(effectThresholdNear('On 15+, the target is Burned.', 16)).toBe('15+')
    expect(effectThresholdNear('Even-Numbered rolls lower Speed.', 24)).toBe('even roll')
  })

  it('maps stat names and grouped stat lists to combat-stage keys', () => {
    expect(moveAutomationStatNameToKey('Sp. Atk')).toBe('satk')
    expect(moveAutomationStatNameToKey('Accuracy')).toBe('acc')
    expect(moveAutomationStatNameToKey('unknown')).toBeNull()
    expect(moveAutomationStageKeyLabel('sdef')).toBe('Special Defense')
    expect(parseMoveAutomationStatsList('Attack and Defense / Speed')).toEqual(['atk', 'def', 'spd'])
    expect(parseMoveAutomationStatsList('each of its stats')).toEqual(['atk', 'def', 'satk', 'sdef', 'spd'])
  })

  it('extracts target debuffs with nearby thresholds', () => {
    const suggestions = parseMoveAutomationStageSuggestions("On 15+, the target's Defense is lowered by 1 Combat Stage.")

    expect(suggestions).toEqual([
      expect.objectContaining({
        recipient: 'target',
        key: 'def',
        delta: -1,
        optional: true,
        threshold: '15+',
      }),
    ])
    expect(suggestions[0]?.label).toContain("target's Defense is lowered by 1 Combat Stage: -1 Defense CS")
  })

  it('extracts user buffs and de-duplicates equivalent suggestions', () => {
    const suggestions = parseMoveAutomationStageSuggestions(
      'Raises the user\'s Attack and Defense by +1 Combat Stage. Attack and Defense by +1 Combat Stage each.',
    )

    expect(suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ recipient: 'user', key: 'atk', delta: 1 }),
      expect.objectContaining({ recipient: 'user', key: 'def', delta: 1 }),
    ]))
    expect(suggestions.filter((item) => item.key === 'atk' && item.delta === 1)).toHaveLength(1)
    expect(suggestions.filter((item) => item.key === 'def' && item.delta === 1)).toHaveLength(1)
  })
})
