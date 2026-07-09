import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  attackOfOpportunityStruggleOptions,
  canMakeAttackOfOpportunity,
  movementAttackOfOpportunityAttackerIds,
  rangedAttackOfOpportunityAttackerIds,
  tokensAreAdjacent,
  useAttackOfOpportunityPanel,
} from '~/utils/attackOfOpportunity'
import {
  ATTACK_OF_OPPORTUNITY_ASSISTANCE_NOTICE,
  LOCAL_ASSISTED_FOLLOW_UP_NAMES,
  attackOfOpportunityAssistedFollowUpTitle,
} from '~/utils/moveAutomationAssistedFollowUps'
import type { TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TokenMoveMenuOption } from '~/utils/mapTokenMoves'

const token = (id: string, x: number, z: number, overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
  id,
  species: id,
  slug: id,
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/sprite.png',
  entityKind: 'pokemon',
  position: { x, y: 0, z },
  sheetKind: 'pokemon',
  sheetSlug: id,
  level: 5,
  currentHp: 20,
  maxHp: 20,
  atk: 8,
  satk: 8,
  def: 5,
  sdef: 5,
  defenderTypes: [],
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  conditions: [],
  tokenItems: [],
  ...overrides,
})

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'aoo-test',
  name: 'AoO Test',
  dimensions: { x: 8, y: 3, z: 8 },
  voxels: [],
  placements: [],
  initiative: { round: 1, activeId: null },
})

const moveOption = (name: string, overrides: Partial<TokenMoveMenuOption> = {}): TokenMoveMenuOption => ({
  name,
  type: 'Normal',
  damageClass: 'Physical',
  frequency: 'At-Will',
  ac: 4,
  range: 'Melee, 1 Target',
  effect: null,
  special: null,
  damageBase: 4,
  hasStab: false,
  damageAverage: 18.5,
  damageFormula: '1d8+6+8',
  attackStat: 8,
  baseAttackStat: 8,
  attackStage: 0,
  attackStatKey: 'atk',
  attackStatLabel: 'Attack',
  attackStatAbility: null,
  additionalAttackStat: null,
  additionalBaseAttackStat: null,
  additionalAttackStage: null,
  additionalAttackStatKey: null,
  additionalAttackStatLabel: null,
  automatic: true,
  hasAutomationScript: true,
  conditionUseBlock: null,
  disabledByCondition: false,
  usage: null,
  disabledByUsage: false,
  ...overrides,
})

describe('attack of opportunity helpers', () => {
  it('identifies every current local prompt and labels AoO as an assisted non-durable follow-up', () => {
    expect(LOCAL_ASSISTED_FOLLOW_UP_NAMES).toEqual([
      'Spite',
      'Cute Charm',
      'Poison Point',
      'Moxie',
      'Celebrate',
      'Attack of Opportunity',
    ])
    expect(ATTACK_OF_OPPORTUNITY_ASSISTANCE_NOTICE).toContain('after the provoking action')
    expect(ATTACK_OF_OPPORTUNITY_ASSISTANCE_NOTICE).toContain('not a durable interrupt')
    expect(ATTACK_OF_OPPORTUNITY_ASSISTANCE_NOTICE).toContain('do not rely on reconnect recovery')
    expect(attackOfOpportunityAssistedFollowUpTitle({
      attackerName: 'Machop',
      provokerName: 'Abra',
    })).toBe(
      `Machop has an assisted Attack of Opportunity follow-up against Abra. ${ATTACK_OF_OPPORTUNITY_ASSISTANCE_NOTICE} Right-click to clear this indicator.`,
    )
  })

  it('uses PTU footprint adjacency, including diagonals and larger bases', () => {
    expect(tokensAreAdjacent(token('left', 0, 0), token('right', 1, 1))).toBe(true)
    expect(tokensAreAdjacent(token('left', 0, 0), token('far', 2, 0))).toBe(false)
    expect(tokensAreAdjacent(token('large', 0, 0, { base: 2 }), token('right', 2, 1))).toBe(true)
  })

  it('finds adjacent tokens when a provoker shifts out of an adjacent square', () => {
    const tokens = [
      token('provoker', 1, 1),
      token('adjacent', 0, 1),
      token('distant', 4, 1),
    ]

    expect(movementAttackOfOpportunityAttackerIds({
      provokerId: 'provoker',
      from: { x: 1, y: 0, z: 1 },
      to: { x: 2, y: 0, z: 1 },
      tokens,
    })).toEqual(['adjacent'])

    expect(movementAttackOfOpportunityAttackerIds({
      provokerId: 'provoker',
      from: { x: 1, y: 0, z: 1 },
      to: { x: 1, y: 0, z: 1 },
      tokens,
    })).toEqual([])
  })

  it('finds adjacent tokens for ranged attacks unless someone adjacent is targeted', () => {
    const tokens = [
      token('provoker', 1, 1),
      token('adjacent', 0, 1),
      token('distant-target', 5, 1),
    ]

    expect(rangedAttackOfOpportunityAttackerIds({
      provokerId: 'provoker',
      targetIds: ['distant-target'],
      tokens,
    })).toEqual(['adjacent'])

    expect(rangedAttackOfOpportunityAttackerIds({
      provokerId: 'provoker',
      targetIds: ['adjacent'],
      tokens,
    })).toEqual([])
  })

  it('blocks attackers with AoO-preventing conditions', () => {
    expect(canMakeAttackOfOpportunity(token('ready', 0, 0))).toBe(true)
    expect(canMakeAttackOfOpportunity(token('sleeping', 0, 0, { conditions: ['Sleeping'] }))).toBe(false)
    expect(canMakeAttackOfOpportunity(token('confused', 0, 0, { conditions: ['Confused'] }))).toBe(false)
    expect(canMakeAttackOfOpportunity(token('fainted', 0, 0, { currentHp: 0 }))).toBe(false)
  })

  it('lists only automated usable Struggle variants', () => {
    expect(attackOfOpportunityStruggleOptions([
      moveOption('Struggle'),
      moveOption('Struggle (Zapper Special)'),
      moveOption('Tackle'),
      moveOption('Struggle (Fountain Physical)', { disabledByCondition: true }),
    ]).map((move) => move.name)).toEqual(['Struggle', 'Struggle (Zapper Special)'])
  })
})

describe('useAttackOfOpportunityPanel', () => {
  it('does not queue prompts suppressed by the table relationship policy', () => {
    const map = ref(mapFixture())
    const tokens = ref([
      token('provoker', 1, 1),
      token('attacker', 0, 1),
    ])
    const playerCharacterIds = new Set(['provoker', 'attacker'])
    const panel = useAttackOfOpportunityPanel({
      map,
      spawnedPokemon: computed(() => tokens.value),
      tokenMoveOptionsById: computed(() => ({
        attacker: [moveOption('Struggle')],
      })),
      canControlPlacement: (id) => id === 'attacker',
      shouldSuppressAttackOfOpportunity: ({ attacker, provoker }) => (
        playerCharacterIds.has(attacker.id) && playerCharacterIds.has(provoker.id)
      ),
      performStruggleAttack: vi.fn(async () => true),
    })

    panel.provokeMovementAttackOfOpportunity({
      provokerId: 'provoker',
      from: { x: 1, y: 0, z: 1 },
      to: { x: 2, y: 0, z: 1 },
    })
    expect(panel.attackOfOpportunityPrompts.value).toEqual([])

    playerCharacterIds.delete('provoker')
    panel.provokeMovementAttackOfOpportunity({
      provokerId: 'provoker',
      from: { x: 1, y: 0, z: 1 },
      to: { x: 2, y: 0, z: 1 },
    })
    expect(panel.attackOfOpportunityPrompts.value).toHaveLength(1)
  })

  it('clears a controlled prompt without spending the attack of opportunity', () => {
    const map = ref(mapFixture())
    const tokens = ref([
      token('provoker', 1, 1),
      token('attacker', 0, 1),
    ])
    const panel = useAttackOfOpportunityPanel({
      map,
      spawnedPokemon: computed(() => tokens.value),
      tokenMoveOptionsById: computed(() => ({
        attacker: [moveOption('Struggle')],
      })),
      canControlPlacement: (id) => id === 'attacker',
      performStruggleAttack: vi.fn(async () => true),
    })

    panel.provokeMovementAttackOfOpportunity({
      provokerId: 'provoker',
      from: { x: 1, y: 0, z: 1 },
      to: { x: 2, y: 0, z: 1 },
    })

    const promptId = panel.attackOfOpportunityPrompts.value[0]?.id ?? ''
    expect(panel.removeAttackOfOpportunityPrompt(promptId)).toBe(true)
    expect(panel.attackOfOpportunityPrompts.value).toEqual([])

    panel.provokeRangedAttackOfOpportunity({ provokerId: 'provoker', targetIds: [] })
    expect(panel.attackOfOpportunityPrompts.value).toHaveLength(1)
    expect(panel.removeAttackOfOpportunityPrompt('missing')).toBe(false)
  })

  it('queues pressable prompts with Struggle variants and enforces once per round', async () => {
    const map = ref(mapFixture())
    const tokens = ref([
      token('provoker', 1, 1),
      token('attacker', 0, 1, { accentColor: '#2e77d0' }),
    ])
    const performStruggleAttack = vi.fn(async () => true)
    const panel = useAttackOfOpportunityPanel({
      map,
      spawnedPokemon: computed(() => tokens.value),
      tokenMoveOptionsById: computed(() => ({
        attacker: [moveOption('Struggle'), moveOption('Struggle (Zapper Special)', { type: 'Electric', damageClass: 'Special' })],
      })),
      canControlPlacement: (id) => id === 'attacker',
      performStruggleAttack,
    })

    panel.provokeMovementAttackOfOpportunity({
      provokerId: 'provoker',
      from: { x: 1, y: 0, z: 1 },
      to: { x: 2, y: 0, z: 1 },
    })

    expect(panel.attackOfOpportunityPrompts.value).toHaveLength(1)
    expect(panel.attackOfOpportunityPrompts.value[0]?.attackerAccentColor).toBe('#2e77d0')
    expect(panel.attackOfOpportunityPrompts.value[0]?.struggleOptions.map((move) => move.name)).toEqual([
      'Struggle',
      'Struggle (Zapper Special)',
    ])

    await panel.useAttackOfOpportunity({
      promptId: panel.attackOfOpportunityPrompts.value[0]?.id ?? '',
      moveName: 'Struggle (Zapper Special)',
    })

    expect(performStruggleAttack).toHaveBeenCalledWith(expect.objectContaining({
      attackerId: 'attacker',
      targetId: 'provoker',
      moveName: 'Struggle (Zapper Special)',
    }))
    expect(panel.attackOfOpportunityPrompts.value).toEqual([])

    panel.provokeRangedAttackOfOpportunity({ provokerId: 'provoker', targetIds: [] })
    expect(panel.attackOfOpportunityPrompts.value).toEqual([])

    map.value.initiative = { activeId: null, round: 2 }
    panel.provokeRangedAttackOfOpportunity({ provokerId: 'provoker', targetIds: [] })
    expect(panel.attackOfOpportunityPrompts.value).toHaveLength(1)
  })
})
