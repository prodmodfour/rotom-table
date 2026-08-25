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
import {
  buildSpiteFollowUpEffectOperations,
  SPITE_FOLLOW_UP_RESPONSE_SPEC,
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

const retiredCuteCharmWindow = (): PendingMoveReactionResponseWindow => ({
  windowId: 'ability-follow-up.cute-charm.historical',
  operationId: 'ability-follow-up.cute-charm.historical.request',
  kind: 'reaction',
  phase: 'cleanup',
  reasonCode: 'ability.cute-charm.follow-up',
  promptKey: 'ability.cute-charm.infatuate-attacker',
  ownership: [{ kind: 'placement', id: 'target-token' }],
  options: [{ id: 'ability.cute-charm.apply', labelKey: 'ability.cute-charm.apply-infatuation' }],
  allowPass: true,
  timing: 'cleanup',
  priority: 300,
  depth: 0,
})

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

describe('durable post-Move follow-ups after Ability retirement', () => {
  it('materializes only the reviewed Spite Move window with correct ownership', () => {
    const { pending } = materializedFollowUps()

    expect(pending.continuationKind).toBe('ability-follow-ups')
    expect(pending).toHaveProperty('attackSourceId', null)
    expect(pending.outstandingWindows.map(window => window.reasonCode)).toEqual([
      'move.spite.follow-up',
    ])
    expect(pending.outstandingWindows.map(window => window.ownership)).toEqual([
      [{ kind: 'placement', id: 'target-token' }],
    ])
    expect(pending.outstandingWindows.every(window => (
      window.kind === 'reaction'
      && window.timing === 'cleanup'
      && window.allowPass
    ))).toBe(true)
    expect(activePendingMoveResponseWindows(pending).map(window => window.reasonCode)).toEqual([
      'move.spite.follow-up',
    ])
    expect(pending.trace.program.runtimeKind).toBe('ability-follow-ups')
  })

  it('preserves exact root attack provenance in a follow-up record', () => {
    const { map, documents, resolution } = materializedFollowUps()
    const attackSourceId = `attack-source.v1.${'a'.repeat(64)}` as const
    const pending = materializeAbilityFollowUps({
      resolutionId: 'resolution-ability-follow-up-source',
      originOpId: 'op_abilityfollow_source',
      originMapSlug: map.slug,
      continuationMapRevision: 5,
      createdAt: 1_000,
      resolution: { ...resolution, attackSourceId },
      map,
      ...documents,
      sheetWrites: [],
    })
    expect(pending).toHaveProperty('attackSourceId', attackSourceId)
  })

  it('authors only typed Spite operations', () => {
    const { pending } = materializedFollowUps()
    expect(buildSpiteFollowUpEffectOperations({
      window: pending.outstandingWindows[0]!,
      optionId: SPITE_FOLLOW_UP_RESPONSE_SPEC.optionId,
      canonicalMoveId: 'Tackle',
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'condition',
        payload: expect.objectContaining({ conditionId: 'disabled', conditionDetail: 'Tackle' }),
      }),
    ]))
    expect(() => buildSpiteFollowUpEffectOperations({
      window: retiredCuteCharmWindow(),
      optionId: 'ability.cute-charm.apply',
      canonicalMoveId: 'Tackle',
    })).toThrow('no reviewed Spite definition')
  })

  it('rejects a persisted historical Ability window without planning a write', () => {
    const { map, documents, pending } = materializedFollowUps()
    const durableMap: TabletopMap = {
      ...map,
      revision: 5,
      encounterState: {
        ...createEmptyEncounterState(),
        pendingResolutionSummaries: [pending.publicSummary],
      },
    }
    const window = retiredCuteCharmWindow()
    const historical = {
      ...pending,
      outstandingWindows: [window],
      publicSummary: { ...pending.publicSummary, outstandingWindowCount: 1 },
    }
    expect(() => planAbilityFollowUpResponse({
      pendingResolution: historical,
      responseOpId: 'op_retired_ability_answer',
      responseWindowId: window.windowId,
      responseOptionId: window.options[0]!.id,
      chosenBy: { kind: 'gm', id: null },
      map: durableMap,
      ...documents,
      plannedAt: 2_000,
    })).toThrow('Legacy Ability follow-up execution is retired')
    expect(durableMap.revision).toBe(5)
    expect(documents.pokemonSheets.get('actor')?.revision).toBe(2)
  })

  it('does not misindex an accepted Ability follow-up as a primary Move result', () => {
    const { map, documents, pending } = materializedFollowUps()
    const window = pending.outstandingWindows[0]!
    const durableMap: TabletopMap = {
      ...map,
      revision: 5,
      encounterState: {
        ...createEmptyEncounterState(),
        pendingResolutionSummaries: [pending.publicSummary],
      },
    }

    const plan = planAbilityFollowUpResponse({
      pendingResolution: pending,
      responseOpId: 'op_abilityapply01',
      responseWindowId: window.windowId,
      responseOptionId: SPITE_FOLLOW_UP_RESPONSE_SPEC.optionId,
      chosenBy: { kind: 'gm', id: null },
      map: durableMap,
      ...documents,
      plannedAt: 2_000,
    })

    expect(plan.nextMap.encounterState?.history.moveCompletions ?? []).toEqual([])
    expect(plan.nextMap.encounterState?.history.moveUses ?? []).toEqual([])
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
