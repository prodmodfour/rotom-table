import { afterEach, describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import menuStatusJson from '../../data/move-automation/menu-status.json'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
  type ResolveMoveSelection,
} from '#shared/livePlayMoveResolution'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { MoveAutomationAreaTemplate } from '~/types/moveAutomation'
import type { TrainerSheet } from '~/types/trainerSheet'
import { nativeMoveAutomationPresentationScriptForMove } from '~/utils/move-automation/nativePresentation'
import { moveAutomationAreaTemplateId } from '~/utils/moveAutomationAreaTemplates'
import {
  planAuthoritativeMoveState,
  type AuthoritativeMoveStatePlan,
} from '~~/server/domain/planAuthoritativeMoveState'
import {
  registeredMoveAutomationRuntimeFor,
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
} from '~~/server/domain/moveAutomation/registry'
import {
  AREA_STAGES_207_MOVE_SPEC_REGISTRATIONS,
  GEAR_UP_MOVE_SPEC,
  GLACIATE_MOVE_SPEC,
  HAZE_MOVE_SPEC,
  HEART_SWAP_MOVE_SPEC,
  HYPER_VOICE_MOVE_SPEC,
  HYPERSPACE_FURY_MOVE_SPEC,
  LEAF_STORM_MOVE_SPEC,
  LEAF_TORNADO_MOVE_SPEC,
  MA_207_MOVE_NAMES,
  type AreaStages207MoveName,
} from '~~/server/domain/moveAutomation/specs/areaStages207'
import {
  MA_207_SCENARIOS_BY_MOVE,
  type AreaStages207ScenarioEvidence,
} from '../fixtures/moveAutomation/areaStages207'
import { LivePlayIntegrationHarness } from './livePlayIntegrationHarness'

const ACTOR_ID = 'actor-token'
const NOW = 9_000
const SOURCE_MODULE = 'server/domain/moveAutomation/specs/areaStages207.ts'

const BURST_4: MoveAutomationAreaTemplate = { kind: 'burst', size: 4, label: 'Burst 4' }
const BURST_2: MoveAutomationAreaTemplate = { kind: 'burst', size: 2, label: 'Burst 2' }
const CLOSE_BLAST_3: MoveAutomationAreaTemplate = {
  kind: 'close-blast',
  size: 3,
  label: 'Close Blast 3',
}
const RANGED_8_BLAST_3: MoveAutomationAreaTemplate = {
  kind: 'ranged-blast',
  range: 8,
  size: 3,
  label: 'Ranged 8 Blast 3',
}
const RANGED_6_BLAST_3: MoveAutomationAreaTemplate = {
  kind: 'ranged-blast',
  range: 6,
  size: 3,
  label: 'Ranged 6 Blast 3',
}

interface MoveDefinition {
  readonly slug: string
  readonly ac: number | null
  readonly damageBase: number | null
  readonly damageClass: 'Physical' | 'Special' | 'Status'
  readonly moveType: string
  readonly frequency: string
  readonly template: MoveAutomationAreaTemplate | null
  readonly selectionKind: 'area' | 'self' | 'target-count'
}

const MOVE_DEFINITIONS: Readonly<Record<AreaStages207MoveName, MoveDefinition>> = {
  'Gear Up': {
    slug: 'gear-up', ac: null, damageBase: null, damageClass: 'Status', moveType: 'Steel',
    frequency: 'Scene x2', template: BURST_4, selectionKind: 'area',
  },
  Glaciate: {
    slug: 'glaciate', ac: 3, damageBase: 7, damageClass: 'Special', moveType: 'Ice',
    frequency: 'EOT', template: BURST_2, selectionKind: 'area',
  },
  Haze: {
    slug: 'haze', ac: null, damageBase: null, damageClass: 'Status', moveType: 'Ice',
    frequency: 'Scene x2', template: null, selectionKind: 'self',
  },
  'Heart Swap': {
    slug: 'heart-swap', ac: null, damageBase: null, damageClass: 'Status', moveType: 'Psychic',
    frequency: 'Daily', template: null, selectionKind: 'target-count',
  },
  'Hyper Voice': {
    slug: 'hyper-voice', ac: 2, damageBase: 9, damageClass: 'Special', moveType: 'Normal',
    frequency: 'Scene x2', template: CLOSE_BLAST_3, selectionKind: 'area',
  },
  'Hyperspace Fury': {
    slug: 'hyperspace-fury', ac: 2, damageBase: 10, damageClass: 'Physical', moveType: 'Dark',
    frequency: 'Daily', template: BURST_2, selectionKind: 'area',
  },
  'Leaf Storm': {
    slug: 'leaf-storm', ac: 4, damageBase: 13, damageClass: 'Special', moveType: 'Grass',
    frequency: 'Scene', template: RANGED_8_BLAST_3, selectionKind: 'area',
  },
  'Leaf Tornado': {
    slug: 'leaf-tornado', ac: 4, damageBase: 7, damageClass: 'Special', moveType: 'Grass',
    frequency: 'EOT', template: RANGED_6_BLAST_3, selectionKind: 'area',
  },
}

const MOVE_SPECS = new Map<AreaStages207MoveName, typeof GEAR_UP_MOVE_SPEC>([
  ['Gear Up', GEAR_UP_MOVE_SPEC],
  ['Glaciate', GLACIATE_MOVE_SPEC],
  ['Haze', HAZE_MOVE_SPEC],
  ['Heart Swap', HEART_SWAP_MOVE_SPEC],
  ['Hyper Voice', HYPER_VOICE_MOVE_SPEC],
  ['Hyperspace Fury', HYPERSPACE_FURY_MOVE_SPEC],
  ['Leaf Storm', LEAF_STORM_MOVE_SPEC],
  ['Leaf Tornado', LEAF_TORNADO_MOVE_SPEC],
])

interface TargetProfile {
  readonly id: string
  readonly position: { readonly x: number; readonly y: number; readonly z: number }
  readonly sideId?: 'heroes' | 'foes' | null
  readonly types?: readonly string[]
  readonly abilities?: readonly string[]
  readonly conditions?: readonly string[]
  readonly size?: 'Small' | 'Medium' | 'Large' | 'Huge' | 'Gigantic'
  readonly stages?: Readonly<Partial<Record<'atk' | 'def' | 'satk' | 'sdef' | 'spd' | 'acc', number>>>
}

interface CohortFixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  readonly candidateScopePlacementIds: readonly string[]
  readonly randomValues: readonly number[]
}

const harnesses: LivePlayIntegrationHarness[] = []
afterEach(() => {
  while (harnesses.length > 0) harnesses.pop()?.dispose()
})

const d20 = (naturalResult: number): number => (naturalResult - 0.5) / 20

const randomSequence = (values: readonly number[]): (() => number) => {
  let index = 0
  return () => values[index++] ?? values.at(-1) ?? 0
}

const placement = (
  id: string,
  position: TargetProfile['position'],
  sideId: TargetProfile['sideId'] = 'foes',
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug: id,
  ...(sideId ? { sideId } : {}),
  position: { ...position },
})

const pokemonSheet = (options: {
  readonly slug: string
  readonly moveName?: AreaStages207MoveName
  readonly profile?: Omit<TargetProfile, 'id' | 'position' | 'sideId'>
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.slug,
  species: 'Bulbasaur',
  types: [...(options.profile?.types ?? ['Normal'])],
  gender: 'Genderless',
  level: 30,
  revision: 3,
  capabilities: { overland: 6, size: options.profile?.size ?? 'Medium' },
  movelist: options.moveName ? [{ name: options.moveName }] : [],
  abilities: (options.profile?.abilities ?? []).map(name => ({ name })),
  stats: {
    hp: { added: 500 },
    atk: { added: 20, stage: options.profile?.stages?.atk ?? 0 },
    def: { added: 10, stage: options.profile?.stages?.def ?? 0 },
    satk: { added: 20, stage: options.profile?.stages?.satk ?? 0 },
    sdef: { added: 10, stage: options.profile?.stages?.sdef ?? 0 },
    spd: { added: 10, stage: options.profile?.stages?.spd ?? 0 },
  },
  combatStages: { acc: options.profile?.stages?.acc ?? 0 },
  combat: {
    currentHp: 500,
    conditions: [...(options.profile?.conditions ?? [])],
  },
})

const defaultTargets = (moveName: AreaStages207MoveName): readonly TargetProfile[] => {
  if (moveName === 'Heart Swap') {
    return [
      { id: 'target-a', position: { x: 5, y: 0, z: 5 } },
      { id: 'target-b', position: { x: 6, y: 0, z: 5 } },
    ]
  }
  if (moveName === 'Leaf Storm' || moveName === 'Leaf Tornado') {
    return [{ id: 'target-a', position: { x: 7, y: 0, z: 5 } }]
  }
  return [{ id: 'target-a', position: { x: 5, y: 0, z: 5 } }]
}

const selectionFor = (input: {
  readonly moveName: AreaStages207MoveName
  readonly targets: readonly TargetProfile[]
  readonly aimCell?: TargetProfile['position']
}): ResolveMoveSelection => {
  const definition = MOVE_DEFINITIONS[input.moveName]
  if (definition.selectionKind === 'self') return { kind: 'self' }
  if (definition.selectionKind === 'target-count') {
    return { kind: 'target-count', targetPlacementIds: input.targets.map(({ id }) => id) }
  }
  const template = definition.template!
  const common = {
    kind: 'area' as const,
    areaTemplateId: moveAutomationAreaTemplateId(template),
  }
  if (template.kind === 'close-blast' || template.kind === 'ranged-blast') {
    return {
      ...common,
      aimCell: { ...(input.aimCell ?? input.targets[0]?.position ?? { x: 5, y: 0, z: 5 }) },
    }
  }
  return common
}

const fixture = (options: {
  readonly moveName: AreaStages207MoveName
  readonly targets?: readonly TargetProfile[]
  readonly naturalResults?: readonly number[]
  readonly actorStages?: TargetProfile['stages']
  readonly aimCell?: TargetProfile['position']
  readonly voxels?: TabletopMap['voxels']
}): CohortFixture => {
  const definition = MOVE_DEFINITIONS[options.moveName]
  const targets = options.targets ?? defaultTargets(options.moveName)
  const encounter = createEmptyEncounterState()
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `ma207-${definition.slug}`,
    name: `MA-207 ${options.moveName}`,
    revision: 7,
    dimensions: { x: 24, y: 4, z: 16 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [...(options.voxels ?? [])],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      placement(ACTOR_ID, { x: 4, y: 0, z: 5 }, 'heroes'),
      ...targets.map(target => placement(
        target.id,
        target.position,
        target.sideId === undefined ? 'foes' : target.sideId,
      )),
    ],
    lights: [],
    initiative: { activeId: ACTOR_ID, round: 1 },
    activeScene: { name: 'MA-207 scene', startedAt: 100 },
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
    },
    metadata: { note: 'preserved' },
    createdAt: 1,
    updatedAt: 100,
  }
  const sheets = new Map<string, CharacterSheet>([[
    ACTOR_ID,
    pokemonSheet({
      slug: ACTOR_ID,
      moveName: options.moveName,
      profile: {
        types: [definition.moveType],
        stages: options.actorStages,
      },
    }),
  ]])
  for (const target of targets) {
    sheets.set(target.id, pokemonSheet({
      slug: target.id,
      profile: {
        types: target.types,
        abilities: target.abilities,
        conditions: target.conditions,
        size: target.size,
        stages: target.stages,
      },
    }))
  }
  return {
    map,
    pokemonSheets: sheets,
    trainerSheets: new Map(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: ACTOR_ID,
      moveName: options.moveName,
      selection: selectionFor({
        moveName: options.moveName,
        targets,
        aimCell: options.aimCell,
      }),
    },
    candidateScopePlacementIds: targets.map(({ id }) => id),
    randomValues: [
      ...(options.naturalResults ?? targets.map(() => 10)).map(d20),
      ...Array.from({ length: 160 }, () => 0),
    ],
  }
}

const plan = (
  input: CohortFixture,
  operationId = 'op_ma207_plan',
): AuthoritativeMoveStatePlan => planAuthoritativeMoveState({
  ...input,
  random: randomSequence(input.randomValues),
  now: () => NOW,
  operationId,
  idFactory: (() => {
    let sequence = 0
    return () => `ma207-plan-id-${++sequence}`
  })(),
})

const operationEvent = (
  result: AuthoritativeMoveStatePlan,
  operationId: string,
) => result.resolution.auditTrace.events.findLast(event => (
  event.kind === 'operation' && event.operationId === operationId
))

const operationRecipient = (
  result: AuthoritativeMoveStatePlan,
  operationId: string,
  recipientId: string,
): Readonly<Record<string, unknown>> | null => {
  const event = operationEvent(result, operationId)
  if (!event || event.kind !== 'operation' || typeof event.result !== 'object' || !event.result) {
    return null
  }
  const recipients = 'recipients' in event.result && Array.isArray(event.result.recipients)
    ? event.result.recipients
    : []
  return recipients.find((recipient): recipient is Readonly<Record<string, unknown>> => (
    typeof recipient === 'object'
    && recipient !== null
    && 'recipientId' in recipient
    && recipient.recipientId === recipientId
  )) ?? null
}

const normalizedEvidence = (
  scenarios: readonly AreaStages207ScenarioEvidence[],
) => scenarios.map(scenario => ({
  scenarioId: scenario.scenarioId,
  evidenceClasses: [...scenario.evidenceClasses].sort(),
})).sort((left, right) => left.scenarioId.localeCompare(right.scenarioId))

const stageUpdate = (
  result: AuthoritativeMoveStatePlan,
  recipientId: string,
) => result.resolution.transaction.combatStageUpdates.find(({ id }) => id === recipientId)

const positionFor = (
  result: AuthoritativeMoveStatePlan,
  placementId: string,
) => result.nextMap.placements.find(({ id }) => id === placementId)?.position

const cellKey = (cell: { readonly x: number; readonly y: number; readonly z: number }) => (
  `${cell.x},${cell.y},${cell.z}`
)

const safeOperationId = (moveName: AreaStages207MoveName): string => (
  `op_ma207_${moveName.toLowerCase().replaceAll(/[^a-z0-9]+/g, '_')}_duplicate`
)

describe('MA-207 ally filters, stage transforms, self costs, and area outcomes', () => {
  it('selects exactly eight complete reviewed native runtimes with linked evidence', () => {
    for (const moveName of MA_207_MOVE_NAMES) {
      const row = manifestJson.moves.find(candidate => candidate.canonicalId === moveName)!
      expect(row).toMatchObject({
        baseStatus: 'complete',
        interactionStatus: 'unassessed',
        runtime: {
          kind: 'movespec-v2',
          version: 2,
          definitionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          sourceModule: SOURCE_MODULE,
        },
        suggestedCapabilityTags: [],
        blockerCodes: [],
        limitations: [],
        manualSteps: [],
        reviewedAt: '2026-07-19',
        rolloutCohortId: 'ma-207',
      })
      expect(row.scenarioIds).toEqual(
        MA_207_SCENARIOS_BY_MOVE[moveName].map(({ scenarioId }) => scenarioId),
      )
      expect(normalizedEvidence(row.conformanceEvidence.scenarios))
        .toEqual(normalizedEvidence(MA_207_SCENARIOS_BY_MOVE[moveName]))
      expect(registeredMoveAutomationRuntimeFor(moveName)).toMatchObject({
        kind: 'movespec-v2',
        definition: { spec: { canonicalId: moveName } },
        definitionHash: row.runtime.definitionHash,
      })
      expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS.filter(entry => entry.canonicalId === moveName))
        .toHaveLength(1)
      expect(AREA_STAGES_207_MOVE_SPEC_REGISTRATIONS.filter(entry => entry.canonicalId === moveName))
        .toHaveLength(1)
      expect(menuStatusJson.moves.find(candidate => candidate.canonicalId === moveName))
        .toMatchObject({ baseStatus: 'complete', runtimeKind: 'movespec-v2', blockerCodes: [] })

      const presentation = nativeMoveAutomationPresentationScriptForMove(moveName)
      const definition = MOVE_DEFINITIONS[moveName]
      expect(presentation).toMatchObject({
        moveName,
        damaging: definition.damageBase !== null,
        damageBase: definition.damageBase ?? 0,
        damageClass: definition.damageClass,
        ac: definition.ac,
        automationNotes: [],
      })
      expect(presentation?.areaTemplates ?? []).toEqual(
        definition.template ? [definition.template] : [],
      )
    }
  })

  it('encodes each rule branch as bounded server-owned operations', () => {
    for (const [moveName, spec] of MOVE_SPECS) {
      expect(spec).toMatchObject({
        canonicalId: moveName,
        version: 2,
        costs: [{
          id: `${MOVE_DEFINITIONS[moveName].slug}.cost.standard-action`,
          phase: 'pay',
          cost: { kind: 'action-resource', resource: 'standard', amount: 1 },
        }],
      })
      expect(JSON.stringify(spec)).not.toMatch(/manual|client-authored|free-form/i)
    }
    expect(GEAR_UP_MOVE_SPEC).toMatchObject({
      targeting: { predicate: { statePredicates: [{ kind: 'type', typeIds: ['steel'] }] } },
    })
    expect(HAZE_MOVE_SPEC.targeting).toMatchObject({ kind: 'self' })
    expect(HAZE_MOVE_SPEC.phases.flatMap(block => block.operations))
      .toContainEqual(expect.objectContaining({
        id: 'haze.reset-all-stages',
        recipients: { kind: 'all-placements' },
        payload: expect.objectContaining({ action: 'reset', stage: 'all' }),
      }))
    expect(HEART_SWAP_MOVE_SPEC.phases.flatMap(block => block.operations))
      .toContainEqual(expect.objectContaining({
        id: 'heart-swap.swap-all-stages',
        recipients: { kind: 'selected-targets' },
        payload: expect.objectContaining({ action: 'swap', stage: 'all' }),
      }))
    expect(HYPER_VOICE_MOVE_SPEC.phases.flatMap(block => block.operations))
      .toContainEqual(expect.objectContaining({
        id: 'hyper-voice.push-outside-blast',
        payload: expect.objectContaining({ distance: { kind: 'area-exit', maximum: 16 } }),
      }))
    expect(LEAF_TORNADO_MOVE_SPEC).toMatchObject({
      targeting: {
        predicate: {
          areaGeometry: { kind: 'exclude-center-by-size', sizes: ['small', 'medium'] },
        },
      },
    })
  })

  it.each([
    'Glaciate',
    'Hyper Voice',
    'Hyperspace Fury',
    'Leaf Storm',
    'Leaf Tornado',
  ] as const)('%s reuses its authoritative natural twenty for critical damage', (moveName) => {
    const target = moveName === 'Leaf Tornado'
      ? { id: 'target-a', position: { x: 6, y: 0, z: 5 } }
      : defaultTargets(moveName)[0]!
    const result = plan(fixture({
      moveName,
      targets: [target],
      aimCell: moveName === 'Leaf Tornado' ? { x: 7, y: 0, z: 5 } : undefined,
      naturalResults: [20],
    }), `op_ma207_${MOVE_DEFINITIONS[moveName].slug}_critical`)
    expect(operationRecipient(result, `${MOVE_DEFINITIONS[moveName].slug}.damage`, target.id))
      .toMatchObject({
        outcome: 'applied',
        details: { calculation: { criticalHit: { naturalRoll: 20, critical: true } } },
      })
    expect(result.resolution.rollLedger.filter(entry => (
      entry.parentEffectId === `${MOVE_DEFINITIONS[moveName].slug}.accuracy`
    ))).toHaveLength(1)
  })

  it('filters Gear Up to authoritative Steel targets and caps each independent stage', () => {
    const result = plan(fixture({
      moveName: 'Gear Up',
      targets: [{
        id: 'steel', position: { x: 5, y: 0, z: 5 }, types: ['Steel'],
        stages: { atk: 6, satk: 4 },
      }, {
        id: 'normal', position: { x: 6, y: 0, z: 5 }, types: ['Normal'],
      }],
    }), 'op_ma207_gear_up')

    expect(result.resolution.selectedTargetIds).toEqual(['steel'])
    expect(result.resolution.transaction.attackedTargetIds).toEqual(['steel'])
    expect(stageUpdate(result, 'steel')).toMatchObject({
      stages: expect.objectContaining({ atk: 6, satk: 5 }),
    })
    expect(stageUpdate(result, 'normal')).toBeUndefined()
    expect(result.resolution.area?.targetEvaluations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetPlacementId: 'normal',
        outcome: 'excluded',
        reasonCode: 'target-excluded-type',
      }),
    ]))
    expect(result.resolution.rollLedger).toEqual([])
  })

  it('resolves Glaciate Speed, even-roll Slow, grounding, misses, and immunities per target', () => {
    const result = plan(fixture({
      moveName: 'Glaciate',
      targets: [{
        id: 'grounded', position: { x: 5, y: 0, z: 5 }, stages: { spd: 2 },
      }, {
        id: 'airborne', position: { x: 4, y: 0, z: 4 }, abilities: ['Levitate'], stages: { spd: 2 },
      }, {
        id: 'grounded-odd', position: { x: 3, y: 0, z: 5 }, stages: { spd: 2 },
      }, {
        id: 'missed', position: { x: 4, y: 0, z: 6 }, stages: { spd: 2 },
      }],
      naturalResults: [16, 16, 15, 1],
    }), 'op_ma207_glaciate')

    expect(result.resolution.transaction.hitTargetIds).toEqual([
      'grounded',
      'airborne',
      'grounded-odd',
    ])
    expect(stageUpdate(result, 'grounded')).toMatchObject({ stages: expect.objectContaining({ spd: 1 }) })
    expect(stageUpdate(result, 'airborne')).toMatchObject({ stages: expect.objectContaining({ spd: 1 }) })
    expect(stageUpdate(result, 'grounded-odd')).toMatchObject({ stages: expect.objectContaining({ spd: 1 }) })
    expect(stageUpdate(result, 'missed')).toBeUndefined()
    expect(result.resolution.transaction.conditionUpdates).toEqual([
      expect.objectContaining({ id: 'grounded', conditions: expect.arrayContaining(['Slowed']) }),
    ])
    expect(operationRecipient(result, 'glaciate.slowed', 'grounded-odd'))
      .toMatchObject({ outcome: 'no-op', reasonCode: 'condition-accuracy-roll-trigger-not-met' })
    expect(result.resolution.auditTrace.events).toContainEqual(expect.objectContaining({
      kind: 'predicate',
      predicateId: 'glaciate.grounded-selection',
      outcome: false,
    }))

    const immune = plan(fixture({
      moveName: 'Glaciate',
      targets: [{
        id: 'protected',
        position: { x: 5, y: 0, z: 5 },
        abilities: ['Clear Body', 'Shield Dust'],
        stages: { spd: 2 },
      }],
      naturalResults: [16],
    }), 'op_ma207_glaciate_immunity')
    expect(immune.resolution.transaction.hpUpdates).toHaveLength(1)
    expect(stageUpdate(immune, 'protected')).toMatchObject({
      stages: expect.objectContaining({ spd: 1 }),
    })
    expect(immune.resolution.transaction.conditionUpdates).toEqual([])
    expect(operationRecipient(immune, 'glaciate.slowed', 'protected'))
      .toMatchObject({ outcome: 'prevented', reasonCode: 'condition-immunity' })
  })

  it('resets every placed Pokémon and Trainer through Haze without accepting targets or drawing RNG', () => {
    const input = fixture({
      moveName: 'Haze',
      actorStages: { atk: 3, def: -2, acc: 2 },
      targets: [{
        id: 'target-a', position: { x: 12, y: 0, z: 12 },
        stages: { atk: -4, satk: 5, spd: -1, acc: -3 },
      }, {
        id: 'target-b', position: { x: 20, y: 0, z: 2 },
        stages: { def: 4, sdef: -5 },
      }],
    })
    const trainer: TrainerSheet = {
      slug: 'trainer-a',
      name: 'Trainer A',
      level: 20,
      revision: 4,
      stats: {
        atk: { stage: 4 },
        def: { stage: -3 },
        satk: { stage: 2 },
        sdef: { stage: -1 },
        spd: { stage: 5 },
      },
      combatStages: { acc: -4 },
    }
    const result = plan({
      ...input,
      map: {
        ...input.map,
        placements: [...input.map.placements, {
          id: 'trainer-a',
          sheetKind: 'trainer',
          sheetSlug: 'trainer-a',
          sideId: 'heroes',
          position: { x: 2, y: 0, z: 2 },
        }],
      },
      trainerSheets: new Map([['trainer-a', trainer]]),
    }, 'op_ma207_haze')

    expect(result.resolution.selectedTargetIds).toEqual([])
    expect(result.resolution.transaction.attackedTargetIds).toEqual([])
    expect(result.resolution.transaction.hitTargetIds).toEqual([])
    expect(result.resolution.transaction.combatStageUpdates.map(({ id }) => id))
      .toEqual([ACTOR_ID, 'target-a', 'target-b', 'trainer-a'])
    for (const update of result.resolution.transaction.combatStageUpdates) {
      expect(update.stages).toEqual({ atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 })
    }
    expect(result.sheetReads.map(read => read.slug)).toEqual(expect.arrayContaining([
      ACTOR_ID,
      'target-a',
      'target-b',
      'trainer-a',
    ]))
    expect(result.resolution.rollLedger).toEqual([])
  })

  it('atomically swaps every Heart Swap combat stage between exactly two targets', () => {
    const result = plan(fixture({
      moveName: 'Heart Swap',
      targets: [{
        id: 'target-a', position: { x: 5, y: 0, z: 5 },
        stages: { atk: 4, def: -1, satk: 2, sdef: -3, spd: 1, acc: 5 },
      }, {
        id: 'target-b', position: { x: 6, y: 0, z: 5 },
        stages: { atk: -2, def: 3, satk: -4, sdef: 2, spd: -5, acc: -1 },
      }],
    }), 'op_ma207_heart_swap')

    expect(result.resolution.selectedTargetIds).toEqual(['target-a', 'target-b'])
    expect(stageUpdate(result, 'target-a')?.stages).toEqual({
      atk: -2, def: 3, satk: -4, sdef: 2, spd: -5, acc: -1,
    })
    expect(stageUpdate(result, 'target-b')?.stages).toEqual({
      atk: 4, def: -1, satk: 2, sdef: -3, spd: 1, acc: 5,
    })

    const identical = plan(fixture({
      moveName: 'Heart Swap',
      targets: [{
        id: 'target-a', position: { x: 5, y: 0, z: 5 }, stages: { atk: 2, def: -1 },
      }, {
        id: 'target-b', position: { x: 6, y: 0, z: 5 }, stages: { atk: 2, def: -1 },
      }],
    }), 'op_ma207_heart_swap_identical')
    expect(identical.resolution.transaction.combatStageUpdates).toEqual([])
    expect(operationRecipient(identical, 'heart-swap.swap-all-stages', 'target-a'))
      .toMatchObject({ outcome: 'no-op', reasonCode: 'combat-stage-unchanged' })
    expect(operationRecipient(identical, 'heart-swap.swap-all-stages', 'target-b'))
      .toMatchObject({ outcome: 'no-op', reasonCode: 'combat-stage-unchanged' })

    const invalid = fixture({
      moveName: 'Heart Swap',
      targets: [{ id: 'target-a', position: { x: 5, y: 0, z: 5 } }],
    })
    expect(() => plan(invalid, 'op_ma207_heart_swap_one_target')).toThrowError(
      expect.objectContaining({ code: 'execution-rejected' }),
    )
  })

  it('pushes each damaged Hyper Voice target to the first cell outside its authoritative blast', () => {
    const near = plan(fixture({
      moveName: 'Hyper Voice',
      targets: [{ id: 'near', position: { x: 5, y: 0, z: 5 } }],
      aimCell: { x: 5, y: 0, z: 5 },
      naturalResults: [1],
    }), 'op_ma207_hyper_voice_near')
    const far = plan(fixture({
      moveName: 'Hyper Voice',
      targets: [{ id: 'far', position: { x: 7, y: 0, z: 5 } }],
      aimCell: { x: 5, y: 0, z: 5 },
      naturalResults: [10],
    }), 'op_ma207_hyper_voice_far')

    expect(near.resolution.transaction.hitTargetIds).toEqual([])
    expect(near.resolution.transaction.hpUpdates).toHaveLength(1)
    expect(positionFor(near, 'near')).toEqual({ x: 8, y: 0, z: 5 })
    expect(positionFor(far, 'far')).toEqual({ x: 8, y: 0, z: 5 })
    expect(operationEvent(near, 'hyper-voice.push-outside-blast')).toMatchObject({
      outcome: 'applied',
    })
    expect(operationEvent(far, 'hyper-voice.push-outside-blast')).toMatchObject({
      outcome: 'applied',
    })
    const areaCells = new Set((near.resolution.area?.cells ?? []).map(cellKey))
    expect(areaCells.has(cellKey(positionFor(near, 'near')!))).toBe(false)

    const immune = plan(fixture({
      moveName: 'Hyper Voice',
      targets: [{ id: 'ghost', position: { x: 5, y: 0, z: 5 }, types: ['Ghost'] }],
      aimCell: { x: 5, y: 0, z: 5 },
      naturalResults: [10],
    }), 'op_ma207_hyper_voice_immune')
    expect(immune.resolution.transaction.hpUpdates).toEqual([])
    expect(positionFor(immune, 'ghost')).toEqual({ x: 5, y: 0, z: 5 })
    expect(operationEvent(immune, 'hyper-voice.push-outside-blast')).toMatchObject({
      outcome: 'no-op',
    })

    const obstructed = plan(fixture({
      moveName: 'Hyper Voice',
      targets: [{ id: 'blocked', position: { x: 5, y: 0, z: 5 } }],
      aimCell: { x: 5, y: 0, z: 5 },
      naturalResults: [10],
      voxels: [{ x: 7, y: 0, z: 5, materialId: 'wall', blocksMovement: true }],
    }), 'op_ma207_hyper_voice_obstructed')
    expect(positionFor(obstructed, 'blocked')).toEqual({ x: 6, y: 0, z: 5 })
    expect(operationEvent(obstructed, 'hyper-voice.push-outside-blast')).toMatchObject({
      outcome: 'applied',
      result: expect.objectContaining({
        status: 'applied',
        details: expect.objectContaining({ shortenedCount: 1 }),
        movements: [expect.objectContaining({ shortened: true, resolvedDistance: 1 })],
      }),
    })
  })

  it('suppresses Hyperspace Fury interrupts and applies its Defense cost only after damage', () => {
    const applied = plan(fixture({
      moveName: 'Hyperspace Fury',
      actorStages: { def: 2 },
      naturalResults: [10],
    }), 'op_ma207_hyperspace_fury')
    expect(applied.resolution.transaction.hpUpdates).toHaveLength(1)
    expect(stageUpdate(applied, ACTOR_ID)).toMatchObject({ stages: expect.objectContaining({ def: 1 }) })
    expect(applied.resolution.auditTrace.events).toContainEqual(expect.objectContaining({
      kind: 'predicate',
      predicateId: 'hyperspace-fury.interrupt-policy',
      reasonCode: 'hyperspace-fury.interrupts-forbidden',
    }))
    expect(applied.resolution.auditTrace.events.some(event => (
      event.kind === 'operation' && event.operationKind === 'reaction-request'
    ))).toBe(false)

    const empty = plan(fixture({
      moveName: 'Hyperspace Fury',
      actorStages: { def: 2 },
      targets: [],
      naturalResults: [],
    }), 'op_ma207_hyperspace_fury_empty')
    expect(empty.resolution.transaction.hpUpdates).toEqual([])
    expect(stageUpdate(empty, ACTOR_ID)).toBeUndefined()

    const missed = plan(fixture({
      moveName: 'Hyperspace Fury',
      actorStages: { def: 2 },
      naturalResults: [1],
    }), 'op_ma207_hyperspace_fury_miss')
    expect(missed.resolution.transaction.hpUpdates).toEqual([])
    expect(stageUpdate(missed, ACTOR_ID)).toBeUndefined()
  })

  it('applies Leaf Storm Smite and lowers Special Attack once only when damage applies', () => {
    const applied = plan(fixture({
      moveName: 'Leaf Storm',
      actorStages: { satk: 3 },
      naturalResults: [1],
    }), 'op_ma207_leaf_storm')
    expect(applied.resolution.transaction.hitTargetIds).toEqual([])
    expect(applied.resolution.transaction.hpUpdates).toHaveLength(1)
    expect(stageUpdate(applied, ACTOR_ID)).toMatchObject({ stages: expect.objectContaining({ satk: 1 }) })

    const immune = plan(fixture({
      moveName: 'Leaf Storm',
      actorStages: { satk: 3 },
      targets: [{
        id: 'sap-sipper', position: { x: 7, y: 0, z: 5 }, abilities: ['Sap Sipper'],
      }],
      naturalResults: [10],
    }), 'op_ma207_leaf_storm_immune')
    expect(immune.resolution.transaction.hpUpdates).toEqual([])
    expect(stageUpdate(immune, ACTOR_ID)).toBeUndefined()
  })

  it('excludes Small and Medium center recipients from Leaf Tornado before rolls', () => {
    const result = plan(fixture({
      moveName: 'Leaf Tornado',
      targets: [{
        id: 'center-medium', position: { x: 7, y: 0, z: 5 }, size: 'Medium',
      }, {
        id: 'outer-medium', position: { x: 6, y: 0, z: 5 }, size: 'Medium',
      }],
      aimCell: { x: 7, y: 0, z: 5 },
      naturalResults: [15],
    }), 'op_ma207_leaf_tornado_filter')

    expect(result.resolution.selectedTargetIds).toEqual(['outer-medium'])
    expect(result.resolution.transaction.attackedTargetIds).toEqual(['outer-medium'])
    expect(result.resolution.rollLedger.filter(entry => entry.parentEffectId === 'leaf-tornado.accuracy'))
      .toHaveLength(1)
    expect(stageUpdate(result, 'outer-medium')).toMatchObject({
      stages: expect.objectContaining({ acc: -1 }),
    })
    expect(result.resolution.area?.targetEvaluations).toContainEqual(expect.objectContaining({
      targetPlacementId: 'center-medium',
      outcome: 'excluded',
      reasonCode: 'target-excluded-area-center-size',
    }))

    const large = plan(fixture({
      moveName: 'Leaf Tornado',
      targets: [{ id: 'center-large', position: { x: 7, y: 0, z: 5 }, size: 'Large' }],
      aimCell: { x: 7, y: 0, z: 5 },
      naturalResults: [14],
    }), 'op_ma207_leaf_tornado_large')
    expect(large.resolution.selectedTargetIds).toEqual(['center-large'])
    expect(large.resolution.transaction.hpUpdates).toHaveLength(1)
    expect(stageUpdate(large, 'center-large')).toBeUndefined()
    expect(operationRecipient(large, 'leaf-tornado.lower-accuracy', 'center-large'))
      .toMatchObject({ outcome: 'no-op', reasonCode: 'combat-stage-trigger-not-met' })

    const missed = plan(fixture({
      moveName: 'Leaf Tornado',
      targets: [{ id: 'missed', position: { x: 6, y: 0, z: 5 } }],
      aimCell: { x: 7, y: 0, z: 5 },
      naturalResults: [1],
    }), 'op_ma207_leaf_tornado_miss')
    expect(missed.resolution.transaction.hitTargetIds).toEqual([])
    expect(missed.resolution.transaction.hpUpdates).toEqual([])
    expect(stageUpdate(missed, 'missed')).toBeUndefined()

    const immune = plan(fixture({
      moveName: 'Leaf Tornado',
      targets: [{
        id: 'sap-sipper',
        position: { x: 6, y: 0, z: 5 },
        abilities: ['Sap Sipper'],
      }],
      aimCell: { x: 7, y: 0, z: 5 },
      naturalResults: [15],
    }), 'op_ma207_leaf_tornado_immune')
    expect(immune.resolution.transaction.hpUpdates).toEqual([])
    expect(stageUpdate(immune, 'sap-sipper')).toBeUndefined()
  })

  it.each(MA_207_MOVE_NAMES)(
    '%s rejects a raced consulted sheet without partial move state or realtime publication',
    async (moveName) => {
      const input = fixture({
        moveName,
        naturalResults: defaultTargets(moveName).map(() => 10),
      })
      const map: TabletopMap = { ...input.map, slug: 'integration-arena' }
      const harness = LivePlayIntegrationHarness.create({
        map,
        sheets: [...input.pokemonSheets].map(([slug, sheet]) => ({
          kind: 'pokemon' as const,
          slug,
          revision: sheet.revision ?? 0,
          updatedAt: map.updatedAt ?? 100,
          sheet: sheet as unknown as Record<string, unknown>,
        })),
        random: randomSequence(input.randomValues),
      })
      harnesses.push(harness)
      const client = await harness.loadClient(`ma207-${MOVE_DEFINITIONS[moveName].slug}-client`)
      client.disconnect()
      const command = harness.resolveMoveCommand({
        opId: safeOperationId(moveName).replace('_duplicate', '_stale'),
        baseRevision: map.revision ?? 0,
        intent: input.intent,
        candidateScopePlacementIds: input.candidateScopePlacementIds,
      })
      const mapBefore = structuredClone(await harness.readMap())
      const actorBefore = structuredClone(await harness.readSheet('pokemon', ACTOR_ID))
      let racedTarget: Record<string, unknown> | null = null

      const response = await harness.resolveMoveWithPlanner({
        actor: { role: 'gm', clientId: 'ma207-client', playerProfile: null },
        command,
        planner: (plannerInput) => {
          const result = planAuthoritativeMoveState({
            ...plannerInput,
            random: randomSequence(input.randomValues),
          })
          expect(result.sheetReads).toContainEqual(expect.objectContaining({ slug: 'target-a' }))
          const current = harness.sheetRepository.getByRef('pokemon', 'target-a')!
          racedTarget = {
            ...structuredClone(current.sheet),
            revision: current.revision + 1,
            updatedAt: NOW + 1,
          }
          harness.sheetRepository.save({
            kind: 'pokemon',
            slug: 'target-a',
            document: racedTarget,
            revision: current.revision + 1,
            updatedAt: NOW + 1,
          })
          return result
        },
      })

      expect(response.result).toMatchObject({
        ok: false,
        reason: 'conflict',
        message: expect.stringContaining('consulted while resolving the move changed'),
      })
      expect(await harness.readMap()).toEqual(mapBefore)
      expect(await harness.readSheet('pokemon', ACTOR_ID)).toEqual(actorBefore)
      expect((await harness.readSheet('pokemon', 'target-a'))?.sheet).toEqual(racedTarget)
      expect(harness.publishedEvents).toEqual([])
      expect(harness.operationRecordCount()).toBe(0)
      expect(await client.reconnect()).toEqual(mapBefore)
      expect(client.missedEvents).toBe(0)
      expect(client.patchFailures).toEqual([])
    },
  )

  it.each(MA_207_MOVE_NAMES)(
    '%s replays an accepted duplicate without rerolling, spending, moving, or publishing twice',
    async (moveName) => {
      const input = fixture({
        moveName,
        naturalResults: defaultTargets(moveName).map(() => 10),
      })
      const map: TabletopMap = { ...input.map, slug: 'integration-arena' }
      const harness = LivePlayIntegrationHarness.create({
        map,
        sheets: [...input.pokemonSheets].map(([slug, sheet]) => ({
          kind: 'pokemon' as const,
          slug,
          revision: sheet.revision ?? 0,
          updatedAt: map.updatedAt ?? 100,
          sheet: sheet as unknown as Record<string, unknown>,
        })),
        random: randomSequence(input.randomValues),
      })
      harnesses.push(harness)
      const command = harness.resolveMoveCommand({
        opId: safeOperationId(moveName),
        baseRevision: map.revision ?? 0,
        intent: input.intent,
        candidateScopePlacementIds: input.candidateScopePlacementIds,
      })
      const actor = { role: 'gm' as const, clientId: 'ma207-client', playerProfile: null }
      const first = await harness.resolveMove({ actor, command })
      expect(first.result).toMatchObject({ ok: true })
      const committedMap = await harness.readMap()
      const committedSheets = await Promise.all(
        [...input.pokemonSheets.keys()].map(slug => harness.readSheet('pokemon', slug)),
      )
      const published = [...harness.publishedEvents]

      const duplicate = await harness.resolveMove({ actor, command })
      expect(duplicate).toEqual(first)
      expect(await harness.readMap()).toEqual(committedMap)
      expect(await Promise.all(
        [...input.pokemonSheets.keys()].map(slug => harness.readSheet('pokemon', slug)),
      )).toEqual(committedSheets)
      expect(harness.publishedEvents).toEqual(published)
      expect(harness.operationRecordCount()).toBe(1)
    },
  )
})
