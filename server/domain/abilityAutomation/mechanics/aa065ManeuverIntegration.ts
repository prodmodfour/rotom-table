import { createHash } from 'node:crypto'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { projectAuthoritativeEffectiveAbilities } from '../effectiveAbilities'
import { resolveSheetAndEdgeAbilityInstances } from '../../edgeAutomation/permanentGrants'
import { reduceAbilityOwnedStateCommand } from '../ownedState'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY, type AbilityAutomationRuntimeRegistry } from '../registry'

const shortHash = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 24)
export const AA065_CRUSH_TRAP_GRAPPLE_MARK_PREFIX = 'aa065.crush-trap.grapple:' as const

export const aa065CrushTrapGrappleStateIds = (input: {
  readonly map: TabletopMap
  readonly ownerPlacementId: string
  readonly abilityInstanceId: string
  readonly targetPlacementId?: string
}): readonly string[] => Object.freeze((input.map.encounterState?.abilityOwnedState?.entries ?? []).flatMap(entry => (
  entry.ownerPlacementId === input.ownerPlacementId
  && entry.sourceAbilityInstanceId === input.abilityInstanceId
  && entry.canonicalId === 'Crush Trap'
  && entry.payload.kind === 'mark'
  && entry.payload.markId.startsWith(AA065_CRUSH_TRAP_GRAPPLE_MARK_PREFIX)
  && (input.targetPlacementId === undefined || entry.targetPlacementIds.includes(input.targetPlacementId))
    ? [entry.stateId]
    : []
)))

/** Materialize an optional Crush Trap response only after an accepted adjacent Grapple command. */
export const applyAa065CrushTrapGrappleTrigger = (input: {
  readonly map: TabletopMap
  readonly actorPlacement: SheetPlacement
  readonly actorToken: Pick<SpawnedPokemon, 'id' | 'position' | 'base' | 'clearance'>
  readonly actorSheet: CharacterSheet
  readonly targetToken: Pick<SpawnedPokemon, 'id' | 'position' | 'base' | 'clearance'>
  readonly operationId: string
  readonly registry?: AbilityAutomationRuntimeRegistry
}): TabletopMap => {
  const runtime = (input.registry ?? ABILITY_AUTOMATION_RUNTIME_REGISTRY).resolve('Crush Trap')
  if (!runtime || input.actorPlacement.sheetKind !== 'pokemon'
    || input.actorToken.id === input.targetToken.id
    || ptuGridDistanceBetweenFootprints(input.actorToken, input.targetToken) > 1) return input.map
  const source = projectAuthoritativeEffectiveAbilities({
    baseAbilities: resolveSheetAndEdgeAbilityInstances(input.actorSheet),
    target: {
      placementId: input.actorPlacement.id,
      ...(input.actorPlacement.sideId ? { sideId: input.actorPlacement.sideId } : {}),
      position: input.actorPlacement.position,
    },
    effects: input.map.encounterState?.effects ?? [],
    transformationSnapshots: input.map.encounterState?.abilityTransformations,
  }).find(ability => ability.effective
    && ability.canonicalId === 'Crush Trap'
    && (ability.definitionHash === null || ability.definitionHash === runtime.definitionHash))
  if (!source) return input.map
  let encounter = parseEncounterState(input.map.encounterState ?? createEmptyEncounterState())
  const sceneId = encounter.history.sceneId
  const spent = encounter.abilityUsage?.sceneId === sceneId
    ? encounter.abilityUsage.entries.find(entry => entry.ownerId === input.actorPlacement.id
      && entry.abilityInstanceId === source.instanceId
      && entry.canonicalId === 'Crush Trap'
      && entry.clauseId === 'base')?.spent ?? 0
    : 0
  if (!sceneId || spent >= 1) return input.map
  const identity = shortHash(`${input.operationId}:${input.actorPlacement.id}:${input.targetToken.id}:${source.instanceId}`)
  const stateId = `${source.instanceId}:crush-trap:${identity}`
  const reduced = reduceAbilityOwnedStateCommand(encounter.abilityOwnedState, {
    operationId: `${input.operationId}:crush-trap:${identity}`,
    kind: 'create', stateId, expectedVersion: null,
    entry: {
      stateId, ownerPlacementId: input.actorPlacement.id, sourceAbilityInstanceId: source.instanceId,
      canonicalId: 'Crush Trap', targetPlacementIds: [input.targetToken.id],
      lifecycle: { kind: 'target-presence', targetPolicy: 'any-target-leaves' },
      payload: { kind: 'mark', markId: `${AA065_CRUSH_TRAP_GRAPPLE_MARK_PREFIX}${shortHash(input.targetToken.id)}` },
    },
  })
  encounter = parseEncounterState({ ...encounter, abilityOwnedState: reduced.state })
  return { ...input.map, encounterState: encounter }
}
