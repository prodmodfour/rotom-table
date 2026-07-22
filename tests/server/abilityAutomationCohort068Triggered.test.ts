import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveStateExecution,
} from '../../server/domain/planAuthoritativeMoveState'
import { isAuthoritativePendingMoveResolution } from '../../server/domain/resolveAuthoritativeMove'
import { resumeMoveSpec } from '../../server/domain/moveAutomation/resumeSpec'
import { planResumedMoveState } from '../../server/domain/moveAutomation/planResumedMoveState'

const abilitySlug = (canonicalId: string): string => canonicalId
  .normalize('NFKD').replace(/[’']/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const,
    instanceId: `base:${abilitySlug(canonicalId)}`,
    canonicalId, definitionVersion: null, selections: [],
  },
})
const sheet = (input: {
  slug: string
  move?: string
  ability?: string
  abilities?: readonly string[]
  types?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 20, revision: 3,
  types: [...(input.types ?? ['Normal'])],
  abilities: (input.abilities ?? (input.ability ? [input.ability] : [])).map(ability),
  movelist: input.move ? [{ name: input.move }] : [],
  stats: {
    hp: { added: 45 }, atk: { added: 25 }, def: { added: 25 },
    satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 150, injuries: 0, conditions: [] },
})
const battleMap = (slug: string): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
  ]
  return {
    schemaVersion: 2, slug, name: slug, revision: 5,
    dimensions: { x: 10, y: 4, z: 8 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] }, placements,
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history, sceneId: `scene:${slug}`, currentRound: 1,
        currentTurn: { round: 1, turn: 1, placementId: 'actor' },
      },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id, createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}

interface DeclarationInput {
  readonly slug: string
  readonly move: string
  readonly actorAbility?: string
  readonly targetAbility?: string
  readonly targetAbilities?: readonly string[]
  readonly actorTypes?: readonly string[]
  readonly targetTypes?: readonly string[]
  readonly alliedTarget?: boolean
  readonly random?: () => number
}
const planDeclaration = (input: DeclarationInput) => {
  const pokemonSheets = new Map<string, CharacterSheet>([
    ['actor', sheet({ slug: 'actor', move: input.move, ability: input.actorAbility, types: input.actorTypes })],
    ['target', sheet({
      slug: 'target', ability: input.targetAbility, abilities: input.targetAbilities,
      types: input.targetTypes,
    })],
  ])
  const map = battleMap(input.slug)
  if (input.alliedTarget) map.placements[1]!.sideId = 'heroes'
  const result = planAuthoritativeMoveStateExecution({
    map, pokemonSheets, trainerSheets: new Map(),
    intent: {
      schemaVersion: 1, placementId: 'actor', moveName: input.move,
      selection: { kind: 'single-target', targetPlacementId: 'target' },
    },
    random: input.random ?? (() => 0.5), now: () => 1_000,
    operationId: `op_${input.slug}`, pendingResolutionId: `resolution:${input.slug}`,
  })
  return { result, pokemonSheets }
}
const declaration = (input: DeclarationInput) => {
  const planned = planDeclaration(input)
  if (!isAuthoritativePendingMoveStatePlan(planned.result)) {
    throw new Error(`Expected ${input.actorAbility ?? input.targetAbility} response window.`)
  }
  return { declaration: planned.result, pokemonSheets: planned.pokemonSheets }
}
const respond = (input: {
  declared: ReturnType<typeof declaration>
  optionId: string | null
  ownerId: 'actor' | 'target'
  random?: () => number
}) => {
  const pending = input.declared.declaration.suspension.pendingResolution
  const window = pending.outstandingWindows[0]!
  const execution = resumeMoveSpec({
    pendingResolution: structuredClone(pending),
    map: structuredClone(input.declared.declaration.nextMap),
    pokemonSheets: input.declared.pokemonSheets, trainerSheets: new Map(),
    response: { requestId: window.windowId, optionId: input.optionId },
    now: 2_000, random: input.random ?? (() => 0.5),
  })
  if (isAuthoritativePendingMoveResolution(execution)) throw new Error('Expected one-window completion.')
  const plan = planResumedMoveState({
    pendingResolution: pending,
    declarationPlan: input.declared.declaration.suspension.preWindowPlan,
    responseOpId: `op_response_${pending.canonicalMoveId.toLowerCase().replaceAll(' ', '_')}`,
    responseWindowId: window.windowId,
    responseOptionId: input.optionId,
    chosenBy: { kind: 'placement', id: input.ownerId },
    map: input.declared.declaration.nextMap,
    pokemonSheets: input.declared.pokemonSheets, trainerSheets: new Map(),
    execution, plannedAt: 2_000,
  })
  return { plan, execution, window }
}
const writtenSheet = (
  result: ReturnType<typeof respond>,
  slug: string,
): CharacterSheet => result.plan.sheetWrites.find(write => write.slug === slug)?.nextSheet as CharacterSheet

describe('AA-068 triggered abilities', () => {
  it('aa068.dragons-maw.reviewed selects exactly one hit target and applies the final vulnerability step', () => {
    const declared = declaration({
      slug: 'aa068-dragons-maw', move: 'Dragon Claw', actorAbility: 'Dragon’s Maw',
    })
    expect(declared.declaration.suspension.pendingResolution.outstandingWindows[0]?.ownership)
      .toEqual([{ kind: 'actor', id: null }])
    const selected = respond({
      declared, optionId: 'ability.dragons-maw.use', ownerId: 'actor',
    })
    const damageEvent = selected.execution.nativeV2?.trace.events.find(event => (
      event.kind === 'operation' && event.operationKind === 'damage'
    )) as { result?: { recipients?: Array<{ details?: { calculation?: { moveType?: unknown } } }> } } | undefined
    expect(damageEvent?.result?.recipients?.[0]?.details?.calculation?.moveType).toMatchObject({
      recipientId: 'target', finalMultiplier: 1.5,
      passiveSources: expect.arrayContaining(['Dragon’s Maw']),
    })
    expect(selected.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Dragon’s Maw', limit: 2, spent: 1,
    }))
    expect(selected.plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)

    const immune = respond({
      declared: declaration({
        slug: 'aa068-dragons-maw-immune', move: 'Dragon Claw',
        actorAbility: 'Dragon’s Maw', targetTypes: ['Fairy'],
      }),
      optionId: 'ability.dragons-maw.use', ownerId: 'actor',
    })
    const immuneDamage = immune.execution.nativeV2?.trace.events.find(event => (
      event.kind === 'operation' && event.operationKind === 'damage'
    )) as { result?: { recipients?: Array<{ details?: { calculation?: { moveType?: { finalMultiplier?: number } } } }> } } | undefined
    expect(immuneDamage?.result?.recipients?.[0]?.details?.calculation?.moveType?.finalMultiplier).toBe(0.5)

    const passed = respond({
      declared: declaration({
        slug: 'aa068-dragons-maw-pass', move: 'Dragon Claw', actorAbility: 'Dragon’s Maw',
      }),
      optionId: null, ownerId: 'actor',
    })
    expect(passed.plan.nextMap.encounterState?.abilityUsage?.entries ?? []).toHaveLength(0)
  }, 30_000)

  it('aa068.dream-smoke.reviewed puts the Melee attacker to Sleep and supports a no-spend pass', () => {
    const declared = declaration({
      slug: 'aa068-dream-smoke', move: 'Tackle', targetAbility: 'Dream Smoke',
    })
    const selected = respond({
      declared, optionId: 'ability.dream-smoke.use', ownerId: 'target',
    })
    expect(writtenSheet(selected, 'actor').combat?.conditions).toContain('Sleep')
    expect(selected.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Dream Smoke', spent: 1,
    }))

    const combined = declaration({
      slug: 'aa068-dream-smoke-effect-spore', move: 'Tackle',
      targetAbilities: ['Dream Smoke', 'Effect Spore'],
    })
    expect(combined.declaration.suspension.pendingResolution.outstandingWindows[0]?.options)
      .toEqual([{ id: 'ability.dream-smoke.use', labelKey: 'ability.dream-smoke.put-attacker-to-sleep' }])
    const oneFreeAction = respond({
      declared: combined, optionId: 'ability.dream-smoke.use', ownerId: 'target',
    })
    expect(writtenSheet(oneFreeAction, 'actor').combat?.conditions).toContain('Sleep')
    expect(oneFreeAction.plan.nextMap.encounterState?.abilityUsage?.entries)
      .toHaveLength(1)

    const combinedPass = declaration({
      slug: 'aa068-dream-smoke-effect-spore-pass', move: 'Tackle',
      targetAbilities: ['Dream Smoke', 'Effect Spore'],
    })
    const combinedPending = combinedPass.declaration.suspension.pendingResolution
    const nextWindow = resumeMoveSpec({
      pendingResolution: structuredClone(combinedPending),
      map: structuredClone(combinedPass.declaration.nextMap),
      pokemonSheets: combinedPass.pokemonSheets, trainerSheets: new Map(),
      response: {
        requestId: combinedPending.outstandingWindows[0]!.windowId,
        optionId: null,
      },
      now: 2_000, random: () => 0.5,
    })
    expect(isAuthoritativePendingMoveResolution(nextWindow)).toBe(true)
    if (isAuthoritativePendingMoveResolution(nextWindow)) {
      expect(nextWindow.execution.request.options)
        .toEqual([{ id: 'ability.effect-spore.use', labelKey: 'ability.effect-spore.roll-condition' }])
    }

    const passed = respond({
      declared: declaration({
        slug: 'aa068-dream-smoke-pass', move: 'Tackle', targetAbility: 'Dream Smoke',
      }),
      optionId: null, ownerId: 'target',
    })
    expect(writtenSheet(passed, 'actor')?.combat?.conditions ?? []).not.toContain('Sleep')
    expect(passed.plan.nextMap.encounterState?.abilityUsage?.entries ?? []).toHaveLength(0)
    expect(isAuthoritativePendingMoveStatePlan(planDeclaration({
      slug: 'aa068-dream-smoke-ally', move: 'Tackle',
      targetAbility: 'Dream Smoke', alliedTarget: true,
    }).result)).toBe(true)
    expect(isAuthoritativePendingMoveStatePlan(planDeclaration({
      slug: 'aa068-dream-smoke-ranged', move: 'Water Gun', targetAbility: 'Dream Smoke',
    }).result)).toBe(false)
    expect(isAuthoritativePendingMoveStatePlan(planDeclaration({
      slug: 'aa068-dream-smoke-miss', move: 'Tackle', targetAbility: 'Dream Smoke',
      random: () => 0,
    }).result)).toBe(false)
  }, 30_000)

  it('aa068.drown-out.reviewed cancels any foe Sonic Move before RNG while retaining its usage', () => {
    const declared = declaration({
      slug: 'aa068-drown-out', move: 'Supersonic', targetAbility: 'Drown Out',
    })
    expect(declared.declaration.suspension.pendingResolution.outstandingWindows[0])
      .toMatchObject({ timing: 'declare', options: [{ id: 'ability.drown-out.use' }] })
    const selected = respond({
      declared, optionId: 'ability.drown-out.use', ownerId: 'target',
      random: () => { throw new Error('cancelled Sonic Move must not roll') },
    })
    expect(selected.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Drown Out', limit: 2, spent: 1,
    }))
    expect(selected.plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
    expect(selected.plan.nextMap.encounterState?.turnResources.actor?.actions.standard.spent).toBe(1)
    expect(selected.plan.sheetWrites).toHaveLength(0)
  }, 30_000)

  it('aa068.effect-spore.reviewed rolls its private d6 once and applies the reviewed condition band', () => {
    const declared = declaration({
      slug: 'aa068-effect-spore', move: 'Tackle', targetAbility: 'Effect Spore',
    })
    const selected = respond({
      declared, optionId: 'ability.effect-spore.use', ownerId: 'target', random: () => 0.99,
    })
    expect(writtenSheet(selected, 'actor').combat?.conditions).toContain('Sleep')
    expect(selected.execution.rollLedger).toContainEqual(expect.objectContaining({
      formula: { kind: 'dice', count: 1, sides: 6, modifier: 0 },
      naturalResult: 6,
    }))
    expect(selected.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Effect Spore', spent: 1,
    }))

    for (const [slug, randomValue, expected] of [
      ['poison', 0, 'Poisoned'],
      ['paralysis', 0.4, 'Paralysis'],
    ] as const) {
      const band = respond({
        declared: declaration({
          slug: `aa068-effect-spore-${slug}`, move: 'Tackle', targetAbility: 'Effect Spore',
        }),
        optionId: 'ability.effect-spore.use', ownerId: 'target', random: () => randomValue,
      })
      expect(writtenSheet(band, 'actor').combat?.conditions).toContain(expected)
    }

    const independent = respond({
      declared: declaration({
        slug: 'aa068-effect-spore-independent', move: 'Bone Club',
        targetAbility: 'Effect Spore', actorTypes: ['Flying'],
      }),
      optionId: 'ability.effect-spore.use', ownerId: 'target', random: () => 0,
    })
    expect(writtenSheet(independent, 'actor').combat?.conditions).toContain('Poisoned')

    const passed = respond({
      declared: declaration({
        slug: 'aa068-effect-spore-pass', move: 'Tackle', targetAbility: 'Effect Spore',
      }),
      optionId: null, ownerId: 'target', random: () => 0.5,
    })
    expect(passed.execution.rollLedger.some(entry => entry.rollId.includes('effect-spore'))).toBe(false)
    expect(passed.plan.nextMap.encounterState?.abilityUsage?.entries ?? []).toHaveLength(0)
  }, 30_000)
})
