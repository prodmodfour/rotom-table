import { describe, expect, it } from 'vitest'
import { AA068_DUST_CLOUD_BURST_BRANCH_ID } from '#shared/abilityAutomation/mechanics'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { moveAutomationDustCloudScript } from '~/utils/moveAutomationDustCloud'

const script = (keywords: readonly string[] = ['Powder']): MoveAutomationScript => ({
  kind: 'explicit', moveName: 'Poison Powder', version: 1,
  targetMode: 'one-target', targetCount: 1, damaging: false, requiresAccuracy: true,
  damageBase: 0, damageClass: 'Status', type: 'Poison', ac: 6,
  range: '4, 1 Target, Powder', effect: '', special: '', keywords: [...keywords],
  criticalRange: null, areaTemplates: [], conditionSuggestions: [], stageSuggestions: [],
  hpSuggestions: [], fieldSuggestions: [], hazardSuggestions: [], automationNotes: [],
})

describe('moveAutomationDustCloudScript', () => {
  it('offers the Burst 1 branch only for a displayed Dust Cloud owner using a Powder Move', () => {
    expect(moveAutomationDustCloudScript({
      script: script(), user: { abilityNames: ['Dust Cloud'] },
    }).targetBranches).toContainEqual(expect.objectContaining({
      id: AA068_DUST_CLOUD_BURST_BRANCH_ID,
      range: 'Burst 1',
      areaTemplates: [{ kind: 'burst', size: 1, label: 'Burst 1' }],
    }))
    expect(moveAutomationDustCloudScript({
      script: script(), user: { abilityNames: [] },
    }).targetBranches).toBeUndefined()
    expect(moveAutomationDustCloudScript({
      script: script([]), user: { abilityNames: ['Dust Cloud'] },
    }).targetBranches).toBeUndefined()
  })
})
