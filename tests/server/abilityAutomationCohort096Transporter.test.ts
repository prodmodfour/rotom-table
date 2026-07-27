import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveStateExecution,
} from '~~/server/domain/planAuthoritativeMoveState'
import { planResumedMoveState } from '~~/server/domain/moveAutomation/planResumedMoveState'
import { resumeMoveSpec } from '~~/server/domain/moveAutomation/resumeSpec'
import { buildAuthoritativeMoveRulesContext } from '~~/server/domain/moveAutomation/context'
import { AA096_TRANSPORTER_REASON } from '~~/server/domain/abilityAutomation/mechanics/aa085to100MoveIntegration'
import {
  ABILITY_AUTOMATION_RUNTIME_REGISTRY,
  type AbilityAutomationRuntimeRegistry,
} from '~~/server/domain/abilityAutomation/registry'
import { AA096_ABILITY_SPEC_REGISTRATIONS } from '~~/server/domain/abilityAutomation/specs/aa096'
import { validateAbilitySpec } from '~~/server/domain/abilityAutomation/validateSpec'
import { moveResultFromPlan } from '~~/server/useCases/applyResolveMoveCommand'
import manifestJson from '../../data/ability-automation/manifest.json'

const transporterRegistration = AA096_ABILITY_SPEC_REGISTRATIONS.find(registration => (
  registration.canonicalId === 'Transporter'
))!
const transporterManifestRecord = manifestJson.abilities.find(record => (
  record.canonicalId === 'Transporter'
))!
const transporterDefinition = validateAbilitySpec(transporterRegistration.spec, {
  capabilityIds: transporterManifestRecord.capabilityTags,
  rulesetVersion: transporterManifestRecord.rulesProvenance,
  extensionRegistry: ABILITY_AUTOMATION_RUNTIME_REGISTRY.extensionRegistry,
  handlerRegistry: ABILITY_AUTOMATION_RUNTIME_REGISTRY.handlerRegistry,
})
const transporterRuntime = Object.freeze({
  canonicalId: 'Transporter',
  kind: 'abilityspec-v1' as const,
  version: transporterDefinition.spec.version,
  definitionHash: transporterDefinition.definitionHash,
  sourceModule: transporterRegistration.sourceModule,
  definition: transporterDefinition,
})
const TEST_ABILITY_REGISTRY: AbilityAutomationRuntimeRegistry = Object.freeze({
  size: ABILITY_AUTOMATION_RUNTIME_REGISTRY.size + 1,
  extensionRegistry: ABILITY_AUTOMATION_RUNTIME_REGISTRY.extensionRegistry,
  handlerRegistry: ABILITY_AUTOMATION_RUNTIME_REGISTRY.handlerRegistry,
  resolve: (canonicalId: string) => canonicalId === 'Transporter'
    ? transporterRuntime
    : ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(canonicalId),
  entries: () => Object.freeze([
    ...ABILITY_AUTOMATION_RUNTIME_REGISTRY.entries(),
    transporterRuntime,
  ]),
})

const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const,
    instanceId: `base:${canonicalId.toLowerCase()}`,
    canonicalId,
    definitionVersion: null,
    selections: [],
  },
})

const sheet = (input: {
  readonly slug: string
  readonly transporter?: boolean
  readonly teleporter?: number
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: 'Pikachu',
  level: 30,
  revision: 4,
  types: ['Electric'],
  abilities: input.transporter ? [ability('Transporter')] : [],
  movelist: input.transporter ? [{ name: 'Teleport' }] : [],
  stats: {
    hp: { added: 50 }, atk: { added: 20 }, def: { added: 20 },
    satk: { added: 20 }, sdef: { added: 20 }, spd: { added: 20 },
  },
  capabilities: {
    overland: 5, sky: 0, swim: 0, levitate: 0,
    ...(input.teleporter ? { other: [`Teleporter ${input.teleporter}`] } : {}),
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 150, injuries: 0, conditions: [] },
})

const fixture = (teleporter?: number) => {
  const placements: TabletopMap['placements'] = [
    {
      id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes',
      position: { x: 2, y: 0, z: 2 },
    },
    {
      id: 'ally', sheetKind: 'pokemon', sheetSlug: 'ally', sideId: 'heroes',
      position: { x: 2, y: 0, z: 3 },
    },
    {
      id: 'enemy', sheetKind: 'pokemon', sheetSlug: 'enemy', sideId: 'foes',
      position: { x: 3, y: 0, z: 2 },
    },
    {
      id: 'route-blocker', sheetKind: 'pokemon', sheetSlug: 'route-blocker', sideId: 'foes',
      position: { x: 4, y: 0, z: 2 },
    },
  ]
  const encounter = createEmptyEncounterState()
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: 'aa096-transporter',
    name: 'AA-096 Transporter',
    revision: 8,
    dimensions: { x: 28, y: 1, z: 6 },
    groundLevelY: 0,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements,
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 10 },
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history,
        sceneId: 'scene:aa096-transporter',
        currentRound: 1,
        currentTurn: { round: 1, turn: 1, placementId: 'actor' },
      },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1, turn: 1 }),
      ])),
    },
  }
  const pokemonSheets = new Map<string, CharacterSheet>([
    ['actor', sheet({ slug: 'actor', transporter: true, teleporter })],
    ['ally', sheet({ slug: 'ally' })],
    ['enemy', sheet({ slug: 'enemy' })],
    ['route-blocker', sheet({ slug: 'route-blocker' })],
  ])
  return { map, pokemonSheets, trainerSheets: new Map() }
}

type Selection = {
  readonly transporterOption: string | null
  readonly actorDestination: { readonly x: number; readonly y: number; readonly z: number }
  readonly teleporter?: number
}

const complete = (selection: Selection) => {
  const state = fixture(selection.teleporter)
  const debugContext = buildAuthoritativeMoveRulesContext({
    ...state,
    abilityRuntimeRegistry: TEST_ABILITY_REGISTRY,
    intent: {
      schemaVersion: 1 as const,
      placementId: 'actor',
      moveName: 'Teleport',
      selection: { kind: 'self' as const },
    },
    candidatePlacementIds: [], selectedPlacementIds: [],
    random: () => 0, time: 1_000, resolutionId: 'debug',
  })
  expect(debugContext.queries.abilities.has('actor', 'Transporter')).toBe(true)
  let plan = planAuthoritativeMoveStateExecution({
    ...state,
    intent: {
      schemaVersion: 1 as const,
      placementId: 'actor',
      moveName: 'Teleport',
      selection: { kind: 'self' as const },
    },
    random: () => { throw new Error('Transporter must not draw randomness.') },
    now: () => 1_000,
    operationId: 'op_aa096_transporter_declare',
    pendingResolutionId: 'resolution:aa096-transporter',
    abilityRuntimeRegistry: TEST_ABILITY_REGISTRY,
  })
  const seen: Array<{ reasonCode: string; optionIds: readonly string[] }> = []
  let responseIndex = 0
  while (isAuthoritativePendingMoveStatePlan(plan)) {
    const pending = plan.suspension.pendingResolution
    const window = pending.outstandingWindows[0]!
    seen.push({ reasonCode: window.reasonCode, optionIds: window.options.map(option => option.id) })
    let optionId: string | null
    if (window.reasonCode === AA096_TRANSPORTER_REASON) optionId = selection.transporterOption
    else if (window.reasonCode === 'teleport.teleport'
      || window.reasonCode.startsWith('ability.transporter.actor.')) {
      optionId = window.options.find(option => (
        option.selection?.kind === 'movement-destination'
        && option.selection.destination.x === selection.actorDestination.x
        && option.selection.destination.y === selection.actorDestination.y
        && option.selection.destination.z === selection.actorDestination.z
      ))?.id ?? null
      if (!optionId) throw new Error('Expected actor Teleport destination was not server-issued.')
    }
    else if (window.reasonCode.startsWith('ability.transporter.')) {
      optionId = window.options[0]?.id ?? null
      if (!optionId) throw new Error('Expected translated companion destination was not server-issued.')
    }
    else optionId = null

    const execution = resumeMoveSpec({
      pendingResolution: structuredClone(pending),
      ...state,
      map: structuredClone(plan.nextMap),
      response: { requestId: window.windowId, optionId },
      now: 2_000 + responseIndex,
      random: () => { throw new Error('Transporter must not draw randomness.') },
      abilityRuntimeRegistry: TEST_ABILITY_REGISTRY,
    })
    plan = planResumedMoveState({
      pendingResolution: pending,
      declarationPlan: plan.suspension.preWindowPlan,
      responseOpId: `op_aa096_transporter_response_${responseIndex}`,
      responseWindowId: window.windowId,
      responseOptionId: optionId,
      chosenBy: window.ownership[0]!,
      ...state,
      map: plan.nextMap,
      execution,
      plannedAt: 2_000 + responseIndex,
      abilityRuntimeRegistry: TEST_ABILITY_REGISTRY,
    })
    responseIndex += 1
    if (responseIndex > 8) throw new Error('Too many Transporter response windows.')
  }
  return { state, plan, seen }
}

describe('AA-096 Transporter authoritative multi-placement Teleport', () => {
  it('carries exactly the selected adjacent ally by the server-derived actor delta', () => {
    const { plan, seen } = complete({
      transporterOption: 'ability.transporter.carry.ally',
      actorDestination: { x: 5, y: 0, z: 2 },
    })

    expect(seen.find(window => window.reasonCode === AA096_TRANSPORTER_REASON)).toMatchObject({
      reasonCode: AA096_TRANSPORTER_REASON,
      optionIds: expect.arrayContaining([
        'ability.transporter.extended-range',
        'ability.transporter.carry.ally',
        'ability.transporter.both.ally',
      ]),
    })
    expect(seen.find(window => window.reasonCode === AA096_TRANSPORTER_REASON)?.optionIds)
      .not.toContain('ability.transporter.carry.enemy')
    expect(plan.nextMap.placements.find(placement => placement.id === 'actor')?.position)
      .toEqual({ x: 5, y: 0, z: 2 })
    expect(plan.nextMap.placements.find(placement => placement.id === 'ally')?.position)
      .toEqual({ x: 5, y: 0, z: 3 })
    expect(plan.nextMap.placements.find(placement => placement.id === 'enemy')?.position)
      .toEqual({ x: 3, y: 0, z: 2 })
    expect(plan.resolution.movement).toMatchObject({
      from: { x: 2, y: 0, z: 2 },
      destination: { x: 5, y: 0, z: 2 },
    })
    expect(plan.resolution.additionalMovements).toEqual([
      expect.objectContaining({
        placementId: 'ally',
        from: { x: 2, y: 0, z: 3 },
        destination: { x: 5, y: 0, z: 3 },
      }),
    ])
    expect(plan.resolution.resourceMovement).toEqual({ distance: 3, budget: 4 })
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.interrupt.spent).toBe(1)
    const actorWrite = plan.sheetWrites.find(write => write.slug === 'actor')
    expect((actorWrite?.nextSheet as CharacterSheet | undefined)?.abilityUsage?.entries)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ canonicalId: 'Transporter', clauseId: 'base', spent: 1, limit: 3 }),
      ]))
    expect(plan.stateChanges.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'placement-state',
        scope: expect.objectContaining({ placementId: 'ally' }),
        sourceOperationId: expect.stringMatching(/^ability\.transporter\.carry\./),
      }),
    ]))
    expect(plan.resolution.auditTrace.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'operation',
        operationId: expect.stringMatching(/^ability\.transporter\.carry\./),
        outcome: 'applied',
        result: expect.objectContaining({ destination: { x: 5, y: 0, z: 3 } }),
      }),
    ]))
    expect(JSON.parse(JSON.stringify(plan.resolution.additionalMovements)))
      .toEqual(plan.resolution.additionalMovements)
    expect(moveResultFromPlan(plan).additionalMovements).toEqual([
      expect.objectContaining({
        placementId: 'ally',
        destination: { x: 5, y: 0, z: 3 },
      }),
    ])
  }, 30_000)

  it('carries across the actor’s exact Teleporter capability without an old fixed-range ceiling', () => {
    const { plan } = complete({
      transporterOption: 'ability.transporter.carry.ally',
      actorDestination: { x: 11, y: 0, z: 2 },
      teleporter: 10,
    })
    expect(plan.nextMap.placements.find(placement => placement.id === 'actor')?.position)
      .toEqual({ x: 11, y: 0, z: 2 })
    expect(plan.nextMap.placements.find(placement => placement.id === 'ally')?.position)
      .toEqual({ x: 11, y: 0, z: 3 })
    expect(plan.resolution.resourceMovement).toEqual({ distance: 9, budget: 14 })
  }, 30_000)

  it('triples only the actor range without carrying a companion', () => {
    const { plan } = complete({
      transporterOption: 'ability.transporter.extended-range',
      actorDestination: { x: 14, y: 0, z: 2 },
    })

    expect(plan.nextMap.placements.find(placement => placement.id === 'actor')?.position)
      .toEqual({ x: 14, y: 0, z: 2 })
    expect(plan.nextMap.placements.find(placement => placement.id === 'ally')?.position)
      .toEqual({ x: 2, y: 0, z: 3 })
    expect(plan.resolution.additionalMovements).toBeUndefined()
    expect(plan.resolution.resourceMovement).toEqual({ distance: 12, budget: 12 })
    const actorWrite = plan.sheetWrites.find(write => write.slug === 'actor')
    expect((actorWrite?.nextSheet as CharacterSheet | undefined)?.abilityUsage?.entries)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ canonicalId: 'Transporter', spent: 1, limit: 3 }),
      ]))
  }, 30_000)

  it('spends two Daily uses to combine triple range with one exact carried ally', () => {
    const { plan } = complete({
      transporterOption: 'ability.transporter.both.ally',
      actorDestination: { x: 14, y: 0, z: 2 },
    })

    expect(plan.nextMap.placements.find(placement => placement.id === 'actor')?.position)
      .toEqual({ x: 14, y: 0, z: 2 })
    expect(plan.nextMap.placements.find(placement => placement.id === 'ally')?.position)
      .toEqual({ x: 14, y: 0, z: 3 })
    expect(plan.resolution.resourceMovement).toEqual({ distance: 12, budget: 12 })
    expect(plan.resolution.additionalMovements).toHaveLength(1)
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    const actorWrite = plan.sheetWrites.find(write => write.slug === 'actor')
    expect((actorWrite?.nextSheet as CharacterSheet | undefined)?.abilityUsage?.entries)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ canonicalId: 'Transporter', spent: 2, limit: 3 }),
      ]))
  }, 30_000)

  it('keeps ordinary Teleport when the optional Transporter response passes', () => {
    const { plan } = complete({
      transporterOption: null,
      actorDestination: { x: 5, y: 0, z: 2 },
    })

    expect(plan.nextMap.placements.find(placement => placement.id === 'actor')?.position)
      .toEqual({ x: 5, y: 0, z: 2 })
    expect(plan.nextMap.placements.find(placement => placement.id === 'ally')?.position)
      .toEqual({ x: 2, y: 0, z: 3 })
    expect(plan.resolution.additionalMovements).toBeUndefined()
    expect(plan.resolution.resourceMovement).toEqual({ distance: 3, budget: 4 })
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(0)
    expect(plan.sheetWrites.find(write => write.slug === 'actor')?.nextSheet.abilityUsage?.entries
      .some(entry => entry.canonicalId === 'Transporter')).not.toBe(true)
  }, 30_000)

  it.each([
    [{ x: 2, y: 0, z: 3 }, { x: 2, y: 0, z: 4 }],
    [{ x: 2, y: 0, z: 1 }, { x: 2, y: 0, z: 2 }],
  ] as const)(
    'commits atomically when a final endpoint uses a simultaneously vacated source %#',
    (actorDestination, allyDestination) => {
      const { plan } = complete({
        transporterOption: 'ability.transporter.carry.ally',
        actorDestination,
      })
      expect(plan.nextMap.placements.find(placement => placement.id === 'actor')?.position)
        .toEqual(actorDestination)
      expect(plan.nextMap.placements.find(placement => placement.id === 'ally')?.position)
        .toEqual(allyDestination)
    },
    30_000,
  )

  it('fails closed when the translated companion endpoint is occupied or out of bounds', () => {
    expect(() => complete({
      transporterOption: 'ability.transporter.carry.ally',
      // Ally would land on the authoritative enemy at 3,0,2.
      actorDestination: { x: 3, y: 0, z: 1 },
    })).toThrowError(/has no legal authoritative option/)
    expect(() => complete({
      transporterOption: 'ability.transporter.carry.ally',
      // Actor remains in bounds at z=5; translated ally would land at z=6.
      actorDestination: { x: 2, y: 0, z: 5 },
    })).toThrowError(/has no legal authoritative option/)
  }, 30_000)
})
