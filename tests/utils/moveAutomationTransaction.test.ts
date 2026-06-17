import { describe, expect, it } from 'vitest'
import { explicitScriptForMove } from '~/utils/moveAutomation'
import { buildMoveAutomationTransaction } from '~/utils/moveAutomationTransaction'
import {
  defaultTargetResolutionState,
  moveAutomationSuggestionKey,
} from '~/utils/moveAutomationTargetResolution'
import {
  GROUNDSOURCE_IMMUNITY_SUPPRESSED_CONDITION,
  ROOST_GROUNDED_CONDITION,
  SMACK_DOWN_GROUNDED_CONDITION,
} from '~/utils/moveAutomationSpecialConditions'
import type { CombatStageMap } from '~/types/combatStages'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

const stages: CombatStageMap = { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 }

const token = (overrides: Partial<SpawnedPokemon> & Pick<SpawnedPokemon, 'id' | 'species'>): SpawnedPokemon => {
  const { id, species, ...rest } = overrides
  return {
    id,
    species,
    slug: species.toLowerCase(),
    size: 'Small',
    width: 1,
    height: 1,
    base: 1,
    clearance: 1,
    spriteUrl: '/sprite.png',
    entityKind: 'pokemon',
    position: { x: 0, y: 0, z: 0 },
    sheetKind: 'pokemon',
    sheetSlug: species.toLowerCase(),
    level: 10,
    currentHp: 20,
    maxHp: 40,
    atk: 8,
    satk: 7,
    def: 5,
    sdef: 4,
    defenderTypes: ['Normal'],
    combatStages: stages,
    conditions: [],
    tokenItems: [],
    ...rest,
  }
}

const script = (overrides: Partial<MoveAutomationScript> = {}): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Test Move',
  version: 2,
  targetMode: 'one-target',
  targetCount: 1,
  damaging: true,
  requiresAccuracy: true,
  damageBase: 4,
  damageClass: 'Physical',
  type: 'Fire',
  ac: 2,
  range: 'Melee, 1 Target',
  effect: '',
  keywords: [],
  criticalRange: 20,
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
  ...overrides,
})

const enabledSuggestionFlags = (
  s: MoveAutomationScript,
  kind: 'condition' | 'stage' | 'hp' | 'field' | 'hazard',
  indexes: readonly number[],
): Record<string, boolean> => Object.fromEntries(
  indexes.map((index) => [moveAutomationSuggestionKey(s, kind, index), true]),
)

const automationTransaction = (
  s: MoveAutomationScript,
  options: {
    user?: SpawnedPokemon
    targets: SpawnedPokemon[]
    targetResolutions?: Record<string, ReturnType<typeof defaultTargetResolutionState>>
    enabledSuggestions?: Record<string, boolean>
  },
) => buildMoveAutomationTransaction({
  script: s,
  user: options.user ?? token({ id: 'u', species: 'User' }),
  selectedTargets: options.targets,
  targetResolutions: options.targetResolutions ?? {},
  enabledSuggestions: options.enabledSuggestions ?? {},
  hpSuggestionAmounts: {},
  manualUserConditions: [],
  manualTargetConditions: [],
  manualUserStageDeltas: stages,
  manualTargetStageDeltas: stages,
  hazardCells: [],
  manualNote: '',
})

describe('move automation transaction helpers', () => {
  it('builds transactions for damage, suggestions, hazards, fields, and stages', () => {
    const user = token({ id: 'u', species: 'Caster', currentHp: 30, maxHp: 40 })
    const target = token({ id: 't', species: 'Target', currentHp: 25, maxHp: 30, conditions: ['Burned'] })
    const s = script({
      hpSuggestions: [{ recipient: 'user', mode: 'heal-percent-max', percent: 25, label: 'Recover' }],
      conditionSuggestions: [{ recipient: 'target', condition: 'Slowed', label: 'Slow target' }],
      stageSuggestions: [{ recipient: 'target', key: 'def', delta: -1, label: 'Lower Defense' }],
      hazardSuggestions: [{ kind: 'toxic-spikes', squares: 1, label: 'Lay spikes' }],
      fieldSuggestions: [{ kind: 'weather', value: 'sunny', label: 'Sun' }],
      automationNotes: ['Check secondary effects.'],
    })
    const enabledSuggestions = {
      [moveAutomationSuggestionKey(s, 'hp', 0)]: true,
      [moveAutomationSuggestionKey(s, 'condition', 0)]: true,
      [moveAutomationSuggestionKey(s, 'stage', 0)]: true,
      [moveAutomationSuggestionKey(s, 'hazard', 0)]: true,
      [moveAutomationSuggestionKey(s, 'field', 0)]: true,
    }

    const transaction = buildMoveAutomationTransaction({
      script: s,
      user,
      selectedTargets: [target],
      targetResolutions: {
        t: {
          ...defaultTargetResolutionState(s),
          hit: true,
          crit: true,
          damageRoll: { formula: 'flat', count: 0, sides: 0, total: 12, rolls: [], mod: 12 },
        },
      },
      enabledSuggestions,
      hpSuggestionAmounts: {},
      manualUserConditions: ['Poisoned'],
      manualTargetConditions: ['Confused'],
      manualUserStageDeltas: { ...stages, atk: 1 },
      manualTargetStageDeltas: { ...stages, spd: -2 },
      hazardCells: [{ x: 1, y: 0, z: 2 }, { x: 2, y: 0, z: 2 }],
      manualNote: 'Manual note',
    })

    expect(transaction.hpUpdates).toEqual(expect.arrayContaining([
      { id: 't', currentHp: 9 },
      { id: 'u', currentHp: 40 },
    ]))
    expect(transaction.conditionUpdates).toEqual(expect.arrayContaining([
      { id: 'u', conditions: ['Poisoned'] },
      { id: 't', conditions: ['Burned', 'Confused', 'Slowed'] },
    ]))
    expect(transaction.combatStageUpdates).toEqual(expect.arrayContaining([
      { id: 'u', stages: { ...stages, atk: 1 } },
      { id: 't', stages: { ...stages, def: -1, spd: -2 } },
    ]))
    expect(transaction.hazardsToAdd).toEqual([{ kind: 'toxic-spikes', x: 1, y: 0, z: 2, layer: 1, owner: 'Caster' }])
    expect(transaction.fieldEffectsToApply).toEqual([{ kind: 'weather', value: 'sunny', source: 'Test Move' }])
    expect(transaction.logLines).toEqual(expect.arrayContaining([
      'Caster used Test Move.',
      'Target: 16 damage (Critical!).',
      'Target damage breakdown: (12 roll + 8 Atk − 4 Def) × 1 = 16.',
    ]))
  })

  it('heals Absorb users for half of full overkill damage', () => {
    const s = explicitScriptForMove('Absorb')
    expect(s).not.toBeNull()
    const user = token({ id: 'u', species: 'Oddish', currentHp: 12, maxHp: 40, satk: 20 })
    const target = token({ id: 't', species: 'Target', currentHp: 25, maxHp: 30, sdef: 5, defenderTypes: ['Water'] })

    const transaction = buildMoveAutomationTransaction({
      script: s!,
      user,
      selectedTargets: [target],
      targetResolutions: {
        t: {
          ...defaultTargetResolutionState(s!),
          hit: true,
          damageRoll: { formula: 'flat', count: 0, sides: 0, total: 10, rolls: [], mod: 10 },
        },
      },
      enabledSuggestions: { [moveAutomationSuggestionKey(s!, 'hp', 0)]: true },
      hpSuggestionAmounts: {},
      manualUserConditions: [],
      manualTargetConditions: [],
      manualUserStageDeltas: stages,
      manualTargetStageDeltas: stages,
      hazardCells: [],
      manualNote: '',
    })

    expect(transaction.hpUpdates).toEqual(expect.arrayContaining([
      { id: 't', currentHp: -12 },
      { id: 'u', currentHp: 31 },
    ]))
    expect(transaction.logLines).toContain('Oddish: Absorb heals user for half damage dealt (19 HP).')
  })

  it('resists Electric damage with Mud Sport Coat and removes the coat after damage', () => {
    const s = explicitScriptForMove('Thunder Shock')
    expect(s).not.toBeNull()
    const user = token({ id: 'u', species: 'Pikachu', satk: 20 })
    const target = token({ id: 't', species: 'Coated', currentHp: 40, maxHp: 40, sdef: 5, conditions: ['Electric-Resistant Coat'] })

    const transaction = buildMoveAutomationTransaction({
      script: s!,
      user,
      selectedTargets: [target],
      targetResolutions: {
        t: {
          ...defaultTargetResolutionState(s!),
          hit: true,
          damageRoll: { formula: 'flat', count: 0, sides: 0, total: 10, rolls: [], mod: 10 },
        },
      },
      enabledSuggestions: {},
      hpSuggestionAmounts: {},
      manualUserConditions: [],
      manualTargetConditions: [],
      manualUserStageDeltas: stages,
      manualTargetStageDeltas: stages,
      hazardCells: [],
      manualNote: '',
    })

    expect(transaction.hpUpdates).toEqual([{ id: 't', currentHp: 28 }])
    expect(transaction.conditionUpdates).toEqual([{ id: 't', conditions: [] }])
    expect(transaction.logLines).toContain('Coated: Electric-Resistant Coat removed after Electric damage.')
  })

  it('adds Injury updates and log lines when automated damage crosses injury thresholds', () => {
    const user = token({ id: 'u', species: 'Caster', atk: 0 })
    const target = token({ id: 't', species: 'Oddish', currentHp: 53, maxHp: 53, fullMaxHp: 53, injuries: 0, def: 0 })
    const s = script({ requiresAccuracy: false })

    const transaction = buildMoveAutomationTransaction({
      script: s,
      user,
      selectedTargets: [target],
      targetResolutions: {
        t: {
          ...defaultTargetResolutionState(s),
          hit: true,
          damageRoll: { formula: 'flat', count: 0, sides: 0, total: 28, rolls: [], mod: 28 },
        },
      },
      enabledSuggestions: {},
      hpSuggestionAmounts: {},
      manualUserConditions: [],
      manualTargetConditions: [],
      manualUserStageDeltas: stages,
      manualTargetStageDeltas: stages,
      hazardCells: [],
      manualNote: '',
    })

    expect(transaction.hpUpdates).toEqual([{ id: 't', currentHp: 25, injuries: 2 }])
    expect(transaction.logLines).toContain('Oddish: +2 Injuries (Massive Damage, 1 HP Marker).')
  })

  it('blocks Spore Sleep suggestions against Grass targets through Powder immunity', () => {
    const s = explicitScriptForMove('Spore')
    expect(s).not.toBeNull()
    const user = token({ id: 'u', species: 'Foongus' })
    const target = token({ id: 't', species: 'Grassmon', defenderTypes: ['Grass'] })

    const transaction = buildMoveAutomationTransaction({
      script: s!,
      user,
      selectedTargets: [target],
      targetResolutions: { t: { ...defaultTargetResolutionState(s!), hit: true } },
      enabledSuggestions: { [moveAutomationSuggestionKey(s!, 'condition', 0)]: true },
      hpSuggestionAmounts: {},
      manualUserConditions: [],
      manualTargetConditions: [],
      manualUserStageDeltas: stages,
      manualTargetStageDeltas: stages,
      hazardCells: [],
      manualNote: '',
    })

    expect(transaction.conditionUpdates).toEqual([])
    expect(transaction.logLines).toContain('Sleep did not apply to Grassmon: immune (Grass type (Powder)).')
  })

  it('applies Spore Sleep suggestions normally to non-Grass targets that are hit', () => {
    const s = explicitScriptForMove('Spore')
    expect(s).not.toBeNull()
    const user = token({ id: 'u', species: 'Foongus' })
    const target = token({ id: 't', species: 'Munchlax', defenderTypes: ['Normal'] })

    const transaction = buildMoveAutomationTransaction({
      script: s!,
      user,
      selectedTargets: [target],
      targetResolutions: { t: { ...defaultTargetResolutionState(s!), hit: true } },
      enabledSuggestions: { [moveAutomationSuggestionKey(s!, 'condition', 0)]: true },
      hpSuggestionAmounts: {},
      manualUserConditions: [],
      manualTargetConditions: [],
      manualUserStageDeltas: stages,
      manualTargetStageDeltas: stages,
      hazardCells: [],
      manualNote: '',
    })

    expect(transaction.conditionUpdates).toEqual([{ id: 't', conditions: ['Sleep'] }])
    expect(transaction.logLines).toContain('Sleep applied to Munchlax.')
  })

  it('blocks Earth Power damage and Special Defense drops against airborne Sky/Levitate Groundsource immunity', () => {
    const s = explicitScriptForMove('Earth Power')
    expect(s).not.toBeNull()
    const user = token({ id: 'u', species: 'Claydol', satk: 12 })
    const target = token({
      id: 't',
      species: 'Airborne',
      currentHp: 30,
      maxHp: 30,
      defenderCapabilities: { sky: 6, levitate: 4 },
    })

    const transaction = buildMoveAutomationTransaction({
      script: s!,
      user,
      selectedTargets: [target],
      targetResolutions: {
        t: {
          ...defaultTargetResolutionState(s!),
          accuracyRoll: '16',
          hit: true,
          damageRoll: { formula: 'flat', count: 0, sides: 0, total: 20, rolls: [], mod: 20 },
        },
      },
      enabledSuggestions: { [moveAutomationSuggestionKey(s!, 'stage', 0)]: true },
      hpSuggestionAmounts: {},
      manualUserConditions: [],
      manualTargetConditions: [],
      manualUserStageDeltas: stages,
      manualTargetStageDeltas: stages,
      hazardCells: [],
      manualNote: '',
    })

    expect(transaction.hpUpdates).toEqual([])
    expect(transaction.combatStageUpdates).toEqual([])
    expect(transaction.logLines).toContain('Earth Power lowers Special Defense on 16+: -1 Special Defense CS did not apply to Airborne: immune (Sky/Levitate Capability).')
  })

  it('allows Earth Power Special Defense drops when grounded markers suppress Sky/Levitate Groundsource immunity', () => {
    const s = explicitScriptForMove('Earth Power')
    expect(s).not.toBeNull()
    const user = token({ id: 'u', species: 'Claydol', satk: 12 })

    for (const marker of [
      ROOST_GROUNDED_CONDITION,
      SMACK_DOWN_GROUNDED_CONDITION,
      GROUNDSOURCE_IMMUNITY_SUPPRESSED_CONDITION,
    ]) {
      const target = token({
        id: `t-${marker}`,
        species: `Grounded ${marker}`,
        currentHp: 30,
        maxHp: 30,
        defenderCapabilities: { sky: 6, levitate: 4 },
        conditions: [marker],
      })

      const transaction = buildMoveAutomationTransaction({
        script: s!,
        user,
        selectedTargets: [target],
        targetResolutions: {
          [target.id]: {
            ...defaultTargetResolutionState(s!),
            accuracyRoll: '16',
            hit: true,
            damageRoll: { formula: 'flat', count: 0, sides: 0, total: 20, rolls: [], mod: 20 },
          },
        },
        enabledSuggestions: { [moveAutomationSuggestionKey(s!, 'stage', 0)]: true },
        hpSuggestionAmounts: {},
        manualUserConditions: [],
        manualTargetConditions: [],
        manualUserStageDeltas: stages,
        manualTargetStageDeltas: stages,
        hazardCells: [],
        manualNote: '',
      })

      expect(transaction.hpUpdates).toEqual([{ id: target.id, currentHp: 2 }])
      expect(transaction.combatStageUpdates).toEqual([{ id: target.id, stages: { ...stages, sdef: -1 } }])
      expect(transaction.logLines).toContain(`Grounded ${marker}: 28 damage.`)
      expect(transaction.logLines).toContain(`Earth Power lowers Special Defense on 16+: -1 Special Defense CS on Grounded ${marker}.`)
      expect(transaction.logLines.join('\n')).not.toContain('immune (Sky/Levitate Capability)')
    }
  })

  it('blocks Snarl damage and Special Attack drops against Soundproof targets', () => {
    const s = explicitScriptForMove('Snarl')
    expect(s).not.toBeNull()
    const user = token({ id: 'u', species: 'Nickit', satk: 18 })
    const target = token({
      id: 't',
      species: 'Whismur',
      currentHp: 30,
      maxHp: 30,
      abilityNames: ['Soundproof'],
    })

    const transaction = buildMoveAutomationTransaction({
      script: s!,
      user,
      selectedTargets: [target],
      targetResolutions: {
        t: {
          ...defaultTargetResolutionState(s!),
          hit: true,
          damageRoll: { formula: 'flat', count: 0, sides: 0, total: 20, rolls: [], mod: 20 },
        },
      },
      enabledSuggestions: { [moveAutomationSuggestionKey(s!, 'stage', 0)]: true },
      hpSuggestionAmounts: {},
      manualUserConditions: [],
      manualTargetConditions: [],
      manualUserStageDeltas: stages,
      manualTargetStageDeltas: stages,
      hazardCells: [],
      manualNote: '',
    })

    expect(transaction.hpUpdates).toEqual([])
    expect(transaction.combatStageUpdates).toEqual([])
    expect(transaction.logLines).toContain('Snarl lowers Special Attack: -1 Special Attack CS did not apply to Whismur: immune (Soundproof).')
  })

  it('applies target suggestions only to targets the move hit', () => {
    const user = token({ id: 'u', species: 'Caster' })
    const hitTarget = token({ id: 'hit', species: 'Hitmon' })
    const missedTarget = token({ id: 'miss', species: 'Missmon' })
    const s = script({
      damaging: false,
      damageBase: null,
      stageSuggestions: [{ recipient: 'target', key: 'atk', delta: -1, label: 'Lower Attack' }],
    })

    const transaction = buildMoveAutomationTransaction({
      script: s,
      user,
      selectedTargets: [hitTarget, missedTarget],
      targetResolutions: {
        hit: { ...defaultTargetResolutionState(s), hit: true },
        miss: { ...defaultTargetResolutionState(s), hit: false },
      },
      enabledSuggestions: { [moveAutomationSuggestionKey(s, 'stage', 0)]: true },
      hpSuggestionAmounts: {},
      manualUserConditions: [],
      manualTargetConditions: [],
      manualUserStageDeltas: stages,
      manualTargetStageDeltas: stages,
      hazardCells: [],
      manualNote: '',
    })

    expect(transaction.combatStageUpdates).toEqual([{ id: 'hit', stages: { ...stages, atk: -1 } }])
    expect(transaction.logLines).toContain('Lower Attack on Hitmon.')
  })

  it('applies Aromatic Mist Special Defense boosts to selected targets', () => {
    const s = explicitScriptForMove('Aromatic Mist')!
    expect(s).not.toBeNull()
    const firstAlly = token({ id: 'a1', species: 'Ally One' })
    const secondAlly = token({ id: 'a2', species: 'Ally Two', combatStages: { ...stages, sdef: 2 } })

    const transaction = automationTransaction(s, {
      targets: [firstAlly, secondAlly],
      enabledSuggestions: enabledSuggestionFlags(s, 'stage', [0]),
    })

    expect(transaction.combatStageUpdates).toEqual([
      { id: 'a1', stages: { ...stages, sdef: 1 } },
      { id: 'a2', stages: { ...stages, sdef: 3 } },
    ])
  })

  it('applies Coaching Attack and Defense boosts to the user and selected targets', () => {
    const s = explicitScriptForMove('Coaching')!
    expect(s).not.toBeNull()
    const user = token({ id: 'u', species: 'Coach' })
    const firstAlly = token({ id: 'a1', species: 'Ally One' })
    const secondAlly = token({ id: 'a2', species: 'Ally Two', combatStages: { ...stages, atk: 1, def: 2 } })

    const transaction = automationTransaction(s, {
      user,
      targets: [firstAlly, secondAlly],
      enabledSuggestions: enabledSuggestionFlags(s, 'stage', [0, 1, 2, 3]),
    })

    expect(transaction.combatStageUpdates).toEqual([
      { id: 'u', stages: { ...stages, atk: 1, def: 1 } },
      { id: 'a1', stages: { ...stages, atk: 1, def: 1 } },
      { id: 'a2', stages: { ...stages, atk: 2, def: 3 } },
    ])
  })

  it('applies Bleakwind Storm Flinch only to hit targets whose natural accuracy roll meets 15+', () => {
    const s = explicitScriptForMove('Bleakwind Storm')!
    expect(s).not.toBeNull()
    const hitHigh = token({ id: 'hit-high', species: 'Hit High' })
    const missedHigh = token({ id: 'miss-high', species: 'Miss High' })
    const hitLow = token({ id: 'hit-low', species: 'Hit Low' })

    const transaction = automationTransaction(s, {
      targets: [hitHigh, missedHigh, hitLow],
      targetResolutions: {
        'hit-high': { ...defaultTargetResolutionState(s), accuracyRoll: '15', hit: true },
        'miss-high': { ...defaultTargetResolutionState(s), accuracyRoll: '15', hit: false },
        'hit-low': { ...defaultTargetResolutionState(s), accuracyRoll: '14', hit: true },
      },
      enabledSuggestions: enabledSuggestionFlags(s, 'condition', [0]),
    })

    expect(transaction.conditionUpdates).toEqual([{ id: 'hit-high', conditions: ['Flinch', 'Vulnerable'] }])
  })

  it('applies Bleakwind Storm Frozen only to hit targets whose natural accuracy roll meets 19+', () => {
    const s = explicitScriptForMove('Bleakwind Storm')!
    expect(s).not.toBeNull()
    const hitHigh = token({ id: 'hit-high', species: 'Hit High' })
    const missedHigh = token({ id: 'miss-high', species: 'Miss High' })
    const hitLow = token({ id: 'hit-low', species: 'Hit Low' })

    const transaction = automationTransaction(s, {
      targets: [hitHigh, missedHigh, hitLow],
      targetResolutions: {
        'hit-high': { ...defaultTargetResolutionState(s), accuracyRoll: '19', hit: true },
        'miss-high': { ...defaultTargetResolutionState(s), accuracyRoll: '19', hit: false },
        'hit-low': { ...defaultTargetResolutionState(s), accuracyRoll: '18', hit: true },
      },
      enabledSuggestions: enabledSuggestionFlags(s, 'condition', [1]),
    })

    expect(transaction.conditionUpdates).toEqual([{ id: 'hit-high', conditions: ['Frozen'] }])
  })

  it('does not apply Bleakwind Storm conditions when the natural accuracy roll is below 15', () => {
    const s = explicitScriptForMove('Bleakwind Storm')!
    expect(s).not.toBeNull()
    const target = token({ id: 't', species: 'Target' })

    const transaction = automationTransaction(s, {
      targets: [target],
      targetResolutions: { t: { ...defaultTargetResolutionState(s), accuracyRoll: '14', hit: true } },
      enabledSuggestions: enabledSuggestionFlags(s, 'condition', [0, 1]),
    })

    expect(transaction.conditionUpdates).toEqual([])
  })

  it('applies Sandstorm Sear Burned only to hit targets whose natural accuracy roll meets 15+', () => {
    const s = explicitScriptForMove('Sandstorm Sear')!
    expect(s).not.toBeNull()
    const hitHigh = token({ id: 'hit-high', species: 'Hit High' })
    const missedHigh = token({ id: 'miss-high', species: 'Miss High' })
    const hitLow = token({ id: 'hit-low', species: 'Hit Low' })

    const transaction = automationTransaction(s, {
      targets: [hitHigh, missedHigh, hitLow],
      targetResolutions: {
        'hit-high': { ...defaultTargetResolutionState(s), accuracyRoll: '15', hit: true },
        'miss-high': { ...defaultTargetResolutionState(s), accuracyRoll: '15', hit: false },
        'hit-low': { ...defaultTargetResolutionState(s), accuracyRoll: '14', hit: true },
      },
      enabledSuggestions: enabledSuggestionFlags(s, 'condition', [0]),
    })

    expect(transaction.conditionUpdates).toEqual([{ id: 'hit-high', conditions: ['Burned'] }])
  })

  it('does not apply Sandstorm Sear Burned when the natural accuracy roll is below 15', () => {
    const s = explicitScriptForMove('Sandstorm Sear')!
    expect(s).not.toBeNull()
    const target = token({ id: 't', species: 'Target' })

    const transaction = automationTransaction(s, {
      targets: [target],
      targetResolutions: { t: { ...defaultTargetResolutionState(s), accuracyRoll: '14', hit: true } },
      enabledSuggestions: enabledSuggestionFlags(s, 'condition', [0]),
    })

    expect(transaction.conditionUpdates).toEqual([])
  })

  it('respects existing Sandstorm Sear Burn immunity handling for Fire-type targets', () => {
    const s = explicitScriptForMove('Sandstorm Sear')!
    expect(s).not.toBeNull()
    const target = token({ id: 't', species: 'Charmander', defenderTypes: ['Fire'] })

    const transaction = automationTransaction(s, {
      targets: [target],
      targetResolutions: { t: { ...defaultTargetResolutionState(s), accuracyRoll: '15', hit: true } },
      enabledSuggestions: enabledSuggestionFlags(s, 'condition', [0]),
    })

    expect(transaction.conditionUpdates).toEqual([])
    expect(transaction.logLines).toContain('Burned on 15+ did not apply to Charmander: immune (Fire type).')
  })

  it('applies Psywave direct HP loss from the user level table without stats or resistance', () => {
    const s = explicitScriptForMove('Psywave')
    expect(s).not.toBeNull()
    const user = token({ id: 'u', species: 'Psyduck', level: 21, satk: 99 })
    const target = token({
      id: 't',
      species: 'Croagunk',
      currentHp: 80,
      maxHp: 80,
      sdef: 99,
      defenderTypes: ['Fighting', 'Poison'],
    })

    const transaction = buildMoveAutomationTransaction({
      script: s!,
      user,
      selectedTargets: [target],
      targetResolutions: {
        t: {
          ...defaultTargetResolutionState(s!),
          hit: true,
          damageRoll: { formula: '1d4', count: 1, sides: 4, rolls: [3], total: 3, mod: 0 },
        },
      },
      enabledSuggestions: {},
      hpSuggestionAmounts: {},
      manualUserConditions: [],
      manualTargetConditions: [],
      manualUserStageDeltas: stages,
      manualTargetStageDeltas: stages,
      hazardCells: [],
      manualNote: '',
    })

    expect(transaction.hpUpdates).toEqual([{ id: 't', currentHp: 49 }])
    expect(transaction.logLines).toContain('Croagunk: 31 HP lost (Psywave level-scaled HP loss).')
  })

  it('lets Psywave apply Psychic immunity', () => {
    const s = explicitScriptForMove('Psywave')
    expect(s).not.toBeNull()
    const user = token({ id: 'u', species: 'Drowzee', level: 20 })
    const target = token({ id: 't', species: 'Umbreon', currentHp: 80, maxHp: 80, defenderTypes: ['Dark'] })

    const transaction = buildMoveAutomationTransaction({
      script: s!,
      user,
      selectedTargets: [target],
      targetResolutions: {
        t: {
          ...defaultTargetResolutionState(s!),
          hit: true,
          damageRoll: { formula: '1d4', count: 1, sides: 4, rolls: [4], total: 4, mod: 0 },
        },
      },
      enabledSuggestions: {},
      hpSuggestionAmounts: {},
      manualUserConditions: [],
      manualTargetConditions: [],
      manualUserStageDeltas: stages,
      manualTargetStageDeltas: stages,
      hazardCells: [],
      manualNote: '',
    })

    expect(transaction.hpUpdates).toEqual([])
  })
})
