import { describe, expect, it } from 'vitest'
import {
  buildMoxieTriggerPrompts,
  buildMoxieTriggerTransaction,
  tokenHasMoxie,
} from '~/utils/moveAutomationMoxie'
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

describe('Moxie move automation helpers', () => {
  it('detects Moxie on token ability names', () => {
    expect(tokenHasMoxie(token('sandile', { abilityNames: ['Moxie'] }))).toBe(true)
    expect(tokenHasMoxie(token('sandile', { abilityNames: ['Intimidate'] }))).toBe(false)
  })

  it('builds one prompt when a Moxie user faints one or more hit targets', () => {
    const attacker = token('attacker', { species: 'Attacker', abilityNames: ['Moxie'] })
    const firstTarget = token('first', { species: 'First Target', currentHp: 4 })
    const secondTarget = token('second', { species: 'Second Target', currentHp: 1 })

    const prompts = buildMoxieTriggerPrompts({
      attacker,
      moveName: 'Bite',
      hpUpdates: [
        { id: firstTarget.id, currentHp: 0 },
        { id: secondTarget.id, currentHp: 0 },
      ],
      hitTargetIds: [firstTarget.id, secondTarget.id],
      tokens: [attacker, firstTarget, secondTarget],
      idFactory: () => 'moxie-id',
    })

    expect(prompts).toEqual([{
      id: 'moxie-id',
      attackerId: 'attacker',
      attackerName: 'Attacker',
      moveName: 'Bite',
      faintedTargetIds: ['first', 'second'],
      faintedTargetNames: ['First Target', 'Second Target'],
    }])
  })

  it('ignores fainting updates without Moxie or from missed targets', () => {
    const attacker = token('attacker', { abilityNames: ['Moxie'] })
    const missedTarget = token('missed', { currentHp: 4 })

    expect(buildMoxieTriggerPrompts({
      attacker: token('plain'),
      moveName: 'Bite',
      hpUpdates: [{ id: missedTarget.id, currentHp: 0 }],
      tokens: [missedTarget],
    })).toEqual([])

    expect(buildMoxieTriggerPrompts({
      attacker,
      moveName: 'Bite',
      hpUpdates: [{ id: missedTarget.id, currentHp: 0 }],
      hitTargetIds: ['other-target'],
      tokens: [attacker, missedTarget],
    })).toEqual([])
  })

  it('builds the self Attack stage transaction for applying Moxie', () => {
    const attacker = token('attacker', { combatStages: stages({ atk: 5 }) })

    expect(buildMoxieTriggerTransaction(attacker)).toMatchObject({
      abilityName: 'Moxie',
      combatStageUpdates: [{ id: 'attacker', stages: { atk: 6 } }],
    })
  })
})
