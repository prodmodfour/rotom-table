import type { CapabilityPhysicalPowerLoadProjection } from '#shared/capabilityAutomation/power'
import { resolveCapabilityPowerLoad } from '#shared/capabilityAutomation/power'
import type { TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import { clampCombatStage } from '~/utils/combatStages'
import { getClearanceValue, gridFootprintCells } from '~/utils/gridGeometry'

const PHYSICAL_LOAD_KIND = 'physical-power-load'
const PHYSICAL_LOAD_CANONICAL_ID = 'Power'
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/%-]{0,239}$/

export class CapabilityPhysicalPowerLoadError extends Error {
  constructor(readonly code: 'invalid-load-state' | 'duplicate-object-id', message: string) {
    super(message)
    this.name = 'CapabilityPhysicalPowerLoadError'
  }
}

const fail = (
  code: CapabilityPhysicalPowerLoadError['code'],
  message: string,
): never => { throw new CapabilityPhysicalPowerLoadError(code, message) }

const optionalRound = (value: unknown, path: string): number | null => {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    return fail('invalid-load-state', `${path} must be a positive safe integer or null.`)
  }
  return value as number
}

interface PhysicalLoadObject {
  readonly id: string
  readonly pounds: number
  readonly capabilityInstanceId: string
  readonly lastMovedRound: number | null
  readonly lastCheckRound: number | null
}

const physicalLoadObjectsForPlacement = (
  map: TabletopMap,
  placementId: string,
): readonly PhysicalLoadObject[] => {
  const rawObjects = map.metadata?.capabilityObjects
  if (!Array.isArray(rawObjects)) return Object.freeze([])
  const owners = map.placements.filter(placement => placement.id === placementId)
  if (owners.length !== 1) {
    return fail('invalid-load-state', `Physical Power load owner ${placementId} must resolve exactly once.`)
  }
  const owner = owners[0]!
  const objects = rawObjects.flatMap((raw, index): readonly PhysicalLoadObject[] => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const object = raw as Record<string, unknown>
    if (object.attachmentKind !== PHYSICAL_LOAD_KIND || object.attachedToPlacementId !== placementId) return []
    const path = `metadata.capabilityObjects[${index}]`
    const position = object.position as Record<string, unknown> | null
    if (object.attachedCapabilityCanonicalId !== PHYSICAL_LOAD_CANONICAL_ID
      || typeof object.id !== 'string' || !IDENTIFIER.test(object.id)
      || typeof object.attachedCapabilityInstanceId !== 'string'
      || !IDENTIFIER.test(object.attachedCapabilityInstanceId)
      || typeof object.pounds !== 'number' || !Number.isFinite(object.pounds)
      || object.pounds <= 0 || object.pounds > 1_000_000_000
      || !position || position.x !== owner.position.x
      || position.y !== owner.position.y || position.z !== owner.position.z) {
      return fail('invalid-load-state', `${path} has malformed physical Power load authority.`)
    }
    return [Object.freeze({
      id: object.id,
      pounds: object.pounds,
      capabilityInstanceId: object.attachedCapabilityInstanceId,
      lastMovedRound: optionalRound(object.physicalLoadLastMovedRound, `${path}.physicalLoadLastMovedRound`),
      lastCheckRound: optionalRound(object.physicalLoadLastCheckRound, `${path}.physicalLoadLastCheckRound`),
    })]
  })
  const ids = new Set<string>()
  for (const object of objects) {
    if (ids.has(object.id)) return fail('duplicate-object-id', `Physical Power load repeats object ${object.id}.`)
    ids.add(object.id)
  }
  return Object.freeze(objects)
}

export const physicalPowerSourceValues = (instances: readonly {
  readonly instanceId: string
  readonly canonicalId: string
  readonly effective: boolean
  readonly value: number | null
}[]): ReadonlyMap<string, number> => new Map(instances.flatMap(instance => (
  instance.effective && instance.canonicalId === PHYSICAL_LOAD_CANONICAL_ID
    && typeof instance.value === 'number' && Number.isFinite(instance.value)
    ? [[instance.instanceId, instance.value] as const]
    : []
)))

export const resolvePhysicalPowerLoad = (input: {
  readonly map: TabletopMap
  readonly placementId: string
  readonly powerByCapabilityInstanceId: ReadonlyMap<string, number>
}): CapabilityPhysicalPowerLoadProjection | null => {
  const objects = physicalLoadObjectsForPlacement(input.map, input.placementId)
    .filter(object => input.powerByCapabilityInstanceId.has(object.capabilityInstanceId))
  if (objects.length === 0) return null
  if (objects.length > 16) {
    return fail('invalid-load-state', `Physical Power load for ${input.placementId} exceeds sixteen objects.`)
  }
  const capabilityInstanceIds = [...new Set(objects.map(object => object.capabilityInstanceId))]
  if (capabilityInstanceIds.length !== 1) {
    return fail('invalid-load-state', `Physical Power load for ${input.placementId} has contradictory source instances.`)
  }
  const power = input.powerByCapabilityInstanceId.get(capabilityInstanceIds[0]!)
  if (power === undefined) return null
  const movedRounds = new Set(objects.map(object => object.lastMovedRound))
  const checkRounds = new Set(objects.map(object => object.lastCheckRound))
  if (movedRounds.size !== 1 || checkRounds.size !== 1) {
    return fail('invalid-load-state', `Physical Power load for ${input.placementId} has contradictory round state.`)
  }
  const pounds = objects.reduce((total, object) => total + object.pounds, 0)
  if (!Number.isFinite(pounds) || pounds <= 0 || pounds > 1_000_000_000) {
    return fail('invalid-load-state', `Physical Power load for ${input.placementId} has invalid combined weight.`)
  }
  const resolution = resolveCapabilityPowerLoad(power, pounds)
  return Object.freeze({
    ...resolution,
    power: Math.max(1, Math.floor(power)),
    pounds,
    objectIds: Object.freeze(objects.map(object => object.id)),
    capabilityInstanceId: capabilityInstanceIds[0]!,
    lastMovedRound: objects[0]!.lastMovedRound,
    lastCheckRound: objects[0]!.lastCheckRound,
  })
}

export const physicalPowerMovementLimit = (
  load: (Pick<CapabilityPhysicalPowerLoadProjection, 'loadClass' | 'movementMetersPerShift'>
    & Partial<Pick<CapabilityPhysicalPowerLoadProjection, 'lastMovedRound'>>) | null,
  round: number | null | undefined,
): number | null => {
  if (!load || load.movementMetersPerShift === null) return null
  if (load.loadClass === 'drag' && round !== null && round !== undefined
    && load.lastMovedRound === round) return 0
  return load.movementMetersPerShift
}

export const projectPhysicalPowerLoadToken = <TToken extends SpawnedPokemon>(input: {
  readonly token: TToken
  readonly map: TabletopMap
  readonly placementId: string
  readonly powerByCapabilityInstanceId: ReadonlyMap<string, number>
}): TToken => {
  const physicalPowerLoad = resolvePhysicalPowerLoad(input)
  if (!physicalPowerLoad) {
    if (input.token.physicalPowerLoad === undefined) return input.token
    const token = { ...input.token }
    delete token.physicalPowerLoad
    return token
  }
  const speedStage = clampCombatStage(
    (input.token.combatStages?.spd ?? 0) + physicalPowerLoad.speedCombatStagePenalty,
  )
  return {
    ...input.token,
    physicalPowerLoad,
    combatStages: { ...input.token.combatStages, spd: speedStage },
  }
}

export const projectPhysicalPowerFootprint = <TToken extends Pick<SpawnedPokemon, 'position' | 'base' | 'clearance'>>(input: {
  readonly token: TToken
  readonly map: TabletopMap
  readonly placementId: string
  readonly effectiveCapabilityInstanceIds: ReadonlySet<string>
  readonly now: number
}): TToken => {
  const modes = (input.map.encounterState?.capabilityRuntime?.modes ?? []).filter(mode => (
    mode.actorPlacementId === input.placementId
    && input.effectiveCapabilityInstanceIds.has(mode.capabilityInstanceId)
    && (mode.expiresAt === null || mode.expiresAt > input.now)
  ))
  const scale = modes.some(mode => mode.mode === 'inflated') ? 1.25
    : modes.some(mode => mode.mode === 'shrunken') ? 0.25 : 1
  return {
    ...input.token,
    base: Math.max(1, Math.ceil(input.token.base * scale)),
    clearance: modes.some(mode => mode.mode === 'shadow-melded')
      ? 1 : Math.max(1, Math.ceil(getClearanceValue(input.token) * scale)),
  }
}

export const physicalPowerObjectIsAdjacent = (
  token: Pick<SpawnedPokemon, 'position' | 'base' | 'clearance'>,
  position: { readonly x: number; readonly y: number; readonly z: number },
): boolean => gridFootprintCells(token.position, token).some(cell => Math.max(
  Math.abs(cell.x - position.x),
  Math.abs(cell.y - position.y),
  Math.abs(cell.z - position.z),
) <= 1)

export const isPhysicalPowerLoadObject = (
  object: Record<string, unknown>,
): boolean => object.attachmentKind === PHYSICAL_LOAD_KIND
  && object.attachedCapabilityCanonicalId === PHYSICAL_LOAD_CANONICAL_ID

export const physicalPowerLoadAttachment = (input: {
  readonly placementId: string
  readonly capabilityInstanceId: string
  readonly operationId: string
  readonly lastMovedRound: number | null
  readonly lastCheckRound: number | null
}): Readonly<Record<string, unknown>> => Object.freeze({
  attachedToPlacementId: input.placementId,
  attachedCapabilityInstanceId: input.capabilityInstanceId,
  attachedCapabilityCanonicalId: PHYSICAL_LOAD_CANONICAL_ID,
  attachmentKind: PHYSICAL_LOAD_KIND,
  physicalLoadOperationId: input.operationId,
  physicalLoadLastMovedRound: input.lastMovedRound,
  physicalLoadLastCheckRound: input.lastCheckRound,
})

export const relocateCapabilityAttachedObjects = (
  map: TabletopMap,
  destinations: ReadonlyMap<string, { readonly x: number; readonly y: number; readonly z: number }>,
): TabletopMap => {
  if (destinations.size === 0 || !Array.isArray(map.metadata?.capabilityObjects)) return map
  const round = Number.isSafeInteger(map.initiative?.round) && (map.initiative?.round ?? 0) > 0
    ? map.initiative!.round : null
  let changed = false
  const capabilityObjects = map.metadata.capabilityObjects.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
    const object = raw as Record<string, unknown>
    const destination = typeof object.attachedToPlacementId === 'string'
      ? destinations.get(object.attachedToPlacementId) : undefined
    if (!destination) return raw
    changed = true
    return {
      ...object,
      position: { ...destination },
      ...(object.attachmentKind === PHYSICAL_LOAD_KIND && round !== null
        ? { physicalLoadLastMovedRound: round } : {}),
    }
  })
  return changed ? {
    ...map,
    metadata: { ...(map.metadata ?? {}), capabilityObjects },
  } : map
}

export const clearPhysicalPowerLoadsForPlacements = (
  map: TabletopMap,
  placementIds: ReadonlySet<string>,
): TabletopMap => {
  if (placementIds.size === 0 || !Array.isArray(map.metadata?.capabilityObjects)) return map
  let changed = false
  const capabilityObjects = map.metadata.capabilityObjects.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
    const object = raw as Record<string, unknown>
    if (!isPhysicalPowerLoadObject(object)
      || typeof object.attachedToPlacementId !== 'string'
      || !placementIds.has(object.attachedToPlacementId)) return raw
    changed = true
    return clearPhysicalPowerLoadAttachment(object)
  })
  return changed ? {
    ...map,
    metadata: { ...(map.metadata ?? {}), capabilityObjects },
  } : map
}

export const applyPhysicalPowerLoadRoundCheck = (input: {
  readonly map: TabletopMap
  readonly placementId: string
  readonly capabilityInstanceId: string
  readonly round: number
  readonly passed: boolean
}): TabletopMap => {
  if (!Array.isArray(input.map.metadata?.capabilityObjects)) return input.map
  let changed = false
  const capabilityObjects = input.map.metadata.capabilityObjects.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
    const object = raw as Record<string, unknown>
    if (!isPhysicalPowerLoadObject(object)
      || object.attachedToPlacementId !== input.placementId
      || object.attachedCapabilityInstanceId !== input.capabilityInstanceId) return raw
    changed = true
    return input.passed
      ? { ...object, physicalLoadLastCheckRound: input.round }
      : clearPhysicalPowerLoadAttachment(object)
  })
  return changed ? {
    ...input.map,
    metadata: { ...(input.map.metadata ?? {}), capabilityObjects },
  } : input.map
}

export const clearPhysicalPowerLoadAttachment = (
  object: Record<string, unknown>,
): Record<string, unknown> => {
  const next = { ...object }
  delete next.attachedToPlacementId
  delete next.attachedCapabilityInstanceId
  delete next.attachedCapabilityCanonicalId
  delete next.attachmentKind
  delete next.physicalLoadOperationId
  delete next.physicalLoadLastMovedRound
  delete next.physicalLoadLastCheckRound
  return next
}
