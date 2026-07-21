import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import {
  activePendingMoveResponseWindows,
  type PendingMoveReactionResponseWindow,
} from '#shared/moveAutomation/pendingResolution'
import { resolveAuthoritativeMove } from '~~/server/domain/resolveAuthoritativeMove'
import {
  materializeAbilityFollowUps,
  planAbilityFollowUpResponse,
} from '~~/server/domain/moveAutomation/abilityFollowUps'
import { buildAuthoritativeMoveRulesContext } from '~~/server/domain/moveAutomation/context'
import {
  abilityFollowUpSpecForKind,
  buildAbilityFollowUpEffectOperations,
} from '~~/server/domain/moveAutomation/abilityFollowUpSpecs'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'

const placement = (
  id: string,
  sheetSlug: string,
  x: number,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 0 },
})

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'ability-follow-up-arena',
  name: 'Ability Follow-up Arena',
  folder: '',
  revision: 4,
  dimensions: { x: 8, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    placement('actor-token', 'actor', 0),
    placement('target-token', 'target', 1),
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  activeScene: { name: 'Scene A', startedAt: 100 },
  encounterState: createEmptyEncounterState(),
  metadata: {},
  createdAt: 1,
  updatedAt: 100,
})

const sheet = (input: {
  readonly slug: string
  readonly species: string
  readonly nickname: string
  readonly gender: 'Male' | 'Female'
  readonly hp: number
  readonly moves: readonly string[]
  readonly abilities: readonly string[]
}): CharacterSheet => ({
  slug: input.slug,
  species: input.species,
  nickname: input.nickname,
  gender: input.gender,
  level: 20,
  movelist: input.moves.map(name => ({ name })),
  abilities: input.abilities.map(name => ({ name })),
  combat: { currentHp: input.hp },
  revision: 2,
})

const sheets = (actorAbilities: readonly string[] = ['Celebrate']) => ({
  pokemonSheets: new Map<string, CharacterSheet>([
    ['actor', sheet({
      slug: 'actor',
      species: 'Pikachu',
      nickname: 'Attacker',
      gender: 'Male',
      hp: 60,
      moves: ['Tackle'],
      abilities: actorAbilities,
    })],
    ['target', sheet({
      slug: 'target',
      species: 'Snorlax',
      nickname: 'Defender',
      gender: 'Female',
      hp: 100,
      moves: ['Spite'],
      abilities: ['Cute Charm', 'Poison Point'],
    })],
  ]),
  trainerSheets: new Map(),
})

const reviewedLegacyWindow = (
  kind: 'celebrate' | 'cute-charm' | 'poison-point' | 'spite',
  ownership: readonly ({ readonly kind: 'actor'; readonly id: null } | { readonly kind: 'placement'; readonly id: string })[],
): PendingMoveReactionResponseWindow => {
  const spec = abilityFollowUpSpecForKind(kind)
  return {
    windowId: `ability-follow-up.${kind}.legacy-test`,
    operationId: `ability-follow-up.${kind}.legacy-test.request`,
    kind: 'reaction' as const,
    phase: 'cleanup' as const,
    reasonCode: spec.reasonCode,
    promptKey: spec.promptKey,
    ownership,
    options: [{ id: spec.optionId, labelKey: spec.optionLabelKey }],
    allowPass: true,
    timing: 'cleanup' as const,
    priority: spec.priority,
    depth: 0,
  }
}

const materializedFollowUps = () => {
  const map = mapFixture()
  const documents = sheets()
  const resolution = resolveAuthoritativeMove({
    map,
    ...documents,
    intent: {
      schemaVersion: 1,
      placementId: 'actor-token',
      moveName: 'Tackle',
      selection: { kind: 'single-target', targetPlacementId: 'target-token' },
    },
    random: () => 0.95,
    now: () => 1_000,
  })
  const pending = materializeAbilityFollowUps({
    resolutionId: 'resolution-ability-follow-up-1',
    originOpId: 'op_abilityfollow01',
    originMapSlug: map.slug,
    continuationMapRevision: 5,
    createdAt: 1_000,
    resolution,
    map,
    ...documents,
    sheetWrites: [],
  })
  if (!pending) throw new Error('Expected ability follow-ups.')
  return { map, documents, resolution, pending }
}

describe('durable ability follow-ups', () => {
  it('materializes reviewed server windows in deterministic priority order with correct ownership', () => {
    const { pending } = materializedFollowUps()

    expect(pending.continuationKind).toBe('ability-follow-ups')
    expect(pending.outstandingWindows.map(window => window.reasonCode)).toEqual([
      'ability.poison-point.follow-up',
      'move.spite.follow-up',
    ])
    expect(pending.outstandingWindows.map(window => window.ownership)).toEqual([
      [{ kind: 'placement', id: 'target-token' }],
      [{ kind: 'placement', id: 'target-token' }],
    ])
    expect(pending.outstandingWindows.every(window => (
      window.kind === 'reaction'
      && window.timing === 'cleanup'
      && window.allowPass
    ))).toBe(true)
    expect(activePendingMoveResponseWindows(pending).map(window => window.reasonCode)).toEqual([
      'ability.poison-point.follow-up',
    ])
    expect(pending.trace.program.runtimeKind).toBe('ability-follow-ups')
  })

  it('authors typed operations for every reviewed legacy follow-up', () => {
    const { map, documents, pending } = materializedFollowUps()
    const context = buildAuthoritativeMoveRulesContext({
      map,
      ...documents,
      intent: {
        schemaVersion: 1,
        placementId: 'actor-token',
        moveName: 'Tackle',
        selection: { kind: 'self' },
      },
      selectedPlacementIds: [],
      random: () => 0,
      time: 2_000,
    })
    const byReason = new Map(pending.outstandingWindows.map(window => [window.reasonCode, window]))
    const operationKinds = (kind: 'celebrate' | 'cute-charm' | 'poison-point' | 'spite') => {
      const spec = abilityFollowUpSpecForKind(kind)
      return buildAbilityFollowUpEffectOperations({
        window: byReason.get(spec.reasonCode) ?? reviewedLegacyWindow(
          kind,
          kind === 'celebrate'
            ? [{ kind: 'actor', id: null }]
            : [{ kind: 'placement', id: 'target-token' }],
        ),
        optionId: spec.optionId,
        canonicalMoveId: 'Tackle',
        context,
      })
    }

    expect(operationKinds('celebrate').map(operation => operation.kind)).toEqual(['log'])
    expect(operationKinds('cute-charm')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'condition',
        payload: expect.objectContaining({ conditionId: 'infatuation', conditionDetail: 'Defender' }),
      }),
    ]))
    expect(operationKinds('poison-point')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'condition',
        payload: expect.objectContaining({ conditionId: 'poisoned' }),
      }),
    ]))
    expect(operationKinds('spite')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'condition',
        payload: expect.objectContaining({ conditionId: 'disabled', conditionDetail: 'Tackle' }),
      }),
    ]))

    const moxie = abilityFollowUpSpecForKind('moxie')
    expect(buildAbilityFollowUpEffectOperations({
      window: {
        windowId: 'ability-follow-up.moxie.1',
        operationId: 'ability-follow-up.moxie.1.request',
        kind: 'reaction',
        phase: 'cleanup',
        reasonCode: moxie.reasonCode,
        promptKey: moxie.promptKey,
        ownership: [{ kind: 'actor', id: null }],
        options: [{ id: moxie.optionId, labelKey: moxie.optionLabelKey }],
        allowPass: true,
        timing: 'cleanup',
        priority: moxie.priority,
        depth: 0,
      },
      optionId: moxie.optionId,
      canonicalMoveId: 'Tackle',
      context,
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'combat-stage',
        payload: expect.objectContaining({ action: 'modify', stage: 'atk', value: 1 }),
      }),
    ]))
  })

  it('plans a selected Cute Charm option as a typed detailed condition', () => {
    const { map, documents, pending } = materializedFollowUps()
    const durableMap: TabletopMap = {
      ...map,
      revision: 5,
      encounterState: {
        ...createEmptyEncounterState(),
        pendingResolutionSummaries: [pending.publicSummary],
      },
    }
    const window = reviewedLegacyWindow('cute-charm', [{ kind: 'placement', id: 'target-token' }])
    const priorityBlocked = {
      ...pending,
      outstandingWindows: [
        reviewedLegacyWindow('celebrate', [{ kind: 'actor', id: null }]),
        window,
      ],
      publicSummary: {
        ...pending.publicSummary,
        outstandingWindowCount: 2,
      },
    }
    expect(() => planAbilityFollowUpResponse({
      pendingResolution: priorityBlocked,
      responseOpId: 'op_outoforder001',
      responseWindowId: window.windowId,
      responseOptionId: window.options[0]!.id,
      chosenBy: { kind: 'gm', id: null },
      map: durableMap,
      ...documents,
      plannedAt: 2_000,
    })).toThrow('current reviewed priority')

    const cuteCharmOnly = {
      ...pending,
      outstandingWindows: [window],
      publicSummary: {
        ...pending.publicSummary,
        outstandingWindowCount: 1,
      },
    }

    const plan = planAbilityFollowUpResponse({
      pendingResolution: cuteCharmOnly,
      responseOpId: 'op_abilityanswer01',
      responseWindowId: window.windowId,
      responseOptionId: window.options[0]!.id,
      chosenBy: { kind: 'gm', id: null },
      map: durableMap,
      ...documents,
      plannedAt: 2_000,
    })

    expect(plan.revision).toBe(6)
    expect(plan.sheetWrites).toHaveLength(1)
    expect(plan.sheetWrites[0]).toMatchObject({
      kind: 'pokemon',
      slug: 'actor',
      expectedRevision: 2,
      revision: 3,
      changedFields: ['conditions'],
      nextSheet: {
        combat: { conditions: ['Infatuation: Defender'] },
      },
    })
    expect(plan.pendingResolution.status).toBe('committed')
    expect(plan.pendingResolution.outstandingWindows).toHaveLength(0)
    expect(plan.pendingResolution.chosenOptions).toEqual([
      expect.objectContaining({
        windowId: window.windowId,
        optionId: window.options[0]!.id,
        responseOpId: 'op_abilityanswer01',
      }),
    ])
    expect(plan.nextMap.encounterState?.pendingResolutionSummaries).toEqual([])
  })

  it('records pass without applying an effect and closes the final durable window', () => {
    const { map, documents, pending } = materializedFollowUps()
    const finalWindow = pending.outstandingWindows.at(-1)!
    const finalOnly = {
      ...pending,
      outstandingWindows: [finalWindow],
      publicSummary: {
        ...pending.publicSummary,
        outstandingWindowCount: 1,
      },
    }
    const durableMap: TabletopMap = {
      ...map,
      revision: 5,
      encounterState: {
        ...createEmptyEncounterState(),
        pendingResolutionSummaries: [pending.publicSummary],
      },
    }

    const plan = planAbilityFollowUpResponse({
      pendingResolution: finalOnly,
      responseOpId: 'op_abilitypass001',
      responseWindowId: finalWindow.windowId,
      responseOptionId: null,
      chosenBy: { kind: 'gm', id: null },
      map: durableMap,
      ...documents,
      plannedAt: 2_000,
    })

    expect(plan.sheetWrites).toEqual([])
    expect(plan.pendingResolution.status).toBe('committed')
    expect(plan.pendingResolution.outstandingWindows).toEqual([])
    expect(plan.nextMap.encounterState?.pendingResolutionSummaries).toEqual([])
    expect(plan.trace.events).toContainEqual(expect.objectContaining({
      kind: 'choice',
      requestId: finalWindow.windowId,
      outcome: 'passed',
    }))
  })
})
