import { createHash } from 'node:crypto'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type {
  EquipmentActionReceiptV1,
  EquipmentActionRollV1,
  ExecuteEquipmentActionCommandV1,
} from '#shared/itemAutomation/equipmentActions'
import { parseSheetEquipmentStateForOwner } from '#shared/itemAutomation/equipment'
import { parseGlueCannonState, withGlueCannonCharges } from '#shared/itemAutomation/glueCannon'
import { pokemonHpSnapshot, trainerHpSnapshot } from '~/utils/sheetSpawn'
import { applyConditionsToSheet, applyHpToSheet } from '~/utils/sheetMutations'
import { placementToSpawned } from '~/utils/placement'
import { tokenGridDistance } from '~/utils/moveAutomationRange'
import { moveAutomationUserAccuracy, resolveMoveAutomationTargetEvasion } from '~/utils/moveAutomationAccuracy'
import { resolveMoveAutomationAccuracyRoll } from '~/utils/moveAutomationResolution'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { SpawnedPokemon } from '~/types/pokemon'
import { spendEncounterMoveResourceCosts, EncounterResourceReductionError } from '../moveAutomation/reduceEncounterResources'
import type { ResolvedEquipmentGrant, ResolveEquipmentGrantsResult } from './equipmentGrants'
import {
  resolveShockCollarPairCandidates,
  shockCollarImplicitRemoteAuthority,
} from './shockCollar'
import { hasEffectiveFeature } from '../featureAutomation/effectiveFeatures'
import { activelyCommandingTrainerPlacementId } from '../moveAutomation/activePokemonCommands'
import { resolveMoveAutomationLineOfSight } from '../moveAutomation/lineOfSight'
import { resolveAuthoritativeDisplacement } from '../movement/resolveMovement'
import { applyAuthoritativeMovementMapTransition } from '../movement/applyMovementTransition'
import { moveAutomationConditionImmunitySource } from '~/utils/moveAutomationConditionImmunity'
import { gridFootprintCells } from '~/utils/gridGeometry'
import { mapMovementTerrainTagsForVoxel } from '~/utils/mapMovementTerrain'
import { ptuGridVectorDistance } from '~/utils/ptuGridDistance'
import {
  currentTrainerSnagMachineState,
  resolveLargeSnagMachineInventorySource,
  resolveSnagBallInventoryChoice,
} from './snagMachine'
import { snagLargeMachineUsesOnCampaignDay } from '#shared/itemAutomation/snagMachine'

export type DeferredEquipmentActionSheetMutation = {
  readonly kind: 'pokemon' | 'trainer'
  readonly slug: string
  readonly previous: CharacterSheet | TrainerSheet
  readonly current: CharacterSheet | TrainerSheet
}

export interface DeferredEquipmentFishingDeclaration {
  readonly requestId: string
  readonly skillCheckIntegrationId: string
  readonly waterCell: { readonly x: number, readonly y: number, readonly z: number }
  readonly campaignClockRevision: number
  readonly startedAtCampaignMinute: number
  readonly readyAtCampaignMinute: number
}

export interface DeferredEquipmentSnagDeclaration {
  readonly requestId: string
  readonly variant: 'portable' | 'large'
  readonly machineSourceInstanceId: string
  readonly machineSourceRevision: number
  readonly equipmentRevision: number | null
  readonly ballSourceInstanceId: string
  readonly ballCanonicalItemId: string
  readonly ballQuantityAtDeclaration: number
  readonly declarationRound: number | null
  readonly campaignClockRevision: number
  readonly campaignMinute: number
  readonly campaignDayIndex: number
}

export interface DeferredEquipmentActionExecution {
  readonly map: TabletopMap
  readonly sheetMutations: readonly DeferredEquipmentActionSheetMutation[]
  readonly rolls: readonly EquipmentActionRollV1[]
  readonly receipts: readonly EquipmentActionReceiptV1[]
  readonly status: 'accepted' | 'guided-pending' | 'cancelled'
  readonly fishingDeclaration?: DeferredEquipmentFishingDeclaration
  readonly snagDeclaration?: DeferredEquipmentSnagDeclaration
}

export class DeferredEquipmentActionError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'DeferredEquipmentActionError'
    this.code = code
  }
}

const fail = (code: string, message: string): never => {
  throw new DeferredEquipmentActionError(code, message)
}

const digest = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 32)
const requireSpawned = (
  value: SpawnedPokemon | null,
  code: string,
  message: string,
): SpawnedPokemon => value ?? fail(code, message)
const receipt = (
  command: ExecuteEquipmentActionCommandV1,
  kind: string,
  reasonCode: string,
  safeDetail: string | null = null,
): EquipmentActionReceiptV1 => Object.freeze({
  receiptId: `equipment-action-receipt:v1:${digest(`${command.operationId}\u0000${kind}\u0000${reasonCode}`)}`,
  kind,
  reasonCode,
  safeDetail,
})

const spendEconomy = (
  map: TabletopMap,
  command: ExecuteEquipmentActionCommandV1,
  economy: 'standard' | 'swift' | 'free',
): TabletopMap => {
  if (!map.initiative?.activeId) return map
  const encounter = parseEncounterState(map.encounterState ?? createEmptyEncounterState())
  try {
    const spent = spendEncounterMoveResourceCosts(encounter.turnResources, {
      placementId: command.actorPlacementId,
      canonicalMoveId: `Equipment:${command.actionId}`,
      resolutionId: `equipment:${command.operationId}`,
      sourceOperationId: command.operationId,
      costs: [{
        id: 'equipment.action-cost',
        phase: 'pay',
        cost: { kind: 'action-resource', resource: economy, amount: 1 },
      }],
      movementBudget: null,
      movementDistance: 0,
      round: encounter.history.currentRound ?? map.initiative?.round ?? null,
      turn: encounter.history.currentTurn?.turn ?? null,
      actedThisRound: encounter.history.actedThisRoundPlacementIds.includes(command.actorPlacementId),
    })
    return { ...map, encounterState: parseEncounterState({ ...encounter, turnResources: spent.resources }) }
  }
  catch (error) {
    if (error instanceof EncounterResourceReductionError) {
      fail('equipment-action.action-resource-unavailable', error.message)
    }
    throw error
  }
}

const requireExactSource = (input: {
  readonly command: ExecuteEquipmentActionCommandV1
  readonly source: ResolvedEquipmentGrant
  readonly actorPlacement: SheetPlacement
  readonly actorSheet: CharacterSheet | TrainerSheet
}): void => {
  if (input.source.grant.kind !== 'action'
    || input.source.grant.actionId !== input.command.actionId
    || input.source.grant.executionStatus !== 'native'
    || input.source.instanceId !== input.command.equipmentInstanceId
    || input.source.instanceRevision !== input.command.equipmentInstanceRevision) {
    fail('equipment-action.source-stale', 'The exact equipped action source is stale or unavailable.')
  }
  if (input.command.actionId === 'equipment.snag-machine.convert'
    && input.source.instanceId.startsWith('item-instance:')) {
    if (input.actorPlacement.sheetKind !== 'trainer'
      || input.source.canonicalItemId !== 'Snag Machine'
      || input.source.instanceRevision !== Number(input.actorSheet.revision)
      || !resolveLargeSnagMachineInventorySource({
        sheet: input.actorSheet as TrainerSheet,
        sourceInstanceId: input.source.instanceId,
      })) fail('equipment-action.source-stale', 'The exact Large Snag Machine inventory source is unavailable.')
    return
  }
  const state = parseSheetEquipmentStateForOwner(input.actorSheet.equipmentState, {
    kind: input.actorPlacement.sheetKind,
    slug: input.actorPlacement.sheetSlug,
  })
  if (!state.instances.some(instance => (
    instance.instanceId === input.source.instanceId
    && instance.revision === input.source.instanceRevision
    && instance.activity.status === 'active'
  ))) fail('equipment-action.source-stale', 'The exact equipped whole-item custody is unavailable.')
}

const shieldEffects = (input: {
  readonly command: ExecuteEquipmentActionCommandV1
  readonly source: ResolvedEquipmentGrant
  readonly map: TabletopMap
}): readonly EncounterEffect[] => {
  const heavy = input.command.actionId === 'equipment.heavy-shield.ready'
  const sourceKey = digest(input.source.instanceId)
  const tag = `equipment.shield.ready:${sourceKey}`
  const encounter = parseEncounterState(input.map.encounterState ?? createEmptyEncounterState())
  const base = {
    source: {
      operationId: input.command.operationId,
      moveId: input.command.actionId,
      placementId: input.command.actorPlacementId,
    },
    affected: { placementIds: [input.command.actorPlacementId], sideIds: [], cells: [] },
    createdRound: Math.max(1, encounter.history.currentRound ?? input.map.initiative?.round ?? 1),
    createdTurn: Math.max(0, encounter.history.currentTurn?.turn ?? 0),
    duration: { kind: 'turns' as const, subject: 'target' as const, boundary: 'end' as const, remaining: 2 },
    stacks: 1,
    charges: null,
    stackPolicy: { kind: 'replace' as const, maxStacks: null },
    chargePolicy: { kind: 'none' as const, amount: null },
    tags: ['equipment-action', 'equipment.shield.ready', tag],
    dispel: { policy: 'matching-tags' as const, tags: [tag] },
    transferPolicy: 'expire' as const,
    suppression: { sources: [] },
  }
  return Object.freeze([
    {
      ...base,
      id: `equipment.shield.ready.evasion:${sourceKey}`,
      kind: 'numeric-modifier' as const,
      payload: { attribute: 'evasion' as const, operation: 'add' as const, value: heavy ? 4 : 2, rounding: 'none' as const },
    },
    {
      ...base,
      id: `equipment.shield.ready.damage-reduction:${sourceKey}`,
      kind: 'numeric-modifier' as const,
      payload: { attribute: 'damage-reduction' as const, operation: 'add' as const, value: heavy ? 15 : 10, rounding: 'none' as const },
    },
    {
      ...base,
      id: `equipment.shield.ready.slowed:${sourceKey}`,
      kind: 'condition' as const,
      payload: { conditionId: 'slowed', action: 'apply' as const, saveTiming: null },
    },
  ])
}

const WEIGHTED_NET_STATUS_SCRIPT = Object.freeze({
  ac: 8,
  damageClass: 'Status',
  criticalRange: 20,
  damaging: false,
}) as MoveAutomationScript

const executeWeightedNetThrow = (input: {
  readonly command: ExecuteEquipmentActionCommandV1
  readonly source: ResolvedEquipmentGrant
  readonly map: TabletopMap
  readonly actorPlacement: SheetPlacement
  readonly actorSheet: CharacterSheet | TrainerSheet
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly rollD20: (rollId: string) => EquipmentActionRollV1
}): DeferredEquipmentActionExecution => {
  if (input.command.targetPlacementIds.length !== 1 || input.command.cells.length > 0) {
    fail('weighted-net.target-required', 'Weighted Net throw requires exactly one Pokémon target.')
  }
  const sourceKey = digest(input.source.instanceId)
  const sourceTag = `equipment.weighted-net.source:${sourceKey}`
  if ((input.map.encounterState?.effects ?? []).some(effect => effect.tags.includes(sourceTag))) {
    fail('weighted-net.already-deployed', 'This exact Weighted Net is already deployed.')
  }
  const targetPlacement = input.map.placements.find(placement => placement.id === input.command.targetPlacementIds[0])
    ?? fail('weighted-net.target-stale', 'The Weighted Net target is no longer present.')
  if (targetPlacement.sheetKind !== 'pokemon') fail('weighted-net.target-not-pokemon', 'Weighted Nets can target only a Pokémon.')
  const targetSheet = input.pokemonSheets.get(targetPlacement.sheetSlug)
    ?? fail('weighted-net.target-stale', 'The Weighted Net target sheet is unavailable.')
  void targetSheet
  const lookup = { pokemon: new Map(input.pokemonSheets), trainer: new Map(input.trainerSheets) }
  const actorToken = requireSpawned(
    placementToSpawned(input.actorPlacement, lookup, input.map),
    'weighted-net.target-stale', 'Weighted Net actor geometry is unavailable.',
  )
  const targetToken = requireSpawned(
    placementToSpawned(targetPlacement, lookup, input.map),
    'weighted-net.target-stale', 'Weighted Net target geometry is unavailable.',
  )
  if (tokenGridDistance(actorToken, targetToken) > 4) {
    fail('weighted-net.target-out-of-range', 'Weighted Net targets must be within 4 meters.')
  }
  const sightPlacements = input.map.placements.flatMap((placement) => {
    const token = placementToSpawned(placement, lookup, input.map)
    return token ? [{ id: placement.id, position: placement.position, base: token.base, clearance: token.clearance }] : []
  })
  const sight = resolveMoveAutomationLineOfSight({
    voxels: input.map.voxels,
    placements: sightPlacements,
    sourcePlacementId: input.actorPlacement.id,
    targetPlacementId: targetPlacement.id,
  })
  if (!sight.targetable) fail('weighted-net.line-of-sight-blocked', 'Weighted Net requires authoritative line of sight.')
  const baseRoll = input.rollD20('accuracy')
  const modifier = moveAutomationUserAccuracy(actorToken) + sight.accuracyModifier
  const targetEvasion = resolveMoveAutomationTargetEvasion(WEIGHTED_NET_STATUS_SCRIPT, targetToken, {
    attacker: actorToken,
  }).value
  const accuracy = resolveMoveAutomationAccuracyRoll(WEIGHTED_NET_STATUS_SCRIPT, baseRoll.naturalResult, {
    userAccuracy: modifier,
    targetEvasion,
  })
  const roll: EquipmentActionRollV1 = Object.freeze({
    ...baseRoll,
    modifier,
    total: baseRoll.naturalResult + modifier,
  })
  let map = spendEconomy(input.map, input.command, 'standard')
  if (accuracy.hit) {
    const encounter = parseEncounterState(map.encounterState ?? createEmptyEncounterState())
    const common = {
      source: { operationId: input.command.operationId, moveId: input.command.actionId, placementId: input.actorPlacement.id },
      affected: { placementIds: [targetPlacement.id], sideIds: [], cells: [] },
      createdRound: Math.max(1, encounter.history.currentRound ?? map.initiative?.round ?? 1),
      createdTurn: Math.max(0, encounter.history.currentTurn?.turn ?? 0),
      duration: { kind: 'until-triggered' as const, remaining: null },
      stacks: 1,
      charges: null,
      stackPolicy: { kind: 'replace' as const, maxStacks: null },
      chargePolicy: { kind: 'none' as const, amount: null },
      tags: ['equipment-action', 'equipment.restraint', 'equipment.weighted-net', 'netted', 'capture-roll-modifier.minus-20', sourceTag],
      dispel: { policy: 'matching-tags' as const, tags: [sourceTag, 'equipment.restraint'] },
      transferPolicy: 'expire' as const,
      suppression: { sources: [] },
    }
    const effects: EncounterEffect[] = [{
      ...common,
      id: `equipment.weighted-net.netted:${sourceKey}`,
      kind: 'capability',
      payload: { capabilityId: 'equipment.restraint.netted', action: 'grant' },
    }, {
      ...common,
      id: `equipment.weighted-net.slowed:${sourceKey}`,
      kind: 'condition',
      payload: { conditionId: 'slowed', action: 'apply', saveTiming: null },
    }, {
      ...common,
      id: `equipment.weighted-net.suppress-sky:${sourceKey}`,
      kind: 'capability',
      payload: { capabilityId: 'movement.sky', action: 'suppress' },
    }, {
      ...common,
      id: `equipment.weighted-net.suppress-levitate:${sourceKey}`,
      kind: 'capability',
      payload: { capabilityId: 'movement.levitate', action: 'suppress' },
    }]
    map = { ...map, encounterState: parseEncounterState({ ...encounter, effects: [...encounter.effects, ...effects] }) }
  }
  return Object.freeze({
    map,
    sheetMutations: [],
    rolls: Object.freeze([roll]),
    receipts: Object.freeze([
      receipt(input.command, 'item-declaration', 'equipment.weighted-net.throw-declared'),
      receipt(input.command, 'accuracy', accuracy.hit ? 'equipment.weighted-net.hit' : 'equipment.weighted-net.miss'),
      receipt(input.command, 'restraint', accuracy.hit ? 'equipment.weighted-net.netted' : 'equipment.weighted-net.no-restraint'),
      receipt(input.command, 'accepted-result', 'equipment.weighted-net.throw-accepted'),
    ]),
    status: 'accepted',
  })
}

const executeWeightedNetPull = (input: {
  readonly command: ExecuteEquipmentActionCommandV1
  readonly source: ResolvedEquipmentGrant
  readonly map: TabletopMap
  readonly actorPlacement: SheetPlacement
  readonly actorSheet: CharacterSheet | TrainerSheet
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
}): DeferredEquipmentActionExecution => {
  if (input.command.targetPlacementIds.length !== 1 || input.command.cells.length > 0) {
    fail('weighted-net.pull-target-required', 'Weighted Net pull requires exactly one netted target.')
  }
  const targetId = input.command.targetPlacementIds[0]!
  const targetPlacement = input.map.placements.find(placement => placement.id === targetId)
    ?? fail('weighted-net.target-stale', 'The Weighted Net target is no longer present.')
  const sourceTag = `equipment.weighted-net.source:${digest(input.source.instanceId)}`
  const restraint = (input.map.encounterState?.effects ?? []).find(effect => (
    effect.kind === 'capability'
    && effect.payload.capabilityId === 'equipment.restraint.netted'
    && effect.tags.includes('equipment.weighted-net')
    && effect.tags.includes(sourceTag)
    && effect.affected.placementIds.includes(targetId)
    && effect.suppression.sources.length === 0
    && (effect.duration.remaining === null || effect.duration.remaining > 0)
  ))
  if (!restraint) fail('weighted-net.target-not-netted-by-source', 'The selected target is not netted by this exact source.')
  const vector = {
    x: Math.sign(input.actorPlacement.position.x - targetPlacement.position.x),
    y: Math.sign(input.actorPlacement.position.y - targetPlacement.position.y),
    z: Math.sign(input.actorPlacement.position.z - targetPlacement.position.z),
  }
  const displacementResult = resolveAuthoritativeDisplacement({
    map: input.map,
    sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
    placementId: targetId,
    movementMode: 'forced',
    vector,
    requestedDistance: 1,
    distancePolicy: 'full-distance-required',
  })
  const displacement = displacementResult.ok
    ? displacementResult
    : fail('weighted-net.pull-blocked', displacementResult.message)
  if (displacement.resolvedDistance !== 1) {
    fail('weighted-net.pull-blocked', 'Weighted Net could not pull the target a full meter.')
  }
  const encounter = parseEncounterState(input.map.encounterState ?? createEmptyEncounterState())
  const moved = applyAuthoritativeMovementMapTransition({
    map: input.map,
    placementId: targetId,
    destination: displacement.destination,
    distance: displacement.resolvedDistance,
    encounterState: encounter,
    timestamp: input.map.updatedAt ?? 0,
    userName: targetPlacement.sheetSlug,
    movementEvidence: {
      operationId: input.command.operationId,
      path: displacement.path,
      mode: 'forced',
    },
  }).nextMap
  const map = spendEconomy(moved, input.command, 'standard')
  return Object.freeze({
    map,
    sheetMutations: [],
    rolls: [],
    receipts: Object.freeze([
      receipt(input.command, 'item-declaration', 'equipment.weighted-net.pull-declared'),
      receipt(input.command, 'forced-movement', 'equipment.weighted-net.pulled-one-meter'),
      receipt(input.command, 'accepted-result', 'equipment.weighted-net.pull-accepted'),
    ]),
    status: 'accepted',
  })
}

const HAND_NET_STATUS_SCRIPT = Object.freeze({
  ac: 6,
  damageClass: 'Status',
  criticalRange: 20,
  damaging: false,
}) as MoveAutomationScript

const executeHandNet = (input: {
  readonly command: ExecuteEquipmentActionCommandV1
  readonly source: ResolvedEquipmentGrant
  readonly map: TabletopMap
  readonly actorPlacement: SheetPlacement
  readonly actorSheet: CharacterSheet | TrainerSheet
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly rollD20: (rollId: string) => EquipmentActionRollV1
}): DeferredEquipmentActionExecution => {
  if (input.command.targetPlacementIds.length !== 1 || input.command.cells.length > 0) {
    fail('hand-net.target-required', 'Hand Net requires exactly one Pokémon target.')
  }
  const targetPlacement = input.map.placements.find(placement => placement.id === input.command.targetPlacementIds[0])
    ?? fail('hand-net.target-stale', 'The Hand Net target is no longer present.')
  if (targetPlacement.sheetKind !== 'pokemon') fail('hand-net.target-not-pokemon', 'Hand Net can target only a Pokémon.')
  if (!input.pokemonSheets.has(targetPlacement.sheetSlug)) {
    fail('hand-net.target-stale', 'The Hand Net target sheet is unavailable.')
  }
  const lookup = { pokemon: new Map(input.pokemonSheets), trainer: new Map(input.trainerSheets) }
  const actorToken = requireSpawned(
    placementToSpawned(input.actorPlacement, lookup, input.map),
    'hand-net.target-stale', 'Hand Net actor geometry is unavailable.',
  )
  const targetToken = requireSpawned(
    placementToSpawned(targetPlacement, lookup, input.map),
    'hand-net.target-stale', 'Hand Net target geometry is unavailable.',
  )
  if (targetToken.creatureRules?.size !== 'small') {
    fail('hand-net.target-not-small', 'Hand Net can net only a Small Pokémon.')
  }
  if (tokenGridDistance(actorToken, targetToken) > 1) {
    fail('hand-net.target-out-of-range', 'Hand Net targets must be adjacent within 1 meter.')
  }
  const sightPlacements = input.map.placements.flatMap((placement) => {
    const token = placementToSpawned(placement, lookup, input.map)
    return token ? [{ id: placement.id, position: placement.position, base: token.base, clearance: token.clearance }] : []
  })
  const sight = resolveMoveAutomationLineOfSight({
    voxels: input.map.voxels,
    placements: sightPlacements,
    sourcePlacementId: input.actorPlacement.id,
    targetPlacementId: targetPlacement.id,
  })
  if (!sight.targetable) fail('hand-net.line-of-sight-blocked', 'Hand Net requires authoritative line of sight.')
  const baseRoll = input.rollD20('accuracy')
  const modifier = moveAutomationUserAccuracy(actorToken) + sight.accuracyModifier
  const targetEvasion = resolveMoveAutomationTargetEvasion(HAND_NET_STATUS_SCRIPT, targetToken, {
    attacker: actorToken,
  }).value
  const accuracy = resolveMoveAutomationAccuracyRoll(HAND_NET_STATUS_SCRIPT, baseRoll.naturalResult, {
    userAccuracy: modifier,
    targetEvasion,
  })
  const roll: EquipmentActionRollV1 = Object.freeze({
    ...baseRoll,
    modifier,
    total: baseRoll.naturalResult + modifier,
  })
  let map = spendEconomy(input.map, input.command, 'standard')
  let restrained = false
  if (accuracy.hit && moveAutomationConditionImmunitySource('trapped', targetToken) === null) {
    const encounter = parseEncounterState(map.encounterState ?? createEmptyEncounterState())
    const sourceKey = digest(input.source.instanceId)
    const sourceTag = `equipment.hand-net.source:${sourceKey}`
    const common = {
      source: {
        operationId: input.command.operationId,
        moveId: input.command.actionId,
        placementId: input.actorPlacement.id,
      },
      affected: { placementIds: [targetPlacement.id], sideIds: [], cells: [] },
      createdRound: Math.max(1, encounter.history.currentRound ?? map.initiative?.round ?? 1),
      createdTurn: Math.max(0, encounter.history.currentTurn?.turn ?? 0),
      duration: { kind: 'until-triggered' as const, remaining: null },
      stacks: 1,
      charges: null,
      stackPolicy: { kind: 'replace' as const, maxStacks: null },
      chargePolicy: { kind: 'none' as const, amount: null },
      tags: ['equipment-action', 'equipment.restraint', 'equipment.hand-net', 'netted', 'capture-roll-modifier.minus-20', sourceTag],
      dispel: { policy: 'matching-tags' as const, tags: [sourceTag, 'equipment.restraint'] },
      transferPolicy: 'expire' as const,
      suppression: { sources: [] },
    }
    const effects: EncounterEffect[] = [{
      ...common,
      id: `equipment.hand-net.netted:${sourceKey}`,
      kind: 'capability',
      payload: { capabilityId: 'equipment.restraint.netted', action: 'grant' },
    }, {
      ...common,
      id: `equipment.hand-net.trapped:${sourceKey}`,
      kind: 'condition',
      payload: { conditionId: 'trapped', action: 'apply', saveTiming: null },
    }]
    const retained = encounter.effects.filter(effect => !effect.tags.includes(sourceTag))
    map = { ...map, encounterState: parseEncounterState({ ...encounter, effects: [...retained, ...effects] }) }
    restrained = true
  }
  return Object.freeze({
    map,
    sheetMutations: [],
    rolls: Object.freeze([roll]),
    receipts: Object.freeze([
      receipt(input.command, 'item-declaration', 'equipment.hand-net.declared'),
      receipt(input.command, 'accuracy', accuracy.hit ? 'equipment.hand-net.hit' : 'equipment.hand-net.miss'),
      receipt(input.command, 'restraint', restrained
        ? 'equipment.hand-net.netted'
        : accuracy.hit ? 'equipment.hand-net.target-immune' : 'equipment.hand-net.no-restraint'),
      receipt(input.command, 'accepted-result', 'equipment.hand-net.accepted'),
    ]),
    status: 'accepted',
  })
}

const GLUE_CANNON_STATUS_SCRIPT = Object.freeze({
  ac: 8,
  damageClass: 'Status',
  criticalRange: 20,
  damaging: false,
}) as MoveAutomationScript

const executeGlueCannon = (input: {
  readonly command: ExecuteEquipmentActionCommandV1
  readonly source: ResolvedEquipmentGrant
  readonly map: TabletopMap
  readonly actorPlacement: SheetPlacement
  readonly actorSheet: CharacterSheet | TrainerSheet
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly rollD20: (rollId: string) => EquipmentActionRollV1
}): DeferredEquipmentActionExecution => {
  if (input.command.targetPlacementIds.length !== 1 || input.command.cells.length > 0) {
    fail('glue-cannon.target-required', 'Glue Cannon requires exactly one participant target.')
  }
  const targetPlacement = input.map.placements.find(placement => placement.id === input.command.targetPlacementIds[0])
    ?? fail('glue-cannon.target-stale', 'The Glue Cannon target is no longer present.')
  const targetSheet = targetPlacement.sheetKind === 'pokemon'
    ? input.pokemonSheets.get(targetPlacement.sheetSlug)
    : input.trainerSheets.get(targetPlacement.sheetSlug)
  if (!targetSheet) fail('glue-cannon.target-stale', 'The Glue Cannon target sheet is unavailable.')
  const lookup = { pokemon: new Map(input.pokemonSheets), trainer: new Map(input.trainerSheets) }
  const actorToken = requireSpawned(
    placementToSpawned(input.actorPlacement, lookup, input.map),
    'glue-cannon.target-stale', 'Glue Cannon actor geometry is unavailable.',
  )
  const targetToken = requireSpawned(
    placementToSpawned(targetPlacement, lookup, input.map),
    'glue-cannon.target-stale', 'Glue Cannon target geometry is unavailable.',
  )
  if (tokenGridDistance(actorToken, targetToken) > 4) {
    fail('glue-cannon.target-out-of-range', 'Glue Cannon targets must be within 4 meters.')
  }
  const sightPlacements = input.map.placements.flatMap((placement) => {
    const token = placementToSpawned(placement, lookup, input.map)
    return token ? [{
      id: placement.id,
      position: placement.position,
      base: token.base,
      clearance: token.clearance,
    }] : []
  })
  const sight = resolveMoveAutomationLineOfSight({
    voxels: input.map.voxels,
    placements: sightPlacements,
    sourcePlacementId: input.actorPlacement.id,
    targetPlacementId: targetPlacement.id,
  })
  if (!sight.targetable) fail('glue-cannon.line-of-sight-blocked', 'Glue Cannon requires authoritative line of sight.')

  const equipmentState = parseSheetEquipmentStateForOwner(input.actorSheet.equipmentState, {
    kind: input.actorPlacement.sheetKind,
    slug: input.actorPlacement.sheetSlug,
  })
  const instance = equipmentState.instances.find(candidate => candidate.instanceId === input.source.instanceId)
    ?? fail('equipment-action.source-stale', 'The exact Glue Cannon instance is unavailable.')
  let cannonState: ReturnType<typeof parseGlueCannonState>
  try { cannonState = parseGlueCannonState(instance.serializedState) }
  catch { return fail('glue-cannon.state-malformed', 'Glue Cannon charge state is malformed.') }
  if (cannonState.charges < 1) fail('glue-cannon.no-charge', 'Glue Cannon has no charge packet remaining.')

  const baseRoll = input.rollD20('accuracy')
  const modifier = moveAutomationUserAccuracy(actorToken) + sight.accuracyModifier
  const targetEvasion = resolveMoveAutomationTargetEvasion(GLUE_CANNON_STATUS_SCRIPT, targetToken, {
    attacker: actorToken,
  }).value
  const accuracy = resolveMoveAutomationAccuracyRoll(GLUE_CANNON_STATUS_SCRIPT, baseRoll.naturalResult, {
    userAccuracy: modifier,
    targetEvasion,
  })
  const roll: EquipmentActionRollV1 = Object.freeze({
    ...baseRoll,
    modifier,
    total: baseRoll.naturalResult + modifier,
  })
  const updatedEquipmentState = {
    ...equipmentState,
    revision: equipmentState.revision + 1,
    instances: equipmentState.instances.map(candidate => candidate.instanceId === instance.instanceId
      ? {
          ...candidate,
          revision: candidate.revision + 1,
          serializedState: withGlueCannonCharges(candidate.serializedState, cannonState.charges - 1),
        }
      : candidate),
  }
  const updatedActorSheet = {
    ...input.actorSheet,
    equipmentState: parseSheetEquipmentStateForOwner(updatedEquipmentState, {
      kind: input.actorPlacement.sheetKind,
      slug: input.actorPlacement.sheetSlug,
    }),
  } as CharacterSheet | TrainerSheet
  let map = spendEconomy(input.map, input.command, 'standard')
  let conditionIds: readonly ('slowed' | 'stuck' | 'trapped')[] = []
  if (accuracy.hit) {
    conditionIds = accuracy.crit ? ['stuck', 'trapped'] : ['slowed']
    conditionIds = conditionIds.filter(conditionId => (
      moveAutomationConditionImmunitySource(conditionId, targetToken) === null
    ))
    if (conditionIds.length > 0) {
      const encounter = parseEncounterState(map.encounterState ?? createEmptyEncounterState())
      const effects: EncounterEffect[] = conditionIds.map((conditionId, index) => ({
        id: `equipment.glue-cannon.${conditionId}:${digest(`${input.command.operationId}:${targetPlacement.id}:${index}`)}`,
        kind: 'condition',
        source: {
          operationId: input.command.operationId,
          moveId: input.command.actionId,
          placementId: input.actorPlacement.id,
        },
        affected: { placementIds: [targetPlacement.id], sideIds: [], cells: [] },
        createdRound: Math.max(1, encounter.history.currentRound ?? map.initiative?.round ?? 1),
        createdTurn: Math.max(0, encounter.history.currentTurn?.turn ?? 0),
        duration: { kind: 'scene', remaining: null },
        stacks: 1,
        charges: null,
        stackPolicy: { kind: 'replace', maxStacks: null },
        chargePolicy: { kind: 'none', amount: null },
        tags: ['equipment-action', 'equipment.glue-cannon', conditionId],
        payload: { conditionId, action: 'apply', saveTiming: null },
        dispel: { policy: 'matching-tags', tags: ['equipment.glue-cannon', conditionId] },
        transferPolicy: 'expire',
        suppression: { sources: [] },
      }))
      map = { ...map, encounterState: parseEncounterState({ ...encounter, effects: [...encounter.effects, ...effects] }) }
    }
  }
  return Object.freeze({
    map,
    sheetMutations: Object.freeze([{
      kind: input.actorPlacement.sheetKind,
      slug: input.actorPlacement.sheetSlug,
      previous: input.actorSheet,
      current: updatedActorSheet,
    }]),
    rolls: Object.freeze([roll]),
    receipts: Object.freeze([
      receipt(input.command, 'item-declaration', 'equipment.glue-cannon.declared'),
      receipt(input.command, 'charge-consumption', 'equipment.glue-cannon.charge-consumed'),
      receipt(input.command, 'accuracy', accuracy.hit
        ? accuracy.crit ? 'equipment.glue-cannon.critical-hit' : 'equipment.glue-cannon.hit'
        : 'equipment.glue-cannon.miss'),
      receipt(input.command, 'condition', conditionIds.length > 0
        ? `equipment.glue-cannon.${conditionIds.join('-')}`
        : accuracy.hit ? 'equipment.glue-cannon.condition-immune' : 'equipment.glue-cannon.no-condition'),
      receipt(input.command, 'accepted-result', 'equipment.glue-cannon.accepted'),
    ]),
    status: 'accepted',
  })
}

const executeShockCollar = (input: {
  readonly command: ExecuteEquipmentActionCommandV1
  readonly source: ResolvedEquipmentGrant
  readonly map: TabletopMap
  readonly actorPlacement: SheetPlacement
  readonly actorSheet: CharacterSheet | TrainerSheet
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly equipmentGrantsForPlacement: (placementId: string) => ResolveEquipmentGrantsResult | null
}): DeferredEquipmentActionExecution => {
  if (input.command.targetPlacementIds.length !== 1 || input.command.cells.length > 0) {
    fail('shock-collar.target-required', 'Shock Collar activation requires exactly one paired wearer.')
  }
  const targetId = input.command.targetPlacementIds[0]!
  const targetPlacement = input.map.placements.find(placement => placement.id === targetId)
  const targetSheet = targetPlacement?.sheetKind === 'pokemon'
    ? input.pokemonSheets.get(targetPlacement.sheetSlug)
    : targetPlacement ? input.trainerSheets.get(targetPlacement.sheetSlug) : null
  const implicit = targetPlacement && targetSheet
    && input.source.instanceId === input.command.targetEquipmentInstanceId
    ? shockCollarImplicitRemoteAuthority({
        placement: targetPlacement,
        sheet: targetSheet,
        collarSource: input.source,
      })
    : null
  const candidateResult = implicit
    && input.actorPlacement.sheetKind === 'trainer'
    && input.actorPlacement.sheetSlug === implicit.holderTrainerSlug
    && input.command.equipmentInstanceId === implicit.remoteInstanceId
    && input.command.equipmentInstanceRevision === implicit.remoteInstanceRevision
    ? {
        placement: targetPlacement!,
        sheet: targetSheet!,
        source: input.source,
        pair: { schemaVersion: 1 as const, role: 'collar' as const, pairId: implicit.remoteInstanceId, groundCapable: implicit.groundCapable },
      }
    : resolveShockCollarPairCandidates({
        map: input.map,
        actorPlacement: input.actorPlacement,
        actorSheet: input.actorSheet,
        remoteSource: input.source,
        pokemonSheets: input.pokemonSheets,
        trainerSheets: input.trainerSheets,
        grantsForPlacement: input.equipmentGrantsForPlacement,
      }).find(entry => entry.placement.id === targetId)
  const candidate = candidateResult
    ?? fail('shock-collar.target-not-wearing-source', 'The selected wearer no longer has the exact paired collar active.')
  if (candidate.source.instanceId !== input.command.targetEquipmentInstanceId
    || candidate.source.instanceRevision !== input.command.targetEquipmentInstanceRevision) {
    fail('shock-collar.target-not-wearing-source', 'The selected wearer no longer has the exact paired collar active.')
  }
  const token = placementToSpawned(candidate.placement, {
    pokemon: new Map(input.pokemonSheets),
    trainer: new Map(input.trainerSheets),
  }, input.map)
  if (token?.creatureRules?.typeIds.some(type => type.toLocaleLowerCase('en-US') === 'ground')
    && !candidate.pair.groundCapable) {
    fail('shock-collar.ground-variant-required', 'This paired collar is not the Ground-capable variant.')
  }
  const snapshot = candidate.placement.sheetKind === 'pokemon'
    ? pokemonHpSnapshot(candidate.sheet as CharacterSheet)
    : trainerHpSnapshot(candidate.sheet as TrainerSheet)
  const hpLoss = Math.max(1, Math.floor(snapshot.fullMaxHp / 6))
  let current = applyHpToSheet(
    candidate.placement.sheetKind,
    candidate.sheet,
    snapshot.currentHp - hpLoss,
    snapshot.injuries,
  )
  // Active HP loss wakes Sleep under the canonical status rules.
  if (snapshot.conditions.some(condition => condition.toLocaleLowerCase('en-US') === 'sleep')) {
    current = applyConditionsToSheet(
      candidate.placement.sheetKind,
      current,
      snapshot.conditions.filter(condition => condition.toLocaleLowerCase('en-US') !== 'sleep'),
    )
  }
  const pressTriggered = input.actorPlacement.sheetKind === 'trainer'
    && candidate.placement.sheetKind === 'pokemon'
    && hasEffectiveFeature(input.actorSheet as TrainerSheet, 'Press')
    && activelyCommandingTrainerPlacementId({ map: input.map, pokemonPlacementId: candidate.placement.id })
      === input.actorPlacement.id
  const spentMap = spendEconomy(input.map, input.command, 'standard')
  return Object.freeze({
    map: spentMap,
    sheetMutations: Object.freeze([{
      kind: candidate.placement.sheetKind,
      slug: candidate.placement.sheetSlug,
      previous: candidate.sheet,
      current,
    }]),
    rolls: [],
    receipts: Object.freeze([
      receipt(input.command, 'item-declaration', 'equipment.shock-collar.declared'),
      receipt(input.command, 'hp-loss', 'equipment.shock-collar.hp-loss', `${hpLoss} HP`),
      receipt(input.command, 'feature-trigger-fact', pressTriggered
        ? 'equipment.shock-collar.press-triggered'
        : 'equipment.shock-collar.press-not-triggered'),
      receipt(input.command, 'accepted-result', 'equipment.shock-collar.accepted'),
    ]),
    status: 'accepted',
  })
}

const executeShieldReady = (input: {
  readonly command: ExecuteEquipmentActionCommandV1
  readonly source: ResolvedEquipmentGrant
  readonly map: TabletopMap
}): DeferredEquipmentActionExecution => {
  if (input.command.targetPlacementIds.length > 0 || input.command.cells.length > 0) {
    fail('shield.invalid-target', 'Shield readying targets only the equipped actor.')
  }
  const spentMap = spendEconomy(input.map, input.command, 'standard')
  const encounter = parseEncounterState(spentMap.encounterState ?? createEmptyEncounterState())
  const sourceKey = digest(input.source.instanceId)
  const retained = encounter.effects.filter(effect => !(
    effect.tags.includes('equipment.shield.ready')
    && effect.affected.placementIds.includes(input.command.actorPlacementId)
    && effect.tags.includes(`equipment.shield.ready:${sourceKey}`)
  ))
  const effects = shieldEffects({ ...input, map: spentMap })
  return Object.freeze({
    map: {
      ...spentMap,
      encounterState: parseEncounterState({ ...encounter, effects: [...retained, ...effects] }),
    },
    sheetMutations: [],
    rolls: [],
    receipts: Object.freeze([
      receipt(input.command, 'item-declaration', 'equipment.shield.ready.declared'),
      receipt(input.command, 'duration-effect', 'equipment.shield.ready.applied'),
      receipt(input.command, 'accepted-result', 'equipment.shield.ready.accepted'),
    ]),
    status: 'accepted',
  })
}

const executeFishingDeclaration = (input: {
  readonly command: ExecuteEquipmentActionCommandV1
  readonly source: ResolvedEquipmentGrant
  readonly map: TabletopMap
  readonly actorPlacement: SheetPlacement
  readonly actorSheet: CharacterSheet | TrainerSheet
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly campaignClock: { readonly revision: number, readonly campaignMinute: number } | null
}): DeferredEquipmentActionExecution => {
  const expectedItem = input.command.actionId === 'equipment.fishing.old-rod' ? 'Old Rod'
    : input.command.actionId === 'equipment.fishing.good-rod' ? 'Good Rod' : 'Super Rod'
  if (input.source.canonicalItemId !== expectedItem) {
    fail('fishing.source-mismatch', 'The exact fishing rod does not match the declared fishing action.')
  }
  if (input.command.targetPlacementIds.length > 0 || input.command.cells.length !== 1
    || input.command.targetEquipmentInstanceId !== null
    || input.command.targetEquipmentInstanceRevision !== null
    || input.command.inventorySourceInstanceId !== null
    || input.command.skillCheckId !== null
    || input.command.gmAdjudication !== null) {
    fail('fishing.declaration-shape-invalid', 'Fishing declaration requires exactly one water cell and no outcome fields.')
  }
  const equipment = parseSheetEquipmentStateForOwner(input.actorSheet.equipmentState, {
    kind: input.actorPlacement.sheetKind,
    slug: input.actorPlacement.sheetSlug,
  })
  const occupiedHandSlots = new Set(equipment.slots
    .filter(slot => slot.instanceId === input.source.instanceId)
    .map(slot => slot.slotId))
  if (!occupiedHandSlots.has('mainHand') || !occupiedHandSlots.has('offHand')) {
    fail('fishing.two-hands-required', 'Fishing requires this exact rod to occupy both hand slots.')
  }
  const cell = input.command.cells[0]!
  if (cell.x < 0 || cell.x >= input.map.dimensions.x
    || cell.y < 0 || cell.y >= input.map.dimensions.y
    || cell.z < 0 || cell.z >= input.map.dimensions.z) {
    fail('fishing.water-cell-out-of-bounds', 'The selected fishing cell is outside the current map.')
  }
  const matchingWater = input.map.voxels.filter(voxel => (
    voxel.x === cell.x && voxel.y === cell.y && voxel.z === cell.z
    && mapMovementTerrainTagsForVoxel(voxel).has('water')
  ))
  if (matchingWater.length !== 1) {
    fail('fishing.water-required', 'The selected fishing cell is not one authoritative water voxel.')
  }
  const lookup = { pokemon: new Map(input.pokemonSheets), trainer: new Map(input.trainerSheets) }
  const actorToken = requireSpawned(
    placementToSpawned(input.actorPlacement, lookup, input.map),
    'fishing.actor-geometry-unavailable', 'Fishing actor geometry is unavailable.',
  )
  const adjacent = gridFootprintCells(input.actorPlacement.position, actorToken).some(origin => (
    ptuGridVectorDistance({
      x: cell.x - origin.x,
      y: cell.y - origin.y,
      z: cell.z - origin.z,
    }) === 1
  ))
  if (!adjacent) fail('fishing.water-not-adjacent', 'Fishing requires an authoritative adjacent water cell.')
  const campaignClock = input.campaignClock
    ?? fail('fishing.campaign-time-unavailable', 'Fishing requires current bounded campaign-clock authority.')
  if (campaignClock.campaignMinute > Number.MAX_SAFE_INTEGER - 15) {
    fail('fishing.campaign-time-unavailable', 'Fishing requires current bounded campaign-clock authority.')
  }
  const requestId = `item-guided:v1:${digest(`fishing-request\u0000${input.command.operationId}`)}`
  const skillCheckIntegrationId = `skill-check-integration:v1:${digest(`fishing-check\u0000${input.command.operationId}`)}`
  const readyAtCampaignMinute = campaignClock.campaignMinute + 15
  return Object.freeze({
    map: input.map,
    sheetMutations: [],
    rolls: [],
    receipts: Object.freeze([
      receipt(input.command, 'fishing-declaration', 'equipment.fishing.declared'),
      receipt(input.command, 'skill-check-reference', 'equipment.fishing.skill-check-integration-created'),
      receipt(input.command, 'campaign-time', 'equipment.fishing.fifteen-minute-interval', `Ready at campaign minute ${readyAtCampaignMinute}.`),
      receipt(input.command, 'attention', 'equipment.fishing.gm-hook-attention-created'),
      receipt(input.command, 'accepted-result', 'equipment.fishing.declaration-accepted'),
    ]),
    status: 'guided-pending',
    fishingDeclaration: Object.freeze({
      requestId,
      skillCheckIntegrationId,
      waterCell: Object.freeze({ ...cell }),
      campaignClockRevision: campaignClock.revision,
      startedAtCampaignMinute: campaignClock.campaignMinute,
      readyAtCampaignMinute,
    }),
  })
}

const executeSnagMachineDeclaration = (input: {
  readonly command: ExecuteEquipmentActionCommandV1
  readonly source: ResolvedEquipmentGrant
  readonly map: TabletopMap
  readonly actorPlacement: SheetPlacement
  readonly actorSheet: CharacterSheet | TrainerSheet
  readonly campaignClock: { readonly revision: number, readonly campaignMinute: number } | null
}): DeferredEquipmentActionExecution => {
  if (input.actorPlacement.sheetKind !== 'trainer' || input.source.canonicalItemId !== 'Snag Machine') {
    fail('snag-machine.trainer-source-required', 'Snag Machine conversion requires exact Trainer custody.')
  }
  if (input.command.targetPlacementIds.length > 0 || input.command.cells.length > 0
    || input.command.targetEquipmentInstanceId !== null
    || input.command.targetEquipmentInstanceRevision !== null
    || input.command.inventorySourceInstanceId === null
    || input.command.skillCheckId !== null
    || input.command.gmAdjudication !== null) {
    fail('snag-machine.declaration-shape-invalid', 'Snag Machine conversion requires exactly one private Poké Ball inventory source and no outcome fields.')
  }
  const campaignClock = input.campaignClock
    ?? fail('snag-machine.campaign-time-unavailable', 'Snag Machine conversion requires current campaign-day authority.')
  const trainer = input.actorSheet as TrainerSheet
  const choice = resolveSnagBallInventoryChoice({
    sheet: trainer,
    sourceInstanceId: input.command.inventorySourceInstanceId,
  })
  if (!choice) fail('snag-machine.not-poke-ball', 'The exact target is not an available reviewed Poké Ball unit.')
  const state = currentTrainerSnagMachineState(trainer)
  const variant = input.source.instanceId.startsWith('item-instance:') ? 'large' as const : 'portable' as const
  const declarationRound = variant === 'portable' ? input.map.initiative?.round ?? null : null
  let equipmentRevision: number | null = null
  if (variant === 'portable') {
    if (!Number.isSafeInteger(declarationRound) || Number(declarationRound) < 1) {
      fail('snag-machine.encounter-round-required', 'Portable Snag Machine conversion requires a current encounter round.')
    }
    const equipment = parseSheetEquipmentStateForOwner(trainer.equipmentState, {
      kind: 'trainer', slug: trainer.slug,
    })
    const accessory = equipment.slots.find(slot => slot.slotId === 'accessory')
    if (accessory?.instanceId !== input.source.instanceId) {
      fail('snag-machine.portable-accessory-required', 'The Portable Snag Machine must occupy the Trainer Accessory slot.')
    }
    if (state.conversions.some(conversion => (
      conversion.variant === 'portable'
      && conversion.machineSourceInstanceId === input.source.instanceId
    ))) {
      fail('snag-machine.portable-conversion-active', 'This exact Portable Snag Machine already has a converted ball pending or active.')
    }
    equipmentRevision = equipment.revision
  }
  else {
    const currentDay = Math.floor(campaignClock.campaignMinute / 1_440)
    if (snagLargeMachineUsesOnCampaignDay({
      state,
      machineSourceInstanceId: input.source.instanceId,
      campaignDayIndex: currentDay,
    }) >= 5) fail('snag-machine.large-daily-limit', 'This exact Large Snag Machine has converted five Poké Balls this campaign day.')
  }
  const requestId = `item-guided:v1:${digest(`snag-request\u0000${input.command.operationId}`)}`
  const spentMap = variant === 'portable' ? spendEconomy(input.map, input.command, 'swift') : input.map
  return Object.freeze({
    map: spentMap,
    sheetMutations: [],
    rolls: [],
    receipts: Object.freeze([
      receipt(input.command, 'item-declaration', `equipment.snag-machine.${variant}.declared`),
      receipt(input.command, 'inventory-conversion', 'equipment.snag-machine.ball-reserved', 'One reviewed Poké Ball unit is reserved for bounded conversion.'),
      receipt(input.command, 'duration-effect', variant === 'portable'
        ? 'equipment.snag-machine.one-round-delay-window'
        : 'equipment.snag-machine.permanent-conversion'),
      receipt(input.command, 'gm-legality', 'equipment.snag-machine.gm-legality-pending'),
      receipt(input.command, 'accepted-result', 'equipment.snag-machine.declaration-accepted'),
    ]),
    status: 'guided-pending',
    snagDeclaration: Object.freeze({
      requestId,
      variant,
      machineSourceInstanceId: input.source.instanceId,
      machineSourceRevision: input.source.instanceRevision,
      equipmentRevision,
      ballSourceInstanceId: choice!.option.sourceInstanceId,
      ballCanonicalItemId: choice!.option.name,
      ballQuantityAtDeclaration: choice!.option.quantity,
      declarationRound,
      campaignClockRevision: campaignClock.revision,
      campaignMinute: campaignClock.campaignMinute,
      campaignDayIndex: Math.floor(campaignClock.campaignMinute / 1_440),
    }),
  })
}

export const executeDeferredEquipmentActionMechanic = (input: {
  readonly command: ExecuteEquipmentActionCommandV1
  readonly source: ResolvedEquipmentGrant
  readonly map: TabletopMap
  readonly actorPlacement: SheetPlacement
  readonly actorSheet: CharacterSheet | TrainerSheet
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly rollD20: (rollId: string) => EquipmentActionRollV1
  readonly equipmentGrantsForPlacement: (placementId: string) => ResolveEquipmentGrantsResult | null
  readonly campaignClock?: { readonly revision: number, readonly campaignMinute: number } | null
}): DeferredEquipmentActionExecution => {
  const implicitShockRemote = input.command.actionId === 'equipment.shock-collar.activate'
    && input.source.instanceId === input.command.targetEquipmentInstanceId
    && input.source.instanceId !== input.command.equipmentInstanceId
  if (!implicitShockRemote) requireExactSource(input)
  if (input.command.actionId === 'equipment.light-shield.ready'
    || input.command.actionId === 'equipment.heavy-shield.ready') return executeShieldReady(input)
  if (input.command.actionId === 'equipment.shock-collar.activate') return executeShockCollar(input)
  if (input.command.actionId === 'equipment.glue-cannon.attack') return executeGlueCannon(input)
  if (input.command.actionId === 'equipment.hand-net.attack') return executeHandNet(input)
  if (input.command.actionId === 'equipment.weighted-nets.throw') return executeWeightedNetThrow(input)
  if (input.command.actionId === 'equipment.weighted-nets.pull') return executeWeightedNetPull(input)
  if (input.command.actionId === 'equipment.fishing.old-rod'
    || input.command.actionId === 'equipment.fishing.good-rod'
    || input.command.actionId === 'equipment.fishing.super-rod') {
    return executeFishingDeclaration({ ...input, campaignClock: input.campaignClock ?? null })
  }
  if (input.command.actionId === 'equipment.snag-machine.convert') {
    return executeSnagMachineDeclaration({ ...input, campaignClock: input.campaignClock ?? null })
  }
  return fail('equipment-action.executor-missing', `${input.command.actionId} has no reviewed executor.`)
}
