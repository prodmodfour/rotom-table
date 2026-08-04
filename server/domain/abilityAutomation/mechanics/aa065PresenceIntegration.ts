import { createHash } from 'node:crypto'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { projectAuthoritativeEffectiveAbilities } from '../effectiveAbilities'
import { resolveSheetAndEdgeAbilityInstances } from '../../edgeAutomation/permanentGrants'
import { reduceAbilityOwnedStateCommand } from '../ownedState'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY, type AbilityAutomationRuntimeRegistry } from '../registry'

const shortHash = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 24)
export const AA065_CURIOUS_MEDICINE_ENTRY_MARK = 'aa065.curious-medicine.enter-field' as const

export const aa065CuriousMedicineEntryStateIds = (input: {
  readonly map: TabletopMap
  readonly ownerPlacementId: string
  readonly abilityInstanceId: string
}): readonly string[] => Object.freeze((input.map.encounterState?.abilityOwnedState?.entries ?? []).flatMap(entry => (
  entry.ownerPlacementId === input.ownerPlacementId
  && entry.sourceAbilityInstanceId === input.abilityInstanceId
  && entry.canonicalId === 'Curious Medicine'
  && entry.payload.kind === 'mark'
  && entry.payload.markId === AA065_CURIOUS_MEDICINE_ENTRY_MARK
    ? [entry.stateId]
    : []
)))

/** Create one retry-safe, source-presence reaction entitlement when its owner enters the field. */
export const applyAa065CuriousMedicineSendOutTrigger = (input: {
  readonly mapAfter: TabletopMap
  readonly releasedPlacementId: string
  readonly operationId: string
  readonly readPokemonSheet: (slug: string) => CharacterSheet | null
  readonly registry?: AbilityAutomationRuntimeRegistry
}): TabletopMap => {
  const runtime = (input.registry ?? ABILITY_AUTOMATION_RUNTIME_REGISTRY).resolve('Curious Medicine')
  if (!runtime) return input.mapAfter
  const placement = input.mapAfter.placements.find(candidate => candidate.id === input.releasedPlacementId)
  if (!placement || placement.sheetKind !== 'pokemon') return input.mapAfter
  const sheet = input.readPokemonSheet(placement.sheetSlug)
  if (!sheet) return input.mapAfter
  const source = projectAuthoritativeEffectiveAbilities({
    baseAbilities: resolveSheetAndEdgeAbilityInstances(sheet),
    target: {
      placementId: placement.id,
      ...(placement.sideId ? { sideId: placement.sideId } : {}),
      position: placement.position,
    },
    effects: input.mapAfter.encounterState?.effects ?? [],
    transformationSnapshots: input.mapAfter.encounterState?.abilityTransformations,
  }).find(ability => ability.effective
    && ability.canonicalId === 'Curious Medicine'
    && (ability.definitionHash === null || ability.definitionHash === runtime.definitionHash))
  if (!source) return input.mapAfter
  let encounter = parseEncounterState(input.mapAfter.encounterState ?? createEmptyEncounterState())
  const sceneId = encounter.history.sceneId
  const spent = encounter.abilityUsage?.sceneId === sceneId
    ? encounter.abilityUsage.entries.find(entry => entry.ownerId === placement.id
      && entry.abilityInstanceId === source.instanceId
      && entry.canonicalId === 'Curious Medicine'
      && entry.clauseId === 'base')?.spent ?? 0
    : 0
  if (!sceneId || spent >= 1) return input.mapAfter
  const identity = shortHash(`${input.operationId}:${placement.id}:${source.instanceId}`)
  const stateId = `${source.instanceId}:curious-medicine-entry:${identity}`
  const reduced = reduceAbilityOwnedStateCommand(encounter.abilityOwnedState, {
    operationId: `${input.operationId}:curious-medicine:${identity}`,
    kind: 'create', stateId, expectedVersion: null,
    entry: {
      stateId, ownerPlacementId: placement.id, sourceAbilityInstanceId: source.instanceId,
      canonicalId: 'Curious Medicine', targetPlacementIds: [],
      lifecycle: { kind: 'source-presence', targetPolicy: null },
      payload: { kind: 'mark', markId: AA065_CURIOUS_MEDICINE_ENTRY_MARK },
    },
  })
  encounter = parseEncounterState({ ...encounter, abilityOwnedState: reduced.state })
  return { ...input.mapAfter, encounterState: encounter }
}
