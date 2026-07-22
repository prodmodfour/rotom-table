import { AA068_DUST_CLOUD_BURST_BRANCH_ID } from '#shared/abilityAutomation/mechanics'
import type { MoveAutomationScript, MoveAutomationTargetBranch } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import { moveAutomationTargetBranches } from './moveAutomationTargetBranches'

const normalized = (value: string): string => value.trim().toLowerCase()

/** Presentation-only branch projection; authoritative resolution revalidates the effective Ability. */
export const moveAutomationDustCloudScript = (input: {
  readonly script: MoveAutomationScript
  readonly user: Pick<SpawnedPokemon, 'abilityNames'>
}): MoveAutomationScript => {
  const active = (input.user.abilityNames ?? []).some(name => normalized(name) === 'dust cloud')
  const powder = input.script.keywords.some(keyword => normalized(keyword) === 'powder')
  if (!active || !powder) return input.script
  const branches = moveAutomationTargetBranches(input.script)
  if (branches.some(branch => branch.id === AA068_DUST_CLOUD_BURST_BRANCH_ID)) return input.script
  const burst: MoveAutomationTargetBranch = {
    id: AA068_DUST_CLOUD_BURST_BRANCH_ID,
    label: 'Dust Cloud — Burst 1',
    targetMode: 'multi-target',
    targetCount: null,
    range: 'Burst 1',
    areaTemplates: [{ kind: 'burst', size: 1, label: 'Burst 1' }],
  }
  return {
    ...input.script,
    targetBranches: [...branches, burst],
  }
}
