import type { ExecuteCapabilityActionCommand } from '#shared/capabilityAutomation/clientCommands'
import type { CapabilityRuntimeActionSpec } from '#shared/capabilityAutomation/spec'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { pokemonHasActiveMarsupialBabyTemplate, pokemonHasResolvedCapability, pokemonMarsupialBabyActionRestricted, resolveSkills } from '~/utils/sheets/pokemonDerived'
import { resolveTrainerSkills } from '~/utils/sheets/trainerDerived'
import { resolveEffectiveCapabilities } from './effectiveCapabilities'
import {
  CAPABILITY_CAMPAIGN_AGGREGATE_DELEGATION_MESSAGE,
  capabilityActionDelegatesToCampaignAggregate,
} from './campaignAggregateDelegation'
import { capabilityStandardActionRestriction } from './actionEligibility'
import { findItem, findMove } from '~~/data/ptuReference'
import type { TrainerInventory } from '~/types/trainerSheet'
import { computePokemonTutorPointsEarnedForSheet } from '~/utils/sheets/pokemonTutorPoints'
import pokedexData from '~~/data/reference/pokedex.json'
import type { PokedexRecord } from '~/types/pokemon'
import { capabilityPowerLimits, resolveCapabilityPowerLoad } from '#shared/capabilityAutomation/power'
import { resolveNature } from '~/utils/ptuNatures'
import { effectiveRuntimeAbilityIds } from '../abilityAutomation/effectiveRuntimeAbilities'
import { createMoveAutomationLineOfSightResolver } from '../moveAutomation/lineOfSight'
import { placementToSpawned } from '~/utils/placement'
import { getClearanceValue } from '~/utils/gridGeometry'
import { deltaEvolutionNeedsMegaStone } from './evolutionProviders'
import { resolveCapabilityJumpTrajectory, type CapabilityJumpFootprint } from './jumpGeometry'
import { getVoxelMaterialDefinition } from '~/utils/mapMaterials'
import { resolveAuthoritativeRelocation, resolveMovement } from '../movement/resolveMovement'
import { hasPokemonCapabilityEdge } from '#shared/capabilityAutomation/pokemonEdges'
import { parseCapabilityCampaignState } from '#shared/capabilityAutomation/campaignState'
import { canonicalPtuBerryName } from '#shared/capabilityAutomation/items'
import { parseTrackerScentSelection } from '#shared/capabilityAutomation/tracker'
import {
  juicerCanConsumeShellJuiceAsSnack,
  juicerShellJuice,
  juicerShellOutput,
  pokemonHasAuthoritativeJuicerIdentity,
} from './juicer'
import { resolveMarsupialRelationship } from './marsupialRelationship'
import { ptuGridVectorDistance } from '~/utils/ptuGridDistance'
import {
  conditionAdjustedMovementCapability,
  conditionBlocksShiftMovement,
} from '~/utils/sheetConditionEffects'
import { projectEffectiveMovement } from '~/utils/encounterMovement'
import { capabilityLinkedMovementPlacementIds } from './linkedMovement'
import {
  teleporterRoundIdentity,
  teleporterRoundUseSpent,
  TeleporterRoundIdentityError,
} from './teleporterRoundUse'
import { zygardeAssemblyRecordForPlacement } from './zygardeAssembly'
import {
  isPhysicalPowerLoadObject,
  physicalPowerMovementLimit,
  physicalPowerObjectIsAdjacent,
  physicalPowerSourceValues,
  projectPhysicalPowerFootprint,
  resolvePhysicalPowerLoad,
} from './physicalPower'

const pokedexBySpecies = new Map((pokedexData as readonly PokedexRecord[]).map(record => [
  record.species.trim().toLocaleLowerCase('en-US'), record,
]))

export class CapabilitySelectionValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'CapabilitySelectionValidationError'
  }
}

const fail = (code: string, message: string): never => {
  throw new CapabilitySelectionValidationError(code, message)
}

const canonicalCapabilityItemName = (value: string): string | null => (
  findItem(value)?.name ?? canonicalPtuBerryName(value)
)

const distance = (left: SheetPlacement, right: SheetPlacement): number => Math.max(
  Math.abs(left.position.x - right.position.x),
  Math.abs(left.position.y - right.position.y),
  Math.abs(left.position.z - right.position.z),
)

const skillDice = (sheet: CharacterSheet | TrainerSheet, kind: 'pokemon' | 'trainer', skill: string): number => {
  const dice = kind === 'pokemon'
    ? resolveSkills(sheet as CharacterSheet).find(candidate => candidate.key === skill)?.value
    : resolveTrainerSkills(sheet as TrainerSheet).find(candidate => candidate.key === skill)?.dice
  const match = /^(\d+)d6/i.exec(dice ?? '')
  return Math.max(1, Math.min(6, Number.parseInt(match?.[1] ?? '1', 10)))
}

const inventoryRows = (inventory: TrainerInventory | undefined): readonly { readonly name: string; readonly qty?: number }[] => [
  ...(inventory?.keyItems ?? []), ...(inventory?.pokemonItems ?? []), ...(inventory?.medicalKit ?? []),
  ...(inventory?.pokeBalls ?? []), ...(inventory?.foodStuff ?? []), ...(inventory?.equipment ?? []),
]
const trainerHasItem = (trainer: TrainerSheet, name: string): boolean => inventoryRows(trainer.inventory).some(entry => (
  entry.name.trim().toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US') && (entry.qty ?? 1) > 0
))
const normalizedContexts = (map: TabletopMap): ReadonlySet<string> => new Set(
  Array.isArray(map.metadata?.capabilityContexts)
    ? map.metadata!.capabilityContexts.filter((value): value is string => typeof value === 'string').map(value => value.trim().toLocaleLowerCase('en-US'))
    : [],
)
const hasContext = (map: TabletopMap, value: string): boolean => {
  const contexts = normalizedContexts(map)
  const normalized = value.toLocaleLowerCase('en-US')
  return contexts.has(normalized) || contexts.has(`capability.${normalized}`)
}

interface MountableGuidelineOverride {
  readonly riderCapacity: number | null
  readonly allowSignificantExtraWeight: boolean
  readonly approvedRiderPlacementIds: ReadonlySet<string>
}

/** Parse one bounded GM-authored campaign adjustment to the explicitly non-rigid Mountable guideline. */
const mountableGuidelineOverride = (
  map: TabletopMap,
  mountPlacementId: string,
): MountableGuidelineOverride | null => {
  const matching = Array.isArray(map.metadata?.capabilityMountableOverrides)
    ? map.metadata.capabilityMountableOverrides.filter((raw) => (
        raw && typeof raw === 'object' && !Array.isArray(raw)
        && (raw as Record<string, unknown>).mountPlacementId === mountPlacementId
      ))
    : []
  if (matching.length === 0) return null
  if (matching.length !== 1) {
    fail('mountable-guideline-override-ambiguous', 'Mountable requires at most one exact campaign guideline override per placement.')
  }
  const override = matching[0] as Record<string, unknown>
  const capacity = override.riderCapacity
  if (capacity !== undefined && (!Number.isSafeInteger(capacity) || (capacity as number) < 0 || (capacity as number) > 16)) {
    fail('mountable-guideline-override-invalid', 'Mountable campaign rider capacity must be a whole number from 0 through 16.')
  }
  if (override.allowSignificantExtraWeight !== undefined && typeof override.allowSignificantExtraWeight !== 'boolean') {
    fail('mountable-guideline-override-invalid', 'Mountable extra-weight authority must be a bounded boolean choice.')
  }
  const approved = override.approvedRiderPlacementIds
  if (approved !== undefined && (!Array.isArray(approved) || approved.length > 16
    || approved.some(id => typeof id !== 'string' || !map.placements.some(placement => placement.id === id))
    || new Set(approved).size !== approved.length)) {
    fail('mountable-guideline-override-invalid', 'Mountable approved riders must be at most 16 unique authoritative placements.')
  }
  return {
    riderCapacity: capacity === undefined ? null : capacity as number,
    allowSignificantExtraWeight: override.allowSignificantExtraWeight === true,
    approvedRiderPlacementIds: new Set((approved ?? []) as string[]),
  }
}
const targetIsWilling = (map: TabletopMap, actorPlacementId: string, targetPlacementId: string): boolean => (
  Array.isArray(map.metadata?.capabilityWillingTargets)
  && map.metadata.capabilityWillingTargets.some(value => value === `${actorPlacementId}:${targetPlacementId}`)
)
const targetIsHelpless = (
  map: TabletopMap,
  placement: SheetPlacement,
  pokemon: ReadonlyMap<string, CharacterSheet>,
  trainers: ReadonlyMap<string, TrainerSheet>,
): boolean => conditionsFor(map, placement, pokemon, trainers).some(condition => (
  /^(?:fainted|unconscious|sleep(?:ing|ed)?|frozen)$/i.test(condition.trim())
))
const capabilityJumpFootprints = (
  map: TabletopMap,
  pokemonSheets: ReadonlyMap<string, CharacterSheet>,
  trainerSheets: ReadonlyMap<string, TrainerSheet>,
  now: number,
): readonly CapabilityJumpFootprint[] => {
  const sheets = { pokemon: new Map(pokemonSheets), trainer: new Map(trainerSheets) }
  const effectiveIdsByPlacement = new Map<string, ReadonlySet<string>>()
  const base = map.placements.flatMap((placement): readonly CapabilityJumpFootprint[] => {
    const token = placementToSpawned(placement, sheets, map)
    const sheet = placement.sheetKind === 'pokemon'
      ? pokemonSheets.get(placement.sheetSlug)
      : trainerSheets.get(placement.sheetSlug)
    if (!token || !sheet) return []
    const effectiveIds = new Set(resolveEffectiveCapabilities({
      map,
      placement,
      sheet,
      sheets: { pokemon: pokemonSheets, trainer: trainerSheets },
    }).instances.filter(instance => instance.effective).map(instance => instance.instanceId))
    effectiveIdsByPlacement.set(placement.id, effectiveIds)
    const modes = map.encounterState?.capabilityRuntime?.modes.filter(mode => (
      mode.actorPlacementId === placement.id
      && effectiveIds.has(mode.capabilityInstanceId)
      && (mode.expiresAt === null || mode.expiresAt > now)
    )) ?? []
    const scale = modes.some(mode => mode.mode === 'inflated') ? 1.25
      : modes.some(mode => mode.mode === 'shrunken') ? 0.25 : 1
    return [{
      id: placement.id,
      position: placement.position,
      base: Math.max(1, Math.ceil(token.base * scale)),
      clearance: Math.max(1, Math.ceil(getClearanceValue(token) * scale)),
    }]
  })
  const byId = new Map(base.map(footprint => [footprint.id, footprint]))
  for (const link of map.encounterState?.capabilityRuntime?.links ?? []) {
    if (link.kind !== 'as-one-mount' || link.participantPlacementIds.length !== 1
      || !effectiveIdsByPlacement.get(link.ownerPlacementId)?.has(link.capabilityInstanceId)) continue
    const rider = byId.get(link.ownerPlacementId)
    const mount = byId.get(link.participantPlacementIds[0]!)
    if (rider && mount) byId.set(rider.id, { ...rider, base: mount.base, clearance: mount.clearance })
  }
  return [...byId.values()]
}

const linkedTrainerSheets = (
  actor: SheetPlacement,
  trainers: ReadonlyMap<string, TrainerSheet>,
): readonly TrainerSheet[] => actor.sheetKind === 'trainer'
  ? [...trainers.values()].filter(trainer => trainer.slug === actor.sheetSlug)
  : [...trainers.values()].filter(trainer => (trainer.currentTeam ?? []).includes(actor.sheetSlug)
    || (trainer.boxedPokemon ?? []).includes(actor.sheetSlug))

interface CapabilityWorldObject {
  readonly id: string
  readonly position: { readonly x: number; readonly y: number; readonly z: number }
  readonly pounds: number
  readonly material: string | null
  readonly raw: Readonly<Record<string, unknown>>
}
const capabilityWorldObjects = (map: TabletopMap): readonly CapabilityWorldObject[] => {
  if (!Array.isArray(map.metadata?.capabilityObjects)) return []
  return map.metadata.capabilityObjects.flatMap((raw): readonly CapabilityWorldObject[] => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const value = raw as Record<string, unknown>
    const position = value.position as Record<string, unknown> | null
    if (typeof value.id !== 'string' || !value.id.trim() || !position
      || !Number.isSafeInteger(position.x) || !Number.isSafeInteger(position.y) || !Number.isSafeInteger(position.z)
      || typeof value.pounds !== 'number' || !Number.isFinite(value.pounds) || value.pounds < 0) return []
    return [{
      id: value.id,
      position: { x: position.x as number, y: position.y as number, z: position.z as number },
      pounds: value.pounds,
      material: typeof value.material === 'string' ? value.material.trim().toLocaleLowerCase('en-US') : null,
      raw: value,
    }]
  })
}
const capabilityWorldObjectHasAttachment = (object: Readonly<Record<string, unknown>>): boolean => (
  (object.attachedToPlacementId !== undefined && object.attachedToPlacementId !== null)
  || (object.attachedCapabilityInstanceId !== undefined && object.attachedCapabilityInstanceId !== null)
  || (object.attachedCapabilityCanonicalId !== undefined && object.attachedCapabilityCanonicalId !== null)
  || (object.attachmentKind !== undefined && object.attachmentKind !== null)
)
const worldObjectWeightClass = (pounds: number): number => pounds <= 25 ? 1
  : pounds <= 55 ? 2 : pounds <= 110 ? 3 : pounds <= 220 ? 4 : pounds <= 440 ? 5 : 6

const trainerWeightPounds = (sheet: TrainerSheet): number | null => {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(lb|lbs|pounds?|kg|kilograms?)?\s*$/i.exec(sheet.weight ?? '')
  if (!match) return null
  const value = Number(match[1])
  const pounds = /^(?:kg|kilograms?)$/i.test(match[2] ?? '') ? value * 2.2046226218 : value
  return Number.isFinite(pounds) && pounds > 0 ? pounds : null
}

const trainerWeightClass = (sheet: TrainerSheet): number => {
  const pounds = trainerWeightPounds(sheet)
  return pounds === null ? 4 : worldObjectWeightClass(pounds)
}

const selectedWorldObjectIds = (optionId: string | null): readonly string[] => {
  const match = /^objects:([A-Za-z0-9._:/-]+(?:,[A-Za-z0-9._:/-]+){0,15})$/.exec(optionId ?? '')
  return match ? match[1]!.split(',') : []
}

const conditionsFor = (
  map: TabletopMap,
  placement: SheetPlacement,
  pokemon: ReadonlyMap<string, CharacterSheet>,
  trainers: ReadonlyMap<string, TrainerSheet>,
): readonly string[] => placementToSpawned(placement, {
  pokemon: new Map(pokemon),
  trainer: new Map(trainers),
}, map)?.conditions ?? (placement.sheetKind === 'pokemon'
  ? pokemon.get(placement.sheetSlug)?.combat?.conditions ?? []
  : trainers.get(placement.sheetSlug)?.conditions ?? [])

export interface CapabilityJumpPlan {
  readonly destination: { readonly x: number; readonly y: number; readonly z: number }
  readonly branch: 'normal' | 'running-start' | 'acrobatics-extension' | 'running-start-and-extension'
  readonly running: boolean
  readonly extension: boolean
  readonly trickyDc: number | null
  readonly jumpOrigin: { readonly x: number; readonly y: number; readonly z: number }
  readonly horizontalDistance: number
  readonly travelDistance: number
  readonly effectiveHighJump: number
  readonly linkedCompanionPlacementIds: readonly string[]
  readonly trajectory: readonly { readonly x: number; readonly y: number; readonly z: number }[]
}

/** Build the exact server-authored Jump branch shared by validation and execution. */
export const resolveCapabilityJumpPlan = (input: {
  readonly map: TabletopMap
  readonly actor: SheetPlacement
  readonly actorSheet: CharacterSheet | TrainerSheet
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly command: ExecuteCapabilityActionCommand
  readonly now: number
}): CapabilityJumpPlan => {
  if (input.command.selections.cells.length !== 1) {
    fail('jump-destination-required', 'Jump requires one authoritative destination cell.')
  }
  const destination = input.command.selections.cells[0]!
  const option = input.command.selections.optionId ?? 'normal'
  const optionMatch = /^(normal|running-start|acrobatics-extension|running-start-and-extension)(?:;tricky-dc:(\d{1,2}))?$/.exec(option)
    ?? fail('jump-option-invalid', 'Jump must retain its normal, running-start, Acrobatics-extension, and optional tricky-DC branch.')
  const branch = optionMatch[1]! as CapabilityJumpPlan['branch']
  const requestedTrickyDc = optionMatch[2] ? Number(optionMatch[2]) : null
  const trickyPrefix = `tricky-jump:${input.actor.id}:${destination.x},${destination.y},${destination.z}:dc:`.toLocaleLowerCase('en-US')
  const authoredTrickyDcs = [...normalizedContexts(input.map)].flatMap((context): readonly number[] => {
    const normalized = context.startsWith('capability.') ? context.slice('capability.'.length) : context
    if (!normalized.startsWith(trickyPrefix)) return []
    const value = Number(normalized.slice(trickyPrefix.length))
    return Number.isSafeInteger(value) && value >= 1 && value <= 40 ? [value] : []
  })
  if (authoredTrickyDcs.length > 1 || requestedTrickyDc !== (authoredTrickyDcs[0] ?? null)) {
    fail('jump-tricky-context-invalid', authoredTrickyDcs.length > 0
      ? 'The exact GM-authored tricky Jump check cannot be omitted or changed.'
      : 'An unmarked destination cannot invent a tricky Jump DC.')
  }
  const effective = resolveEffectiveCapabilities({
    map: input.map, placement: input.actor, sheet: input.actorSheet,
    sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
  })
  const jump = effective.instances.find(instance => (
    instance.instanceId === input.command.capabilityInstanceId
    && instance.effective && instance.canonicalId === 'Jump'
  ))
  const parameters = jump?.parameters
  const staticLong = parameters?.kind === 'jump'
    ? parameters.long
    : fail('jump-values-missing', 'Jump requires authoritative Long and High Jump values.')
  const staticHigh = parameters?.kind === 'jump'
    ? parameters.high
    : fail('jump-values-missing', 'Jump requires authoritative Long and High Jump values.')
  const actorToken = placementToSpawned(input.actor, {
    pokemon: new Map(input.pokemonSheets), trainer: new Map(input.trainerSheets),
  }, input.map)
  const projectedJump = projectEffectiveMovement({
    sheetCapabilities: actorToken?.movementCapabilities,
    sheetTraits: { phasing: actorToken?.movementTraits?.phasing ?? false, jump: { long: staticLong, high: staticHigh } },
    sheetConditions: actorToken?.conditions ?? [],
    encounterEffects: input.map.encounterState?.effects,
    target: {
      placementId: input.actor.id,
      ...(input.actor.sideId === undefined ? {} : { sideId: input.actor.sideId }),
      position: input.actor.position,
      base: actorToken?.base ?? 1,
      clearance: actorToken ? getClearanceValue(actorToken) : 1,
    },
  }).traits.jump
  const running = branch === 'running-start' || branch === 'running-start-and-extension'
  const extension = branch === 'acrobatics-extension' || branch === 'running-start-and-extension'
  if (running && input.actor.sheetKind !== 'trainer') {
    fail('jump-running-start-trainer-only', 'The reviewed Running Start bonus belongs to Trainer High Jump derivation.')
  }
  const runDirection = {
    x: Math.sign(destination.x - input.actor.position.x),
    z: Math.sign(destination.z - input.actor.position.z),
  }
  if (running && runDirection.x === 0 && runDirection.z === 0) {
    fail('jump-running-start-direction-missing', 'Running Start requires a horizontal run-up direction toward the destination.')
  }
  const jumpOrigin = running ? {
    x: input.actor.position.x + runDirection.x,
    y: input.actor.position.y,
    z: input.actor.position.z + runDirection.z,
  } : { ...input.actor.position }
  if (running) {
    const runUp = resolveMovement({
      map: input.map,
      sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
      placementId: input.actor.id,
      now: input.now,
      mode: 'shift',
      destination: jumpOrigin,
      policy: { kind: 'standard', maximumCost: 1 },
    })
    if (!runUp.ok) fail('jump-running-start-blocked', `Running Start run-up is illegal: ${runUp.message}`)
  }
  if (destination.x === jumpOrigin.x && destination.y === jumpOrigin.y && destination.z === jumpOrigin.z) {
    fail('jump-distance-invalid', 'Jump requires travel beyond the Running Start run-up.')
  }
  const horizontalDistance = ptuGridVectorDistance({
    x: destination.x - jumpOrigin.x,
    y: 0,
    z: destination.z - jumpOrigin.z,
  })
  const travelDistance = ptuGridVectorDistance({
    x: destination.x - jumpOrigin.x,
    y: destination.y - jumpOrigin.y,
    z: destination.z - jumpOrigin.z,
  })
  const runUpDistance = ptuGridVectorDistance({
    x: jumpOrigin.x - input.actor.position.x,
    y: jumpOrigin.y - input.actor.position.y,
    z: jumpOrigin.z - input.actor.position.z,
  })
  const physicalLoad = resolvePhysicalPowerLoad({
    map: input.map,
    placementId: input.actor.id,
    powerByCapabilityInstanceId: physicalPowerSourceValues(effective.instances),
  })
  const physicalLoadLimit = physicalPowerMovementLimit(physicalLoad, input.map.initiative?.round)
  if (physicalLoadLimit !== null && runUpDistance + travelDistance > physicalLoadLimit) {
    fail('jump-physical-load-limit', `The physical load limits this Jump action to ${physicalLoadLimit} metre${physicalLoadLimit === 1 ? '' : 's'}.`)
  }
  const rise = Math.max(0, destination.y - jumpOrigin.y)
  const drop = Math.max(0, jumpOrigin.y - destination.y)
  const baseHigh = projectedJump.high + (running ? 1 : 0)
  const longExcess = horizontalDistance - projectedJump.long
  const highExcess = Math.max(rise, drop) - baseHigh
  if (longExcess > 1 || highExcess > 1 || (longExcess > 0 && highExcess > 0)) {
    if (drop > baseHigh + 1) {
      fail('jump-fall-resolution-unavailable', 'This descent exceeds reviewed High Jump mitigation and no authoritative falling-damage kernel is available.')
    }
    fail('jump-distance-invalid', 'Jump destination exceeds the reviewed Long/High Jump limits.')
  }
  const linkedCompanionPlacementIds = capabilityLinkedMovementPlacementIds(input, input.actor.id)
  const movingIds = new Set([input.actor.id, ...linkedCompanionPlacementIds])
  const footprints = capabilityJumpFootprints(input.map, input.pokemonSheets, input.trainerSheets, input.now)
  const movingFootprints = footprints.filter(footprint => movingIds.has(footprint.id))
  if (movingFootprints.length !== movingIds.size) {
    fail('jump-actor-footprint-missing', 'Jump requires every linked movement footprint to resolve authoritatively.')
  }
  const compositeFootprint: CapabilityJumpFootprint = {
    id: input.actor.id,
    position: jumpOrigin,
    base: Math.max(...movingFootprints.map(footprint => footprint.base)),
    clearance: Math.max(...movingFootprints.map(footprint => footprint.clearance)),
  }
  const otherPlacements = footprints.filter(footprint => !movingIds.has(footprint.id))
  const trajectoryAt = (effectiveHighJump: number) => resolveCapabilityJumpTrajectory({
    map: input.map,
    actor: compositeFootprint,
    otherPlacements,
    destination,
    effectiveHighJump,
  })
  const baseTrajectory = longExcess <= 0 && highExcess <= 0 ? trajectoryAt(baseHigh) : null
  let effectiveHighJump = baseHigh
  let trajectory = baseTrajectory
  const endpointRequiresExtension = longExcess > 0 || highExcess > 0
  if (extension) {
    effectiveHighJump = longExcess > 0 ? baseHigh : baseHigh + 1
    trajectory = trajectoryAt(effectiveHighJump)
    const obstacleRequiresHighExtension = !endpointRequiresExtension
      && baseTrajectory?.legal !== true && trajectory.legal
    if (!endpointRequiresExtension && !obstacleRequiresHighExtension) {
      fail('jump-extension-branch-invalid', 'The Acrobatics extension branch requires an exact one-metre endpoint or obstacle-clearance extension.')
    }
  }
  else if (endpointRequiresExtension) {
    fail('jump-extension-branch-invalid', 'This destination requires the Acrobatics DC 16 extension branch.')
  }
  if (drop > effectiveHighJump) {
    fail('jump-fall-resolution-unavailable', 'This descent exceeds reviewed High Jump mitigation and no authoritative falling-damage kernel is available.')
  }
  if (!trajectory || !trajectory.legal) {
    const extensionTrajectory = !extension && !endpointRequiresExtension
      ? trajectoryAt(baseHigh + 1)
      : null
    if (extensionTrajectory?.legal) {
      fail('jump-extension-branch-invalid', 'Clearing this obstacle requires the Acrobatics DC 16 High Jump extension branch.')
    }
    const reasonCode = trajectory?.reasonCode ?? 'jump-trajectory-blocked'
    fail(reasonCode, reasonCode === 'jump-endpoint-unsupported'
      ? 'Jump must end on an authoritative supporting surface for every linked footprint.'
      : 'No collision-free trajectory exists within the effective High Jump ceiling for the complete linked footprint.')
  }
  const legalTrajectory = trajectory!
  if (legalTrajectory === null) fail('jump-trajectory-blocked', 'Jump trajectory planning failed closed.')
  if (legalTrajectory.path.length > 256) {
    fail('jump-trajectory-evidence-too-long', 'Jump trajectory exceeds the bounded authoritative movement-evidence limit.')
  }
  return {
    destination,
    branch,
    running,
    extension,
    trickyDc: authoredTrickyDcs[0] ?? null,
    jumpOrigin,
    horizontalDistance,
    travelDistance,
    effectiveHighJump,
    linkedCompanionPlacementIds,
    trajectory: legalTrajectory.path,
  }
}

/**
 * Validate every client-authored Capability selection against the current
 * authoritative map and sheets. Context availability alone never authorizes a
 * particular target, cell, branch, or campaign resource.
 */
export const validateCapabilityActionSelections = (input: {
  readonly map: TabletopMap
  /** Placement owning the exact Capability source. */
  readonly actor: SheetPlacement
  readonly actorSheet: CharacterSheet | TrainerSheet
  /** Placement initiating/paying a delegated action; defaults to actor. */
  readonly actingPlacement?: SheetPlacement
  readonly actingSheet?: CharacterSheet | TrainerSheet
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly command: ExecuteCapabilityActionCommand
  readonly action: CapabilityRuntimeActionSpec
  readonly now: number
}): void => {
  if (capabilityActionDelegatesToCampaignAggregate(input.command.canonicalId, input.command.actionId)) {
    fail('campaign-aggregate-action-required', CAPABILITY_CAMPAIGN_AGGREGATE_DELEGATION_MESSAGE)
  }
  const actingPlacement = input.actingPlacement ?? input.actor
  const actingSheet = input.actingSheet ?? input.actorSheet
  const activePlacementId = input.map.initiative?.activeId
  if (activePlacementId && input.action.economy === 'extended') {
    fail('extended-action-during-initiative', 'Extended Capability actions are unavailable while initiative has an active participant.')
  }
  if (activePlacementId && input.action.economy !== 'extended' && input.action.economy !== 'none'
    && activePlacementId !== actingPlacement.id) {
    fail('capability-actor-turn-required', 'This Capability action must be used during the actor’s authoritative initiative turn.')
  }
  const actorConditions = conditionsFor(
    input.map,
    actingPlacement,
    input.pokemonSheets,
    input.trainerSheets,
  )
  const actingEffectiveCapabilities = resolveEffectiveCapabilities({
    map: input.map,
    placement: actingPlacement,
    sheet: actingSheet,
    sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
  }).instances.filter(instance => instance.effective)
  const actingPhysicalLoad = resolvePhysicalPowerLoad({
    map: input.map,
    placementId: actingPlacement.id,
    powerByCapabilityInstanceId: physicalPowerSourceValues(actingEffectiveCapabilities),
  })
  if (input.action.economy === 'standard') {
    const restriction = capabilityStandardActionRestriction({
      map: input.map,
      placement: actingPlacement,
      sheet: actingSheet,
      pokemonSheets: input.pokemonSheets,
      trainerSheets: input.trainerSheets,
      now: input.now,
      allowShrunkenRestore: input.command.actionId === 'restore-size',
    })
    if (restriction) fail(restriction.code, restriction.message)
  }
  if (input.action.economy === 'standard' && actingPhysicalLoad?.standardActionsAllowed === false) {
    fail('physical-power-standard-action-blocked', 'Staggering Weight prevents the actor from taking Standard Actions.')
  }
  if ((input.command.actionId === 'jump' || input.command.actionId === 'teleport')
    && conditionBlocksShiftMovement(actorConditions)) {
    fail('shift-movement-condition-blocked', 'Stuck or Tripped prevents this movement-producing Shift action.')
  }
  if (actingPlacement.sheetKind === 'pokemon') {
    const actor = actingSheet as CharacterSheet
    const parentalBondActive = effectiveRuntimeAbilityIds({
      map: input.map,
      placement: actingPlacement,
      sheet: actor,
    }).includes('Parental Bond')
    if (pokemonMarsupialBabyActionRestricted(actor, parentalBondActive ? ['Parental Bond'] : [])) {
      fail('marsupial-baby-action-blocked', 'A Marsupial Baby-Template Kangaskhan without active Parental Bond cannot be commanded or take actions.')
    }
    if (actor.letterPressCombinedInto) {
      fail('letter-press-participant-action-blocked', 'An Unown irreversibly combined into a Prime Unown cannot act separately.')
    }
    if (actor.zygardeDisassembledIntoCells) {
      fail('zygarde-disassembled-action-blocked', 'A Zygarde disassembled into Cells cannot act or deploy as a Pokémon.')
    }
  }
  const coupledLinks = (input.map.encounterState?.capabilityRuntime?.links ?? []).filter(link => (
    link.kind === 'as-one-mount' || link.kind === 'viral-fusion'
  ))
  if (coupledLinks.some(link => link.participantPlacementIds.includes(actingPlacement.id))) {
    fail('coupled-participant-action-blocked', 'A mounted or fused participant cannot take independent Capability actions.')
  }
  const context = input.action.contextPredicateId.slice(input.action.contextPredicateId.lastIndexOf('.') + 1)
  const targets = input.command.selections.targetPlacementIds.map((id) => (
    input.map.placements.find(placement => placement.id === id)
      ?? fail('target-missing', `Capability target ${id} is unavailable.`)
  ))
  if (targets.some(target => target.id === input.actor.id)) fail('self-target-invalid', 'This Capability cannot target its own actor.')
  if (input.command.selections.cells.some(cell => (
    cell.x < 0 || cell.y < 0 || cell.z < 0
    || cell.x >= input.map.dimensions.x
    || cell.y >= input.map.dimensions.y
    || cell.z >= input.map.dimensions.z
  ))) fail('cell-out-of-bounds', 'Capability selections must use exact in-bounds authoritative map cells.')
  const separatelyUnavailableIds = new Set((input.map.encounterState?.capabilityRuntime?.links ?? []).flatMap(link => (
    link.kind === 'as-one-mount' || link.kind === 'viral-fusion' ? link.participantPlacementIds : []
  )))
  if (targets.some(target => separatelyUnavailableIds.has(target.id))) {
    fail('target-not-separately-available', 'A mounted or fused participant cannot be targeted separately.')
  }

  const participantContext = new Set([
    'communication-target', 'communication-targets', 'living-target', 'sleeping-target', 'adjacent-living-shadow',
    'adjacent-willing-mount', 'adjacent-willing-rider', 'adjacent-willing-wielder', 'adjacent-willing-baby-target',
    'linked-rider-and-adjacent-cell', 'close-examination-target',
    'mind-in-focus-range', 'maneuver-target-in-focus-range', 'eligible-unown', 'willing-or-helpless-target', 'wild-target',
  ]).has(context)
  if (participantContext && targets.length === 0) fail('target-required', `Capability context ${context} requires an authoritative target.`)
  if (!participantContext && targets.length > 0 && !['threaded-shift'].includes(input.command.actionId)) {
    fail('target-unexpected', `Capability context ${context} does not accept participant targets.`)
  }
  const exactSingleTargetActions = new Set([
    'mount', 'engage-wielder', 'read-aura', 'read-dream', 'read-mind', 'telekinetic-maneuver', 'bond', 'ride-shadow',
    'distract-with-alluring', 'release-rider', 'oppose-examination', 'shelter-baby',
  ])
  if (exactSingleTargetActions.has(input.command.actionId) && targets.length !== 1) {
    fail('target-count-invalid', `${input.command.actionId} requires exactly one authoritative target.`)
  }
  if ((/^adjacent-willing-/.test(context) || context === 'adjacent-living-shadow')
    && targets.some(target => distance(input.actor, target) > 1)) {
    fail('target-not-adjacent', 'Capability link targets must be adjacent.')
  }
  if (/^adjacent-willing-/.test(context) && targets.some(target => !targetIsWilling(input.map, input.actor.id, target.id))) {
    fail('target-not-willing', 'Capability link targets require an exact authoritative willingness identity.')
  }
  if (context === 'close-examination-target') {
    const examiner = targets[0]
    const retained = Array.isArray(input.map.metadata?.capabilityCloseExaminations)
      && input.map.metadata.capabilityCloseExaminations.some(raw => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
        const examination = raw as Record<string, unknown>
        return examination.subjectPlacementId === input.actor.id
          && examination.examinerPlacementId === examiner?.id
          && (typeof examination.expiresAt !== 'number' || examination.expiresAt > input.now)
      })
    if (!examiner || distance(input.actor, examiner) > 1 || !retained) {
      fail('shapeshifter-examination-invalid', 'Shapeshifter examination requires one adjacent retained authoritative examiner.')
    }
    const activeMode = input.map.encounterState?.capabilityRuntime?.modes.some(mode => (
      mode.actorPlacementId === input.actor.id
      && mode.mode === 'shapechanged'
      && mode.capabilityInstanceId === input.command.capabilityInstanceId
      && mode.canonicalId === input.command.canonicalId
      && (mode.expiresAt === null || mode.expiresAt > input.now)
    ))
    if (!activeMode) fail('shapeshifter-mode-missing', 'The exact source-owned Shapechanged mode is no longer active.')
  }
  if (context === 'wild-target') {
    const wildIds = new Set(Array.isArray(input.map.metadata?.capabilityWildPlacementIds)
      ? input.map.metadata.capabilityWildPlacementIds.filter((id): id is string => typeof id === 'string') : [])
    if (targets.length !== 1 || !wildIds.has(targets[0]!.id)) {
      fail('alluring-wild-target-required', 'Alluring distraction requires one exact authoritative Wild Pokémon target.')
    }
  }
  if (context === 'sleeping-target') {
    if (targets.length !== 1) fail('sleeping-target-required', 'Dream Reader requires exactly one target.')
    if (!conditionsFor(input.map, targets[0]!, input.pokemonSheets, input.trainerSheets)
      .some(condition => /^sleep(?:ing|ed)?$/i.test(condition.trim()))) {
      fail('target-not-sleeping', 'Dream Reader requires a currently Sleeping target.')
    }
    const option = input.command.selections.optionId ?? 'private-view'
    const image = /^dream-mist-image:viewers:([A-Za-z0-9._:/-]+(?:,[A-Za-z0-9._:/-]+){0,15})$/.exec(option)
    if (option !== 'private-view' && !image) fail('dream-reader-option-invalid', 'Dream Reader requires private-view or a bounded Dream Mist image viewer list.')
    if (image) {
      const viewers = image[1]!.split(',')
      if (new Set(viewers).size !== viewers.length || viewers.some(id => !input.map.placements.some(placement => placement.id === id))) {
        fail('dream-reader-viewer-invalid', 'Dream Mist image viewers must be unique authoritative placements.')
      }
      const evidence = Array.isArray(input.map.metadata?.capabilityDreamMistSleepEvidence)
        ? input.map.metadata.capabilityDreamMistSleepEvidence as unknown[] : []
      if (!evidence.some(raw => {
        const record = raw as Record<string, unknown>
        return record?.targetPlacementId === targets[0]!.id
          && Number.isSafeInteger(record.confirmedAt) && (record.confirmedAt as number) <= input.now
          && Number.isSafeInteger(record.expiresAt) && (record.expiresAt as number) > input.now
      }) && input.command.selections.gmConfirmed !== true) {
        fail('dream-mist-evidence-required', 'A shared dream image requires retained evidence or GM confirmation that Dream Mist caused this Sleep.')
      }
    }
  }

  const targetSheets = targets.map((target) => {
    const sheet = target.sheetKind === 'pokemon'
      ? input.pokemonSheets.get(target.sheetSlug)
      : input.trainerSheets.get(target.sheetSlug)
    return sheet ?? fail('target-sheet-missing', `Capability target sheet ${target.sheetKind}/${target.sheetSlug} is unavailable.`)
  })
  if (input.command.actionId === 'lift-load' || input.command.actionId === 'release-load') {
    if (input.command.canonicalId !== 'Power') {
      fail('physical-power-action-invalid', 'Physical load actions require the exact Power Capability source.')
    }
    const source = actingEffectiveCapabilities.find(instance => (
      instance.instanceId === input.command.capabilityInstanceId
      && instance.canonicalId === 'Power'
    ))
    const power = typeof source?.value === 'number' && Number.isFinite(source.value)
      ? source.value
      : fail('physical-power-source-missing', 'The exact valued Power source is no longer effective.')
    const rawObjects = Array.isArray(input.map.metadata?.capabilityObjects)
      ? input.map.metadata.capabilityObjects : []
    const baseActorToken = placementToSpawned(input.actor, {
      pokemon: new Map(input.pokemonSheets), trainer: new Map(input.trainerSheets),
    }, input.map) ?? fail('physical-power-actor-unresolved', 'Power requires an authoritative actor footprint.')
    const actorToken = projectPhysicalPowerFootprint({
      token: baseActorToken,
      map: input.map,
      placementId: input.actor.id,
      effectiveCapabilityInstanceIds: new Set(actingEffectiveCapabilities.map(instance => instance.instanceId)),
      now: input.now,
    })
    const ownedObjects = rawObjects.flatMap((raw): readonly Record<string, unknown>[] => (
      raw && typeof raw === 'object' && !Array.isArray(raw)
      && isPhysicalPowerLoadObject(raw as Record<string, unknown>)
      && (raw as Record<string, unknown>).attachedToPlacementId === input.actor.id
        ? [raw as Record<string, unknown>] : []
    ))
    if (input.command.actionId === 'release-load') {
      if (input.command.selections.optionId !== null
        || input.command.selections.canonicalItemId !== null
        || input.command.selections.recipientTrainerSlug !== null
        || input.command.selections.description !== null
        || input.command.selections.cells.length > 0
        || input.command.selections.targetPlacementIds.length > 0) {
        fail('physical-power-release-selection-invalid', 'Releasing a physical load does not accept client-authored targets or options.')
      }
      if (!ownedObjects.some(object => object.attachedCapabilityInstanceId === input.command.capabilityInstanceId)) {
        fail('physical-power-load-missing', 'The exact Power source owns no active physical load to release.')
      }
    }
    else {
      const objectIds = selectedWorldObjectIds(input.command.selections.optionId)
      if (objectIds.length === 0 || new Set(objectIds).size !== objectIds.length) {
        fail('physical-power-object-selection-invalid', 'Power requires 1–16 unique authoritative object IDs.')
      }
      if (input.command.selections.canonicalItemId !== null
        || input.command.selections.recipientTrainerSlug !== null
        || input.command.selections.description !== null
        || input.command.selections.cells.length > 0
        || input.command.selections.targetPlacementIds.length > 0) {
        fail('physical-power-object-selection-invalid', 'Power load selection accepts only authoritative object IDs.')
      }
      const selected = objectIds.map((id) => {
        const matches = rawObjects.filter(raw => (
          raw && typeof raw === 'object' && !Array.isArray(raw)
          && (raw as Record<string, unknown>).id === id
        ))
        if (matches.length !== 1) {
          return fail(
            matches.length === 0 ? 'physical-power-object-missing' : 'physical-power-object-ambiguous',
            `Physical load object ${id} must resolve to exactly one authoritative object.`,
          )
        }
        return matches[0]
      }).map((raw, index) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          return fail('physical-power-object-missing', `Physical load object ${objectIds[index]} is unavailable.`)
        }
        const object = raw as Record<string, unknown>
        const position = object.position as Record<string, unknown> | null
        if (typeof object.pounds !== 'number' || !Number.isFinite(object.pounds)
          || object.pounds <= 0 || object.pounds > 1_000_000_000
          || !position || !Number.isSafeInteger(position.x)
          || !Number.isSafeInteger(position.y) || !Number.isSafeInteger(position.z)
          || (position.x as number) < 0 || (position.y as number) < 0 || (position.z as number) < 0
          || (position.x as number) >= input.map.dimensions.x
          || (position.y as number) >= input.map.dimensions.y
          || (position.z as number) >= input.map.dimensions.z) {
          return fail('physical-power-object-invalid', `Physical load object ${objectIds[index]} lacks bounded exact pounds or position.`)
        }
        if (!physicalPowerObjectIsAdjacent(actorToken, {
          x: position.x as number, y: position.y as number, z: position.z as number,
        })) {
          return fail('physical-power-object-not-adjacent', `Physical load object ${objectIds[index]} is not adjacent to the actor.`)
        }
        if (capabilityWorldObjectHasAttachment(object)) {
          return fail('physical-power-object-attached', `Physical load object ${objectIds[index]} is already attached to an authoritative source.`)
        }
        return object
      })
      if (ownedObjects.some(object => object.attachedCapabilityInstanceId !== input.command.capabilityInstanceId)) {
        fail('physical-power-source-conflict', 'One actor cannot carry physical loads from contradictory Power sources.')
      }
      if (ownedObjects.length + selected.length > 16) {
        fail('physical-power-object-limit', 'One physical Power load may bind at most sixteen authoritative objects.')
      }
      const pounds = [...ownedObjects, ...selected].reduce((total, object) => total + (object.pounds as number), 0)
      if (resolveCapabilityPowerLoad(power, pounds).loadClass === 'too-heavy') {
        fail('physical-power-load-too-heavy', 'The combined load must be strictly lighter than the printed Drag Weight limit.')
      }
    }
  }

  if (input.command.actionId === 'shelter-baby') {
    if (input.actor.sheetKind !== 'pokemon'
      || (input.actorSheet as CharacterSheet).species.trim().toLocaleLowerCase('en-US') !== 'kangaskhan'
      || ((input.actorSheet as CharacterSheet).level ?? 0) < 25) {
      fail('marsupial-mother-invalid', 'Marsupial pouch shelter requires a mother Kangaskhan actor.')
    }
    const baby = targets[0]
    const babySheet = targetSheets[0]
    if (!baby || baby.sheetKind !== 'pokemon' || !babySheet
      || (babySheet as CharacterSheet).species.trim().toLocaleLowerCase('en-US') !== 'kangaskhan'
      || (babySheet.level ?? 0) >= 25
      || !pokemonHasResolvedCapability(babySheet as CharacterSheet, 'Marsupial')
      || !pokemonHasActiveMarsupialBabyTemplate(babySheet as CharacterSheet)) {
      fail('marsupial-baby-invalid', 'Marsupial pouch shelter requires an adjacent Kangaskhan with current server-owned Baby Template authority below Level 25.')
    }
    if (!['experience-share:0', 'experience-share:20'].includes(input.command.selections.optionId ?? '')) {
      fail('marsupial-experience-choice-invalid', 'Marsupial shelter must retain the Trainer’s 0% or 20% Experience-sharing choice.')
    }
    const babyTarget = baby!
    const motherRelationship = resolveMarsupialRelationship({
      subjectSlug: input.actor.sheetSlug,
      pokemonBySlug: input.pokemonSheets,
    })
    const babyRelationship = resolveMarsupialRelationship({
      subjectSlug: babyTarget.sheetSlug,
      pokemonBySlug: input.pokemonSheets,
    })
    const corruptRelationship = motherRelationship.status === 'corrupt'
      ? motherRelationship
      : babyRelationship.status === 'corrupt' ? babyRelationship : null
    if (corruptRelationship) fail(corruptRelationship.reasonCode, corruptRelationship.message)
    if (motherRelationship.status === 'valid' || babyRelationship.status === 'valid') {
      fail('marsupial-pouch-already-bound', 'A persistent Marsupial mother or baby relationship is already established.')
    }
    const links = input.map.encounterState?.capabilityRuntime?.links ?? []
    if (links.some(link => link.kind === 'marsupial-pouch'
      && (link.ownerPlacementId === input.actor.id || link.participantPlacementIds.includes(baby!.id)))) {
      fail('marsupial-pouch-already-linked', 'The mother or baby already has an authoritative Marsupial pouch link.')
    }
  }

  const physicalCapabilityAttackTargeting = input.command.actionId === 'telekinetic-maneuver'
    || (input.command.actionId === 'threaded-shift' && input.command.selections.optionId === 'unwilling-target')
  const attackLikeTargeting = physicalCapabilityAttackTargeting
    || input.command.actionId === 'distract-with-alluring'
  if (attackLikeTargeting && Array.isArray(input.map.metadata?.capabilityMarsupialPouches)) {
    const protectedBabyIds = new Set(input.map.metadata.capabilityMarsupialPouches.flatMap((raw): readonly string[] => {
      const pouch = raw as Record<string, unknown>
      if (typeof pouch?.motherPlacementId !== 'string' || typeof pouch?.babyPlacementId !== 'string') return []
      const motherPlacementId = pouch.motherPlacementId
      const babyPlacementId = pouch.babyPlacementId
      const mother = input.map.placements.find(placement => placement.id === motherPlacementId)
      const sourceLink = input.map.encounterState?.capabilityRuntime?.links.find(link => (
        link.kind === 'marsupial-pouch'
        && link.ownerPlacementId === motherPlacementId
        && link.participantPlacementIds.includes(babyPlacementId)
        && (typeof pouch.capabilityInstanceId !== 'string' || link.capabilityInstanceId === pouch.capabilityInstanceId)
      ))
      const motherSheet = mother?.sheetKind === 'pokemon' ? input.pokemonSheets.get(mother.sheetSlug) : null
      const baby = input.map.placements.find(placement => placement.id === babyPlacementId)
      const babySheet = baby?.sheetKind === 'pokemon' ? input.pokemonSheets.get(baby.sheetSlug) : null
      const parentalBondActive = baby && babySheet
        ? effectiveRuntimeAbilityIds({ map: input.map, placement: baby, sheet: babySheet }).includes('Parental Bond')
        : false
      const motherToken = sourceLink && mother && motherSheet ? placementToSpawned(mother, {
        pokemon: new Map(input.pokemonSheets),
        trainer: new Map(input.trainerSheets),
      }, input.map) : null
      return (motherToken?.currentHp ?? 0) > 0 && !parentalBondActive ? [babyPlacementId] : []
    }))
    if (targets.some(target => protectedBabyIds.has(target.id))) {
      fail('marsupial-baby-protected', 'A conscious mother prevents attacks from targeting the Baby-Template Kangaskhan in her pouch.')
    }
  }
  for (let index = 0; index < targets.length; index += 1) {
    const effective = resolveEffectiveCapabilities({
      map: input.map,
      placement: targets[index]!,
      sheet: targetSheets[index]!,
      sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
    })
    if ((input.command.actionId === 'read-dream' || input.command.actionId === 'read-mind')
      && effective.instances.some(instance => instance.effective && instance.canonicalId === 'Mindlock')) {
      fail('target-mindlocked', 'Mindlock prevents this Capability information action.')
    }
    if (physicalCapabilityAttackTargeting) {
      const effectiveInstanceIds = new Set(effective.instances
        .filter(instance => instance.effective)
        .map(instance => instance.instanceId))
      const intangible = input.map.encounterState?.capabilityRuntime?.modes.some(mode => (
        mode.actorPlacementId === targets[index]!.id
        && mode.mode === 'intangible'
        && effectiveInstanceIds.has(mode.capabilityInstanceId)
        && (mode.expiresAt === null || mode.expiresAt > input.now)
      )) === true
      if (intangible) fail('target-intangible', 'Intangible targets cannot be targeted by Capability attacks.')
    }
  }

  const focus = skillDice(input.actorSheet, input.actor.sheetKind, 'focus')
  const farReadingFocus = focus + (input.actor.sheetKind === 'pokemon'
    && hasPokemonCapabilityEdge(input.actorSheet as CharacterSheet, 'Far Reading') ? 2 : 0)
  const telekineticFocus = focus + (input.actor.sheetKind === 'pokemon'
    && hasPokemonCapabilityEdge(input.actorSheet as CharacterSheet, 'TK Mastery') ? 2 : 0)
  if (context === 'mind-in-focus-range' && targets.some(target => distance(input.actor, target) > farReadingFocus * 2)) {
    fail('target-out-of-range', `Telepathy targets must be within ${farReadingFocus * 2} metres.`)
  }
  if (context === 'maneuver-target-in-focus-range' && targets.some(target => distance(input.actor, target) > telekineticFocus)) {
    fail('target-out-of-range', `Telekinetic maneuver targets must be within ${telekineticFocus} metres.`)
  }
  if (context === 'communication-targets' && targets.length > Math.floor(focus / 2)) {
    fail('too-many-targets', `Telepathy may project to at most ${Math.floor(focus / 2)} targets.`)
  }

  if (context === 'object-in-8m' || context === 'anchor-or-target-in-4m' || context === 'visible-cell') {
    const threadedRange = input.actor.sheetKind === 'pokemon'
      && hasPokemonCapabilityEdge(input.actorSheet as CharacterSheet, 'Precise Threadings') ? 6 : 4
    const maximum = context === 'object-in-8m' ? 8
      : context === 'anchor-or-target-in-4m' ? threadedRange : Number.POSITIVE_INFINITY
    if (input.command.selections.cells.some(cell => Math.max(
      Math.abs(cell.x - input.actor.position.x),
      Math.abs(cell.y - input.actor.position.y),
      Math.abs(cell.z - input.actor.position.z),
    ) > maximum)) fail('cell-out-of-range', `Selected Capability cell exceeds its reviewed ${maximum}-metre range.`)
  }

  if (input.action.requiresGmConfirmation && input.command.selections.gmConfirmed
    && !input.command.selections.description?.trim() && !input.command.selections.optionId?.trim()) {
    fail('adjudication-choice-required', 'A confirmed bounded Capability adjudication requires a retained choice or description.')
  }

  if (input.command.actionId === 'sprout' && input.command.selections.gmConfirmed) {
    const option = input.command.selections.optionId ?? ''
    const berry = /^berry-yield:item:([^;]{1,100});qty:(\d{1,2})$/.exec(option)
    if (option === 'growth') {
      if (input.command.selections.cells.length !== 1 || !input.command.selections.description?.trim()) {
        fail('sprouter-growth-choice-invalid', 'Sprouter growth requires one exact plant cell and a bounded GM-authored growth result.')
      }
    }
    else if (berry) {
      const itemName = canonicalPtuBerryName(berry[1]!)
      const quantity = Number(berry[2])
      if (!itemName || quantity < 1 || quantity > 20) {
        fail('sprouter-berry-yield-invalid', 'Sprouter Berry yield requires a canonical Berry and bounded quantity 1–20.')
      }
      const requested = input.command.selections.recipientTrainerSlug
      if (requested && !linkedTrainerSheets(input.actor, input.trainerSheets).some(trainer => trainer.slug === requested)) {
        fail('item-recipient-invalid', 'Sprouter Berry yield recipient must be linked to the actor.')
      }
    }
    else fail('sprouter-branch-invalid', 'Sprouter requires growth or a bounded canonical Berry yield branch.')
  }

  if (input.command.actionId === 'lure-with-alluring'
    || input.command.actionId === 'resolve-alluring-lure-check'
    || input.command.actionId === 'abandon-alluring-lure') {
    const task = input.map.encounterState?.capabilityRuntime?.tasks.find(candidate => (
      candidate.kind === 'alluring-lure'
      && candidate.actorPlacementId === input.actor.id
      && candidate.capabilityInstanceId === input.command.capabilityInstanceId
      && candidate.canonicalId === 'Alluring'
    ))
    if (input.command.actionId !== 'lure-with-alluring') {
      if (!task) return fail('alluring-lure-task-missing', 'The exact source-owned Alluring lure is no longer active.')
      if (input.command.actionId === 'resolve-alluring-lure-check' && input.now < task.completesAt) {
        fail('alluring-lure-check-not-due', 'The next Alluring lure check is not due yet.')
      }
      if (input.command.selections.cells.length > 0
        || input.command.selections.targetPlacementIds.length > 0
        || input.command.selections.optionId !== null
        || input.command.selections.recipientTrainerSlug !== null
        || input.command.selections.canonicalItemId !== null
        || input.command.selections.description !== null
        || input.command.selections.gmConfirmed) {
        fail('alluring-lure-continuation-selection-invalid', 'Alluring lure continuation actions do not accept new client choices.')
      }
      return
    }
    if (task) fail('alluring-lure-already-active', 'This exact Alluring source already has an active lure.')
    if (input.command.selections.cells.length !== 1) {
      fail('alluring-lure-cell-required', 'Alluring lure use requires one authoritative encounter placement cell.')
    }
    const cell = input.command.selections.cells[0]!
    if (cell.x < 0 || cell.y < 0 || cell.z < 0
      || cell.x >= input.map.dimensions.x || cell.y >= input.map.dimensions.y || cell.z >= input.map.dimensions.z) {
      fail('alluring-lure-cell-invalid', 'Alluring lure placement must be within authoritative map bounds.')
    }
    if (input.command.selections.gmConfirmed) {
      const match = /^species:([^;]{1,80});level:(\d{1,3})$/.exec(input.command.selections.optionId ?? '')
      const level = Number(match?.[2])
      if (!match || level < 1 || level > 100 || !pokedexBySpecies.has(match[1]!.trim().toLocaleLowerCase('en-US'))) {
        fail('alluring-encounter-choice-invalid', 'The GM must retain one canonical species and Level 1–100 for a successful lure encounter.')
      }
    }
  }

  if (input.command.actionId === 'enter-machine' || input.command.actionId === 'exit-machine') {
    const cell = input.command.selections.cells.length === 1 ? input.command.selections.cells[0] : null
    const deviceId = input.command.selections.optionId
    const devices = Array.isArray(input.map.metadata?.capabilityDevices)
      ? input.map.metadata.capabilityDevices as unknown[] : []
    const device = devices.map(raw => raw as Record<string, unknown>).find(candidate => {
      const position = candidate?.position as Record<string, unknown> | undefined
      return candidate?.id === deviceId && cell && position?.x === cell.x && position.y === cell.y && position.z === cell.z
    })
    if (!device) fail('wired-device-invalid', 'Wired requires an exact authoritative electronic device and cell.')
    if (input.command.actionId === 'enter-machine' && cell
      && Math.max(Math.abs(cell.x - input.actor.position.x), Math.abs(cell.y - input.actor.position.y), Math.abs(cell.z - input.actor.position.z)) > 1) {
      fail('wired-device-not-adjacent', 'Wired machine entry requires an adjacent electronic device.')
    }
    if (input.command.actionId === 'exit-machine') {
      const mode = input.map.encounterState?.capabilityRuntime?.modes.find(entry => (
        entry.actorPlacementId === input.actor.id
        && entry.mode === 'inside-machine'
        && entry.capabilityInstanceId === input.command.capabilityInstanceId
        && entry.canonicalId === input.command.canonicalId
        && (entry.expiresAt === null || entry.expiresAt > input.now)
      ))
      const source = devices.map(raw => raw as Record<string, unknown>).find(candidate => candidate.id === mode?.configurationId)
      const sourceNetworkId = typeof source?.networkId === 'string'
        && /^[A-Za-z0-9._:/-]{1,160}$/.test(source.networkId) ? source.networkId : null
      const destinationNetworkId = typeof device!.networkId === 'string'
        && /^[A-Za-z0-9._:/-]{1,160}$/.test(device!.networkId) ? device!.networkId : null
      const exitingOccupiedDevice = source?.id === device!.id
      if (!source || (!exitingOccupiedDevice
        && (!sourceNetworkId || !destinationNetworkId || sourceNetworkId !== destinationNetworkId))) {
        fail('wired-device-not-connected', 'Wired exit destinations must be the occupied device or share its exact authoritative network.')
      }
    }
    if (input.command.actionId === 'enter-machine') {
      const isRotom = input.actor.sheetKind === 'pokemon'
        && (input.actorSheet as CharacterSheet).species.trim().toLocaleLowerCase('en-US').includes('rotom')
      if (!isRotom && input.command.selections.description?.trim()) {
        fail('wired-machine-move-prohibited', 'Only Rotom may gain a GM-designated Move from a Wired machine.')
      }
      if (isRotom && input.command.selections.gmConfirmed
        && !findMove(input.command.selections.description ?? '')) {
        fail('wired-rotom-move-invalid', 'Rotom machine entry requires a retained canonical GM-designated Move.')
      }
    }
  }

  if (input.command.actionId === 'synchronize-keystone') {
    if (input.actor.sheetKind !== 'pokemon') fail('pokemon-actor-required', 'Keystone synchronization requires a Pokémon actor.')
    const actor = input.actorSheet as CharacterSheet
    const available = computePokemonTutorPointsEarnedForSheet(actor) - Math.max(0, actor.tutorPoints?.spent ?? 0)
    if (available < 2) fail('tutor-points-required', 'Keystone synchronization requires 2 available Tutor Points.')
    const keystoneId = input.command.selections.canonicalItemId
    const synchronizedIds = new Set(parseCapabilityCampaignState(actor.capabilityCampaignState).keystoneSynchronizations
      .map(entry => entry.keystoneId))
    const keystones = Array.isArray(input.map.metadata?.capabilityKeystones)
      ? input.map.metadata.capabilityKeystones as unknown[] : []
    const linkedTrainerSlugs = new Set(linkedTrainerSheets(input.actor, input.trainerSheets).map(trainer => trainer.slug))
    if (!keystoneId || !keystones.some(raw => {
      const keystone = raw as Record<string, unknown>
      const ownerTrainerSlug = typeof keystone?.ownerTrainerSlug === 'string' ? keystone.ownerTrainerSlug : null
      const accessible = ownerTrainerSlug !== null
        ? linkedTrainerSlugs.has(ownerTrainerSlug)
        : hasContext(input.map, `keystone-access:${input.actor.id}:${keystoneId}`)
      return keystone?.id === keystoneId && accessible && !synchronizedIds.has(String(keystoneId))
        && Array.isArray(keystone.synchronizedPlacementIds)
        && !keystone.synchronizedPlacementIds.includes(input.actor.id)
    })) fail('keystone-resource-invalid', 'Keystone synchronization requires an exact accessible, unsynchronized Odd Keystone resource.')
  }

  if (input.command.actionId === 'jump') {
    resolveCapabilityJumpPlan({
      map: input.map,
      actor: input.actor,
      actorSheet: input.actorSheet,
      pokemonSheets: input.pokemonSheets,
      trainerSheets: input.trainerSheets,
      command: input.command,
      now: input.now,
    })
  }

  if (input.command.actionId === 'teleport') {
    let roundIdentity
    try {
      roundIdentity = teleporterRoundIdentity(input.map)
    }
    catch (error) {
      if (error instanceof TeleporterRoundIdentityError) fail(error.code, error.message)
      throw error
    }
    if (input.command.selections.cells.length !== 1) fail('teleport-destination-required', 'Teleporter requires one authoritative destination cell.')
    const destination = input.command.selections.cells[0]!
    const effective = resolveEffectiveCapabilities({
      map: input.map, placement: input.actor, sheet: input.actorSheet,
      sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
    })
    const teleporter = effective.instances.find(instance => (
      instance.instanceId === input.command.capabilityInstanceId
      && instance.effective && instance.canonicalId === 'Teleporter'
    ))
    const staticSpeeds = Object.fromEntries(([
      ['Overland', 'overland'], ['Sky', 'sky'], ['Swim', 'swim'],
      ['Levitate', 'levitate'], ['Burrow', 'burrow'], ['Teleporter', 'teleporter'],
    ] as const).flatMap(([canonicalId, key]) => {
      const instance = effective.instances.find(candidate => candidate.effective && candidate.canonicalId === canonicalId)
      const value = instance?.value ?? (instance?.parameters.kind === 'value' ? instance.parameters.value : null)
      if (value === null || value === undefined) return []
      return [[key, conditionAdjustedMovementCapability(canonicalId, value, actorConditions)]]
    }))
    const actorToken = placementToSpawned(input.actor, {
      pokemon: new Map(input.pokemonSheets), trainer: new Map(input.trainerSheets),
    }, input.map)
    const movement = projectEffectiveMovement({
      sheetCapabilities: staticSpeeds,
      sheetTraits: actorToken?.movementTraits,
      sheetConditions: actorConditions,
      encounterEffects: input.map.encounterState?.effects,
      target: {
        placementId: input.actor.id,
        ...(input.actor.sideId === undefined ? {} : { sideId: input.actor.sideId }),
        position: input.actor.position,
        base: actorToken?.base ?? 1,
        clearance: actorToken ? getClearanceValue(actorToken) : 1,
      },
    })
    const capabilityLimit = teleporter ? movement.speeds.teleporter ?? 0 : 0
    const loadLimit = physicalPowerMovementLimit(actingPhysicalLoad, input.map.initiative?.round)
    const limit = loadLimit === null ? capabilityLimit : Math.min(capabilityLimit, loadLimit)
    const travel = ptuGridVectorDistance({
      x: destination.x - input.actor.position.x,
      y: destination.y - input.actor.position.y,
      z: destination.z - input.actor.position.z,
    })
    if (limit < 1 || travel < 1 || travel > limit) fail('teleport-range-invalid', `Teleporter destination must be within ${limit} metres.`)
    const sheetLookup = {
      pokemon: new Map(input.pokemonSheets),
      trainer: new Map(input.trainerSheets),
    }
    const sightPlacements = input.map.placements.flatMap(placement => {
      const token = placementToSpawned(placement, sheetLookup, input.map)
      const sheet = placement.sheetKind === 'pokemon'
        ? input.pokemonSheets.get(placement.sheetSlug)
        : input.trainerSheets.get(placement.sheetSlug)
      if (!token || !sheet) return []
      const effectiveIds = new Set(resolveEffectiveCapabilities({
        map: input.map, placement, sheet,
        sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
      }).instances.filter(instance => instance.effective).map(instance => instance.instanceId))
      const inflated = input.map.encounterState?.capabilityRuntime?.modes.some(mode => (
        mode.actorPlacementId === placement.id && mode.mode === 'inflated'
        && effectiveIds.has(mode.capabilityInstanceId)
        && (mode.expiresAt === null || mode.expiresAt > input.now)
      )) === true
      return [{
        id: placement.id,
        position: placement.position,
        base: inflated ? Math.max(1, Math.ceil(token.base * 1.25)) : token.base,
        clearance: inflated ? Math.max(1, Math.ceil(getClearanceValue(token) * 1.25)) : getClearanceValue(token),
        ...(inflated ? { blocksSight: true } : {}),
      }]
    })
    const linkedCompanionPlacementIds = capabilityLinkedMovementPlacementIds(input, input.actor.id)
    const movingIds = new Set([input.actor.id, ...linkedCompanionPlacementIds])
    const movingFootprints = sightPlacements.filter(footprint => movingIds.has(footprint.id))
    if (movingFootprints.length !== movingIds.size) {
      fail('teleport-linked-footprint-missing', 'Teleporter requires every linked movement footprint to resolve authoritatively.')
    }
    const composite = {
      base: Math.max(...movingFootprints.map(footprint => footprint.base)),
      clearance: Math.max(...movingFootprints.map(footprint => footprint.clearance)),
    }
    let destinationId = 'capability.teleport.destination'
    while (input.map.placements.some(placement => placement.id === destinationId)) destinationId = `${destinationId}.x`
    const lineOfSight = createMoveAutomationLineOfSightResolver({
      voxels: input.map.voxels,
      placements: [...sightPlacements, { id: destinationId, position: destination, ...composite }],
    }).resolve(input.actor.id, destinationId)
    if (!lineOfSight.targetable) fail('teleport-line-of-sight-blocked', 'Teleporter requires authoritative line of sight to the complete destination footprint.')
    const sky = movement.speeds.sky ?? 0
    const levitate = movement.speeds.levitate ?? 0
    const groundLevelY = input.map.groundLevelY ?? 0
    const blockingVoxels = input.map.voxels.filter(voxel => (
      voxel.blocksMovement ?? getVoxelMaterialDefinition(voxel).blocksMovementDefault ?? false
    ))
    const blockingKeys = new Set(blockingVoxels.map(voxel => `${voxel.x}:${voxel.y}:${voxel.z}`))
    const bodyCells = [] as Array<{ x: number; y: number; z: number }>
    for (let y = destination.y; y < destination.y + composite.clearance; y += 1) {
      for (let z = destination.z; z < destination.z + composite.base; z += 1) {
        for (let x = destination.x; x < destination.x + composite.base; x += 1) bodyCells.push({ x, y, z })
      }
    }
    const touchesSurface = destination.y === groundLevelY || bodyCells.some(cell => (
      ([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const)
        .some(([dx, dy, dz]) => blockingKeys.has(`${cell.x + dx}:${cell.y + dy}:${cell.z + dz}`))
    ))
    let maximumAirHeight = 0
    for (let z = destination.z; z < destination.z + composite.base; z += 1) {
      for (let x = destination.x; x < destination.x + composite.base; x += 1) {
        const supportY = blockingVoxels
          .filter(voxel => voxel.x === x && voxel.z === z && voxel.y < destination.y)
          .reduce<number | null>((highest, voxel) => highest === null || voxel.y > highest ? voxel.y : highest, null)
        maximumAirHeight = Math.max(maximumAirHeight, destination.y - (supportY === null ? groundLevelY : supportY + 1))
      }
    }
    const levitateHeightLegal = levitate > 0 && maximumAirHeight <= Math.floor(levitate / 2)
    if (!touchesSurface && sky <= 0 && !levitateHeightLegal) {
      fail('teleport-surface-required', 'Every linked Teleporter footprint must end touching a surface unless Sky or legal Levitate height supports it.')
    }
    const relocation = resolveAuthoritativeRelocation({
      map: input.map,
      sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
      placementId: input.actor.id,
      now: input.now,
      mode: 'teleport',
      destination,
      ignoredPlacementIds: linkedCompanionPlacementIds,
      linkedCompanionPlacementIds,
    })
    if (!relocation.ok) fail(relocation.reasonCode, relocation.message)
    if (roundIdentity && teleporterRoundUseSpent({
      map: input.map,
      placementId: input.actor.id,
      identity: roundIdentity,
    })) fail('teleport-round-use-spent', 'Teleporter may be used only once per authoritative encounter-history round.')
  }

  if (input.command.actionId === 'keystone-warp') {
    const cell = input.command.selections.cells.length === 1 ? input.command.selections.cells[0] : null
    const synchronizedIds = input.actor.sheetKind === 'pokemon'
      ? new Set(parseCapabilityCampaignState((input.actorSheet as CharacterSheet).capabilityCampaignState)
          .keystoneSynchronizations.map(entry => entry.keystoneId))
      : new Set<string>()
    const keystones = Array.isArray(input.map.metadata?.capabilityKeystones)
      ? input.map.metadata.capabilityKeystones as unknown[] : []
    const synchronized = cell && keystones.some(raw => {
      const keystone = raw as Record<string, unknown>
      const position = keystone?.position as Record<string, unknown> | undefined
      return keystone && typeof keystone === 'object'
        && (synchronizedIds.has(String(keystone.id))
          || (Array.isArray(keystone.synchronizedPlacementIds)
            && keystone.synchronizedPlacementIds.includes(input.actor.id)))
        && position?.x === cell.x && position.y === cell.y && position.z === cell.z
    })
    if (!synchronized) fail('keystone-destination-invalid', 'Keystone Warp requires an exact synchronized Odd Keystone destination.')
  }

  if (input.command.actionId === 'manipulate-object' || input.command.actionId === 'manipulate-metal') {
    const ids = selectedWorldObjectIds(input.command.selections.optionId)
    if (!ids.length || new Set(ids).size !== ids.length) {
      fail('capability-object-selection-invalid', 'Object manipulation requires one to sixteen unique authoritative object IDs.')
    }
    const allObjects = capabilityWorldObjects(input.map)
    const objects = ids.map(id => allObjects.find(candidate => candidate.id === id)
      ?? fail('capability-object-missing', `Capability world object ${id} is unavailable.`))
    if (objects.some((object) => {
      if (!capabilityWorldObjectHasAttachment(object.raw)) return false
      return !(input.command.actionId === 'manipulate-metal'
        && object.raw.attachedToPlacementId === input.actor.id
        && object.raw.attachedCapabilityInstanceId === input.command.capabilityInstanceId
        && object.raw.attachedCapabilityCanonicalId === 'Magnetic'
        && object.raw.attachmentKind === 'magnetic')
    })) {
      fail('capability-object-attached', 'Object manipulation cannot move an object attached to another authoritative source.')
    }
    const destination = input.command.selections.cells.length === 1
      ? input.command.selections.cells[0]!
      : fail('capability-object-destination-required', 'Object manipulation requires one authoritative destination cell.')
    const delta = {
      x: destination.x - objects[0]!.position.x,
      y: destination.y - objects[0]!.position.y,
      z: destination.z - objects[0]!.position.z,
    }
    const blockingCells = new Set(input.map.voxels.filter(voxel => (
      voxel.blocksMovement ?? getVoxelMaterialDefinition(voxel).blocksMovementDefault ?? false
    )).map(voxel => `${voxel.x}:${voxel.y}:${voxel.z}`))
    const movedCells = objects.map(object => ({
      x: object.position.x + delta.x, y: object.position.y + delta.y, z: object.position.z + delta.z,
    }))
    const selectedIds = new Set(objects.map(object => object.id))
    const stationaryObjectCells = new Set(allObjects.filter(object => !selectedIds.has(object.id))
      .map(object => `${object.position.x}:${object.position.y}:${object.position.z}`))
    const lookup = { pokemon: new Map(input.pokemonSheets), trainer: new Map(input.trainerSheets) }
    const placementFootprints = input.map.placements.flatMap((placement) => {
      const token = placementToSpawned(placement, lookup, input.map)
      return token ? [{ id: placement.id, position: placement.position, base: token.base, clearance: getClearanceValue(token) }] : []
    })
    if (movedCells.some(moved => moved.x < 0 || moved.y < 0 || moved.z < 0
      || moved.x >= input.map.dimensions.x || moved.y >= input.map.dimensions.y || moved.z >= input.map.dimensions.z
      || blockingCells.has(`${moved.x}:${moved.y}:${moved.z}`)
      || stationaryObjectCells.has(`${moved.x}:${moved.y}:${moved.z}`)
      || placementFootprints.some(footprint => (
        !(input.command.actionId === 'manipulate-metal' && footprint.id === input.actor.id
          && moved.x === input.actor.position.x && moved.y === input.actor.position.y && moved.z === input.actor.position.z)
        && moved.x >= footprint.position.x && moved.x < footprint.position.x + footprint.base
        && moved.y >= footprint.position.y && moved.y < footprint.position.y + footprint.clearance
        && moved.z >= footprint.position.z && moved.z < footprint.position.z + footprint.base
      )))) fail('capability-object-destination-blocked', 'Every manipulated object must end in an unoccupied, unblocked authoritative map cell.')
    if (input.command.actionId === 'manipulate-metal') {
      if (objects.some(object => object.material !== 'iron' && object.material !== 'steel')) {
        fail('magnetic-material-invalid', 'Magnetic manipulation accepts only authoritative iron or steel objects.')
      }
      if (!hasContext(input.map, 'iron-or-steel-object')) {
        fail('magnetic-context-required', 'Magnetic manipulation requires its bounded GM-authored world context.')
      }
    }
    else {
      if (objects.some(object => Math.max(
        Math.abs(object.position.x - input.actor.position.x),
        Math.abs(object.position.y - input.actor.position.y),
        Math.abs(object.position.z - input.actor.position.z),
      ) > 8)) fail('capability-object-out-of-range', 'Telekinetic targets must begin within 8 metres.')
      if (Math.max(
        Math.abs(destination.x - input.actor.position.x),
        Math.abs(destination.y - input.actor.position.y),
        Math.abs(destination.z - input.actor.position.z),
      ) > 8) fail('capability-object-destination-out-of-range', 'Telekinetic destinations must remain within 8 metres.')
      const load = resolveCapabilityPowerLoad(telekineticFocus, objects.reduce((total, object) => total + object.pounds, 0))
      if (load.loadClass === 'too-heavy') fail('telekinetic-load-too-heavy', 'The selected objects exceed the user’s Telekinetic Drag Weight.')
      if (load.loadClass === 'drag' && delta.y !== 0) {
        fail('telekinetic-drag-must-stay-level', 'Drag-weight Telekinesis cannot lift objects vertically.')
      }
    }
  }

  if (input.command.actionId === 'read-mind'
    && !['aware', 'unaware'].includes(input.command.selections.optionId ?? '')) {
    fail('telepathy-awareness-invalid', 'Telepathy must retain whether the target is aware or unaware of the attempt.')
  }

  if (input.command.actionId === 'read-aura' && input.command.selections.gmConfirmed
    && !/^hue:[A-Za-z0-9._ -]{1,40};tone:(?:brightened|darkened|neutral)$/.test(input.command.selections.optionId ?? '')) {
    fail('aura-reading-result-invalid', 'Aura Reader requires a retained hue and brightened, darkened, or neutral tone result.')
  }

  if (input.command.actionId === 'create-illusion') {
    const match = /^size-mm:(\d{1,3})x(\d{1,3})x(\d{1,3});motion:(static|minor|major)$/.exec(input.command.selections.optionId ?? '')
    if (!match || [match[1], match[2], match[3]].some(value => Number(value) < 1 || Number(value) > 500)) {
      fail('illusion-parameters-invalid', 'Illusionist dimensions must each be 1–500 mm with a static, minor, or major motion branch.')
    }
  }
  if (input.command.actionId === 'create-illusion' || input.command.actionId === 'reposition-illusion') {
    if (input.command.selections.cells.length !== 1) fail('illusion-cell-required', 'Illusionist requires one visible authoritative cell.')
    const cell = input.command.selections.cells[0]!
    if (Math.max(Math.abs(cell.x - input.actor.position.x), Math.abs(cell.y - input.actor.position.y), Math.abs(cell.z - input.actor.position.z)) > focus) {
      fail('illusion-out-of-range', `Illusions must remain within the user’s Focus Rank (${focus} metres).`)
    }
    if (input.command.actionId === 'reposition-illusion') {
      const mode = input.map.encounterState?.capabilityRuntime?.modes.find(entry => (
        entry.actorPlacementId === input.actor.id
        && entry.capabilityInstanceId === input.command.capabilityInstanceId
        && entry.canonicalId === input.command.canonicalId
        && entry.mode === 'illusion'
        && (entry.expiresAt === null || entry.expiresAt > input.now)
        && /(?:^|;)motion:(?:minor|major)$/.test(entry.configurationId ?? '')
      ))
      const illusion = mode && Array.isArray(input.map.metadata?.capabilityIllusions)
        ? input.map.metadata.capabilityIllusions.some(raw => {
            const record = raw as Record<string, unknown>
            return record?.ownerPlacementId === input.actor.id
              && record.sourceOperationId === mode.sourceOperationId
              && record.parameters === mode.configurationId
          }) : false
      if (!mode || !illusion) fail('moving-illusion-missing', 'Only an active minor or major moving Illusion can be repositioned.')
    }
    const lookup = { pokemon: new Map(input.pokemonSheets), trainer: new Map(input.trainerSheets) }
    const placements = input.map.placements.flatMap((placement) => {
      const token = placementToSpawned(placement, lookup, input.map)
      return token ? [{
        id: placement.id, position: placement.position, base: token.base, clearance: getClearanceValue(token),
      }] : []
    })
    let destinationId = 'capability.illusion.destination'
    while (input.map.placements.some(placement => placement.id === destinationId)) destinationId += '.x'
    if (!createMoveAutomationLineOfSightResolver({
      voxels: input.map.voxels,
      placements: [...placements, { id: destinationId, position: cell, base: 1, clearance: 1 }],
    }).resolve(input.actor.id, destinationId).targetable) {
      fail('illusion-line-of-sight-blocked', 'Illusionist requires authoritative line of sight to the selected cell.')
    }
  }
  if (input.command.actionId === 'change-shape') {
    const match = /^mass-percent:(\d{2,3});kind:(organic|simple-object|machine-appearance)$/.exec(input.command.selections.optionId ?? '')
    const percent = Number(match?.[1])
    if (!match || percent < 50 || percent > 150) {
      fail('shape-parameters-invalid', 'Shapeshifter mass must remain from 50% through 150% with a reviewed shape kind.')
    }
  }

  if (input.command.actionId === 'communicate' && input.command.canonicalId === 'Aura Pulse') {
    if (!['project-only', 'exchange-surface-thoughts'].includes(input.command.selections.optionId ?? '')) {
      fail('aura-pulse-option-invalid', 'Aura Pulse must retain project-only or exchange-surface-thoughts.')
    }
    if (input.command.selections.optionId === 'exchange-surface-thoughts'
      && targets.some(target => !targetIsWilling(input.map, input.actor.id, target.id))) {
      fail('target-not-willing', 'Aura Pulse may read only minds with retained authoritative willingness.')
    }
  }
  if (input.command.actionId === 'project-thought') {
    const actorIsPokemon = input.actor.sheetKind === 'pokemon'
    if (actorIsPokemon && targets.some((target, index) => {
      if (target.sheetKind === 'trainer') return false
      const effective = resolveEffectiveCapabilities({
        map: input.map,
        placement: target,
        sheet: targetSheets[index]!,
        sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
      })
      return !effective.instances.some(instance => instance.effective && instance.canonicalId === 'Telepath')
    })) fail('telepath-projection-target-invalid', 'Pokémon Telepaths may project to Trainers or other Telepaths.')
  }

  if (input.command.actionId === 'threaded-shift') {
    const cells = input.command.selections.cells
    const threadedRange = input.actor.sheetKind === 'pokemon'
      && hasPokemonCapabilityEdge(input.actorSheet as CharacterSheet, 'Precise Threadings') ? 6 : 4
    const branch = input.command.selections.optionId ?? ''
    const objectBranch = branch === 'object'
    if (objectBranch) {
      if (targets.length !== 0 || cells.length !== 1 || !input.command.selections.canonicalItemId) {
        fail('threaded-object-invalid', 'Threaded object use requires one object cell and exact authoritative object identity.')
      }
      const object = capabilityWorldObjects(input.map).find(candidate => candidate.id === input.command.selections.canonicalItemId)
        ?? fail('threaded-object-missing', 'The selected authoritative Threaded object is unavailable.')
      if (capabilityWorldObjectHasAttachment(object.raw)) {
        fail('threaded-object-attached', 'Threaded cannot independently move an object attached to another authoritative source.')
      }
      const cell = cells[0]!
      if (object.position.x !== cell.x || object.position.y !== cell.y || object.position.z !== cell.z) {
        fail('threaded-object-cell-mismatch', 'The selected Threaded cell must match the authoritative object position.')
      }
      if (Math.max(
        Math.abs(cell.x - input.actor.position.x),
        Math.abs(cell.y - input.actor.position.y),
        Math.abs(cell.z - input.actor.position.z),
      ) > threadedRange) fail('target-out-of-range', `Threaded has a maximum range of ${threadedRange} metres.`)
      if (worldObjectWeightClass(object.pounds) < 1) fail('threaded-object-weight-invalid', 'Threaded requires authoritative object weight.')
    }
    else {
      if ((targets.length === 1 ? 1 : 0) + (cells.length === 1 ? 1 : 0) !== 1) {
        fail('threaded-target-invalid', 'Threaded Shift requires exactly one target or anchor cell.')
      }
      if (targets.length === 1 && distance(input.actor, targets[0]!) > threadedRange) {
        fail('target-out-of-range', `Threaded has a maximum range of ${threadedRange} metres.`)
      }
      if (cells.length === 1 && Math.max(
        Math.abs(cells[0]!.x - input.actor.position.x),
        Math.abs(cells[0]!.y - input.actor.position.y),
        Math.abs(cells[0]!.z - input.actor.position.z),
      ) > threadedRange) fail('target-out-of-range', `Threaded has a maximum range of ${threadedRange} metres.`)
      if (cells.length === 1 && !input.map.voxels.some(voxel => voxel.x === cells[0]!.x && voxel.y === cells[0]!.y && voxel.z === cells[0]!.z)) {
        fail('threaded-anchor-missing', 'Threaded anchor must identify authoritative map terrain.')
      }
      const expected = targets.length ? ['willing-target', 'unwilling-target'] : ['anchor']
      if (!expected.includes(branch)) fail('threaded-option-invalid', 'Threaded branch does not match its target selection.')
      if (targets.length && branch === 'willing-target'
        && !targetIsWilling(input.map, input.actor.id, targets[0]!.id)) {
        fail('target-not-willing', 'The willing Threaded branch requires an exact authoritative willingness identity.')
      }
    }
  }

  if (['assemble-zygarde', 'disassemble-zygarde', 'change-zygarde-form', 'tutor-cube-move'].includes(input.command.actionId)) {
    const requestedTrainerSlug = input.command.selections.recipientTrainerSlug
    const cubeOwners = linkedTrainerSheets(input.actor, input.trainerSheets)
      .filter(trainer => trainerHasItem(trainer, 'Zygarde Cube'))
    if (requestedTrainerSlug
      ? !cubeOwners.some(trainer => trainer.slug === requestedTrainerSlug)
      : cubeOwners.length === 0) {
      fail('zygarde-cube-required', 'This Zygarde operation requires an exact linked Trainer who owns a Zygarde Cube.')
    }
  }
  if (input.command.actionId === 'disassemble-zygarde' || input.command.actionId === 'change-zygarde-form') {
    const assembly = zygardeAssemblyRecordForPlacement(input.map, input.actor)
    if (!assembly || typeof assembly.trainerSlug !== 'string') {
      fail('zygarde-assembly-missing', 'This Zygarde has no authoritative Cube assembly state.')
    }
    const retainedAssembly = assembly!
    const requested = input.command.selections.recipientTrainerSlug
      ?? linkedTrainerSheets(input.actor, input.trainerSheets)
        .find(trainer => trainer.slug === retainedAssembly.trainerSlug && trainerHasItem(trainer, 'Zygarde Cube'))?.slug
    if (requested !== retainedAssembly.trainerSlug) {
      fail('zygarde-assembly-cube-owner-required', 'This operation requires the Cube owner whose Cell resources formed this Zygarde.')
    }
    if (input.command.actionId === 'disassemble-zygarde' && retainedAssembly.disassemblable !== true) {
      fail('zygarde-not-disassemblable', 'A 100-Cell Power Construct Zygarde cannot be disassembled.')
    }
    if (input.command.actionId === 'change-zygarde-form' && retainedAssembly.powerConstruct !== true) {
      fail('zygarde-power-construct-required', 'Only a 100-Cell Power Construct Zygarde may change between 10% and 50% formes.')
    }
  }
  if (input.command.actionId === 'assemble-zygarde') {
    if (input.actor.sheetKind !== 'pokemon') fail('pokemon-actor-required', 'Zygarde assembly requires a Pokémon actor.')
    if (zygardeAssemblyRecordForPlacement(input.map, input.actor)) {
      fail('zygarde-already-assembled', 'This Zygarde already has authoritative Cube assembly state.')
    }
    const match = /^cells:(10|50|100);form:(10-percent|50-percent);nature:([^;]{1,40});level:(\d{1,3})$/.exec(input.command.selections.optionId ?? '')
    const cellCount = Number(match?.[1])
    const level = Number(match?.[4])
    if (!match || level < 1 || level > 100 || (cellCount === 10 && match?.[2] !== '10-percent')) {
      fail('zygarde-assembly-option-invalid', 'Zygarde assembly requires cells 10/50/100, a legal form, canonical Nature, and level 1–100.')
    }
    const trainerSlug = input.command.selections.recipientTrainerSlug
      ?? linkedTrainerSheets(input.actor, input.trainerSheets).find(trainer => trainerHasItem(trainer, 'Zygarde Cube'))?.slug
    const resources = Array.isArray(input.map.metadata?.capabilityZygardeCells)
      ? input.map.metadata.capabilityZygardeCells as unknown[] : []
    if (!trainerSlug || !resources.some(raw => {
      const resource = raw as Record<string, unknown>
      return resource?.trainerSlug === trainerSlug && Number.isSafeInteger(resource.count)
        && (resource.count as number) >= cellCount
    })) fail('zygarde-cells-required', `The selected linked Trainer requires ${cellCount} authoritative Zygarde Cells.`)
    const validNature = resolveNature(match![3])
    if (!validNature) fail('zygarde-nature-invalid', 'Zygarde assembly requires a canonical Nature.')
  }
  if (input.command.actionId === 'change-zygarde-form'
    && !['10-percent', '50-percent'].includes(input.command.selections.optionId ?? '')) {
    fail('option-invalid', 'Zygarde form must be 10-percent or 50-percent.')
  }
  if (input.command.actionId === 'telekinetic-maneuver') {
    if (!['disarm', 'trip', 'push'].includes(input.command.selections.optionId ?? '')) {
      fail('option-invalid', 'Telekinetic maneuver must be disarm, trip, or push.')
    }
    if (input.command.selections.optionId === 'push' && targets[0]) {
      const exactTrainerPounds = targets[0]!.sheetKind === 'trainer'
        ? trainerWeightPounds(targetSheets[0] as TrainerSheet) : null
      const targetWeightClass = targets[0]!.sheetKind === 'pokemon'
        ? Math.max(1, Math.floor((targetSheets[0] as CharacterSheet).capabilities?.weight
          ?? pokedexBySpecies.get((targetSheets[0] as CharacterSheet).species.trim().toLocaleLowerCase('en-US'))?.weight ?? 1))
        : trainerWeightClass(targetSheets[0] as TrainerSheet)
      const maximumPoundsByWeightClass: Readonly<Record<number, number>> = {
        1: 25, 2: 55, 3: 110, 4: 220, 5: 440, 6: Number.POSITIVE_INFINITY, 7: Number.POSITIVE_INFINITY,
      }
      const authoritativeTargetPounds = exactTrainerPounds
        ?? (maximumPoundsByWeightClass[targetWeightClass] ?? Number.POSITIVE_INFINITY)
      if (authoritativeTargetPounds > capabilityPowerLimits(telekineticFocus).heavyMaximum) {
        fail('telekinetic-push-target-too-heavy', 'Telekinetic Push requires a target no heavier than the user’s Focus-derived Heavy Lifting rating.')
      }
    }
  }
  if (input.command.actionId === 'track-scent') {
    const selection = parseTrackerScentSelection(input.command.selections.optionId)
      ?? fail('option-invalid', 'Tracker context must be familiar, random, or specific with an optional bounded prey identity.')
    if (input.command.selections.gmConfirmed && !selection.preyIdentity) {
      fail('tracker-prey-identity-missing', 'The GM must bind the Tracker check to one exact authoritative prey identity.')
    }
    if (selection.branch === 'familiar' && input.command.selections.gmConfirmed) {
      const evidence = Array.isArray(input.map.metadata?.capabilityScentEvidence)
        ? input.map.metadata.capabilityScentEvidence as unknown[] : []
      if (!evidence.some(raw => {
        const record = raw as Record<string, unknown>
        return record?.actorPlacementId === input.actor.id
          && record.preyIdentity === selection.preyIdentity
          && (record.personalBelonging === true
            || (typeof record.smelledAt === 'number' && record.smelledAt >= input.now - 24 * 60 * 60_000))
          && (typeof record.expiresAt !== 'number' || record.expiresAt > input.now)
      })) fail('tracker-familiar-scent-evidence-missing', 'The familiar Tracker branch requires current retained evidence for that exact prey identity.')
    }
    else if (selection.branch !== 'familiar' && !hasContext(input.map, 'scent-trail')) {
      fail('tracker-world-context-missing', 'Random or specific scent pickup requires an authoritative available scent-trail context.')
    }
    if (input.command.selections.gmConfirmed && !input.command.selections.description?.trim()) {
      fail('tracker-result-missing', 'The GM must retain the private scent trail result before the authoritative Tracker check.')
    }
  }

  const exclusiveLinkKind = input.command.actionId === 'mount' ? 'as-one-mount'
    : input.command.actionId === 'bond' ? 'viral-fusion'
      : input.command.actionId === 'ride-shadow' ? 'shadow-rider' : null
  if (exclusiveLinkKind && input.map.encounterState?.capabilityRuntime?.links.some(link => (
    link.ownerPlacementId === input.actor.id && link.kind === exclusiveLinkKind
  ))) fail('capability-link-already-active', 'This exclusive Capability link must be released before another can be established.')
  if (exclusiveLinkKind && targets.some(target => coupledLinks.some(link => (
    link.ownerPlacementId === target.id || link.participantPlacementIds.includes(target.id)
  )))) fail('capability-link-target-unavailable', 'A mounted or fused participant cannot enter another exclusive physical link.')

  const separatingKind = input.command.actionId === 'dismount' ? 'as-one-mount'
    : input.command.actionId === 'release-rider' ? 'mount-rider'
      : input.command.actionId === 'disengage-wielder' ? 'living-weapon'
        : input.command.actionId === 'release-bond' ? 'viral-fusion'
          : input.command.actionId === 'leave-shadow' ? 'shadow-rider' : null
  if (separatingKind) {
    const link = input.map.encounterState?.capabilityRuntime?.links.find(entry => (
      entry.ownerPlacementId === input.actor.id
      && entry.kind === separatingKind
      && entry.capabilityInstanceId === input.command.capabilityInstanceId
    )) ?? fail('capability-link-missing', 'The exact source-owned Capability link is no longer active.')
    if (input.command.selections.cells.length !== 1) {
      fail('capability-release-cell-required', 'Releasing a linked participant requires one adjacent authoritative cell.')
    }
    const participantId = input.command.actionId === 'release-rider'
      ? targets[0]?.id : link.participantPlacementIds[0]
    if (!participantId || !link.participantPlacementIds.includes(participantId)) {
      fail('capability-release-participant-invalid', 'The selected participant is not carried by this exact Capability link.')
    }
    const retainedParticipantId = participantId
      ?? fail('capability-release-participant-invalid', 'The linked participant is unavailable.')
    const actorMoves = separatingKind === 'living-weapon' || separatingKind === 'shadow-rider'
    const moverId = actorMoves ? input.actor.id : retainedParticipantId
    const stationaryId = actorMoves ? retainedParticipantId : input.actor.id
    const stationary = input.map.placements.find(placement => placement.id === stationaryId)
      ?? fail('capability-release-participant-missing', 'The stationary linked participant is unavailable.')
    const stationaryToken = placementToSpawned(stationary, {
      pokemon: new Map(input.pokemonSheets), trainer: new Map(input.trainerSheets),
    }, input.map) ?? fail('capability-release-participant-missing', 'The stationary linked participant has no authoritative token.')
    const destination = input.command.selections.cells[0]!
    const adjacency = Math.max(stationaryToken.base, getClearanceValue(stationaryToken))
    if (Math.max(
      Math.abs(destination.x - stationary.position.x),
      Math.abs(destination.y - stationary.position.y),
      Math.abs(destination.z - stationary.position.z),
    ) > adjacency) fail('capability-release-cell-not-adjacent', 'The release cell must be adjacent to the stationary participant.')
    const relocation = resolveAuthoritativeRelocation({
      map: input.map,
      sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
      placementId: moverId,
      mode: 'separate',
      destination,
      now: input.now,
      ignoredOriginPlacementIds: [stationaryId],
    })
    if (!relocation.ok) fail(relocation.reasonCode, relocation.message)
  }

  if (input.command.canonicalId === 'Mountable X' && input.command.actionId === 'accept-rider') {
    const guidelineOverride = mountableGuidelineOverride(input.map, input.actor.id)
    if (targets.some(target => target.sheetKind !== 'trainer'
      && !hasContext(input.map, `suitable-rider:${input.actor.id}:${target.id}`)
      && !guidelineOverride?.approvedRiderPlacementIds.has(target.id))) {
      fail('mountable-rider-invalid', 'Mountable capacity accepts average Trainers unless an exact GM-approved rider context says otherwise.')
    }
    if (hasContext(input.map, `significant-extra-weight:${input.actor.id}`)
      && !guidelineOverride?.allowSignificantExtraWeight) {
      fail('mountable-extra-weight', 'Mountable capacity fails under significant extra weight unless the campaign guideline explicitly allows it.')
    }
    const instance = resolveEffectiveCapabilities({
      map: input.map,
      placement: input.actor,
      sheet: input.actorSheet,
      sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
    }).instances.find(candidate => candidate.instanceId === input.command.capabilityInstanceId)
    const canonicalCapacity = instance?.parameters.kind === 'rider-capacity' ? instance.parameters.riders : 0
    const capacity = guidelineOverride?.riderCapacity ?? canonicalCapacity
    const existingRiders = input.map.encounterState?.capabilityRuntime?.links.find(link => (
      link.ownerPlacementId === input.actor.id && link.kind === 'mount-rider'
    ))?.participantPlacementIds ?? []
    const totalRiders = new Set([...existingRiders, ...targets.map(target => target.id)]).size
    if (capacity < totalRiders) fail('mount-capacity-exceeded', `Mountable capacity is ${capacity}.`)
  }

  if (input.command.actionId === 'engage-wielder' && targets[0]) {
    if (input.actor.sheetKind !== 'pokemon') fail('living-weapon-pokemon-required', 'Living Weapon requires a Pokémon equipment actor.')
    const existingLinks = (input.map.encounterState?.capabilityRuntime?.links ?? []).filter(link => link.kind === 'living-weapon')
    if (existingLinks.some(link => link.ownerPlacementId === input.actor.id)) {
      fail('living-weapon-already-engaged', 'This Living Weapon is already engaged with a wielder.')
    }
    const species = (input.actorSheet as CharacterSheet).species.trim().toLocaleLowerCase('en-US')
    if (!['honedge', 'doublade', 'aegislash'].includes(species)) {
      fail('living-weapon-species-invalid', 'Living Weapon equipment profiles are defined only for Honedge, Doublade, and Aegislash.')
    }
    const targetSheet = targetSheets[0]!
    const linkedWeapons = existingLinks.filter(link => link.participantPlacementIds.includes(targets[0]!.id))
    if (targets[0]!.sheetKind === 'trainer') {
      const slots = (targetSheet as TrainerSheet).equipmentSlots
      const equipmentHands = Number(Boolean(slots?.mainHand?.trim())) + Number(Boolean(slots?.offHand?.trim()))
      const linkedHands = linkedWeapons.reduce((total, link) => {
        const owner = input.map.placements.find(placement => placement.id === link.ownerPlacementId)
        const ownerSheet = owner?.sheetKind === 'pokemon' ? input.pokemonSheets.get(owner.sheetSlug) : null
        return total + (ownerSheet?.species.trim().toLocaleLowerCase('en-US') === 'honedge' ? 1 : 2)
      }, 0)
      const requiredHands = species === 'honedge' ? 1 : 2
      if (equipmentHands + linkedHands + requiredHands > 2) fail('living-weapon-hands-occupied', `This Living Weapon profile requires ${requiredHands} free hand slot${requiredHands === 1 ? '' : 's'}.`)
    }
    else if (((targetSheet as CharacterSheet).items?.held ?? '').trim() || linkedWeapons.length > 0) {
      fail('living-weapon-held-slot-occupied', 'A Pokémon wielder must have an empty Held Item slot for Living Weapon equipment.')
    }
  }

  if (input.command.actionId === 'ready-light-shield') {
    if (input.actor.sheetKind !== 'pokemon'
      || (input.actorSheet as CharacterSheet).species.trim().toLocaleLowerCase('en-US') !== 'aegislash') {
      fail('living-weapon-light-shield-invalid', 'Only a wielded Aegislash can be readied as a Living Weapon Light Shield.')
    }
    const exactLink = input.map.encounterState?.capabilityRuntime?.links.find(link => (
      link.kind === 'living-weapon'
      && link.ownerPlacementId === input.actor.id
      && link.participantPlacementIds.length === 1
      && link.participantPlacementIds[0] === actingPlacement.id
      && link.capabilityInstanceId === input.command.capabilityInstanceId
      && link.canonicalId === 'Living Weapon'
    ))
    if (!exactLink || actingPlacement.id === input.actor.id) {
      fail('living-weapon-light-shield-link-missing', 'Light Shield readiness requires the exact engaged Living Weapon wielder.')
    }
    const selections = input.command.selections
    if (selections.targetPlacementIds.length || selections.cells.length || selections.optionId !== null
      || selections.recipientTrainerSlug !== null || selections.canonicalItemId !== null
      || selections.description !== null || selections.gmConfirmed) {
      fail('living-weapon-light-shield-selection-invalid', 'Ready Light Shield does not accept client-authored selections.')
    }
  }

  if (input.command.actionId === 'mount' && targets[0]) {
    const targetEffective = resolveEffectiveCapabilities({
      map: input.map,
      placement: targets[0],
      sheet: targetSheets[0]!,
      sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
    })
    const mountable = targetEffective.instances.some(instance => instance.effective && instance.canonicalId === 'Mountable X')
    if (!mountable && !hasContext(input.map, `suitable-mount:${input.actor.id}:${targets[0].id}`)) {
      fail('target-not-mountable', 'As One requires Mountable or an exact GM-approved suitable mount context.')
    }
    const selectedAbility = input.command.selections.optionId?.trim()
    if (!selectedAbility) fail('mount-ability-required', 'As One must retain the selected Basic Ability.')
    const selectedAbilityName = selectedAbility ?? fail('mount-ability-required', 'As One must retain the selected Basic Ability.')
    if (selectedAbilityName === 'Wonder Guard') fail('mount-ability-prohibited', 'As One cannot gain Wonder Guard.')
    const targetSheet = targets[0].sheetKind === 'pokemon' ? targetSheets[0] as CharacterSheet : null
    const basicAbilities = targetSheet
      ? pokedexBySpecies.get(targetSheet.species.trim().toLocaleLowerCase('en-US'))?.abilities?.basic ?? []
      : []
    if (!basicAbilities.includes(selectedAbilityName)) fail('mount-basic-ability-invalid', 'The retained As One Ability is not a Basic Ability of the selected mount species.')
  }

  if (input.command.actionId === 'gather-unown') {
    const cells = input.command.selections.cells
    if (cells.length !== 1) fail('summon-cell-required', 'Gather Unown requires one authoritative open-space cell.')
    const cell = cells[0]!
    if (cell.x < 0 || cell.y < 0 || cell.z < 0
      || cell.x >= input.map.dimensions.x || cell.y >= input.map.dimensions.y || cell.z >= input.map.dimensions.z
      || input.map.placements.some(placement => placement.position.x === cell.x && placement.position.y === cell.y && placement.position.z === cell.z)) {
      fail('summon-cell-occupied', 'Gather Unown requires an unoccupied in-bounds cell.')
    }
  }

  if (input.command.actionId === 'roam-for-fortune'
    || input.command.actionId === 'resolve-fortune-roam'
    || input.command.actionId === 'abandon-fortune-roam') {
    if (input.actor.sheetKind !== 'pokemon') {
      fail('fortune-pokemon-required', 'Fortune roaming is available only to Pokémon.')
    }
    if ((input.actorSheet.level ?? 0) < 20) {
      fail('fortune-level-required', 'Fortune roaming requires a Pokémon of at least Level 20.')
    }
    const task = input.map.encounterState?.capabilityRuntime?.tasks.find(candidate => (
      candidate.kind === 'fortune-roam'
      && candidate.actorPlacementId === input.actor.id
      && candidate.capabilityInstanceId === input.command.capabilityInstanceId
      && candidate.canonicalId === 'Fortune'
    ))
    if (input.command.actionId === 'roam-for-fortune') {
      if (task) fail('fortune-roam-already-active', 'This exact Fortune source already has an active roam.')
      if (input.command.selections.cells.length > 0
        || input.command.selections.targetPlacementIds.length > 0
        || input.command.selections.optionId !== null
        || input.command.selections.recipientTrainerSlug !== null
        || input.command.selections.canonicalItemId !== null
        || input.command.selections.description !== null
        || input.command.selections.gmConfirmed) {
        fail('fortune-roam-start-selection-invalid', 'Starting a Fortune roam does not resolve its one-hour outcome early.')
      }
    }
    else {
      const activeTask = task
        ?? fail('fortune-roam-task-missing', 'The exact source-owned Fortune roam is no longer active.')
      if (input.command.actionId === 'resolve-fortune-roam' && input.now < activeTask.completesAt) {
        fail('fortune-roam-not-due', 'The Fortune roam has not completed its authoritative one-hour duration.')
      }
      if (input.command.selections.cells.length > 0
        || input.command.selections.targetPlacementIds.length > 0
        || input.command.selections.canonicalItemId !== null) {
        fail('fortune-roam-continuation-selection-invalid', 'Fortune roam continuation actions do not accept targets, cells, or items.')
      }
      if (input.command.actionId === 'abandon-fortune-roam') {
        if (input.command.selections.optionId !== null
          || input.command.selections.recipientTrainerSlug !== null
          || input.command.selections.description !== null
          || input.command.selections.gmConfirmed) {
          fail('fortune-roam-abandon-selection-invalid', 'Abandoning a Fortune roam does not accept outcome choices.')
        }
      }
      else if (input.command.selections.gmConfirmed) {
        const decision = (input.command.selections.optionId ?? input.command.selections.description)
          ?.trim().toLocaleLowerCase('en-US')
        const lowLoyalty = input.actor.sheetKind === 'pokemon'
          && ((input.actorSheet as CharacterSheet).loyalty ?? 3) <= 1
        if (decision !== 'returns' && (decision !== 'runs-away' || !lowLoyalty)) {
          fail('fortune-loyalty-choice-invalid', lowLoyalty
            ? 'Low-Loyalty Fortune requires the bounded GM choice returns or runs-away.'
            : 'A Fortune user above Loyalty 1 must return from its roam.')
        }
        if (decision === 'returns') {
          const recipient = input.command.selections.recipientTrainerSlug
          if (!recipient || !linkedTrainerSheets(input.actor, input.trainerSheets)
            .some(trainer => trainer.slug === recipient)) {
            fail('fortune-recipient-invalid', 'A returning Fortune user requires one exact linked Trainer recipient.')
          }
        }
      }
    }
  }

  if (input.command.actionId === 'mega-evolve') {
    const activeScene = input.map.activeScene
      ?? fail('delta-mega-scene-required', 'Delta Evolution requires an active Scene.')
    if (input.actor.sheetKind !== 'pokemon') fail('delta-mega-pokemon-required', 'Delta Evolution requires a Pokémon actor.')
    const actor = input.actorSheet as CharacterSheet
    if (deltaEvolutionNeedsMegaStone(actor, true)) {
      fail('delta-evolution-prerequisite-missing', 'Delta Evolution requires Rayquaza to know Dragon Ascent before waiving its Mega Stone.')
    }
    const trainerSlug = input.command.selections.recipientTrainerSlug
    const trainer = (trainerSlug
      ? linkedTrainerSheets(input.actor, input.trainerSheets).find(candidate => candidate.slug === trainerSlug)
      : null) ?? fail('mega-ring-required', 'Delta Evolution requires an exact linked Trainer wearing a Mega Ring.')
    if (trainer.equipmentSlots?.accessory?.trim().toLocaleLowerCase('en-US') !== 'mega ring') {
      fail('mega-ring-required', 'Delta Evolution still requires the linked Trainer to be wearing a Mega Ring.')
    }
    const sceneStartedAt = activeScene.startedAt
    if (!Number.isSafeInteger(sceneStartedAt) || (sceneStartedAt ?? -1) < 0) {
      fail('mega-scene-identity-missing', 'Mega Evolution requires an authoritative Scene start identity.')
    }
    if (Array.isArray(input.map.metadata?.capabilityMegaEvolutionUses)
      && input.map.metadata.capabilityMegaEvolutionUses.some(raw => {
        const use = raw as Record<string, unknown>
        return use?.trainerSlug === trainer.slug && use.sceneStartedAt === sceneStartedAt
      })) fail('mega-ring-scene-use-spent', 'This Mega Ring already supports a Mega Evolution in the current Scene.')
    if (input.map.encounterState?.capabilityRuntime?.modes.some(mode => (
      mode.actorPlacementId === input.actor.id
      && mode.mode === 'mega-evolved'
      && mode.capabilityInstanceId === input.command.capabilityInstanceId
      && mode.canonicalId === input.command.canonicalId
      && (mode.expiresAt === null || mode.expiresAt > input.now)
    ))) fail('already-mega-evolved', 'Rayquaza is already Mega Evolved.')
    const currentAbilities = new Set(effectiveRuntimeAbilityIds({ map: input.map, placement: input.actor, sheet: actor }))
    const selectedAbility = input.command.selections.optionId ?? 'Run Away'
    const natural = pokedexBySpecies.get('rayquaza')?.abilities
    const naturalAbilities = new Set([...(natural?.basic ?? []), ...(natural?.advanced ?? []), ...(natural?.high ?? [])])
    if (currentAbilities.has('Run Away')) {
      if (!naturalAbilities.has(selectedAbility) || currentAbilities.has(selectedAbility)) {
        fail('mega-duplicate-ability-choice-invalid', 'Rayquaza already has Run Away; select another natural Ability it does not currently have.')
      }
    }
    else if (selectedAbility !== 'Run Away') {
      fail('mega-ability-invalid', 'Mega Rayquaza gains Run Away unless duplicate-Ability replacement is required.')
    }
  }

  if (input.command.actionId === 'assume-crowned-form') {
    if (input.actor.sheetKind !== 'pokemon') fail('pokemon-actor-required', 'Weapon Bond requires a Pokémon actor.')
    const actor = input.actorSheet as CharacterSheet
    const species = actor.species.trim().toLocaleLowerCase('en-US')
    const held = (actor.items?.held ?? '').trim().toLocaleLowerCase('en-US')
    const legal = (species.includes('zacian') && held === 'ancestral sword')
      || (species.includes('zamazenta') && held === 'ancestral shield')
    if (!legal) fail('ancestral-item-invalid', 'Weapon Bond requires Zacian with an Ancestral Sword or Zamazenta with an Ancestral Shield.')
  }

  if (input.command.actionId === 'consume-juicer-shell-juice-as-snack') {
    const selections = input.command.selections
    if (selections.targetPlacementIds.length || selections.cells.length || selections.optionId !== null
      || selections.canonicalItemId !== null || selections.description !== null || selections.gmConfirmed) {
      fail('juicer-snack-selections-invalid', 'Shell juice Snack use accepts only the typed self action with no client-authored resource choices.')
    }
    if (input.actor.sheetKind !== 'pokemon'
      || !pokemonHasAuthoritativeJuicerIdentity(input.actorSheet as CharacterSheet)) {
      fail('juicer-shuckle-required', 'Shell juice Snack use requires the authoritative Shuckle with Juicer.')
    }
    const actor = input.actorSheet as CharacterSheet
    if (!juicerShellJuice(actor, input.now)) {
      fail('juicer-shell-juice-unavailable', 'Snack use requires the exact Shuckle’s Berry Juice item in this Shuckle’s shell.')
    }
    if (!juicerCanConsumeShellJuiceAsSnack({ map: input.map, placement: input.actor, sheet: actor, now: input.now })) {
      fail('juicer-snack-slot-unavailable', 'Shuckle has no legal Digestion Buff slot for its shell juice.')
    }
    if (input.command.selections.recipientTrainerSlug !== null) {
      fail('juicer-snack-recipient-invalid', 'Shuckle consumes its own shell juice; this action has no inventory recipient.')
    }
  }

  if (input.command.actionId === 'collect-juicer-output') {
    const selections = input.command.selections
    if (selections.targetPlacementIds.length || selections.cells.length || selections.optionId !== null
      || selections.canonicalItemId !== null || selections.description !== null || selections.gmConfirmed) {
      fail('juicer-collection-selections-invalid', 'Juicer collection accepts only an explicitly linked Trainer recipient.')
    }
    if (input.actor.sheetKind !== 'pokemon'
      || !pokemonHasAuthoritativeJuicerIdentity(input.actorSheet as CharacterSheet)) {
      fail('juicer-shuckle-required', 'Juicer output collection requires the authoritative Shuckle with Juicer.')
    }
    const output = juicerShellOutput(input.actorSheet as CharacterSheet, input.now)
    if (!output) {
      fail('juicer-output-unavailable', 'Juicer collection requires the exact mature item still stored in the user’s shell.')
    }
    const requested = input.command.selections.recipientTrainerSlug
    if (!requested || !linkedTrainerSheets(input.actor, input.trainerSheets).some(trainer => trainer.slug === requested)) {
      fail('item-recipient-invalid', 'Juicer output requires an explicitly selected Trainer inventory linked to Shuckle.')
    }
  }

  if (['produce-dream-mist', 'gather-honey', 'produce-moomoo-milk'].includes(input.command.actionId)) {
    const recipients = linkedTrainerSheets(input.actor, input.trainerSheets)
    const requested = input.command.selections.recipientTrainerSlug
    const recipient = requested ? recipients.find(trainer => trainer.slug === requested) : recipients.find(trainer => trainerHasItem(trainer, 'Collection Jar'))
    if (!recipient || !trainerHasItem(recipient, 'Collection Jar')) {
      fail('collection-jar-required', 'This Capability output requires a linked recipient with a Collection Jar.')
    }
  }

  if (input.command.actionId === 'plant') {
    if (input.actor.sheetKind !== 'pokemon') fail('pokemon-actor-required', 'Planter requires a Pokémon actor.')
    const actor = input.actorSheet as CharacterSheet
    if (actor.capabilityCampaignState?.planter) fail('planter-occupied', 'This Planter already holds a plant.')
    const selected = input.command.selections.canonicalItemId
    const canonicalInput = selected ? canonicalCapabilityItemName(selected) : null
    if (!canonicalInput || (actor.items?.held ?? '').trim().toLocaleLowerCase('en-US') !== canonicalInput.toLocaleLowerCase('en-US')) {
      fail('planter-input-required', 'Planter requires the exact authoritatively held canonical seed or plant input.')
    }
    const plantedOutput = input.command.selections.optionId ?? input.command.selections.description
    if (input.command.selections.gmConfirmed && (!plantedOutput || !canonicalCapabilityItemName(plantedOutput))) {
      fail('planter-output-invalid', 'The GM-retained Planter output must be a canonical inventory item.')
    }
    const instance = resolveEffectiveCapabilities({
      map: input.map, placement: input.actor, sheet: input.actorSheet,
      sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
    }).instances.find(candidate => candidate.instanceId === input.command.capabilityInstanceId)
    if (instance?.parameters.kind === 'categories' && instance.parameters.categories.length > 0) {
      const normalized = (selected as string).toLocaleLowerCase('en-US')
      const allowed = instance.parameters.categories.some(category => {
        const stem = category.toLocaleLowerCase('en-US').replace(/ies$/, 'y').replace(/s$/, '')
        return normalized.includes(stem)
      })
      if (!allowed) fail('planter-category-prohibited', `This Planter is limited to ${instance.parameters.categories.join(', ')}.`)
    }
  }
  if (input.command.actionId === 'harvest' && input.actor.sheetKind === 'pokemon') {
    if (!(input.actorSheet as CharacterSheet).capabilityCampaignState?.planter) {
      fail('planter-empty', 'This Planter has no retained plant to harvest.')
    }
    const harvested = input.command.selections.optionId ?? input.command.selections.description
    if (input.command.selections.gmConfirmed && (!harvested || !canonicalCapabilityItemName(harvested))) {
      fail('planter-harvest-invalid', 'The GM-retained Planter harvest must be a canonical inventory item.')
    }
  }

  if (input.command.actionId === 'tutor-cube-move') {
    if (input.actor.sheetKind !== 'pokemon') fail('pokemon-actor-required', 'Zygarde Cube tutoring requires a Pokémon actor.')
    const actor = input.actorSheet as CharacterSheet
    const allowed = new Set(['Core Enforcer', 'Dragon Dance', 'Extreme Speed', 'Thousand Arrows', 'Thousand Waves'])
    const moveName = input.command.selections.canonicalItemId
    const move = moveName ? findMove(moveName) : null
    if (!move || !allowed.has(move.name)) fail('cube-move-invalid', 'The selected Move is not on the reviewed Zygarde Cube Move List.')
    const available = computePokemonTutorPointsEarnedForSheet(actor) - Math.max(0, actor.tutorPoints?.spent ?? 0)
    if (available < 1) fail('tutor-points-required', 'Zygarde Cube tutoring requires 1 available Tutor Point.')
  }

  if (input.command.actionId === 'combine-unown') {
    if (input.actor.sheetKind !== 'pokemon' || (input.actorSheet as CharacterSheet).species.trim().toLocaleLowerCase('en-US') !== 'unown') {
      fail('unown-actor-required', 'Letter Press requires an authoritative Unown actor.')
    }
    if (targets.some((target, index) => target.sheetKind !== 'pokemon'
      || (targetSheets[index] as CharacterSheet).species.trim().toLocaleLowerCase('en-US') !== 'unown')) {
      fail('unown-required', 'Letter Press may combine only authoritative Unown targets.')
    }
    if (targetSheets.some(sheet => {
      const pokemon = sheet as CharacterSheet
      return Boolean(pokemon.letterPressCombinedInto || pokemon.capabilityCampaignState?.letterPress)
    })) {
      fail('letter-press-prime-target-prohibited', 'Letter Press cannot consume an existing Prime Unown or an Unown already combined into one.')
    }
    if (targets.some(target => !targetIsWilling(input.map, input.actor.id, target.id))) {
      fail('letter-press-target-not-willing', 'Irreversible Letter Press combination requires exact authoritative willingness for every participant.')
    }
    const currentState = (input.actorSheet as CharacterSheet).capabilityCampaignState?.letterPress
    if ((currentState?.combinedUnownCount ?? 1) + targets.length > 257) fail('unown-capacity-exceeded', 'Prime Unown exceeded the bounded encounter participant safety limit.')
    const match = /^stats:(none|(?:hp|atk|def|satk|sdef|spd)(?:,(?:hp|atk|def|satk|sdef|spd)){0,3});hidden-power:(none|(?:(?:attack|special)(?:,(?:attack|special)){0,5}))$/.exec(input.command.selections.optionId ?? '')
    if (!match) fail('letter-press-options-invalid', 'Letter Press requires bounded stat and Hidden Power attack-stat choices.')
    const usedBonuses = Object.values(currentState?.statBonuses ?? {}).reduce((total, value) => total + (value ?? 0), 0) / 5
    const expectedStatChoices = Math.min(targets.length, Math.max(0, 4 - usedBonuses))
    const statChoices = match![1] === 'none' ? [] : match![1]!.split(',')
    if (statChoices.length !== expectedStatChoices) fail('letter-press-stat-choice-count', `Letter Press requires ${expectedStatChoices} five-point Base Stat choices.`)
    const actor = input.actorSheet as CharacterSheet
    const actorHasUnretainedHiddenPower = !currentState
      && [...(actor.movelist ?? []), ...(actor.appliedMoves ?? [])].some(move => move.name === 'Hidden Power')
    const hiddenPowerCandidates = [
      ...(actorHasUnretainedHiddenPower ? [actor] : []),
      ...targetSheets.map(sheet => sheet as CharacterSheet),
    ].filter(sheet => [...(sheet.movelist ?? []), ...(sheet.appliedMoves ?? [])].some(move => move.name === 'Hidden Power'))
    const hiddenChoices = match![2] === 'none' ? [] : match![2]!.split(',')
    const existingMoveCount = [...(actor.movelist ?? []), ...(actor.appliedMoves ?? [])].length
    const availableHiddenSlots = Math.max(0, 6 - existingMoveCount + (actorHasUnretainedHiddenPower ? 1 : 0))
    const expectedHiddenChoices = Math.min(hiddenPowerCandidates.length, availableHiddenSlots)
    if (hiddenChoices.length !== expectedHiddenChoices) {
      fail('letter-press-hidden-power-count', `Letter Press requires ${expectedHiddenChoices} permanent Hidden Power attack-stat choices within the normal Move List limit.`)
    }
  }
  if (input.command.actionId === 'bond' && targets.length !== 1) {
    fail('bond-target-count', 'Viral Fusion requires exactly one willing or helpless target.')
  }
  if (input.command.actionId === 'bond' && targets.length === 1) {
    if (!targetIsWilling(input.map, input.actor.id, targets[0]!.id)
      && !targetIsHelpless(input.map, targets[0]!, input.pokemonSheets, input.trainerSheets)) {
      fail('viral-target-not-willing-or-helpless', 'Viral Fusion requires retained willingness or an authoritative helpless condition.')
    }
    if (targets[0]!.sheetKind !== 'pokemon' || input.actor.sheetKind !== 'pokemon') {
      fail('viral-pokemon-required', 'Viral Fusion requires Pokémon actor and bond target.')
    }
    const target = targetSheets[0] as CharacterSheet
    const species = pokedexBySpecies.get(target.species.trim().toLocaleLowerCase('en-US'))
    const selected = input.command.selections.optionId
    if (!selected || !findMove(selected)) fail('viral-signature-move-invalid', 'Viral Fusion requires a canonical signature Move.')
    const actorMoves = [...((input.actorSheet as CharacterSheet).movelist ?? []), ...((input.actorSheet as CharacterSheet).appliedMoves ?? [])]
    if (!actorMoves.some(move => move.name === selected) && actorMoves.length >= 6) {
      fail('viral-move-list-full', 'Viral Fusion cannot add its signature Move until the user has a legal open Move List slot.')
    }
    const normalizedSpecies = target.species.trim().toLocaleLowerCase('en-US')
    if (normalizedSpecies.includes('solgaleo') && selected !== 'Sunsteel Strike') {
      fail('viral-signature-move-invalid', 'Solgaleo’s signature Move must be Sunsteel Strike.')
    }
    else if (normalizedSpecies.includes('lunala') && selected !== 'Moongeist Beam') {
      fail('viral-signature-move-invalid', 'Lunala’s signature Move must be Moongeist Beam.')
    }
    else if (!normalizedSpecies.includes('solgaleo') && !normalizedSpecies.includes('lunala')) {
      const row = species?.level_up_moves?.find(move => move.name === selected)
      if (!row) fail('viral-signature-move-invalid', 'The selected signature Move is not on the bonded species’ Level-Up Move List.')
      if ((input.actorSheet.level ?? 0) < row!.level) fail('viral-signature-level-required', `The user must be Level ${row!.level} to learn ${selected}.`)
    }
  }
}
