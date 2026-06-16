import { describe, expect, it } from 'vitest'
import { moveAutomationMoveImmunitySource } from '~/utils/moveAutomationMoveImmunity'
import {
  GROUNDSOURCE_IMMUNITY_SUPPRESSED_CONDITION,
  ROOST_GROUNDED_CONDITION,
  SMACK_DOWN_GROUNDED_CONDITION,
} from '~/utils/moveAutomationSpecialConditions'
import type { CombatStageMap } from '~/types/combatStages'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

const stages: CombatStageMap = { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 }

const script = (overrides: Partial<MoveAutomationScript> = {}): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Test Move',
  version: 2,
  targetMode: 'one-target',
  targetCount: 1,
  damaging: false,
  requiresAccuracy: true,
  damageBase: null,
  damageClass: 'Status',
  type: 'Normal',
  ac: 2,
  range: '4, 1 Target',
  effect: '',
  keywords: [],
  criticalRange: null,
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
  ...overrides,
})

const token = (overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
  id: 'target',
  species: 'Target',
  slug: 'target',
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/sprite.png',
  entityKind: 'pokemon',
  position: { x: 0, y: 0, z: 0 },
  sheetKind: 'pokemon',
  sheetSlug: 'target',
  level: 10,
  currentHp: 30,
  maxHp: 30,
  atk: 5,
  satk: 5,
  def: 5,
  sdef: 5,
  spd: 5,
  evasion: { physical: 0, special: 0, speed: 0 },
  defenderTypes: ['Normal'],
  combatStages: stages,
  conditions: [],
  tokenItems: [],
  ...overrides,
})

describe('move automation move immunity', () => {
  it('blocks Powder-keyword move effects on Grass targets only', () => {
    expect(moveAutomationMoveImmunitySource(
      script({ keywords: ['Powder'] }),
      token({ defenderTypes: ['Grass'] }),
    )).toBe('Grass type (Powder)')

    expect(moveAutomationMoveImmunitySource(
      script({ keywords: ['Powder'] }),
      token({ defenderTypes: ['Normal'] }),
    )).toBeNull()
  })

  it('preserves Groundsource Sky/Levitate capability immunity unless grounded markers suppress it', () => {
    const groundsource = script({ keywords: ['Groundsource'] })
    const airborne = token({ defenderCapabilities: { sky: 6, levitate: 4 } })

    expect(moveAutomationMoveImmunitySource(groundsource, airborne)).toBe('Sky/Levitate Capability')

    for (const condition of [
      ROOST_GROUNDED_CONDITION,
      SMACK_DOWN_GROUNDED_CONDITION,
      GROUNDSOURCE_IMMUNITY_SUPPRESSED_CONDITION,
    ]) {
      expect(moveAutomationMoveImmunitySource(
        groundsource,
        token({ defenderCapabilities: { sky: 6, levitate: 4 }, conditions: [condition] }),
      )).toBeNull()
    }
  })

  it('keeps Sonic Soundproof immunity unchanged', () => {
    expect(moveAutomationMoveImmunitySource(
      script({ keywords: ['Sonic'] }),
      token({ abilityNames: ['Soundproof'] }),
    )).toBe('Soundproof')
  })
})
