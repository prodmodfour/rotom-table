import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import { parseEncounterZone } from '#shared/moveAutomation/encounterZones'
import {
  AuthoritativeMoveRulesContextError,
  buildAuthoritativeMoveRulesContext,
} from '~~/server/domain/moveAutomation/context'
import { resolveAuthoritativeMoveUserAccuracy } from '~~/server/domain/moveAutomation/accuracy'
import {
  advanceEncounterGlobalFields,
  createEncounterGlobalFieldZone,
  removeEncounterGlobalFields,
} from '~~/server/domain/moveAutomation/fieldLifecycle'
import { resolveAuthoritativeMoveFromContext } from '~~/server/domain/resolveAuthoritativeMove'
import { redBlueEncounterStateFixture } from '../fixtures/moveAutomation/encounterSides'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { TrainerSheet } from '~/types/trainerSheet'
import { EXPLICIT_MOVE_AUTOMATION_SCRIPTS } from '~/utils/move-automation/registry'
import { MOVE_AUTOMATION_RUNTIME_REGISTRY } from '~~/server/domain/moveAutomation/registry'
import { moveListOverlayEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'
import {
  snapshotAuthoritativeEncounterTransformation,
} from '~~/server/domain/moveAutomation/transformationSnapshot'

const placement = (
  id: string,
  sheetSlug: string,
  x: number,
  sideId?: string,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 0 },
  ...(sideId ? { sideId } : {}),
})

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'context-arena',
  name: 'Context Arena',
  revision: 7,
  dimensions: { x: 8, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    placement('actor-token', 'actor', 0, 'red'),
    placement('target-token', 'target', 1, 'blue'),
    placement('ally-token', 'ally', 2, 'red'),
  ],
  lights: [],
  initiative: { activeId: 'actor-token', round: 2 },
  encounterState: redBlueEncounterStateFixture(),
})

const pokemonSheet = (
  slug: string,
  overrides: Partial<CharacterSheet> = {},
): CharacterSheet => ({
  slug,
  nickname: slug,
  species: slug === 'target' ? 'Snorlax' : 'Pikachu',
  level: 20,
  revision: 3,
  movelist: slug === 'actor' ? [{ name: 'Tackle' }] : [],
  combat: { currentHp: 80 },
  ...overrides,
})

const intent = (): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  placementId: 'actor-token',
  moveName: 'Tackle',
  selection: { kind: 'single-target', targetPlacementId: 'target-token' },
})

const randomSequence = (values: readonly number[]): (() => number) => {
  let index = 0
  return () => values[index++] ?? values.at(-1) ?? 0
}

const smokeZone = () => parseEncounterZone({
  id: 'zone.smoke.target',
  kind: 'smoke',
  source: {
    kind: 'operation',
    operationId: 'operation.smokescreen',
    moveId: 'smokescreen',
    placementId: 'ally-token',
  },
  sideId: 'red',
  geometry: { kind: 'cells', cells: [{ x: 1, y: 0, z: 0 }] },
  layer: 1,
  duration: { kind: 'scene', remaining: null },
  stacking: { kind: 'refresh', maxLayers: null },
  hooks: { entry: [], exit: [] },
  modifiers: { targeting: [], damage: [], movement: [] },
  tags: ['smoke'],
  payload: { smokeId: 'smokescreen' },
})

const barrierZone = () => parseEncounterZone({
  id: 'zone.barrier.center',
  kind: 'barrier',
  source: {
    kind: 'operation',
    operationId: 'operation.barrier',
    moveId: 'barrier',
    placementId: 'ally-token',
  },
  sideId: 'red',
  geometry: { kind: 'cells', cells: [{ x: 1, y: 0, z: 0 }] },
  layer: 1,
  duration: { kind: 'scene', remaining: null },
  stacking: { kind: 'independent', maxLayers: null },
  hooks: { entry: [], exit: [] },
  modifiers: { targeting: [], damage: [], movement: [] },
  tags: ['barrier'],
  payload: { barrierId: 'barrier' },
})

const globalRoom = (
  kind: 'magic' | 'gravity',
  remaining = 3,
) => createEncounterGlobalFieldZone({
  kind: 'room',
  fieldId: kind,
  source: {
    kind: 'operation',
    operationId: `operation.${kind}`,
    moveId: `move.${kind}`,
    placementId: 'actor-token',
  },
  sideId: 'red',
  duration: { kind: 'rounds', boundary: 'end', remaining },
  replacementGroup: `field.room.${kind}`,
})

const buildContext = (overrides: {
  readonly map?: TabletopMap
  readonly pokemonSheets?: ReadonlyMap<string, CharacterSheet>
  readonly random?: () => number
  readonly intent?: ResolveMoveIntent
} = {}) => buildAuthoritativeMoveRulesContext({
  map: overrides.map ?? mapFixture(),
  pokemonSheets: overrides.pokemonSheets ?? new Map([
    ['actor', pokemonSheet('actor')],
    ['target', pokemonSheet('target', { revision: 5 })],
    ['ally', pokemonSheet('ally')],
  ]),
  trainerSheets: new Map<string, TrainerSheet>(),
  intent: overrides.intent ?? intent(),
  candidatePlacementIds: ['target-token', 'ally-token'],
  selectedPlacementIds: ['target-token'],
  random: overrides.random ?? randomSequence([0.5, 0, 0.25]),
  time: 1_234,
})

describe('immutable authoritative move rules context', () => {
  it('snapshots a complete reviewed transformation form and records its target sheet read', () => {
    const target = pokemonSheet('target', {
      revision: 5,
      species: 'Snorlax',
      types: ['Normal'],
      abilities: [{ name: 'Thick Fat' }, { name: 'Immunity' }],
      movelist: [{ name: 'Tackle' }, { name: 'Growl' }],
      capabilities: { overland: 4, power: 11, weight: 5, size: 'Large', other: ['Tracker'] },
    })
    const context = buildContext({
      pokemonSheets: new Map([
        ['actor', pokemonSheet('actor')],
        ['target', target],
        ['ally', pokemonSheet('ally')],
      ]),
    })
    const before = structuredClone(target)

    const snapshot = snapshotAuthoritativeEncounterTransformation({
      context,
      targetPlacementId: 'target-token',
    })

    expect(snapshot).toMatchObject({
      copiedFromPlacementId: 'target-token',
      moves: [
        { canonicalMoveId: 'Struggle', copiedSpecHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
        { canonicalMoveId: 'Tackle', copiedSpecHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
        { canonicalMoveId: 'Growl', copiedSpecHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      ],
      typeIds: ['normal'],
      abilityNames: ['Thick Fat', 'Immunity'],
      weightClass: 5,
      capabilities: {
        movementSpeeds: { overland: 4 },
        power: 11,
        size: 'Large',
        other: ['Tracker'],
      },
      appearance: {
        species: 'Snorlax',
        slug: 'snorlax',
      },
    })
    expect(context.reads.snapshot()).toEqual([
      { kind: 'pokemon', slug: 'target', revision: 5 },
    ])
    expect(target).toEqual(before)
    expect(Object.isFrozen(context.actor.token)).toBe(true)
  })

  it('detaches and freezes map, actor, placement, sheet, ruleset, and query snapshots', () => {
    const map = mapFixture()
    const actor = pokemonSheet('actor')
    const pokemonSheets = new Map([
      ['actor', actor],
      ['target', pokemonSheet('target', { revision: 5 })],
      ['ally', pokemonSheet('ally')],
    ])
    const context = buildContext({ map, pokemonSheets })

    map.name = 'Mutated source map'
    map.placements[0]!.position.x = 7
    actor.nickname = 'Mutated source actor'
    pokemonSheets.delete('target')

    expect(context.map.name).toBe('Context Arena')
    expect(context.actor.placement.position).toEqual({ x: 0, y: 0, z: 0 })
    expect(context.actor.token.species).toBe('actor')
    expect((context.actor.sheet.sheet as CharacterSheet).nickname).toBe('actor')
    expect(context.candidatePlacements.map(({ id }) => id)).toEqual(['target-token', 'ally-token'])
    expect(context.selectedPlacements.map(({ id }) => id)).toEqual(['target-token'])
    expect(context.resolvedSheets.find(sheet => sheet.slug === 'target')).toMatchObject({
      kind: 'pokemon',
      slug: 'target',
      revision: 5,
    })
    expect(context.ruleset).toMatchObject({
      rulesetId: 'rotom-table-reference-moves-v1',
      canonicalization: { version: 1 },
    })

    expect(Object.isFrozen(context)).toBe(true)
    expect(Object.isFrozen(context.map)).toBe(true)
    expect(Object.isFrozen(context.map.placements)).toBe(true)
    expect(Object.isFrozen(context.actor.token)).toBe(true)
    expect(Object.isFrozen(context.actor.sheet.sheet)).toBe(true)
    expect(Object.isFrozen(context.candidatePlacements)).toBe(true)
    expect(Object.isFrozen(context.ruleset)).toBe(true)
    expect(Object.isFrozen(context.queries)).toBe(true)
    expect(() => {
      ;(context.map.placements as SheetPlacement[]).push(placement('forged', 'actor', 4))
    }).toThrow()
  })

  it('serves snapshot-only placement, token, sheet, relationship, global-field, history, resource, target-state, line-of-sight, runtime, and status queries', () => {
    const context = buildContext()
    const actor = context.queries.placements.get('actor-token')!
    const target = context.queries.placements.get('target-token')!
    const allyPlacement = context.queries.placements.get('ally-token')!

    expect(context.queries.placements.all()).toHaveLength(3)
    expect(context.queries.placements.candidates()).toEqual(context.candidatePlacements)
    expect(context.queries.placements.selected()).toEqual(context.selectedPlacements)
    expect(context.queries.tokens.get('target-token')).toMatchObject({ id: 'target-token', sheetSlug: 'target' })
    expect(context.queries.sheets.forPlacement(target)).toMatchObject({
      kind: 'pokemon',
      slug: 'target',
      revision: 5,
    })
    expect(context.queries.relationships.resolve(actor.id, actor.id)).toMatchObject({
      relationship: 'self',
      reasonCode: 'relationship-self',
    })
    expect(context.queries.relationships.match(actor.id, allyPlacement.id, 'same-side')).toMatchObject({
      relationship: 'ally',
      reasonCode: 'relationship-ally',
      matches: true,
    })
    expect(context.queries.relationships.match(actor.id, allyPlacement.id, 'ally').matches).toBe(true)
    expect(context.queries.relationships.match(actor.id, target.id, 'enemy')).toMatchObject({
      relationship: 'enemy',
      reasonCode: 'relationship-enemy',
      matches: true,
    })
    expect(context.queries.globalFields.gravity()).toMatchObject({
      field: { active: false, instance: null },
      overlay: { accuracyRollBonus: 0 },
      reasonCode: 'gravity.inactive',
    })
    expect(context.queries.globalFields.magicRoom({
      scope: 'pokemon-held',
      timing: 'static',
    })).toMatchObject({
      suppressed: false,
      reasonCode: 'magic-room.inactive',
    })
    expect(Object.isFrozen(context.queries.globalFields)).toBe(true)
    expect(context.queries.history.query(actor.id, 'last-completed-move-id')).toBeNull()
    expect(context.queries.history.query(actor.id, 'damage-dealt-this-turn')).toBe(0)
    expect(Object.isFrozen(context.queries.history)).toBe(true)
    expect(context.queries.resources.ledger(actor.id)).toBeNull()
    expect(context.queries.resources.actionAvailable(actor.id, 'standard')).toBe(false)
    expect(context.queries.resources.reactionAvailable(actor.id)).toBe(false)
    expect(Object.isFrozen(context.queries.resources)).toBe(true)
    expect(context.queries.targetStates.resolve(target.id)).toMatchObject({
      targetPlacementId: target.id,
      vitality: 'conscious',
      grounding: 'grounded',
      typeIds: ['normal'],
      size: 'large',
      weightClass: 6,
      sheetKind: 'pokemon',
    })
    expect(Object.isFrozen(context.queries.targetStates)).toBe(true)
    expect(context.queries.lineOfSight.resolve(actor.id, target.id)).toMatchObject({
      sourcePlacementId: actor.id,
      targetPlacementId: target.id,
      targetable: true,
      visibility: 'full',
      cover: 'none',
      accuracyModifier: 0,
      reasonCode: 'line-of-sight-clear',
    })
    expect(Object.isFrozen(context.queries.lineOfSight)).toBe(true)
    expect(context.queries.rules.runtimeFor('Tackle')).toMatchObject({
      canonicalId: 'Tackle',
      kind: 'legacy-v1',
    })
    expect(context.queries.rules.runtimeFor('tackle')).toBeNull()
    expect(context.queries.rules.legacyScriptFor('tackle')).toMatchObject({ moveName: 'Tackle' })
    expect(context.queries.rules.semanticStatusFor('Tackle')).toMatchObject({
      canonicalId: 'Tackle',
      baseStatus: 'assisted',
    })
  })

  it('uses encounter move-list overlays and validates temporary copy hashes in actor legality', () => {
    const disabledMap = mapFixture()
    disabledMap.encounterState = {
      ...disabledMap.encounterState!,
      effects: [{
        ...moveListOverlayEncounterEffectFixture({
          action: 'disable',
          canonicalMoveIds: ['Tackle'],
        }),
        id: 'effect.move-list.disable-tackle',
        affected: { placementIds: ['actor-token'], sideIds: [], cells: [] },
      }],
    }
    const disabledContext = buildContext({ map: disabledMap })
    const disabled = disabledContext.queries.resolveActorMoveEntry('Tackle')

    const runtime = MOVE_AUTOMATION_RUNTIME_REGISTRY.resolve('Swords Dance')
    if (!runtime) throw new Error('Swords Dance runtime is missing')
    const copiedMap = mapFixture()
    const copiedEffect = {
      ...moveListOverlayEncounterEffectFixture({
        action: 'add',
        canonicalMoveId: 'Swords Dance',
        copiedSpecHash: runtime.definitionHash,
      }),
      id: 'effect.move-list.copy-swords-dance',
      affected: { placementIds: ['actor-token'], sideIds: [], cells: [] },
    }
    copiedMap.encounterState = {
      ...copiedMap.encounterState!,
      effects: [copiedEffect],
    }
    const copiedContext = buildContext({
      map: copiedMap,
      intent: {
        schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
        placementId: 'actor-token',
        moveName: 'Swords Dance',
        selection: { kind: 'self' },
      },
    })
    const copied = copiedContext.queries.resolveActorMoveEntry('Swords Dance')

    copiedMap.encounterState = {
      ...copiedMap.encounterState,
      effects: [{
        ...copiedEffect,
        payload: {
          action: 'add',
          canonicalMoveId: 'Swords Dance',
          copiedSpecHash: 'f'.repeat(64),
        },
      }],
    }
    const staleContext = buildContext({
      map: copiedMap,
      intent: {
        schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
        placementId: 'actor-token',
        moveName: 'Swords Dance',
        selection: { kind: 'self' },
      },
    })
    const stale = staleContext.queries.resolveActorMoveEntry('Swords Dance')

    expect(disabled).toMatchObject({ ok: false, reason: 'move-list-blocked' })
    expect(() => resolveAuthoritativeMoveFromContext(disabledContext)).toThrow(expect.objectContaining({
      code: 'move-list-overlay-blocked',
      reason: 'unauthorized-state',
    }))
    expect(copied).toMatchObject({
      ok: true,
      entry: {
        canonicalMoveName: 'Swords Dance',
        copiedSpecHash: runtime.definitionHash,
        moveListSource: {
          kind: 'encounter-overlay',
          effectId: 'effect.move-list.copy-swords-dance',
        },
      },
    })
    expect(resolveAuthoritativeMoveFromContext(copiedContext)).toMatchObject({
      canonicalMoveName: 'Swords Dance',
      transaction: {
        userId: 'actor-token',
        combatStageUpdates: [expect.objectContaining({ id: 'actor-token' })],
      },
    })
    expect(stale).toMatchObject({ ok: false, reason: 'copied-spec-mismatch' })
    expect(() => resolveAuthoritativeMoveFromContext(staleContext)).toThrow(expect.objectContaining({
      code: 'move-list-overlay-stale',
      reason: 'conflict',
    }))
  })

  it('derives relationship results from the snapshotted side directory and requires unknown-target opt-in', () => {
    const map = mapFixture()
    delete map.placements[1]!.sideId
    const context = buildContext({ map })

    map.placements[1]!.sideId = 'blue'

    expect(context.queries.relationships.resolve('actor-token', 'target-token')).toEqual({
      sourcePlacementId: 'actor-token',
      targetPlacementId: 'target-token',
      sourceSideId: 'red',
      targetSideId: null,
      relationship: 'unknown',
      reasonCode: 'relationship-unknown-side',
    })
    expect(context.queries.relationships.match('actor-token', 'target-token', 'ally', {
      allowUnknown: true,
    }).matches).toBe(false)
    expect(context.queries.relationships.match('actor-token', 'target-token', 'enemy', {
      allowUnknown: true,
    }).matches).toBe(false)
    expect(context.queries.relationships.match('actor-token', 'target-token', 'other').matches).toBe(false)
    expect(context.queries.relationships.match('actor-token', 'target-token', 'other', {
      allowUnknown: true,
    })).toMatchObject({
      relationship: 'unknown',
      reasonCode: 'relationship-unknown-side',
      matches: true,
    })
  })

  it('applies Magic Room and Gravity through read-only item, accuracy, and grounding consumers', () => {
    const map = mapFixture()
    const magicRoom = globalRoom('magic', 1)
    const gravity = globalRoom('gravity')
    map.encounterState = {
      ...redBlueEncounterStateFixture(),
      zones: [magicRoom, gravity],
    }
    const actorSheet = pokemonSheet('actor', {
      capabilities: { sky: 6 },
      items: { held: 'Luck Incense' },
    })
    const pokemonSheets = new Map([
      ['actor', actorSheet],
      ['target', pokemonSheet('target', { revision: 5 })],
      ['ally', pokemonSheet('ally')],
    ])
    const beforeMap = structuredClone(map)
    const beforeActor = structuredClone(actorSheet)
    const context = buildContext({ map, pokemonSheets })

    expect(context.queries.itemEffects.resolve({
      placementId: 'actor-token',
      scope: 'pokemon-held',
      timing: 'static',
    })).toMatchObject({
      outcome: 'suppressed',
      suppressed: true,
      sourceSideId: 'red',
      reasonCode: 'item-effect.magic-room-suppressed',
    })
    expect(context.queries.itemEffects.resolve({
      placementId: 'actor-token',
      scope: 'pokemon-held',
      timing: 'activated',
    })).toMatchObject({
      outcome: 'allowed',
      suppressed: false,
      sourceSideId: 'red',
      reasonCode: 'item-effect.magic-room-exempt',
    })
    expect(resolveAuthoritativeMoveUserAccuracy(context)).toMatchObject({
      value: 2,
      heldItemEffectsSuppressed: true,
      gravityBonus: 2,
      modifiers: [
        { sourceId: 'actor-accuracy', value: 0 },
        { reason: 'Gravity Accuracy', value: 2 },
      ],
    })
    expect(context.queries.targetStates.resolve('actor-token')).toMatchObject({
      grounding: 'grounded',
    })
    expect(context.queries.gravity.active()).toMatchObject({
      sourceSideId: 'red',
      duration: { kind: 'rounds', boundary: 'end', remaining: 3 },
    })
    expect(context.reads.snapshot()).toEqual([
      { kind: 'pokemon', slug: 'actor', revision: 3 },
    ])
    expect(map).toEqual(beforeMap)
    expect(actorSheet).toEqual(beforeActor)

    const expired = advanceEncounterGlobalFields({
      zones: map.encounterState.zones,
      event: { kind: 'round-end' },
    })
    expect(expired.transitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ zoneId: magicRoom.id, kind: 'expired' }),
      expect.objectContaining({ zoneId: gravity.id, kind: 'duration-decremented' }),
    ]))
    const afterMagicExpiryMap: TabletopMap = {
      ...map,
      encounterState: { ...map.encounterState, zones: expired.zones },
    }
    const afterMagicExpiry = buildContext({ map: afterMagicExpiryMap, pokemonSheets })
    expect(afterMagicExpiry.queries.itemEffects.resolve({
      placementId: 'actor-token',
      scope: 'pokemon-held',
      timing: 'static',
    })).toMatchObject({
      outcome: 'allowed',
      suppressed: false,
      sourceZoneId: null,
      reasonCode: 'item-effect.allowed',
    })
    expect(resolveAuthoritativeMoveUserAccuracy(afterMagicExpiry)).toMatchObject({
      value: 3,
      heldItemEffectsSuppressed: false,
      gravityBonus: 2,
    })

    const gravityRemoved = removeEncounterGlobalFields({
      zones: expired.zones,
      matches: zone => zone.kind === 'room' && zone.payload.roomId === 'gravity',
    })
    expect(gravityRemoved.transitions).toEqual([
      expect.objectContaining({ zoneId: gravity.id, kind: 'removed' }),
    ])
    const removedMap: TabletopMap = {
      ...map,
      encounterState: { ...map.encounterState, zones: gravityRemoved.zones },
    }
    const removed = buildContext({ map: removedMap, pokemonSheets })
    expect(resolveAuthoritativeMoveUserAccuracy(removed)).toMatchObject({
      value: 1,
      heldItemEffectsSuppressed: false,
      gravityBonus: 0,
    })
    expect(removed.queries.targetStates.resolve('actor-token')).toMatchObject({
      grounding: 'airborne',
    })
  })

  it('applies target-specific smoke accuracy and Barrier targeting from authoritative zones', () => {
    const smokeMap = mapFixture()
    smokeMap.encounterState = {
      ...redBlueEncounterStateFixture(),
      zones: [smokeZone()],
    }
    const smokeContext = buildContext({ map: smokeMap })

    expect(smokeContext.queries.barriersAndSmoke.smoke()).toEqual([
      expect.objectContaining({
        zoneId: 'zone.smoke.target',
        sideId: 'red',
        cells: [{ x: 1, y: 0, z: 0 }],
      }),
    ])
    expect(resolveAuthoritativeMoveUserAccuracy(smokeContext, {
      targetPlacementId: 'target-token',
    })).toMatchObject({
      value: -3,
      sight: {
        modifierTotal: -3,
        smoke: {
          affectingZoneIds: ['zone.smoke.target'],
          modifiers: [{
            sourceId: 'zone.smoke.target',
            reason: 'zone.smokescreen.accuracy-penalty',
            value: -3,
          }],
        },
      },
    })
    const resolved = resolveAuthoritativeMoveFromContext(smokeContext)
    expect(resolved.rollLedger[0]?.modifiers).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'zone.smoke.target', value: -3 }),
    ]))

    const barrierMap = mapFixture()
    barrierMap.placements[1]!.position.x = 3
    barrierMap.encounterState = {
      ...redBlueEncounterStateFixture(),
      zones: [barrierZone()],
    }
    const barrierContext = buildContext({ map: barrierMap })
    expect(barrierContext.queries.lineOfSight.resolve('actor-token', 'target-token'))
      .toMatchObject({
        targetable: false,
        reasonCode: 'line-of-sight-blocked-barrier',
        blockingZoneIds: ['zone.barrier.center'],
      })
    expect(() => resolveAuthoritativeMoveFromContext(barrierContext)).toThrowError(
      expect.objectContaining({ code: 'target-line-of-sight-blocked' }),
    )
  })

  it('records a deduplicated, immutable sheet read set only through the context seam', () => {
    const context = buildContext()
    expect(context.reads.snapshot()).toEqual([])

    context.reads.recordPlacement(context.actor.placement)
    context.queries.targetStates.resolve('target-token')
    context.queries.targetStates.resolve('target-token')

    const reads = context.reads.snapshot()
    expect(reads).toEqual([
      { kind: 'pokemon', slug: 'actor', revision: 3 },
      { kind: 'pokemon', slug: 'target', revision: 5 },
    ])
    expect(Object.isFrozen(reads)).toBe(true)
    expect(Object.isFrozen(reads[0])).toBe(true)
  })

  it('records source, target, and intervening cover footprint sheets consulted by line of sight', () => {
    const map = mapFixture()
    map.placements[1]!.position.x = 2
    map.placements[2]!.position.x = 5
    const context = buildContext({ map })

    const result = context.queries.lineOfSight.resolve('actor-token', 'ally-token')

    expect(result).toMatchObject({
      targetable: true,
      cover: 'rough-terrain',
      accuracyModifier: -2,
      coverPlacementIds: ['target-token'],
      consultedPlacementIds: ['actor-token', 'target-token', 'ally-token'],
    })
    expect(context.reads.snapshot()).toEqual([
      { kind: 'pokemon', slug: 'actor', revision: 3 },
      { kind: 'pokemon', slug: 'target', revision: 5 },
      { kind: 'pokemon', slug: 'ally', revision: 3 },
    ])
  })

  it('uses only injected time and randomness after construction and preserves its detached source snapshot', () => {
    const map = mapFixture()
    const actor = pokemonSheet('actor')
    const sheets = new Map([
      ['actor', actor],
      ['target', pokemonSheet('target', { revision: 5 })],
      ['ally', pokemonSheet('ally')],
    ])
    const context = buildContext({
      map,
      pokemonSheets: sheets,
      random: randomSequence([0.5, 0, 0.25]),
    })

    map.placements[1]!.position.x = 7
    actor.movelist = []

    const scripts = EXPLICIT_MOVE_AUTOMATION_SCRIPTS as Map<string, MoveAutomationScript>
    const originalScript = scripts.get('Tackle')!
    scripts.set('Tackle', { ...originalScript, targetMode: 'self' })
    const originalRandom = Math.random
    const originalNow = Date.now
    Math.random = () => { throw new Error('ambient random must not run') }
    Date.now = () => { throw new Error('ambient clock must not run') }
    try {
      const resolution = resolveAuthoritativeMoveFromContext(context)
      expect(resolution.transaction.attackedTargetIds).toEqual(['target-token'])
      expect(resolution.transaction.hitTargetIds).toEqual(['target-token'])
      expect(resolution.feedback?.id).toMatch(/^move-resolution-1234-[0-9a-f]{8}-1$/)
      expect(resolution.rollLedger.map((roll) => roll.rollId)).toEqual([
        'legacy-v1.accuracy.1',
        'legacy-v1.damage.1',
      ])
      expect(resolution.sheetReads).toEqual([
        { kind: 'pokemon', slug: 'actor', revision: 3 },
        { kind: 'pokemon', slug: 'target', revision: 5 },
      ])
    }
    finally {
      scripts.set('Tackle', originalScript)
      Math.random = originalRandom
      Date.now = originalNow
    }
  })

  it('rejects invalid actor and duplicate placement identities before mechanics run', () => {
    expect(() => buildContext({
      map: { ...mapFixture(), placements: [] },
    })).toThrowError(expect.objectContaining({
      name: AuthoritativeMoveRulesContextError.name,
      code: 'actor-placement-missing',
    }))

    const map = mapFixture()
    map.placements.push({ ...map.placements[0]! })
    expect(() => buildContext({ map })).toThrowError(expect.objectContaining({
      name: AuthoritativeMoveRulesContextError.name,
      code: 'duplicate-placement-id',
    }))
  })
})
