import { afterEach, describe, expect, it, vi } from 'vitest'
import { MOVE_VFX_KIND, type MoveAnimationEvent } from '~/types/moveAnimation'
import type { CombatStageMap } from '~/types/combatStages'
import type { GridAnchor } from '~/types/map'
import type { MoveAutomationScript, MoveAutomationTransaction } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import {
  MOVE_ANIMATION_OVERRIDE_REGISTRY,
  MOVE_ANIMATION_PLAN_RESOLUTION,
  canonicalMoveAnimationOverrideKey,
  createMoveAnimationPlanner,
  hasMoveAnimationPlanningDebugQueryFlag,
  isMoveAnimationPlanningDebugEnabled,
  planGenericMoveAnimations,
  planMoveAnimations,
  type MoveAnimationPlanInput,
} from '~/utils/moveAnimationPlanner'
import {
  MOVE_VFX_TONE_COLORS,
  MOVE_VFX_TYPE_COLORS,
} from '~/utils/moveAnimationPalette'
import { MOVE_VFX_DEFAULT_DURATIONS_MS } from '~/utils/isometric/moveVfxTiming'

const stages: CombatStageMap = { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 }

const token = (
  overrides: Partial<SpawnedPokemon> & Pick<SpawnedPokemon, 'id' | 'species'>,
): SpawnedPokemon => {
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
    currentHp: 40,
    maxHp: 40,
    atk: 5,
    satk: 10,
    def: 5,
    sdef: 5,
    spd: 5,
    evasion: { physical: 0, special: 0, speed: 0 },
    defenderTypes: ['Normal'],
    combatStages: stages,
    conditions: [],
    tokenItems: [],
    ...rest,
  }
}

const script = (overrides: Partial<MoveAutomationScript> = {}): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Generic Test Move',
  version: 1,
  targetMode: 'one-target',
  targetCount: 1,
  damaging: false,
  requiresAccuracy: false,
  damageBase: null,
  damageClass: 'Status',
  type: 'Normal',
  ac: null,
  range: '',
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

const transaction = (overrides: Partial<MoveAutomationTransaction> = {}): MoveAutomationTransaction => ({
  userId: 'user-token',
  userName: 'Caster',
  moveName: 'Generic Test Move',
  scriptKind: 'explicit',
  scriptVersion: 1,
  hpUpdates: [],
  conditionUpdates: [],
  combatStageUpdates: [],
  hazardsToAdd: [],
  fieldEffectsToApply: [],
  logLines: [],
  ...overrides,
})

const baseInput = (overrides: Partial<MoveAnimationPlanInput> = {}): MoveAnimationPlanInput => ({
  resolution: MOVE_ANIMATION_PLAN_RESOLUTION.singleTarget,
  user: token({ id: 'user-token', species: 'Caster' }),
  targets: [token({ id: 'target-token', species: 'Target', position: { x: 3, y: 0, z: 1 } })],
  selectedTargetIds: ['target-token'],
  script: script(),
  timing: {
    nowMs: 1234,
    animationIdBase: 'test-plan',
  },
  ...overrides,
} as MoveAnimationPlanInput)

const selfInput = (overrides: Partial<MoveAnimationPlanInput> = {}): MoveAnimationPlanInput => baseInput({
  resolution: MOVE_ANIMATION_PLAN_RESOLUTION.self,
  targets: [],
  selectedTargetIds: [],
  ...overrides,
})

const areaInput = (
  areaCells: readonly GridAnchor[],
  overrides: Partial<MoveAnimationPlanInput> = {},
): MoveAnimationPlanInput => baseInput({
  resolution: MOVE_ANIMATION_PLAN_RESOLUTION.area,
  selectedTargetIds: [],
  areaCells,
  ...overrides,
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('generic move animation planner', () => {
  it('keeps the production per-move override registry empty and falls back to generic planning', () => {
    expect(Object.keys(MOVE_ANIMATION_OVERRIDE_REGISTRY)).toEqual([])

    const input = baseInput({
      script: script({
        moveName: 'Canonical Future Move Without Production Override',
        damaging: true,
        damageBase: 6,
        damageClass: 'Special',
        type: 'Water',
        range: 'Range 6, 1 Target',
      }),
    })

    expect(planMoveAnimations(input)).toEqual(planGenericMoveAnimations(input))
  })

  it('checks an injected test override before generic classification without production entries', () => {
    const input = baseInput({
      script: script({
        moveName: 'Demo Future Override Move',
        damaging: true,
        damageBase: 6,
        damageClass: 'Special',
        type: 'Fire',
        range: 'Range 6, 1 Target',
      }),
    })
    const planner = createMoveAnimationPlanner({
      overrideRegistry: {
        [canonicalMoveAnimationOverrideKey('Demo Future Override Move')]: {
          preset: {
            id: 'test-only-demo-preset',
            description: 'Test-only override proving the future extension point.',
            plan: (_overrideInput, context) => [{
              id: `${context.canonicalMoveName}-override-event`,
              moveName: _overrideInput.script.moveName,
              userId: _overrideInput.user?.id ?? 'unknown-user',
              createdAtMs: _overrideInput.timing.nowMs,
              durationMs: MOVE_VFX_DEFAULT_DURATIONS_MS.quick,
              kind: MOVE_VFX_KIND.selfPulse,
              originCell: _overrideInput.user?.position,
              palette: MOVE_VFX_TONE_COLORS.neutral,
            }],
          },
        },
      },
    })

    expect(planner(input)).toEqual([
      expect.objectContaining({
        id: 'demo-future-override-move-override-event',
        kind: MOVE_VFX_KIND.selfPulse,
      }),
    ])
  })

  it('classifies self healing moves as semantic healing pulses', () => {
    const events = planGenericMoveAnimations(selfInput({
      script: script({
        moveName: 'Self Healing Metadata',
        targetMode: 'self',
        hpSuggestions: [{ recipient: 'user', mode: 'heal-percent-max', percent: 50, label: 'Restore HP' }],
      }),
    }))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: MOVE_VFX_KIND.healing,
      userId: 'user-token',
      targetId: 'user-token',
      durationMs: MOVE_VFX_DEFAULT_DURATIONS_MS.normal,
      palette: MOVE_VFX_TONE_COLORS.healing,
    })
  })

  it('classifies self stage changes as buff/debuff pulses with semantic colours', () => {
    const [buff] = planGenericMoveAnimations(selfInput({
      script: script({
        moveName: 'Self Buff Metadata',
        targetMode: 'self',
        stageSuggestions: [{ recipient: 'user', key: 'atk', delta: 1, label: '+1 Attack' }],
      }),
    }))

    expect(buff).toMatchObject({
      kind: MOVE_VFX_KIND.buffDebuff,
      tone: 'buff',
      direction: 'buff',
      targetId: 'user-token',
      palette: MOVE_VFX_TONE_COLORS.buff,
    })

    const [debuff] = planGenericMoveAnimations(selfInput({
      script: script({
        moveName: 'Self Debuff Metadata',
        targetMode: 'self',
        stageSuggestions: [{ recipient: 'user', key: 'def', delta: -1, label: '-1 Defense' }],
      }),
    }))

    expect(debuff).toMatchObject({
      kind: MOVE_VFX_KIND.buffDebuff,
      tone: 'debuff',
      direction: 'debuff',
      targetId: 'user-token',
      palette: MOVE_VFX_TONE_COLORS.debuff,
    })
  })

  it('classifies target combat-stage changes as affected-token buff/debuff events', () => {
    const [event] = planGenericMoveAnimations(baseInput({
      script: script({
        moveName: 'Target Debuff Metadata',
        targetMode: 'one-target',
        stageSuggestions: [{ recipient: 'target', key: 'def', delta: -1, label: '-1 Defense' }],
      }),
    }))

    expect(event).toMatchObject({
      kind: MOVE_VFX_KIND.buffDebuff,
      tone: 'debuff',
      direction: 'debuff',
      targetId: 'target-token',
      palette: MOVE_VFX_TONE_COLORS.debuff,
    })
  })

  it('carries condition-name hints on generic status events without creating per-condition choreography', () => {
    const [selfStatus] = planGenericMoveAnimations(selfInput({
      script: script({
        moveName: 'Self Status Metadata',
        targetMode: 'self',
        conditionSuggestions: [{ recipient: 'user', condition: 'Sleep', label: 'Sleep' }],
      }),
    }))

    expect(selfStatus).toMatchObject({
      kind: MOVE_VFX_KIND.status,
      targetId: 'user-token',
      conditionNames: ['Sleep'],
      palette: MOVE_VFX_TONE_COLORS.status,
    })

    const [targetStatus] = planGenericMoveAnimations(baseInput({
      script: script({
        moveName: 'Target Status Metadata',
        targetMode: 'one-target',
        conditionSuggestions: [
          { recipient: 'target', condition: 'Poisoned', label: 'Poisoned' },
          { recipient: 'user', condition: 'Rage', label: 'Enraged' },
        ],
      }),
    }))

    expect(targetStatus).toMatchObject({
      kind: MOVE_VFX_KIND.status,
      targetId: 'target-token',
      conditionNames: ['Poisoned'],
      palette: MOVE_VFX_TONE_COLORS.status,
    })
  })

  it('derives healing follow-up VFX from HP increases in the move transaction', () => {
    const healedTarget = token({
      id: 'target-token',
      species: 'Target',
      currentHp: 12,
      maxHp: 40,
      position: { x: 3, y: 0, z: 1 },
    })
    const events = planGenericMoveAnimations(baseInput({
      targets: [healedTarget],
      transaction: transaction({
        hpUpdates: [{ id: 'target-token', currentHp: 30 }],
      }),
    }))

    expect(events.map((event) => event.kind)).toEqual([MOVE_VFX_KIND.healing])
    expect(events[0]).toMatchObject({
      kind: MOVE_VFX_KIND.healing,
      targetId: 'target-token',
      targetCell: { x: 3, y: 0, z: 1 },
      palette: MOVE_VFX_TONE_COLORS.healing,
    })
  })

  it('derives buff/debuff follow-up VFX from combat-stage transaction deltas', () => {
    const targetStages = { ...stages, def: 1 }
    const events = planGenericMoveAnimations(baseInput({
      targets: [token({ id: 'target-token', species: 'Target', combatStages: targetStages })],
      transaction: transaction({
        combatStageUpdates: [{ id: 'target-token', stages: { ...stages, def: -1 } }],
      }),
    }))

    expect(events.map((event) => event.kind)).toEqual([MOVE_VFX_KIND.buffDebuff])
    expect(events[0]).toMatchObject({
      kind: MOVE_VFX_KIND.buffDebuff,
      tone: 'debuff',
      direction: 'debuff',
      targetId: 'target-token',
      palette: MOVE_VFX_TONE_COLORS.debuff,
    })
  })

  it('derives status follow-up VFX from condition transaction changes', () => {
    const events = planGenericMoveAnimations(baseInput({
      targets: [token({ id: 'target-token', species: 'Target', conditions: ['Burned'] })],
      transaction: transaction({
        conditionUpdates: [{ id: 'target-token', conditions: ['Burned', 'Poisoned'] }],
      }),
    }))

    expect(events.map((event) => event.kind)).toEqual([MOVE_VFX_KIND.status])
    expect(events[0]).toMatchObject({
      kind: MOVE_VFX_KIND.status,
      targetId: 'target-token',
      conditionNames: ['Poisoned'],
      palette: MOVE_VFX_TONE_COLORS.status,
    })
  })

  it('adds field-effect transaction confirmations as semantic self pulses', () => {
    const events = planGenericMoveAnimations(selfInput({
      script: script({
        moveName: 'Generic Field Effect',
        targetMode: 'field',
        targetCount: null,
        damageClass: 'Static',
      }),
      transaction: transaction({
        fieldEffectsToApply: [{ kind: 'weather', value: 'rainy', source: 'Generic Field Effect' }],
      }),
    }))

    expect(events.map((event) => event.kind)).toEqual([MOVE_VFX_KIND.selfPulse])
    expect(events[0]).toMatchObject({
      kind: MOVE_VFX_KIND.selfPulse,
      originCell: { x: 0, y: 0, z: 0 },
      tone: 'status',
      durationMs: MOVE_VFX_DEFAULT_DURATIONS_MS.quick,
      palette: MOVE_VFX_TONE_COLORS.status,
    })
  })

  it('adds hazard transaction confirmations at hazard cells without relying on persistent hazard renderers', () => {
    const events = planGenericMoveAnimations(areaInput([], {
      script: script({
        moveName: 'Generic Hazard Setup',
        targetMode: 'hazard',
        targetCount: null,
        damageClass: 'Static',
      }),
      transaction: transaction({
        hazardsToAdd: [
          { kind: 'spikes', x: 2, y: 0, z: 1, owner: 'Caster' },
          { kind: 'toxic-spikes', x: 2, y: 0, z: 1, layer: 1, owner: 'Caster' },
          { kind: 'sticky-web', x: 3, y: 0, z: 1, owner: 'Caster' },
        ],
      }),
    }))

    expect(events.map((event) => event.kind)).toEqual([MOVE_VFX_KIND.areaPulse])
    expect(events[0]).toMatchObject({
      kind: MOVE_VFX_KIND.areaPulse,
      areaCells: [
        { x: 2, y: 0, z: 1 },
        { x: 3, y: 0, z: 1 },
      ],
      areaOrigin: { x: 0, y: 0, z: 0 },
      durationMs: MOVE_VFX_DEFAULT_DURATIONS_MS.quick,
      palette: MOVE_VFX_TONE_COLORS.status,
    })
  })

  it('falls back safely when hazard transactions have no usable cell geometry', () => {
    const events = planGenericMoveAnimations(areaInput([], {
      script: script({
        moveName: 'Generic Unknown Hazard Geometry',
        targetMode: 'hazard',
        targetCount: null,
        damageClass: 'Static',
      }),
      transaction: transaction({
        hazardsToAdd: [
          { kind: 'spikes', x: Number.NaN, y: 0, z: 1, owner: 'Caster' },
        ],
      }),
    }))

    expect(events.map((event) => event.kind)).toEqual([MOVE_VFX_KIND.selfPulse])
    expect(events[0]).toMatchObject({
      kind: MOVE_VFX_KIND.selfPulse,
      originCell: { x: 0, y: 0, z: 0 },
      tone: 'status',
      palette: MOVE_VFX_TONE_COLORS.status,
    })
  })

  it('adds transaction semantic follow-ups after damaging impact without treating HP loss as healing', () => {
    const events = planGenericMoveAnimations(baseInput({
      user: token({ id: 'user-token', species: 'Caster', currentHp: 20, maxHp: 40 }),
      targets: [token({ id: 'target-token', species: 'Target', currentHp: 35, maxHp: 40 })],
      script: script({
        moveName: 'Generic Damaging Drain Status',
        damaging: true,
        damageBase: 6,
        damageClass: 'Special',
        type: 'Grass',
        range: 'Range 6, 1 Target',
      }),
      targetOutcomes: [{ targetId: 'target-token', hit: true }],
      transaction: transaction({
        hpUpdates: [
          { id: 'target-token', currentHp: 21 },
          { id: 'user-token', currentHp: 28 },
        ],
        conditionUpdates: [{ id: 'target-token', conditions: ['Poisoned'] }],
      }),
    }))

    expect(events.map((event) => event.kind)).toEqual([
      MOVE_VFX_KIND.projectile,
      MOVE_VFX_KIND.targetFlash,
      MOVE_VFX_KIND.healing,
      MOVE_VFX_KIND.status,
    ])
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: MOVE_VFX_KIND.targetFlash,
        targetId: 'target-token',
        palette: MOVE_VFX_TYPE_COLORS.Grass,
        shake: true,
      }),
      expect.objectContaining({
        kind: MOVE_VFX_KIND.healing,
        targetId: 'user-token',
        palette: MOVE_VFX_TONE_COLORS.healing,
        startOffsetMs: 100,
      }),
      expect.objectContaining({
        kind: MOVE_VFX_KIND.status,
        targetId: 'target-token',
        conditionNames: ['Poisoned'],
        palette: MOVE_VFX_TONE_COLORS.status,
        startOffsetMs: 100,
      }),
    ]))
  })

  it('bounds and merges transaction semantic follow-ups for large area transactions', () => {
    const targets = Array.from({ length: 20 }, (_item, index) => token({
      id: `target-${index}`,
      species: `Target ${index}`,
      position: { x: index + 1, y: 0, z: 0 },
    }))
    const events = planGenericMoveAnimations(areaInput([{ x: 1, y: 0, z: 0 }], {
      targets,
      selectedTargetIds: targets.map((target) => target.id),
      script: script({
        moveName: 'Generic Large Status Area',
        targetMode: 'multi-target',
        damageClass: 'Status',
      }),
      transaction: transaction({
        conditionUpdates: targets.map((target) => ({ id: target.id, conditions: ['Burned', 'Poisoned'] })),
      }),
    }))

    const semanticEvents = events.filter((event) => event.kind === MOVE_VFX_KIND.status)
    expect(events[0]).toMatchObject({ kind: MOVE_VFX_KIND.areaPulse })
    expect(semanticEvents).toHaveLength(12)
    expect(events.some((event) => event.kind === MOVE_VFX_KIND.targetFlash)).toBe(false)
    expect(semanticEvents[0]).toMatchObject({
      targetId: 'target-0',
      conditionNames: ['Burned', 'Poisoned'],
      startOffsetMs: 140,
    })
  })

  it('classifies melee damaging hits as lunge plus type-coloured impact flash', () => {
    const events = planGenericMoveAnimations(baseInput({
      script: script({
        moveName: 'Generic Melee Damage',
        damaging: true,
        damageBase: 5,
        damageClass: 'Physical',
        type: 'Fighting',
        range: 'Melee, 1 Target',
      }),
      targetOutcomes: [{ targetId: 'target-token', hit: true }],
    }))

    expect(events.map((event) => event.kind)).toEqual([
      MOVE_VFX_KIND.meleeLunge,
      MOVE_VFX_KIND.targetFlash,
    ])
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: MOVE_VFX_KIND.meleeLunge,
        originCell: { x: 0, y: 0, z: 0 },
        targetId: 'target-token',
        targetCell: { x: 3, y: 0, z: 1 },
        palette: MOVE_VFX_TYPE_COLORS.Fighting,
      }),
      expect.objectContaining({
        kind: MOVE_VFX_KIND.targetFlash,
        targetId: 'target-token',
        palette: MOVE_VFX_TYPE_COLORS.Fighting,
        shake: true,
      }),
    ]))
  })

  it('classifies ranged damaging metadata as projectile, beam, or arc launch events', () => {
    const projectileEvents = planGenericMoveAnimations(baseInput({
      script: script({
        moveName: 'Generic Ranged Damage',
        damaging: true,
        damageBase: 6,
        damageClass: 'Physical',
        type: 'Water',
        range: 'Range 6, 1 Target',
      }),
    }))
    const beamEvents = planGenericMoveAnimations(baseInput({
      script: script({
        moveName: 'Generic Beam Metadata',
        damaging: true,
        damageBase: 8,
        damageClass: 'Special',
        type: 'Electric',
        range: 'Range 8, 1 Target',
        keywords: ['Beam'],
      }),
    }))
    const arcEvents = planGenericMoveAnimations(baseInput({
      script: script({
        moveName: 'Generic Arc Metadata',
        damaging: true,
        damageBase: 4,
        damageClass: 'Physical',
        type: 'Rock',
        range: 'Range 6, 1 Target',
        keywords: ['Thrown'],
      }),
    }))

    expect(projectileEvents.map((event) => event.kind)).toEqual([
      MOVE_VFX_KIND.projectile,
      MOVE_VFX_KIND.targetFlash,
    ])
    expect(projectileEvents[0]?.palette).toBe(MOVE_VFX_TYPE_COLORS.Water)
    expect(beamEvents[0]).toMatchObject({
      kind: MOVE_VFX_KIND.beam,
      palette: MOVE_VFX_TYPE_COLORS.Electric,
    })
    expect(arcEvents[0]).toMatchObject({
      kind: MOVE_VFX_KIND.arc,
      palette: MOVE_VFX_TYPE_COLORS.Rock,
    })
  })

  it('classifies miss outcomes as launch plus neutral miss puff without impact flash', () => {
    const events = planGenericMoveAnimations(baseInput({
      script: script({
        moveName: 'Generic Ranged Miss',
        damaging: true,
        damageBase: 6,
        damageClass: 'Special',
        type: 'Fire',
        range: 'Range 6, 1 Target',
      }),
      targetOutcomes: [{ targetId: 'target-token', hit: false }],
    }))

    expect(events.map((event) => event.kind)).toEqual([
      MOVE_VFX_KIND.projectile,
      MOVE_VFX_KIND.miss,
    ])
    expect(events[0]?.palette).toBe(MOVE_VFX_TYPE_COLORS.Fire)
    expect(events[1]).toMatchObject({
      kind: MOVE_VFX_KIND.miss,
      targetId: 'target-token',
      palette: MOVE_VFX_TONE_COLORS.miss,
    })
  })

  it('applies caller timing offsets to launch and accuracy outcome follow-up events', () => {
    const events = planGenericMoveAnimations(baseInput({
      script: script({
        moveName: 'Generic Timed Accuracy Hit',
        damaging: true,
        damageBase: 6,
        damageClass: 'Special',
        type: 'Fire',
        range: 'Range 6, 1 Target',
      }),
      targetOutcomes: [{ targetId: 'target-token', hit: true }],
      timing: {
        nowMs: 1234,
        animationIdBase: 'timed-plan',
        baseDelayMs: 120,
        impactDelayMs: 1500,
      },
    }))

    expect(events.map((event) => event.kind)).toEqual([
      MOVE_VFX_KIND.projectile,
      MOVE_VFX_KIND.targetFlash,
    ])
    expect(events[0]).toMatchObject({ startOffsetMs: 120 })
    expect(events[1]).toMatchObject({ startOffsetMs: 1500 })
  })

  it('uses caller semantic timing for transaction follow-ups independently of impact timing', () => {
    const events = planGenericMoveAnimations(baseInput({
      user: token({ id: 'user-token', species: 'Caster', currentHp: 20, maxHp: 40 }),
      script: script({
        moveName: 'Generic Timed Semantic Hit',
        damaging: true,
        damageBase: 6,
        damageClass: 'Special',
        type: 'Grass',
        range: 'Range 6, 1 Target',
      }),
      targetOutcomes: [{ targetId: 'target-token', hit: true }],
      transaction: transaction({
        hpUpdates: [{ id: 'user-token', currentHp: 28 }],
        conditionUpdates: [{ id: 'target-token', conditions: ['Poisoned'] }],
      }),
      timing: {
        nowMs: 1234,
        animationIdBase: 'timed-semantic-plan',
        impactDelayMs: 1500,
        semanticDelayMs: 2100,
      },
    }))

    expect(events.map((event) => event.kind)).toEqual([
      MOVE_VFX_KIND.projectile,
      MOVE_VFX_KIND.targetFlash,
      MOVE_VFX_KIND.healing,
      MOVE_VFX_KIND.status,
    ])
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: MOVE_VFX_KIND.targetFlash,
        targetId: 'target-token',
        startOffsetMs: 1500,
      }),
      expect.objectContaining({
        kind: MOVE_VFX_KIND.healing,
        targetId: 'user-token',
        startOffsetMs: 2100,
      }),
      expect.objectContaining({
        kind: MOVE_VFX_KIND.status,
        targetId: 'target-token',
        startOffsetMs: 2100,
      }),
    ]))
  })

  it('uses miss puff instead of status follow-up for missed non-damaging accuracy outcomes', () => {
    const events = planGenericMoveAnimations(baseInput({
      script: script({
        moveName: 'Generic Status Miss',
        requiresAccuracy: true,
        damageClass: 'Status',
        range: 'Range 6, 1 Target',
        conditionSuggestions: [{ recipient: 'target', condition: 'Burned', label: 'Burned' }],
      }),
      targetOutcomes: [{ targetId: 'target-token', hit: false }],
      timing: {
        nowMs: 1234,
        animationIdBase: 'status-miss-plan',
        impactDelayMs: 1500,
      },
    }))

    expect(events.map((event) => event.kind)).toEqual([
      MOVE_VFX_KIND.miss,
    ])
    expect(events[0]).toMatchObject({
      kind: MOVE_VFX_KIND.miss,
      targetId: 'target-token',
      startOffsetMs: 1500,
      palette: MOVE_VFX_TONE_COLORS.miss,
    })
  })

  it('adds type-coloured crit emphasis only for critical hit outcomes', () => {
    const criticalEvents = planGenericMoveAnimations(baseInput({
      script: script({
        moveName: 'Generic Critical Hit',
        damaging: true,
        damageBase: 6,
        damageClass: 'Special',
        type: 'Psychic',
        range: 'Range 6, 1 Target',
      }),
      targetOutcomes: [{ targetId: 'target-token', hit: true, crit: true }],
    }))
    const ordinaryHitEvents = planGenericMoveAnimations(baseInput({
      script: script({
        moveName: 'Generic Ordinary Hit',
        damaging: true,
        damageBase: 6,
        damageClass: 'Special',
        type: 'Psychic',
        range: 'Range 6, 1 Target',
      }),
      targetOutcomes: [{ targetId: 'target-token', hit: true, crit: false }],
    }))

    expect(criticalEvents.map((event) => event.kind)).toEqual([
      MOVE_VFX_KIND.projectile,
      MOVE_VFX_KIND.targetFlash,
      MOVE_VFX_KIND.crit,
    ])
    expect(criticalEvents[2]).toMatchObject({
      kind: MOVE_VFX_KIND.crit,
      targetId: 'target-token',
      palette: MOVE_VFX_TYPE_COLORS.Psychic,
    })
    expect(ordinaryHitEvents.map((event) => event.kind)).toEqual([
      MOVE_VFX_KIND.projectile,
      MOVE_VFX_KIND.targetFlash,
    ])
  })

  it('classifies confirmed area moves as area pulses with optional radial, line, or cone effects', () => {
    const cells = [{ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }]
    const lineEvents = planGenericMoveAnimations(areaInput(cells, {
      areaDirection: 'east',
      script: script({
        moveName: 'Generic Line Area',
        targetMode: 'multi-target',
        damaging: true,
        damageBase: 6,
        damageClass: 'Special',
        type: 'Ice',
        areaTemplates: [{ kind: 'line', size: 4, label: 'Line 4' }],
      }),
    }))
    const coneEvents = planGenericMoveAnimations(areaInput(cells, {
      areaDirection: 'north',
      script: script({
        moveName: 'Generic Cone Area',
        targetMode: 'multi-target',
        damaging: true,
        damageBase: 6,
        damageClass: 'Special',
        type: 'Fire',
        areaTemplates: [{ kind: 'cone', size: 3, label: 'Cone 3' }],
      }),
    }))
    const burstEvents = planGenericMoveAnimations(areaInput(cells, {
      script: script({
        moveName: 'Generic Burst Area',
        targetMode: 'multi-target',
        damaging: true,
        damageBase: 6,
        damageClass: 'Special',
        type: 'Dragon',
        areaTemplates: [{ kind: 'burst', size: 2, label: 'Burst 2' }],
      }),
    }))
    const blastEvents = planGenericMoveAnimations(areaInput(cells, {
      script: script({
        moveName: 'Generic Blast Area',
        targetMode: 'multi-target',
        damaging: true,
        damageBase: 6,
        damageClass: 'Special',
        type: 'Water',
        areaTemplates: [{ kind: 'ranged-blast', size: 2, label: 'Ranged 6, Blast 2' }],
      }),
    }))

    expect(lineEvents.map((event) => event.kind)).toEqual([
      MOVE_VFX_KIND.areaPulse,
      MOVE_VFX_KIND.lineSweep,
    ])
    expect(lineEvents[0]).toMatchObject({
      areaCells: cells,
      palette: MOVE_VFX_TYPE_COLORS.Ice,
    })
    expect(lineEvents[1]).toMatchObject({
      areaCells: cells,
      areaDirection: 'east',
      palette: MOVE_VFX_TYPE_COLORS.Ice,
    })
    expect(coneEvents.map((event) => event.kind)).toEqual([
      MOVE_VFX_KIND.areaPulse,
      MOVE_VFX_KIND.coneSweep,
    ])
    expect(coneEvents[0]?.palette).toBe(MOVE_VFX_TYPE_COLORS.Fire)
    expect(coneEvents[1]).toMatchObject({
      areaDirection: 'north',
      palette: MOVE_VFX_TYPE_COLORS.Fire,
    })
    expect(burstEvents.map((event) => event.kind)).toEqual([
      MOVE_VFX_KIND.areaPulse,
      MOVE_VFX_KIND.radialBurst,
    ])
    expect(burstEvents[0]?.palette).toBe(MOVE_VFX_TYPE_COLORS.Dragon)
    expect(burstEvents[1]).toMatchObject({
      areaCells: cells,
      areaOrigin: { x: 0, y: 0, z: 0 },
      originCell: { x: 0, y: 0, z: 0 },
      palette: MOVE_VFX_TYPE_COLORS.Dragon,
    })
    expect(blastEvents.map((event) => event.kind)).toEqual([
      MOVE_VFX_KIND.areaPulse,
      MOVE_VFX_KIND.radialBurst,
    ])
    expect(blastEvents[1]?.palette).toBe(MOVE_VFX_TYPE_COLORS.Water)
  })

  it('adds a dash event for pass-like area destinations before area impact follow-ups', () => {
    const cells = [{ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }]
    const destination = { x: 3, y: 0, z: 0 }
    const events = planGenericMoveAnimations(areaInput(cells, {
      areaDirection: 'east',
      passDestination: destination,
      targets: [token({ id: 'target-a', species: 'Target A', position: { x: 2, y: 0, z: 0 } })],
      selectedTargetIds: ['target-a'],
      targetOutcomes: [{ targetId: 'target-a', hit: true }],
      script: script({
        moveName: 'Generic Pass Area',
        targetMode: 'multi-target',
        damaging: true,
        damageBase: 5,
        damageClass: 'Physical',
        type: 'Normal',
        range: 'Pass 4',
        areaTemplates: [{ kind: 'pass', size: 4, label: 'Pass 4' }],
      }),
    }))

    expect(events.map((event) => event.kind)).toEqual([
      MOVE_VFX_KIND.dash,
      MOVE_VFX_KIND.areaPulse,
      MOVE_VFX_KIND.targetFlash,
    ])
    expect(events[0]).toMatchObject({
      kind: MOVE_VFX_KIND.dash,
      originCell: { x: 0, y: 0, z: 0 },
      destinationCell: destination,
      pathCells: cells,
      durationMs: MOVE_VFX_DEFAULT_DURATIONS_MS.long,
      palette: MOVE_VFX_TYPE_COLORS.Normal,
    })
    expect(events[1]).toMatchObject({
      kind: MOVE_VFX_KIND.areaPulse,
      areaCells: cells,
      startOffsetMs: 100,
    })
    expect(events[2]).toMatchObject({
      kind: MOVE_VFX_KIND.targetFlash,
      targetId: 'target-a',
      startOffsetMs: 220,
      shake: true,
    })
  })

  it('adds staggered target follow-ups for selected area targets without flashing excluded targets', () => {
    const cells = [{ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }]
    const events = planGenericMoveAnimations(areaInput(cells, {
      targets: [
        token({ id: 'target-a', species: 'Target A', position: { x: 1, y: 0, z: 0 } }),
        token({ id: 'target-b', species: 'Target B', position: { x: 2, y: 0, z: 0 } }),
        token({ id: 'excluded-ally', species: 'Excluded Ally', position: { x: 1, y: 0, z: 1 } }),
      ],
      selectedTargetIds: ['target-a', 'target-b', 'excluded-ally'],
      excludedTargetIds: ['excluded-ally'],
      targetOutcomes: [
        { targetId: 'target-a', hit: true },
        { targetId: 'target-b', hit: false },
        { targetId: 'excluded-ally', hit: true },
      ],
      script: script({
        moveName: 'Generic Burst Follow-Up',
        targetMode: 'multi-target',
        damaging: true,
        damageBase: 6,
        damageClass: 'Special',
        type: 'Electric',
        areaTemplates: [{ kind: 'burst', size: 2, label: 'Burst 2' }],
      }),
    }))

    expect(events.map((event) => event.kind)).toEqual([
      MOVE_VFX_KIND.areaPulse,
      MOVE_VFX_KIND.radialBurst,
      MOVE_VFX_KIND.targetFlash,
      MOVE_VFX_KIND.miss,
    ])
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: MOVE_VFX_KIND.targetFlash,
        targetId: 'target-a',
        targetCell: { x: 1, y: 0, z: 0 },
        shake: true,
        startOffsetMs: 140,
      }),
      expect.objectContaining({
        kind: MOVE_VFX_KIND.miss,
        targetId: 'target-b',
        targetCell: { x: 2, y: 0, z: 0 },
        startOffsetMs: 200,
      }),
    ]))
    expect(events.some((event) => 'targetId' in event && event.targetId === 'excluded-ally')).toBe(false)
  })

  it('no-ops safely when the user token is missing', () => {
    expect(planGenericMoveAnimations(selfInput({ user: null }))).toEqual([])
    expect(planGenericMoveAnimations(baseInput({ user: null }))).toEqual([])
    expect(planGenericMoveAnimations(areaInput([{ x: 1, y: 0, z: 0 }], { user: null }))).toEqual([])
  })

  it('uses neutral user fallbacks for missing target IDs and empty area cells', () => {
    const missingTargetEvents = planGenericMoveAnimations(baseInput({
      targets: [],
      selectedTargetIds: [],
      script: script({
        moveName: 'Missing Target Metadata',
        damaging: true,
        damageBase: 6,
        damageClass: 'Special',
        type: 'Electric',
        range: 'Range 6, 1 Target',
      }),
    }))
    const emptyAreaEvents = planGenericMoveAnimations(areaInput([], {
      script: script({
        moveName: 'Empty Area Metadata',
        targetMode: 'multi-target',
        damaging: true,
        damageBase: 6,
        damageClass: 'Special',
        type: 'Fire',
        areaTemplates: [{ kind: 'burst', size: 2, label: 'Burst 2' }],
      }),
    }))

    expect(missingTargetEvents).toEqual([
      expect.objectContaining({
        kind: MOVE_VFX_KIND.selfPulse,
        originCell: { x: 0, y: 0, z: 0 },
        palette: MOVE_VFX_TONE_COLORS.neutral,
      }),
    ])
    expect(emptyAreaEvents).toEqual([
      expect.objectContaining({
        kind: MOVE_VFX_KIND.selfPulse,
        originCell: { x: 0, y: 0, z: 0 },
        palette: MOVE_VFX_TONE_COLORS.neutral,
      }),
    ])
  })

  it('keeps target-id-only events safe when the target token snapshot is missing', () => {
    const events = planGenericMoveAnimations(baseInput({
      targets: [],
      selectedTargetIds: ['missing-target'],
      script: script({
        moveName: 'Missing Target Snapshot',
        damaging: true,
        damageBase: 6,
        damageClass: 'Special',
        type: 'Water',
        range: 'Range 6, 1 Target',
      }),
    }))

    expect(events.map((event) => event.kind)).toEqual([
      MOVE_VFX_KIND.projectile,
      MOVE_VFX_KIND.targetFlash,
    ])
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetId: 'missing-target',
        targetCell: undefined,
      }),
    ]))
  })

  it('falls back to the neutral palette for unknown damaging move types', () => {
    const events = planGenericMoveAnimations(baseInput({
      script: script({
        moveName: 'Unknown Type Metadata',
        damaging: true,
        damageBase: 6,
        damageClass: 'Special',
        type: 'Starlight',
        range: 'Range 6, 1 Target',
      }),
    }))

    expect(events[0]).toMatchObject({
      kind: MOVE_VFX_KIND.projectile,
      palette: MOVE_VFX_TONE_COLORS.neutral,
    })
  })

  it('normalizes malformed override events with missing durations', () => {
    const input = baseInput({
      script: script({
        moveName: 'Malformed Override Duration',
      }),
    })
    const planner = createMoveAnimationPlanner({
      logPlanningWarnings: false,
      overrideRegistry: {
        [canonicalMoveAnimationOverrideKey('Malformed Override Duration')]: {
          preset: {
            id: 'test-only-missing-duration',
            plan: (overrideInput) => [{
              id: 'missing-duration-event',
              moveName: '',
              userId: '',
              createdAtMs: Number.NaN,
              kind: MOVE_VFX_KIND.selfPulse,
              originCell: overrideInput.user?.position,
            } as unknown as MoveAnimationEvent],
          },
        },
      },
    })

    expect(planner(input)).toEqual([
      expect.objectContaining({
        id: 'missing-duration-event',
        moveName: 'Malformed Override Duration',
        userId: 'user-token',
        createdAtMs: 1234,
        durationMs: MOVE_VFX_DEFAULT_DURATIONS_MS.normal,
        kind: MOVE_VFX_KIND.selfPulse,
      }),
    ])
  })

  it('catches planner failures and returns a safe fallback instead of throwing', () => {
    const planner = createMoveAnimationPlanner({
      logPlanningWarnings: false,
      fallbackPlanner: () => {
        throw new Error('planner failed')
      },
    })

    expect(() => planner(baseInput())).not.toThrow()
    expect(planner(baseInput())).toEqual([
      expect.objectContaining({
        kind: MOVE_VFX_KIND.selfPulse,
        originCell: { x: 0, y: 0, z: 0 },
        palette: MOVE_VFX_TONE_COLORS.neutral,
      }),
    ])
  })

  it('gates move VFX planning debug logs behind explicit dev-only query flags', () => {
    expect(hasMoveAnimationPlanningDebugQueryFlag('?debug=move-vfx-planning')).toBe(true)
    expect(hasMoveAnimationPlanningDebugQueryFlag({ debug: ['render', 'vfx-plan'] })).toBe(true)
    expect(hasMoveAnimationPlanningDebugQueryFlag('?debug=render')).toBe(false)

    expect(isMoveAnimationPlanningDebugEnabled({
      query: '?debug=move-vfx-planning',
      isDev: true,
    })).toBe(true)
    expect(isMoveAnimationPlanningDebugEnabled({
      query: '?debug=move-vfx-planning',
      isDev: false,
    })).toBe(false)
    expect(isMoveAnimationPlanningDebugEnabled({
      query: '?debug=move-vfx-planning',
      isDev: false,
      allowProduction: true,
    })).toBe(true)
  })

  it('logs a development planning summary without token identifiers when debug logging is enabled', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const planner = createMoveAnimationPlanner({
      logPlanningWarnings: false,
      logPlanningDebug: true,
    })

    const events = planner(baseInput({
      script: script({
        moveName: 'Generic Debug Damage',
        damaging: true,
        damageBase: 6,
        damageClass: 'Special',
        type: 'Water',
        range: 'Range 6, 1 Target',
      }),
    }))

    expect(events.map((event) => event.kind)).toEqual([
      MOVE_VFX_KIND.projectile,
      MOVE_VFX_KIND.targetFlash,
    ])
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0]?.[0]).toBe('[move-vfx:planner]')
    expect(info.mock.calls[0]?.[1]).toMatchObject({
      devOnly: true,
      moveName: 'Generic Debug Damage',
      resolution: MOVE_ANIMATION_PLAN_RESOLUTION.singleTarget,
      scriptTargetMode: 'one-target',
      plannerSource: 'generic',
      selectedVfxKinds: [MOVE_VFX_KIND.projectile, MOVE_VFX_KIND.targetFlash],
      eventCount: 2,
      fallbackReasons: [],
    })
    expect(JSON.stringify(info.mock.calls[0]?.[1])).not.toContain('user-token')
    expect(JSON.stringify(info.mock.calls[0]?.[1])).not.toContain('target-token')
  })

  it('includes understandable fallback reasons in planning debug summaries', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const planner = createMoveAnimationPlanner({
      logPlanningWarnings: false,
      logPlanningDebug: true,
    })

    planner(baseInput({
      targets: [],
      selectedTargetIds: [],
      script: script({
        moveName: 'Missing Target Debug Metadata',
        damaging: true,
        damageBase: 6,
        damageClass: 'Special',
        type: 'Electric',
        range: 'Range 6, 1 Target',
      }),
    }))

    expect(info.mock.calls[0]?.[1]).toMatchObject({
      moveName: 'Missing Target Debug Metadata',
      selectedVfxKinds: [MOVE_VFX_KIND.selfPulse],
      fallbackReasons: [
        'single-target flow had no target id; used neutral self-pulse fallback when possible',
      ],
    })
  })

  it('returns a neutral fallback event for unusual scripts without targetable metadata', () => {
    const events = planGenericMoveAnimations(baseInput({
      targets: [],
      selectedTargetIds: [],
      script: script({
        moveName: 'Unusual Metadata',
        targetMode: 'none',
        damaging: false,
        damageClass: null,
        type: 'Custom',
      }),
    }))

    expect(events).toEqual([
      expect.objectContaining({
        id: 'test-plan-self-pulse-01',
        kind: MOVE_VFX_KIND.selfPulse,
        originCell: { x: 0, y: 0, z: 0 },
        palette: MOVE_VFX_TONE_COLORS.neutral,
      }),
    ])
  })
})
