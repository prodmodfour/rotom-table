import { describe, expect, it } from 'vitest'
import { LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION, type ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseMoveEffectOperation } from '#shared/moveAutomation/effects'
import { createEmptyCapabilityRuntimeState } from '#shared/capabilityAutomation/state'
import { parseExecuteCapabilityActionCommand } from '#shared/capabilityAutomation/clientCommands'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { capabilityContextualTargetEvasionBonus } from '../../server/domain/moveAutomation/encounterNumericModifiers'
import { executeRegisteredMoveHandler } from '../../server/domain/moveAutomation/handlers/registry'
import {
  capabilityMoveRangeIsRanged,
  resolveAuthoritativeMoveFromContext,
} from '../../server/domain/resolveAuthoritativeMove'
import { resolveAuthoritativeMoveUserAccuracy } from '../../server/domain/moveAutomation/accuracy'
import { resolveMoveSpecDamageCalculation } from '../../server/domain/moveAutomation/damageStats'
import { executeCapabilityMechanic } from '../../server/domain/capabilityAutomation/executeMechanic'
import { buildEncounterPresentationProjection } from '../../server/domain/encounterPresentation/buildProjection'
import { CAPABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/capabilityAutomation/registry'
import { resolveEffectiveCapabilities } from '../../server/domain/capabilityAutomation/effectiveCapabilities'
import { reconcileCapabilityRuntimeSourceLoss } from '../../server/domain/capabilityAutomation/sourceLoss'
import { validateCapabilityActionSelections } from '../../server/domain/capabilityAutomation/validateSelections'
import { capabilityCoupledPresenceIds, removeCapabilityPresenceGroup } from '../../server/domain/capabilityAutomation/presenceLifecycle'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { defaultTargetResolutionState } from '~/utils/moveAutomationTargetResolution'
import { applyEncounterEffectLifecycleEvent } from '../../server/domain/moveAutomation/effectLifecycle'
import { reconcileLivingWeaponRoundMovementResources } from '../../server/domain/capabilityAutomation/livingWeaponMovement'
import { ENCOUNTER_EVENT_SCHEMA_VERSION } from '#shared/moveAutomation/events'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'

const actor: SheetPlacement = {
  id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor-sheet', position: { x: 1, y: 0, z: 1 }, sideId: 'red',
}
const target: SheetPlacement = {
  id: 'target', sheetKind: 'pokemon', sheetSlug: 'target-sheet', position: { x: 2, y: 0, z: 1 }, sideId: 'blue',
}
const baseMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2, slug: 'capability-interactions', name: 'Capability Interactions', revision: 1,
  dimensions: { x: 12, y: 5, z: 12 }, groundLevelY: 0, voxels: [], placements: [actor, target],
  initiative: { activeId: null, round: 1 }, encounterState: createEmptyEncounterState(),
  ...overrides,
})
const pokemon = (slug: string, overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug, nickname: slug, species: slug === actor.sheetSlug ? 'Pikachu' : 'Snorlax', level: 30,
  combat: { currentHp: 50 }, ...overrides,
})
const moveIntent = (moveName: string): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  placementId: actor.id,
  moveName,
  selection: { kind: 'single-target', targetPlacementId: target.id },
})
const moveContext = (
  sheet: CharacterSheet,
  moveName: string,
  map = baseMap(),
  targetSheet = pokemon(target.sheetSlug),
) => buildAuthoritativeMoveRulesContext({
  map,
  pokemonSheets: new Map([[sheet.slug, sheet], [target.sheetSlug, targetSheet]]),
  trainerSheets: new Map<string, TrainerSheet>(),
  intent: moveIntent(moveName), candidatePlacementIds: [target.id], selectedPlacementIds: [target.id],
  random: () => 0, time: 1_000,
})

const command = (canonicalId: string, actionId: string, selections: Record<string, unknown> = {}) => parseExecuteCapabilityActionCommand({
  schemaVersion: 1, operationId: `operation:${actionId}`, mapSlug: 'capability-interactions', baseRevision: 1,
  offerId: `offer:${actionId}`, actorPlacementId: actor.id,
  capabilityInstanceId: `capability:actor:${canonicalId.replaceAll(' ', '_20')}:base`, canonicalId, actionId,
  selections: {
    targetPlacementIds: [], cells: [], optionId: null, recipientTrainerSlug: null,
    canonicalItemId: null, description: null, gmConfirmed: false, ...selections,
  },
})

describe('Capability interactions with moves, edges, and coupled presence', () => {
  it('applies Basic Ranged Attacks only to its selected elemental Struggle capability', () => {
    const fireMove = 'Struggle (Firestarter Special)'
    const ranged = pokemon(actor.sheetSlug, {
      movelist: [{ name: fireMove }], capabilities: { other: ['Firestarter'] },
      edges: [{ name: 'Basic Ranged Attacks (Firestarter)' }],
    })
    expect(moveContext(ranged, fireMove).queries.resolveActorMoveEntry(fireMove)).toMatchObject({
      ok: true, entry: { script: { range: '6, 1 Target' } },
    })

    const wrongSelection = { ...ranged, edges: [{ name: 'Basic Ranged Attacks (Fountain)' }] }
    const unresolved = moveContext(wrongSelection, fireMove).queries.resolveActorMoveEntry(fireMove)
    expect(unresolved.ok && unresolved.entry.script.range).not.toBe('6, 1 Target')
  })

  it('projects As One Basic Abilities through ordinary suppression and disables carried Ability fields', () => {
    const rider = pokemon(actor.sheetSlug, {
      species: 'Calyrex', capabilities: { other: ['As One'] }, movelist: [{ name: 'Tackle' }],
    })
    const mount = pokemon(target.sheetSlug, {
      species: 'Ponyta', abilities: [{ name: 'Flash Fire' }, { name: 'Neutralizing Gas' }],
    })
    const gasPlacement: SheetPlacement = {
      id: 'gas', sheetKind: 'pokemon', sheetSlug: 'gas-sheet', position: { x: 1, y: 0, z: 2 }, sideId: 'blue',
    }
    const gas = pokemon(gasPlacement.sheetSlug, {
      species: 'Koffing', abilities: [{ name: 'Neutralizing Gas' }],
    })
    const unlinked = baseMap({ placements: [actor, target, gasPlacement] })
    const source = resolveEffectiveCapabilities({
      map: unlinked, placement: actor, sheet: rider,
      sheets: { pokemon: new Map([[rider.slug, rider], [mount.slug, mount], [gas.slug, gas]]), trainer: new Map() },
    }).instances.find(instance => instance.effective && instance.canonicalId === 'As One')!
    const linkedMap = (gasActive: boolean): TabletopMap => {
      const encounter = createEmptyEncounterState()
      return {
        ...unlinked,
        encounterState: {
          ...encounter,
          capabilityRuntime: {
            ...encounter.capabilityRuntime!,
            links: [{
              id: 'as-one-link', kind: 'as-one-mount', ownerPlacementId: actor.id,
              participantPlacementIds: [target.id], capabilityInstanceId: source.instanceId,
              canonicalId: 'As One', establishedAt: 100, configurationId: 'Flash Fire',
              sourceOperationId: 'operation-as-one',
            }],
          },
        },
        ...(gasActive ? {} : { placements: [actor, target] }),
      }
    }
    const build = (gasActive: boolean) => buildAuthoritativeMoveRulesContext({
      map: linkedMap(gasActive),
      pokemonSheets: new Map([
        [rider.slug, rider], [mount.slug, mount],
        ...(gasActive ? [[gas.slug, gas] as const] : []),
      ]),
      trainerSheets: new Map(), intent: moveIntent('Tackle'),
      candidatePlacementIds: [target.id], selectedPlacementIds: [target.id], random: () => 0, time: 1_000,
    })
    const withoutIndependentGas = build(false)
    expect(withoutIndependentGas.queries.abilities.has(actor.id, 'Flash Fire')).toBe(true)
    expect(withoutIndependentGas.queries.abilities.has(target.id, 'Neutralizing Gas')).toBe(false)
    expect(build(true).queries.abilities.has(actor.id, 'Flash Fire')).toBe(false)
  })

  it('applies darkness Blindness while Darkvision bypasses its Accuracy and Priority restrictions', () => {
    const deepDarkness = baseMap({ metadata: { capabilityContexts: [`deep-darkness:${actor.id}`] } })
    const ordinary = pokemon(actor.sheetSlug, { movelist: [{ name: 'Tackle' }] })
    const darkvision = pokemon(actor.sheetSlug, {
      movelist: [{ name: 'Tackle' }], capabilities: { other: ['Darkvision'] },
    })
    expect(resolveAuthoritativeMoveUserAccuracy(moveContext(ordinary, 'Tackle', deepDarkness)).value).toBe(-6)
    expect(resolveAuthoritativeMoveUserAccuracy(moveContext(darkvision, 'Tackle', deepDarkness)).value).toBe(0)

    const totalDarkness = baseMap({ metadata: { capabilityContexts: [`total-darkness:${actor.id}`] } })
    const ordinaryPriority = pokemon(actor.sheetSlug, { movelist: [{ name: 'Quick Attack' }] })
    const darkvisionPriority = pokemon(actor.sheetSlug, {
      movelist: [{ name: 'Quick Attack' }], capabilities: { other: ['Darkvision'] },
    })
    expect(() => resolveAuthoritativeMoveFromContext(
      moveContext(ordinaryPriority, 'Quick Attack', totalDarkness),
    )).toThrow(/Total Blindness prevents/i)
    expect(() => resolveAuthoritativeMoveFromContext(
      moveContext(darkvisionPriority, 'Quick Attack', totalDarkness),
    )).not.toThrow()
  })

  it('keeps Telekinetic Struggle at Focus Rank and TK Mastery at Focus Rank plus two', () => {
    const moveName = 'Struggle (Telekinetic Special)'
    const base = pokemon(actor.sheetSlug, {
      movelist: [{ name: moveName }], capabilities: { other: ['Telekinetic'] }, skills: { focus: '6d6' },
    })
    expect(moveContext(base, moveName).queries.resolveActorMoveEntry(moveName)).toMatchObject({
      ok: true, entry: { script: { range: '6, 1 Target' } },
    })
    const mastery = { ...base, edges: [{ name: 'TK Mastery' }] }
    expect(moveContext(mastery, moveName).queries.resolveActorMoveEntry(moveName)).toMatchObject({
      ok: true, entry: { script: { range: '8, 1 Target' } },
    })
  })

  it('projects only size-legal Wielder weapon benefits and caps granted Moves at Adept rank', () => {
    const small = pokemon(actor.sheetSlug, {
      species: 'Pikachu', skills: { combat: '4d6' }, capabilities: { other: ['Wielder'] },
      items: { held: 'Honed Claws' },
    })
    expect(moveContext(small, 'Struggle').queries.resolveActorMoveEntry('Struggle')).toMatchObject({
      ok: true, entry: { script: { damageBase: 5 } },
    })
    const woundingContext = moveContext(small, 'Wounding Strike')
    expect(woundingContext.queries.resolveActorMoveEntry('Wounding Strike')).toMatchObject({
      ok: true, entry: { hasStab: false, script: { damageBase: 7 } },
    })
    const woundingRuntime = woundingContext.queries.rules.runtimeFor('Wounding Strike')
    expect(woundingRuntime).toMatchObject({
      kind: 'movespec-v2',
      sourceModule: 'server/domain/capabilityAutomation/weaponMoveRuntime.ts',
    })
    if (woundingRuntime?.kind !== 'movespec-v2' || !woundingRuntime.definition.registeredHandler) {
      throw new Error('Expected native Wounding Strike handler runtime.')
    }
    const handler = woundingContext.handlerRegistry.resolve(woundingRuntime.definition.registeredHandler.id)
    if (!handler) throw new Error('Expected registered capability weapon Move handler.')
    expect(executeRegisteredMoveHandler({
      registration: handler,
      expectedVersion: woundingRuntime.definition.registeredHandler.version,
      context: woundingContext,
      maximumOperations: 32,
    }).operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'damage', payload: expect.objectContaining({ damageBase: 7 }) }),
      expect.objectContaining({ kind: 'direct-hp', payload: expect.objectContaining({
        calculation: { kind: 'percent-max', percent: 10 },
      }) }),
    ]))
    expect(moveContext(small, 'Gouge').queries.resolveActorMoveEntry('Gouge')).toMatchObject({ ok: false })
    const knife = { ...small, items: { held: 'Survival Knife' } }
    expect(moveContext(knife, 'Cheap Shot').queries.resolveActorMoveEntry('Cheap Shot')).toMatchObject({
      ok: true, entry: { script: { damageBase: 6 } },
    })
    const unownedWeaponMove = pokemon(actor.sheetSlug, {
      species: 'Pikachu', movelist: [{ name: 'Wounding Strike' }],
    })
    expect(moveContext(unownedWeaponMove, 'Wounding Strike').queries.resolveActorMoveEntry('Wounding Strike'))
      .toMatchObject({ ok: false, reason: 'creature-rule-blocked' })

    const large = pokemon(actor.sheetSlug, {
      species: 'Snorlax', skills: { combat: '6d6' }, capabilities: { other: ['Wielder'] },
      items: { held: 'Meteor Masher' },
    })
    expect(moveContext(large, 'Backswing').queries.resolveActorMoveEntry('Backswing')).toMatchObject({
      ok: true,
      entry: { script: { damageBase: 9, ac: 3 } },
    })
    expect(moveContext(large, 'Titanic Slam').queries.resolveActorMoveEntry('Titanic Slam')).toMatchObject({ ok: false })
  })

  it('publishes source-owned Wielder Moves through Encounter Presentation without exposing Master grants', () => {
    const sheet = pokemon(actor.sheetSlug, {
      species: 'Snorlax', skills: { combat: '6d6' }, capabilities: { other: ['Wielder'] },
      items: { held: 'Quarterstaff' },
    })
    const projection = buildEncounterPresentationProjection({
      role: 'gm',
      map: baseMap(),
      mapRevision: 1,
      pokemonSheets: [sheet, pokemon(target.sheetSlug)],
      trainerSheets: [],
      generatedAt: 1_000,
    })
    const backswing = projection.offers.find(offer => offer.source.canonicalId === 'Backswing')
    expect(backswing).toMatchObject({
      intent: { actionId: 'move.declare' },
      availability: { status: 'available', reasons: [] },
      targeting: [expect.objectContaining({ rangeLabel: '3 meters (Reach)' })],
    })
    expect(projection.offers.some(offer => offer.source.canonicalId === 'Titanic Slam')).toBe(false)
  })

  it('grants Living Weapon Moves only through an exact source-effective link and linked wielder rank', () => {
    const wielder = pokemon(actor.sheetSlug, {
      species: 'Pikachu', skills: { combat: '4d6' }, items: { held: '' },
    })
    const weaponPlacement: SheetPlacement = {
      id: 'living-weapon', sheetKind: 'pokemon', sheetSlug: 'living-weapon-sheet',
      position: { ...actor.position }, sideId: actor.sideId,
    }
    const weapon = pokemon(weaponPlacement.sheetSlug, {
      species: 'Honedge', capabilities: { other: ['Living Weapon'] },
    })
    const victim = pokemon(target.sheetSlug)
    const unlinkedMap = baseMap({ placements: [actor, target, weaponPlacement] })
    const sourceInstance = resolveEffectiveCapabilities({
      map: unlinkedMap,
      placement: weaponPlacement,
      sheet: weapon,
      sheets: {
        pokemon: new Map([[wielder.slug, wielder], [victim.slug, victim], [weapon.slug, weapon]]),
        trainer: new Map(),
      },
    }).instances.find(instance => instance.effective && instance.canonicalId === 'Living Weapon')
    if (!sourceInstance) throw new Error('Expected Living Weapon source fixture.')
    const encounter = createEmptyEncounterState()
    const map = baseMap({
      placements: [actor, target, weaponPlacement],
      encounterState: {
        ...encounter,
        capabilityRuntime: {
          ...createEmptyCapabilityRuntimeState(),
          links: [{
            id: 'capability.link.living-weapon',
            kind: 'living-weapon',
            ownerPlacementId: weaponPlacement.id,
            participantPlacementIds: [actor.id],
            capabilityInstanceId: sourceInstance.instanceId,
            canonicalId: 'Living Weapon',
            establishedAt: 1,
            configurationId: null,
            sourceOperationId: 'operation:living-weapon',
          }],
        },
      },
    })
    const linkedContext = (actorSheet: CharacterSheet, moveName: string, livingWeaponSheet: CharacterSheet) => (
      buildAuthoritativeMoveRulesContext({
        map,
        pokemonSheets: new Map([
          [actorSheet.slug, actorSheet],
          [victim.slug, victim],
          [livingWeaponSheet.slug, livingWeaponSheet],
        ]),
        trainerSheets: new Map<string, TrainerSheet>(),
        intent: moveIntent(moveName), candidatePlacementIds: [target.id], selectedPlacementIds: [target.id],
        random: () => 0, time: 1_000,
      })
    )
    expect(linkedContext(wielder, 'Wounding Strike', weapon).queries.resolveActorMoveEntry('Wounding Strike'))
      .toMatchObject({ ok: true, entry: { hasStab: false, script: { damageBase: 7 } } })

    const activeWeaponContext = linkedContext(wielder, 'Struggle', weapon)
    const activeStruggle = activeWeaponContext.queries.resolveActorMoveEntry('Struggle')
    if (!activeStruggle.ok) throw new Error('Expected Living Weapon Struggle fixture.')
    const faintedWeaponContext = linkedContext(wielder, 'Struggle', {
      ...weapon, combat: { ...weapon.combat, currentHp: 0 },
    })
    const faintedStruggle = faintedWeaponContext.queries.resolveActorMoveEntry('Struggle')
    if (!faintedStruggle.ok) throw new Error('Expected fainted Living Weapon Struggle fixture.')
    const activeAccuracy = resolveAuthoritativeMoveUserAccuracy(activeWeaponContext, {
      script: activeStruggle.entry.script,
    })
    const faintedAccuracy = resolveAuthoritativeMoveUserAccuracy(faintedWeaponContext, {
      script: faintedStruggle.entry.script,
    })
    expect(faintedAccuracy.value).toBe(activeAccuracy.value - 2)
    expect(faintedAccuracy.modifiers).toContainEqual(expect.objectContaining({
      reason: 'Fainted Living Weapon', value: -2,
    }))

    const operation = parseMoveEffectOperation({
      id: 'living-weapon.damage',
      kind: 'damage',
      source: { kind: 'move', id: 'move.struggle' },
      recipients: { kind: 'hit-targets' },
      phase: 'damage',
      reasonCode: 'living-weapon.damage',
      payload: {
        damageClass: 'physical', damageBase: 4, moveType: 'normal',
        accuracyRollId: null, criticalRollId: null,
      },
    })
    if (operation.kind !== 'damage') throw new Error('Expected Living Weapon damage operation.')
    const resolution = {
      ...defaultTargetResolutionState(activeStruggle.entry.script),
      hit: true,
      damageRoll: { formula: 'flat', count: 0, sides: 0, rolls: [], mod: 20, total: 20 },
    }
    const activeDamage = resolveMoveSpecDamageCalculation({
      context: activeWeaponContext,
      operation,
      script: activeStruggle.entry.script,
      recipient: activeWeaponContext.queries.tokens.get(target.id)!,
      resolution,
    })
    const faintedDamage = resolveMoveSpecDamageCalculation({
      context: faintedWeaponContext,
      operation,
      script: faintedStruggle.entry.script,
      recipient: faintedWeaponContext.queries.tokens.get(target.id)!,
      resolution,
    })
    expect(faintedDamage.damagePipeline?.preTypeDamage)
      .toBe((activeDamage.damagePipeline?.preTypeDamage ?? 0) - 2)
    expect(faintedDamage.damagePipeline?.stages.flatMap(stage => stage.modifiers)).toContainEqual(
      expect.objectContaining({
        reasonCode: 'capability.living-weapon.fainted-roll-penalty',
        value: -2,
      }),
    )

    const unqualified = { ...wielder, skills: { combat: '3d6' } }
    expect(linkedContext(unqualified, 'Wounding Strike', weapon).queries.resolveActorMoveEntry('Wounding Strike'))
      .toMatchObject({ ok: false, reason: 'creature-rule-blocked' })
    const lostSource = { ...weapon, species: 'Pikachu', capabilities: { other: [] } }
    expect(linkedContext(wielder, 'Wounding Strike', lostSource).queries.resolveActorMoveEntry('Wounding Strike'))
      .toMatchObject({ ok: false, reason: 'creature-rule-blocked' })

    const masterWielder = { ...wielder, skills: { combat: '6d6' } }
    const aegislash = { ...weapon, species: 'Aegislash' }
    const aegislashSource = resolveEffectiveCapabilities({
      map: baseMap(), placement: target, sheet: aegislash,
      sheets: {
        pokemon: new Map([[masterWielder.slug, masterWielder], [aegislash.slug, aegislash]]),
        trainer: new Map(),
      },
    }).instances.find(instance => instance.effective && instance.canonicalId === 'Living Weapon')
    if (!aegislashSource) throw new Error('Expected Aegislash Living Weapon source fixture.')
    const bleedMap = baseMap({
      encounterState: {
        ...encounter,
        capabilityRuntime: {
          ...createEmptyCapabilityRuntimeState(),
          links: [{
            id: 'capability.link.aegislash', kind: 'living-weapon', ownerPlacementId: target.id,
            participantPlacementIds: [actor.id], capabilityInstanceId: aegislashSource.instanceId,
            canonicalId: 'Living Weapon', establishedAt: 1, configurationId: null,
            sourceOperationId: 'operation:aegislash',
          }],
        },
      },
    })
    const bleedContext = moveContext(masterWielder, 'Bleed!', bleedMap, aegislash)
    expect(bleedContext.queries.resolveActorMoveEntry('Bleed!')).toMatchObject({
      ok: true, entry: { script: { damageBase: 10 } },
    })
    const bleedRuntime = bleedContext.queries.rules.runtimeFor('Bleed!')
    if (bleedRuntime?.kind !== 'movespec-v2' || !bleedRuntime.definition.registeredHandler) {
      throw new Error('Expected native Bleed! runtime.')
    }
    const bleedHandler = bleedContext.handlerRegistry.resolve(bleedRuntime.definition.registeredHandler.id)
    if (!bleedHandler) throw new Error('Expected capability weapon Move handler.')
    expect(executeRegisteredMoveHandler({
      registration: bleedHandler,
      expectedVersion: bleedRuntime.definition.registeredHandler.version,
      context: bleedContext,
      maximumOperations: 32,
    }).operations).toContainEqual(expect.objectContaining({
      kind: 'temporary-effect',
      reasonCode: 'bleed.bleed-three-turns',
      payload: expect.objectContaining({
        definition: expect.objectContaining({
          duration: { kind: 'turns', subject: 'target', boundary: 'start', remaining: 3 },
          charges: 3,
        }),
      }),
    }))
  })

  it('retains one Living Weapon movement budget across both turns and resets it only next round', () => {
    const encounter = createEmptyEncounterState()
    const spentLedger = (placementId: string, spent: number) => ({
      ...createEncounterTurnResourceLedger({ placementId, round: 1, turn: 1 }),
      movement: { budget: 6, spent, resetOn: ['turn-start'] as const },
    })
    const linkedMap = baseMap({
      encounterState: {
        ...encounter,
        turnResources: { actor: spentLedger('actor', 3), target: spentLedger('target', 3) },
        capabilityRuntime: {
          ...encounter.capabilityRuntime!,
          links: [{
            id: 'capability.link.round-budget', kind: 'living-weapon', ownerPlacementId: target.id,
            participantPlacementIds: [actor.id], capabilityInstanceId: 'effective-source',
            canonicalId: 'Living Weapon', establishedAt: 1, configurationId: null,
            sourceOperationId: 'operation:engage',
          }],
        },
      },
    })
    const afterGenericTurnReset = {
      ...linkedMap.encounterState!,
      turnResources: { actor: spentLedger('actor', 0), target: spentLedger('target', 3) },
    }
    const turnStart = {
      schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
      eventId: 'event:turn-start', kind: 'turn-start' as const,
      sourceOperationId: 'operation:turn', causalParentEventId: null,
      reasonCode: 'turn-start', round: 1, turn: 2, placementId: actor.id, sideId: null,
    }
    const preserved = reconcileLivingWeaponRoundMovementResources({
      map: linkedMap,
      previous: linkedMap.encounterState!,
      current: afterGenericTurnReset,
      events: [turnStart],
    })
    expect(preserved.turnResources.actor?.movement.spent).toBe(3)
    expect(preserved.turnResources.target?.movement.spent).toBe(3)

    const roundStart = {
      schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
      eventId: 'event:round-start', kind: 'round-start' as const,
      sourceOperationId: 'operation:round', causalParentEventId: null,
      reasonCode: 'round-start', round: 2,
    }
    const reset = reconcileLivingWeaponRoundMovementResources({
      map: linkedMap,
      previous: preserved,
      current: preserved,
      events: [roundStart],
    })
    expect(reset.turnResources.actor?.movement.spent).toBe(0)
    expect(reset.turnResources.target?.movement.spent).toBe(0)
  })

  it('readies an exact Aegislash Living Weapon Light Shield with linked and source-loss-safe effects', () => {
    const wielder = pokemon(actor.sheetSlug, {
      species: 'Pikachu', skills: { combat: '6d6' }, items: { held: '' },
    })
    const aegislash = pokemon(target.sheetSlug, {
      species: 'Aegislash', capabilities: { other: ['Living Weapon'] },
      movelist: [{ name: 'Tackle' }],
    })
    const sheets = {
      pokemon: new Map([[wielder.slug, wielder], [aegislash.slug, aegislash]]),
      trainer: new Map<string, TrainerSheet>(),
    }
    const unlinkedMap = baseMap()
    const source = resolveEffectiveCapabilities({
      map: unlinkedMap, placement: target, sheet: aegislash, sheets,
    }).instances.find(instance => instance.effective && instance.canonicalId === 'Living Weapon')!
    const encounter = createEmptyEncounterState()
    const linkedMap = baseMap({
      encounterState: {
        ...encounter,
        capabilityRuntime: {
          ...encounter.capabilityRuntime!,
          links: [{
            id: 'capability.link.aegislash', kind: 'living-weapon', ownerPlacementId: target.id,
            participantPlacementIds: [actor.id], capabilityInstanceId: source.instanceId,
            canonicalId: 'Living Weapon', establishedAt: 1,
            configurationId: 'small-melee-weapon-and-light-shield', sourceOperationId: 'operation:engage',
          }],
        },
      },
    })
    const action = CAPABILITY_AUTOMATION_RUNTIME_REGISTRY.require('Living Weapon').spec.actions
      .find(entry => entry.actionId === 'ready-light-shield')!
    const readyCommand = {
      ...command('Living Weapon', 'ready-light-shield'),
      capabilityInstanceId: source.instanceId,
    }
    expect(() => validateCapabilityActionSelections({
      map: linkedMap, actor: target, actorSheet: aegislash,
      actingPlacement: actor, actingSheet: wielder,
      pokemonSheets: sheets.pokemon, trainerSheets: sheets.trainer,
      command: readyCommand, action, now: 1_000,
    })).not.toThrow()
    const readied = executeCapabilityMechanic({
      map: linkedMap, actorPlacement: target, actorSheet: aegislash, actingPlacement: actor,
      pokemonSheets: sheets.pokemon, trainerSheets: sheets.trainer,
      linkedTrainerSlugs: new Set(), command: readyCommand, action, now: 1_000,
      rollDie: () => { throw new Error('Ready Light Shield does not roll.') },
    })
    expect(readied.reasonCode).toBe('capability.living-weapon.light-shield-readied')
    expect(readied.map.encounterState?.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'numeric-modifier', affected: expect.objectContaining({ placementIds: [actor.id] }),
        payload: { attribute: 'evasion', operation: 'add', value: 2, rounding: 'none' },
        duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 2 },
      }),
      expect.objectContaining({
        kind: 'numeric-modifier',
        payload: { attribute: 'damage-reduction', operation: 'add', value: 10, rounding: 'none' },
      }),
      expect.objectContaining({ kind: 'condition', payload: expect.objectContaining({ conditionId: 'slowed' }) }),
    ]))

    const attackContext = (map: TabletopMap) => buildAuthoritativeMoveRulesContext({
      map, pokemonSheets: sheets.pokemon, trainerSheets: sheets.trainer,
      intent: {
        schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
        placementId: target.id, moveName: 'Tackle',
        selection: { kind: 'single-target', targetPlacementId: actor.id },
      },
      candidatePlacementIds: [actor.id], selectedPlacementIds: [actor.id], random: () => 0, time: 1_000,
    })
    const baselineContext = attackContext(linkedMap)
    const readiedContext = attackContext(readied.map)
    expect(readiedContext.queries.tokens.get(actor.id)?.conditions).toContain('Slowed')
    const script = readiedContext.queries.resolveActorMoveEntry('Tackle')
    if (!script.ok) throw new Error('Expected Tackle fixture for Light Shield damage.')
    const operation = parseMoveEffectOperation({
      id: 'light-shield.damage', kind: 'damage', source: { kind: 'move', id: 'move.tackle' },
      recipients: { kind: 'hit-targets' }, phase: 'damage', reasonCode: 'light-shield.damage',
      payload: {
        damageClass: 'physical', damageBase: 6, moveType: 'normal',
        accuracyRollId: null, criticalRollId: null,
      },
    })
    if (operation.kind !== 'damage') throw new Error('Expected Light Shield damage operation.')
    const resolution = {
      ...defaultTargetResolutionState(script.entry.script), hit: true,
      damageRoll: { formula: 'flat' as const, count: 0, sides: 0, rolls: [], mod: 50, total: 50 },
    }
    const baselineDamage = resolveMoveSpecDamageCalculation({
      context: baselineContext, operation, script: script.entry.script,
      recipient: baselineContext.queries.tokens.get(actor.id)!, resolution,
    })
    const readiedDamage = resolveMoveSpecDamageCalculation({
      context: readiedContext, operation, script: script.entry.script,
      recipient: readiedContext.queries.tokens.get(actor.id)!, resolution,
    })
    expect(readiedDamage.breakdown.hpLoss).toBe(baselineDamage.breakdown.hpLoss - 10)
    expect(readiedDamage.damagePipeline?.stages.flatMap(stage => stage.modifiers)).toContainEqual(
      expect.objectContaining({
        reasonCode: 'capability.living-weapon.light-shield.damage-reduction',
        operation: 'subtract', value: 10,
      }),
    )

    const firstTurnEnd = applyEncounterEffectLifecycleEvent(
      { effects: readied.map.encounterState!.effects },
      { kind: 'turn-end', placementId: actor.id },
    )
    expect(firstTurnEnd.effects.filter(effect => effect.tags.includes('capability.living-weapon.light-shield')))
      .toHaveLength(3)
    const nextTurnEnd = applyEncounterEffectLifecycleEvent(
      { effects: firstTurnEnd.effects },
      { kind: 'turn-end', placementId: actor.id },
    )
    expect(nextTurnEnd.effects.filter(effect => effect.tags.includes('capability.living-weapon.light-shield')))
      .toEqual([])

    const sourceLost = reconcileCapabilityRuntimeSourceLoss({
      map: readied.map,
      sheets: {
        pokemon: new Map([[wielder.slug, wielder], [aegislash.slug, {
          ...aegislash, species: 'Pikachu', capabilities: { other: [] },
        }]]),
        trainer: new Map(),
      },
    })
    expect(sourceLost.encounterState?.capabilityRuntime?.links).toEqual([])
    expect(sourceLost.encounterState?.effects
      .filter(effect => effect.tags.includes('capability.living-weapon.light-shield'))).toEqual([])
  })

  it('classifies numeric and template ranges as ranged for Blender and Stealth', () => {
    const sheet = pokemon(actor.sheetSlug, { capabilities: { other: ['Blender'] } })
    const action = CAPABILITY_AUTOMATION_RUNTIME_REGISTRY.require('Blender').spec.actions.find(entry => entry.actionId === 'blend')!
    const blended = executeCapabilityMechanic({
      map: baseMap(), actorPlacement: actor, actorSheet: sheet,
      pokemonSheets: new Map([[sheet.slug, sheet], [target.sheetSlug, pokemon(target.sheetSlug)]]),
      trainerSheets: new Map(), linkedTrainerSlugs: new Set(), command: command('Blender', 'blend'), action,
      now: 1_000, rollDie: () => { throw new Error('Blender does not roll.') },
    }).map
    expect(capabilityContextualTargetEvasionBonus({ map: blended, placementId: actor.id, range: '6, 1 Target' })).toBe(2)
    expect(capabilityContextualTargetEvasionBonus({ map: blended, placementId: actor.id, range: 'Cone 2' })).toBe(2)
    expect(capabilityContextualTargetEvasionBonus({ map: blended, placementId: actor.id, range: 'Melee, 1 Target' })).toBe(0)
    expect(['6, 1 Target', 'Focus Rank', 'Line 4', 'Cone 2', 'Blast 3', 'Burst 1', 'Ranged, 1 Target']
      .every(capabilityMoveRangeIsRanged)).toBe(true)
    expect(capabilityMoveRangeIsRanged('Melee, 1 Target')).toBe(false)
  })

  it('retains each Letter Press Hidden Power identity and selected attack class in authoritative Move resolution', () => {
    const sheet = pokemon(actor.sheetSlug, {
      movelist: [
        { name: 'Hidden Power [Letter Press:first]', category: 'Physical' },
        { name: 'Hidden Power [Letter Press:second]', category: 'Special' },
      ],
      capabilityCampaignState: {
        schemaVersion: 1, storedItems: [], planter: null, keystoneSynchronizations: [],
        letterPress: {
          combinedUnownCount: 2, statBonuses: {}, sourceOperationIds: ['combine'],
          hiddenPowers: [
            { sourceSheetSlug: 'first', attackStat: 'attack' },
            { sourceSheetSlug: 'second', attackStat: 'special-attack' },
          ],
        },
      },
    })
    expect(moveContext(sheet, 'Hidden Power [Letter Press:first]').queries.resolveActorMoveEntry('Hidden Power [Letter Press:first]'))
      .toMatchObject({ ok: true, entry: { canonicalMoveName: 'Hidden Power', script: { damageClass: 'Physical' } } })
    expect(moveContext(sheet, 'Hidden Power [Letter Press:second]').queries.resolveActorMoveEntry('Hidden Power [Letter Press:second]'))
      .toMatchObject({ ok: true, entry: { canonicalMoveName: 'Hidden Power', script: { damageClass: 'Special' } } })
  })

  it('requires exact suitable-rider context for a non-Trainer Mountable rider', () => {
    const mount = pokemon(actor.sheetSlug, { capabilities: { other: ['Mountable 1'] } })
    const rider = pokemon(target.sheetSlug, { species: 'Pikachu' })
    const action = CAPABILITY_AUTOMATION_RUNTIME_REGISTRY.require('Mountable X').spec.actions
      .find(entry => entry.actionId === 'accept-rider')!
    const selections = { targetPlacementIds: [target.id] }
    const baseInput = {
      map: baseMap({ metadata: { capabilityWillingTargets: [`${actor.id}:${target.id}`] } }),
      actor, actorSheet: mount, pokemonSheets: new Map([[mount.slug, mount], [rider.slug, rider]]),
      trainerSheets: new Map<string, TrainerSheet>(), command: {
        ...command('Mountable X', 'accept-rider', selections),
        capabilityInstanceId: 'capability:actor:Mountable_20X:riders-1',
      }, action, now: 1_000,
    }
    expect(() => validateCapabilityActionSelections(baseInput)).toThrow(/average Trainers|rider context/i)
    expect(() => validateCapabilityActionSelections({
      ...baseInput,
      map: { ...baseInput.map, metadata: {
        ...baseInput.map.metadata,
        capabilityContexts: [`suitable-rider:${actor.id}:${target.id}`],
      } },
    })).not.toThrow()
  })

  it('supports bounded campaign adjustments to the non-rigid Mountable guideline', () => {
    const mount = pokemon(actor.sheetSlug, { capabilities: { other: ['Mountable 1'] } })
    const rider = pokemon(target.sheetSlug, { species: 'Pikachu' })
    const secondRiderPlacement: SheetPlacement = {
      id: 'second-rider', sheetKind: 'pokemon', sheetSlug: 'second-rider-sheet',
      position: { x: 1, y: 0, z: 2 },
    }
    const secondRider = pokemon(secondRiderPlacement.sheetSlug, { species: 'Eevee' })
    const action = CAPABILITY_AUTOMATION_RUNTIME_REGISTRY.require('Mountable X').spec.actions
      .find(entry => entry.actionId === 'accept-rider')!
    const map = baseMap({
      placements: [actor, target, secondRiderPlacement],
      metadata: {
        capabilityWillingTargets: [
          `${actor.id}:${target.id}`, `${actor.id}:${secondRiderPlacement.id}`,
        ],
        capabilityContexts: [`significant-extra-weight:${actor.id}`],
        capabilityMountableOverrides: [{
          mountPlacementId: actor.id,
          riderCapacity: 2,
          allowSignificantExtraWeight: true,
          approvedRiderPlacementIds: [target.id, secondRiderPlacement.id],
        }],
      },
    })
    expect(() => validateCapabilityActionSelections({
      map, actor, actorSheet: mount,
      pokemonSheets: new Map([
        [mount.slug, mount], [rider.slug, rider], [secondRider.slug, secondRider],
      ]),
      trainerSheets: new Map<string, TrainerSheet>(),
      command: {
        ...command('Mountable X', 'accept-rider', {
          targetPlacementIds: [target.id, secondRiderPlacement.id],
        }),
        capabilityInstanceId: 'capability:actor:Mountable_20X:riders-1',
      },
      action, now: 1_000,
    })).not.toThrow()
  })

  it('treats coupled links as undirected physical presence groups', () => {
    const encounter = createEmptyEncounterState()
    const linked = baseMap({
      encounterState: {
        ...encounter,
        capabilityRuntime: {
          ...encounter.capabilityRuntime!,
          links: [{
            id: 'fusion', kind: 'viral-fusion', ownerPlacementId: actor.id, participantPlacementIds: [target.id],
            capabilityInstanceId: 'capability:actor:Viral_20Fusion:base', canonicalId: 'Viral Fusion',
            establishedAt: 1, configurationId: 'Photon Geyser', sourceOperationId: 'fusion-operation',
          }],
        },
      },
    })
    expect([...capabilityCoupledPresenceIds(linked, target.id)].sort()).toEqual(['actor', 'target'])
    const removed = removeCapabilityPresenceGroup({ map: linked, ownerPlacementId: target.id })
    expect(removed.map.placements).toEqual([])
    expect(removed.map.encounterState?.capabilityRuntime?.links).toEqual([])
  })
})
