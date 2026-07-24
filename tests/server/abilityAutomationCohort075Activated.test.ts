import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { parseMoveEffectOperation } from '#shared/moveAutomation/effects'
import { AA075_ICE_FACE_FORM_MARKER_CAPABILITY } from '#shared/abilityAutomation/aa075'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { planEncounterLifecycle } from '../../server/domain/moveAutomation/planInitiativeLifecycle'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { reconcileAa075IceFaceTemporaryHpOwnershipAfterMove } from '../../server/domain/abilityAutomation/mechanics/aa075TemporaryHpIntegration'
import { projectEncounterIllusionAppearances } from '~/utils/encounterIllusions'

const id = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const,
    instanceId: `base:${id(canonicalId)}`,
    canonicalId,
    definitionVersion: null,
    selections: [],
  },
})
const sheet = (input: {
  slug: string
  ability?: string
  currentHp?: number
  focus?: string
  species?: string
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: input.species ?? 'Eevee',
  level: 20,
  revision: 3,
  types: ['Normal'],
  abilities: input.ability ? [ability(input.ability)] : [],
  movelist: [{ name: 'Tackle' }],
  skills: { focus: input.focus ?? 'Adept' },
  stats: {
    hp: { added: 45 }, atk: { added: input.slug === 'target' ? 55 : 25 }, def: { added: 25 },
    satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.currentHp ?? 150, injuries: 0, conditions: [] },
})

const battleMap = (input: {
  slug: string
  hail?: boolean
  activeId?: string
  temporaryHp?: number
}): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 2, y: 0, z: 2 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 5, y: 0, z: 2 } },
  ]
  return {
    schemaVersion: 2,
    slug: input.slug,
    name: input.slug,
    revision: 5,
    dimensions: { x: 12, y: 4, z: 12 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [{ x: 7, y: 0, z: 2, materialId: 'cave_stone', tags: ['object'] }],
    hazards: [],
    fieldEffects: {
      weather: input.hail ? [{ kind: 'hail', rounds: 2 }] : [],
      terrains: [], rooms: [],
    },
    placements,
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history,
        sceneId: `scene:${input.slug}`,
        currentRound: 1,
        currentTurn: { round: 1, turn: 1, placementId: input.activeId ?? 'actor' },
      },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 }),
      ])),
    },
    initiative: { activeId: input.activeId ?? 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 },
    ...(input.temporaryHp === undefined ? {} : {
      temporaryHitPoints: {
        scene: { name: 'Scene', startedAt: 100 },
        byPlacementId: { actor: input.temporaryHp },
      },
    }),
  }
}

let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))

const setup = (input: {
  slug: string
  ability: string
  hail?: boolean
  activeId?: string
  currentHp?: number
  temporaryHp?: number
  focus?: string
}) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  mapRepository.saveSetupMap(battleMap(input))
  sheetRepository.saveSetupSheet('pokemon', 'actor', sheet({
    slug: 'actor', ability: input.ability, currentHp: input.currentHp, focus: input.focus,
  }) as unknown as Record<string, unknown>)
  sheetRepository.saveSetupSheet('pokemon', 'target', sheet({
    slug: 'target', species: 'Pikachu', focus: 'Novice',
  }) as unknown as Record<string, unknown>)
  return { mapRepository, sheetRepository, now: () => 1_000 }
}

const begin = (
  dependencies: ReturnType<typeof setup>,
  slug: string,
  canonicalId: string,
  modeId: string,
  requestSuffix = modeId,
) => beginAbilityDeclarationUseCase({ role: 'gm', command: {
  schemaVersion: 1,
  requestId: `request:${slug}:${requestSuffix}`,
  mapSlug: slug,
  baseRevision: dependencies.mapRepository.getBySlug(slug)!.revision,
  actorPlacementId: 'actor',
  abilityInstanceId: `base:${id(canonicalId)}`,
  canonicalId,
  modeId,
} }, dependencies)

const resolveOffer = (input: {
  dependencies: ReturnType<typeof setup>
  slug: string
  canonicalId: string
  modeId: string
  requestSuffix?: string
  select: (declaration: ReturnType<typeof begin>['declarations'][number]) => readonly string[]
}) => {
  const offer = begin(
    input.dependencies, input.slug, input.canonicalId, input.modeId,
    input.requestSuffix ?? input.modeId,
  )
  return resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
    schemaVersion: 1,
    intentId: `intent:${input.slug}:${input.requestSuffix ?? input.modeId}`,
    offerId: offer.offerId,
    offerSha256: offer.offerSha256,
    mapSlug: input.slug,
    baseRevision: offer.mapRevision,
    actorPlacementId: 'actor',
    abilityInstanceId: `base:${id(input.canonicalId)}`,
    canonicalId: input.canonicalId,
    modeId: input.modeId,
    selections: offer.declarations.map(declaration => ({
      declarationId: declaration.declarationId,
      kind: declaration.kind,
      optionIds: [...input.select(declaration)],
    })),
  } }, input.dependencies)
}

const savedSheet = (dependencies: ReturnType<typeof setup>, slug = 'actor'): CharacterSheet => (
  dependencies.sheetRepository.getByRef('pokemon', slug)!.sheet as unknown as CharacterSheet
)

describe('AA-075 activated integrations', () => {
  it('aa075.ice-body.reviewed heals one Tick and atomically pays Swift plus Daily x5', () => {
    const dependencies = setup({
      slug: 'aa075-ice-body', ability: 'Ice Body', currentHp: 40,
    })
    resolveOffer({
      dependencies, slug: 'aa075-ice-body', canonicalId: 'Ice Body', modeId: 'activate',
      select: () => [],
    })
    const actor = savedSheet(dependencies)
    const map = dependencies.mapRepository.getBySlug('aa075-ice-body')!
    expect(actor.combat?.currentHp).toBeGreaterThan(40)
    expect(actor.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Ice Body', spent: 1, limit: 5,
    }))
    expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
  })

  it('aa075.ice-face.reviewed seeds feature-owned Temporary HP at battle start and rejects unrelated pools as form evidence', () => {
    const dependencies = setup({
      slug: 'aa075-ice-face-start', ability: 'Ice Face', hail: true,
    })
    const before = dependencies.mapRepository.getBySlug('aa075-ice-face-start')!
    const actor = savedSheet(dependencies)
    const target = savedSheet(dependencies, 'target')
    const lifecycle = planEncounterLifecycle({
      map: before,
      events: [{
        schemaVersion: 2,
        eventId: 'event:aa075:round-start',
        kind: 'round-start',
        round: 1,
        sourceOperationId: 'op.aa075.round-start',
        causalParentEventId: null,
        reasonCode: 'test.aa075.round-start',
      }],
      time: 1_000,
      random: () => 0.5,
      loadSheets: () => ({
        pokemonSheets: new Map([['actor', actor], ['target', target]]),
        trainerSheets: new Map(),
      }),
    })
    expect(lifecycle.nextMap.temporaryHitPoints?.byPlacementId.actor).toBeGreaterThan(0)
    expect(lifecycle.nextMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'capability',
      payload: { capabilityId: AA075_ICE_FACE_FORM_MARKER_CAPABILITY, action: 'grant' },
    }))
    const ownedContext = buildAuthoritativeMoveRulesContext({
      map: lifecycle.nextMap,
      pokemonSheets: new Map([['actor', actor], ['target', target]]),
      trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Tackle',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.5,
      time: 1_100,
    })
    expect(ownedContext.actor.token.creatureRules?.formId).toBe('ice-face')

    const unrelatedMap: TabletopMap = {
      ...before,
      temporaryHitPoints: {
        scene: { name: 'Scene', startedAt: 100 },
        byPlacementId: { actor: 999 },
      },
    }
    const unrelatedContext = buildAuthoritativeMoveRulesContext({
      map: unrelatedMap,
      pokemonSheets: new Map([['actor', actor], ['target', target]]),
      trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Tackle',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.5,
      time: 1_100,
    })
    expect(unrelatedContext.actor.token.creatureRules?.formId).toBe('noice-face')
  }, 30_000)

  it('aa075.ice-face.reviewed restores its owned pool in Hail and drops ownership on depletion or replacement', () => {
    const dependencies = setup({
      slug: 'aa075-ice-face-restore', ability: 'Ice Face', hail: true, temporaryHp: 1,
    })
    resolveOffer({
      dependencies, slug: 'aa075-ice-face-restore', canonicalId: 'Ice Face', modeId: 'restore-face',
      select: () => [],
    })
    const restored = dependencies.mapRepository.getBySlug('aa075-ice-face-restore')!
    const restoredPool = restored.temporaryHitPoints?.byPlacementId.actor ?? 0
    expect(restoredPool).toBeGreaterThan(1)
    expect(restored.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'capability',
      payload: { capabilityId: AA075_ICE_FACE_FORM_MARKER_CAPABILITY, action: 'grant' },
    }))
    expect(restored.encounterState?.turnResources.actor?.actions.standard.spent).toBe(1)

    const depleted = reconcileAa075IceFaceTemporaryHpOwnershipAfterMove({
      previousMap: restored,
      nextMap: {
        ...restored,
        temporaryHitPoints: {
          ...restored.temporaryHitPoints!,
          byPlacementId: { ...restored.temporaryHitPoints!.byPlacementId, actor: 0 },
        },
      },
      operations: [],
    })
    expect(depleted.encounterState?.effects.some(effect => (
      effect.kind === 'capability'
      && effect.payload.capabilityId === AA075_ICE_FACE_FORM_MARKER_CAPABILITY
    ))).toBe(false)

    const replacementOperation = parseMoveEffectOperation({
      id: 'move.unrelated.temporary-hp', kind: 'heal',
      source: { kind: 'move', id: 'move.unrelated' }, recipients: { kind: 'actor' },
      phase: 'cleanup', reasonCode: 'move.unrelated.temporary-hp',
      payload: {
        mode: 'gain', pool: 'temporary-hit-points',
        calculation: { kind: 'fixed', value: restoredPool + 10 },
        bounds: { minimum: 0, maximum: null }, rounding: 'floor',
        injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
      },
    })
    const replaced = reconcileAa075IceFaceTemporaryHpOwnershipAfterMove({
      previousMap: restored,
      nextMap: {
        ...restored,
        temporaryHitPoints: {
          ...restored.temporaryHitPoints!,
          byPlacementId: {
            ...restored.temporaryHitPoints!.byPlacementId,
            actor: restoredPool + 10,
          },
        },
      },
      operations: [{ operation: replacementOperation, recipientIds: ['actor'] }],
    })
    expect(replaced.encounterState?.effects.some(effect => (
      effect.kind === 'capability'
      && effect.payload.capabilityId === AA075_ICE_FACE_FORM_MARKER_CAPABILITY
    ))).toBe(false)

    const unknownIncrease = reconcileAa075IceFaceTemporaryHpOwnershipAfterMove({
      previousMap: restored,
      nextMap: {
        ...restored,
        temporaryHitPoints: {
          ...restored.temporaryHitPoints!,
          byPlacementId: {
            ...restored.temporaryHitPoints!.byPlacementId,
            actor: restoredPool + 20,
          },
        },
      },
      operations: [],
    })
    expect(unknownIncrease.encounterState?.effects.some(effect => (
      effect.kind === 'capability'
      && effect.payload.capabilityId === AA075_ICE_FACE_FORM_MARKER_CAPABILITY
    ))).toBe(false)

    const noHail = setup({ slug: 'aa075-ice-face-no-hail', ability: 'Ice Face' })
    expect(() => resolveOffer({
      dependencies: noHail, slug: 'aa075-ice-face-no-hail', canonicalId: 'Ice Face',
      modeId: 'restore-face', select: () => [],
    })).toThrow(/Hailing Weather/i)
    expect(noHail.mapRepository.getBySlug('aa075-ice-face-no-hail')!
      .encounterState?.turnResources.actor?.actions.standard.spent).toBe(0)
  })

  it('aa075.ice-shield.reviewed creates one through three contiguous custom barrier segments as an Interrupt', () => {
    const dependencies = setup({
      slug: 'aa075-ice-shield', ability: 'Ice Shield', activeId: 'target',
    })
    const result = resolveOffer({
      dependencies, slug: 'aa075-ice-shield', canonicalId: 'Ice Shield', modeId: 'activate',
      select: (declaration) => declaration.options
        .filter(option => option.hint.kind === 'cell'
          && option.hint.y === 0
          && option.hint.z === 2
          && [1, 0].includes(option.hint.x))
        .map(option => option.optionId),
    })
    expect(result.kind).toBe('accepted')
    const map = dependencies.mapRepository.getBySlug('aa075-ice-shield')!
    const zones = map.encounterState?.zones.filter(zone => zone.kind === 'barrier') ?? []
    expect(zones).toHaveLength(2)
    expect(zones).toEqual(expect.arrayContaining([
      expect.objectContaining({
        duration: { kind: 'scene', remaining: null },
        payload: {
          barrierId: 'ice-shield', currentHitPoints: 10, maximumHitPoints: 10,
          damageReduction: 5, height: 2, typeIds: ['ice'],
        },
      }),
    ]))
    expect(map.encounterState?.turnResources.actor?.actions.standard.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Ice Shield', spent: 1, limit: 1,
    }))
  })

  it('aa075.ice-shield.reviewed rejects disconnected issued segments before payment', () => {
    const dependencies = setup({
      slug: 'aa075-ice-shield-invalid', ability: 'Ice Shield', activeId: 'target',
    })
    expect(() => resolveOffer({
      dependencies, slug: 'aa075-ice-shield-invalid', canonicalId: 'Ice Shield', modeId: 'activate',
      select: declaration => declaration.options.filter(option => (
        option.hint.kind === 'cell'
        && option.hint.y === 0
        && ((option.hint.x === 1 && option.hint.z === 2)
          || (option.hint.x === 3 && option.hint.z === 2))
      )).map(option => option.optionId),
    })).toThrow(/continuous/i)
    const map = dependencies.mapRepository.getBySlug('aa075-ice-shield-invalid')!
    expect(map.encounterState?.zones).toEqual([])
    expect(map.encounterState?.turnResources.actor?.actions.standard.spent).toBe(0)
  })

  it('aa075.illusion.reviewed supports object appearance, replacement, source loss, and dismissal', () => {
    const dependencies = setup({
      slug: 'aa075-illusion-lifecycle', ability: 'Illusion', focus: '5d6',
    })
    const resetActions = () => {
      const current = dependencies.mapRepository.getBySlug('aa075-illusion-lifecycle')!
      const round = (current.initiative?.round ?? 1) + 1
      dependencies.mapRepository.saveSetupMap({
        ...current,
        initiative: { ...current.initiative!, round },
        encounterState: {
          ...current.encounterState!,
          effects: current.encounterState!.effects.filter(effect => !(
            effect.kind === 'capability'
            && effect.payload.capabilityId === 'aa075.illusion.round-use'
          )),
          history: {
            ...current.encounterState!.history,
            currentRound: round,
            currentTurn: { round, turn: 1, placementId: 'actor' },
          },
          turnResources: {
            ...current.encounterState!.turnResources,
            actor: createEncounterTurnResourceLedger({ placementId: 'actor', round }),
          },
        },
      })
    }
    resolveOffer({
      dependencies, slug: 'aa075-illusion-lifecycle', canonicalId: 'Illusion', modeId: 'mark-object',
      select: declaration => declaration.options.filter(option => (
        option.hint.kind === 'cell'
        && option.hint.x === 7 && option.hint.y === 0 && option.hint.z === 2
      )).map(option => option.optionId),
    })
    resolveOffer({
      dependencies, slug: 'aa075-illusion-lifecycle', canonicalId: 'Illusion', modeId: 'assume',
      requestSuffix: 'assume-object',
      select: declaration => declaration.options.slice(0, 1).map(option => option.optionId),
    })
    const objectMap = dependencies.mapRepository.getBySlug('aa075-illusion-lifecycle')!
    const actor = savedSheet(dependencies)
    const target = savedSheet(dependencies, 'target')
    const objectContext = buildAuthoritativeMoveRulesContext({
      map: objectMap,
      pokemonSheets: new Map([['actor', actor], ['target', target]]), trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Tackle',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.5, time: 2_000,
    })
    const objectProjection = projectEncounterIllusionAppearances({
      tokens: [objectContext.actor.token, objectContext.queries.tokens.get('target')!],
      map: objectMap,
    })[0]!
    expect(objectProjection.species).toBe('Cave Stone')
    expect(objectProjection.spriteUrl).toMatch(/^data:image\/svg\+xml,/)
    expect(objectProjection.atk).toBe(objectContext.actor.token.atk)
    expect(objectProjection.base).toBe(objectContext.actor.token.base)

    resetActions()
    resolveOffer({
      dependencies, slug: 'aa075-illusion-lifecycle', canonicalId: 'Illusion', modeId: 'replace-creature',
      requestSuffix: 'replace-creature-object',
      select: declaration => declaration.declarationId === 'replace-creature.target'
        ? declaration.options.filter(option => (
            option.hint.kind === 'placement' && option.hint.placementId === 'target'
          )).map(option => option.optionId)
        : declaration.options.slice(0, 1).map(option => option.optionId),
    })
    const replaced = dependencies.mapRepository.getBySlug('aa075-illusion-lifecycle')!
    expect(replaced.encounterState?.abilityOwnedState?.entries).toHaveLength(1)
    expect(replaced.encounterState?.abilityOwnedState?.entries[0]?.targetPlacementIds).toEqual(['target'])
    expect(replaced.encounterState?.effects.some(effect => (
      effect.kind === 'capability'
      && effect.payload.capabilityId.startsWith('aa075.illusion.active:')
    ))).toBe(false)

    resetActions()
    resolveOffer({
      dependencies, slug: 'aa075-illusion-lifecycle', canonicalId: 'Illusion', modeId: 'assume',
      requestSuffix: 'assume-creature',
      select: declaration => declaration.options.slice(0, 1).map(option => option.optionId),
    })
    const creatureMap = dependencies.mapRepository.getBySlug('aa075-illusion-lifecycle')!
    const creatureContext = buildAuthoritativeMoveRulesContext({
      map: creatureMap,
      pokemonSheets: new Map([['actor', actor], ['target', target]]), trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Tackle',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.5, time: 3_000,
    })
    const ownSpecies = creatureContext.actor.token.species
    const creatureProjection = projectEncounterIllusionAppearances({
      tokens: [creatureContext.actor.token, creatureContext.queries.tokens.get('target')!],
      map: creatureMap,
    })[0]!
    expect(creatureProjection.species).toBe(creatureContext.queries.tokens.get('target')!.species)
    expect(creatureProjection.atk).toBe(creatureContext.actor.token.atk)
    const sourceLostProjection = projectEncounterIllusionAppearances({
      tokens: [creatureContext.actor.token, creatureContext.queries.tokens.get('target')!],
      map: {
        ...creatureMap,
        encounterState: { ...creatureMap.encounterState!, abilityOwnedState: { schemaVersion: 1, entries: [], receipts: [] } },
      },
    })[0]!
    expect(sourceLostProjection.species).toBe(ownSpecies)

    resetActions()
    resolveOffer({
      dependencies, slug: 'aa075-illusion-lifecycle', canonicalId: 'Illusion', modeId: 'dismiss',
      requestSuffix: 'dismiss-creature', select: () => [],
    })
    const dismissed = dependencies.mapRepository.getBySlug('aa075-illusion-lifecycle')!
    expect(dismissed.encounterState?.effects.some(effect => (
      effect.kind === 'capability'
      && effect.payload.capabilityId.startsWith('aa075.illusion.active:')
    ))).toBe(false)
    expect(dismissed.encounterState?.abilityOwnedState?.entries).toHaveLength(1)
  }, 30_000)

  it('aa075.illusion.reviewed durably marks, assumes once per round, and remains appearance-only', () => {
    const dependencies = setup({
      slug: 'aa075-illusion', ability: 'Illusion', focus: '5d6',
    })
    resolveOffer({
      dependencies, slug: 'aa075-illusion', canonicalId: 'Illusion', modeId: 'mark-creature',
      select: declaration => declaration.options
        .filter(option => option.hint.kind === 'placement' && option.hint.placementId === 'target')
        .map(option => option.optionId),
    })
    const marked = dependencies.mapRepository.getBySlug('aa075-illusion')!
    const mark = marked.encounterState?.abilityOwnedState?.entries[0]
    expect(mark).toMatchObject({
      ownerPlacementId: 'actor', sourceAbilityInstanceId: 'base:illusion',
      canonicalId: 'Illusion', targetPlacementIds: ['target'],
    })

    const pendingOffer = begin(dependencies, 'aa075-illusion', 'Illusion', 'assume', 'assume-reconnect')
    expect(pendingOffer.declarations[0]?.options).toHaveLength(1)
    const persistedOffer = pendingOffer
    resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
      schemaVersion: 1,
      intentId: 'intent:aa075-illusion:assume-reconnect',
      offerId: persistedOffer.offerId,
      offerSha256: persistedOffer.offerSha256,
      mapSlug: 'aa075-illusion',
      baseRevision: persistedOffer.mapRevision,
      actorPlacementId: 'actor',
      abilityInstanceId: 'base:illusion',
      canonicalId: 'Illusion',
      modeId: 'assume',
      selections: [{
        declarationId: persistedOffer.declarations[0]!.declarationId,
        kind: 'branch',
        optionIds: [persistedOffer.declarations[0]!.options[0]!.optionId],
      }],
    } }, dependencies)
    const assumed = dependencies.mapRepository.getBySlug('aa075-illusion')!
    expect(assumed.encounterState?.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'capability',
        payload: expect.objectContaining({ capabilityId: expect.stringContaining('aa075.illusion.active:') }),
      }),
      expect.objectContaining({
        kind: 'capability',
        payload: { capabilityId: 'aa075.illusion.round-use', action: 'grant' },
      }),
    ]))
    expect(assumed.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(() => begin(dependencies, 'aa075-illusion', 'Illusion', 'assume', 'assume-again'))
      .toThrow(/too few currently legal options/i)

    const actor = savedSheet(dependencies)
    const target = savedSheet(dependencies, 'target')
    const mechanics = buildAuthoritativeMoveRulesContext({
      map: assumed,
      pokemonSheets: new Map([['actor', actor], ['target', target]]),
      trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Tackle',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.5,
      time: 2_000,
    })
    expect(mechanics.actor.token.species).toBe('actor')
    expect(mechanics.actor.token.species).not.toBe(mechanics.queries.tokens.get('target')?.species)
    expect(mechanics.actor.token.atk).not.toBe(mechanics.queries.tokens.get('target')?.atk)
  })
})
