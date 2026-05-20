import { describe, expect, it } from 'vitest'
import {
  buildCelebrateTriggerPrompts,
  buildCelebrateTriggerTransaction,
  tokenHasCelebrate,
} from '~/utils/moveAutomationCelebrate'
import type { CombatStageMap } from '~/types/combatStages'
import type { SpawnedPokemon } from '~/types/pokemon'

const stages = (overrides: Partial<CombatStageMap> = {}): CombatStageMap => ({
  atk: 0,
  def: 0,
  satk: 0,
  sdef: 0,
  spd: 0,
  acc: 0,
  ...overrides,
})

const token = (id: string, overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
  id,
  species: id,
  slug: id,
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: `/${id}.png`,
  entityKind: 'pokemon',
  sheetKind: 'pokemon',
  sheetSlug: id,
  position: { x: 0, y: 0, z: 0 },
  level: 1,
  currentHp: 10,
  maxHp: 10,
  atk: 1,
  satk: 1,
  def: 1,
  sdef: 1,
  defenderTypes: [],
  combatStages: stages(),
  conditions: [],
  tokenItems: [],
  ...overrides,
} as SpawnedPokemon)

describe('Celebrate move automation helpers', () => {
  it('detects Celebrate on token ability names', () => {
    expect(tokenHasCelebrate(token('furfrou', { abilityNames: ['Celebrate'] }))).toBe(true)
    expect(tokenHasCelebrate(token('furfrou', { abilityNames: ['Intimidate'] }))).toBe(false)
  })

  it('builds one prompt when a Celebrate user hits targets with a damaging attack', () => {
    const attacker = token('attacker', { species: 'Attacker', abilityNames: ['Celebrate'] })
    const firstTarget = token('first', { species: 'First Target' })
    const secondTarget = token('second', { species: 'Second Target' })

    const prompts = buildCelebrateTriggerPrompts({
      attacker,
      moveName: 'Tackle',
      damaging: true,
      hitTargets: [firstTarget, secondTarget],
      idFactory: () => 'celebrate-id',
    })

    expect(prompts).toEqual([{
      id: 'celebrate-id',
      attackerId: 'attacker',
      attackerName: 'Attacker',
      moveName: 'Tackle',
      hitTargetIds: ['first', 'second'],
      hitTargetNames: ['First Target', 'Second Target'],
    }])
  })

  it('ignores non-damaging moves, self hits, and users without Celebrate', () => {
    const attacker = token('attacker', { abilityNames: ['Celebrate'] })
    const target = token('target')

    expect(buildCelebrateTriggerPrompts({
      attacker,
      moveName: 'Will-O-Wisp',
      damaging: false,
      hitTargets: [target],
    })).toEqual([])

    expect(buildCelebrateTriggerPrompts({
      attacker,
      moveName: 'Tackle',
      damaging: true,
      hitTargets: [attacker],
    })).toEqual([])

    expect(buildCelebrateTriggerPrompts({
      attacker: token('plain'),
      moveName: 'Tackle',
      damaging: true,
      hitTargets: [target],
    })).toEqual([])
  })

  it('builds a no-mutation ability transaction for applying Celebrate', () => {
    const attacker = token('attacker', { species: 'Attacker' })
    const target = token('target', { species: 'Target' })

    expect(buildCelebrateTriggerTransaction(attacker, target)).toMatchObject({
      abilityName: 'Celebrate',
      combatStageUpdates: [],
      conditionUpdates: [],
      logLines: [
        'Attacker triggered Celebrate after hitting Target.',
        'Attacker may immediately Disengage 1 meter as a Free Action without provoking an Attack of Opportunity.',
      ],
    })
  })
})
